use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const NOISE_DB: &str = "-30dB";
const MIN_SILENCE: &str = "0.35";
const SPEECH_FILTER: &str = "aformat=channel_layouts=mono,highpass=f=200,lowpass=f=3000";

fn parse_after(line: &str, marker: &str) -> Option<f32> {
    let rest = &line[line.find(marker)? + marker.len()..];
    rest.split_whitespace().next()?.parse().ok()
}

fn complement(silences: &mut [(f32, f32)], length: f32, offset: f32) -> Vec<(f32, f32)> {
    silences.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut speech = Vec::new();
    let mut cursor = 0.0;
    for &(start, end) in silences.iter() {
        if start > cursor {
            speech.push((cursor + offset, start + offset));
        }
        cursor = cursor.max(end);
    }
    if cursor < length {
        speech.push((cursor + offset, length + offset));
    }
    speech
}

pub async fn speech_intervals(
    url: &str,
    headers: &HashMap<String, String>,
    start_sec: f32,
    length_sec: f32,
) -> Result<Vec<(f32, f32)>, String> {
    let executable = std::env::var_os("IZUMI_FFMPEG_PATH").unwrap_or_else(|| "ffmpeg".into());
    let mut command = Command::new(executable);
    command.arg("-hide_banner").arg("-nostats");
    let user_agent = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("user-agent"))
        .map(|(_, value)| value.as_str())
        .unwrap_or("Izumi");
    command.arg("-user_agent").arg(user_agent);
    let header_blob = headers
        .iter()
        .filter(|(key, _)| !key.eq_ignore_ascii_case("user-agent"))
        .map(|(key, value)| format!("{key}: {value}\r\n"))
        .collect::<String>();
    if !header_blob.is_empty() {
        command.arg("-headers").arg(header_blob);
    }
    command
        .arg("-ss").arg(start_sec.to_string())
        .arg("-t").arg(length_sec.to_string())
        .arg("-i").arg(url)
        .arg("-vn").arg("-map").arg("0:a:0")
        .arg("-af").arg(format!(
            "{SPEECH_FILTER},silencedetect=noise={NOISE_DB}:d={MIN_SILENCE}"
        ))
        .arg("-f").arg("null").arg("-")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000 | 0x0000_4000);

    let mut child = command.spawn().map_err(|_| "ffmpeg-unavailable".to_string())?;
    let stderr = child.stderr.take().ok_or("ffmpeg-stderr-unavailable")?;
    let mut lines = BufReader::new(stderr).lines();
    let mut silences = Vec::new();
    let mut open_start = None;
    let collect = async {
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(value) = parse_after(&line, "silence_start:") {
                open_start = Some(value);
            } else if let Some(value) = parse_after(&line, "silence_end:") {
                if let Some(start) = open_start.take() {
                    silences.push((start, value));
                }
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(90), collect).await;
    let _ = child.kill().await;
    Ok(complement(&mut silences, length_sec, start_sec))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_complement_returns_speech() {
        let mut silence = vec![(2.0, 4.0), (7.0, 8.0)];
        assert_eq!(
            complement(&mut silence, 10.0, 100.0),
            vec![(100.0, 102.0), (104.0, 107.0), (108.0, 110.0)]
        );
    }
}
