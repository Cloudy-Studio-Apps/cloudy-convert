// Bits per pixel measured with ffmpeg on 4K59.94 DJI footage (DNxHR is constant bitrate,
// so its estimates are near-exact; ProRes is variable, so treat those as ballpark).
export interface Preset {
  id: string;
  label: string;
  group: string;
  bpp: number | null; // null = stream copy (output ≈ input size)
  note: string;
}

export const PRESETS: Preset[] = [
  { id: "dnxhr_hq", group: "DNxHR (recommended for Resolve)", label: "DNxHR HQ · 8-bit 4:2:2", bpp: 3.51, note: "Best balance for 8-bit cameras like the DJI Air 3. Visually lossless." },
  { id: "dnxhr_hqx", group: "DNxHR (recommended for Resolve)", label: "DNxHR HQX · 10-bit 4:2:2", bpp: 3.51, note: "Use for 10-bit / D-Log M footage. Same size as HQ." },
  { id: "dnxhr_sq", group: "DNxHR (recommended for Resolve)", label: "DNxHR SQ · 8-bit 4:2:2", bpp: 2.32, note: "Standard quality, ~⅓ smaller than HQ." },
  { id: "dnxhr_lb", group: "DNxHR (recommended for Resolve)", label: "DNxHR LB · proxy", bpp: 0.72, note: "Low bandwidth. Good for proxies / offline editing." },
  { id: "prores_hq", group: "Apple ProRes", label: "ProRes 422 HQ · 10-bit", bpp: 3.73, note: "Highest ProRes quality. Size varies with content." },
  { id: "prores_422", group: "Apple ProRes", label: "ProRes 422 · 10-bit", bpp: 2.49, note: "Standard ProRes. Size varies with content." },
  { id: "prores_lt", group: "Apple ProRes", label: "ProRes 422 LT · 10-bit", bpp: 1.75, note: "Lighter ProRes. Size varies with content." },
  { id: "prores_proxy", group: "Apple ProRes", label: "ProRes 422 Proxy", bpp: 0.76, note: "Smallest ProRes, for proxies." },
  { id: "copy", group: "Other", label: "Rewrap only (keep H.264)", bpp: null, note: "Fast, same size — but Resolve free on Linux still can't decode H.264/H.265." },
];

/** Output formats for audio-only files (ids match `convert.rs`). */
export const WAV_PRESETS = [
  { id: "pcm_s16le", label: "WAV · 16-bit PCM", bytes: 2, note: "CD quality. Plenty for voice notes; works everywhere." },
  { id: "pcm_s24le", label: "WAV · 24-bit PCM", bytes: 3, note: "More headroom for mixing. 50% larger than 16-bit." },
];

export const SAMPLE_RATES = [
  { value: 0, label: "Original" },
  { value: 48000, label: "48 kHz" },
  { value: 44100, label: "44.1 kHz" },
];

export const wavPresetById = (id: string) => WAV_PRESETS.find((p) => p.id === id) ?? WAV_PRESETS[0];

export const RESOLUTIONS = [
  { value: 0, label: "Original" },
  { value: 2160, label: "2160p (4K)" },
  { value: 1440, label: "1440p" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function outputDims(w: number, h: number, maxHeight: number) {
  if (!maxHeight || h <= maxHeight) return { w, h };
  return { w: Math.round((w * maxHeight) / h / 2) * 2, h: maxHeight };
}

export interface EstimateInput {
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  audioCodec: string | null;
  sampleRate: number;
  channels: number;
}

/** Output settings that affect the estimate. */
export interface EstimateSettings {
  preset: string;
  maxHeight: number;
  wavPreset: string;
  sampleRate: number;
}

export function estimateSize(info: EstimateInput, s: EstimateSettings): number {
  if (!info.hasVideo) {
    const rate = s.sampleRate || info.sampleRate || 48000;
    return rate * (info.channels || 2) * wavPresetById(s.wavPreset).bytes * info.duration;
  }
  const { preset: presetId, maxHeight } = s;
  const preset = presetById(presetId);
  if (preset.bpp === null) return info.size;
  const { w, h } = outputDims(info.width, info.height, maxHeight);
  const video = (preset.bpp * w * h * info.fps * info.duration) / 8;
  const audio = info.audioCodec ? 48000 * 2 * 2 * info.duration : 0; // PCM s16 stereo
  return video + audio;
}
