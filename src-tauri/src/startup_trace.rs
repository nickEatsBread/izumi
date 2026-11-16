//! Launch timing: how long each step between exec and the first shown window took, readable from
//! the page (`invoke('startup_marks')`) so a slow launch on a device can be measured without a
//! debugger or a log file.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

static START: OnceLock<(Instant, Option<f64>)> = OnceLock::new();
static MARKS: Mutex<Vec<(&'static str, f64)>> = Mutex::new(Vec::new());

/// Records that a launch step finished, in milliseconds since `run()` began (the first mark).
pub fn mark(label: &'static str) {
    let (start, _) = START.get_or_init(|| (Instant::now(), exec_to_now_ms()));
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    if let Ok(mut marks) = MARKS.lock() {
        marks.push((label, ms));
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMarks {
    /// Milliseconds from exec to the first mark: loading the binary and its libraries.
    exec_to_run_ms: Option<f64>,
    marks: Vec<(&'static str, f64)>,
}

#[tauri::command]
pub fn startup_marks() -> StartupMarks {
    StartupMarks {
        exec_to_run_ms: START.get().and_then(|(_, exec)| *exec),
        marks: MARKS.lock().map(|marks| marks.clone()).unwrap_or_default(),
    }
}

/// How long ago the kernel started this process, from /proc (10 ms resolution).
#[cfg(target_os = "linux")]
fn exec_to_now_ms() -> Option<f64> {
    let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
    // Fields after the parenthesised command name start at field 3; starttime is field 22.
    let start_ticks: f64 = stat.rsplit(')').next()?.split_whitespace().nth(19)?.parse().ok()?;
    let uptime: f64 = std::fs::read_to_string("/proc/uptime").ok()?.split_whitespace().next()?.parse().ok()?;
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as f64;
    Some((uptime - start_ticks / ticks) * 1000.0)
}

#[cfg(not(target_os = "linux"))]
fn exec_to_now_ms() -> Option<f64> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn marks_are_in_order() {
        super::mark("a");
        super::mark("b");
        let marks = super::startup_marks().marks;
        let at = |label| marks.iter().find(|(l, _)| *l == label).map(|(_, ms)| *ms).unwrap();
        assert!(at("a") <= at("b"));
    }
}
