/// AppKit is bottom-left origin. Convert physical-pixel insets (the frontend already
/// multiplied by devicePixelRatio) into a content-view frame in points.
pub fn player_area_points(
    content_w: f64,
    content_h: f64,
    left_px: i32,
    top_px: i32,
    scale: f64,
) -> (f64, f64, f64, f64) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let left = (left_px as f64 / scale).max(0.0);
    let top = (top_px as f64 / scale).max(0.0);
    let width = (content_w - left).max(1.0);
    let height = (content_h - top).max(1.0);
    (left, 0.0, width, height)
}

#[cfg(test)]
mod tests {
    use super::player_area_points;

    #[test]
    fn windowed_sidebar_sits_to_the_right_of_the_inset() {
        let (x, y, w, h) = player_area_points(800.0, 600.0, 112, 0, 2.0);
        assert_eq!((x, y), (56.0, 0.0));
        assert_eq!((w, h), (744.0, 600.0));
    }

    #[test]
    fn top_inset_shrinks_height_from_the_top() {
        let (x, y, w, h) = player_area_points(800.0, 600.0, 0, 80, 1.0);
        assert_eq!((x, y), (0.0, 0.0));
        assert_eq!((w, h), (800.0, 520.0));
    }

    #[test]
    fn fullscreen_zero_insets_fill_the_content_view() {
        let (x, y, w, h) = player_area_points(1920.0, 1080.0, 0, 0, 2.0);
        assert_eq!((x, y, w, h), (0.0, 0.0, 1920.0, 1080.0));
    }
}
