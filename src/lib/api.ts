/**
 * Typed bridge to the Rust backend (`src-tauri/src`).
 *
 * Every `invoke()` and backend event the UI uses goes through this file, so the contract between
 * the two sides is in one place. Names and payload shapes must match the Rust commands.
 */
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ─── Local media (media.rs) ──────────────────────────────────────────────────

export interface MediaInfo {
  path: string;
  name: string;
  dir: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  /** False for audio-only files (converted to .wav); the video fields are then empty. */
  hasVideo: boolean;
  videoCodec: string;
  pixFmt: string;
  audioCodec: string | null;
  sampleRate: number;
  channels: number;
  /** JPEG on disk, used as the drag icon. */
  thumbPath: string | null;
  /** Same thumbnail as a data URL, for <img>. */
  thumbData: string | null;
}

export const checkFfmpeg = () => invoke<string>("check_ffmpeg");
/** Folders → the video/audio files inside them; files are kept if they're videos or audio. */
export const expandPaths = (paths: string[]) => invoke<string[]>("expand_paths", { paths });
export const probeFile = (path: string) => invoke<MediaInfo>("probe_file", { path });
export const fileSize = (path: string) => invoke<number>("file_size", { path });
export const diskFree = (path: string) => invoke<number | null>("disk_free", { path });
export const downloadsDir = () => invoke<string | null>("downloads_dir");
/** Generic drag icon for files without a thumbnail (e.g. MP3). */
export const fallbackIcon = () => invoke<string | null>("fallback_icon");

/** Cancels a running conversion or download by its id. */
export const cancelJob = (id: string) => invoke<void>("cancel_job", { id });

// ─── Conversion (convert.rs) ─────────────────────────────────────────────────

export interface ConvertJob {
  id: string;
  input: string;
  outputDir: string | null;
  preset: string;
  maxHeight: number | null;
  sourceHeight: number;
  duration: number;
  overwrite: boolean;
  /** Writes a PCM .wav instead of a .mov. */
  audioOnly: boolean;
  /** .wav sample format (audio-only files). */
  wavCodec: string;
  /** .wav resample target; null keeps the source rate. */
  sampleRate: number | null;
}

export interface ConvertProgress {
  id: string;
  progress: number;
  fps: number;
  speed: string;
  outSize: number;
}

/** Resolves to the output path; rejects with "Cancelled" when stopped. */
export const convert = (job: ConvertJob) => invoke<string>("convert", { job });
export const onConvertProgress = (cb: (p: ConvertProgress) => void): Promise<UnlistenFn> =>
  listen<ConvertProgress>("convert-progress", (e) => cb(e.payload));

// ─── Preview (preview.rs) ────────────────────────────────────────────────────

/** One exact frame as a JPEG data URL. */
export const previewFrame = (path: string, time: number, width: number) =>
  invoke<string>("preview_frame", { path, time, width });

/**
 * Starts streaming frames into `channel`. Each message is an ArrayBuffer: an 8-byte little-endian
 * timestamp followed by a JPEG. Timestamp -1 = ended, -2 = error (followed by the message text).
 */
export const previewPlay = (args: { path: string; start: number; speed: number; fps: number; width: number }, channel: Channel<ArrayBuffer>) =>
  invoke<void>("preview_play", { ...args, onFrame: channel });
export const previewStop = () => invoke<void>("preview_stop");

// ─── yt-dlp engine (installer.rs) ────────────────────────────────────────────

export interface YtDlpStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  /** True when the app installed it itself (and can update it). */
  managed: boolean;
}

export const ytdlpStatus = () => invoke<YtDlpStatus>("ytdlp_status");
/** Installs or updates yt-dlp; progress arrives via `onYtdlpInstallProgress`. */
export const ytdlpInstall = () => invoke<YtDlpStatus>("ytdlp_install");
export const onYtdlpInstallProgress = (cb: (p: { downloaded: number; total: number | null }) => void) =>
  listen<{ downloaded: number; total: number | null }>("ytdlp-install-progress", (e) => cb(e.payload));

// ─── Downloads (downloader.rs) ───────────────────────────────────────────────

export interface RemoteFormat {
  id: string;
  ext: string;
  hasVideo: boolean;
  hasAudio: boolean;
  vcodec: string | null;
  height: number | null;
  fps: number | null;
  /** Bytes, exact or approximate; null when unknown. */
  size: number | null;
}

export interface VideoInfo {
  kind: "video";
  id: string;
  url: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  site: string;
  isLive: boolean;
  formats: RemoteFormat[];
}

export interface PlaylistInfo {
  kind: "playlist";
  title: string;
  entries: { url: string; title: string | null; duration: number | null }[];
}

export type RemoteInfo = VideoInfo | PlaylistInfo;

export interface DownloadJob {
  id: string;
  url: string;
  format: "mp4" | "mp3";
  /** MP4: max height. MP3: kbps. 0 = best. */
  quality: number;
  /** MP4: prefer H.264/AAC for compatibility. */
  compatible: boolean;
  outputDir: string;
}

export interface DownloadProgress {
  id: string;
  stage: "downloading" | "processing";
  /** 1-based file index: video and audio streams are downloaded one after the other. */
  part: number;
  downloaded: number;
  total: number | null;
  speed: number | null;
  eta: number | null;
  /** yt-dlp post-processor while processing ("Merger", "ExtractAudio", …). */
  step: string | null;
}

export const fetchInfo = (url: string) => invoke<RemoteInfo>("fetch_info", { url });
/** Resolves to the saved file's path; rejects with "Cancelled" when stopped. */
export const download = (job: DownloadJob) => invoke<string>("download", { job });
export const onDownloadProgress = (cb: (p: DownloadProgress) => void) =>
  listen<DownloadProgress>("download-progress", (e) => cb(e.payload));
