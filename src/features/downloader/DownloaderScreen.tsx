/**
 * Downloader screen: paste links from YouTube, Vimeo, TikTok… and save them as MP4 or MP3.
 *
 * Layout: header · link bar · [download list | options sidebar]. State and queue logic live in
 * `useDownloadQueue`; the yt-dlp engine status lives in `useEngine`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import ContextMenu, { MenuState } from "../../components/ContextMenu";
import { Icon, ICONS, Spinner } from "../../components/Icons";
import ScreenHeader from "../../components/ScreenHeader";
import { diskFree, downloadsDir } from "../../lib/api";
import { useDragOut, usePersistentState } from "../../lib/hooks";
import DownloadRow from "./DownloadRow";
import DownloaderSidebar from "./DownloaderSidebar";
import EngineSetup from "./EngineSetup";
import { estimateDownload, extractUrls } from "./options";
import { DEFAULT_DOWNLOAD_SETTINGS, isPending, type DownloadItem } from "./types";
import { useDownloadQueue } from "./useDownloadQueue";
import { useEngine } from "./useEngine";

interface Props {
  onBack: () => void;
  /** Reports how many items are downloading/queued, for the home screen badge. */
  onBusyChange: (count: number) => void;
  /** Hands downloaded videos to the converter screen. */
  onSendToConverter: (paths: string[]) => void;
}

export default function DownloaderScreen({ onBack, onBusyChange, onSendToConverter }: Props) {
  const engine = useEngine();
  const [settings, setSettings] = usePersistentState("downloadSettings", DEFAULT_DOWNLOAD_SETTINGS);
  const [systemDownloads, setSystemDownloads] = useState<string | null>(null);
  const outputDir = settings.outputDir || systemDownloads;
  const q = useDownloadQueue(settings, outputDir);
  const { items, running } = q;
  const [input, setInput] = useState("");
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const dragOut = useDragOut();

  useEffect(() => void downloadsDir().then(setSystemDownloads), []);
  useEffect(() => {
    if (outputDir) diskFree(outputDir).then(setFreeSpace);
  }, [outputDir, running]);

  // ── Derived values ──
  const pending = items.filter(isPending);
  const finished = items.filter((i) => i.status === "done" && i.outputPath);
  const fetching = items.filter((i) => i.status === "fetching").length;
  const estimates = pending.map((i) => estimateDownload(i.info!, i.format, i.quality, settings.compatible));
  const estimatedTotal = estimates.reduce<number>((a, e) => a + (e ?? 0), 0);

  const busyCount = items.filter((i) => i.status === "downloading" || i.status === "queued").length;
  useEffect(() => onBusyChange(busyCount), [busyCount, onBusyChange]);

  // ── Adding links ──
  const submit = () => {
    const urls = extractUrls(input);
    if (!urls.length) return;
    q.addUrls(urls);
    setInput("");
  };
  // Pasting one or more links adds them right away.
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const urls = extractUrls(e.clipboardData.getData("text"));
    if (!urls.length) return;
    e.preventDefault();
    q.addUrls(urls);
    setInput("");
  };

  const sites = useMemo(() => ["YouTube", "Vimeo", "TikTok", "Instagram", "X / Twitter", "Facebook", "SoundCloud", "Twitch", "Dailymotion"], []);

  const showRowMenu = (e: React.MouseEvent, it: DownloadItem) => {
    e.preventDefault();
    const isVideoFile = it.status === "done" && it.format === "mp4" && !!it.outputPath;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Open link in browser", action: () => openUrl(it.info?.url ?? it.url) },
        { label: "Copy link", action: () => navigator.clipboard?.writeText(it.info?.url ?? it.url) },
        "separator",
        { label: "Show in folder", disabled: !it.outputPath, action: () => it.outputPath && revealItemInDir(it.outputPath) },
        { label: "Send to converter (for DaVinci Resolve)", disabled: !isVideoFile, action: () => onSendToConverter([it.outputPath!]) },
        "separator",
        { label: "Remove from list", danger: true, disabled: it.status === "downloading", action: () => q.remove(it.id) },
      ],
    });
  };

  const badge = engine.status?.version && <span className="badge mono">yt-dlp {engine.status.version}</span>;

  return (
    <div className="screen">
      <ScreenHeader title="Download from the web" onBack={onBack} badge={badge}>
        {engine.ready && (
          <button className="btn ghost" onClick={engine.install} disabled={engine.installing || running} title="Get the latest yt-dlp. Do this if downloads from a site start failing.">
            {engine.installing ? <Spinner /> : <Icon d={ICONS.refresh} />} Update engine
          </button>
        )}
        {items.length > 0 && (
          <button className="btn ghost" disabled={running} onClick={q.clearFinished} title="Remove finished items from the list">
            Clear finished
          </button>
        )}
      </ScreenHeader>

      {engine.ready && engine.error && <div className="banner error">{engine.error}</div>}

      <div className="body">
        <main className="list-pane">
          {!engine.ready ? (
            <EngineSetup engine={engine} onInstall={engine.install} />
          ) : (
            <>
              <form
                className="url-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Icon d={ICONS.link} size={18} />
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={onPaste}
                  placeholder="Paste a link to a video, song or playlist…"
                  spellCheck={false}
                />
                {fetching > 0 && <span className="muted mono">Reading {fetching}…</span>}
                <button className="btn primary" type="submit" disabled={!extractUrls(input).length}>Add</button>
              </form>

              {items.length === 0 ? (
                <div className="empty">
                  <div className="empty-art"><Icon d={ICONS.download} size={44} /></div>
                  <h2>Paste a link to get started</h2>
                  <p>Videos are saved as MP4, songs as MP3. Paste several links at once, or a whole playlist.</p>
                  <div className="site-list">{sites.map((s) => <span key={s} className="chip">{s}</span>)}<span className="chip">+1000 more</span></div>
                </div>
              ) : (
                <>
                  <div className="list-head">
                    <span>{items.length} {items.length === 1 ? "link" : "links"}</span>
                    <span className="muted">Format · quality · estimated size</span>
                  </div>
                  <ul className="list">
                    {items.map((it) => (
                      <DownloadRow
                        key={it.id}
                        item={it}
                        compatible={settings.compatible}
                        onFormat={(f) => q.setFormat(it.id, f)}
                        onQuality={(v) => q.setQuality(it.id, v)}
                        onRemove={() => q.remove(it.id)}
                        onRetry={() => q.retryFetch(it)}
                        onContextMenu={(e) => showRowMenu(e, it)}
                        onDrag={dragOut}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </main>

        <DownloaderSidebar
          settings={settings}
          setSettings={setSettings}
          outputDir={outputDir}
          running={running}
          ready={engine.ready}
          pendingCount={pending.length}
          estimatedTotal={estimatedTotal}
          estimateIncomplete={estimates.some((e) => e === null)}
          freeSpace={freeSpace}
          finished={finished}
          onDefaultsChange={q.applyDefaults}
          onStart={q.start}
          onStop={q.stop}
          onDrag={dragOut}
        />
      </div>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
}
