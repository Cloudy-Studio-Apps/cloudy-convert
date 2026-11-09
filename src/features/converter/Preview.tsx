/**
 * Video preview panel: play, scrub and frame-step through a clip.
 *
 * Frames are decoded by ffmpeg in the backend (see `preview.rs`) and drawn on a <canvas>, so
 * playback doesn't depend on the webview's codecs (GStreamer on Linux, WebView2 on Windows —
 * neither plays DNxHR/ProRes reliably).
 *   - While playing, a paced MJPEG stream arrives over a Tauri channel.
 *   - While paused (seek / step), single exact frames are requested; only the latest request wins.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { previewFrame, previewPlay, previewStop } from "../../lib/api";
import { fmtFps } from "../../lib/format";
import { PlayGlyph } from "../../components/Icons";

/** Clip to show, plus the converted file when there is one (for the Original/Converted toggle). */
export interface PreviewSource {
  id: string;
  name: string;
  path: string;
  convertedPath?: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  thumbData: string | null;
}

const STREAM_WIDTH = 960; // playback frames: small enough to stream fast
const STILL_WIDTH = 1280; // paused frames: sharper
const SPEEDS = [0.25, 0.5, 1, 2];

function fmtTimecode(t: number, fps: number) {
  const f = Math.max(1, Math.round(fps));
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const fr = Math.floor((total - Math.floor(total)) * f);
  return `${m}:${String(s).padStart(2, "0")}:${String(fr).padStart(2, "0")}`;
}

