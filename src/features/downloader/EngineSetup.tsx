/** One-time setup card shown until the downloader engine (yt-dlp) is installed. */
import { Icon, ICONS, Spinner } from "../../components/Icons";
import type { EngineState } from "./useEngine";

export default function EngineSetup({ engine, onInstall }: { engine: EngineState; onInstall: () => void }) {
  if (!engine.status) {
    return (
      <div className="empty">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="empty-art"><Icon d={ICONS.download} size={44} /></div>
      <h2>One quick setup step</h2>
      <p>
        Downloading uses <b>yt-dlp</b>, a free open-source tool that supports YouTube, Vimeo, TikTok, Instagram, X and
        over a thousand other sites. The app downloads it once (≈ 40 MB) into its own folder — nothing is installed on your
        system.
      </p>
      {engine.installing ? (
        <div className="install-progress">
          <div className="bar">
            <i className={engine.installProgress === null ? "indeterminate" : ""} style={{ width: `${(engine.installProgress ?? 1) * 100}%` }} />
          </div>
          <span className="muted mono">{engine.installProgress === null ? "Downloading…" : `${Math.round(engine.installProgress * 100)}%`}</span>
        </div>
      ) : (
        <div className="row">
          <button className="btn primary" onClick={onInstall}>
            <Icon d={ICONS.download} /> Set up downloader
          </button>
        </div>
      )}
      {engine.error && <p className="hint warn">{engine.error}</p>}
    </div>
  );
}
