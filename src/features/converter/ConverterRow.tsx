/** One file in the converter list: thumbnail, media details, sizes, status and actions. */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon, ICONS, PlayGlyph, Spinner } from "../../components/Icons";
import { fmtBytes, fmtCodec, fmtDuration, fmtFps, fmtPixFmt } from "../../lib/format";
import { estimateSize, outputDims, presetById, wavPresetById } from "./presets";
import type { MediaInfo } from "../../lib/api";
import type { ConvertItem, ConvertSettings } from "./types";

interface Props {
  item: ConvertItem;
  settings: ConvertSettings;
  running: boolean;
  previewing: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onPreview: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** mousedown handler from `useDragOut` that drags files out of the app. */
  onDrag: (e: React.MouseEvent, files: string[], icon?: string | null) => void;
}

export default function ConverterRow(props: Props) {
  const { item: it, settings, running } = props;
  const { preset, maxHeight } = settings;
  const info = it.info;

  // Still being probed, or unreadable.
  if (!info) {
    return (
      <li className={`row-item ${it.status === "error" ? "is-error" : ""}`} onContextMenu={props.onContextMenu}>
        <span className="check-spacer" />
        <div className="thumb skeleton" />
        <div className="meta">
          <div className="name">{it.path.split(/[\\/]/).pop()}</div>
          {it.status === "error" ? <div className="sub err">{it.error}</div> : <div className="sub"><span className="skeleton line" /></div>}
        </div>
        <div className="sizes">{it.status === "probing" && <Spinner />}</div>
        <div className="status" />
        <span />
        <button className="icon-btn" onClick={props.onRemove} title="Remove">×</button>
      </li>
    );
  }

  if (!info.hasVideo) return <AudioRow {...props} info={info} />;

  const est = estimateSize(info, settings);
  const dims = outputDims(info.width, info.height, presetById(preset).bpp === null ? 0 : maxHeight);
  const isDone = it.status === "done" && !!it.outputPath;
  const busy = it.status === "converting";
  const scaled = dims.h !== info.height;
  const dragConverted = (e: React.MouseEvent) => props.onDrag(e, [it.outputPath!], info.thumbPath);

  return (
    <li
      className={`row-item ${it.selected ? "is-selected" : ""} ${isDone ? "is-done" : ""} ${props.previewing ? "is-previewing" : ""}`}
      onContextMenu={props.onContextMenu}
      onDoubleClick={props.onPreview}
    >
      <input type="checkbox" checked={it.selected} onChange={props.onToggle} disabled={running} />

      <div
        className={`thumb ${isDone ? "draggable" : ""}`}
        onMouseDown={isDone ? dragConverted : undefined}
        onClick={props.onPreview}
        title={isDone ? "Click to preview · drag the converted file into Resolve" : "Click to preview"}
      >
        {info.thumbData ? <img src={info.thumbData} alt="" draggable={false} /> : null}
        <span className="thumb-play" aria-hidden><PlayGlyph size={20} /></span>
        <span className="dur mono">{fmtDuration(info.duration)}</span>
      </div>

      <div className="meta">
        <div className="name" title={it.path}>{info.name}</div>
        <div className="sub mono">
          {info.width}×{info.height}
          {scaled && <span className="accent"> → {dims.w}×{dims.h}</span>} · {fmtFps(info.fps)} fps · {fmtCodec(info.videoCodec)} · {fmtPixFmt(info.pixFmt)} ·{" "}
          {info.audioCodec ? info.audioCodec.toUpperCase() : "no audio"}
        </div>
        {it.status === "error" && <div className="sub err" title={it.error}>{it.error}</div>}
        {isDone && <div className="sub ok mono" title={it.outputPath}>→ {it.outputPath}</div>}
      </div>

      <div className="sizes mono">
        <span>{fmtBytes(info.size)}</span>
        <span className="arrow">→</span>
        {isDone ? <b className="ok">{fmtBytes(it.finalSize ?? 0)}</b> : <b className="accent">≈ {fmtBytes(est)}</b>}
      </div>

      <div className="status">
        {busy && (
          <div className="progress">
            <div className="bar"><i style={{ width: `${it.progress * 100}%` }} /></div>
            <span className="mono">{Math.round(it.progress * 100)}% {it.speed && it.speed !== "N/A" ? `· ${it.speed}` : ""}</span>
          </div>
        )}
        {it.status === "queued" && <span className="chip">Queued</span>}
        {it.status === "cancelled" && <span className="chip">Cancelled</span>}
        {it.status === "error" && <span className="chip bad">Failed</span>}
        {isDone && (
          <div className="done-actions">
            <span className="chip drag" onMouseDown={dragConverted} title="Drag into DaVinci Resolve or any app">
              <Icon d={ICONS.grip} size={14} /> Drag
            </span>
            <button className="icon-btn" onClick={() => revealItemInDir(it.outputPath!)} title="Show in folder">
              <Icon d={ICONS.folder} size={15} />
            </button>
          </div>
        )}
      </div>

      <button className={`icon-btn preview-btn ${props.previewing ? "on" : ""}`} onClick={props.onPreview} title="Open in preview">
        <PlayGlyph size={14} />
      </button>
      <button className="icon-btn" onClick={props.onRemove} disabled={busy} title="Remove from list">×</button>
    </li>
  );
}

