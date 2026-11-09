/** One link in the download list: thumbnail, title, format/quality pickers, size, progress, actions. */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon, ICONS, Spinner } from "../../components/Icons";
import { fmtBytes, fmtDuration, fmtEta, fmtSpeed } from "../../lib/format";
import { estimateDownload, FORMATS, qualityChoices, qualityLabel, stepLabel, type DownloadFormat } from "./options";
import type { DownloadItem } from "./types";

interface Props {
  item: DownloadItem;
  compatible: boolean;
  onFormat: (f: DownloadFormat) => void;
  onQuality: (q: number) => void;
  onRemove: () => void;
  onRetry: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDrag: (e: React.MouseEvent, files: string[], icon?: string | null) => void;
}

export default function DownloadRow(props: Props) {
  const { item: it, compatible } = props;
  const info = it.info;
  const busy = it.status === "queued" || it.status === "downloading";
  const isDone = it.status === "done" && !!it.outputPath;
  const editable = !!info && !busy && !isDone;
  const est = info ? estimateDownload(info, it.format, it.quality, compatible) : null;
  const title = info?.title ?? it.placeholderTitle ?? it.url;
  const drag = (e: React.MouseEvent) => isDone && props.onDrag(e, [it.outputPath!]);

  return (
    <li className={`row-item dl-row ${isDone ? "is-done" : ""}`} onContextMenu={props.onContextMenu}>
      <div
        className={`thumb ${isDone ? "draggable" : ""} ${!info && it.status === "fetching" ? "skeleton" : ""}`}
        onMouseDown={drag}
        title={isDone ? "Drag the file into any app" : undefined}
      >
        {info?.thumbnail && <img src={info.thumbnail} alt="" draggable={false} referrerPolicy="no-referrer" />}
        {info?.duration ? <span className="dur mono">{fmtDuration(info.duration)}</span> : null}
        {isDone && <span className={`fmt-tag ${it.format}`}>{it.format.toUpperCase()}</span>}
      </div>

      <div className="meta">
        <div className="name" title={title}>{title}</div>
        <div className="sub">
          {info ? (
            <>
              {info.site && <span className="site">{info.site}</span>}
              {info.uploader}
            </>
          ) : it.status === "fetching" ? (
            <span className="mono" title={it.url}>Reading link…{it.placeholderTitle ? ` ${it.url}` : ""}</span>
          ) : null}
        </div>
        {it.status === "error" && <div className="sub err" title={it.error}>{it.error}</div>}
        {isDone && <div className="sub ok mono" title={it.outputPath}>→ {it.outputPath}</div>}
        {info && (
          <div className="dl-options">
            <div className="seg mini">
              {FORMATS.map((f) => (
                <button key={f.id} className={it.format === f.id ? "on" : ""} disabled={!editable} onClick={() => props.onFormat(f.id)} title={f.sub}>
                  {f.label}
                </button>
              ))}
            </div>
            <select value={it.quality} disabled={!editable} onChange={(e) => props.onQuality(Number(e.target.value))} title="Quality">
              {qualityChoices(it.format, info).map((q) => {
                const size = estimateDownload(info, it.format, q, compatible);
                return (
                  <option key={q} value={q}>
                    {qualityLabel(it.format, q)}
                    {size ? ` · ≈ ${fmtBytes(size)}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>

      <div className="sizes mono">
        {isDone ? <b className="ok">{fmtBytes(it.finalSize ?? 0)}</b> : est ? <b className="accent">≈ {fmtBytes(est)}</b> : <span className="muted">—</span>}
      </div>

      <div className="status">
        <Status item={it} onRetry={props.onRetry} />
        {isDone && (
          <div className="done-actions">
            <span className="chip drag" onMouseDown={drag} title="Drag into any app">
              <Icon d={ICONS.grip} size={14} /> Drag
            </span>
            <button className="icon-btn" onClick={() => revealItemInDir(it.outputPath!)} title="Show in folder">
              <Icon d={ICONS.folder} size={15} />
            </button>
          </div>
        )}
      </div>

      <button className="icon-btn" onClick={props.onRemove} disabled={it.status === "downloading"} title="Remove from list">×</button>
    </li>
  );
}

/** Progress bar / state chip for the status column. */
function Status({ item: it, onRetry }: { item: DownloadItem; onRetry: () => void }) {
  const p = it.progress;
  switch (it.status) {
    case "fetching":
      return <Spinner />;
    case "queued":
      return <span className="chip">Queued</span>;
    case "cancelled":
      return <span className="chip">Cancelled</span>;
    case "error":
      return it.info ? (
        <span className="chip bad">Failed</span>
      ) : (
        <button className="chip bad as-btn" onClick={onRetry} title="Try reading this link again">
          <Icon d={ICONS.refresh} size={13} /> Retry
        </button>
      );
    case "downloading": {
      if (!p) return <span className="chip">Starting…</span>;
      if (p.stage === "processing") {
        return (
          <div className="progress">
            <div className="bar"><i className="indeterminate" /></div>
            <span>{stepLabel(p.step)}…</span>
          </div>
        );
      }
      const frac = p.total ? p.downloaded / p.total : 0;
      // MP4s from YouTube & co. arrive as separate video and audio files that get merged at the end.
      const label = it.format === "mp4" && p.part > 1 ? "Audio" : it.format === "mp4" ? "Video" : "Audio";
      return (
        <div className="progress">
          <div className="bar"><i style={{ width: `${frac * 100}%` }} /></div>
          <span className="mono">
            {label} {Math.round(frac * 100)}%{p.speed ? ` · ${fmtSpeed(p.speed)}` : ""}{p.eta ? ` · ${fmtEta(p.eta)}` : ""}
          </span>
        </div>
      );
    }
    default:
      return null;
  }
}
