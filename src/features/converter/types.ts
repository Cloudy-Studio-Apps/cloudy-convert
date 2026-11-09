import type { MediaInfo } from "../../lib/api";

/** Lifecycle of a file in the conversion list. */
export type ConvertStatus = "probing" | "ready" | "queued" | "converting" | "done" | "error" | "cancelled";

/** One file in the conversion list. */
export interface ConvertItem {
  id: string;
  path: string;
  status: ConvertStatus;
  /** Ticked for the next batch. */
  selected: boolean;
  /** Filled in once ffprobe has read the file. */
  info?: MediaInfo;
  /** 0–1 while converting. */
  progress: number;
  /** ffmpeg's speed, e.g. "1.8x". */
  speed: string;
  outputPath?: string;
  finalSize?: number;
  error?: string;
}

/** Converter options, saved between sessions. */
export interface ConvertSettings {
  preset: string;
  /** 0 = keep the original resolution. */
  maxHeight: number;
  /** .wav format for audio-only files (id from `WAV_PRESETS`). */
  wavPreset: string;
  /** 0 = keep the original sample rate. */
  sampleRate: number;
  outputMode: "same" | "custom";
  customDir: string;
  overwrite: boolean;
}

export const DEFAULT_CONVERT_SETTINGS: ConvertSettings = {
  preset: "dnxhr_hq",
  maxHeight: 0,
  wavPreset: "pcm_s16le",
  sampleRate: 0,
  outputMode: "same",
  customDir: "",
  overwrite: false,
};
