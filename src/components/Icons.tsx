/** Inline SVG icons (stroke style, 24×24 grid) and small visual primitives. */

/** Path data for the icons used across the app. */
export const ICONS = {
  plus: "M12 5v14M5 12h14",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  film: "M4 4h16v16H4zM4 8h16M4 16h16M8 4v4M12 4v4M16 4v4M8 16v4M12 16v4M16 16v4",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  dropIn: "M12 3v12M6 9l6 6 6-6M4 21h16",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  convert: "M4 7h13l-3-3M20 17H7l3 3",
  back: "M15 18l-6-6 6-6",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
} as const;

export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Filled play triangle, used on thumbnails and preview buttons. */
export function PlayGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  );
}

export const Spinner = () => <span className="spinner" />;

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="5" width="13" height="14" rx="2.5" fill="var(--accent)" />
      <path d="M15 10l6-3.5v11L15 14z" fill="var(--accent)" opacity=".55" />
      <path d="M6.5 9.5l4 2.5-4 2.5z" fill="var(--bg)" />
    </svg>
  );
}
