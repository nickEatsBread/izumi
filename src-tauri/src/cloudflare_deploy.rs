use base64::{engine::general_purpose, Engine as _};
use reqwest::{multipart, Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::time::Duration;

const API_ROOT: &str = "https://api.cloudflare.com/client/v4";
const TEMPORARY_AUTH_RETRY_DELAYS: &[Duration] = &[
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(15),
];
const WORKER_BUNDLE: &str = include_str!("cloudflare_worker_bundle.mjs");
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "0001_initial",
        include_str!("../../cloudflare-sync-worker/migrations/0001_initial.sql"),
    ),
    (
        "0002_companion_wake",
        include_str!("../../cloudflare-sync-worker/migrations/0002_companion_wake.sql"),
    ),
    (
        "0003_cloud_resolver",
        include_str!("../../cloudflare-sync-worker/migrations/0003_cloud_resolver.sql"),
    ),
    (
        "0004_companion_independent",
        include_str!("../../cloudflare-sync-worker/migrations/0004_companion_independent.sql"),
    ),
    (
        "0005_companion_discovery",
        include_str!("../../cloudflare-sync-worker/migrations/0005_companion_discovery.sql"),
    ),
    (
        "0006_record_chunks",
        include_str!("../../cloudflare-sync-worker/migrations/0006_record_chunks.sql"),
    ),
    ("0007_connected_accounts", include_str!("../../cloudflare-sync-worker/migrations/0007_connected_accounts.sql")),
    ("0008_companion_client_links", include_str!("../../cloudflare-sync-worker/migrations/0008_companion_client_links.sql")),
];

