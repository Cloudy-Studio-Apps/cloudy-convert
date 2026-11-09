import type { DownloadProgress, VideoInfo } from "../../lib/api";
import type { DownloadFormat } from "./options";

/** Lifecycle of a link in the download list. */
export type DownloadStatus = "fetching" | "ready" | "queued" | "downloading" | "done" | "error" | "cancelled";

/** One link in the download list. */
export interface DownloadItem {
  id: string;
  url: string;
  status: DownloadStatus;
  /** Title known before the full info arrives (e.g. from a playlist listing). */
  placeholderTitle?: string;
  /** Filled in once yt-dlp has read the link. */
  info?: VideoInfo;
  format: DownloadFormat;
  /** Height (MP4) or kbps (MP3); 0 = best. */
  quality: number;
  progress?: DownloadProgress;
  outputPath?: string;
  finalSize?: number;
  error?: string;
}

/** Downloader options, saved between sessions. They're the defaults for newly added links. */
export interface DownloadSettings {
  format: DownloadFormat;
  videoQuality: number;
  audioQuality: number;
  /** Prefer H.264/AAC in MP4s so they play everywhere. */
  compatible: boolean;
  /** "" = the system Downloads folder. */
  outputDir: string;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  format: "mp4",
  videoQuality: 1080,
  audioQuality: 0,
  compatible: true,
  outputDir: "",
};

export const defaultQuality = (s: DownloadSettings, format: DownloadFormat) => (format === "mp3" ? s.audioQuality : s.videoQuality);

/** Items that can still be (re)downloaded. */
export const isPending = (i: DownloadItem) => !!i.info && (i.status === "ready" || i.status === "error" || i.status === "cancelled");
