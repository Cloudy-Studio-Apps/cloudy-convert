# Cloudy Convert

Part of the Cloudy Studio family. Two tools in one small desktop app:

- **Convert for editing**: turn camera and drone MP4s into DNxHR / ProRes `.mov` files that DaVinci Resolve opens on Linux, with a preview and drag-and-drop into your timeline.
- **Download from the web**: save video (MP4) and music (MP3) from YouTube, Vimeo, TikTok, Instagram and many more sites, using yt-dlp.

Built with Tauri v2 (Rust) and React + TypeScript.

## Develop

Requirements: Node 20+, pnpm, Rust (stable), the [Tauri prerequisites](https://tauri.app/start/prerequisites/), and FFmpeg on `PATH`.

```sh
pnpm install
pnpm tauri dev
```

Windows release build (bundles FFmpeg): `pnpm release:win`.

## Icon

`src-tauri/icons/app-icon.svg` is the source (drawn in cloudy-launcher as `ConvertSealLogo`). Regenerate the set with:

```sh
rsvg-convert -w 1024 -h 1024 src-tauri/icons/app-icon.svg -o /tmp/icon.png && pnpm tauri icon /tmp/icon.png
```