#[derive(Debug, Deserialize)]
struct ApiMessage {
    code: Option<i64>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    success: bool,
    result: Option<T>,
    #[serde(default)]
    errors: Vec<ApiMessage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareAccount {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareDeploymentTarget {
    pub account_id: String,
    pub script_name: String,
    pub database_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareDeployResult {
    pub endpoint: String,
    pub deployment: CloudflareDeploymentTarget,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflarePreviewDeployResult {
    pub endpoint: String,
    pub claim_url: String,
    pub claim_expires_at: String,
    pub deployment: CloudflareDeploymentTarget,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewChallenge {
    challenge_token: String,
    seed: String,
    k: u64,
    g: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewAccount {
    id: String,
    api_token: String,
}

#[derive(Debug, Deserialize)]
struct PreviewClaim {
    url: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
}

#[derive(Debug, Deserialize)]
struct PreviewProvisioning {
    account: PreviewAccount,
    claim: PreviewClaim,
}

#[derive(Debug, Deserialize)]
struct D1Database {
    uuid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkersSubdomain {
    subdomain: String,
}

struct CloudflareApi {
    client: reqwest::Client,
    token: String,
    api_root: String,
    temporary_auth_retry_delays: &'static [Duration],
    retain_update_access: bool,
}

impl CloudflareApi {
    fn new(token: String) -> Result<Self, String> {
        let token = token.trim().to_string();
        if token.len() < 20 || token.chars().any(char::is_whitespace) {
            return Err("Paste the complete Cloudflare API token.".into());
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("izumi/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| format!("Could not start the Cloudflare connection: {error}"))?;
        Ok(Self {
            client,
            token,
            api_root: API_ROOT.into(),
            temporary_auth_retry_delays: &[],
            retain_update_access: true,
        })
    }

    fn new_preview(token: String) -> Result<Self, String> {
        let mut api = Self::new(token)?;
        api.temporary_auth_retry_delays = TEMPORARY_AUTH_RETRY_DELAYS;
        api.retain_update_access = false;
        Ok(api)
    }

    async fn create_database(&self, account_id: &str, name: &str) -> Result<D1Database, String> {
        let mut delays = self.temporary_auth_retry_delays.iter();
        loop {
            let response = self
                .request(Method::POST, &format!("/accounts/{account_id}/d1/database"))
                .json(&json!({ "name": name }))
                .send()
                .await
                .map_err(network_error)?;
            let status = response.status();
            let envelope: ApiEnvelope<D1Database> = response.json().await.map_err(network_error)?;
            // Fresh preview credentials can be returned before D1 accepts them.
            // Retry only an explicit authentication rejection: it did not create
            // a database. Timeouts and ambiguous failures must not repeat a POST.
            if status == StatusCode::UNAUTHORIZED
                && !envelope.success
                && envelope
                    .errors
                    .iter()
                    .any(|error| error.code == Some(10000))
            {
                if let Some(delay) = delays.next() {
                    tokio::time::sleep(*delay).await;
                    continue;
                }
            }
            if !status.is_success() || !envelope.success {
                return Err(api_error(status, &envelope.errors, "database creation"));
            }
            return envelope
                .result
                .ok_or_else(|| "Cloudflare returned an empty database creation response.".into());
        }
    }

    fn request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.api_root))
            .bearer_auth(&self.token)
    }

    async fn json<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, String> {
        parse_json_response(request.send().await.map_err(network_error)?).await
    }

    async fn success(&self, request: reqwest::RequestBuilder) -> Result<(), String> {
        let response = request.send().await.map_err(network_error)?;
        let status = response.status();
        let operation = api_operation(response.url().path());
        let bytes = response.bytes().await.map_err(network_error)?;
        let envelope: ApiEnvelope<Value> = serde_json::from_slice(&bytes)
            .map_err(|_| format!("Cloudflare returned an unreadable response ({status})."))?;
        if status.is_success() && envelope.success {
            Ok(())
        } else {
            Err(api_error(status, &envelope.errors, operation))
        }
    }
}

async fn parse_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, String> {
    let status = response.status();
    let operation = api_operation(response.url().path());
    let bytes = response.bytes().await.map_err(network_error)?;
    let envelope: ApiEnvelope<T> = serde_json::from_slice(&bytes)
        .map_err(|_| format!("Cloudflare returned an unreadable response ({status})."))?;
    if !status.is_success() || !envelope.success {
        return Err(api_error(status, &envelope.errors, operation));
    }
    envelope
        .result
        .ok_or_else(|| "Cloudflare returned an empty response.".into())
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Cloudflare did not respond in time. Try again.".into()
    } else {
        format!("Could not reach Cloudflare: {error}")
    }
}

fn api_operation(path: &str) -> &'static str {
    if path.ends_with("/provisioning/previews/challenge") {
        "security challenge"
    } else if path.ends_with("/provisioning/previews") {
        "temporary account creation"
    } else if path.ends_with("/accounts") {
        "account lookup"
    } else if path.ends_with("/query") {
        "database setup"
    } else if path.ends_with("/d1/database") {
        "database creation"
    } else if path.contains("/d1/database/") {
        "database verification"
    } else if path.ends_with("/subdomain") {
        "Worker address setup"
    } else if path.contains("/workers/scripts/") {
        "Worker upload"
    } else {
        "setup"
    }
}

fn api_error(status: StatusCode, errors: &[ApiMessage], operation: &str) -> String {
    let details = errors
        .iter()
        .filter_map(|error| {
            error
                .message
                .as_deref()
                .map(|message| (error.code, message))
        })
        .map(|(code, message)| match code {
            Some(code) => format!("{message} (code {code})"),
            None => message.to_string(),
        })
        .collect::<Vec<_>>()
        .join("; ");
    if details.is_empty() {
        format!("Cloudflare {operation} failed ({status}).")
    } else {
        format!("Cloudflare {operation} failed ({status}): {details}")
    }
}

fn valid_account_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_script_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_database_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn random_suffix() -> Result<String, String> {
    let mut bytes = [0u8; 4];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Could not generate a deployment name: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn solve_preview_challenge(challenge: &PreviewChallenge) -> Result<String, String> {
    if challenge.k == 0 || challenge.g == 0 {
        return Err("Cloudflare returned an invalid deployment challenge.".into());
    }
    let work = challenge
        .k
        .checked_mul(challenge.g)
        .ok_or_else(|| "Cloudflare returned an oversized deployment challenge.".to_string())?;
    if work > 64_000_000 {
        return Err("Cloudflare returned an oversized deployment challenge.".into());
    }
    let seed = general_purpose::URL_SAFE_NO_PAD
        .decode(&challenge.seed)
        .or_else(|_| general_purpose::URL_SAFE.decode(&challenge.seed))
        .map_err(|_| "Cloudflare returned an invalid deployment challenge seed.".to_string())?;
    if seed.len() != 32 {
        return Err("Cloudflare returned an invalid deployment challenge seed.".into());
    }

    let checkpoint_count = challenge
        .k
        .checked_add(1)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or_else(|| "Cloudflare returned an oversized deployment challenge.".to_string())?;
    let mut checkpoints = Vec::with_capacity(checkpoint_count * 32);
    let mut hash: [u8; 32] = Sha256::digest(seed).into();
    checkpoints.extend_from_slice(&hash);
    for _ in 0..challenge.k {
        for _ in 0..challenge.g {
            hash = Sha256::digest(hash).into();
        }
        checkpoints.extend_from_slice(&hash);
    }
    Ok(general_purpose::STANDARD.encode(checkpoints))
}

async fn provision_preview_account() -> Result<PreviewProvisioning, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("izumi/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not start the Cloudflare connection: {error}"))?;
    let challenge: PreviewChallenge = parse_json_response(
        client
            .post(format!("{API_ROOT}/provisioning/previews/challenge"))
            .json(&json!({}))
            .send()
            .await
            .map_err(network_error)?,
    )
    .await?;
    let solver_challenge = challenge.clone();
    let checkpoints =
        tokio::task::spawn_blocking(move || solve_preview_challenge(&solver_challenge))
            .await
            .map_err(|error| format!("Cloudflare deployment challenge failed: {error}"))??;

    parse_json_response(
        client
            .post(format!("{API_ROOT}/provisioning/previews"))
            .json(&json!({
                "termsOfService": "https://www.cloudflare.com/terms/",
                "privacyPolicy": "https://www.cloudflare.com/privacypolicy/",
                "acceptTermsOfService": "yes",
                "challengeToken": challenge.challenge_token,
                "solution": { "checkpoints": checkpoints },
            }))
            .send()
            .await
            .map_err(network_error)?,
    )
    .await
}

async fn d1_query(
    api: &CloudflareApi,
    account_id: &str,
    database_id: &str,
    sql: &str,
) -> Result<Value, String> {
    let result: Value = api.json(
        api.request(
            Method::POST,
            &format!("/accounts/{account_id}/d1/database/{database_id}/query"),
        )
        .json(&json!({ "sql": sql })),
    )
    .await?;
    // The API envelope and each SQL result have separate success flags.
    // Never record a failed migration as applied or upload code that needs it.
    if result.as_array().is_some_and(|queries| {
        queries.iter().any(|query| query.get("success") == Some(&Value::Bool(false)))
    }) {
        return Err("Cloudflare could not apply the database update. The Worker was not replaced.".into());
    }
    Ok(result)
}

async fn apply_migrations(
    api: &CloudflareApi,
    target: &CloudflareDeploymentTarget,
) -> Result<(), String> {
    d1_query(
        api,
        &target.account_id,
        &target.database_id,
        "CREATE TABLE IF NOT EXISTS izumi_deploy_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
    ).await?;
    let applied = d1_query(
        api,
        &target.account_id,
        &target.database_id,
        "SELECT name FROM izumi_deploy_migrations",
    )
    .await?;
    let applied = applied
        .as_array()
        .and_then(|queries| queries.first())
        .and_then(|query| query.get("results"))
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_string))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();

    for (name, source) in MIGRATIONS {
        if applied.contains(*name) {
            continue;
        }
        // D1 accepts a complete SQL batch. Splitting on semicolons corrupts
        // comments (migration 5) and quoted SQL values; let SQLite parse them.
        d1_query(api, &target.account_id, &target.database_id, source).await?;
        d1_query(
            api,
            &target.account_id,
            &target.database_id,
            &format!(
                "INSERT INTO izumi_deploy_migrations (name, applied_at) VALUES ('{name}', unixepoch())"
            ),
        ).await?;
    }
    Ok(())
}

async fn ensure_workers_subdomain(api: &CloudflareApi, account_id: &str) -> Result<String, String> {
    let path = format!("/accounts/{account_id}/workers/subdomain");
    let response = api
        .request(Method::GET, &path)
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status();
    let envelope: ApiEnvelope<WorkersSubdomain> = response.json().await.map_err(network_error)?;
    if status.is_success() && envelope.success {
        if let Some(existing) = envelope.result.filter(|value| !value.subdomain.is_empty()) {
            return Ok(existing.subdomain);
        }
    } else if status != StatusCode::NOT_FOUND
        || !envelope
            .errors
            .iter()
            .any(|error| error.code == Some(10007))
    {
        // A denied read does not mean the account needs a new address.
        return Err(api_error(status, &envelope.errors, "Worker address setup"));
    }

    let base = format!("izumi-{}", &account_id[..12]);
    for candidate in [base, format!("izumi-{}", random_suffix()?)] {
        let request = api
            .request(Method::PUT, &path)
            .json(&json!({ "subdomain": candidate }));
        if let Ok(created) = api.json::<WorkersSubdomain>(request).await {
            return Ok(created.subdomain);
        }
    }
    Err("Cloudflare could not create a workers.dev address for this account. Open Workers & Pages once, then try again.".into())
}

async fn upload_worker(
    api: &CloudflareApi,
    target: &CloudflareDeploymentTarget,
    bootstrap_secret: Option<&str>,
) -> Result<(), String> {
    let mut bindings = vec![json!({
        "type": "d1",
        "name": "DB",
        "id": target.database_id,
    })];
    if let Some(secret) = bootstrap_secret {
        bindings.push(json!({
            "type": "secret_text",
            "name": "BOOTSTRAP_SECRET",
            "text": secret,
        }));
    }
    // Preview-account credentials are temporary and cannot provide durable deployment access.
    if api.retain_update_access {
        bindings.push(json!({
            "type": "secret_text",
            "name": "WORKER_UPDATE_AUTH",
            "text": json!({
                "apiToken": api.token,
                "accountId": target.account_id,
                "scriptName": target.script_name,
                "databaseId": target.database_id,
            }).to_string(),
        }));
    }
    let metadata = json!({
        "main_module": "worker.mjs",
        "bindings": bindings,
        "keep_bindings": ["secret_text", "plain_text"],
        "compatibility_date": "2026-08-28",
        "compatibility_flags": ["nodejs_compat"],
        "annotations": {
            "workers/message": concat!("Deployed by Izumi ", env!("CARGO_PKG_VERSION")),
            "workers/tag": "izumi-private-sync"
        }
    });
    let form = multipart::Form::new()
        .part(
            "metadata",
            multipart::Part::text(metadata.to_string())
                .mime_str("application/json")
                .map_err(|error| error.to_string())?,
        )
        .part(
            "worker.mjs",
            multipart::Part::bytes(WORKER_BUNDLE.as_bytes().to_vec())
                .file_name("worker.mjs")
                .mime_str("application/javascript+module")
                .map_err(|error| error.to_string())?,
        );
    api.success(
        api.request(
            Method::PUT,
            &format!(
                "/accounts/{}/workers/scripts/{}",
                target.account_id, target.script_name
            ),
        )
        .multipart(form),
    )
    .await
}

async fn enable_worker_subdomain(
    api: &CloudflareApi,
    target: &CloudflareDeploymentTarget,
) -> Result<(), String> {
    api.success(
        api.request(
            Method::POST,
            &format!(
                "/accounts/{}/workers/scripts/{}/subdomain",
                target.account_id, target.script_name
            ),
        )
        .json(&json!({ "enabled": true, "previews_enabled": false })),
    )
    .await
}

async fn wait_for_worker(endpoint: &str) -> Result<(), String> {
    wait_for_worker_with_retry(endpoint, 20, Duration::from_millis(500)).await
}

async fn ensure_worker_update_schedule(
    api: &CloudflareApi,
    target: &CloudflareDeploymentTarget,
) -> Result<(), String> {
    if !api.retain_update_access {
        return Ok(());
    }
    let path = format!("/accounts/{}/workers/scripts/{}/schedules", target.account_id, target.script_name);
    let result: Value = api.json(api.request(Method::GET, &path)).await?;
    let existing = result.get("schedules").and_then(Value::as_array)
        .ok_or_else(|| "Cloudflare returned invalid Worker schedules.".to_string())?;
    let mut schedules: Vec<Value> = existing.iter().filter_map(|item|
        item.get("cron").and_then(Value::as_str).map(|cron| json!({"cron": cron}))
    ).collect();
    if !schedules.iter().any(|item| item["cron"] == "17 */6 * * *") {
        schedules.push(json!({"cron": "17 */6 * * *"}));
        api.success(api.request(Method::PUT, &path).json(&schedules)).await?;
    }
    Ok(())
}

async fn wait_for_worker_with_retry(
    endpoint: &str,
    attempts: usize,
    delay: Duration,
) -> Result<(), String> {
    let manifest: Value = serde_json::from_str(include_str!("../../cloudflare-sync-worker/package.json"))
        .map_err(|_| "The bundled Worker version is invalid.".to_string())?;
    let expected_version = manifest.get("version").and_then(Value::as_str)
        .ok_or_else(|| "The bundled Worker version is missing.".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| error.to_string())?;
    for attempt in 0..attempts {
        if let Ok(response) = client.get(format!("{endpoint}/v1/status"))
            .header(reqwest::header::CACHE_CONTROL, "no-cache")
            .send().await {
            if response.status().is_success() {
                if let Ok(status) = response.json::<Value>().await {
                    if status.get("app").and_then(Value::as_str) == Some("izumi-sync")
                        && status.get("version").and_then(Value::as_str) == Some(expected_version)
                        && status.get("protocol").and_then(Value::as_u64) == Some(1) {
                        return Ok(());
                    }
                }
            }
        }
        if attempt + 1 < attempts {
            tokio::time::sleep(delay).await;
        }
    }
    Err("The Worker was uploaded, but its expected version is not available yet. Wait a moment, then check its version again.".into())
}

#[tauri::command]
pub async fn cloudflare_deployment_accounts(
    api_token: String,
) -> Result<Vec<CloudflareAccount>, String> {
    let api = CloudflareApi::new(api_token)?;
    let accounts: Vec<CloudflareAccount> = api
        .json(api.request(Method::GET, "/accounts?per_page=50"))
        .await?;
    if accounts.is_empty() {
        Err("This token cannot access a Cloudflare account. Review its account scope and permissions.".into())
    } else {
        Ok(accounts)
    }
}

#[tauri::command]
pub async fn cloudflare_deploy_worker(
    api_token: String,
    account_id: String,
    bootstrap_secret: Option<String>,
    existing: Option<CloudflareDeploymentTarget>,
) -> Result<CloudflareDeployResult, String> {
    deploy_worker_with_api(
        CloudflareApi::new(api_token)?,
        account_id,
        bootstrap_secret,
        existing,
    )
    .await
}

async fn deploy_worker_with_api(
    api: CloudflareApi,
    account_id: String,
    bootstrap_secret: Option<String>,
    existing: Option<CloudflareDeploymentTarget>,
) -> Result<CloudflareDeployResult, String> {
    if !valid_account_id(&account_id) {
        return Err("The selected Cloudflare account is invalid.".into());
    }
    let secret = bootstrap_secret
        .as_deref()
        .map(str::trim)
        .filter(|secret| !secret.is_empty());
    if existing.is_none() && secret.map_or(true, |value| value.len() < 24) {
        return Err("Generate a complete Izumi setup secret before deploying.".into());
    }
    let is_new = existing.is_none();

    let target = prepare_deployment_target(&api, &account_id, existing).await?;

    let deployment = async {
        apply_migrations(&api, &target).await?;
        let subdomain = ensure_workers_subdomain(&api, &target.account_id).await?;
        upload_worker(&api, &target, secret).await?;
        ensure_worker_update_schedule(&api, &target).await?;
        enable_worker_subdomain(&api, &target).await?;
        let endpoint = format!("https://{}.{}.workers.dev", target.script_name, subdomain);
        wait_for_worker(&endpoint).await?;
        Ok::<_, String>(CloudflareDeployResult {
            endpoint,
            deployment: target.clone(),
        })
    }
    .await;

    if deployment.is_err() && is_new {
        let _ = api
            .success(api.request(
                Method::DELETE,
                &format!(
                    "/accounts/{}/workers/scripts/{}",
                    target.account_id, target.script_name
                ),
            ))
            .await;
        let _ = api
            .success(api.request(
                Method::DELETE,
                &format!(
                    "/accounts/{}/d1/database/{}",
                    target.account_id, target.database_id
                ),
            ))
            .await;
    }
    deployment
}

async fn prepare_deployment_target(
    api: &CloudflareApi,
    account_id: &str,
    existing: Option<CloudflareDeploymentTarget>,
) -> Result<CloudflareDeploymentTarget, String> {
    if let Some(target) = existing {
        if target.account_id != account_id
            || !valid_account_id(&target.account_id)
            || !valid_script_name(&target.script_name)
            || !valid_database_id(&target.database_id)
        {
            return Err("The saved Cloudflare deployment details are invalid.".into());
        }
        // Saved targets must still exist before an update can replace the Worker.
        let _: D1Database = api
            .json(api.request(
                Method::GET,
                &format!(
                    "/accounts/{}/d1/database/{}",
                    target.account_id, target.database_id
                ),
            ))
            .await?;
        Ok(target)
    } else {
        // A random suffix avoids ever replacing an unrelated Worker or a previous Izumi setup.
        let script_name = format!("izumi-sync-{}", random_suffix()?);
        let database = api
            .create_database(account_id, &format!("{script_name}-db"))
            .await?;
        // The create response already identifies this new database. Temporary
        // credentials support a narrower API than permanent account tokens;
        // do not require an extra metadata read before executing migrations.
        Ok(CloudflareDeploymentTarget {
            account_id: account_id.into(),
            script_name,
            database_id: database
                .uuid
                .ok_or_else(|| "Cloudflare created D1 without returning its ID.".to_string())?,
        })
    }
}

#[tauri::command]
pub async fn cloudflare_create_preview(
    accept_terms: bool,
    bootstrap_secret: String,
) -> Result<CloudflarePreviewDeployResult, String> {
    if !accept_terms {
        return Err(
            "Accept Cloudflare's Terms and Privacy Policy before creating the deployment.".into(),
        );
    }
    if bootstrap_secret.trim().len() < 24 {
        return Err("Generate a complete Izumi setup secret before deploying.".into());
    }
    let preview = provision_preview_account().await?;
    let deployed = deploy_worker_with_api(
        CloudflareApi::new_preview(preview.account.api_token)?,
        preview.account.id,
        Some(bootstrap_secret),
        None,
    )
    .await?;
    Ok(CloudflarePreviewDeployResult {
        endpoint: deployed.endpoint,
        claim_url: preview.claim.url,
        claim_expires_at: preview.claim.expires_at,
        deployment: deployed.deployment,
    })
}

#[tauri::command]
pub async fn cloudflare_remove_bootstrap_secret(
    api_token: String,
    deployment: CloudflareDeploymentTarget,
) -> Result<(), String> {
    if !valid_account_id(&deployment.account_id)
        || !valid_script_name(&deployment.script_name)
        || !valid_database_id(&deployment.database_id)
    {
        return Err("The saved Cloudflare deployment details are invalid.".into());
    }
    let api = CloudflareApi::new(api_token)?;
    api.success(api.request(
        Method::DELETE,
        &format!(
            "/accounts/{}/workers/scripts/{}/secrets/BOOTSTRAP_SECRET",
            deployment.account_id, deployment.script_name
        ),
    ))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "Creates an expiring Cloudflare account; run only for an authorized live setup diagnostic"]
    async fn live_temporary_d1_diagnostic() {
        let preview = provision_preview_account()
            .await
            .expect("temporary account provisioning");
        let api = CloudflareApi::new_preview(preview.account.api_token).unwrap();
        let path = format!("/accounts/{}/d1/database", preview.account.id);
        let name = format!("izumi-auth-diagnostic-{}", random_suffix().unwrap());
        let started = std::time::Instant::now();
        let database = api
            .create_database(&preview.account.id, &name)
            .await
            .expect("D1 creation with production activation retry");
        println!(
            "D1 creation succeeded after {:.1}s",
            started.elapsed().as_secs_f64()
        );
        let id = database.uuid.unwrap();
        let target = CloudflareDeploymentTarget {
            account_id: preview.account.id,
            script_name: name,
            database_id: id.clone(),
        };
        let verification = async {
            apply_migrations(&api, &target).await?;
            // A second pass must skip recorded migrations, including ALTER TABLE.
            apply_migrations(&api, &target).await?;
            println!(
                "All {} migrations applied and repeat application passed.",
                MIGRATIONS.len()
            );
            let subdomain = ensure_workers_subdomain(&api, &target.account_id).await?;
            upload_worker(&api, &target, Some("isolated-diagnostic-bootstrap-secret")).await?;
            enable_worker_subdomain(&api, &target).await?;
            wait_for_worker(&format!(
                "https://{}.{}.workers.dev",
                target.script_name, subdomain
            ))
            .await?;
            println!("Worker upload, address activation and live status check passed.");
            Ok::<(), String>(())
        }
        .await;
        // Clean up even if a later deployment step failed.
        let script_cleanup = api
            .success(api.request(
                Method::DELETE,
                &format!(
                    "/accounts/{}/workers/scripts/{}",
                    target.account_id, target.script_name
                ),
            ))
            .await;
        let database_cleanup = api
            .success(api.request(Method::DELETE, &format!("{path}/{id}")))
            .await;
        database_cleanup.expect("remove diagnostic database");
        println!("Diagnostic database removed.");
        verification.expect("complete automatic Cloudflare deployment");
        script_cleanup.expect("remove diagnostic Worker");
        println!("Diagnostic Worker removed.");
    }

