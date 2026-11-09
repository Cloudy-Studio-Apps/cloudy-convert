/**
 * App shell: startup checks + preloader, and switching between the home screen and the tools.
 *
 * Tool screens are mounted the first time they're opened and then kept alive (just hidden), so a
 * conversion or download keeps running while you look at another screen.
 */
import { useCallback, useEffect, useState } from "react";
import Preloader from "./components/Preloader";
import ConverterScreen from "./features/converter/ConverterScreen";
import DownloaderScreen from "./features/downloader/DownloaderScreen";
import HomeScreen from "./features/home/HomeScreen";
import { checkFfmpeg } from "./lib/api";
import "./styles/base.css";
import "./styles/home.css";
import "./styles/converter.css";
import "./styles/preview.css";
import "./styles/downloader.css";

export type Screen = "home" | "converter" | "downloader";

/** Minimum time the splash stays up, so it doesn't just flash. */
const SPLASH_MIN_MS = 700;

export default function App() {
  const [boot, setBoot] = useState<{ done: boolean; ffmpeg?: string; error?: string }>({ done: false });
  const [screen, setScreen] = useState<Screen>("home");
  const [visited, setVisited] = useState<Set<Screen>>(new Set(["home"]));
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [toConverter, setToConverter] = useState<{ paths: string[]; nonce: number } | null>(null);

  // Startup: make sure ffmpeg is available while the splash is showing.
  useEffect(() => {
    const minDelay = new Promise((r) => setTimeout(r, SPLASH_MIN_MS));
    Promise.all([checkFfmpeg(), minDelay])
      .then(([v]) => setBoot({ done: true, ffmpeg: v }))
      .catch((e) => minDelay.then(() => setBoot({ done: true, error: String(e) })));
  }, []);

  // The webview's own right-click menu (Reload / Inspect) isn't useful here; keep it for text fields.
  useEffect(() => {
    const block = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, select, textarea")) e.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  const open = useCallback((s: Screen) => {
    setVisited((v) => (v.has(s) ? v : new Set(v).add(s)));
    setScreen(s);
  }, []);
  const goHome = useCallback(() => setScreen("home"), []);

  const setConverterBusy = useCallback((n: number) => setBusy((b) => ({ ...b, converter: n })), []);
  const setDownloaderBusy = useCallback((n: number) => setBusy((b) => ({ ...b, downloader: n })), []);
  const sendToConverter = useCallback(
    (paths: string[]) => {
      setToConverter({ paths, nonce: Date.now() });
      open("converter");
    },
    [open],
  );

  /** Wrapper that keeps a screen mounted but hidden when it isn't the current one. */
  const view = (s: Screen, el: React.ReactNode) =>
    visited.has(s) && (
      <div key={s} className={`view ${screen === s ? "" : "hidden"}`}>
        {el}
      </div>
    );

  return (
    <div className="app">
      <Preloader done={boot.done} />
      {view("home", <HomeScreen onOpen={open} busy={busy} />)}
      {view(
        "converter",
        <ConverterScreen
          active={screen === "converter"}
          onBack={goHome}
          ffmpegVersion={boot.ffmpeg}
          ffmpegError={boot.error}
          onBusyChange={setConverterBusy}
          incoming={toConverter}
        />,
      )}
      {view("downloader", <DownloaderScreen onBack={goHome} onBusyChange={setDownloaderBusy} onSendToConverter={sendToConverter} />)}
    </div>
  );
}
