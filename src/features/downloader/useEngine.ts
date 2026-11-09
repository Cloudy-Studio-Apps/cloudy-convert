/**
 * The downloader's engine (yt-dlp): whether it's installed, and installing/updating it in-app.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";

export interface EngineState {
  /** null while the first status check runs. */
  status: api.YtDlpStatus | null;
  installing: boolean;
  /** 0–1 during install, null when the size is unknown. */
  installProgress: number | null;
  error: string | null;
}

export function useEngine() {
  const [state, setState] = useState<EngineState>({ status: null, installing: false, installProgress: null, error: null });

  useEffect(() => {
    api.ytdlpStatus().then((status) => setState((s) => ({ ...s, status })));
    const un = api.onYtdlpInstallProgress(({ downloaded, total }) =>
      setState((s) => ({ ...s, installProgress: total ? downloaded / total : null })),
    );
    return () => void un.then((f) => f());
  }, []);

  /** Installs yt-dlp, or updates it to the latest release when already installed. */
  const install = useCallback(async () => {
    setState((s) => ({ ...s, installing: true, installProgress: 0, error: null }));
    try {
      const status = await api.ytdlpInstall();
      setState((s) => ({ ...s, status, installing: false }));
    } catch (e) {
      setState((s) => ({ ...s, installing: false, error: String(e) }));
    }
  }, []);

  return { ...state, ready: !!state.status?.installed, install };
}