    type Requests = std::sync::Arc<std::sync::Mutex<Vec<(Method, String, String)>>>;

    async fn mock_api(
        responses: Vec<(StatusCode, Value)>,
    ) -> (CloudflareApi, Requests, tokio::task::JoinHandle<()>) {
        use std::{
            collections::VecDeque,
            sync::{Arc, Mutex},
        };
        let requests: Requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
        let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
            let recorded = recorded.clone();
            let responses = responses.clone();
            async move {
                let method = request.method().clone();
                let path = request.uri().path().to_string();
                let body = axum::body::to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
                recorded.lock().unwrap().push((method, path, String::from_utf8(body.to_vec()).unwrap()));
                let (status, value) = responses.lock().unwrap().pop_front().unwrap_or((
                    StatusCode::UNAUTHORIZED,
                    json!({"success": false, "errors": [{"code": 10000, "message": "Authentication error"}]}),
                ));
                (status, axum::Json(value))
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let mut api = CloudflareApi::new("test-only-credential-0000".into()).unwrap();
        api.api_root = format!("http://{address}/client/v4");
        (api, requests, server)
    }

    #[tokio::test]
    async fn fresh_database_uses_creation_response_without_requiring_metadata_read() {
        let id = "01234567-89ab-cdef-0123-456789abcdef";
        let (api, requests, server) = mock_api(vec![(
            StatusCode::OK,
            json!({"success": true, "result": {"uuid": id}}),
        )])
        .await;
        // Any request after creation gets the reported authentication error.
        let target =
            prepare_deployment_target(&api, "0123456789abcdef0123456789abcdef", None).await;
        server.abort();
        assert_eq!(target.unwrap().database_id, id);
        assert_eq!(requests.lock().unwrap().len(), 1);
        assert_eq!(requests.lock().unwrap()[0].0, Method::POST);
    }

    fn authentication_failure() -> (StatusCode, Value) {
        (
            StatusCode::UNAUTHORIZED,
            json!({"success": false, "errors": [{"code": 10000, "message": "Authentication error"}]}),
        )
    }

    #[tokio::test]
    async fn temporary_credentials_retry_auth_rejections_until_d1_accepts_them() {
        let (mut api, requests, server) = mock_api(vec![
            authentication_failure(), authentication_failure(),
            (StatusCode::OK, json!({"success": true, "result": {"uuid": "01234567-89ab-cdef-0123-456789abcdef"}})),
        ]).await;
        api.temporary_auth_retry_delays = &[Duration::ZERO, Duration::ZERO];
        let target =
            prepare_deployment_target(&api, "0123456789abcdef0123456789abcdef", None).await;
        server.abort();
        assert!(target.is_ok());
        assert_eq!(requests.lock().unwrap().len(), 3);
        assert!(requests
            .lock()
            .unwrap()
            .iter()
            .all(|request| request.0 == Method::POST));
    }

    #[tokio::test]
    async fn user_api_tokens_are_not_retried_when_authentication_is_rejected() {
        let (api, requests, server) = mock_api(vec![authentication_failure()]).await;
        let result = api
            .create_database("0123456789abcdef0123456789abcdef", "test-db")
            .await;
        server.abort();
        assert!(result.unwrap_err().contains("code 10000"));
        assert_eq!(requests.lock().unwrap().len(), 1);
        assert!(CloudflareApi::new("test-only-credential-0000".into())
            .unwrap()
            .temporary_auth_retry_delays
            .is_empty());
        assert_eq!(
            CloudflareApi::new_preview("test-only-credential-0000".into())
                .unwrap()
                .temporary_auth_retry_delays
                .iter()
                .sum::<Duration>(),
            Duration::from_secs(30)
        );
    }

    #[tokio::test]
    async fn temporary_authentication_retry_has_a_fixed_limit() {
        let (mut api, requests, server) = mock_api(vec![]).await;
        api.temporary_auth_retry_delays = &[Duration::ZERO, Duration::ZERO];
        let result = api
            .create_database("0123456789abcdef0123456789abcdef", "test-db")
            .await;
        server.abort();
        assert!(result.unwrap_err().contains("code 10000"));
        assert_eq!(requests.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn ambiguous_or_unrelated_errors_never_repeat_database_creation() {
        for (status, code) in [
            (StatusCode::INTERNAL_SERVER_ERROR, 10000),
            (StatusCode::UNAUTHORIZED, 10001),
            (StatusCode::TOO_MANY_REQUESTS, 10000),
        ] {
            let (mut api, requests, server) = mock_api(vec![(
                status,
                json!({"success": false, "errors": [{"code": code, "message": "Rejected"}]}),
            )])
            .await;
            api.temporary_auth_retry_delays = &[Duration::ZERO];
            let result = api
                .create_database("0123456789abcdef0123456789abcdef", "test-db")
                .await;
            server.abort();
            assert!(result.is_err());
            assert_eq!(requests.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn saved_database_is_verified_before_replacing_worker() {
        let (api, requests, server) = mock_api(vec![]).await;
        let account_id = "0123456789abcdef0123456789abcdef";
        let target = CloudflareDeploymentTarget {
            account_id: account_id.into(),
            script_name: "izumi-sync-test".into(),
            database_id: "01234567-89ab-cdef-0123-456789abcdef".into(),
        };
        let error = prepare_deployment_target(&api, account_id, Some(target))
            .await
            .unwrap_err();
        server.abort();
        assert!(error.contains("database verification"));
        assert!(error.contains("10000"));
        assert!(!error.contains(account_id));
        assert_eq!(requests.lock().unwrap().len(), 1);
        assert_eq!(requests.lock().unwrap()[0].0, Method::GET);
    }

    #[tokio::test]
    async fn rejected_subdomain_lookup_never_changes_account_address() {
        let (api, requests, server) = mock_api(vec![]).await;
        let error = ensure_workers_subdomain(&api, "0123456789abcdef0123456789abcdef")
            .await
            .unwrap_err();
        server.abort();
        assert!(error.contains("Worker address setup"));
        assert!(error.contains("10000"));
        assert_eq!(requests.lock().unwrap().len(), 1);
        assert_eq!(requests.lock().unwrap()[0].0, Method::GET);
    }

    #[tokio::test]
    async fn missing_subdomain_can_still_be_created() {
        let (api, requests, server) = mock_api(vec![
            (
                StatusCode::NOT_FOUND,
                json!({"success": false, "errors": [{"code": 10007, "message": "No subdomain"}]}),
            ),
            (
                StatusCode::OK,
                json!({"success": true, "result": {"subdomain": "izumi-test"}}),
            ),
        ])
        .await;
        let subdomain = ensure_workers_subdomain(&api, "0123456789abcdef0123456789abcdef").await;
        server.abort();
        assert_eq!(subdomain.unwrap(), "izumi-test");
        assert_eq!(
            requests
                .lock()
                .unwrap()
                .iter()
                .map(|request| request.0.clone())
                .collect::<Vec<_>>(),
            [Method::GET, Method::PUT]
        );
    }

    #[test]
    fn direct_upload_bundle_is_generated_and_current() {
        assert!(WORKER_BUNDLE.starts_with("// izumi-cloudflare-source-sha256:"));
        assert!(WORKER_BUNDLE.contains("izumi-sync"));
        assert!(WORKER_BUNDLE.len() > 100_000);
    }

    #[test]
    fn includes_independent_tv_and_discovery_migrations() {
        assert!(MIGRATIONS
            .iter()
            .any(|(name, sql)| *name == "0004_companion_independent"
                && sql.contains("CREATE TABLE companion_progress")));
        assert!(MIGRATIONS
            .iter()
            .any(|(name, sql)| *name == "0005_companion_discovery"
                && sql.contains("CREATE TABLE companion_discovery")));
    }

    #[tokio::test]
    async fn migrations_are_sent_intact_including_semicolons_inside_comments() {
        let replies = vec![
            (StatusCode::OK, json!({"success": true, "result": []}));
            2 + MIGRATIONS.len() * 2
        ];
        let (api, requests, server) = mock_api(replies).await;
        let target = CloudflareDeploymentTarget {
            account_id: "0123456789abcdef0123456789abcdef".into(),
            script_name: "izumi-sync-test".into(),
            database_id: "01234567-89ab-cdef-0123-456789abcdef".into(),
        };
        let result = apply_migrations(&api, &target).await;
        server.abort();
        result.unwrap();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2 + MIGRATIONS.len() * 2);
        for (index, (name, source)) in MIGRATIONS.iter().enumerate() {
            let query: Value = serde_json::from_str(&requests[2 + index * 2].2).unwrap();
            assert_eq!(query["sql"].as_str().unwrap(), *source);
            let marker: Value = serde_json::from_str(&requests[3 + index * 2].2).unwrap();
            assert!(marker["sql"].as_str().unwrap().contains(name));
        }
        assert!(MIGRATIONS[4].1.contains("record; all content"));
    }

    #[test]
    fn deployment_identifiers_are_strict() {
        assert!(valid_account_id("0123456789abcdef0123456789abcdef"));
        assert!(!valid_account_id("*"));
        assert!(valid_script_name("izumi-sync-a1b2"));
        assert!(!valid_script_name("izumi_sync"));
        assert!(valid_database_id("01234567-89ab-cdef-0123-456789abcdef"));
        assert!(!valid_database_id("../../another-database"));
    }

    fn update_target() -> CloudflareDeploymentTarget {
        CloudflareDeploymentTarget {
            account_id: "0123456789abcdef0123456789abcdef".into(),
            script_name: "izumi-sync-test".into(),
            database_id: "01234567-89ab-cdef-0123-456789abcdef".into(),
        }
    }

    #[tokio::test]
    async fn update_applies_only_pending_migrations_and_a_second_pass_is_empty() {
        let previous_count = MIGRATIONS.len() - 2;
        let recorded = |count| json!({"success": true, "result": [{"success": true,
            "results": MIGRATIONS[..count].iter().map(|(name, _)| json!({"name": name})).collect::<Vec<_>>() }]});
        let ok = (StatusCode::OK, json!({"success": true, "result": [{"success": true, "results": []}]}));
        let mut replies = vec![ok.clone(), (StatusCode::OK, recorded(previous_count))];
        replies.extend(vec![ok.clone(); 4]);
        replies.extend([ok, (StatusCode::OK, recorded(MIGRATIONS.len()))]);
        let (api, requests, server) = mock_api(replies).await;
        apply_migrations(&api, &update_target()).await.unwrap();
        apply_migrations(&api, &update_target()).await.unwrap();
        server.abort();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 8);
        for (index, (name, source)) in MIGRATIONS[previous_count..].iter().enumerate() {
            let query: Value = serde_json::from_str(&requests[2 + index * 2].2).unwrap();
            assert_eq!(query["sql"].as_str().unwrap(), *source);
            let marker: Value = serde_json::from_str(&requests[3 + index * 2].2).unwrap();
            assert!(marker["sql"].as_str().unwrap().contains(name));
        }
    }

    #[tokio::test]
    async fn failed_sql_result_never_records_migration_or_replaces_existing_worker() {
        let (api, requests, server) = mock_api(vec![
            (StatusCode::OK, json!({"success": true, "result": {"uuid": update_target().database_id}})),
            (StatusCode::OK, json!({"success": true, "result": [{"success": true, "results": []}]})),
            (StatusCode::OK, json!({"success": true, "result": [{"success": true, "results": []}]})),
            (StatusCode::OK, json!({"success": true, "result": [{"success": false, "error": "SQL failed"}]})),
        ]).await;
        let target = update_target();
        let result = deploy_worker_with_api(api, target.account_id.clone(), None, Some(target)).await;
        server.abort();
        assert!(result.unwrap_err().contains("Worker was not replaced"));
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 4);
        assert!(requests.iter().all(|(method, path, body)|
            *method != Method::DELETE && !path.contains("/workers/") && !body.contains("INSERT INTO izumi_deploy_migrations")));
    }

    #[tokio::test]
    async fn worker_update_schedule_preserves_existing_triggers_and_is_idempotent() {
        let (api, requests, server) = mock_api(vec![
            (StatusCode::OK, json!({"success": true, "result": {"schedules": [{"cron": "0 0 * * *", "created_on": "ignored"}]}})),
            (StatusCode::OK, json!({"success": true})),
            (StatusCode::OK, json!({"success": true, "result": {"schedules": [{"cron": "0 0 * * *"}, {"cron": "17 */6 * * *"}]}})),
        ]).await;
        ensure_worker_update_schedule(&api, &update_target()).await.unwrap();
        ensure_worker_update_schedule(&api, &update_target()).await.unwrap();
        server.abort();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[1].0, Method::PUT);
        assert_eq!(serde_json::from_str::<Value>(&requests[1].2).unwrap(), json!([{"cron": "0 0 * * *"}, {"cron": "17 */6 * * *"}]));
    }

    #[tokio::test]
    async fn preview_upload_never_retains_temporary_deployment_access() {
        let (mut api, requests, server) = mock_api(vec![(StatusCode::OK, json!({"success": true}))]).await;
        api.retain_update_access = false;
        assert!(!CloudflareApi::new_preview("p".repeat(40)).unwrap().retain_update_access);
        upload_worker(&api, &update_target(), Some("temporary-bootstrap-value")).await.unwrap();
        ensure_worker_update_schedule(&api, &update_target()).await.unwrap();
        server.abort();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let metadata = requests[0].2.split("\r\n\r\n").nth(1).unwrap().split("\r\n").next().unwrap();
        let metadata: Value = serde_json::from_str(metadata).unwrap();
        assert_eq!(metadata["bindings"].as_array().unwrap().len(), 2);
        assert!(!metadata.to_string().contains("WORKER_UPDATE_AUTH"));
    }

    #[tokio::test]
    async fn update_upload_keeps_database_binding_without_recreating_bootstrap_credentials() {
        let (api, requests, server) = mock_api(vec![
            (StatusCode::OK, json!({"success": true})),
        ]).await;
        let target = update_target();
        upload_worker(&api, &target, None).await.unwrap();
        server.abort();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].0, Method::PUT);
        assert!(requests[0].1.ends_with(&format!("/workers/scripts/{}", target.script_name)));
        // Inspect the metadata part only: the uploaded program also mentions the binding name.
        let metadata = requests[0].2.split("\r\n\r\n").nth(1).unwrap().split("\r\n").next().unwrap();
        let metadata: Value = serde_json::from_str(metadata).unwrap();
        assert_eq!(metadata["bindings"][0], json!({"type": "d1", "name": "DB", "id": target.database_id}));
        assert_eq!(metadata["bindings"][1]["name"], "WORKER_UPDATE_AUTH");
        assert_eq!(metadata["bindings"][1]["type"], "secret_text");
        let access: Value = serde_json::from_str(metadata["bindings"][1]["text"].as_str().unwrap()).unwrap();
        assert_eq!(access["accountId"], target.account_id);
        assert_eq!(access["scriptName"], target.script_name);
        assert_eq!(access["databaseId"], target.database_id);
        assert_eq!(access["apiToken"], api.token);
        assert_eq!(metadata["bindings"].as_array().unwrap().len(), 2);
        assert_eq!(metadata["keep_bindings"], json!(["secret_text", "plain_text"]));
    }

