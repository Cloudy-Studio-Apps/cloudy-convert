/** Human-friendly formatting of sizes, durations and media properties. */

export function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 3 ? 2 : i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return "0:00";
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function fmtFps(fps: number): string {
  return Number.isInteger(Math.round(fps * 100) / 100) ? String(Math.round(fps)) : fps.toFixed(2);
}

const CODECS: Record<string, string> = { h264: "H.264", hevc: "H.265", prores: "ProRes", dnxhd: "DNxHR", av1: "AV1", vp9: "VP9" };
export const fmtCodec = (c: string) => CODECS[c] ?? c.toUpperCase();

export function fmtPixFmt(p: string): string {
  const depth = /p10|p12/.test(p) ? (p.includes("12") ? "12-bit" : "10-bit") : "8-bit";
  const chroma = p.includes("444") ? "4:4:4" : p.includes("422") ? "4:2:2" : "4:2:0";
  return `${depth} ${chroma}`;
}

/** Bytes per second → "4.2 MB/s". */
export const fmtSpeed = (bps: number) => `${fmtBytes(bps)}/s`;

/** Seconds remaining → "1:05" (or "—" when unknown). */
export const fmtEta = (s: number | null) => (s === null || !isFinite(s) ? "—" : fmtDuration(Math.max(1, s)));
