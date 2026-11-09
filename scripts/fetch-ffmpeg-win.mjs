// Downloads the Windows builds of ffmpeg.exe / ffprobe.exe into src-tauri/binaries/windows/,
// which `tauri.windows.conf.json` bundles next to the app executable. The downloader needs them
// to turn YouTube audio into MP3 (yt-dlp calls ffmpeg for that); `tools::locate` finds them there.
//
// The build comes from yt-dlp's own ffmpeg builds (patched for yt-dlp). Skipped if already present;
// pass --force to re-download.
import { existsSync, mkdirSync, rmSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries", "windows");
const wanted = ["ffmpeg.exe", "ffprobe.exe"];

if (!process.argv.includes("--force") && wanted.every((f) => existsSync(join(outDir, f)))) {
  console.log("ffmpeg for Windows already present, skipping download.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const zip = join(outDir, "ffmpeg.zip");
console.log(`Downloading ${URL} ...`);
const res = await fetch(URL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

// -j: drop the archive's folder structure, -o: overwrite.
execFileSync("unzip", ["-j", "-o", zip, ...wanted.map((f) => `*/bin/${f}`), "-d", outDir], { stdio: "inherit" });
rmSync(zip);
for (const f of wanted) if (!existsSync(join(outDir, f))) throw new Error(`${f} missing from the archive`);
console.log("ffmpeg for Windows ready.");
