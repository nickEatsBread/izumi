/// AppKit is bottom-left origin. Convert physical-pixel insets (the frontend already
/// multiplied by devicePixelRatio) into a content-view frame in points. Right and bottom
/// insets come from a theme's docked watch layout; they are 0 for the full-container player.
pub fn player_area_points(
    content_w: f64,
    content_h: f64,
    left_px: i32,
    top_px: i32,
    right_px: i32,
    bottom_px: i32,
    scale: f64,
) -> (f64, f64, f64, f64) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let left = (left_px as f64 / scale).max(0.0);
    let top = (top_px as f64 / scale).max(0.0);
    let right = (right_px as f64 / scale).max(0.0);
    let bottom = (bottom_px as f64 / scale).max(0.0);
    let width = (content_w - left - right).max(1.0);
    let height = (content_h - top - bottom).max(1.0);
    // The frame's y is measured from the window's bottom edge, so a bottom inset lifts it.
    (left, bottom.min((content_h - 1.0).max(0.0)), width, height)
}

#[cfg(test)]
mod tests {
    use super::player_area_points;

    #[test]
    fn windowed_sidebar_sits_to_the_right_of_the_inset() {
        let (x, y, w, h) = player_area_points(800.0, 600.0, 112, 0, 0, 0, 2.0);
        assert_eq!((x, y), (56.0, 0.0));
        assert_eq!((w, h), (744.0, 600.0));
    }

    #[test]
    fn top_inset_shrinks_height_from_the_top() {
        let (x, y, w, h) = player_area_points(800.0, 600.0, 0, 80, 0, 0, 1.0);
        assert_eq!((x, y), (0.0, 0.0));
        assert_eq!((w, h), (800.0, 520.0));
    }

    #[test]
    fn fullscreen_zero_insets_fill_the_content_view() {
        let (x, y, w, h) = player_area_points(1920.0, 1080.0, 0, 0, 0, 0, 2.0);
        assert_eq!((x, y, w, h), (0.0, 0.0, 1920.0, 1080.0));
    }

    #[test]
    fn docked_stage_lifts_the_frame_by_the_bottom_inset() {
        // A 16:9 stage 56pt from the left, 76pt from the top, with a 300pt episode rail on the
        // right and 124pt of page below it (all doubled for a Retina display).
        let (x, y, w, h) = player_area_points(1280.0, 800.0, 112, 152, 600, 248, 2.0);
        assert_eq!((x, y), (56.0, 124.0));
        assert_eq!((w, h), (924.0, 600.0));
    }

    #[test]
    fn oversized_insets_never_produce_an_empty_frame() {
        let (_, _, w, h) = player_area_points(400.0, 300.0, 500, 400, 500, 400, 1.0);
        assert_eq!((w, h), (1.0, 1.0));
    }
}
