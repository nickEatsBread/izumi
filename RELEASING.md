# Releasing izumi

Binaries are built in CI and published as **GitHub Releases**. The app auto-updates via
a signed [Tauri updater](https://tauri.app/plugin/updater/), with a **failover** mirror
(`anmw-prod-distnet.quack.si`) for when GitHub is unreachable.

- **Stable channel** → newest normal release (`v1.2.3`).
  - primary: `https://github.com/nickEatsBread/izumi/releases/latest/download/latest.json`
  - failover: `https://anmw-prod-distnet.quack.si/stable/latest.json`
- **Beta channel** → a single **rolling `beta` pre-release** CI overwrites each beta build.
  - primary: `https://github.com/nickEatsBread/izumi/releases/download/beta/latest.json`
  - failover: `https://anmw-prod-distnet.quack.si/beta/latest.json`

Any tag containing `-` (e.g. `v1.3.0-beta.1`) is a beta.

**Failover security headers.** Every updater request carries two headers (set in
`build_updater`, `src-tauri/src/lib.rs`) that the failover Worker validates:
`repository: izumi` and `key: <stable|beta>` (matching the requested channel). GitHub
ignores them; the Worker returns `403` if they're missing/wrong.

---

## One-time setup

1. **Create the GitHub repo** (public) and push:
   ```sh
   git remote add origin https://github.com/nickEatsBread/izumi.git
   git push -u origin main
   ```

2. **Generate the updater signing key** (keep the private key secret — never commit it):
   ```sh
   npm run tauri signer generate -- -w izumi_updater.key
   ```
   - Public key → `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
     (replace `REPLACE_WITH_YOUR_TAURI_UPDATER_PUBLIC_KEY`).
   - Private key + password → GitHub Actions **secrets**
     `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

3. **Repo slug** is `nickEatsBread/izumi`, already wired in 3 spots (update on a rename):
   - `src-tauri/tauri.conf.json` → `plugins.updater.endpoints`
   - `src-tauri/src/lib.rs` → `updater_endpoints()` `REPO`
   - `distnet/wrangler.toml` → `GH_REPO`

4. **Deploy the failover Worker**:
   ```sh
   cd distnet
   npx wrangler deploy
   ```
   Map `anmw-prod-distnet.quack.si` to it (Cloudflare dashboard → the Worker → Custom
   Domain). Test it (must pass the headers):
   ```sh
   curl -H 'repository: izumi' -H 'key: stable' https://anmw-prod-distnet.quack.si/stable/latest.json
   ```

5. **Commit `.env`** (public OAuth client IDs) so the CI frontend build has the
   `PUBLIC_*` vars — they are not secrets.

6. **Windows libmpv in CI**: the `.github/workflows/release.yml` Windows step downloads a
   libmpv dev build, generates `mpv.lib`, and bundles `libmpv-2.dll`. Pin it to the exact
   libmpv build your local setup uses (see your windows-build-env notes) and make sure
   `libmpv-2.dll` ends up beside the installed binary.

## Cutting a release

1. Bump the version in **all three** (keep in sync):
   - `src-tauri/tauri.conf.json` → `version`
   - `package.json` → `version`
   - `src-tauri/Cargo.toml` → `version`

   For a beta, use a pre-release version (e.g. `0.3.0-beta.1`) — the updater compares
   semver, so beta testers get each new pre-release.
2. Commit, then tag and push:
   ```sh
   # stable
   git tag v0.3.0 && git push origin v0.3.0
   # beta (goes to the rolling `beta` pre-release)
   git tag v0.3.0-beta.1 && git push origin v0.3.0-beta.1
   ```
3. CI (`release.yml`) creates the release (deleting the old rolling `beta` first for
   betas), builds Windows / Linux (AppImage) / macOS (universal), uploads signed
   artifacts + a merged `latest.json`, then publishes it.

## How the app updates

Settings → **About** → **Updates**: pick the **Release channel** (Stable / Beta) and
**Check for updates**. The Rust `updater_check` / `updater_install` commands
(`src-tauri/src/lib.rs`) check GitHub first, fall through to the distnet failover if it's
down, verify the signature against the embedded public key, install, and relaunch.
