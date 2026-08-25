//! GIF playback rate from captured frames.
//!
//! Image sequences must play back at the rate they were *taken*. Encoding at the
//! requested 12–24 fps when compositor/mpv only delivered 4 fps is fast-forward.

pub fn gif_playback_fps(frame_count: usize, captured_ms: u64, requested: f64) -> f64 {
    let requested = if requested.is_finite() && requested > 0.0 {
        requested.clamp(2.0, 30.0)
    } else {
        12.0
    };
    if frame_count == 0 {
        return requested;
    }
    if captured_ms < 80 {
        return requested;
    }
    let actual = frame_count as f64 / (captured_ms as f64 / 1000.0);
    // Sparse compatibility captures must still span the time the user recorded. GIF delays can
    // represent sub-2 fps playback, so imposing a 2 fps floor would incorrectly fast-forward it.
    actual.clamp(0.1, requested)
}

#[cfg(test)]
mod tests {
    use super::gif_playback_fps;

    #[test]
    fn slow_capture_stays_realtime() {
        assert!((gif_playback_fps(8, 2000, 15.0) - 4.0).abs() < 0.01);
        assert!((gif_playback_fps(3, 2000, 24.0) - 1.5).abs() < 0.01);
        assert!((gif_playback_fps(4, 10000, 24.0) - 0.4).abs() < 0.01);
    }

    #[test]
    fn full_rate_capture_keeps_target() {
        assert!((gif_playback_fps(36, 3000, 12.0) - 12.0).abs() < 0.01);
        assert!((gif_playback_fps(30, 2000, 15.0) - 15.0).abs() < 0.01);
    }

    #[test]
    fn never_plays_faster_than_requested() {
        assert_eq!(gif_playback_fps(60, 1000, 15.0), 15.0);
        assert_eq!(gif_playback_fps(50, 1000, 12.0), 12.0);
    }
}
