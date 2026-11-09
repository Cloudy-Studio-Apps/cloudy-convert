import { useEffect, useState } from "react";

/** Full-screen splash shown while the app starts; fades out once `done` and then unmounts. */
export default function Preloader({ done }: { done: boolean }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), 450); // matches the CSS fade
    return () => clearTimeout(t);
  }, [done]);
  if (gone) return null;
  return (
    <div className={`preloader ${done ? "out" : ""}`}>
      <div className="reel">
        {Array.from({ length: 5 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
      </div>
      <p>Getting things ready…</p>
    </div>
  );
}
