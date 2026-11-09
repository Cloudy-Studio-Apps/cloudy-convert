//! Video preview decoded by ffmpeg instead of the webview's `<video>`.
//!
//! The webview depends on OS codecs (GStreamer on Linux; WebView2 can't play DNxHR/ProRes at all),
//! so the player instead receives JPEG frames:
//!   * `preview_frame` — one exact frame, for scrubbing and frame stepping while paused.
//!   * `preview_play`  — a paced MJPEG stream over a Tauri channel while playing.

use crate::media::jpeg_data_url;
use crate::tools::{self, Tool};
use std::io::Read;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

/// Only one preview stream runs at a time. Every new stream (or stop) bumps `generation`,
/// which makes the old stream's thread notice and quit.
#[derive(Default)]
pub struct Previewer {
    generation: AtomicU64,
    child: Mutex<Option<Child>>,
}

impl Previewer {
    /// Kills the running stream (if any) and returns the generation for the next one.
    fn reset(&self) -> u64 {
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }
}

/// Single frame as a JPEG data URL.
#[tauri::command]
pub async fn preview_frame(path: String, time: f64, width: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = tools::command(Tool::Ffmpeg)?
            .args(["-v", "error", "-ss", &format!("{:.3}", time.max(0.0)), "-i", &path, "-map", "0:v:0", "-frames:v", "1"])
            .args(["-vf", &format!("scale={width}:-2"), "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "pipe:1"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.stdout.is_empty() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(jpeg_data_url(&out.stdout))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Channel message layout: 8-byte little-endian f64 timestamp, then the JPEG.
/// A bare timestamp of -1 means the clip ended; -2 is followed by an error message.
fn frame_msg(t: f64, body: &[u8]) -> InvokeResponseBody {
    let mut v = Vec::with_capacity(8 + body.len());
    v.extend_from_slice(&t.to_le_bytes());
    v.extend_from_slice(body);
    InvokeResponseBody::Raw(v)
}

/// Position just past the next complete JPEG (SOI … SOS … EOI) in `buf`.
/// Searching for EOI only after SOS avoids false matches inside the header/thumbnail.
fn jpeg_end(buf: &[u8]) -> Option<usize> {
    let sos = buf.windows(2).position(|w| w == [0xFF, 0xDA])?;
    buf[sos..].windows(2).position(|w| w == [0xFF, 0xD9]).map(|i| sos + i + 2)
}

#[tauri::command]
pub fn preview_play(
    previewer: State<'_, Arc<Previewer>>,
    path: String,
    start: f64,
    speed: f64,
    fps: f64,
    width: u32,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let previewer = previewer.inner().clone();
    let generation = previewer.reset();
    let out_fps = if fps > 0.0 { fps.min(30.0) } else { 30.0 };
    let speed = speed.clamp(0.1, 4.0);

    let mut child = tools::command(Tool::Ffmpeg)?
        .args(["-v", "error", "-ss", &format!("{:.3}", start.max(0.0)), "-i", &path, "-map", "0:v:0", "-an"])
        .args(["-vf", &format!("fps={out_fps},scale={width}:-2"), "-c:v", "mjpeg", "-q:v", "6", "-f", "image2pipe", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    *previewer.child.lock().unwrap() = Some(child);

    std::thread::spawn(move || {
        let current = || previewer.generation.load(Ordering::SeqCst) == generation;
        let began = Instant::now();
        let mut buf: Vec<u8> = Vec::with_capacity(512 * 1024);
        let mut chunk = vec![0u8; 256 * 1024];
        let mut n: u64 = 0;
        loop {
            while let Some(end) = jpeg_end(&buf) {
                // Pace to wall clock; blocking here also back-pressures ffmpeg through the pipe.
                let due = began + Duration::from_secs_f64(n as f64 / out_fps / speed);
                if let Some(wait) = due.checked_duration_since(Instant::now()) {
                    std::thread::sleep(wait);
                }
                if !current() {
                    return;
                }
                let t = start + n as f64 / out_fps;
                if on_frame.send(frame_msg(t, &buf[..end])).is_err() {
                    previewer.reset();
                    return;
                }
                buf.drain(..end);
                n += 1;
            }
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(k) => buf.extend_from_slice(&chunk[..k]),
            }
        }
        if !current() {
            return;
        }
        let mut err = String::new();
        let _ = stderr.read_to_string(&mut err);
        let msg = if n == 0 && !err.trim().is_empty() { frame_msg(-2.0, err.trim().as_bytes()) } else { frame_msg(-1.0, &[]) };
        let _ = on_frame.send(msg);
        if let Some(mut c) = previewer.child.lock().unwrap().take() {
            let _ = c.wait();
        }
    });
    Ok(())
}

#[tauri::command]
pub fn preview_stop(previewer: State<'_, Arc<Previewer>>) {
    previewer.reset();
}

#[cfg(test)]
mod tests {
    use super::jpeg_end;

    #[test]
    fn finds_jpeg_boundary_after_scan_start() {
        // SOI, a fake EOI inside the header, SOS, data, real EOI, then the next frame's SOI.
        let buf = [0xFF, 0xD8, 0xFF, 0xD9, 0xFF, 0xDA, 1, 2, 0xFF, 0xD9, 0xFF, 0xD8];
        assert_eq!(jpeg_end(&buf), Some(10));
        assert_eq!(jpeg_end(&buf[..8]), None);
    }
}
