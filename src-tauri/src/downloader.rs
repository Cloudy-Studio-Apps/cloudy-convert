//! Downloading videos/audio from YouTube, Vimeo, TikTok and the ~1800 other sites yt-dlp supports.
//!
//! Two steps, both driven by yt-dlp:
//!   * `fetch_info` — reads a link's metadata (title, thumbnail, available formats) without
//!     downloading, so the UI can offer qualities and estimate sizes. Playlists come back as a list
//!     of links that the UI then fetches one by one.
//!   * `download`   — downloads one item as MP4 (video) or MP3 (audio). yt-dlp's progress is printed
//!     with our own `--progress-template`, parsed here and forwarded as `download-progress` events.

use crate::jobs::{Jobs, Outcome};
use crate::tools::{self, Tool};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteInfo {
    Video(VideoInfo),
    Playlist { title: String, entries: Vec<PlaylistEntry> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    id: String,
    url: String,
    title: String,
    uploader: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    /// Site name, e.g. "Youtube", "Vimeo", "TikTok".
    site: String,
    is_live: bool,
    formats: Vec<RemoteFormat>,
}

/// The parts of a yt-dlp format the UI needs to list qualities and estimate sizes.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFormat {
    id: String,
    ext: String,
    has_video: bool,
    has_audio: bool,
    vcodec: Option<String>,
    height: Option<u32>,
    fps: Option<f64>,
    /// Exact or approximate size in bytes, when the site tells us (or it can be derived from bitrate).
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    url: String,
    title: Option<String>,
    duration: Option<f64>,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().filter(|s| !s.is_empty()).map(String::from)
}

/// `None` for "none" (stream absent), `Some(codec)` when present, and `Some("")` when unknown.
fn codec_field(v: &Value, key: &str) -> Option<String> {
    match v[key].as_str() {
        Some("none") => None,
        Some(c) => Some(c.to_string()),
        None => Some(String::new()),
    }
}

fn parse_format(f: &Value, duration: Option<f64>) -> Option<RemoteFormat> {
    let ext = str_field(f, "ext").unwrap_or_default();
    // Storyboards (thumbnail sprites) are listed as formats too.
    if ext == "mhtml" {
        return None;
    }
    let vcodec = codec_field(f, "vcodec");
    let acodec = codec_field(f, "acodec");
    let height = f["height"].as_u64().map(|h| h as u32);
    let has_video = vcodec.is_some() && (height.is_some() || vcodec.as_deref() != Some(""));
    let has_audio = acodec.is_some();
    if !has_video && !has_audio {
        return None;
    }
    let by_bitrate = f["tbr"].as_f64().zip(duration).map(|(kbps, d)| (kbps * 125.0 * d) as u64);
    Some(RemoteFormat {
        id: str_field(f, "format_id")?,
        ext,
        has_video,
        has_audio,
        vcodec: vcodec.filter(|c| !c.is_empty()),
        height,
        fps: f["fps"].as_f64(),
        size: f["filesize"].as_u64().or(f["filesize_approx"].as_u64()).or(by_bitrate),
    })
}

