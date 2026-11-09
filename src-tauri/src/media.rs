//! Reading local media files: probing with ffprobe, thumbnails, and small filesystem helpers.

use crate::tools::{self, Tool};
use base64::Engine;
use serde::Serialize;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mov", "mkv", "avi", "mts", "m2ts", "webm", "3gp"];
/// Audio-only files (e.g. WhatsApp voice notes: .ogg/.opus, shared audio: .aac/.m4a) are converted to .wav.
const AUDIO_EXTS: &[&str] = &["ogg", "oga", "opus", "aac", "m4a", "amr", "mp3", "flac", "wma"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    path: String,
    name: String,
    dir: String,
    size: u64,
    duration: f64,
    width: u32,
    height: u32,
    fps: f64,
    /// False for audio-only files; width/height/fps/video_codec/pix_fmt are then empty.
    has_video: bool,
    video_codec: String,
    pix_fmt: String,
    audio_codec: Option<String>,
    sample_rate: u32,
    channels: u32,
    /// JPEG on disk, used as the drag icon.
    thumb_path: Option<String>,
    /// Same JPEG as a data URL, for showing in the list.
    thumb_data: Option<String>,
}

pub fn jpeg_data_url(bytes: &[u8]) -> String {
    format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Expands dropped/selected paths: folders become the video/audio files inside them (non-recursive).
#[tauri::command]
pub fn expand_paths(paths: Vec<String>) -> Vec<String> {
    let is_media = |p: &Path| {
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .map(|e| VIDEO_EXTS.contains(&e.as_str()) || AUDIO_EXTS.contains(&e.as_str()))
            .unwrap_or(false)
    };
    let mut out = Vec::new();
    for p in paths {
        let path = PathBuf::from(&p);
        if path.is_dir() {
            if let Ok(rd) = std::fs::read_dir(&path) {
                let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file() && is_media(p)).collect();
                files.sort();
                out.extend(files.into_iter().map(|p| p.to_string_lossy().to_string()));
            }
        } else if path.is_file() && is_media(&path) {
            out.push(p);
        }
    }
    out
}

/// "30000/1001" -> 29.97
fn parse_rate(r: &str) -> f64 {
    match r.split_once('/') {
        Some((n, d)) => {
            let (n, d): (f64, f64) = (n.parse().unwrap_or(0.0), d.parse().unwrap_or(1.0));
            if d == 0.0 { 0.0 } else { n / d }
        }
        None => r.parse().unwrap_or(0.0),
    }
}

/// Renders (or reuses) a 240px-wide JPEG thumbnail in the app cache, keyed by path + mtime.
pub fn thumbnail(app: &AppHandle, input: &str, duration: f64) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("thumbs");
    std::fs::create_dir_all(&dir).ok()?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut h);
    std::fs::metadata(input).ok()?.modified().ok().hash(&mut h);
    let out = dir.join(format!("{:x}.jpg", h.finish()));
    if out.exists() {
        return Some(out);
    }
    let seek = if duration > 2.0 { 1.0 } else { 0.0 };
    let ok = tools::command(Tool::Ffmpeg)
        .ok()?
        .args(["-v", "error", "-y", "-ss", &seek.to_string(), "-i", input, "-map", "0:v:0", "-frames:v", "1"])
        .args(["-vf", "scale=240:-2", "-q:v", "4"])
        .arg(&out)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    ok.then_some(out)
}

#[tauri::command]
pub async fn probe_file(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = tools::command(Tool::Ffprobe)?
            .args(["-v", "error", "-show_format", "-show_streams", "-of", "json", &path])
            .output()
            .map_err(|e| format!("ffprobe failed: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
        let streams = v["streams"].as_array().cloned().unwrap_or_default();
        let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
        let audio = streams.iter().find(|s| s["codec_type"] == "audio");
        if video.is_none() && audio.is_none() {
            return Err("No video or audio stream found".into());
        }
        let duration: f64 = v["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0);
        let p = PathBuf::from(&path);
        let thumb = video.and_then(|_| thumbnail(&app, &path, duration));
        let video = video.unwrap_or(&serde_json::Value::Null);
        let thumb_data = thumb.as_ref().and_then(|t| std::fs::read(t).ok()).map(|b| jpeg_data_url(&b));
        let rate = video["avg_frame_rate"].as_str().filter(|r| *r != "0/0").or(video["r_frame_rate"].as_str());
        Ok(MediaInfo {
            name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            dir: p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default(),
            size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            duration,
            width: video["width"].as_u64().unwrap_or(0) as u32,
            height: video["height"].as_u64().unwrap_or(0) as u32,
            fps: parse_rate(rate.unwrap_or("0")),
            has_video: !video.is_null(),
            video_codec: video["codec_name"].as_str().unwrap_or("?").to_string(),
            pix_fmt: video["pix_fmt"].as_str().unwrap_or("?").to_string(),
            audio_codec: audio.and_then(|a| a["codec_name"].as_str()).map(String::from),
            sample_rate: audio.and_then(|a| a["sample_rate"].as_str()).and_then(|r| r.parse().ok()).unwrap_or(0),
            channels: audio.and_then(|a| a["channels"].as_u64()).unwrap_or(0) as u32,
            thumb_path: thumb.map(|t| t.to_string_lossy().to_string()),
            thumb_data,
            path,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn file_size(path: String) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Free bytes on the filesystem containing `path` (Linux/macOS via `df`; `None` elsewhere).
#[tauri::command]
pub fn disk_free(path: String) -> Option<u64> {
    let out = std::process::Command::new("df").args(["-Pk", &path]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let avail_kb: u64 = text.lines().nth(1)?.split_whitespace().nth(3)?.parse().ok()?;
    Some(avail_kb * 1024)
}

/// The user's Downloads folder, used as the default download destination.
#[tauri::command]
pub fn downloads_dir(app: AppHandle) -> Option<String> {
    app.path().download_dir().ok().map(|p| p.to_string_lossy().to_string())
}

/// A generic drag icon (the app icon) for files that have no thumbnail, e.g. MP3s.
#[tauri::command]
pub fn fallback_icon(app: AppHandle) -> Option<String> {
    let path = app.path().app_cache_dir().ok()?.join("drag-icon.png");
    if !path.exists() {
        std::fs::create_dir_all(path.parent()?).ok()?;
        std::fs::write(&path, include_bytes!("../icons/128x128.png")).ok()?;
    }
    Some(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_rate;

    #[test]
    fn parses_frame_rates() {
        assert!((parse_rate("30000/1001") - 29.97).abs() < 0.01);
        assert_eq!(parse_rate("25"), 25.0);
        assert_eq!(parse_rate("0/0"), 0.0);
    }
}
