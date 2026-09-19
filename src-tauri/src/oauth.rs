//! Desktop OAuth window lifecycle shared by MyAnimeList and AniList.

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;
use url::{Position, Url};

type LoginResult = Result<String, String>;
static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn next_window_label() -> String {
    // Closing a Tauri window only queues its teardown. Never reuse its label or close a
    // different attempt's window: retries and simultaneous providers must stay independent.
    format!("oauth-{}", NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed))
}

struct LoginCapture {
    redirect: Url,
    sender: Mutex<Option<oneshot::Sender<LoginResult>>>,
}

impl LoginCapture {
    fn new(redirect: Url) -> (Arc<Self>, oneshot::Receiver<LoginResult>) {
        let (sender, receiver) = oneshot::channel();
        (
            Arc::new(Self {
                redirect,
                sender: Mutex::new(Some(sender)),
            }),
            receiver,
        )
    }

    fn finish(&self, result: LoginResult) {
        // Navigation/page-load/close events can arrive together. The first terminal event
        // wins, so destroying a completed login cannot overwrite its captured credentials.
        if let Some(sender) = self.sender.lock().unwrap().take() {
            let _ = sender.send(result);
        }
    }

    fn capture_redirect(&self, url: &Url) -> bool {
        // Match the endpoint exactly, retaining the complete query and fragment in the result.
        // A string prefix also accepts /callback-other and similarly named hosts.
        if url[..Position::AfterPath] != self.redirect[..Position::AfterPath]
            || !self
                .redirect
                .query_pairs()
                .all(|pair| url.query_pairs().any(|candidate| candidate == pair))
        {
            return false;
        }
        self.finish(Ok(url.to_string()));
        true
    }

    fn closed(&self) {
        self.finish(Err("Login window was closed.".into()));
    }
}

struct LoginWindow(WebviewWindow);

impl Drop for LoginWindow {
    fn drop(&mut self) {
        // Also clean up after a timeout, show failure, or cancelled command future.
        let _ = self.0.destroy();
    }
}

async fn wait_for_redirect(
    receiver: oneshot::Receiver<LoginResult>,
    timeout: Duration,
) -> LoginResult {
    tokio::time::timeout(timeout, receiver)
        .await
        .map_err(|_| "Login timed out.".to_string())?
        .map_err(|_| "Login window is no longer available.".to_string())?
}

