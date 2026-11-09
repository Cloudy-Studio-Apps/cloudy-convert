/**
 * State and actions of the converter: the file list, probing new files, and the sequential
 * conversion queue. The UI components only render this state and call these actions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../lib/api";
import { useLatest } from "../../lib/hooks";
import type { ConvertItem, ConvertSettings } from "./types";

let nextId = 0;
const newId = () => `conv${++nextId}`;

/** How many files are probed (ffprobe + thumbnail) at the same time. */
const PROBE_WORKERS = 3;

export function useConverterQueue(settings: ConvertSettings) {
  const [items, setItems] = useState<ConvertItem[]>([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useLatest(items);
  const stopRequested = useRef(false);
  const currentId = useRef<string | null>(null);

  const update = useCallback((id: string, patch: Partial<ConvertItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const remove = useCallback((id: string) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const clearFinished = useCallback(() => setItems((l) => l.filter((i) => i.status !== "done")), []);

  /** Toggles all selectable items on or off. */
  const selectAll = useCallback((on: boolean) => {
    setItems((l) => l.map((i) => (i.info && i.status !== "converting" ? { ...i, selected: on } : i)));
  }, []);

  // Live progress from the backend.
  useEffect(() => {
    const un = api.onConvertProgress((p) => update(p.id, { progress: p.progress, speed: p.speed }));
    return () => void un.then((f) => f());
  }, [update]);

  /** Adds files/folders (skipping ones already listed), then probes them in the background. */
  const addPaths = useCallback(
    async (raw: string[]) => {
      const paths = await api.expandPaths(raw);
      const known = new Set(itemsRef.current.map((i) => i.path));
      const fresh: ConvertItem[] = paths
        .filter((p) => !known.has(p))
        .map((p) => ({ id: newId(), path: p, status: "probing", selected: true, progress: 0, speed: "" }));
      if (!fresh.length) return;
      setItems((list) => [...list, ...fresh]);

      const queue = [...fresh];
      const worker = async () => {
        for (let it = queue.shift(); it; it = queue.shift()) {
          try {
            update(it.id, { info: await api.probeFile(it.path), status: "ready" });
          } catch (e) {
            update(it.id, { status: "error", selected: false, error: String(e) });
          }
        }
      };
      await Promise.all(Array.from({ length: PROBE_WORKERS }, worker));
    },
    [itemsRef, update],
  );

  /** Converts every selected file, one after another. */
  const start = useCallback(async () => {
    stopRequested.current = false;
    setRunning(true);
    const batch = itemsRef.current.filter((i) => i.selected && i.info);
    batch.forEach((i) => update(i.id, { status: "queued", progress: 0, error: undefined }));

    for (const it of batch) {
      if (stopRequested.current) {
        update(it.id, { status: "ready" });
        continue;
      }
      currentId.current = it.id;
      update(it.id, { status: "converting" });
      try {
        const out = await api.convert({
          id: it.id,
          input: it.path,
          outputDir: settings.outputMode === "custom" ? settings.customDir : null,
          preset: settings.preset,
          maxHeight: settings.maxHeight || null,
          sourceHeight: it.info!.height,
          duration: it.info!.duration,
          overwrite: settings.overwrite,
          audioOnly: !it.info!.hasVideo,
          wavCodec: settings.wavPreset,
          sampleRate: settings.sampleRate || null,
        });
        const finalSize = await api.fileSize(out);
        update(it.id, { status: "done", outputPath: out, finalSize, progress: 1, selected: false });
      } catch (e) {
        const msg = String(e);
        update(it.id, msg === "Cancelled" ? { status: "cancelled", progress: 0 } : { status: "error", error: msg });
      }
    }
    currentId.current = null;
    setRunning(false);
  }, [itemsRef, settings, update]);

  /** Cancels the current file and skips the rest of the batch. */
  const stop = useCallback(() => {
    stopRequested.current = true;
    if (currentId.current) api.cancelJob(currentId.current);
  }, []);

  return { items, setItems, running, update, remove, clearFinished, selectAll, addPaths, start, stop };
}
