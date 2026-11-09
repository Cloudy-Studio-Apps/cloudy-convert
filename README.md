# Cloudy Convert

Convert camera and drone footage for editing, and download video or music from the web. Part of the
Cloudy Studio family, built with Tauri 2, React 19, TypeScript and Vite.

Install it with the [Cloudy Launcher](https://github.com/Cloudy-Studio-Apps/cloudy-launcher), or
grab the installer from the [latest release](https://github.com/Cloudy-Studio-Apps/cloudy-convert/releases/latest).

## What it does

**Convert for editing.** DaVinci Resolve's free edition on Linux can't decode H.264/H.265, so
Cloudy Convert turns MP4s into `.mov` files it opens:

- DNxHR HQ, HQX (10-bit), SQ and LB (proxy), the recommended formats for Resolve
- Apple ProRes 422 HQ, 422, LT and Proxy
- Rewrap only (keeps the original codec, no re-encode)
- Audio-only files to 16-bit or 24-bit WAV
- Optional resolution and sample-rate changes, an estimated output size before converting, a
  preview of each clip, and drag-and-drop of the results straight into your timeline

**Download from the web.** Save video (MP4) or music (MP3) from YouTube, Vimeo, TikTok, Instagram
and 1000+ other sites, including playlists and up to 4K, with the size shown before you download.

Conversions and downloads keep running while you switch between tools.

## External tools

| Tool | Used for | Where it comes from |
| --- | --- | --- |
| FFmpeg (`ffmpeg`, `ffprobe`) | Converting, previews, MP3 extraction | Linux: your system (`sudo pacman -S ffmpeg`, `sudo apt install ffmpeg`). Windows: bundled with the installer. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Downloading | Installed and updated from inside the app, into its own data folder. Nothing system-wide. |

Each tool is looked up in the app's own `bin` folder first, then next to the executable, then on
`PATH` (`src-tauri/src/tools.rs`). If downloads start failing, update yt-dlp from the app first:
sites change often.

## Development

Requirements: Node 20+, pnpm, Rust (stable), the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS, and FFmpeg on `PATH`.

```sh
pnpm install
pnpm tauri dev
```

## Release builds

| Command | Builds | Output |
| --- | --- | --- |
| `pnpm release:linux` | The `.deb`, `.rpm` and AppImage | `src-tauri/target/release/bundle/` |
| `pnpm release:arch` | A pacman package with the desktop entry | `packaging/arch/` |
| `pnpm release:win` | The Windows NSIS installer, cross-built with `cargo-xwin`, with FFmpeg bundled | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` |

`pnpm release:win` first downloads the Windows FFmpeg build into `src-tauri/binaries/windows/`
(`scripts/fetch-ffmpeg-win.mjs`, skipped if already there). The release workflow does the same on
its Windows runner.

### Publishing a release

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) when a version tag is pushed:

```sh
pnpm release:tag 0.2.0   # writes the version, commits "Release v0.2.0", tags v0.2.0 and pushes
```

The workflow builds the Windows installer, the `.deb`, the `.rpm`, the AppImage and the Arch package into a draft release, signs the installers and publishes it once every build passed. The Cloudy Launcher then offers the update. If a build fails, the draft stays unpublished: re-run the failed job and the release is published when it passes.

The installers are signed with the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` organization secrets, the one key every Cloudy app uses: the launcher refuses an installer whose `.sig` doesn't match it. The workflow stops at its first step if they aren't available to the repository.

## Architecture

```
src/
  App.tsx                 startup checks, switching between home and the tools
  features/home/          tool picker
  features/converter/     queue, presets (DNxHR / ProRes / WAV), preview
  features/downloader/    URL lookup, format and quality options, yt-dlp setup
  components/, lib/       shared UI, invoke() wrappers, formatting helpers
src-tauri/src/
  tools.rs                finds ffmpeg / ffprobe / yt-dlp and builds their commands
  jobs.rs                 tracks running processes so they can be cancelled
  media.rs                probing files, thumbnails, file-system helpers
  convert.rs              MP4 → .mov (DNxHR / ProRes), audio → WAV
  preview.rs              ffmpeg-decoded preview frames
  installer.rs            installs / updates yt-dlp in the app's data folder
  downloader.rs           downloads as MP4 or MP3
```

## Icon

The source is `src-tauri/icons/app-icon.svg`, the same art as `ConvertSealLogo` in the launcher.
Regenerate the icon set with:

```sh
rsvg-convert -w 1024 -h 1024 src-tauri/icons/app-icon.svg -o icon.png
pnpm tauri icon icon.png && rm icon.png
```
