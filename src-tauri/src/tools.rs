//! Locating the external programs the app drives (ffmpeg, ffprobe, yt-dlp).
//!
//! Lookup order for every tool:
//!   1. the app's own `bin` folder (where the in-app installer puts yt-dlp),
//!   2. next to the app executable (for builds that ship the tools alongside),
//!   3. the system `PATH`.
//! Every process is created through [`command`], so the lookup rules and platform tweaks
//! (no console window on Windows, no stdin) live in one place.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
    YtDlp,
}

impl Tool {
    /// File name of the executable on this platform.
    pub fn file_name(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Tool::Ffmpeg, false) => "ffmpeg",
            (Tool::Ffmpeg, true) => "ffmpeg.exe",
            (Tool::Ffprobe, false) => "ffprobe",
            (Tool::Ffprobe, true) => "ffprobe.exe",
            (Tool::YtDlp, false) => "yt-dlp",
            (Tool::YtDlp, true) => "yt-dlp.exe",
        }
    }

    fn missing_message(self) -> String {
        match self {
            Tool::Ffmpeg | Tool::Ffprobe => format!("{} was not found. Install ffmpeg (e.g. `sudo pacman -S ffmpeg`).", self.file_name()),
            Tool::YtDlp => "The downloader engine (yt-dlp) is not installed yet.".into(),
        }
    }
}

/// The app-managed tools folder, set once at startup by [`init`].
static BIN_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = BIN_DIR.set(dir.join("bin"));
    }
}

/// Folder where the app installs its own copies of tools.
pub fn bin_dir() -> Option<&'static Path> {
    BIN_DIR.get().map(PathBuf::as_path)
}

/// Absolute path of `tool`, if it can be found anywhere.
pub fn locate(tool: Tool) -> Option<PathBuf> {
    let name = tool.file_name();
    let managed = bin_dir().map(|d| d.join(name));
    let beside_exe = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(name)));
    managed
        .into_iter()
        .chain(beside_exe)
        .find(|p| p.is_file())
        .or_else(|| find_on_path(name))
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(name)).find(|p| p.is_file())
}

/// A ready-to-configure `Command` for `tool`, or a user-facing error if it's missing.
pub fn command(tool: Tool) -> Result<Command, String> {
    let path = locate(tool).ok_or_else(|| tool.missing_message())?;
    let mut c = command_for(&path);
    if let Tool::YtDlp = tool {
        // yt-dlp is Python: when its output is piped on Windows it writes in the legacy code page
        // (cp1252…), so titles with accents/emoji came back garbled and the saved file's path no
        // longer matched the real one. Force UTF-8 on every platform.
        c.env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
    }
    Ok(c)
}

/// Builds a `Command` with the app's defaults: no stdin, and no flashing console on Windows.
pub fn command_for(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// First line of `<tool> --version`-style output, used to show versions in the UI.
pub fn version(tool: Tool) -> Result<String, String> {
    let flag = match tool {
        Tool::YtDlp => "--version",
        _ => "-version",
    };
    let out = command(tool)?.arg(flag).output().map_err(|e| e.to_string())?;
    let first = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string();
    Ok(match tool {
        // "ffmpeg version n7.1 Copyright ..." -> "n7.1"
        Tool::Ffmpeg | Tool::Ffprobe => first.split_whitespace().nth(2).unwrap_or("unknown").to_string(),
        Tool::YtDlp => first,
    })
}

#[tauri::command]
pub fn check_ffmpeg() -> Result<String, String> {
    version(Tool::Ffmpeg)
}