/** Audio-only file (e.g. a WhatsApp voice note): no thumbnail or preview, always converted to .wav. */
function AudioRow(props: Props & { info: MediaInfo }) {
  const { item: it, info, settings, running } = props;
  const outRate = settings.sampleRate && settings.sampleRate !== info.sampleRate ? settings.sampleRate : 0;
  const isDone = it.status === "done" && !!it.outputPath;
  const busy = it.status === "converting";
  const dragConverted = (e: React.MouseEvent) => props.onDrag(e, [it.outputPath!]);
  const channels = info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : `${info.channels} ch`;

  return (
    <li className={`row-item ${it.selected ? "is-selected" : ""} ${isDone ? "is-done" : ""}`} onContextMenu={props.onContextMenu}>
      <input type="checkbox" checked={it.selected} onChange={props.onToggle} disabled={running} />

      <div
        className={`thumb audio ${isDone ? "draggable" : ""}`}
        onMouseDown={isDone ? dragConverted : undefined}
        title={isDone ? "Drag the converted .wav into any app" : undefined}
      >
        <Icon d={ICONS.music} size={26} />
        <span className="dur mono">{fmtDuration(info.duration)}</span>
      </div>

      <div className="meta">
        <div className="name" title={it.path}>{info.name}</div>
        <div className="sub mono">
          Audio · {(info.audioCodec ?? "?").toUpperCase()} · {info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : "?"} · {channels}
          <span className="accent">
            {" "}→ WAV {wavPresetById(settings.wavPreset).bytes * 8}-bit{outRate ? ` · ${(outRate / 1000).toFixed(1)} kHz` : ""}
          </span>
        </div>
        {it.status === "error" && <div className="sub err" title={it.error}>{it.error}</div>}
        {isDone && <div className="sub ok mono" title={it.outputPath}>→ {it.outputPath}</div>}
      </div>

      <div className="sizes mono">
        <span>{fmtBytes(info.size)}</span>
        <span className="arrow">→</span>
        {isDone ? <b className="ok">{fmtBytes(it.finalSize ?? 0)}</b> : <b className="accent">≈ {fmtBytes(estimateSize(info, settings))}</b>}
      </div>

      <div className="status">
        {busy && (
          <div className="progress">
            <div className="bar"><i style={{ width: `${it.progress * 100}%` }} /></div>
            <span className="mono">{Math.round(it.progress * 100)}% {it.speed && it.speed !== "N/A" ? `· ${it.speed}` : ""}</span>
          </div>
        )}
        {it.status === "queued" && <span className="chip">Queued</span>}
        {it.status === "cancelled" && <span className="chip">Cancelled</span>}
        {it.status === "error" && <span className="chip bad">Failed</span>}
        {isDone && (
          <div className="done-actions">
            <span className="chip drag" onMouseDown={dragConverted} title="Drag into DaVinci Resolve or any app">
              <Icon d={ICONS.grip} size={14} /> Drag
            </span>
            <button className="icon-btn" onClick={() => revealItemInDir(it.outputPath!)} title="Show in folder">
              <Icon d={ICONS.folder} size={15} />
            </button>
          </div>
        )}
      </div>

      <span />
      <button className="icon-btn" onClick={props.onRemove} disabled={busy} title="Remove from list">×</button>
    </li>
  );
}
