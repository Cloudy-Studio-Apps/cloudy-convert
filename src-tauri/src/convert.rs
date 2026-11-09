//! Converting local videos into edit-friendly .mov files with ffmpeg.
//!
//! Every preset is intra-frame video + PCM audio, which DaVinci Resolve (free, Linux) can decode,
//! unlike H.264/H.265/AAC. Audio-only files (WhatsApp .ogg/.opus/.aac, …) ignore the preset and
//! become 16-bit PCM .wav. Progress comes from ffmpeg's `-progress pipe:1` key=value output and
//! is forwarded to the UI as `convert-progress` events.

use crate::jobs::{Jobs, Outcome};
use crate::tools::{self, Tool};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertJob {
    id: String,
    input: String,
    /// `None` / empty = next to the original.
    output_dir: Option<String>,
    preset: String,
    /// Downscale target; ignored when it isn't smaller than the source.
    max_height: Option<u32>,
    source_height: u32,
    duration: f64,
    overwrite: bool,
    /// No video stream: write a .wav instead of a .mov.
    #[serde(default)]
    audio_only: bool,
    /// .wav sample format: "pcm_s16le" or "pcm_s24le".
    #[serde(default)]
    wav_codec: Option<String>,
    /// .wav resample target; `None` keeps the source rate.
    #[serde(default)]
    sample_rate: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    progress: f64,
    fps: f64,
    speed: String,
    out_size: u64,
}

/// Encoder arguments per preset (ids match `src/features/converter/presets.ts`).
fn preset_args(preset: &str) -> Result<Vec<&'static str>, String> {
    let v: &[&str] = match preset {
        "dnxhr_hq" => &["-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p"],
        "dnxhr_hqx" => &["-c:v", "dnxhd", "-profile:v", "dnxhr_hqx", "-pix_fmt", "yuv422p10le"],
        "dnxhr_sq" => &["-c:v", "dnxhd", "-profile:v", "dnxhr_sq", "-pix_fmt", "yuv422p"],
        "dnxhr_lb" => &["-c:v", "dnxhd", "-profile:v", "dnxhr_lb", "-pix_fmt", "yuv422p"],
        "prores_hq" => &["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"],
        "prores_422" => &["-c:v", "prores_ks", "-profile:v", "2", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"],
        "prores_lt" => &["-c:v", "prores_ks", "-profile:v", "1", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"],
        "prores_proxy" => &["-c:v", "prores_ks", "-profile:v", "0", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"],
        "copy" => &["-c:v", "copy"],
        _ => return Err(format!("Unknown preset {preset}")),
    };
    let mut args = v.to_vec();
    args.extend(["-c:a", "pcm_s16le"]);
    Ok(args)
}

/// `<stem>.<ext>`, or `<stem>_1.<ext>`, `_2`… when it exists and we must not overwrite.
fn unique_output(dir: &Path, stem: &str, ext: &str, input: &Path, overwrite: bool) -> PathBuf {
    let candidate = dir.join(format!("{stem}.{ext}"));
    if (overwrite && candidate != input) || !candidate.exists() {
        return candidate;
    }
    (1..).map(|i| dir.join(format!("{stem}_{i}.{ext}"))).find(|p| !p.exists()).unwrap()
}

/// Converts one file; resolves to the output path. Rejects with "Cancelled" if stopped.
#[tauri::command]
pub async fn convert(app: AppHandle, jobs: State<'_, Arc<Jobs>>, job: ConvertJob) -> Result<String, String> {
    let jobs = jobs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_convert(app, jobs, job))
        .await
        .map_err(|e| e.to_string())?
}

fn run_convert(app: AppHandle, jobs: Arc<Jobs>, job: ConvertJob) -> Result<String, String> {
    let input = PathBuf::from(&job.input);
    let dir = match &job.output_dir {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => input.parent().ok_or("Invalid input path")?.to_path_buf(),
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create output folder: {e}"))?;
    let stem = input.file_stem().ok_or("Invalid input name")?.to_string_lossy().to_string();
    let ext = if job.audio_only { "wav" } else { "mov" };
    let output = unique_output(&dir, &stem, ext, &input, job.overwrite);
    // Write to a temp name so a half-written file is never picked up or dragged.
    let partial = output.with_extension(format!("{ext}.part"));

    let mut cmd = tools::command(Tool::Ffmpeg)?;
    cmd.args(["-hide_banner", "-v", "error", "-nostats", "-progress", "pipe:1", "-y", "-i"]).arg(&input);
    if job.audio_only {
        let codec = match job.wav_codec.as_deref() {
            None | Some("pcm_s16le") => "pcm_s16le",
            Some("pcm_s24le") => "pcm_s24le",
            Some(c) => return Err(format!("Unknown WAV format {c}")),
        };
        cmd.args(["-map", "0:a:0", "-map_metadata", "0", "-c:a", codec]);
        if let Some(r) = job.sample_rate {
            cmd.args(["-ar", &r.to_string()]);
        }
        cmd.args(["-f", "wav"]);
    } else {
        cmd.args(["-map", "0:v:0", "-map", "0:a?", "-map_metadata", "0"]);
        if let Some(h) = job.max_height.filter(|h| *h < job.source_height && job.preset != "copy") {
            cmd.args(["-vf", &format!("scale=-2:{h}:flags=lanczos")]);
        }
        cmd.args(preset_args(&job.preset)?).args(["-f", "mov", "-movflags", "+write_colr"]);
    }
    cmd.arg(&partial)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    jobs.register(&job.id, child);

    let total_us = (job.duration * 1_000_000.0).max(1.0);
    let mut p = Progress { id: job.id.clone(), progress: 0.0, fps: 0.0, speed: String::new(), out_size: 0 };
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Some((k, v)) = line.split_once('=') else { continue };
        match k {
            "out_time_us" => p.progress = (v.parse::<f64>().unwrap_or(0.0) / total_us).clamp(0.0, 1.0),
            "fps" => p.fps = v.parse().unwrap_or(0.0),
            "speed" => p.speed = v.trim().to_string(),
            "total_size" => p.out_size = v.parse().unwrap_or(0),
            // ffmpeg ends each progress block with "progress=continue|end".
            "progress" => {
                let _ = app.emit("convert-progress", p.clone());
            }
            _ => {}
        }
    }

    let outcome = jobs.finish(&job.id);
    let stderr_text = err_reader.join().unwrap_or_default();
    match outcome {
        Outcome::Exited(Some(s)) if s.success() => {
            std::fs::rename(&partial, &output).map_err(|e| e.to_string())?;
            Ok(output.to_string_lossy().to_string())
        }
        Outcome::Cancelled => {
            let _ = std::fs::remove_file(&partial);
            Err("Cancelled".into())
        }
        Outcome::Exited(_) => {
            let _ = std::fs::remove_file(&partial);
            Err(stderr_text.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("ffmpeg failed").to_string())
        }
    }
}