fn parse_info(v: &Value, requested_url: &str) -> RemoteInfo {
    if v["_type"] == "playlist" {
        let entries = v["entries"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|e| {
                        Some(PlaylistEntry {
                            url: str_field(e, "url").or_else(|| str_field(e, "webpage_url"))?,
                            title: str_field(e, "title"),
                            duration: e["duration"].as_f64(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        return RemoteInfo::Playlist { title: str_field(v, "title").unwrap_or_else(|| "Playlist".into()), entries };
    }
    let duration = v["duration"].as_f64();
    let formats = v["formats"].as_array().map(|fs| fs.iter().filter_map(|f| parse_format(f, duration)).collect()).unwrap_or_default();
    RemoteInfo::Video(VideoInfo {
        id: str_field(v, "id").unwrap_or_default(),
        url: str_field(v, "webpage_url").unwrap_or_else(|| requested_url.to_string()),
        title: str_field(v, "title").unwrap_or_else(|| requested_url.to_string()),
        uploader: str_field(v, "uploader").or_else(|| str_field(v, "channel")).or_else(|| str_field(v, "creator")),
        duration,
        thumbnail: str_field(v, "thumbnail"),
        site: str_field(v, "extractor_key").unwrap_or_default(),
        is_live: v["is_live"].as_bool().unwrap_or(false),
        formats,
    })
}

/// yt-dlp's own error line ("ERROR: [youtube] xyz: Video unavailable") without the prefix.
fn error_message(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines
        .iter()
        .rev()
        .find_map(|l| l.strip_prefix("ERROR: "))
        .or(lines.last().copied())
        .unwrap_or("yt-dlp failed")
        .to_string()
}

#[tauri::command]
pub async fn fetch_info(url: String) -> Result<RemoteInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = tools::command(Tool::YtDlp)?;
        cmd
            // --flat-playlist: list a playlist's links instead of resolving every video up front.
            // --no-playlist: a "watch?v=…&list=…" link means just that video.
            .args(["-J", "--no-warnings", "--flat-playlist", "--no-playlist", "--", &url]);
        let out = output_with_timeout(cmd, INFO_TIMEOUT)?;
        if !out.status.success() {
            return Err(error_message(&String::from_utf8_lossy(&out.stderr)));
        }
        let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("Unexpected yt-dlp output: {e}"))?;
        Ok(parse_info(&v, &url))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Longest we wait for a link's info. yt-dlp can stall (rate limiting, a site that never answers);
/// without a limit the link would show "loading" forever and hold one of the fetch slots.
const INFO_TIMEOUT: Duration = Duration::from_secs(90);

/// Like `Command::output`, but kills the process if it runs longer than `timeout`.
fn output_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start yt-dlp: {e}"))?;
    // Drain both pipes on their own threads, so a full pipe can never block yt-dlp.
    let drain = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            buf
        })
    };
    let stdout = drain(Box::new(child.stdout.take().unwrap()));
    let stderr = drain(Box::new(child.stderr.take().unwrap()));
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Timed out reading the link's info. Try again in a moment.".into());
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    };
    Ok(Output { status, stdout: stdout.join().unwrap_or_default(), stderr: stderr.join().unwrap_or_default() })
}

/// Sends every line of `r` to `tx`. Bytes that aren't valid UTF-8 are replaced instead of ending
/// the stream: stopping early would leave the pipe undrained and lose the final file path.
fn forward_lines<R: Read>(r: R, tx: mpsc::Sender<Line>, wrap: fn(String) -> Line) {
    let mut reader = BufReader::new(r);
    let mut buf = Vec::new();
    while matches!(reader.read_until(b'\n', &mut buf), Ok(n) if n > 0) {
        let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
        let _ = tx.send(wrap(line));
        buf.clear();
    }
}

// ---------------------------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    id: String,
    url: String,
    /// "mp4" or "mp3" (ids match `src/features/downloader/options.ts`).
    format: String,
    /// MP4: max height in pixels. MP3: bitrate in kbps. 0 = best available.
    quality: u32,
    /// MP4 only: prefer H.264 + AAC, which plays everywhere, over VP9/AV1.
    compatible: bool,
    output_dir: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    id: String,
    /// "downloading" or "processing" (merging, converting to MP3, embedding cover art…).
    stage: &'static str,
    /// 1-based index of the file being downloaded (video and audio are fetched separately).
    part: u32,
    downloaded: u64,
    total: Option<u64>,
    /// Bytes per second.
    speed: Option<f64>,
    eta: Option<f64>,
    /// yt-dlp post-processor name while processing, e.g. "Merger" or "ExtractAudio".
    step: Option<String>,
}

