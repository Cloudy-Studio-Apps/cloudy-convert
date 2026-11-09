//! Cloudy Convert backend.
//!
//! The UI (React, in `src/`) calls these commands with `invoke()`. Each feature lives in its own
//! module:
//!   * `tools`      — finds ffmpeg / ffprobe / yt-dlp and builds their commands
//!   * `jobs`       — tracks running processes so they can be cancelled
//!   * `media`      — probing local files, thumbnails, file-system helpers
//!   * `convert`    — MP4 → edit-friendly .mov (DNxHR / ProRes) with ffmpeg
//!   * `preview`    — ffmpeg-decoded video preview frames
//!   * `installer`  — installs / updates yt-dlp inside the app's data folder
//!   * `downloader` — downloads from YouTube, Vimeo, TikTok… as MP4 or MP3

mod convert;
mod downloader;
mod installer;
mod jobs;
mod media;
mod preview;
mod tools;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .manage(Arc::new(jobs::Jobs::default()))
        .manage(Arc::new(preview::Previewer::default()))
        .setup(|app| {
            tools::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tools::check_ffmpeg,
            jobs::cancel_job,
            media::expand_paths,
            media::probe_file,
            media::file_size,
            media::disk_free,
            media::downloads_dir,
            media::fallback_icon,
            convert::convert,
            preview::preview_frame,
            preview::preview_play,
            preview::preview_stop,
            installer::ytdlp_status,
            installer::ytdlp_install,
            downloader::fetch_info,
            downloader::download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
