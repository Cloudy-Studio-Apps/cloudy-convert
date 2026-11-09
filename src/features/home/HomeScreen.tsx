/** Home screen: pick a tool. Each card shows a live badge while that tool has work running. */
import { Icon, ICONS, Logo } from "../../components/Icons";
import type { Screen } from "../../App";

interface Tool {
  id: Exclude<Screen, "home">;
  title: string;
  description: string;
  icon: string;
  tags: string[];
  busyLabel: (n: number) => string;
}

const TOOLS: Tool[] = [
  {
    id: "converter",
    title: "Convert for editing",
    description: "Turn camera and drone MP4s into DNxHR / ProRes .mov files that DaVinci Resolve opens on Linux. Preview clips and drag the results straight into your timeline.",
    icon: ICONS.convert,
    tags: ["MP4 → MOV", "DNxHR", "ProRes", "Preview"],
    busyLabel: (n) => `${n} converting`,
  },
  {
    id: "downloader",
    title: "Download from the web",
    description: "Save videos and music from YouTube, Vimeo, TikTok, Instagram and 1000+ sites. Choose MP4 or MP3 and the quality, with the size shown before you download.",
    icon: ICONS.download,
    tags: ["MP4", "MP3", "Playlists", "Up to 4K"],
    busyLabel: (n) => `${n} downloading`,
  },
];

export default function HomeScreen({ onOpen, busy }: { onOpen: (s: Exclude<Screen, "home">) => void; busy: Record<string, number> }) {
  return (
    <div className="screen home">
      <div className="home-inner">
        <header className="home-head">
          <Logo size={44} />
          <div>
            <h1>Cloudy Convert</h1>
            <p>What would you like to do?</p>
          </div>
        </header>

        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button key={t.id} className="tool-card" onClick={() => onOpen(t.id)}>
              <span className="tool-icon"><Icon d={t.icon} size={26} /></span>
              <span className="tool-title">
                {t.title}
                {busy[t.id] > 0 && <span className="busy-pill"><i />{t.busyLabel(busy[t.id])}</span>}
              </span>
              <span className="tool-desc">{t.description}</span>
              <span className="tool-tags">{t.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}</span>
              <span className="tool-go">Open <Icon d="M9 6l6 6-6 6" size={14} /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