// Our progress line formats. Download progress goes to stdout, post-processing to stderr.
const DL_TAG: &str = "[dl] ";
const PP_TAG: &str = "[pp] ";
const OUT_TAG: &str = "[out] ";
const DL_TEMPLATE: &str = "download:[dl] %(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s";
const PP_TEMPLATE: &str = "postprocess:[pp] %(progress.postprocessor)s|%(progress.status)s";

/// The yt-dlp command line for a job (everything except the program itself).
fn build_args(job: &DownloadJob, ffmpeg: Option<&Path>) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));

    push(&["--newline", "--no-playlist", "--no-warnings", "--quiet", "--progress", "--no-mtime"]);
    push(&["--progress-template", DL_TEMPLATE, "--progress-template", PP_TEMPLATE]);
    push(&["--print", "after_move:[out] %(filepath)s"]);

    match job.format.as_str() {
        "mp3" => {
            let quality = if job.quality == 0 { "0".to_string() } else { format!("{}K", job.quality) };
            push(&["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", &quality]);
            push(&["--embed-thumbnail", "--embed-metadata"]);
        }
        _ => {
            // -S ranks formats: resolution first (capped at the chosen height), then codec preference.
            let res = if job.quality == 0 { "res".to_string() } else { format!("res:{}", job.quality) };
            let sort = if job.compatible { format!("{res},vcodec:h264,acodec:aac") } else { res };
            push(&["-S", &sort, "-f", "bv*+ba/b", "--merge-output-format", "mp4", "--remux-video", "mp4"]);
            push(&["--embed-metadata"]);
        }
    }

    if let Some(ff) = ffmpeg {
        a.push("--ffmpeg-location".into());
        a.push(ff.to_string_lossy().to_string());
    }
    a.push("-o".into());
    a.push(Path::new(&job.output_dir).join("%(title).150B.%(ext)s").to_string_lossy().to_string());
    a.push("--".into());
    a.push(job.url.clone());
    a
}

/// yt-dlp prints "NA" for unknown values.
fn num(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

/// Downloads one item; resolves to the saved file's path. Rejects with "Cancelled" if stopped.
#[tauri::command]
pub async fn download(app: AppHandle, jobs: State<'_, Arc<Jobs>>, job: DownloadJob) -> Result<String, String> {
    let jobs = jobs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_download(app, jobs, job))
        .await
        .map_err(|e| e.to_string())?
}

/// A line from either output stream of the yt-dlp process.
enum Line {
    Out(String),
    Err(String),
}

