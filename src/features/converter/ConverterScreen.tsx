/**
 * Converter screen: turn camera/drone MP4s into edit-friendly .mov files (DNxHR / ProRes) that
 * DaVinci Resolve can read on Linux.
 *
 * Layout: header · [preview + file list | settings sidebar]. State and queue logic live in
 * `useConverterQueue`; this component wires it to the UI.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import ContextMenu, { MenuState } from "../../components/ContextMenu";
import { Icon, ICONS } from "../../components/Icons";
import ScreenHeader from "../../components/ScreenHeader";
import { diskFree } from "../../lib/api";
import { useDragOut, useFileDrop, usePersistentState } from "../../lib/hooks";
import ConverterRow from "./ConverterRow";
import ConverterSidebar from "./ConverterSidebar";
import Preview, { PreviewSource } from "./Preview";
import { estimateSize } from "./presets";
import { DEFAULT_CONVERT_SETTINGS, type ConvertItem } from "./types";
import { useConverterQueue } from "./useConverterQueue";

const VIDEO_EXTS = ["mp4", "MP4", "m4v", "mov", "MOV", "mkv", "avi", "mts", "MTS", "webm"];
// Audio files (e.g. WhatsApp .ogg/.opus voice notes, .aac/.m4a) are converted to .wav.
const AUDIO_EXTS = ["ogg", "oga", "opus", "aac", "m4a", "amr", "mp3", "flac", "wma"];
const MEDIA_FILTER = [
  { name: "Videos & audio", extensions: [...VIDEO_EXTS, ...AUDIO_EXTS] },
  { name: "Videos", extensions: VIDEO_EXTS },
  { name: "Audio", extensions: AUDIO_EXTS },
];

interface Props {
  /** False while another screen is shown (the screen stays mounted so conversions keep running). */
  active: boolean;
  onBack: () => void;
  ffmpegVersion?: string;
  ffmpegError?: string;
  /** Reports how many files are converting/queued, for the home screen badge. */
  onBusyChange: (count: number) => void;
  /** Files handed over from another screen (e.g. "Send to converter" in the downloader). */
  incoming: { paths: string[]; nonce: number } | null;
}

