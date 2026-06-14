// Crew emblems: real AtlasCloud portrait if present (public/portraits/<id>.webp), else an
// original inline-SVG glyph. IP-safe, no external assets required.
import { useState } from 'react';
type IconProps = { id: string; size?: number };

const COLOR: Record<string, string> = {
  michael: 'var(--accent2)', dwight: 'var(--accent)', toby: 'var(--accent)',
  hank: 'var(--deny)', pam: 'var(--ok)', worker: 'var(--muted)',
};

function Glyph({ id }: { id: string }) {
  switch (id) {
    case 'michael':
      return <><path d="M12 3l2.2 4.6L19 8.3l-3.5 3.4.9 4.9L12 14.3 7.6 16.6l.9-4.9L5 8.3l4.8-.7z" fill="currentColor" opacity=".9"/><circle cx="6" cy="20" r="1.1" fill="currentColor"/><circle cx="12" cy="20" r="1.1" fill="currentColor"/><circle cx="18" cy="20" r="1.1" fill="currentColor"/></>;
    case 'dwight':
      return <><circle cx="6" cy="7" r="2" fill="currentColor"/><circle cx="18" cy="9" r="2" fill="currentColor"/><circle cx="11" cy="18" r="2" fill="currentColor"/><path d="M6 7l12 2M18 9l-7 9M6 7l5 11" stroke="currentColor" stroke-width="1.3" fill="none" opacity=".7"/></>;
    case 'toby':
      return <><path d="M12 3v7M9 7l3 3 3-3" stroke="currentColor" stroke-width="1.6" fill="none"/><ellipse cx="12" cy="17" rx="7" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><ellipse cx="12" cy="17" rx="3" ry="1.1" fill="currentColor" opacity=".8"/></>;
    case 'hank':
      return <><path d="M12 3l7 2.5v5c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5v-5z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="11" r="2.2" fill="currentColor"/></>;
    case 'pam':
      return <><ellipse cx="12" cy="6.5" rx="6.5" ry="2.4" fill="currentColor" opacity=".9"/><path d="M5.5 6.5v5c0 1.3 2.9 2.4 6.5 2.4s6.5-1.1 6.5-2.4v-5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 11.5v5c0 1.3 2.9 2.4 6.5 2.4s6.5-1.1 6.5-2.4v-5" fill="none" stroke="currentColor" stroke-width="1.4"/></>;
    default:
      return <><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" stroke-width="1.5"/></>;
  }
}

export function CrewIcon({ id, size = 22 }: IconProps) {
  return (
    <span className="crewicon" style={{ color: COLOR[id] ?? 'var(--accent)' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><Glyph id={id} /></svg>
    </span>
  );
}

// Portrait if available, else the SVG glyph (onError fallback handles missing/ungenerated art).
export function CrewAvatar({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <CrewIcon id={id} />;
  return <img className="portrait" src={`/portraits/${id}.webp`} alt="" onError={() => setFailed(true)} />;
}

export function FleetBadge({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity=".6"/>
      <path d="M12 4l2.4 5 5.1.7-3.8 3.6.95 5.2L12 16.4 7.35 18.5l.95-5.2L4.5 9.7l5.1-.7z" fill="var(--accent)"/>
    </svg>
  );
}
