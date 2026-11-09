/** Right-hand panel of the downloader: default format & quality, save folder, summary and Start. */
import { open } from "@tauri-apps/plugin-dialog";
import { Icon, ICONS } from "../../components/Icons";
import { fmtBytes } from "../../lib/format";
import { AUDIO_QUALITIES, FORMATS, VIDEO_QUALITIES, qualityLabel, type DownloadFormat } from "./options";
import { defaultQuality, type DownloadItem, type DownloadSettings } from "./types";

interface Props {
  settings: DownloadSettings;
  setSettings: React.Dispatch<React.SetStateAction<DownloadSettings>>;
  /** Folder files will be saved to (settings.outputDir or the system Downloads folder). */
  outputDir: string | null;
  running: boolean;
  ready: boolean;
  pendingCount: number;
  estimatedTotal: number;
  /** Some pending items have no size estimate. */
  estimateIncomplete: boolean;
  freeSpace: number | null;
  finished: DownloadItem[];
  /** Applies a default format/quality to every item not yet downloaded. */
  onDefaultsChange: (format: DownloadFormat, quality: number) => void;
  onStart: () => void;
  onStop: () => void;
  onDrag: (e: React.MouseEvent, files: string[], icon?: string | null) => void;
}

export default function DownloaderSidebar(p: Props) {
  const { settings: s, running } = p;
  const qualities = s.format === "mp3" ? AUDIO_QUALITIES : VIDEO_QUALITIES;
  const overBudget = p.freeSpace !== null && p.estimatedTotal > p.freeSpace;

  const setFormat = (format: DownloadFormat) => {
    p.setSettings((x) => ({ ...x, format }));
    p.onDefaultsChange(format, defaultQuality(s, format));
  };
  const setQuality = (q: number) => {
    p.setSettings((x) => (x.format === "mp3" ? { ...x, audioQuality: q } : { ...x, videoQuality: q }));
    p.onDefaultsChange(s.format, q);
  };
  const pickOutput = async () => {
    const res = await open({ directory: true, defaultPath: p.outputDir ?? undefined });
    if (typeof res === "string") p.setSettings((x) => ({ ...x, outputDir: res }));
  };

  return (
    <aside className="side">
      <section>
        <h3>Download as</h3>
        <div className="format-cards">
          {FORMATS.map((f) => (
            <button key={f.id} className={`format-card ${s.format === f.id ? "on" : ""}`} onClick={() => setFormat(f.id)} disabled={running}>
              <Icon d={f.id === "mp3" ? ICONS.music : ICONS.video} size={20} />
              <b>{f.label}</b>
              <span>{f.sub}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Quality</h3>
        <select value={defaultQuality(s, s.format)} onChange={(e) => setQuality(Number(e.target.value))} disabled={running}>
          {qualities.map((q) => (
            <option key={q} value={q}>{qualityLabel(s.format, q)}</option>
          ))}
        </select>
        <p className="hint">
          {s.format === "mp4"
            ? "If a video isn't available in this quality, the next lower one is used. Each item can be changed in the list."
            : "MP3 is re-encoded from the best audio the site offers. Each item can be changed in the list."}
        </p>
        {s.format === "mp4" && (
          <label className="check small">
            <input type="checkbox" checked={s.compatible} onChange={(e) => p.setSettings((x) => ({ ...x, compatible: e.target.checked }))} disabled={running} />
            Prefer H.264 + AAC (plays everywhere)
          </label>
        )}
      </section>

      <section>
        <h3>Save to</h3>
        <button className="path-pick" onClick={pickOutput} disabled={running} title={p.outputDir ?? ""}>
          <Icon d={ICONS.folder} />
          <span className="mono">{p.outputDir ? `\u200E${p.outputDir}\u200E` : "Choose folder…"}</span>
        </button>
        {s.outputDir && (
          <button className="link-btn" onClick={() => p.setSettings((x) => ({ ...x, outputDir: "" }))} disabled={running}>
            Use the Downloads folder
          </button>
        )}
      </section>

      <section className="summary">
        <div className="stat"><span>To download</span><b className="mono">{p.pendingCount} {p.pendingCount === 1 ? "item" : "items"}</b></div>
        <div className="stat">
          <span>Estimated size</span>
          <b className="mono accent">{p.estimatedTotal ? `≈ ${fmtBytes(p.estimatedTotal)}${p.estimateIncomplete ? "+" : ""}` : "—"}</b>
        </div>
        {p.freeSpace !== null && (
          <div className={`stat ${overBudget ? "bad" : ""}`}><span>Free on target disk</span><b className="mono">{fmtBytes(p.freeSpace)}</b></div>
        )}
        {overBudget && <p className="hint warn">Not enough free space for these downloads.</p>}
      </section>

      <div className="side-foot">
        {running ? (
          <button className="btn danger wide" onClick={p.onStop}>Stop</button>
        ) : (
          <button className="btn primary wide" onClick={p.onStart} disabled={!p.ready || !p.pendingCount || !p.outputDir}>
            <Icon d={ICONS.download} /> Download {p.pendingCount || ""}
          </button>
        )}
        {p.finished.length > 0 && (
          <div className="drag-all" onMouseDown={(e) => p.onDrag(e, p.finished.map((d) => d.outputPath!))} title="Drag the downloaded files into any app">
            <Icon d={ICONS.grip} size={18} />
            Drag {p.finished.length} downloaded {p.finished.length === 1 ? "file" : "files"}
          </div>
        )}
      </div>
    </aside>
  );
}
