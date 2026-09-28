//! Runtime sidecars wait until a direct-P2P video has finished opening.
//!
//! mpv applies `network-timeout` to every stream it opens while the option is set. A direct-P2P
//! video opens with the timeout disabled (see `load_file`), and the event loop restores the normal
//! value at FileLoaded. A sidecar (`sub-add` of a URL) opened before then would inherit the
//! unbounded read. Runtime `sub-add` also holds the player lock until its read ends, so a single
//! stalled subtitle could block every player command, stop included, until pieces or a server
//! reply arrive.

use std::{future::Future, sync::Arc};

use tokio::sync::watch;

#[derive(Clone, Copy)]
struct GateState {
    /// Bumped whenever a new file replaces the current one, or the player closes.
    file: u64,
    /// False while a direct-P2P video is opening without a read timeout.
    open: bool,
}

#[derive(Clone)]
pub(crate) struct SidecarGate(Arc<watch::Sender<GateState>>);

impl SidecarGate {
    pub(crate) fn new() -> Self {
        let (sender, _) = watch::channel(GateState {
            file: 0,
            open: true,
        });
        Self(Arc::new(sender))
    }

    /// A new file replaces the current one. A stall-tolerant file holds sidecars until it loads.
    /// Closing the player passes `false`, which refuses anything still waiting for the old file.
    pub(crate) fn begin_file(&self, stall_tolerant: bool) {
        self.0.send_modify(|state| {
            state.file += 1;
            state.open = !stall_tolerant;
        });
    }

    /// The current file has loaded and mpv's normal read timeout is back.
    pub(crate) fn file_loaded(&self) {
        self.0
            .send_if_modified(|state| !std::mem::replace(&mut state.open, true));
    }

    /// Resolves once sidecars may open for the file that is current when this is called. Errors
    /// if another file replaces that one first.
    pub(crate) fn ready(&self) -> impl Future<Output = Result<(), String>> + Send + 'static {
        let mut state = self.0.subscribe();
        let file = state.borrow().file;
        async move {
            let now = *state
                .wait_for(|state| state.open || state.file != file)
                .await
                .map_err(|_| "The player is gone.".to_string())?;
            if now.file == file {
                Ok(())
            } else {
                Err("The video changed before this subtitle could load.".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SidecarGate;
    use std::time::Duration;
    use tokio::time::timeout;

    /// Long enough for a gate that is wrongly open to resolve, short enough to keep the suite fast.
    const STILL_WAITING: Duration = Duration::from_millis(50);

    #[tokio::test]
    async fn ordinary_files_never_hold_sidecars() {
        let gate = SidecarGate::new();
        gate.begin_file(false);
        assert_eq!(gate.ready().await, Ok(()));
    }

    #[tokio::test]
    async fn sidecars_wait_for_a_direct_p2p_video_to_load() {
        let gate = SidecarGate::new();
        gate.begin_file(true);
        let mut ready = Box::pin(gate.ready());
        assert!(
            timeout(STILL_WAITING, &mut ready).await.is_err(),
            "a sidecar started while the video was still opening"
        );
        gate.file_loaded();
        assert_eq!(ready.await, Ok(()));
    }

    #[tokio::test]
    async fn each_direct_p2p_video_holds_sidecars_until_its_own_load() {
        let gate = SidecarGate::new();
        gate.begin_file(true);
        gate.file_loaded();
        gate.begin_file(true);
        assert!(timeout(STILL_WAITING, gate.ready()).await.is_err());
    }

    #[tokio::test]
    async fn sidecars_of_a_replaced_video_are_refused() {
        let gate = SidecarGate::new();
        gate.begin_file(true);
        let ready = gate.ready();
        // A source switch, the next episode or closing the player replaces the file before it
        // loaded. Its waiting sidecars belong to the old video and must not attach to the new one.
        gate.begin_file(false);
        assert!(ready.await.is_err());
    }
}