    #[tokio::test]
    async fn readiness_waits_for_the_bundled_version_and_protocol() {
        let manifest: Value = serde_json::from_str(include_str!("../../cloudflare-sync-worker/package.json")).unwrap();
        let current = json!({"app": "izumi-sync", "version": manifest["version"], "protocol": 1});
        let (api, requests, server) = mock_api(vec![
            (StatusCode::OK, json!({"app": "izumi-sync", "version": "0.0.0", "protocol": 1})),
            (StatusCode::OK, json!({"app": "izumi-sync", "version": manifest["version"], "protocol": 99})),
            (StatusCode::OK, current),
        ]).await;
        wait_for_worker_with_retry(&api.api_root, 3, Duration::ZERO).await.unwrap();
        server.abort();
        assert_eq!(requests.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn readiness_fails_when_only_the_old_version_is_live() {
        let (api, requests, server) = mock_api(vec![
            (StatusCode::OK, json!({"app": "izumi-sync", "version": "0.0.0", "protocol": 1})); 2
        ]).await;
        let result = wait_for_worker_with_retry(&api.api_root, 2, Duration::ZERO).await;
        server.abort();
        assert!(result.unwrap_err().contains("expected version is not available"));
        assert_eq!(requests.lock().unwrap().len(), 2);
    }

    #[test]
    fn preview_challenge_solver_returns_every_checkpoint() {
        let challenge = PreviewChallenge {
            challenge_token: "test".into(),
            seed: general_purpose::URL_SAFE_NO_PAD.encode([0u8; 32]),
            k: 2,
            g: 3,
        };
        let solution = solve_preview_challenge(&challenge).unwrap();
        assert_eq!(
            general_purpose::STANDARD.decode(solution).unwrap().len(),
            3 * 32
        );
    }
}
