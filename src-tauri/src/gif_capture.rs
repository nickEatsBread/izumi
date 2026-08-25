//! Crop a full-window compositor JPEG down to the playing video.
//!
//! Encrypted frames are only in the WebView2 compositor screenshot. The frontend
//! sends the CSS video rectangle + viewport; this maps that onto the JPEG (which
//! is device pixels, and may include a titlebar strip) and writes a lanczos-scaled
//! JPEG the GIF encoder can consume.

#[derive(Clone, Copy, Debug)]
pub struct ViewCrop {
    pub view_width: f64,
    pub view_height: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ViewCrop {
    pub fn from_parts(
        view_width: f64,
        view_height: f64,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Option<Self> {
        if ![view_width, view_height, x, y, width, height]
            .into_iter()
            .all(f64::is_finite)
            || view_width < 1.0
            || view_height < 1.0
            || width < 1.0
            || height < 1.0
        {
            return None;
        }
        Some(Self {
            view_width,
            view_height,
            x,
            y,
            width,
            height,
        })
    }
}

/// Same mapping as `mapScreenshotCrop` in the frontend.
pub fn map_screenshot_crop(
    image_width: u32,
    image_height: u32,
    crop: &ViewCrop,
) -> Option<(u32, u32, u32, u32)> {
    if image_width == 0 || image_height == 0 {
        return None;
    }
    let scale = image_width as f64 / crop.view_width;
    let extra_y = (image_height as f64 - crop.view_height * scale).max(0.0);
    let sx = (crop.x * scale).round().max(0.0) as u32;
    let sy = (extra_y + crop.y * scale).round().max(0.0) as u32;
    let sw = (crop.width * scale).round().max(1.0) as u32;
    let sh = (crop.height * scale).round().max(1.0) as u32;
    if sx >= image_width || sy >= image_height {
        return None;
    }
    let sw = sw.min(image_width - sx).max(1);
    let sh = sh.min(image_height - sy).max(1);
    Some((sx, sy, sw, sh))
}

/// Unencrypted file GIFs: denser sampling on a short hold so a 1–3s clip still
/// reads as motion, sparser on a long hold so a 15–30s GIF stays a clip.
pub fn gif_file_sample_fps(duration: f64) -> f64 {
    if !duration.is_finite() || duration <= 0.0 {
        return 16.0;
    }
    if duration <= 3.0 {
        24.0
    } else if duration <= 8.0 {
        16.0
    } else {
        15.0
    }
}

pub fn crop_compositor_jpeg(
    jpeg: &[u8],
    crop: Option<&ViewCrop>,
    out_width: u32,
) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(jpeg).map_err(|e| e.to_string())?;
    let rgb = img.to_rgb8();
    let (iw, ih) = rgb.dimensions();
    let cropped = if let Some(crop) = crop {
        let Some((sx, sy, sw, sh)) = map_screenshot_crop(iw, ih, crop) else {
            return Err("invalid-gif-crop".into());
        };
        image::imageops::crop_imm(&rgb, sx, sy, sw, sh).to_image()
    } else {
        rgb
    };
    if raster_is_solid_black_rgb(&cropped) {
        return Err("black-gif-frame".into());
    }
    let (cw, ch) = cropped.dimensions();
    let target_w = out_width.clamp(160, 1920).min(cw).max(1);
    let scaled = if target_w < cw {
        let target_h = ((ch as u64 * target_w as u64) / cw as u64).max(1) as u32;
        image::imageops::resize(
            &cropped,
            target_w,
            target_h,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        cropped
    };
    encode_jpeg(&scaled, 92)
}

/// Validate the first streamed compositor frame and resolve its CSS video rectangle to pixels.
/// Streaming capture can then persist subsequent JPEGs unchanged and defer the crop to ffmpeg,
/// avoiding a decode + encode on every frame while the user is recording.
pub fn inspect_compositor_jpeg(
    jpeg: &[u8],
    crop: Option<&ViewCrop>,
) -> Result<Option<(u32, u32, u32, u32)>, String> {
    let img = image::load_from_memory(jpeg).map_err(|e| e.to_string())?;
    let rgb = img.to_rgb8();
    let (iw, ih) = rgb.dimensions();
    let Some(crop) = crop else {
        if raster_is_solid_black_rgb(&rgb) {
            return Err("black-gif-frame".into());
        }
        return Ok(None);
    };
    let Some(pixel_crop @ (sx, sy, sw, sh)) = map_screenshot_crop(iw, ih, crop) else {
        return Err("invalid-gif-crop".into());
    };
    let video = image::imageops::crop_imm(&rgb, sx, sy, sw, sh).to_image();
    if raster_is_solid_black_rgb(&video) {
        return Err("black-gif-frame".into());
    }
    Ok(Some(pixel_crop))
}

fn encode_jpeg(rgb: &image::RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

fn raster_is_solid_black_rgb(rgb: &image::RgbImage) -> bool {
    let (width, height) = rgb.dimensions();
    if width == 0 || height == 0 {
        return true;
    }
    let step = ((width as usize * height as usize) / 1024).max(1);
    rgb.pixels()
        .step_by(step)
        .all(|pixel| pixel.0[0] <= 8 && pixel.0[1] <= 8 && pixel.0[2] <= 8)
}

#[cfg(test)]
mod tests {
    use super::{gif_file_sample_fps, map_screenshot_crop, ViewCrop};

    #[test]
    fn maps_css_box_onto_device_pixels() {
        let crop = ViewCrop {
            view_width: 1280.0,
            view_height: 720.0,
            x: 0.0,
            y: 80.0,
            width: 1280.0,
            height: 640.0,
        };
        assert_eq!(
            map_screenshot_crop(1920, 1080, &crop),
            Some((0, 120, 1920, 960))
        );
    }

    #[test]
    fn short_file_gifs_sample_denser() {
        assert_eq!(gif_file_sample_fps(1.2), 24.0);
        assert_eq!(gif_file_sample_fps(5.0), 16.0);
        assert_eq!(gif_file_sample_fps(12.0), 15.0);
    }
}