export default function ConverterScreen({ active, onBack, ffmpegVersion, ffmpegError, onBusyChange, incoming }: Props) {
  const [settings, setSettings] = usePersistentState("settings", DEFAULT_CONVERT_SETTINGS);
  const q = useConverterQueue(settings);
  const { items, running } = q;
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const dragOut = useDragOut();
  const dropHover = useFileDrop(active, q.addPaths);

  useEffect(() => {
    if (incoming) q.addPaths(incoming.paths);
  }, [incoming]);

  // ── Derived values ──
  const selectable = items.filter((i) => i.info && i.status !== "converting");
  const selected = items.filter((i) => i.selected && i.info);
  const allSelected = selectable.length > 0 && selectable.every((i) => i.selected);
  const finished = items.filter((i) => i.status === "done" && i.outputPath);

  const totals = useMemo(() => {
    let src = 0;
    let est = 0;
    for (const i of selected) {
      src += i.info!.size;
      est += estimateSize(i.info!, settings);
    }
    return { src, est };
  }, [selected, settings]);

  // Which settings sections apply: those for the selected files, or for the whole list when
  // nothing is selected. An empty list shows the video settings.
  const kinds = useMemo(() => {
    const pool = (selected.length ? selected : items).filter((i) => i.info);
    if (!pool.length) return { video: true, audio: false };
    return { video: pool.some((i) => i.info!.hasVideo), audio: pool.some((i) => !i.info!.hasVideo) };
  }, [selected, items]);

  const overallProgress = useMemo(() => {
    const active = items.filter((i) => ["queued", "converting", "done"].includes(i.status) && i.info);
    if (!running || !active.length) return null;
    const totalDur = active.reduce((a, i) => a + i.info!.duration, 0);
    return active.reduce((a, i) => a + i.info!.duration * (i.status === "done" ? 1 : i.progress), 0) / totalDur;
  }, [items, running]);

  const busyCount = items.filter((i) => i.status === "converting" || i.status === "queued").length;
  useEffect(() => onBusyChange(busyCount), [busyCount, onBusyChange]);

  // Free space on the disk the files will be written to.
  const targetDir = settings.outputMode === "custom" && settings.customDir ? settings.customDir : (selected[0]?.info?.dir ?? items[0]?.info?.dir);
  useEffect(() => {
    if (!targetDir) return setFreeSpace(null);
    diskFree(targetDir).then(setFreeSpace);
  }, [targetDir, running]);

  // ── Preview ──
  const previewItem = items.find((i) => i.id === previewId && i.info?.hasVideo);
  const previewSource: PreviewSource | null = previewItem ? { id: previewItem.id, ...previewItem.info!, convertedPath: previewItem.outputPath } : null;
  const openPreview = (id: string) => {
    if (!items.find((i) => i.id === id)?.info?.hasVideo) return;
    setPreviewId(id);
    setPreviewOpen(true);
  };
  const togglePreview = () => {
    if (!previewOpen && !previewItem) setPreviewId((selected.find((i) => i.info!.hasVideo) ?? items.find((i) => i.info?.hasVideo))?.id ?? null);
    setPreviewOpen((o) => !o);
  };

  // ── Actions ──
  const pickFiles = async () => {
    const res = await open({ multiple: true, filters: MEDIA_FILTER });
    if (res) q.addPaths(Array.isArray(res) ? res : [res]);
  };
  const pickFolder = async () => {
    const res = await open({ directory: true });
    if (typeof res === "string") q.addPaths([res]);
  };

  const showRowMenu = (e: React.MouseEvent, it: ConvertItem) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Open in preview", disabled: !it.info?.hasVideo, action: () => openPreview(it.id) },
        "separator",
        { label: "Show original in folder", action: () => revealItemInDir(it.path) },
        { label: "Show converted in folder", disabled: !it.outputPath, action: () => it.outputPath && revealItemInDir(it.outputPath) },
        "separator",
        { label: it.selected ? "Don't convert" : "Select for conversion", disabled: !it.info || running, action: () => q.update(it.id, { selected: !it.selected }) },
        { label: "Remove from list", danger: true, disabled: it.status === "converting", action: () => q.remove(it.id) },
      ],
    });
  };

  return (
    <div className="screen">
      <ScreenHeader title="Convert for editing" onBack={onBack} badge={ffmpegVersion && <span className="badge mono">ffmpeg {ffmpegVersion}</span>}>
        <button className="btn" onClick={pickFiles} disabled={running}>
          <Icon d={ICONS.plus} /> Add files
        </button>
        <button className="btn" onClick={pickFolder} disabled={running}>
          <Icon d={ICONS.folder} /> Add folder
        </button>
        <button className={`btn ${previewOpen ? "on" : ""}`} onClick={togglePreview} title="Show / hide the video preview">
          <Icon d={ICONS.eye} /> Preview
        </button>
        {items.length > 0 && (
          <button className="btn ghost" disabled={running} onClick={q.clearFinished} title="Remove finished items from the list">
            Clear finished
          </button>
        )}
      </ScreenHeader>

      {ffmpegError && <div className="banner error">{ffmpegError}</div>}

      <div className="body">
        <main className="list-pane">
          {previewOpen && active && <Preview source={previewSource} onClose={() => setPreviewOpen(false)} />}
          {items.length === 0 ? (
            <div className="empty">
              <div className="empty-art"><Icon d={ICONS.film} size={44} /></div>
              <h2>Drop videos or a folder here</h2>
              <p>MP4s from your drone or camera get converted to an edit-friendly .mov that DaVinci Resolve can read on Linux. Audio files (WhatsApp .ogg / .opus / .aac, .m4a…) become .wav.</p>
              <div className="row">
                <button className="btn primary" onClick={pickFiles}>Choose files</button>
                <button className="btn" onClick={pickFolder}>Choose folder</button>
              </div>
            </div>
          ) : (
            <>
              <div className="list-head">
                <label className="check">
                  <input type="checkbox" checked={allSelected} disabled={running} onChange={() => q.selectAll(!allSelected)} />
                  <span>{selected.length} of {items.length} selected</span>
                </label>
                <span className="muted">Current size → estimated output</span>
              </div>
              <ul className="list">
                {items.map((it) => (
                  <ConverterRow
                    key={it.id}
                    item={it}
                    settings={settings}
                    running={running}
                    previewing={previewOpen && previewId === it.id}
                    onToggle={() => q.update(it.id, { selected: !it.selected })}
                    onRemove={() => q.remove(it.id)}
                    onPreview={() => openPreview(it.id)}
                    onContextMenu={(e) => showRowMenu(e, it)}
                    onDrag={dragOut}
                  />
                ))}
              </ul>
            </>
          )}
        </main>

        <ConverterSidebar
          settings={settings}
          setSettings={setSettings}
          kinds={kinds}
          running={running}
          ready={!ffmpegError}
          selectedCount={selected.length}
          totals={totals}
          freeSpace={freeSpace}
          overallProgress={overallProgress}
          finished={finished}
          onStart={q.start}
          onStop={q.stop}
          onDrag={dragOut}
        />
      </div>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}

      {dropHover && (
        <div className="drop-overlay">
          <div>
            <Icon d={ICONS.dropIn} size={40} />
            <p>Drop to add videos or audio</p>
          </div>
        </div>
      )}
    </div>
  );
}
