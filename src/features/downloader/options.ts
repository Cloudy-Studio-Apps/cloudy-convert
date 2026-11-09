/**
 * Download formats and qualities, and size estimates from the formats a site offers.
 *
 * To add a format: add it to `FORMATS`, give it a quality list in `qualityChoices`, and teach
 * `build_args` in `src-tauri/src/downloader.rs` how to download it.
 */
import type { RemoteFormat, VideoInfo } from "../../lib/api";

export type DownloadFormat = "mp4" | "mp3";

export const FORMATS: { id: DownloadFormat; label: string; sub: string }[] = [
  { id: "mp4", label: "MP4", sub: "Video" },
  { id: "mp3", label: "MP3", sub: "Audio only" },
];

/** Max video heights; 0 = best available. */
export const VIDEO_QUALITIES = [0, 2160, 1440, 1080, 720, 480, 360];
/** MP3 bitrates in kbps; 0 = best VBR (LAME V0, averages ~245 kbps). */
export const AUDIO_QUALITIES = [0, 320, 256, 192, 128];
const BEST_MP3_KBPS = 245;

export const DEFAULT_QUALITY: Record<DownloadFormat, number> = { mp4: 1080, mp3: 0 };

const HEIGHT_NAMES: Record<number, string> = { 2160: "4K", 1440: "2K" };

export function qualityLabel(format: DownloadFormat, q: number): string {
  if (format === "mp3") return q ? `${q} kbps` : "Best (VBR ~245 kbps)";
  if (!q) return "Best available";
  return HEIGHT_NAMES[q] ? `${q}p (${HEIGHT_NAMES[q]})` : `${q}p`;
}

/** Tallest video height a link offers (0 if unknown). */
export function maxHeight(info: VideoInfo): number {
  return Math.max(0, ...info.formats.filter((f) => f.hasVideo && f.height).map((f) => f.height!));
}

/**
 * Qualities worth offering for a link: heights above what the video has are dropped
 * (they'd just give the same file as "Best").
 */
export function qualityChoices(format: DownloadFormat, info?: VideoInfo): number[] {
  if (format === "mp3") return AUDIO_QUALITIES;
  const top = info ? maxHeight(info) : 0;
  return VIDEO_QUALITIES.filter((q) => q === 0 || !info || (top > 0 && q <= top));
}

/** Picks the quality to use for a link: the wanted one if offered, otherwise the closest lower one. */
export function fitQuality(format: DownloadFormat, wanted: number, info?: VideoInfo): number {
  const choices = qualityChoices(format, info);
  if (choices.includes(wanted)) return wanted;
  return choices.filter((q) => q !== 0 && q < wanted)[0] ?? 0;
}

const isH264 = (f: RemoteFormat) => /^(avc|h264)/i.test(f.vcodec ?? "");
const biggest = (fs: RemoteFormat[]) => fs.reduce<RemoteFormat | undefined>((a, f) => ((f.size ?? 0) > (a?.size ?? 0) ? f : a), undefined);

/**
 * Approximate size in bytes, mirroring the format yt-dlp will choose (see `build_args`):
 * the tallest video ≤ the cap (H.264 preferred when `compatible`) plus the best audio.
 * Returns null when the site doesn't give enough information.
 */
export function estimateDownload(info: VideoInfo, format: DownloadFormat, quality: number, compatible: boolean): number | null {
  if (format === "mp3") {
    return info.duration ? (info.duration * (quality || BEST_MP3_KBPS) * 1000) / 8 : null;
  }
  const videos = info.formats.filter((f) => f.hasVideo && f.height);
  if (!videos.length) return biggest(info.formats)?.size ?? null;

  const cap = quality || Infinity;
  const fitting = videos.filter((f) => f.height! <= cap);
  const pool = fitting.length ? fitting : videos;
  const top = Math.max(...pool.map((f) => f.height!));
  const atTop = pool.filter((f) => f.height === top);
  const preferred = compatible && atTop.some(isH264) ? atTop.filter(isH264) : atTop;
  const video = biggest(preferred);
  if (!video?.size) return null;
  if (video.hasAudio) return video.size;

  const audios = info.formats.filter((f) => f.hasAudio && !f.hasVideo);
  const preferredAudio = compatible && audios.some((f) => f.ext === "m4a") ? audios.filter((f) => f.ext === "m4a") : audios;
  return video.size + (biggest(preferredAudio)?.size ?? 0);
}

/** Readable names for yt-dlp's post-processing steps. */
const STEPS: Record<string, string> = {
  Merger: "Merging video + audio",
  ExtractAudio: "Converting to MP3",
  VideoRemuxer: "Packing into MP4",
  VideoConvertor: "Converting to MP4",
  EmbedThumbnail: "Adding cover art",
  Metadata: "Writing title & artist",
  FFmpegMetadata: "Writing title & artist",
  MoveFiles: "Finishing",
};
export const stepLabel = (step: string | null) => (step ? (STEPS[step] ?? step) : "Processing");

/** Pulls every http(s) link out of pasted text. */
export function extractUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
}
