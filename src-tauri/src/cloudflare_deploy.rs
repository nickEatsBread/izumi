use base64::{engine::general_purpose, Engine as _};
use reqwest::{multipart, Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::time::Duration;

const API_ROOT: &str = "https://api.cloudflare.com/client/v4";
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
        Ok(Self { client, token })
    }

    fn request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{API_ROOT}{path}"))
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
        let bytes = response.bytes().await.map_err(network_error)?;
        let envelope: ApiEnvelope<Value> = serde_json::from_slice(&bytes)
            .map_err(|_| format!("Cloudflare returned an unreadable response ({status})."))?;
        if status.is_success() && envelope.success {
            Ok(())
        } else {
            Err(api_error(status, &envelope.errors))
        }
    }
}

async fn parse_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, String> {
    let status = response.status();
    let bytes = response.bytes().await.map_err(network_error)?;
    let envelope: ApiEnvelope<T> = serde_json::from_slice(&bytes)
        .map_err(|_| format!("Cloudflare returned an unreadable response ({status})."))?;
    if !status.is_success() || !envelope.success {
        return Err(api_error(status, &envelope.errors));
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

fn api_error(status: StatusCode, errors: &[ApiMessage]) -> String {
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
        format!("Cloudflare rejected the request ({status}).")
    } else {
        format!("Cloudflare: {details}")
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

fn sql_statements(source: &str) -> impl Iterator<Item = &str> {
    source.split(';').map(str::trim).filter(|statement| {
        statement.lines().any(|line| {
            let line = line.trim();
            !line.is_empty() && !line.starts_with("--")
        })
    })
}

async fn d1_query(
    api: &CloudflareApi,
    account_id: &str,
    database_id: &str,
    sql: &str,
) -> Result<Value, String> {
    api.json(
        api.request(
            Method::POST,
            &format!("/accounts/{account_id}/d1/database/{database_id}/query"),
        )
        .json(&json!({ "sql": sql })),
    )
    .await
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
        for statement in sql_statements(source) {
            d1_query(api, &target.account_id, &target.database_id, statement).await?;
        }
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
    if let Ok(existing) = api
        .json::<WorkersSubdomain>(api.request(Method::GET, &path))
        .await
    {
        return Ok(existing.subdomain);
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
    let metadata = json!({
        "main_module": "worker.mjs",
        "bindings": bindings,
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
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..20 {
        if let Ok(response) = client.get(format!("{endpoint}/v1/status")).send().await {
            if response.status().is_success() {
                if let Ok(status) = response.json::<Value>().await {
                    if status.get("app").and_then(Value::as_str) == Some("izumi-sync") {
                        return Ok(());
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("The Worker was uploaded, but its workers.dev address is not ready yet. Wait a moment and try again.".into())
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
    let api = CloudflareApi::new(api_token)?;
    let is_new = existing.is_none();

    let target = if let Some(target) = existing {
        if target.account_id != account_id
            || !valid_account_id(&target.account_id)
            || !valid_script_name(&target.script_name)
            || !valid_database_id(&target.database_id)
        {
            return Err("The saved Cloudflare deployment details are invalid.".into());
        }
        target
    } else {
        // A random suffix avoids ever replacing an unrelated Worker or a previous Izumi setup.
        let script_name = format!("izumi-sync-{}", random_suffix()?);
        let database: D1Database = api
            .json(
                api.request(Method::POST, &format!("/accounts/{account_id}/d1/database"))
                    .json(&json!({ "name": format!("{script_name}-db") })),
            )
            .await?;
        CloudflareDeploymentTarget {
            account_id: account_id.clone(),
            script_name,
            database_id: database
                .uuid
                .ok_or_else(|| "Cloudflare created D1 without returning its ID.".to_string())?,
        }
    };

    let deployment = async {
        // Also proves that a saved database still exists before an update can replace the Worker.
        let _: D1Database = api
            .json(api.request(
                Method::GET,
                &format!(
                    "/accounts/{}/d1/database/{}",
                    target.account_id, target.database_id
                ),
            ))
            .await?;
        apply_migrations(&api, &target).await?;
        let subdomain = ensure_workers_subdomain(&api, &target.account_id).await?;
        upload_worker(&api, &target, secret).await?;
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
    let deployed = cloudflare_deploy_worker(
        preview.account.api_token,
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

    #[test]
    fn direct_upload_bundle_is_generated_and_current() {
        assert!(WORKER_BUNDLE.starts_with("// izumi-cloudflare-source-sha256:"));
        assert!(WORKER_BUNDLE.contains("izumi-sync"));
        assert!(WORKER_BUNDLE.len() > 100_000);
    }

    #[test]
    fn migration_splitter_keeps_executable_statements() {
        let statements = sql_statements(MIGRATIONS[0].1).collect::<Vec<_>>();
        assert!(statements
            .iter()
            .any(|statement| statement.contains("CREATE TABLE metadata")));
        assert!(statements
            .iter()
            .any(|statement| statement.contains("CREATE TABLE devices")));
        assert!(statements.len() >= 7);
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
