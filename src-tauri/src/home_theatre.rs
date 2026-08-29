use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCapability {
    pub id: String,
    pub name: String,
    pub connection: String,
    pub hdr_supported: Option<bool>,
    pub hdr_enabled: Option<bool>,
    pub bits_per_color: Option<u32>,
    pub max_luminance: Option<f64>,
    pub source: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceCapability {
    pub id: String,
    pub name: String,
    pub selectable: bool,
}

pub fn looks_like_receiver(name: &str) -> bool {
    let value = name.to_ascii_lowercase();
    [
        "hdmi",
        "displayport",
        "display port",
        "receiver",
        " a/v ",
        " avr",
        "earc",
        "arc ",
        "home theater",
        "home theatre",
    ]
    .iter()
    .any(|needle| value.contains(needle))
}

#[cfg(target_os = "windows")]
pub fn probe_audio_devices() -> Vec<AudioDeviceCapability> {
    use windows::core::GUID;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantToString;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED, STGM_READ,
    };

    // PKEY_Device_FriendlyName. Defining the property key locally avoids pulling the much larger
    // FunctionDiscovery API surface into the Windows build.
    const FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    unsafe {
        let initialized_here = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| -> windows::core::Result<Vec<AudioDeviceCapability>> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            let count = collection.GetCount()?;
            let mut devices = Vec::with_capacity(count as usize);
            for index in 0..count {
                let device = collection.Item(index)?;
                let raw_id = device.GetId()?;
                let id = raw_id.to_string().unwrap_or_default();
                CoTaskMemFree(Some(raw_id.0.cast()));
                let name = device
                    .OpenPropertyStore(STGM_READ)
                    .and_then(|store| store.GetValue(&FRIENDLY_NAME))
                    .and_then(|value| {
                        let mut buffer = [0u16; 256];
                        PropVariantToString(&value, &mut buffer)?;
                        let end = buffer
                            .iter()
                            .position(|unit| *unit == 0)
                            .unwrap_or(buffer.len());
                        Ok(String::from_utf16_lossy(&buffer[..end]))
                    })
                    .unwrap_or_else(|_| "Windows audio output".to_string());
                devices.push(AudioDeviceCapability {
                    // This is a Windows endpoint id, not mpv's `wasapi/...` selector. It is useful
                    // discovery evidence but must never be fed back to mpv as if it were selectable.
                    id,
                    name,
                    selectable: false,
                });
            }
            Ok(devices)
        })()
        .unwrap_or_default();
        if initialized_here {
            CoUninitialize();
        }
        result
    }
}

#[cfg(not(target_os = "windows"))]
pub fn probe_audio_devices() -> Vec<AudioDeviceCapability> {
    Vec::new()
}

