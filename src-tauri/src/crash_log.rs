use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Initialize the crash log directory and install panic hook.
/// Must be called early in `run()` before any async work.
pub fn init(data_dir: &PathBuf) {
    let log_dir = data_dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    LOG_DIR.set(log_dir.clone()).ok();

    // Rotate: keep last 5 crash logs
    rotate_logs(&log_dir);

    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Write to crash log file
        let msg = format_panic(info);
        if let Some(dir) = LOG_DIR.get() {
            let path = dir.join("crash.log");
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
                let _ = f.write_all(msg.as_bytes());
                let _ = f.write_all(b"\n");
            }
        }
        // Also write to stderr for dev console
        eprintln!("{}", msg);
        // Chain to previous hook (Tauri's default)
        prev_hook(info);
    }));
}

/// Log a non-fatal error with context
pub fn log_error(context: &str, error: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let msg = format!("[{}] ERROR [{}] {}\n", timestamp, context, error);

    if let Some(dir) = LOG_DIR.get() {
        let path = dir.join("crash.log");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(msg.as_bytes());
        }
    }
    eprintln!("{}", msg.trim());
}

/// Log a warning
pub fn log_warn(context: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let msg = format!("[{}] WARN  [{}] {}\n", timestamp, context, message);

    if let Some(dir) = LOG_DIR.get() {
        let path = dir.join("crash.log");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(msg.as_bytes());
        }
    }
}

/// Log an info message (startup, tab lifecycle, etc.)
pub fn log_info(context: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let msg = format!("[{}] INFO  [{}] {}\n", timestamp, context, message);

    if let Some(dir) = LOG_DIR.get() {
        let path = dir.join("crash.log");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(msg.as_bytes());
        }
    }
}

fn format_panic(info: &std::panic::PanicHookInfo) -> String {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "unknown".into());
    let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "Box<dyn Any>".into()
    };

    let bt = std::backtrace::Backtrace::force_capture();

    format!(
        "=== BUSHIDO CRASH ===\n\
         Timestamp: {}\n\
         Location:  {}\n\
         Message:   {}\n\
         Thread:    {:?}\n\
         PID:       {}\n\
         \n\
         Backtrace:\n{}\n\
         === END CRASH ===\n",
        timestamp, location, payload,
        std::thread::current().name().unwrap_or("unnamed"),
        std::process::id(),
        bt
    )
}

fn rotate_logs(log_dir: &PathBuf) {
    let crash_log = log_dir.join("crash.log");
    if let Ok(meta) = fs::metadata(&crash_log) {
        // Rotate if > 2MB
        if meta.len() > 2 * 1024 * 1024 {
            // Shift old logs
            for i in (1..5).rev() {
                let from = log_dir.join(format!("crash.{}.log", i));
                let to = log_dir.join(format!("crash.{}.log", i + 1));
                let _ = fs::rename(&from, &to);
            }
            let _ = fs::rename(&crash_log, log_dir.join("crash.1.log"));
        }
    }
}

/// Read the crash log for the frontend
#[tauri::command]
pub async fn read_crash_log() -> Result<String, String> {
    let dir = LOG_DIR.get().ok_or("Log dir not initialized")?;
    let path = dir.join("crash.log");
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Clear the crash log
#[tauri::command]
pub async fn clear_crash_log() -> Result<(), String> {
    let dir = LOG_DIR.get().ok_or("Log dir not initialized")?;
    let path = dir.join("crash.log");
    fs::write(&path, "").map_err(|e| e.to_string())
}
