/**
 * Right-hand panel of the converter: format, resolution, output folder, size summary and Start.
 * Video and audio settings are shown only when the selection contains that kind of file.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { Icon, ICONS } from "../../components/Icons";
import { fmtBytes } from "../../lib/format";
import { PRESETS, RESOLUTIONS, SAMPLE_RATES, WAV_PRESETS, presetById, wavPresetById } from "./presets";
import type { ConvertItem, ConvertSettings } from "./types";

interface Props {
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
  /** Whether the selection (or the whole list, when nothing is selected) has videos / audio-only files. */
  kinds: { video: boolean; audio: boolean };
  running: boolean;
  /** False when ffmpeg is missing. */
  ready: boolean;
  selectedCount: number;
  totals: { src: number; est: number };
  freeSpace: number | null;
  /** 0–1 across the whole batch, or null when idle. */
  overallProgress: number | null;
  finished: ConvertItem[];
  onStart: () => void;
  onStop: () => void;
  onDrag: (e: React.MouseEvent, files: string[], icon?: string | null) => void;
}

export default function ConverterSidebar(p: Props) {
  const { settings, running, kinds } = p;
  const wav = wavPresetById(settings.wavPreset);
  const set = <K extends keyof ConvertSettings>(k: K, v: ConvertSettings[K]) => p.setSettings((s) => ({ ...s, [k]: v }));
  const preset = presetById(settings.preset);
  const customMissing = settings.outputMode === "custom" && !settings.customDir;
  const overBudget = p.freeSpace !== null && p.totals.est > p.freeSpace;
  const canStart = p.ready && !running && p.selectedCount > 0 && !customMissing;

  const pickOutput = async () => {
    const res = await open({ directory: true, defaultPath: settings.customDir || undefined });
    if (typeof res === "string") p.setSettings((s) => ({ ...s, customDir: res, outputMode: "custom" }));
  };

  return (
    <aside className="side">
      {kinds.video && (
        <>
          <section>
            <h3>{kinds.audio ? "Video format" : "Format"}</h3>
            <select value={settings.preset} onChange={(e) => set("preset", e.target.value)} disabled={running}>
              {[...new Set(PRESETS.map((x) => x.group))].map((g) => (
                <optgroup key={g} label={g}>
                  {PRESETS.filter((x) => x.group === g).map((x) => (
                    <option key={x.id} value={x.id}>{x.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className={`hint ${preset.id === "copy" ? "warn" : ""}`}>{preset.note}</p>
            <p className="hint">Container: <b>.mov</b> · Audio: PCM 16-bit</p>
          </section>

          <section>
            <h3>Resolution</h3>
            <div className="seg">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.value}
                  className={settings.maxHeight === r.value ? "on" : ""}
                  disabled={running || preset.id === "copy"}
                  onClick={() => set("maxHeight", r.value)}
                >
                  {r.value ? `${r.value}p` : "Original"}
                </button>
              ))}
            </div>
            <p className="hint">Never upscales. Lower resolution = much smaller files.</p>
          </section>
        </>
      )}

      {kinds.audio && (
        <section>
          <h3>{kinds.video ? "Audio files" : "Format"}</h3>
          <select value={wav.id} onChange={(e) => set("wavPreset", e.target.value)} disabled={running}>
            {WAV_PRESETS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
          <p className="hint">{wav.note}</p>
          <h3>Sample rate</h3>
          <div className="seg">
            {SAMPLE_RATES.map((r) => (
              <button key={r.value} className={settings.sampleRate === r.value ? "on" : ""} disabled={running} onClick={() => set("sampleRate", r.value)}>
                {r.label}
              </button>
            ))}
          </div>
          <p className="hint">Container: <b>.wav</b>. 48 kHz matches DaVinci Resolve timelines.</p>
        </section>
      )}

      <section>
        <h3>Output</h3>
        <label className="radio">
          <input type="radio" checked={settings.outputMode === "same"} onChange={() => set("outputMode", "same")} disabled={running} />
          Same folder as the original
        </label>
        <label className="radio">
          <input type="radio" checked={settings.outputMode === "custom"} onChange={() => set("outputMode", "custom")} disabled={running} />
          Custom folder
        </label>
        {settings.outputMode === "custom" && (
          <button className="path-pick" onClick={pickOutput} disabled={running} title={settings.customDir}>
            <Icon d={ICONS.folder} />
            <span className="mono">{settings.customDir ? `\u200E${settings.customDir}\u200E` : "Choose folder…"}</span>
          </button>
        )}
        <label className="check small">
          <input type="checkbox" checked={settings.overwrite} onChange={(e) => set("overwrite", e.target.checked)} disabled={running} />
          Overwrite existing output (otherwise adds _1, _2…)
        </label>
      </section>

      <section className="summary">
        <div className="stat"><span>Selected</span><b className="mono">{p.selectedCount} files</b></div>
        <div className="stat"><span>Current size</span><b className="mono">{fmtBytes(p.totals.src)}</b></div>
        <div className="stat"><span>Estimated output</span><b className="mono accent">≈ {fmtBytes(p.totals.est)}</b></div>
        {p.freeSpace !== null && (
          <div className={`stat ${overBudget ? "bad" : ""}`}><span>Free on target disk</span><b className="mono">{fmtBytes(p.freeSpace)}</b></div>
        )}
        {overBudget && <p className="hint warn">Not enough free space for this batch. Try a lower resolution or a lighter format.</p>}
      </section>

      <div className="side-foot">
        {p.overallProgress !== null && (
          <div className="overall">
            <div className="bar"><i style={{ width: `${p.overallProgress * 100}%` }} /></div>
            <span className="mono">{Math.round(p.overallProgress * 100)}%</span>
          </div>
        )}
        {running ? (
          <button className="btn danger wide" onClick={p.onStop}>Stop</button>
        ) : (
          <button className="btn primary wide" onClick={p.onStart} disabled={!canStart}>
            Convert {p.selectedCount || ""} {p.selectedCount === 1 ? "file" : "files"}
          </button>
        )}
        {customMissing && <p className="hint warn">Pick an output folder first.</p>}
        {p.finished.length > 0 && (
          <div
            className="drag-all"
            onMouseDown={(e) => p.onDrag(e, p.finished.map((d) => d.outputPath!), p.finished[0].info?.thumbPath)}
            title="Drag into DaVinci Resolve's Media Pool, a timeline, or any app"
          >
            <Icon d={ICONS.grip} size={18} />
            Drag {p.finished.length} converted {p.finished.length === 1 ? "file" : "files"}
          </div>
        )}
      </div>
    </aside>
  );
}
