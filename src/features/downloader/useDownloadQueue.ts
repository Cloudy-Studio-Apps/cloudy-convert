/**
 * State and actions of the downloader:
 *   - adding links and reading their info with yt-dlp (a few at a time; playlists are expanded
 *     into one item per video),
 *   - per-item format/quality,
 *   - the download queue (a couple of downloads run in parallel).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../lib/api";
import { useLatest } from "../../lib/hooks";
import { DownloadFormat, fitQuality } from "./options";
import { defaultQuality, isPending, type DownloadItem, type DownloadSettings } from "./types";

let nextId = 0;
const newId = () => `dl${++nextId}`;

/** Links whose info is read at the same time. */
const FETCH_WORKERS = 4;
/** Downloads that run at the same time. */
const DOWNLOAD_WORKERS = 2;

export function useDownloadQueue(settings: DownloadSettings, outputDir: string | null) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useLatest(items);
  const settingsRef = useLatest(settings);
  const outputDirRef = useLatest(outputDir);
  const stopRequested = useRef(false);
  const activeIds = useRef(new Set<string>());

  const update = useCallback((id: string, patch: Partial<DownloadItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);
  const remove = useCallback((id: string) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const clearFinished = useCallback(() => setItems((l) => l.filter((i) => i.status !== "done")), []);

  // Live progress from the backend.
  useEffect(() => {
    const un = api.onDownloadProgress((p) => update(p.id, { progress: p }));
    return () => void un.then((f) => f());
  }, [update]);

  // ── Reading link info ──────────────────────────────────────────────────────

  const fetchQueue = useRef<{ id: string; url: string }[]>([]);
  const fetchers = useRef(0);

  /** Reads one link. Resolves to the new items when the link was a playlist. */
  const fetchOne = useCallback(
    async ({ id, url }: { id: string; url: string }): Promise<DownloadItem[]> => {
      try {
        const info = await api.fetchInfo(url);
        if (info.kind === "playlist") {
          // Replace the playlist item with one item per video; the caller reads each of those.
          const s = settingsRef.current;
          const known = new Set(itemsRef.current.map((i) => i.url));
          const entries = info.entries
            .filter((e) => !known.has(e.url))
            .map<DownloadItem>((e) => ({ id: newId(), url: e.url, status: "fetching", placeholderTitle: e.title ?? undefined, format: s.format, quality: defaultQuality(s, s.format) }));
          setItems((list) => list.flatMap((it) => (it.id === id ? entries : [it])));
          return entries;
        }
        if (info.isLive) {
          update(id, { status: "error", error: "Live streams can't be downloaded while they're live." });
        } else {
          // Snap the wanted quality to what this video actually offers.
          setItems((list) => list.map((it) => (it.id === id ? { ...it, info, status: "ready", quality: fitQuality(it.format, it.quality, info) } : it)));
        }
      } catch (e) {
        update(id, { status: "error", error: String(e) });
      }
      return [];
    },
    [itemsRef, settingsRef, update],
  );
  const fetchOneRef = useLatest(fetchOne);

  /** Adds items to the info queue and starts workers up to FETCH_WORKERS. */
  const enqueueFetch = useCallback((list: DownloadItem[]) => {
    fetchQueue.current.push(...list.map((i) => ({ id: i.id, url: i.url })));
    while (fetchers.current < FETCH_WORKERS && fetchQueue.current.length) {
      fetchers.current++;
      (async () => {
        try {
          for (let job = fetchQueue.current.shift(); job; job = fetchQueue.current.shift()) {
            const more = await fetchOneRef.current(job);
            if (more.length) enqueueFetch(more);
          }
        } finally {
          fetchers.current--;
        }
      })();
    }
  }, [fetchOneRef]);

  /** Adds links (skipping ones already listed) with the current default format/quality. */
  const addUrls = useCallback(
    (urls: string[]) => {
      const s = settingsRef.current;
      const known = new Set(itemsRef.current.map((i) => i.url));
      const fresh = urls
        .filter((u) => !known.has(u))
        .map<DownloadItem>((url) => ({ id: newId(), url, status: "fetching", format: s.format, quality: defaultQuality(s, s.format) }));
      if (!fresh.length) return;
      setItems((list) => [...list, ...fresh]);
      enqueueFetch(fresh);
    },
    [itemsRef, settingsRef, enqueueFetch],
  );

  /** Re-reads a link whose info failed to load. */
  const retryFetch = useCallback(
    (it: DownloadItem) => {
      update(it.id, { status: "fetching", error: undefined });
      enqueueFetch([it]);
    },
    [update, enqueueFetch],
  );

  // ── Per-item options ───────────────────────────────────────────────────────

  const setFormat = useCallback((id: string, format: DownloadFormat) => {
    const s = settingsRef.current;
    setItems((list) => list.map((it) => (it.id === id ? { ...it, format, quality: fitQuality(format, defaultQuality(s, format), it.info) } : it)));
  }, [settingsRef]);

  const setQuality = useCallback((id: string, quality: number) => update(id, { quality }), [update]);

  /** Applies new defaults to every item that hasn't been downloaded yet. */
  const applyDefaults = useCallback((format: DownloadFormat, quality: number) => {
    setItems((list) =>
      list.map((it) => (it.status === "fetching" || isPending(it) ? { ...it, format, quality: fitQuality(format, quality, it.info) } : it)),
    );
  }, []);

  // ── Downloading ────────────────────────────────────────────────────────────

  /** Downloads every pending item, DOWNLOAD_WORKERS at a time. */
  const start = useCallback(async () => {
    const dir = outputDirRef.current;
    if (!dir) return;
    stopRequested.current = false;
    setRunning(true);
    const queue = itemsRef.current.filter(isPending).map((i) => i.id);
    queue.forEach((id) => update(id, { status: "queued", progress: undefined, error: undefined }));

    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        // Read the item now, so option changes made while it waited are used.
        const it = itemsRef.current.find((i) => i.id === id);
        if (!it) continue; // removed while queued
        if (stopRequested.current) {
          update(id, { status: "ready" });
          continue;
        }
        activeIds.current.add(id);
        update(id, { status: "downloading" });
        try {
          const out = await api.download({
            id,
            url: it.info?.url ?? it.url,
            format: it.format,
            quality: it.quality,
            compatible: settingsRef.current.compatible,
            outputDir: dir,
          });
          update(id, { status: "done", outputPath: out, finalSize: await api.fileSize(out), progress: undefined });
        } catch (e) {
          const msg = String(e);
          update(id, msg === "Cancelled" ? { status: "cancelled", progress: undefined } : { status: "error", error: msg, progress: undefined });
        } finally {
          activeIds.current.delete(id);
        }
      }
    };
    await Promise.all(Array.from({ length: DOWNLOAD_WORKERS }, worker));
    setRunning(false);
  }, [itemsRef, settingsRef, outputDirRef, update]);

  /** Cancels running downloads and skips the queued ones. */
  const stop = useCallback(() => {
    stopRequested.current = true;
    activeIds.current.forEach((id) => api.cancelJob(id));
  }, []);

  return { items, running, update, remove, clearFinished, addUrls, retryFetch, setFormat, setQuality, applyDefaults, start, stop };
}