pub(crate) async fn capture(
    app: &tauri::AppHandle,
    auth_url: &str,
    redirect_uri: &str,
) -> LoginResult {
    let url = Url::parse(auth_url).map_err(|_| "invalid auth url".to_string())?;
    let redirect = Url::parse(redirect_uri).map_err(|_| "invalid redirect url".to_string())?;
    let (capture, receiver) = LoginCapture::new(redirect);
    let navigation = capture.clone();
    let page_load = capture.clone();
    let win = crate::desktop_webview::isolate_webview_data(
        WebviewWindowBuilder::new(app, next_window_label(), WebviewUrl::External(url))
            .additional_browser_args(crate::desktop_webview::DESKTOP_WEBVIEW_ARGS)
            .title("Sign in")
            .inner_size(520.0, 760.0)
            // Register cancellation before the user can close the window.
            .visible(false)
            .on_navigation(move |url| {
                // Capture before loading the callback site, even if that site is unavailable.
                !navigation.capture_redirect(url)
            })
            .on_page_load(move |_window, payload| {
                page_load.capture_redirect(payload.url());
            }),
        &app.config().identifier,
    )
    .build()
    .map_err(|error| error.to_string())?;
    let _cleanup = LoginWindow(win.clone());
    win.on_window_event(move |event| {
        // A URL read can fail during startup/navigation while the window is still alive.
        // Only actual destruction means the user lost the login window.
        if matches!(event, WindowEvent::Destroyed) {
            capture.closed();
        }
    });
    win.show().map_err(|error| error.to_string())?;
    let _ = win.set_focus();
    wait_for_redirect(receiver, Duration::from_secs(300)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn login() -> (Arc<LoginCapture>, oneshot::Receiver<LoginResult>) {
        LoginCapture::new(Url::parse("https://client.izumi.watch/callback").unwrap())
    }

    #[test]
    fn startup_and_provider_navigation_keep_login_pending() {
        let (capture, mut receiver) = login();
        for url in [
            "about:blank",
            "https://myanimelist.net/v1/oauth2/authorize?response_type=code",
            "https://myanimelist.net/login.php",
            "https://myanimelist.net/v1/oauth2/authorize?response_type=code",
        ] {
            assert!(!capture.capture_redirect(&Url::parse(url).unwrap()));
            assert_eq!(
                receiver.try_recv(),
                Err(oneshot::error::TryRecvError::Empty)
            );
        }
    }

    #[tokio::test]
    async fn captures_code_token_and_denial_before_callback_page_loads() {
        for suffix in [
            "?code=mal-code&state=attempt",
            "#access_token=anilist-token&token_type=Bearer",
            "?error=access_denied",
        ] {
            let (capture, receiver) = login();
            let url = Url::parse(&format!("https://client.izumi.watch/callback{suffix}")).unwrap();
            assert!(capture.capture_redirect(&url));
            capture.closed();
            // Duplicate page-load notifications must not change the first result.
            assert!(capture.capture_redirect(&url));
            assert_eq!(receiver.await.unwrap(), Ok(url.to_string()));
        }
    }

    #[test]
    fn similar_urls_are_not_callbacks() {
        let (capture, mut receiver) = login();
        for url in [
            "https://client.izumi.watch/callback-other?code=wrong",
            "https://client.izumi.watch.evil.test/callback?code=wrong",
            "http://client.izumi.watch/callback?code=wrong",
            "https://client.izumi.watch:444/callback?code=wrong",
            "https://user@client.izumi.watch/callback?code=wrong",
        ] {
            assert!(!capture.capture_redirect(&Url::parse(url).unwrap()));
        }
        assert_eq!(
            receiver.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        );
    }

    #[tokio::test]
    async fn registered_query_parameters_must_survive_the_redirect() {
        let (capture, receiver) = LoginCapture::new(
            Url::parse("https://client.izumi.watch/callback?provider=mal").unwrap(),
        );
        assert!(!capture.capture_redirect(
            &Url::parse("https://client.izumi.watch/callback?code=wrong").unwrap()
        ));
        let url =
            Url::parse("https://client.izumi.watch/callback?code=right&provider=mal").unwrap();
        assert!(capture.capture_redirect(&url));
        assert_eq!(receiver.await.unwrap(), Ok(url.to_string()));
    }

    #[tokio::test]
    async fn closing_one_attempt_does_not_cancel_another_or_its_retry() {
        let (first, first_result) = login();
        let (second, mut second_result) = login();
        first.closed();
        assert_eq!(
            first_result.await.unwrap(),
            Err("Login window was closed.".into())
        );
        assert_eq!(
            second_result.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        );

        let (retry, retry_result) = login();
        // Delayed events from the old window cannot settle a newer attempt.
        first.closed();
        let url = Url::parse("https://client.izumi.watch/callback?code=retry").unwrap();
        retry.capture_redirect(&url);
        assert_eq!(retry_result.await.unwrap(), Ok(url.to_string()));
        second.closed();
        assert_eq!(
            second_result.await.unwrap(),
            Err("Login window was closed.".into())
        );
    }

    #[tokio::test]
    async fn an_idle_window_times_out_instead_of_reporting_it_closed() {
        let (_capture, receiver) = login();
        assert_eq!(
            wait_for_redirect(receiver, Duration::from_millis(1)).await,
            Err("Login timed out.".into())
        );
    }

    #[test]
    fn retries_never_reuse_a_window_label() {
        let first = next_window_label();
        let second = next_window_label();
        let retry = next_window_label();
        assert_ne!(first, "oauth");
        assert_ne!(first, second);
        assert_ne!(first, retry);
        assert_ne!(second, retry);
    }
}