export default function Preview({ source, onClose }: { source: PreviewSource | null; onClose: () => void }) {
  const [which, setWhich] = useState<"original" | "converted">("original");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const session = useRef(0); // bumps on every play/pause/seek so stale frames are ignored
  const stillReq = useRef<{ inFlight: boolean; pending: number | null }>({ inFlight: false, pending: null });

  const path = source ? (which === "converted" && source.convertedPath ? source.convertedPath : source.path) : null;
  const fps = source?.fps || 30;
  const duration = source?.duration ?? 0;

  const draw = useCallback((img: CanvasImageSource & { width: number; height: number }) => {
    const c = canvasRef.current;
    if (!c) return;
    if (c.width !== img.width || c.height !== img.height) {
      c.width = img.width;
      c.height = img.height;
    }
    c.getContext("2d")?.drawImage(img, 0, 0);
  }, []);

  const drawUrl = useCallback(
    (url: string) => {
      const img = new Image();
      img.onload = () => draw(img);
      img.src = url;
    },
    [draw],
  );

  const stopStream = useCallback(() => {
    session.current++;
    if (playingRef.current) previewStop();
    playingRef.current = false;
    setPlaying(false);
    setBuffering(false);
  }, []);

  // Accurate single frame for scrubbing / stepping; only the latest request matters.
  const showStill = useCallback(
    async (t: number) => {
      if (!path) return;
      const req = stillReq.current;
      if (req.inFlight) {
        req.pending = t;
        return;
      }
      req.inFlight = true;
      const mySession = session.current;
      try {
        const url = await previewFrame(path, t, STILL_WIDTH);
        if (session.current === mySession) drawUrl(url);
      } catch (e) {
        setError(String(e));
      } finally {
        req.inFlight = false;
        if (req.pending !== null) {
          const next = req.pending;
          req.pending = null;
          showStill(next);
        }
      }
    },
    [path, drawUrl],
  );

  const play = useCallback(
    (from: number, rate: number) => {
      if (!path) return;
      const mySession = ++session.current;
      const ch = new Channel<ArrayBuffer>();
      ch.onmessage = async (buf) => {
        if (session.current !== mySession) return;
        const t = new DataView(buf).getFloat64(0, true);
        if (t === -1) {
          // ended
          playingRef.current = false;
          setPlaying(false);
          setBuffering(false);
          timeRef.current = duration;
          setTime(duration);
          return;
        }
        if (t === -2) {
          playingRef.current = false;
          setPlaying(false);
          setBuffering(false);
          setError(new TextDecoder().decode(buf.slice(8)));
          return;
        }
        const bmp = await createImageBitmap(new Blob([buf.slice(8)], { type: "image/jpeg" }));
        if (session.current !== mySession) return bmp.close();
        draw(bmp);
        bmp.close();
        setBuffering(false);
        timeRef.current = t;
        setTime(t);
      };
      playingRef.current = true;
      setPlaying(true);
      setBuffering(true);
      setError(null);
      previewPlay({ path, start: from, speed: rate, fps, width: STREAM_WIDTH }, ch).catch((e) => {
        playingRef.current = false;
        setPlaying(false);
        setBuffering(false);
        setError(String(e));
      });
    },
    [path, fps, duration, draw],
  );

  // New clip (or original/converted switch): stop, rewind, show the first frame.
  useEffect(() => {
    stopStream();
    timeRef.current = 0;
    setTime(0);
    setError(null);
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    if (source?.thumbData) drawUrl(source.thumbData);
    if (path) showStill(0);
  }, [path]);

  useEffect(() => {
    if (!source?.convertedPath) setWhich("original");
  }, [source?.id, source?.convertedPath]);

  // Stop the backend stream when the panel closes.
  useEffect(() => () => void previewStop(), []);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(0, t), duration);
      if (playingRef.current) stopStream();
      timeRef.current = clamped;
      setTime(clamped);
      showStill(clamped);
    },
    [duration, stopStream, showStill],
  );

  const togglePlay = useCallback(() => {
    if (!path) return;
    if (playingRef.current) {
      stopStream();
      showStill(timeRef.current); // exact frame where we paused
    } else {
      play(timeRef.current >= duration - 0.05 ? 0 : timeRef.current, speed);
    }
  }, [path, duration, speed, play, stopStream, showStill]);

  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (playingRef.current) play(timeRef.current, s);
  };

  const step = useCallback((frames: number) => seek(timeRef.current + frames / fps), [fps, seek]);

  // Keyboard: Space play/pause, ←/→ frame step, Shift+←/→ 1 second, Esc close.
  useEffect(() => {
    if (!source) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "SELECT" || (el?.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.shiftKey) seek(timeRef.current + dir);
        else step(dir);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [source, togglePlay, seek, step, onClose]);

  if (!source) {
    return (
      <section className="preview">
        <div className="preview-stage empty-stage">
          <p>Right-click a clip → <b>Open in preview</b>, or press its ▶ button.</p>
        </div>
        <div className="preview-bar">
          <span className="muted">No clip loaded</span>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} title="Close preview (Esc)">×</button>
        </div>
      </section>
    );
  }

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <section className="preview">
      <div className="preview-stage" onClick={togglePlay}>
        <canvas ref={canvasRef} />
        {buffering && <span className="spinner stage-spinner" />}
        {!playing && (
          <span className="big-play" aria-hidden>
            <PlayGlyph size={26} />
          </span>
        )}
      </div>

      {error && <div className="preview-note">{error}</div>}

      <div className="scrub">
        <div className="scrub-fill" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={0}
          max={duration}
          step={1 / fps}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
        />
      </div>

      <div className="preview-bar">
        <button className="icon-btn" onClick={() => step(-1)} title="Previous frame (←)">
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" /></svg>
        </button>
        <button className="play-btn" onClick={togglePlay} title="Play / pause (Space)">
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>
          ) : (
            <PlayGlyph />
          )}
        </button>
        <button className="icon-btn" onClick={() => step(1)} title="Next frame (→)">
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor" /></svg>
        </button>
        <span className="mono timecode">
          {fmtTimecode(time, fps)} <span className="muted">/ {fmtTimecode(duration, fps)}</span>
        </span>

        <span className="preview-title" title={path!}>{source.name}</span>

        {source.convertedPath && (
          <div className="seg mini">
            <button className={which === "original" ? "on" : ""} onClick={() => setWhich("original")}>Original</button>
            <button className={which === "converted" ? "on" : ""} onClick={() => setWhich("converted")}>Converted</button>
          </div>
        )}
        <select className="speed" value={speed} onChange={(e) => changeSpeed(Number(e.target.value))} title="Playback speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
        <span className="muted mono small-meta">{source.width}×{source.height} · {fmtFps(source.fps)}</span>
        <button className="icon-btn" onClick={onClose} title="Close preview (Esc)">×</button>
      </div>
    </section>
  );
}
