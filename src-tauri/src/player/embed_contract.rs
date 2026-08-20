//! Shared `player_embed` success rule.
//!
//! Isolated from libmpv so Windows CI can test it without `mpv.lib`.

/// `player_embed` reports Ok only when a live core exists. Returning Ok without one
/// is the macOS infinite-spinner bug: the overlay mounts, `player_command` fails
/// with "no player", and nothing ever paints a frame.
pub fn require_live_core(has_core: bool) -> Result<(), String> {
    if has_core {
        Ok(())
    } else {
        Err("player failed to start".into())
    }
}

#[cfg(test)]
mod tests {
    use super::require_live_core;

    #[test]
    fn hollow_embed_is_an_error() {
        assert_eq!(
            require_live_core(false),
            Err("player failed to start".to_string())
        );
    }

    #[test]
    fn live_core_is_ok() {
        assert_eq!(require_live_core(true), Ok(()));
    }
}