fn run_download(app: AppHandle, jobs: Arc<Jobs>, job: DownloadJob) -> Result<String, String> {
    std::fs::create_dir_all(&job.output_dir).map_err(|e| format!("Cannot create output folder: {e}"))?;
    let mut child = tools::command(Tool::YtDlp)?
        .args(build_args(&job, tools::locate(Tool::Ffmpeg).as_deref()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start yt-dlp: {e}"))?;

    // Read both streams on their own threads and funnel the lines into one channel.
    let (tx, rx) = mpsc::channel();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let tx_err = tx.clone();
    std::thread::spawn(move || forward_lines(stdout, tx, Line::Out));
    std::thread::spawn(move || forward_lines(stderr, tx_err, Line::Err));
    jobs.register(&job.id, child);

    let mut p = DownloadProgress { id: job.id.clone(), stage: "downloading", ..Default::default() };
    let mut parts: Vec<String> = Vec::new(); // files yt-dlp downloaded, in order
    let mut output: Option<String> = None;
    let mut errors = String::new();

    for line in rx {
        match line {
            Line::Out(l) if l.starts_with(DL_TAG) => {
                let f: Vec<&str> = l[DL_TAG.len()..].splitn(6, '|').collect();
                if f.len() < 6 {
                    continue;
                }
                let file = f[5].to_string();
                if parts.last() != Some(&file) {
                    parts.push(file);
                }
                p.stage = "downloading";
                p.part = parts.len() as u32;
                p.downloaded = num(f[0]).unwrap_or(0.0) as u64;
                p.total = num(f[1]).or(num(f[2])).map(|t| t as u64);
                p.speed = num(f[3]);
                p.eta = num(f[4]);
                p.step = None;
                let _ = app.emit("download-progress", p.clone());
            }
            Line::Out(l) if l.starts_with(OUT_TAG) => output = Some(l[OUT_TAG.len()..].trim().to_string()),
            Line::Err(l) if l.starts_with(PP_TAG) => {
                let step = l[PP_TAG.len()..].split('|').next().unwrap_or("").to_string();
                p.stage = "processing";
                p.step = Some(step);
                p.speed = None;
                p.eta = None;
                let _ = app.emit("download-progress", p.clone());
            }
            Line::Err(l) => {
                errors.push_str(&l);
                errors.push('\n');
            }
            Line::Out(_) => {}
        }
    }

    let outcome = jobs.finish(&job.id);
    // yt-dlp prints the final path only once the file is complete and in place, so if it did and
    // the file is there, the download worked even if yt-dlp still exited with an error afterwards.
    if let (Outcome::Exited(_), Some(out)) = (&outcome, &output) {
        if Path::new(out).is_file() {
            return Ok(out.clone());
        }
    }
    match outcome {
        Outcome::Exited(Some(s)) if s.success() => output
            .filter(|o| Path::new(o).exists())
            .ok_or_else(|| "Download finished but the file could not be found.".to_string()),
        Outcome::Cancelled => {
            remove_leftovers(&parts);
            Err("Cancelled".into())
        }
        Outcome::Exited(_) => {
            remove_leftovers(&parts);
            Err(error_message(&errors))
        }
    }
}

/// After a failed/cancelled download, deletes yt-dlp's partial files and intermediate streams
/// ("title.f137.mp4"). A plain "title.mp4" may be an earlier, finished download, so it stays.
fn remove_leftovers(parts: &[String]) {
    for file in parts {
        let _ = std::fs::remove_file(format!("{file}.part"));
        let _ = std::fs::remove_file(format!("{file}.ytdl"));
        if is_intermediate(file) {
            let _ = std::fs::remove_file(file);
        }
    }
}

/// True for yt-dlp's per-format temp names like "Title.f137.mp4" or "Title.f251-drc.webm".
fn is_intermediate(file: &str) -> bool {
    let name = PathBuf::from(file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    name.rsplit_once(".f").is_some_and(|(_, id)| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(format: &str, quality: u32, compatible: bool) -> DownloadJob {
        DownloadJob { id: "x".into(), url: "https://example.com/v".into(), format: format.into(), quality, compatible, output_dir: "/tmp".into() }
    }

    #[test]
    fn mp4_args_cap_resolution_and_prefer_h264() {
        let a = build_args(&job("mp4", 1080, true), None);
        let i = a.iter().position(|x| x == "-S").unwrap();
        assert_eq!(a[i + 1], "res:1080,vcodec:h264,acodec:aac");
        assert!(a.ends_with(&["--".into(), "https://example.com/v".into()]));
    }

    #[test]
    fn mp3_args_set_bitrate() {
        let a = build_args(&job("mp3", 192, false), None);
        let i = a.iter().position(|x| x == "--audio-quality").unwrap();
        assert_eq!(a[i + 1], "192K");
        assert_eq!(build_args(&job("mp3", 0, false), None)[i + 1], "0");
    }

    #[test]
    fn recognises_intermediate_files() {
        assert!(is_intermediate("/d/Me at the zoo.f140.m4a"));
        assert!(is_intermediate("/d/Clip.f251-drc.webm"));
        assert!(!is_intermediate("/d/Me at the zoo.mp4"));
    }

    #[test]
    fn extracts_yt_dlp_errors() {
        assert_eq!(error_message("WARNING: x\nERROR: [youtube] abc: Video unavailable\n"), "[youtube] abc: Video unavailable");
    }
}
