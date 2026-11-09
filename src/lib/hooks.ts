/** Small React hooks shared by the screens. */
import { useCallback, useEffect, useRef, useState } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { fallbackIcon } from "./api";

/** Like useState, but saved to localStorage under `key` (merged over `defaults` on load). */
export function usePersistentState<T extends object>(key: string, defaults: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Keeps a ref pointing at the latest value, for use inside long-running async loops. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * True while a drag-out started by `useDragOut` is in progress. The webview also reports our own
 * outgoing drag as an incoming drop, so file-drop handlers check this to ignore it.
 */
let draggingOut = false;

/** Drag icon for files without a thumbnail; loaded once on first use of `useDragOut`. */
let defaultIcon: string | null = null;

/**
 * Native drag of files out of the app (into DaVinci Resolve, a file manager, a browser…).
 * Returns a mousedown handler; the drag starts once the mouse moves a few pixels, so plain
 * clicks on the same element still work.
 */
export function useDragOut() {
  useEffect(() => {
    if (!defaultIcon) fallbackIcon().then((p) => (defaultIcon = p));
  }, []);
  return useCallback((e: React.MouseEvent, files: string[], thumb?: string | null) => {
    const icon = thumb || defaultIcon;
    if (e.button !== 0 || files.length === 0 || !icon) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const end = () => setTimeout(() => (draggingOut = false), 300);
    const move = (ev: MouseEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      cleanup();
      draggingOut = true;
      startDrag({ item: files, icon, mode: "copy" }, end).catch((err) => {
        console.error("drag failed", err);
        end();
      });
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", cleanup);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", cleanup);
  }, []);
}

/**
 * Files/folders dropped onto the window from the file manager. Only listens while `enabled`
 * (i.e. while its screen is visible). Returns whether something is being dragged over the window.
 */
export function useFileDrop(enabled: boolean, onDrop: (paths: string[]) => void) {
  const [hover, setHover] = useState(false);
  const onDropRef = useLatest(onDrop);
  useEffect(() => {
    if (!enabled) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (draggingOut) return;
      const t = e.payload.type;
      if (t === "enter" || t === "over") setHover(true);
      else if (t === "leave") setHover(false);
      else if (t === "drop") {
        setHover(false);
        onDropRef.current(e.payload.paths);
      }
    });
    return () => {
      setHover(false);
      un.then((f) => f());
    };
  }, [enabled]);
  return hover;
}
