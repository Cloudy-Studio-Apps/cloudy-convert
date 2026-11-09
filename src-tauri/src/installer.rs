//! In-app installer for yt-dlp, the engine behind the downloader.
//!
//! yt-dlp publishes self-contained builds (no Python needed) for every platform. We fetch the one
//! for this OS from its official GitHub releases into the app's `bin` folder, so nothing has to
//! be installed system-wide. Re-running the install is also how it gets updated — sites change
//! often and an old yt-dlp is the usual cause of failed downloads.

use crate::tools::{self, Tool};
use serde::Serialize;
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};

const RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

/// Release asset for the current OS/CPU.
fn asset_name() -> Result<&'static str, String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => "yt-dlp_linux",
        ("linux", "aarch64") => "yt-dlp_linux_aarch64",
        ("windows", "x86") => "yt-dlp_x86.exe",
        ("windows", _) => "yt-dlp.exe",
        ("macos", _) => "yt-dlp_macos",
        (os, arch) => return Err(format!("No yt-dlp build for {os}/{arch}")),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpStatus {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    /// True when it's our own copy (so the app can update it).
    managed: bool,
}

#[derive(Serialize, Clone)]
struct InstallProgress {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn ytdlp_status() -> YtDlpStatus {
    tauri::async_runtime::spawn_blocking(|| {
        let path = tools::locate(Tool::YtDlp);
        let managed = match (&path, tools::bin_dir()) {
            (Some(p), Some(dir)) => p.starts_with(dir),
            _ => false,
        };
        YtDlpStatus {
            installed: path.is_some(),
            version: path.as_ref().and_then(|_| tools::version(Tool::YtDlp).ok()),
            path: path.map(|p| p.to_string_lossy().to_string()),
            managed,
        }
    })
    .await
    .unwrap_or(YtDlpStatus { installed: false, version: None, path: None, managed: false })
}

/// Downloads (or re-downloads, to update) yt-dlp. Emits `ytdlp-install-progress` while running.
#[tauri::command]
pub async fn ytdlp_install(app: AppHandle) -> Result<YtDlpStatus, String> {
    tauri::async_runtime::spawn_blocking(move || install(&app)).await.map_err(|e| e.to_string())??;
    Ok(ytdlp_status().await)
}

fn install(app: &AppHandle) -> Result<(), String> {
    let dir = tools::bin_dir().ok_or("App data folder is unavailable")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = dir.join(Tool::YtDlp.file_name());
    let partial = target.with_extension("download");

    let url = format!("{RELEASES}{}", asset_name()?);
    let resp = ureq::get(&url).call().map_err(|e| format!("Download failed: {e}"))?;
    let total = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
    let mut reader = resp.into_body().into_reader();
    let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 256 * 1024];
    let mut downloaded = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        let _ = app.emit("ytdlp-install-progress", InstallProgress { downloaded, total });
    }
    drop(file);
    if total.is_some_and(|t| t != downloaded) {
        let _ = std::fs::remove_file(&partial);
        return Err("Download was incomplete, please try again.".into());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    // Swap in the new binary only once it's complete, so a failed update keeps the old one.
    std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    Ok(())
}