#[cfg(target_os = "windows")]
pub fn probe_displays() -> Vec<DisplayCapability> {
    use std::mem::size_of;
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
        DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
        DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME, DISPLAYCONFIG_DEVICE_INFO_HEADER,
        DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO, DISPLAYCONFIG_MODE_INFO,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL,
        DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_TARGET_DEVICE_NAME,
        DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY, QDC_ONLY_ACTIVE_PATHS,
    };
    use windows::Win32::Foundation::ERROR_SUCCESS;

    fn connection(value: DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY) -> &'static str {
        if value == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI {
            "HDMI"
        } else if value == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL
            || value == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED
            || value == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL
        {
            "DisplayPort"
        } else if value == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL {
            "Internal"
        } else {
            "Other"
        }
    }

    unsafe {
        let mut path_count = 0u32;
        let mut mode_count = 0u32;
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
            != ERROR_SUCCESS
        {
            return Vec::new();
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            None,
        ) != ERROR_SUCCESS
        {
            return Vec::new();
        }
        paths.truncate(path_count as usize);
        paths
            .into_iter()
            .map(|path| {
                let target = path.targetInfo;
                let header = |kind, size| DISPLAYCONFIG_DEVICE_INFO_HEADER {
                    r#type: kind,
                    size,
                    adapterId: target.adapterId,
                    id: target.id,
                };
                let mut name = DISPLAYCONFIG_TARGET_DEVICE_NAME {
                    header: header(
                        DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
                        size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32,
                    ),
                    ..Default::default()
                };
                let friendly = if DisplayConfigGetDeviceInfo(&mut name.header) == 0 {
                    String::from_utf16_lossy(
                        &name.monitorFriendlyDeviceName[..name
                            .monitorFriendlyDeviceName
                            .iter()
                            .position(|v| *v == 0)
                            .unwrap_or(64)],
                    )
                } else {
                    String::new()
                };
                let mut color = DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO {
                    header: header(
                        DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
                        size_of::<DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>() as u32,
                    ),
                    ..Default::default()
                };
                let color_ok = DisplayConfigGetDeviceInfo(&mut color.header) == 0;
                let flags = if color_ok { color.Anonymous.value } else { 0 };
                DisplayCapability {
                    id: format!(
                        "{}:{}:{}",
                        target.adapterId.HighPart, target.adapterId.LowPart, target.id
                    ),
                    name: if friendly.is_empty() {
                        format!("Display {}", target.id)
                    } else {
                        friendly
                    },
                    connection: connection(target.outputTechnology).to_string(),
                    hdr_supported: color_ok.then_some(flags & 0x1 != 0),
                    hdr_enabled: color_ok.then_some(flags & 0x2 != 0),
                    bits_per_color: color_ok.then_some(color.bitsPerColorChannel),
                    max_luminance: None,
                    source: "os",
                }
            })
            .collect()
    }
}

#[cfg(target_os = "macos")]
pub fn probe_displays() -> Vec<DisplayCapability> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;

    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    NSScreen::screens(mtm)
        .iter()
        .enumerate()
        .map(|(index, screen)| {
            let potential = screen.maximumPotentialExtendedDynamicRangeColorComponentValue();
            let current = screen.maximumExtendedDynamicRangeColorComponentValue();
            DisplayCapability {
                id: format!("screen-{index}"),
                name: screen.localizedName().to_string(),
                connection: "Unknown".to_string(),
                hdr_supported: Some(potential > 1.0),
                hdr_enabled: Some(current > 1.0),
                bits_per_color: None,
                max_luminance: None,
                source: "os",
            }
        })
        .collect()
}

#[cfg(target_os = "linux")]
pub fn probe_displays() -> Vec<DisplayCapability> {
    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let connected = std::fs::read_to_string(path.join("status")).ok()?;
            if connected.trim() != "connected" {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let connection = if name.contains("HDMI") {
                "HDMI"
            } else if name.contains("DP-") || name.contains("DisplayPort") {
                "DisplayPort"
            } else if name.contains("eDP") || name.contains("LVDS") {
                "Internal"
            } else {
                "Other"
            };
            let max_bpc = std::fs::read_to_string(path.join("max_bpc"))
                .ok()
                .and_then(|value| {
                    value
                        .split_whitespace()
                        .filter_map(|part| part.parse().ok())
                        .max()
                });
            Some(DisplayCapability {
                id: name.clone(),
                name,
                connection: connection.to_string(),
                // KMS has connector HDR metadata, but sysfs has no stable userspace boolean for
                // it. Do not turn "connected HDMI" into a false claim of HDR support.
                hdr_supported: None,
                hdr_enabled: None,
                bits_per_color: max_bpc,
                max_luminance: None,
                source: "driver",
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::looks_like_receiver;

    #[test]
    fn receiver_names_are_hints_not_codec_evidence() {
        assert!(looks_like_receiver("WASAPI/HDMI - DENON AVR-X3800H"));
        assert!(looks_like_receiver("DisplayPort Output"));
        assert!(!looks_like_receiver("Built-in Speakers"));
    }
}
