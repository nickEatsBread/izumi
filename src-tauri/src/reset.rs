use tauri::{AppHandle, Manager, WebviewWindow};

#[cfg(not(target_os = "android"))]
fn allowed_reset_names(app: &AppHandle) -> Vec<String> {
    let identifier = app.config().identifier.clone();
    let mut names = vec![identifier.clone()];
    if let Some(product_name) = app.config().product_name.clone() {
        if product_name != identifier {
            names.push(product_name);
        }
    }
    #[cfg(target_os = "macos")]
    names.push(crate::desktop_webview::macos_webview_store_uuid(&identifier));
    names
}

#[cfg(not(target_os = "android"))]
fn directories(app: &AppHandle) -> Result<Vec<std::path::PathBuf>, tauri::Error> {
    let mut roots = vec![
        app.path().app_config_dir()?,
        app.path().app_data_dir()?,
        app.path().app_local_data_dir()?,
        app.path().app_cache_dir()?,
        app.path().app_log_dir()?,
    ];
    // WKWebView also uses system-managed directories outside Application Support/Caches.
    #[cfg(target_os = "macos")]
    {
        let library = app.path().home_dir()?.join("Library");
        let identifier = &app.config().identifier;
        for parent in ["WebKit", "HTTPStorages"] {
            roots.push(library.join(parent).join(identifier));
        }
        if let Some(product_name) = app.config().product_name.as_ref() {
            if product_name != identifier {
                for parent in ["WebKit", "HTTPStorages"] {
                    roots.push(library.join(parent).join(product_name));
                }
            }
        }
        roots.push(crate::desktop_webview::macos_website_data_store_dir(
            &library,
            identifier,
        ));
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

/// Register before window-state and other plugins, before any WebView/database can be opened.
#[cfg(not(target_os = "android"))]
pub fn startup_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("local-reset")
        .setup(|app, _| {
            let marker = app.path().app_config_dir()?.join(crate::reset_data::MARKER);
            if !marker.try_exists()? {
                return Ok(());
            }
            let roots = directories(app)?;
            let allowed = allowed_reset_names(app);
            let allowed: Vec<&str> = allowed.iter().map(String::as_str).collect();
            // WebView2 child processes can briefly retain file locks after their parent exits.
            let mut attempts = 0;
            loop {
                match crate::reset_data::clear_app_directories(&roots, &marker, &allowed) {
                    Ok(()) => break,
                    Err(_) if attempts < 20 => {
                        attempts += 1;
                        std::thread::sleep(std::time::Duration::from_millis(250));
                    }
                    Err(error) => return Err(format!("Local reset could not finish; close remaining izumi and extension service processes and reopen the app: {error}").into()),
                }
            }
            #[cfg(target_os = "macos")]
            {
                let cookies_dir = app.path().home_dir()?.join("Library/Cookies");
                let mut cookie_files = vec![format!("{}.binarycookies", app.config().identifier)];
                if let Some(product_name) = app.config().product_name.as_ref() {
                    if product_name != &app.config().identifier {
                        cookie_files.push(format!("{product_name}.binarycookies"));
                    }
                }
                for file in cookie_files {
                    match std::fs::remove_file(cookies_dir.join(file)) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
            }
            std::fs::remove_file(marker)?;
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn reset_local_data(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || window.url().map_err(|error| error.to_string())?.path() != "/reset.html"
    {
        return Err("Start a reset from Settings → About.".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_extplayer::ExtPlayerExt;
        // Android owns all app-private storage, including WebView data, preferences and runtime
        // databases. Its system reset stops this process before deleting it all.
        app.extplayer()
            .reset_local_data()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let roots = directories(&app).map_err(|error| error.to_string())?;
        let allowed = allowed_reset_names(&app);
        let allowed: Vec<&str> = allowed.iter().map(String::as_str).collect();
        crate::reset_data::validate_roots(&roots, &allowed)
            .map_err(|error| error.to_string())?;
        let config = app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&config).map_err(|error| error.to_string())?;
        // Sync the intent to disk before stopping anything. Deletion happens in the NEXT process;
        // background downloads, sync and persisted stores cannot recreate old data afterward.
        let marker = std::fs::File::create(config.join(crate::reset_data::MARKER))
            .map_err(|error| error.to_string())?;
        marker.sync_all().map_err(|error| error.to_string())?;
        crate::jvm_extensions::jvm_extension_reload(app.state()).await?;
        crate::extension_service::stop_all(app.state()).await?;
        app.request_restart();
        Ok(())
    }
}
