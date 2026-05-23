import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import type { GeoJsonObject, Feature } from 'geojson';
import { fetchWikiPhoto } from '../lib/wikiPhotos';

// ── Canadian parties ──────────────────────────────────────────────────────────
const CA_PARTIES = [
  { id: 'LIB', name: 'Liberal',        color: '#D71920' },
  { id: 'CON', name: 'Conservative',   color: '#1A4782' },
  { id: 'NDP', name: 'NDP',            color: '#F58220' },
  { id: 'BQ',  name: 'Bloc Québécois', color: '#33B2CC' },
  { id: 'GRN', name: 'Green',          color: '#3D9B35' },
  { id: 'PPC', name: "People's",       color: '#4E2E84' },
  { id: 'OTH', name: 'Other',          color: '#888888' },
] as const;

const PARTY_MAP = Object.fromEntries(CA_PARTIES.map(p => [p.id, p])) as Record<string, typeof CA_PARTIES[number]>;

// ── Canadian leaders ──────────────────────────────────────────────────────────
type LeaderInfo = { lastName: string; wikiTitle?: string; localImage?: string; scale?: number; transformOrigin?: string; objectPosition?: string; initials?: string };

const CA_LEADERS: Record<string, LeaderInfo> = {
  LIB: { lastName: 'Carney',    localImage: 'leaders/carney.jpg',    objectPosition: '50% 14%' },
  CON: { lastName: 'Poilievre', localImage: 'leaders/poilievre.jpg', objectPosition: '42% 9%' },
  NDP: { lastName: 'Singh',     localImage: 'leaders/singh.jpg',     scale: 1.3, transformOrigin: '50% 68%' },
  BQ:  { lastName: 'Blanchet',  localImage: 'leaders/blanchet.jpg' },
  GRN: { lastName: 'May',       localImage: 'leaders/may.jpg',       objectPosition: '50% 5%' },
  PPC: { lastName: 'Bernier',   localImage: 'leaders/bernier.png' },
  OTH: { lastName: 'Other',     initials: 'OTH' },
};

// Leaders that change for the 2026 polling scenario
const CA_LEADERS_2026: Partial<Record<string, LeaderInfo>> = {
  NDP: { lastName: 'Lewis', localImage: 'leaders/avi-lewis.jpg', scale: 1.35, transformOrigin: '50% 28%' },
};

function CaLeaderPhotoCircle({ partyId, leader, size = 52 }: {
  partyId: string;
  leader?: LeaderInfo;
  size?: number;
}) {
  const color = PARTY_MAP[partyId]?.color ?? '#888888';
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    setPhotoUrl(null);
    if (leader?.localImage) {
      setPhotoUrl(`${import.meta.env.BASE_URL}${leader.localImage}`);
      return;
    }
    if (!leader?.wikiTitle) return;
    let cancelled = false;
    fetchWikiPhoto(leader.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [leader?.wikiTitle, leader?.localImage]);

  const initials = leader?.initials
    ?? (leader ? leader.lastName.slice(0, 2).toUpperCase() : partyId.slice(0, 2).toUpperCase());

  return (
    <div
      className="rounded-full overflow-hidden shrink-0 flex items-center justify-center"
      style={{
        width: size, height: size,
        background: `${color}22`,
        border: `1.5px solid ${color}55`,
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={leader?.lastName ?? partyId}
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            objectPosition: leader?.objectPosition ?? 'center top',
            borderRadius: '50%',
            transform: `scale(${leader?.scale ?? 1})`,
            transformOrigin: leader?.transformOrigin ?? '50% 20%',
          }}
          onError={() => setPhotoUrl(null)}
        />
      ) : (
        <span className="font-mono font-bold text-center leading-none" style={{ fontSize: size * 0.34, color }}>
          {initials}
        </span>
      )}
    </div>
  );
}

// 2026 national polling targets (% of national vote)
const POLL_2026: Record<string, number> = {
  LIB: 45.8, CON: 33.8, NDP: 9.0, BQ: 6.0, GRN: 2.8, PPC: 1.6, OTH: 1.4,
};

interface RidingData {
  id: string;
  name: string;
  province: string;
  electorate: number;
  validVotes: number;
  results2025: Record<string, number>;
  winner2025: string;
}

interface SelectedRiding {
  id: string;
  name_en: string;
  name_fr: string;
  province: string;
}

type TooltipState = {
  x: number;
  y: number;
  name_en: string;
  name_fr: string;
  province: string;
  electorate: number;
  validVotes: number;
  parties: { id: string; votes: number; pct: number }[];
  reportingPct?: number; // defined only during simulation
} | null;

// ── Coloring ──────────────────────────────────────────────────────────────────
const BLANK_COLOR = '#E5E7EB';

function ridingFill(validVotes: number, results: Record<string, number>, dark = false): string {
  const sorted = Object.entries(results)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : BLANK_COLOR;
  const [winnerId, winnerVotes] = sorted[0];
  const runnerUpVotes = sorted[1]?.[1] ?? 0;
  const margin = ((winnerVotes - runnerUpVotes) / validVotes) * 100;
  const baseColor = PARTY_MAP[winnerId]?.color ?? '#888888';
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark ? 55 - t * (55 - 28) : 82 - t * (82 - 38);
  const c = hsl(baseColor);
  c.l = lightness / 100;
  return c.formatHex() as string;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
function computeCentroid(geometry: any): [number, number] {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const visit = (c: any) => {
    if (typeof c[0] === 'number') {
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0];
    } else { for (const ch of c) visit(ch); }
  };
  visit(geometry.coordinates);
  if (!isFinite(minLat)) return [0, 0];
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

// ── Globe logo ────────────────────────────────────────────────────────────────
function GlobeLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <defs>
        <clipPath id="ca-logo-clip"><circle cx="16" cy="16" r="14" /></clipPath>
        <radialGradient id="ca-logo-shine" cx="38%" cy="32%" r="62%">
          <stop offset="0%" stopColor="white" stopOpacity="0.38" />
          <stop offset="100%" stopColor="black" stopOpacity="0.22" />
        </radialGradient>
      </defs>
      <g clipPath="url(#ca-logo-clip)">
        <circle cx="16" cy="16" r="14" fill="#0087DC" />
        <path d="M4.8 24.4 A11.2 2.8 0 0 1 27.2 24.4 A14 14 0 1 0 4.8 24.4Z" fill="#FAA61A" />
        <path d="M2.3 18.8 A13.7 3.4 0 0 1 29.7 18.8 A14 14 0 1 0 2.3 18.8Z" fill="#E4003B" />
        <path d="M2.3 13.2 A13.7 3.4 0 0 1 29.7 13.2 A14 14 0 0 0 2.3 13.2Z" fill="#02A95B" />
        <path d="M4.8 7.6 A11.2 2.8 0 0 1 27.2 7.6 A14 14 0 0 0 4.8 7.6Z" fill="#12B6CF" />
      </g>
      <g clipPath="url(#ca-logo-clip)" stroke="white" strokeWidth="0.7" strokeOpacity="0.55" fill="none">
        <path d="M4.8 7.6  A11.2 2.8 0 0 1 27.2 7.6" />
        <path d="M2.3 13.2 A13.7 3.4 0 0 1 29.7 13.2" />
        <path d="M2.3 18.8 A13.7 3.4 0 0 1 29.7 18.8" />
        <path d="M4.8 24.4 A11.2 2.8 0 0 1 27.2 24.4" />
      </g>
      <g clipPath="url(#ca-logo-clip)" stroke="white" strokeWidth="0.6" strokeOpacity="0.22" strokeDasharray="1.5 1.5" fill="none">
        <path d="M4.8 7.6  A11.2 2.8 0 0 0 27.2 7.6" />
        <path d="M2.3 13.2 A13.7 3.4 0 0 0 29.7 13.2" />
        <path d="M2.3 18.8 A13.7 3.4 0 0 0 29.7 18.8" />
        <path d="M4.8 24.4 A11.2 2.8 0 0 0 27.2 24.4" />
      </g>
      <g clipPath="url(#ca-logo-clip)" stroke="white" strokeWidth="0.65" strokeOpacity="0.30" fill="none">
        <line x1="16" y1="2" x2="16" y2="30" />
        <ellipse cx="16" cy="16" rx="8" ry="14" />
        <ellipse cx="16" cy="16" rx="4" ry="14" />
      </g>
      <circle cx="16" cy="16" r="14" fill="url(#ca-logo-shine)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
    </svg>
  );
}

// ── Auto-fit map to GeoJSON bounds ────────────────────────────────────────────
function MapFitter({ geojson }: { geojson: GeoJsonObject }) {
  const map = useMap();
  useEffect(() => {
    try {
      const layer = L.geoJSON(geojson as GeoJsonObject);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] });
    } catch { /* ignore */ }
  }, [map, geojson]);
  return null;
}

function caEnforceNoSmooth(geoLayer: L.GeoJSON) {
  geoLayer.eachLayer((layer: L.Layer) => {
    const p = layer as any;
    if (p.options) p.options.smoothFactor = 0;
  });
}

function CaMapController({ layerRef }: { layerRef: { current: L.GeoJSON | null } }) {
  const map = useMap();
  useEffect(() => {
    const onZoomEnd = () => {
      if (!layerRef.current) return;
      caEnforceNoSmooth(layerRef.current);
    };
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map, layerRef]);
  return null;
}

function fmtVotes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return n.toString();
}

// ── Scoreboard ────────────────────────────────────────────────────────────────
function CanadaScoreboard({ tally, votePcts, rawVotes, activePreset }: {
  tally:     Record<string, number>;
  votePcts:  Record<string, number>;
  rawVotes:  Record<string, number>;
  activePreset: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // Sort by seats descending, OTH always last
  const sortedParties = useMemo(() => {
    const nonOth = [...CA_PARTIES].filter(p => p.id !== 'OTH');
    nonOth.sort((a, b) => (tally[b.id] ?? 0) - (tally[a.id] ?? 0));
    const oth = CA_PARTIES.find(p => p.id === 'OTH')!;
    return [...nonOth, oth];
  }, [tally]);

  const topSeatPartyId = sortedParties.find(p => (tally[p.id] ?? 0) > 0)?.id ?? null;
  const topSeats       = topSeatPartyId ? (tally[topSeatPartyId] ?? 0) : 0;
  const hasMajority    = topSeats >= CA_MAJORITY;

  return (
    <div className="shrink-0 border-b border-default bg-canvas">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-2 mx-auto w-fit">
          {sortedParties.map(p => {
            const leader = (activePreset !== '2025' && CA_LEADERS_2026[p.id])
              ? CA_LEADERS_2026[p.id]!
              : CA_LEADERS[p.id];
            const seats    = tally[p.id] ?? 0;
            const pct      = votePcts[p.id];
            const votes    = rawVotes[p.id];
            const isLeader = p.id === topSeatPartyId;
            const isWinner = isLeader && hasMajority;

            return (
              <div
                key={p.id}
                className="relative flex flex-col items-center rounded-[6px] px-2 pt-2.5 pb-2 min-w-[90px] border bg-white"
                style={{
                  borderColor: isLeader ? p.color : `${p.color}22`,
                  boxShadow: isWinner
                    ? `0 0 0 1.5px ${p.color}, 0 3px 12px rgba(0,0,0,0.09)`
                    : isLeader
                    ? `0 0 0 1px ${p.color}`
                    : undefined,
                  overflow: isWinner ? 'hidden' : undefined,
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                {/* Majority shimmer sweep */}
                {isWinner && (
                  <div
                    className="absolute inset-0 pointer-events-none z-[2]"
                    style={{
                      background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.26) 50%, transparent 70%)',
                      animation: 'shimmerSweep 2.2s ease-in-out infinite',
                    }}
                  />
                )}

                {/* Leader photo + winner tick */}
                <div className="relative">
                  <CaLeaderPhotoCircle partyId={p.id} leader={leader} size={52} />
                  {isWinner && (
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
                        <circle cx="8.5" cy="8.5" r="8.5" fill={p.color}/>
                        <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  )}
                </div>

                {/* Leader last name */}
                <span className="text-[9px] font-sans text-ink-3 mt-1.5 leading-none truncate max-w-full">
                  {leader?.lastName ?? ''}
                </span>

                {/* Party abbrev */}
                <span className="text-[8.5px] font-sans font-bold uppercase tracking-[0.12em] leading-none mt-1 text-ink-3">
                  {p.id}
                </span>

                {/* Seat count */}
                <span
                  className="text-[28px] font-display font-black leading-none tabular-nums mt-1"
                  style={{ color: p.color }}
                >
                  {seats}
                </span>

                {/* Vote percentage */}
                <span className="text-[9.5px] font-sans text-ink-3 leading-none mt-0.5">
                  {pct !== undefined ? `${pct.toFixed(1)}%` : '—'}
                </span>

                {/* Raw popular vote */}
                <span className="text-[8px] font-sans text-ink-3 leading-none mt-0.5 opacity-60">
                  <span className="cand-votes-full">{votes !== undefined ? votes.toLocaleString() : '—'}</span>
                  <span className="cand-votes-compact">{votes !== undefined ? fmtVotes(votes) : '—'}</span>
                </span>

                {/* Progress bar */}
                <div className="w-full mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(pct ?? 0, 60) / 60 * 100}%`, background: p.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Riding detail panel ───────────────────────────────────────────────────────
interface RidingPanelProps {
  name_en: string;
  name_fr: string;
  province: string;
  id: string;
  results?: Record<string, number>;
  results2025?: Record<string, number>;
  validVotes?: number;
  activePreset: string | null;
  onClose: () => void;
  onResultsChange?: (id: string, newResults: Record<string, number>) => void;
}
function RidingPanel({ name_en, name_fr, province, id, results, results2025, validVotes, activePreset, onClose, onResultsChange }: RidingPanelProps) {
  const total = validVotes ?? 0;

  // Slider + lock state
  const [sliderPcts, setSliderPcts] = useState<Record<string, number>>({});
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [projected, setProjected] = useState(false);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (total === 0) { setSliderPcts({}); return; }
    if (!results) {
      if (activePreset === 'blank') {
        const share = 100 / CA_PARTIES.length;
        const pcts: Record<string, number> = {};
        for (const p of CA_PARTIES) pcts[p.id] = share;
        setSliderPcts(pcts);
        setProjected(false);
      } else {
        setSliderPcts({});
      }
      return;
    }
    const pcts: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(results)) {
      if (votes > 0) pcts[pid] = (votes / total) * 100;
    }
    setSliderPcts(pcts);
    // Restore projected state when reopening a riding that already has results
    if (activePreset === 'blank') setProjected(true);
  }, [id, results, total, activePreset]);

  // Reset locks when riding changes
  useEffect(() => { setLocked(new Set()); }, [id]);

  const toggleLock = useCallback((pid: string) => {
    setLocked(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }, []);

  const handleSlide = useCallback((pid: string, newPct: number) => {
    if (total === 0) return;
    const lockedSum = Object.entries(sliderPcts)
      .filter(([p]) => p !== pid && locked.has(p))
      .reduce((s, [, v]) => s + v, 0);
    const available = Math.max(0, 100 - lockedSum);
    const capped = Math.min(Math.max(0, newPct), available);
    const remaining = available - capped;
    const unlockedOthers = Object.keys(sliderPcts).filter(p => p !== pid && !locked.has(p));
    const unlockedSum = unlockedOthers.reduce((s, p) => s + (sliderPcts[p] ?? 0), 0);
    const newPcts: Record<string, number> = { ...sliderPcts, [pid]: capped };
    if (remaining < 1e-9) {
      for (const p of unlockedOthers) newPcts[p] = 0;
    } else if (unlockedSum > 1e-9) {
      for (const p of unlockedOthers) newPcts[p] = ((sliderPcts[p] ?? 0) / unlockedSum) * remaining;
    } else if (unlockedOthers.length > 0) {
      const share = remaining / unlockedOthers.length;
      for (const p of unlockedOthers) newPcts[p] = share;
    }
    const normSum = Object.values(newPcts).reduce((s, v) => s + v, 0);
    if (normSum > 1e-9) for (const p of Object.keys(newPcts)) newPcts[p] = (newPcts[p] / normSum) * 100;
    setSliderPcts(newPcts);
    // Blank map: sliders are local only — commit via "Make a Projection" button
    if (activePreset !== 'blank' && onResultsChange) {
      const newResults: Record<string, number> = {};
      for (const [p, pct] of Object.entries(newPcts)) {
        if (pct > 1e-9) newResults[p] = Math.round((pct / 100) * total);
      }
      onResultsChange(id, newResults);
    }
  }, [sliderPcts, locked, id, total, onResultsChange, activePreset]);

  const handleMakeProjection = useCallback(() => {
    if (!onResultsChange || total === 0) return;
    const newResults: Record<string, number> = {};
    for (const [p, pct] of Object.entries(sliderPcts)) {
      if (pct > 1e-9) newResults[p] = Math.round((pct / 100) * total);
    }
    onResultsChange(id, newResults);
    setProjected(true);
  }, [sliderPcts, id, total, onResultsChange]);

  const commitEdit = useCallback((pid: string, raw: string) => {
    const num = parseFloat(raw);
    if (!isNaN(num)) handleSlide(pid, Math.max(0, Math.min(100, num)));
    setEditingParty(null);
    setEditValue('');
  }, [handleSlide]);

  const showSliders = (activePreset === '2025' || activePreset === '2026' || activePreset === 'sim' || activePreset === 'blank') && total > 0;

  const pct2025 = useMemo(() => {
    if (!results2025 || total === 0) return {} as Record<string, number>;
    const p: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(results2025)) {
      if (votes > 0) p[pid] = (votes / total) * 100;
    }
    return p;
  }, [results2025, total]);

  const showComparison = activePreset !== '2025' && activePreset !== 'blank' && Object.keys(pct2025).length > 0;

  // Parties shown in sliders section — keep any party that has an entry in sliderPcts, even at 0
  const sliderParties = useMemo(() =>
    CA_PARTIES.filter(p => p.id in sliderPcts),
    [sliderPcts]
  );

  // Parties shown in comparison section
  const compParties = useMemo(() =>
    CA_PARTIES.filter(p => (pct2025[p.id] ?? 0) > 0 || (sliderPcts[p.id] ?? 0) > 0),
    [pct2025, sliderPcts]
  );

  return (
    <div className="w-[280px] shrink-0 border-l border-default bg-canvas flex flex-col overflow-y-auto z-10">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
        <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">District</span>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="px-3.5 py-3 border-b border-default">
        <div className="font-display text-[14px] font-black uppercase tracking-tight text-ink leading-tight">{name_en}</div>
        {name_fr !== name_en && (
          <div className="text-[9px] font-mono text-ink-3 mt-1 leading-snug">{name_fr}</div>
        )}
        <div className="mt-1.5 text-[9px] font-mono text-ink-3 uppercase tracking-wide">{province}</div>
      </div>

      {/* Sliders */}
      {showSliders ? (
        <div className="px-3.5 py-3 border-b border-default">
          {activePreset === 'blank' && (
            <button
              onClick={projected ? undefined : handleMakeProjection}
              className="relative overflow-hidden w-full h-9 rounded-[5px] mb-3 text-white text-[11px] font-mono font-bold uppercase tracking-wide transition-colors"
              style={{
                background: projected ? '#16a34a' : '#c8a020',
                cursor: projected ? 'default' : 'pointer',
              }}
            >
              {!projected && (
                <span
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    width: '45%',
                    background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
                    animation: 'shimmerSweep 2.2s ease-in-out infinite',
                  }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                {projected ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="6" fill="rgba(255,255,255,0.25)"/>
                      <path d="M3 6l2.2 2.2L9 4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Projected
                  </>
                ) : 'Make a Projection'}
              </span>
            </button>
          )}
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">
            {activePreset === '2025' ? '2025 Result' : activePreset === '2026' ? '2026 Projection' : activePreset === 'sim' ? 'Simulation' : 'Manual Entry'}
          </div>
          <div className="space-y-3.5">
            {sliderParties.map(p => {
              const pct = sliderPcts[p.id] ?? 0;
              const votes = Math.round((pct / 100) * total);
              const isLocked = locked.has(p.id);
              const isProjectedLock = activePreset === 'blank' && projected;
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-[9.5px] font-medium text-ink flex-1 leading-none truncate">{PARTY_MAP[p.id]?.name ?? p.id}</span>
                    {/* Lock button */}
                    <button
                      onClick={() => { if (!isProjectedLock) toggleLock(p.id); }}
                      title={isProjectedLock ? 'Projected — reset to edit' : isLocked ? 'Unlock' : 'Lock'}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${
                        isProjectedLock ? 'text-ink-3/30 cursor-default' : isLocked ? 'text-[#c8a020]' : 'text-ink-3 hover:text-ink'
                      }`}
                    >
                      {isLocked ? (
                        <svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true">
                          <rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/>
                          <path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                        </svg>
                      ) : (
                        <svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true">
                          <rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                          <path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                        </svg>
                      )}
                    </button>
                    {editingParty === p.id ? (
                      <input
                        type="number" min={0} max={100} step={0.1}
                        value={editValue}
                        autoFocus
                        className="w-12 h-5 text-[9.5px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white"
                        style={{ color: p.color }}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(p.id, editValue)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit(p.id, editValue); }
                          if (e.key === 'Escape') { setEditingParty(null); setEditValue(''); }
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => { if (!isLocked && !isProjectedLock) { setEditingParty(p.id); setEditValue(pct.toFixed(1)); } }}
                        className="text-[9.5px] font-mono font-semibold tabular-nums"
                        style={{ color: p.color, minWidth: 36, textAlign: 'right', cursor: (isLocked || isProjectedLock) ? 'default' : 'text' }}
                        title={(isLocked || isProjectedLock) ? undefined : 'Click to edit'}
                      >
                        {pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <input
                    type="range"
                    min={0} max={100} step={0.1}
                    value={pct}
                    disabled={isLocked || isProjectedLock}
                    onChange={e => handleSlide(p.id, parseFloat(e.target.value))}
                    className="ca-party-slider w-full"
                    style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties}
                  />
                  <div className="text-right text-[8px] font-mono text-ink-3 opacity-60 -mt-0.5">
                    {votes.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[7.5px] font-mono text-ink-3/50 mt-2.5 pt-2 border-t border-default">
            {total.toLocaleString()} votes
          </div>
        </div>
      ) : !showComparison ? (
        <div className="px-3.5 py-3">
          <div className="text-[9px] font-mono text-ink-3 italic">No data — click a preset</div>
        </div>
      ) : null}

      {/* Comparison vs 2025 */}
      {showComparison && (
        <div className="px-3.5 py-3">
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">
            {activePreset === 'blank' ? '2025 Reference' : '△ vs 2025'}
          </div>
          <div className="space-y-2.5">
            {compParties.map(p => {
              const b = pct2025[p.id] ?? 0;
              const c = sliderPcts[p.id] ?? 0;
              const delta = c - b;
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="text-[9px] font-mono font-bold" style={{ color: p.color }}>{p.id}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] font-mono tabular-nums">
                      {activePreset !== 'blank' ? (
                        <>
                          <span className="text-ink-3/70">{b.toFixed(1)}%</span>
                          <span className="text-ink-3/40">→</span>
                          <span style={{ color: p.color }}>{c.toFixed(1)}%</span>
                          <span className={`text-[8px] font-bold ml-0.5 ${delta > 0.05 ? 'text-emerald-600' : delta < -0.05 ? 'text-red-500' : 'text-ink-3'}`}>
                            {delta > 0.05 ? '+' : ''}{Math.abs(delta) < 0.05 ? '—' : delta.toFixed(1)}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: p.color }}>{b.toFixed(1)}%</span>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background: 'rgba(0,0,0,0.07)' }}>
                    {/* 2025 bar (faded) */}
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${b}%`, background: p.color, opacity: 0.28 }} />
                    {/* Current bar (solid), only for 2026 */}
                    {activePreset !== 'blank' && (
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${c}%`, background: p.color, opacity: 0.85 }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[7.5px] font-mono text-ink-3/50 mt-2.5 pt-2 border-t border-default">
            {total.toLocaleString()} votes
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
function MapTooltip({ tooltip, containerW, containerH }: {
  tooltip: NonNullable<TooltipState>;
  containerW: number;
  containerH: number;
}) {
  const TW = 272;
  const isSim = tooltip.reportingPct !== undefined;
  const TH_EST = (isSim ? 80 : 120) + tooltip.parties.length * 48;
  const left = tooltip.x + 18 + TW > containerW ? tooltip.x - TW - 10 : tooltip.x + 18;
  const top  = Math.max(6, Math.min(tooltip.y - 20, containerH - TH_EST - 8));

  const reportingLabel = isSim
    ? (tooltip.reportingPct! >= 99.5 ? '100% reporting' : `${tooltip.reportingPct!.toFixed(0)}% reporting`)
    : null;

  return (
    <div
      className="absolute pointer-events-none z-[1000]"
      style={{ left, top, width: TW }}
    >
      <div style={{
        background: 'rgba(18,24,44,0.96)',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 6px 28px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 16px 10px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.92)', lineHeight: 1.2 }}>
            {tooltip.name_en}
          </div>
          {tooltip.name_fr !== tooltip.name_en && (
            <div style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: 'rgba(255,255,255,0.32)', marginTop: 2 }}>
              {tooltip.name_fr}
            </div>
          )}
          <div style={{ fontSize: 10.5, fontFamily: '"JetBrains Mono",monospace', color: 'rgba(255,255,255,0.42)', marginTop: 3 }}>
            {isSim ? `${tooltip.province} · ${reportingLabel}` : tooltip.province}
          </div>
        </div>

        {/* Party rows */}
        <div style={{ padding: '0 14px 12px' }}>
          {tooltip.parties.length > 0 ? tooltip.parties.map(({ id, votes, pct }, i) => {
            const color = PARTY_MAP[id]?.color ?? '#888888';
            const name  = PARTY_MAP[id]?.name ?? id;
            const isWinner = i === 0;
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < tooltip.parties.length - 1 ? 7 : 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: isWinner ? 600 : 400, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
                <span style={{ fontSize: 10.5, fontFamily: '"JetBrains Mono",monospace', color: 'rgba(255,255,255,0.38)', marginRight: 6 }}>
                  {votes.toLocaleString()}
                </span>
                <span style={{ fontSize: 13, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color, minWidth: 44, textAlign: 'right' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          }) : (
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.32)', fontStyle: 'italic', margin: '4px 0 4px' }}>
              {isSim ? 'Not yet reporting' : 'No results — click a preset'}
            </p>
          )}
        </div>

        {/* Footer */}
        {!isSim && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '7px 16px', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: 'rgba(255,255,255,0.28)' }}>
              {tooltip.validVotes.toLocaleString()} votes cast
            </span>
            <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: 'rgba(255,255,255,0.28)' }}>
              {tooltip.electorate > 0 ? `${tooltip.electorate.toLocaleString()} electorate` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Canada Parliament geometry ────────────────────────────────────────────────
const CA_TOTAL    = 338;
const CA_MAJORITY = 170;
// 7 rows, 13 px step — each row has ~7.2 px arc per seat (dot ⌀ 5 px → ~2 px gap, no overlap)
const CA_HEMI_ROWS   = [31, 37, 43, 48, 54, 60, 65] as const; // sum = 338
const CA_HEMI_RADII  = CA_HEMI_ROWS.map((_, i) => 72 + i * 13); // [72,85,98,111,124,137,150]
const CA_HEMI_CX     = 260;
const CA_HEMI_CY     = 255;
const CA_HEMI_DOT_R  = 2.5;
const CA_EMPTY_COLOR = '#ddd8d0';
const CA_POLITICAL_ORDER = ['NDP', 'GRN', 'BQ', 'LIB', 'OTH', 'CON', 'PPC'];
const CA_HEMI_POSITIONS: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number; theta: number }[] = [];
  for (let row = 0; row < CA_HEMI_ROWS.length; row++) {
    const n = CA_HEMI_ROWS[row];
    const r = CA_HEMI_RADII[row];
    for (let j = 0; j < n; j++) {
      const theta = Math.PI * (1 - j / (n - 1));
      pts.push({ x: CA_HEMI_CX + r * Math.cos(theta), y: CA_HEMI_CY - r * Math.sin(theta), theta });
    }
  }
  pts.sort((a, b) => b.theta - a.theta);
  return pts.map(({ x, y }) => ({ x, y }));
})();
function buildCaSeatArray(tally: Record<string, number>): (string | null)[] {
  const seats: (string | null)[] = [];
  const seen = new Set<string>();
  for (const p of CA_POLITICAL_ORDER) {
    const n = tally[p] ?? 0;
    if (n > 0) { for (let i = 0; i < n; i++) seats.push(p); seen.add(p); }
  }
  for (const [p, n] of Object.entries(tally)) {
    if (n > 0 && !seen.has(p)) for (let i = 0; i < n; i++) seats.push(p);
  }
  while (seats.length < CA_TOTAL) seats.push(null);
  return seats.slice(0, CA_TOTAL);
}

// ── Simulation helpers ────────────────────────────────────────────────────────
const CA_PROVINCE_TZ: Record<string, number> = {
  'Newfoundland and Labrador': 0,
  'Prince Edward Island': 1, 'Nova Scotia': 1, 'New Brunswick': 1,
  'Quebec': 2, 'Québec': 2, 'Ontario': 2,
  'Manitoba': 3, 'Saskatchewan': 3,
  'Alberta': 4, 'Northwest Territories': 4, 'Nunavut': 4,
  'British Columbia': 5, 'Yukon': 5,
};

// [startFrac, endFrac] of totalMs for each TZ zone 0–5 (east → west)
// Atlantic (TZ 0–1) wraps up early; then QC/ON/MB/SK/AB/BC all flood in at once.
const CA_TZ_WINDOWS: [number, number][] = [
  [0.00, 0.28], // Newfoundland — first results of the night
  [0.06, 0.40], // Maritimes (NS, NB, PEI) — wraps up before the rest opens
  [0.44, 1.00], // Quebec + Ontario — chaos begins
  [0.45, 1.00], // Manitoba + Saskatchewan
  [0.46, 1.00], // Alberta + NWT + Nunavut
  [0.48, 1.00], // BC + Yukon — last in but part of the same wave
];

function randNormalCa(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const QC_PROVINCES = new Set(['Quebec', 'Québec']);

// 2021 federal election national vote shares (used as UNS baseline)
const CANADA_2021_NATIONAL: Record<string, number> = {
  LIB: 0.3262, CON: 0.3374, NDP: 0.1782,
  BQ: 0.0764, GRN: 0.0233, PPC: 0.0494, OTH: 0.0091,
};

function generateCaResultUNS(
  riding: RidingData,
  targetPcts: Record<string, number>,
  national2021: Record<string, number>,
  national2025: Record<string, number>,
): Record<string, number> {
  // Multiplicatively scale 2025 riding results to approximate 2021 distribution,
  // then apply additive swing from the 2021 national baseline.
  // This preserves NDP's geographic concentration (strong ridings stay strong).
  const result: Record<string, number> = {};
  for (const [pid, votes2025] of Object.entries(riding.results2025)) {
    const nat21 = national2021[pid] ?? 0;
    const nat25 = national2025[pid];
    result[pid] = (nat25 != null && nat25 > 0) ? votes2025 * (nat21 / nat25) : votes2025;
  }
  for (const [pid, targetPct] of Object.entries(targetPcts)) {
    // BQ only runs in Quebec — never apply swing to non-Quebec ridings
    if (pid === 'BQ' && !QC_PROVINCES.has(riding.province)) continue;
    const baseline = national2021[pid] ?? 0;
    const swing = targetPct / 100 - baseline;
    result[pid] = Math.max(0, (result[pid] ?? 0) + swing * riding.validVotes);
  }
  const entries = Object.entries(result).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return { ...riding.results2025 };
  const scale = riding.validVotes / total;
  let distributed = 0;
  const newResult: Record<string, number> = {};
  for (let i = 0; i < entries.length - 1; i++) {
    const [p, v] = entries[i];
    newResult[p] = Math.round(v * scale);
    distributed += newResult[p];
  }
  const [lastP] = entries[entries.length - 1];
  newResult[lastP] = Math.max(0, riding.validVotes - distributed);
  return newResult;
}

// ── Breakdown helpers ─────────────────────────────────────────────────────────
type CaRidingResult = {
  id: string; name: string; province: string; validVotes: number;
  winner: string; runnerUp: string | null; winnerPct: number; marginPct: number;
};

function computeCaRidingResults(
  ridingData: RidingData[],
  currentResults: Record<string, Record<string, number>>,
  activePreset: string | null,
): CaRidingResult[] {
  if (!activePreset || activePreset === 'blank') return [];
  return ridingData.map(r => {
    const results = currentResults[r.id] ?? r.results2025;
    const sorted = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    const [winner = 'OTH', winnerVotes = 0] = sorted[0] ?? [];
    const [runnerUp = null, runnerUpVotes = 0] = sorted[1] ?? [];
    const winnerPct = r.validVotes > 0 ? (winnerVotes  / r.validVotes) * 100 : 0;
    const marginPct = winnerPct - (r.validVotes > 0 ? (runnerUpVotes / r.validVotes) * 100 : 0);
    return { id: r.id, name: r.name, province: r.province, validVotes: r.validVotes, winner, runnerUp, winnerPct, marginPct };
  });
}

function computeProvinceBreakdown(ridingResults: CaRidingResult[]) {
  const map = new Map<string, Record<string, number>>();
  for (const r of ridingResults) {
    const s = map.get(r.province) ?? {};
    s[r.winner] = (s[r.winner] ?? 0) + 1;
    map.set(r.province, s);
  }
  return Array.from(map.entries())
    .map(([province, seats]) => ({ province, seats, total: Object.values(seats).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
}

function computeCaDistortion(
  ridingData: RidingData[],
  currentResults: Record<string, Record<string, number>>,
  activePreset: string | null,
): { party: string; seats: number; seatShare: number; voteShare: number }[] {
  if (!activePreset || activePreset === 'blank') return [];
  const seats: Record<string, number> = {};
  const votes: Record<string, number> = {};
  let totalVotes = 0;
  for (const r of ridingData) {
    const results = currentResults[r.id] ?? r.results2025;
    const sorted = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    const winner = sorted[0]?.[0];
    if (winner) seats[winner] = (seats[winner] ?? 0) + 1;
    for (const [p, v] of Object.entries(results)) { votes[p] = (votes[p] ?? 0) + v; totalVotes += v; }
  }
  return Array.from(new Set([...Object.keys(seats), ...Object.keys(votes)]))
    .map(p => ({
      party: p,
      seats: seats[p] ?? 0,
      seatShare: ((seats[p] ?? 0) / 338) * 100,
      voteShare: totalVotes > 0 ? ((votes[p] ?? 0) / totalVotes) * 100 : 0,
    }))
    .filter(r => r.seats > 0 || r.voteShare > 0.5)
    .sort((a, b) => b.seats - a.seats);
}

// ── Breakdown sub-components ──────────────────────────────────────────────────
function CaPartyDot({ partyId }: { partyId: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PARTY_MAP[partyId]?.color ?? '#888' }} />;
}

function CaProvinceTab({ data }: { data: ReturnType<typeof computeProvinceBreakdown> }) {
  return (
    <div className="p-4 space-y-4">
      {data.map(r => (
        <div key={r.province}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] font-semibold text-ink">{r.province}</span>
            <span className="text-[10px] text-ink-3 font-mono">{r.total} seats</span>
          </div>
          <div className="flex h-2.5 rounded overflow-hidden mb-1.5">
            {Object.entries(r.seats).sort(([, a], [, b]) => (b as number) - (a as number)).map(([p, n]) => (
              <div key={p} className="h-full" title={`${p}: ${n}`}
                style={{ width: `${((n as number) / r.total) * 100}%`, background: PARTY_MAP[p]?.color ?? '#888' }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {Object.entries(r.seats).sort(([, a], [, b]) => (b as number) - (a as number)).map(([p, n]) => (
              <span key={p} className="flex items-center gap-1 text-[9px] text-ink-3">
                <CaPartyDot partyId={p} />
                <span className="font-mono">{n as number}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CaClosestTab({ data }: { data: CaRidingResult[] }) {
  return (
    <div className="divide-y divide-default">
      {data.map((c, i) => (
        <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
          <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <CaPartyDot partyId={c.winner} />
              {c.runnerUp && <CaPartyDot partyId={c.runnerUp} />}
              <span className="text-[11px] text-ink truncate">{c.name}</span>
            </div>
            <span className="text-[9px] text-ink-3">{c.province}</span>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] font-mono text-ink">{c.winnerPct.toFixed(1)}%</div>
            <div className="text-[9px] font-mono text-[#c8a020]">+{c.marginPct.toFixed(1)}pp</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CaDistortionTab({ data }: { data: ReturnType<typeof computeCaDistortion> }) {
  const maxShare = Math.max(...data.flatMap(r => [r.voteShare, r.seatShare]), 1);
  return (
    <div className="p-4 space-y-4">
      <p className="eyebrow mb-3">Vote share vs seat share</p>
      {data.map(r => (
        <div key={r.party}>
          <div className="flex items-center gap-2 mb-1.5">
            <CaPartyDot partyId={r.party} />
            <span className="text-[11px] text-ink flex-1">{PARTY_MAP[r.party]?.name ?? r.party}</span>
            <span className="text-[10px] text-ink-3 font-mono">{r.seats} seats</span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] text-ink-3 w-9 text-right shrink-0">Votes</span>
            <div className="flex-1 h-2 rounded overflow-hidden" style={{ background: 'var(--bar-track)' }}>
              <div className="h-full rounded opacity-60"
                style={{ width: `${(r.voteShare / maxShare) * 100}%`, background: PARTY_MAP[r.party]?.color ?? '#888' }} />
            </div>
            <span className="text-[9px] font-mono text-ink-3 w-9">{r.voteShare.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-ink-3 w-9 text-right shrink-0">Seats</span>
            <div className="flex-1 h-2 rounded overflow-hidden" style={{ background: 'var(--bar-track)' }}>
              <div className="h-full rounded"
                style={{ width: `${(r.seatShare / maxShare) * 100}%`, background: PARTY_MAP[r.party]?.color ?? '#888' }} />
            </div>
            <span className="text-[9px] font-mono text-ink-3 w-9">{r.seatShare.toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CaBreakdownDrawer({
  ridingData, currentResults, activePreset, exiting, onClose,
}: {
  ridingData: RidingData[];
  currentResults: Record<string, Record<string, number>>;
  activePreset: string | null;
  exiting: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'province' | 'closest' | 'distortion'>('province');
  const hasData = !!activePreset && activePreset !== 'blank';

  const ridingResults = useMemo(() => computeCaRidingResults(ridingData, currentResults, activePreset), [ridingData, currentResults, activePreset]);
  const provinceData  = useMemo(() => computeProvinceBreakdown(ridingResults), [ridingResults]);
  const closestSeats  = useMemo(() => [...ridingResults].sort((a, b) => a.marginPct - b.marginPct).slice(0, 20), [ridingResults]);
  const distortion    = useMemo(() => computeCaDistortion(ridingData, currentResults, activePreset), [ridingData, currentResults, activePreset]);

  const tabs = [
    { id: 'province'   as const, label: 'By province' },
    { id: 'closest'    as const, label: 'Closest seats' },
    { id: 'distortion' as const, label: 'Votes vs seats' },
  ];

  return (
    <aside className={`w-80 shrink-0 bg-canvas border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">Race breakdown</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>

      <div className="flex border-b border-default shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 text-[9.5px] py-2.5 font-medium transition-colors whitespace-nowrap ${
              tab === t.id ? 'text-[#c8a020] border-b-2 border-[#c8a020]' : 'text-ink-3 hover:text-ink'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-[12px] text-ink-3 italic">Load a preset to see breakdown</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll">
          {tab === 'province'    && <CaProvinceTab   data={provinceData} />}
          {tab === 'closest'     && <CaClosestTab    data={closestSeats} />}
          {tab === 'distortion'  && <CaDistortionTab data={distortion} />}
        </div>
      )}
    </aside>
  );
}

// ── CaMultiSelectPanel ────────────────────────────────────────────────────────
function CaMultiSelectPanel({
  selectedIds, byIdMap, currentResults, onResultsChange, onClose,
}: {
  selectedIds: Set<string>;
  byIdMap: Map<string, RidingData>;
  currentResults: Record<string, Record<string, number>>;
  onResultsChange: (id: string, results: Record<string, number>) => void;
  onClose: () => void;
}) {
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  useEffect(() => { setLocked(new Set()); }, [selectedIds]);

  const selected = useMemo(() => [...selectedIds].map(id => byIdMap.get(id)).filter(Boolean) as RidingData[], [selectedIds, byIdMap]);
  const totalValidVotes = useMemo(() => selected.reduce((s, c) => s + c.validVotes, 0), [selected]);
  const aggregateVotes = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const c of selected) {
      const results = currentResults[c.id] ?? c.results2025;
      for (const [pid, votes] of Object.entries(results)) if (votes > 0) agg[pid] = (agg[pid] ?? 0) + votes;
    }
    return agg;
  }, [selected, currentResults]);
  const partyIds = useMemo(() =>
    Object.keys(aggregateVotes).filter(p => aggregateVotes[p] > 0).sort((a, b) => aggregateVotes[b] - aggregateVotes[a]),
    [aggregateVotes]);

  const toggleLock = useCallback((pid: string) => {
    setLocked(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }, []);

  const handleSlider = useCallback((pid: string, newPct: number) => {
    const currentPct = totalValidVotes > 0 ? ((aggregateVotes[pid] ?? 0) / totalValidVotes) * 100 : 0;
    const deltaPct = newPct - currentPct;
    for (const c of selected) {
      const results = { ...(currentResults[c.id] ?? c.results2025) };
      const ridingParties = Object.keys(results).filter(p => (results[p] ?? 0) > 0);
      const lockedSum = ridingParties.filter(p => p !== pid && locked.has(p)).reduce((s, p) => s + (results[p] ?? 0), 0);
      const available = Math.max(0, c.validVotes - lockedSum);
      const newVotes = Math.max(0, Math.min((results[pid] ?? 0) + (deltaPct / 100) * c.validVotes, available));
      const remaining = available - newVotes;
      const unlockedOthers = ridingParties.filter(p => p !== pid && !locked.has(p));
      const unlockedSum = unlockedOthers.reduce((s, p) => s + (results[p] ?? 0), 0);
      const raw: Record<string, number> = { ...results, [pid]: newVotes };
      if (remaining < 1e-9) {
        for (const p of unlockedOthers) raw[p] = 0;
      } else if (unlockedSum > 1e-9) {
        for (const p of unlockedOthers) raw[p] = ((results[p] ?? 0) / unlockedSum) * remaining;
      } else if (unlockedOthers.length > 0) {
        for (const p of unlockedOthers) raw[p] = remaining / unlockedOthers.length;
      }
      // Normalize to exactly validVotes, then round
      const voteSum = Object.values(raw).reduce((s, v) => s + v, 0);
      const newResults: Record<string, number> = {};
      if (voteSum > 1e-9) {
        for (const [p, v] of Object.entries(raw)) {
          if (v > 1e-9) newResults[p] = Math.round((v / voteSum) * c.validVotes);
        }
      }
      onResultsChange(c.id, newResults);
    }
  }, [selected, currentResults, aggregateVotes, totalValidVotes, locked, onResultsChange]);

  const commitEdit = useCallback((pid: string, raw: string) => {
    const num = parseFloat(raw);
    if (!isNaN(num)) handleSlider(pid, Math.max(0, Math.min(100, num)));
    setEditingParty(null);
    setEditValue('');
  }, [handleSlider]);

  const winner = partyIds[0];
  const runnerUp = partyIds[1];

  return (
    <aside className="w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight">{selectedIds.size} Riding{selectedIds.size !== 1 ? 's' : ''}</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{totalValidVotes.toLocaleString()} combined votes</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PARTY_MAP[winner]?.color ?? '#888' }} />
            <span className="text-[12px] font-semibold text-ink flex-1 truncate">{PARTY_MAP[winner]?.name ?? winner}</span>
            <span className="font-mono text-[11px] font-semibold text-ink-2">
              {totalValidVotes > 0 ? ((aggregateVotes[winner] / totalValidVotes) * 100).toFixed(1) : '0.0'}%
            </span>
            {runnerUp && (
              <span className="text-[10px] font-mono text-ink-3">
                +{totalValidVotes > 0 ? (((aggregateVotes[winner] - aggregateVotes[runnerUp]) / totalValidVotes) * 100).toFixed(1) : '0.0'}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-2">
        {partyIds.map(pid => {
          const party = PARTY_MAP[pid];
          const votes = aggregateVotes[pid] ?? 0;
          const pct = totalValidVotes > 0 ? (votes / totalValidVotes) * 100 : 0;
          const isLocked = locked.has(pid);
          return (
            <div key={pid}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: party?.color ?? '#888' }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party?.name ?? pid}</span>
                <button onClick={() => toggleLock(pid)} title={isLocked ? 'Unlock' : 'Lock'}
                  className={`w-4 h-4 flex items-center justify-center transition-colors shrink-0 ${isLocked ? 'text-[#c8a020]' : 'text-ink-3 hover:text-ink'}`}>
                  {isLocked ? (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  ) : (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  )}
                </button>
                {editingParty === pid ? (
                  <input
                    type="number" min={0} max={100} step={0.1}
                    value={editValue}
                    autoFocus
                    className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink-2"
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(pid, editValue)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(pid, editValue); }
                      if (e.key === 'Escape') { setEditingParty(null); setEditValue(''); }
                    }}
                  />
                ) : (
                  <span
                    onClick={() => { if (!isLocked) { setEditingParty(pid); setEditValue(pct.toFixed(1)); } }}
                    className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none"
                    style={{ cursor: isLocked ? 'default' : 'text' }}
                    title={isLocked ? undefined : 'Click to edit'}
                  >
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}
                onChange={e => handleSlider(pid, parseFloat(e.target.value))}
                className="ca-party-slider w-full"
                style={{ '--party-color': party?.color ?? '#7a7870', '--pct': `${pct}%` } as React.CSSProperties} />
              <div className="text-right text-[9px] font-mono text-ink-3 -mt-0.5">{votes.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── CaSwingPanel ──────────────────────────────────────────────────────────────
function CaSwingPanel({
  exiting = false, ridingData, currentResults, onResultsChange, activePreset, onReset, onClose,
}: {
  exiting?: boolean;
  ridingData: RidingData[];
  currentResults: Record<string, Record<string, number>>;
  onResultsChange: (id: string, results: Record<string, number>) => void;
  activePreset: string | null;
  onReset: () => void;
  onClose: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const disabled = !activePreset || activePreset === 'blank';
  const swingParties = CA_PARTIES.filter(p => p.id !== 'OTH');

  const applySwing = (pid: string) => {
    const val = parseFloat(inputs[pid] ?? '');
    if (isNaN(val) || val === 0) return;
    for (const r of ridingData) {
      const results = { ...(currentResults[r.id] ?? r.results2025) };
      const currentVotes = results[pid] ?? 0;
      const deltaVotes = Math.round((val / 100) * r.validVotes);
      const newVotes = Math.max(0, Math.min(currentVotes + deltaVotes, r.validVotes));
      const actualDelta = newVotes - currentVotes;
      if (actualDelta === 0) continue;
      const others = Object.keys(results).filter(p => p !== pid && (results[p] ?? 0) > 0);
      const othersSum = others.reduce((s, p) => s + (results[p] ?? 0), 0);
      const newResults: Record<string, number> = { ...results, [pid]: newVotes };
      if (othersSum > 0) {
        for (const p of others) newResults[p] = Math.max(0, Math.round((results[p] ?? 0) - actualDelta * ((results[p] ?? 0) / othersSum)));
      }
      onResultsChange(r.id, newResults);
    }
    setInputs(prev => ({ ...prev, [pid]: '' }));
  };

  const compressToTossup = () => {
    for (const r of ridingData) {
      const results = { ...(currentResults[r.id] ?? r.results2025) };
      const parties = Object.keys(results).filter(p => (results[p] ?? 0) > 0);
      if (parties.length === 0) continue;
      const total = parties.reduce((s, p) => s + (results[p] ?? 0), 0);
      const equal = total / parties.length;
      const newResults: Record<string, number> = {};
      for (const p of parties) newResults[p] = Math.round(((results[p] ?? 0) + equal) / 2);
      onResultsChange(r.id, newResults);
    }
  };

  return (
    <aside className={`w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default">
        <h2 className="text-[13px] font-bold text-ink">National swing</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5 thin-scroll space-y-4">
        <section>
          <p className="eyebrow mb-2">Quick party swing</p>
          <div className="space-y-1.5">
            {swingParties.map(({ id: pid, color }) => {
              const raw = inputs[pid] ?? '';
              const valid = !isNaN(parseFloat(raw)) && parseFloat(raw) !== 0;
              return (
                <div key={pid} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-mono text-ink-2 w-8 shrink-0 truncate">{pid}</span>
                  <input type="number" value={raw} placeholder="±pp" disabled={disabled}
                    onChange={e => setInputs(prev => ({ ...prev, [pid]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && applySwing(pid)}
                    className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none focus:border-strong disabled:opacity-40" />
                  <button onClick={() => applySwing(pid)} disabled={disabled || !valid}
                    className="h-6 px-2 text-[10px] font-mono font-semibold rounded-[4px] border border-default text-ink-2 hover:bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Apply
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <p className="eyebrow mb-2">Scenarios</p>
          <button onClick={compressToTossup} disabled={disabled}
            className="w-full px-3 py-2 text-left rounded-[4px] border border-default hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <p className="text-[11px] font-semibold text-ink">Compress to tossup</p>
            <p className="text-[9px] font-mono text-ink-3 mt-0.5">Moves each riding halfway toward equal vote share</p>
          </button>
        </section>
        <section className="pt-2 border-t border-default">
          <button onClick={onReset} disabled={disabled}
            className="w-full h-7 text-[11px] font-mono font-medium rounded-[4px] border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors uppercase tracking-wide">
            Reset to {activePreset === '2026' ? '2026 polling' : '2025 baseline'}
          </button>
        </section>
      </div>
    </aside>
  );
}

// ── CaParliamentPanel ─────────────────────────────────────────────────────────
const CA_W_COLS = 13; const CA_W_SLOT = 9; const CA_W_DOT_R = 3.5;
const CA_W_CX = 260; const CA_W_GAP = 24; const CA_W_TOP_Y = 45;

function CaParliamentPanel({ tally, exiting = false, onClose }: {
  tally: Record<string, number>;
  exiting?: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<'hemicycle' | 'westminster'>('hemicycle');
  const seats = useMemo(() => buildCaSeatArray(tally), [tally]);
  const totalDeclared = seats.filter(s => s !== null).length;
  const topEntry = Object.entries(tally).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)[0];

  return (
    <aside className={`w-[340px] shrink-0 bg-card border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="px-3 pt-3 pb-2 border-b border-default flex items-start justify-between gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">Parliament</p>
          <h2 className="text-[13px] font-bold text-ink leading-tight">Seat distribution</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5">
            {totalDeclared} / {CA_TOTAL} seats · majority {CA_MAJORITY}
            {topEntry ? ` · ${PARTY_MAP[topEntry[0]]?.name ?? topEntry[0]} ${topEntry[1]}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0 mt-0.5">×</button>
      </div>
      <div className="px-3 pt-2 pb-0 shrink-0">
        <div className="flex rounded-[4px] border border-default overflow-hidden text-[10px] font-mono w-full">
          {(['hemicycle', 'westminster'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`flex-1 px-2 py-1 uppercase tracking-wide transition-colors ${view === v ? 'bg-[#c8a020] text-white' : 'text-ink-3 hover:bg-hover hover:text-ink'}`}>
              {v === 'hemicycle' ? 'Semicircle' : 'Westminster'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 thin-scroll">
        {view === 'hemicycle' ? <CaHemicycleView seats={seats} tally={tally} /> : <CaWestminsterView tally={tally} />}
      </div>
    </aside>
  );
}

function CaHemicycleView({ seats, tally }: { seats: (string | null)[]; tally: Record<string, number> }) {
  const innerR = CA_HEMI_RADII[0];
  const outerR = CA_HEMI_RADII[CA_HEMI_RADII.length - 1];
  const MAJ = Math.PI / 2;
  const mx1 = CA_HEMI_CX + (innerR - 6) * Math.cos(MAJ), my1 = CA_HEMI_CY - (innerR - 6) * Math.sin(MAJ);
  const mx2 = CA_HEMI_CX + (outerR + 8) * Math.cos(MAJ), my2 = CA_HEMI_CY - (outerR + 8) * Math.sin(MAJ);
  const lx  = CA_HEMI_CX + (outerR + 18) * Math.cos(MAJ), ly = CA_HEMI_CY - (outerR + 18) * Math.sin(MAJ);
  return (
    <div>
      <svg viewBox="0 0 520 265" className="w-full">
        <line x1={CA_HEMI_CX - outerR - 10} y1={CA_HEMI_CY} x2={CA_HEMI_CX + outerR + 10} y2={CA_HEMI_CY} stroke="#e5e2db" strokeWidth="1" />
        <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="#888" strokeWidth="1.2" strokeDasharray="3 2" />
        <text x={lx} y={ly + 3} textAnchor="middle" fontSize="8" fill="#888" fontFamily="monospace">170</text>
        {CA_HEMI_POSITIONS.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={CA_HEMI_DOT_R} fill={seats[i] ? (PARTY_MAP[seats[i]!]?.color ?? '#888') : CA_EMPTY_COLOR} />
        ))}
      </svg>
      <CaParliLegend tally={tally} />
    </div>
  );
}

function CaWestminsterView({ tally }: { tally: Record<string, number> }) {
  const data = useMemo(() => {
    const sorted = Object.entries(tally).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a);
    if (!sorted.length) return { gov: [] as string[], opp: [] as string[], govPos: [] as {x:number;y:number}[], oppPos: [] as {x:number;y:number}[], chamberH: 100, govLabelY: 80, oppLabelY: 80, govMidX: CA_W_CX - 50, oppMidX: CA_W_CX + 50 };
    const [govParty, govTotal] = sorted[0];
    const gov: string[] = Array(govTotal).fill(govParty);
    const opp: string[] = [];
    for (const [p, n] of sorted.slice(1)) for (let i = 0; i < n; i++) opp.push(p);
    const govRows = Math.max(1, Math.ceil(gov.length / CA_W_COLS));
    const oppRows = Math.max(1, Math.ceil(opp.length / CA_W_COLS));
    const chamberH = CA_W_TOP_Y + Math.max(govRows, oppRows) * CA_W_SLOT + 36;
    const govPos = gov.map((_, i) => ({ x: CA_W_CX - CA_W_GAP/2 - Math.floor(i/govRows)*CA_W_SLOT - CA_W_SLOT/2, y: CA_W_TOP_Y + (i%govRows)*CA_W_SLOT + CA_W_SLOT/2 }));
    const oppPos = opp.map((_, i) => ({ x: CA_W_CX + CA_W_GAP/2 + (i%CA_W_COLS)*CA_W_SLOT + CA_W_SLOT/2, y: CA_W_TOP_Y + Math.floor(i/CA_W_COLS)*CA_W_SLOT + CA_W_SLOT/2 }));
    const govLabelY = CA_W_TOP_Y + govRows*CA_W_SLOT + 14;
    const oppLabelY = CA_W_TOP_Y + oppRows*CA_W_SLOT + 14;
    const govMidX = CA_W_CX - CA_W_GAP/2 - ((Math.min(CA_W_COLS, Math.ceil(gov.length/govRows))-1)/2)*CA_W_SLOT - CA_W_SLOT/2;
    const oppMidX = CA_W_CX + CA_W_GAP/2 + ((Math.min(CA_W_COLS, Math.ceil(opp.length/oppRows))-1)/2)*CA_W_SLOT + CA_W_SLOT/2;
    return { gov, opp, govPos, oppPos, chamberH, govLabelY, oppLabelY, govMidX, oppMidX };
  }, [tally]);
  const tableY = CA_W_TOP_Y + CA_W_SLOT * 2;
  return (
    <div>
      <svg viewBox={`0 0 520 ${data.chamberH}`} className="w-full">
        <rect x={CA_W_CX-22} y={4} width={44} height={20} rx={3} fill="#c9a227" opacity={0.9} />
        <text x={CA_W_CX} y={17} textAnchor="middle" fontSize="7" fill="white" fontFamily="monospace" fontWeight="bold">SPEAKER</text>
        <rect x={CA_W_CX-CA_W_GAP/2+1} y={tableY-8} width={CA_W_GAP/2-2} height={16} rx={2} fill="#f2ece0" stroke="#d4ccb4" strokeWidth="0.5" />
        <rect x={CA_W_CX+1} y={tableY-8} width={CA_W_GAP/2-2} height={16} rx={2} fill="#f2ece0" stroke="#d4ccb4" strokeWidth="0.5" />
        {data.gov.map((party, i) => <circle key={`g${i}`} cx={data.govPos[i].x} cy={data.govPos[i].y} r={CA_W_DOT_R} fill={PARTY_MAP[party]?.color ?? '#888'} />)}
        {data.opp.map((party, i) => <circle key={`o${i}`} cx={data.oppPos[i].x} cy={data.oppPos[i].y} r={CA_W_DOT_R} fill={PARTY_MAP[party]?.color ?? '#888'} />)}
        <text x={data.govMidX} y={data.govLabelY} textAnchor="middle" fontSize="7" fill="#aaa" fontFamily="monospace">GOVERNMENT</text>
        <text x={data.oppMidX} y={data.oppLabelY} textAnchor="middle" fontSize="7" fill="#aaa" fontFamily="monospace">OPPOSITION</text>
      </svg>
      <CaParliLegend tally={tally} />
    </div>
  );
}

function CaParliLegend({ tally }: { tally: Record<string, number> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-default">
      {Object.entries(tally).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a).map(([p, n]) => (
        <div key={p} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PARTY_MAP[p]?.color ?? '#888' }} />
          <span className="text-[9px] font-mono text-ink-2">{p}</span>
          <span className="text-[9px] font-mono font-bold text-ink">{n}</span>
        </div>
      ))}
    </div>
  );
}

// ── CaSimulationPanel ─────────────────────────────────────────────────────────
const CA_SIM_INPUT_PARTIES = CA_PARTIES;

function CaPartyInputRow({ party, value, onChange, disabled, maxVal, note }: {
  party: { id: string; name: string; color: string };
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  maxVal?: number;
  note?: string;
}) {
  const handleChange = (raw: string) => {
    if (maxVal !== undefined) {
      const n = parseFloat(raw);
      if (!isNaN(n) && n > maxVal) { onChange(maxVal.toFixed(1)); return; }
    }
    onChange(raw);
  };

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: party.color }} />
        <span className="flex-1 text-[10.5px] font-medium text-ink leading-none truncate">{party.name}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          <input
            type="number" min="0" max={maxVal ?? 100} step="0.1"
            value={value}
            disabled={disabled}
            onChange={e => handleChange(e.target.value)}
            placeholder="0"
            className="w-14 h-7 text-[11px] font-mono text-right px-2 rounded-[4px] border border-default bg-white focus:outline-none focus:border-ink-3 disabled:opacity-50 tabular-nums"
          />
          <span className="text-[10px] font-mono text-ink-3 w-3">%</span>
        </div>
      </div>
      {note && (
        <div className="text-[8px] font-mono text-ink-3 mt-0.5 pl-3.5 leading-tight">{note}</div>
      )}
    </div>
  );
}

function CaSimulationPanel({
  exiting = false,
  ridingData,
  onApplyResults,
  onUpdateRiding,
  onClose,
  simRunning,
  simProgress,
  timersRef,
  setSimRunning,
  setSimProgress,
  stopSim,
}: {
  exiting?: boolean;
  ridingData: RidingData[];
  onApplyResults: (results: Record<string, Record<string, number>>) => void;
  onUpdateRiding: (id: string, results: Record<string, number>) => void;
  onClose: () => void;
  simRunning: boolean;
  simProgress: number;
  timersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  setSimRunning: (v: boolean) => void;
  setSimProgress: React.Dispatch<React.SetStateAction<number>>;
  stopSim: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(CA_SIM_INPUT_PARTIES.map(p => [p.id, '']))
  );
  const [duration, setDuration] = useState<60 | 120 | 300 | 600>(60);

  // BQ can only win votes in Quebec — cap is Quebec's share of national valid votes
  const bqCap = useMemo(() => {
    const qcVotes = ridingData.filter(r => QC_PROVINCES.has(r.province)).reduce((s, r) => s + r.validVotes, 0);
    const totalVotes = ridingData.reduce((s, r) => s + r.validVotes, 0);
    return totalVotes > 0 ? Math.floor((qcVotes / totalVotes) * 1000) / 10 : 23.0;
  }, [ridingData]);

  const parseNum = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : Math.max(0, n); };
  const partySum = CA_SIM_INPUT_PARTIES.reduce((s, p) => s + parseNum(inputs[p.id] ?? ''), 0);
  const isValid = partySum <= 100.05;

  const computeNationalBaselines = useCallback((): Record<string, number> => {
    const totals: Record<string, number> = {};
    let totalVotes = 0;
    for (const r of ridingData) {
      for (const [pid, votes] of Object.entries(r.results2025)) {
        totals[pid] = (totals[pid] ?? 0) + votes;
        totalVotes += votes;
      }
    }
    const bl: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(totals)) bl[pid] = totalVotes > 0 ? votes / totalVotes : 0;
    return bl;
  }, [ridingData]);

  const buildAllResults = useCallback((): Record<string, Record<string, number>> => {
    const national2025 = computeNationalBaselines();
    const targetPcts: Record<string, number> = {};
    for (const p of CA_SIM_INPUT_PARTIES) targetPcts[p.id] = parseNum(inputs[p.id] ?? '');
    const all: Record<string, Record<string, number>> = {};
    for (const r of ridingData) all[r.id] = generateCaResultUNS(r, targetPcts, CANADA_2021_NATIONAL, national2025);
    return all;
  }, [ridingData, inputs, computeNationalBaselines]);

  const handleRun = useCallback(() => {
    if (simRunning) { stopSim(); return; }

    const allResults = buildAllResults();
    onApplyResults({}); // start blank, ridings fill in over time

    const totalMs = duration * 1000;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let declared = 0;

    const byTz: RidingData[][] = [[], [], [], [], [], []];
    for (const r of ridingData) {
      const tz = CA_PROVINCE_TZ[r.province] ?? 3;
      byTz[Math.min(tz, 5)].push(r);
    }

    for (let tz = 0; tz < 6; tz++) {
      const [winFrac, endFrac] = CA_TZ_WINDOWS[tz];
      const wStart = winFrac * totalMs;
      const wEnd   = endFrac * totalMs;
      const wLen   = wEnd - wStart;
      const mean   = (wStart + wEnd) / 2;
      const std    = wLen / 6;

      for (const riding of byTz[tz]) {
        const finalResult = allResults[riding.id];
        if (!finalResult) continue;

        const t0 = Math.max(wStart + 1000,
          Math.min(wEnd - 3000, Math.round(mean + std * randNormalCa())));

        const cut1 = 0.15 + Math.random() * 0.30;
        const cut2 = Math.min(cut1 + 0.20 + Math.random() * 0.35, 0.95);
        const gap1 = Math.round(4000 + Math.random() * 12000);
        const gap2 = Math.round(4000 + Math.random() * 12000);

        const makePartial = (frac: number): Record<string, number> => {
          const p: Record<string, number> = {};
          for (const [pid, votes] of Object.entries(finalResult)) {
            if (votes > 0) p[pid] = Math.round(votes * frac);
          }
          return p;
        };

        timers.push(setTimeout(() => onUpdateRiding(riding.id, makePartial(cut1)), t0));
        timers.push(setTimeout(() => onUpdateRiding(riding.id, makePartial(cut2)), t0 + gap1));
        timers.push(setTimeout(() => {
          onUpdateRiding(riding.id, finalResult);
          declared++;
          setSimProgress(declared);
        }, t0 + gap1 + gap2));
      }
    }

    timers.push(setTimeout(() => setSimRunning(false), totalMs + 6000));
    timersRef.current = timers;
    setSimRunning(true);
    setSimProgress(0);
  }, [simRunning, stopSim, buildAllResults, onApplyResults, duration, ridingData, onUpdateRiding]);

  return (
    <aside className={`w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-bold text-ink leading-tight">Election Night</h1>
          <p className="text-[9.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
            Canada Federal Simulation
          </p>
        </div>
        <button onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        <div className="mx-3.5 mt-3 mb-1 rounded-[5px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[9px] font-mono text-amber-800 leading-relaxed">
          <span className="font-bold">Realistic scenarios only.</span> This is a serious election simulator using real riding-level data and swing modelling. Absurd inputs (e.g. NDP 99%) will produce meaningless projections — garbage in, garbage out.
        </div>
        <section className="px-3.5 pt-3 pb-1">
          <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2.5">
            National vote share
          </div>
          {CA_SIM_INPUT_PARTIES.map(p => (
            <CaPartyInputRow key={p.id} party={p} value={inputs[p.id] ?? ''}
              onChange={v => setInputs(prev => ({ ...prev, [p.id]: v }))}
              disabled={simRunning}
              maxVal={p.id === 'BQ' ? bqCap : undefined}
              note={p.id === 'BQ' ? `Quebec only — max ${bqCap.toFixed(1)}% of national vote` : undefined}
            />
          ))}
        </section>

        <div className="mx-3.5 mt-1 mb-3 rounded-[6px] border border-default bg-[#f8f7f4] px-3 py-2.5 font-mono space-y-0.5">
          <div className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-ink-3 mb-1.5">Allocation</div>
          {CA_SIM_INPUT_PARTIES.map(p => {
            const val = parseNum(inputs[p.id] ?? '');
            return val > 0 ? (
              <div key={p.id} className="flex justify-between text-[10px] text-ink-3">
                <span>{p.name}</span>
                <span className="font-semibold text-ink">{val.toFixed(1)}%</span>
              </div>
            ) : null;
          })}
          <div className={`flex justify-between border-t pt-1 text-[10px] font-bold ${isValid ? 'text-emerald-600 border-emerald-200' : 'text-red-500 border-red-200'}`}>
            <span>Total</span><span>{partySum.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <div className="px-3.5 py-3 border-t border-default space-y-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-ink-3 uppercase tracking-wide shrink-0">Duration</span>
          {([60, 120, 300, 600] as const).map(d => (
            <button key={d} onClick={() => !simRunning && setDuration(d)} disabled={simRunning}
              className={`flex-1 h-7 text-[10px] font-mono font-medium rounded-[4px] border transition-colors disabled:opacity-40 ${
                duration === d ? 'bg-ink/8 border-ink/20 text-ink' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'
              }`}>
              {d === 60 ? '1m' : d === 120 ? '2m' : d === 300 ? '5m' : '10m'}
            </button>
          ))}
        </div>

        {simRunning && (
          <div>
            <div className="flex justify-between text-[9.5px] font-mono text-ink-3 mb-1">
              <span>{simProgress} / 338 declared</span>
              <span>{Math.round((simProgress / 338) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${(simProgress / 338) * 100}%` }} />
            </div>
          </div>
        )}

        {!isValid && (
          <p className="text-[9.5px] font-mono text-red-500 text-center">
            Party totals exceed 100% ({partySum.toFixed(1)}%)
          </p>
        )}

        <button onClick={handleRun} disabled={(!isValid || ridingData.length === 0) && !simRunning}
          className={`w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm ${
            simRunning
              ? 'bg-[#B91C1C] text-white hover:bg-[#991B1B]'
              : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}>
          {simRunning ? '⏹  Stop Simulation' : '▶  Run Election Night Simulation'}
        </button>
      </div>
    </aside>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function CanadaApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') === 'true');
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const [geojson, setGeojson] = useState<GeoJsonObject | null>(null);
  const [ridingData, setRidingData] = useState<RidingData[]>([]);
  const [activePreset, setActivePreset] = useState<'2025' | '2026' | 'blank' | 'sim' | null>(null);
  const [currentResults, setCurrentResults] = useState<Record<string, Record<string, number>>>({});
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [selectedRiding, setSelectedRiding] = useState<SelectedRiding | null>(null);
  const [bubbleMapMode, setBubbleMapMode] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownExiting, setBreakdownExiting] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedRidingIds, setSelectedRidingIds] = useState<Set<string>>(new Set());
  const [swingOpen, setSwingOpen] = useState(false);
  const [swingExiting, setSwingExiting] = useState(false);
  const [parliamentOpen, setParliamentOpen] = useState(false);
  const [parliamentExiting, setParliamentExiting] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [simExiting, setSimExiting] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopSim = useCallback(() => {
    for (const t of simTimersRef.current) clearTimeout(t);
    simTimersRef.current = [];
    setSimRunning(false);
  }, []);

  const headerScrollRef   = useRef<HTMLDivElement>(null);
  const layerRef          = useRef<L.GeoJSON | null>(null);
  const containerRef      = useRef<HTMLDivElement>(null);
  const initialLoadRef    = useRef(false);

  // Stable refs for Leaflet event handlers
  const activePresetRef    = useRef(activePreset);
  const currentResultsRef  = useRef(currentResults);
  const byIdMapRef         = useRef<Map<string, RidingData>>(new Map());
  const geoPropsMapRef     = useRef<Map<string, { name_en: string; name_fr: string; province: string }>>(new Map());
  const selectedRidingIdRef = useRef<string | null>(null);
  const bubbleModeRef      = useRef(bubbleMapMode);
  const multiSelectModeRef = useRef(multiSelectMode);

  const byIdMap = useMemo(() => {
    const m = new Map<string, RidingData>();
    for (const r of ridingData) m.set(r.id, r);
    return m;
  }, [ridingData]);

  const geoPropsMap = useMemo(() => {
    if (!geojson) return new Map<string, { name_en: string; name_fr: string; province: string }>();
    const m = new Map<string, { name_en: string; name_fr: string; province: string }>();
    for (const f of (geojson as any).features ?? []) {
      const p = f.properties;
      m.set(p.id, { name_en: p.name_en ?? '', name_fr: p.name_fr ?? p.name_en ?? '', province: p.province ?? '' });
    }
    return m;
  }, [geojson]);

  useEffect(() => { activePresetRef.current    = activePreset;   }, [activePreset]);
  useEffect(() => { currentResultsRef.current  = currentResults; }, [currentResults]);
  useEffect(() => { byIdMapRef.current         = byIdMap;        }, [byIdMap]);
  useEffect(() => { geoPropsMapRef.current     = geoPropsMap;    }, [geoPropsMap]);
  useEffect(() => { selectedRidingIdRef.current = selectedRiding?.id ?? null; }, [selectedRiding]);
  useEffect(() => { bubbleModeRef.current      = bubbleMapMode;  }, [bubbleMapMode]);
  useEffect(() => { multiSelectModeRef.current = multiSelectMode; }, [multiSelectMode]);


  const selectedRidingId = selectedRiding?.id ?? null;

  // Seat tally
  const tally = useMemo(() => {
    const t: Record<string, number> = {};
    if (activePreset === null) return t;
    for (const results of Object.values(currentResults)) {
      const sorted = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (sorted.length === 0) continue;
      const winner = sorted[0][0];
      t[winner] = (t[winner] ?? 0) + 1;
    }
    return t;
  }, [activePreset, currentResults]);

  // National vote share percentages
  const votePcts = useMemo(() => {
    const pcts: Record<string, number> = {};
    if (activePreset === null) return pcts;
    const totals: Record<string, number> = {};
    let grandTotal = 0;
    for (const results of Object.values(currentResults)) {
      for (const [pid, votes] of Object.entries(results)) {
        totals[pid] = (totals[pid] ?? 0) + votes;
        grandTotal += votes;
      }
    }
    if (grandTotal === 0) return pcts;
    for (const [pid, votes] of Object.entries(totals)) {
      pcts[pid] = (votes / grandTotal) * 100;
    }
    return pcts;
  }, [activePreset, currentResults]);

  const rawVotes = useMemo(() => {
    const totals: Record<string, number> = {};
    if (activePreset === null) return totals;
    for (const results of Object.values(currentResults)) {
      for (const [pid, votes] of Object.entries(results)) {
        totals[pid] = (totals[pid] ?? 0) + votes;
      }
    }
    return totals;
  }, [activePreset, currentResults]);

  // Bubble data (margin-scaled circles)
  const bubbleData = useMemo(() => {
    if (!bubbleMapMode || !geojson) return [];
    let maxMargin = 1;
    const items: { id: string; center: [number, number]; margin: number; color: string }[] = [];
    for (const feature of (geojson as any).features ?? []) {
      const id: string = feature.properties?.id ?? '';
      const data = byIdMap.get(id);
      if (!data) continue;
      const results = currentResults[id] ?? (activePreset && activePreset !== 'sim' ? data.results2025 : {});
      const sorted = Object.values(results).filter((v): v is number => v > 0).sort((a, b) => b - a);
      if (sorted.length === 0) continue;
      const margin = sorted.length >= 2 ? sorted[0] - sorted[1] : sorted[0];
      if (margin > maxMargin) maxMargin = margin;
      const fillColor = (activePreset && (activePreset !== 'blank' || !!currentResults[id]))
        ? ridingFill(data.validVotes, results, dark)
        : (dark ? '#374151' : BLANK_COLOR);
      items.push({ id, center: computeCentroid(feature.geometry), margin, color: fillColor });
    }
    return items.map(it => ({ ...it, radius: 1.5 + Math.sqrt(it.margin / maxMargin) * 10.5 }));
  }, [bubbleMapMode, geojson, currentResults, activePreset, byIdMap]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  useEffect(() => {
    const el = headerScrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}canada-ridings.geojson`)
      .then(r => r.json()).then(setGeojson).catch(console.error);
  }, []);

  useEffect(() => {
    if (!layerRef.current) return;
    caEnforceNoSmooth(layerRef.current);
  }, [geojson]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}canada-ridings-data.json`)
      .then(r => r.json()).then((data: RidingData[]) => setRidingData(data)).catch(console.error);
  }, []);

  // Re-style all paths on any relevant state change
  useEffect(() => {
    if (!layerRef.current) return;
    if (bubbleMapMode) {
      layerRef.current.setStyle(() => ({ fillOpacity: 0, weight: 0.4, color: dark ? '#666' : '#bbb', opacity: 0.6 }));
      return;
    }
    const baseColor = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';
    layerRef.current.eachLayer((layer: L.Layer) => {
      const path = layer as L.Path & { feature?: Feature };
      const id = (path.feature?.properties as Record<string, string> | undefined)?.id ?? '';
      const isSelected = id === selectedRidingId || selectedRidingIds.has(id);
      let fillColor = dark ? '#374151' : BLANK_COLOR;
      if (activePreset === 'blank') {
        const results = currentResults[id];
        const data = byIdMap.get(id);
        if (results && data && Object.values(results).some(v => v > 0))
          fillColor = ridingFill(data.validVotes, results, dark);
      } else if (activePreset === '2025' || activePreset === '2026' || activePreset === 'sim') {
        const results = currentResults[id];
        const data = byIdMap.get(id);
        if (results && data) fillColor = ridingFill(data.validVotes, results, dark);
      }
      path.setStyle({
        fillColor,
        fillOpacity: 0.72,
        color: isSelected ? '#c8a020' : baseColor,
        weight: isSelected ? 2 : 0.5,
        opacity: 1,
      });
    });
  }, [activePreset, currentResults, selectedRidingId, selectedRidingIds, byIdMap, bubbleMapMode, dark, geojson]);

  // ── Preset handlers ───────────────────────────────────────────────────────
  const load2025 = useCallback(() => {
    const results: Record<string, Record<string, number>> = {};
    for (const r of byIdMapRef.current.values()) results[r.id] = { ...r.results2025 };
    setCurrentResults(results);
    setActivePreset('2025');
  }, []);

  const load2026 = useCallback(() => {
    const data = [...byIdMapRef.current.values()];
    if (data.length === 0) return;

    // Compute 2025 national vote shares
    const national2025: Record<string, number> = {};
    let totalVotes = 0;
    for (const r of data) {
      for (const [pid, votes] of Object.entries(r.results2025)) {
        national2025[pid] = (national2025[pid] ?? 0) + votes;
        totalVotes += votes;
      }
    }
    const pct2025: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(national2025)) {
      pct2025[pid] = (votes / totalVotes) * 100;
    }

    // Shifts = 2026 poll − 2025 actual
    const shifts: Record<string, number> = {};
    for (const [pid, target] of Object.entries(POLL_2026)) {
      shifts[pid] = target - (pct2025[pid] ?? 0);
    }

    // Apply uniform swing to each riding
    const results: Record<string, Record<string, number>> = {};
    for (const r of data) {
      const ridingPct: Record<string, number> = {};
      for (const [pid, votes] of Object.entries(r.results2025)) {
        ridingPct[pid] = (votes / r.validVotes) * 100;
      }
      // Shift only parties that already have a presence in this riding
      for (const [pid, shift] of Object.entries(shifts)) {
        if (ridingPct[pid] !== undefined && ridingPct[pid] > 0) {
          ridingPct[pid] = Math.max(0, ridingPct[pid] + shift);
        }
      }
      // Renormalize to validVotes
      const newSum = Object.values(ridingPct).reduce((s, v) => s + v, 0);
      if (newSum === 0) { results[r.id] = {}; continue; }
      const newResults: Record<string, number> = {};
      for (const [pid, pct] of Object.entries(ridingPct)) {
        if (pct > 0) newResults[pid] = Math.round((pct / newSum) * r.validVotes);
      }
      results[r.id] = newResults;
    }
    setCurrentResults(results);
    setActivePreset('2026');
  }, []);

  const loadBlank = useCallback(() => {
    setCurrentResults({});
    setActivePreset('blank');
    setSelectedRiding(null);
  }, []);

  // Default to blank map once data is ready
  useEffect(() => {
    if (ridingData.length > 0 && !initialLoadRef.current) {
      initialLoadRef.current = true;
      loadBlank();
    }
  }, [ridingData, loadBlank]);

  const handleRidingResultsChange = useCallback((ridingId: string, newResults: Record<string, number>) => {
    setCurrentResults(prev => ({ ...prev, [ridingId]: newResults }));
  }, []);

  const toggleBreakdown = useCallback(() => {
    if (breakdownOpen) {
      setBreakdownExiting(true);
      setTimeout(() => { setBreakdownOpen(false); setBreakdownExiting(false); }, 260);
    } else {
      setBreakdownOpen(true);
      setBreakdownExiting(false);
    }
  }, [breakdownOpen]);

  const toggleSwing = useCallback(() => {
    if (swingOpen) {
      setSwingExiting(true);
      setTimeout(() => { setSwingOpen(false); setSwingExiting(false); }, 260);
    } else {
      setSwingOpen(true);
      setSwingExiting(false);
    }
  }, [swingOpen]);

  const toggleParliament = useCallback(() => {
    if (parliamentOpen) {
      setParliamentExiting(true);
      setTimeout(() => { setParliamentOpen(false); setParliamentExiting(false); }, 260);
    } else {
      setParliamentOpen(true);
      setParliamentExiting(false);
    }
  }, [parliamentOpen]);

  const toggleSim = useCallback(() => {
    if (simOpen) {
      setSimExiting(true);
      setTimeout(() => { setSimOpen(false); setSimExiting(false); }, 260);
    } else {
      setSimOpen(true);
      setSimExiting(false);
    }
  }, [simOpen]);

  const handleSimApplyResults = useCallback((results: Record<string, Record<string, number>>) => {
    setCurrentResults(results);
    setActivePreset('sim');
  }, []);

  // ── Map event handlers ────────────────────────────────────────────────────
  const handleEachFeature = useCallback((_feature: Feature, layer: L.Layer) => {
    const props = (_feature as Feature & { properties: Record<string, string> }).properties;
    const id = props.id ?? '';

    layer.on('click', () => {
      if (multiSelectModeRef.current) {
        setSelectedRidingIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
        return;
      }
      setSelectedRiding({ id, name_en: props.name_en ?? '', name_fr: props.name_fr ?? props.name_en ?? '', province: props.province ?? '' });
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleModeRef.current) { setTooltip(null); return; }
      if (multiSelectModeRef.current) { setTooltip(null); return; }
      const data = byIdMapRef.current.get(id);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const preset = activePresetRef.current;
      const rawResults = (preset === '2025' || preset === '2026' || preset === 'sim' || preset === 'blank')
        ? (currentResultsRef.current[id] ?? {})
        : {};
      const totalReported = Object.values(rawResults).reduce((s, v) => s + v, 0);
      const parties = Object.entries(rawResults)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([pid, votes]) => ({
          id: pid,
          votes,
          pct: totalReported > 0 ? Math.round((votes / totalReported) * 1000) / 10 : 0,
        }));
      const reportingPct = preset === 'sim' && data && data.validVotes > 0
        ? (totalReported / data.validVotes) * 100
        : undefined;
      setTooltip({
        x: e.originalEvent.clientX - rect.left,
        y: e.originalEvent.clientY - rect.top,
        name_en:   props.name_en ?? '',
        name_fr:   props.name_fr ?? props.name_en ?? '',
        province:  props.province ?? '',
        electorate: data?.electorate ?? 0,
        validVotes: data?.validVotes ?? 0,
        parties,
        reportingPct,
      });
    });

    layer.on('mouseout', () => setTooltip(null));
  }, []);

  const geoStyle = useCallback((): L.PathOptions => ({
    fillColor: dark ? '#374151' : BLANK_COLOR, fillOpacity: 0.72,
    color: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)', weight: 0.5, opacity: 1,
  }), [dark]);

  const dataReady = ridingData.length > 0;

  // ── Button styles ─────────────────────────────────────────────────────────
  const btnBase     = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnMuted    = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnInactive = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;

  const btn2025Class  = activePreset === '2025'  ? `${btnBase} border-[#D71920] bg-[#D71920] text-white` : btnMuted;
  const btn2026Class  = activePreset === '2026'  ? `${btnBase} border-[#4F46E5] bg-[#4F46E5] text-white` : btnMuted;
  const btnBlankClass = activePreset === 'blank' ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted;
  const btnBubbleClass = bubbleMapMode
    ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white`
    : btnInactive;

  const selectedPanelResults = selectedRidingId
    ? currentResults[selectedRidingId]
    : undefined;
  const selectedPanelValidVotes = selectedRidingId ? byIdMap.get(selectedRidingId)?.validVotes : undefined;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden">

      {/* ── Topbar ──────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>

        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
          <div className="hidden sm:flex flex-col justify-center mr-2 leading-none">
            <span className="font-title text-[13px] font-bold tracking-[-0.02em] text-ink leading-none">
              Global Election Simulator
            </span>
            <span className="text-[7.5px] font-mono uppercase tracking-[0.13em] text-ink-3 leading-none mt-[3px]">
              Ottawa Edition
            </span>
          </div>
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button onClick={load2025} disabled={!dataReady} className={btn2025Class}>2025 Baseline</button>
          <button onClick={load2026} disabled={!dataReady} className={btn2026Class}>2026 Polling</button>
          <button onClick={loadBlank} className={btnBlankClass}>Blank Map</button>

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button
            onClick={toggleSim}
            className={`${btnBase} flex items-center gap-1.5 ${simOpen ? 'border-[#c8a020] bg-[#c8a020] text-white' : btnInactive}`}
          >
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor" aria-hidden="true">
              <path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/>
            </svg>
            Simulation
          </button>
          <button
            onClick={() => {
              if (multiSelectMode) { setMultiSelectMode(false); setSelectedRidingIds(new Set()); }
              else { setMultiSelectMode(true); setSelectedRiding(null); }
            }}
            className={multiSelectMode ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted}
          >
            {multiSelectMode ? `⊕ ${selectedRidingIds.size} sel.` : 'Multi-select'}
          </button>
          {activePreset !== 'blank' && activePreset !== null && (
            <button onClick={toggleSwing} className={swingOpen ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted}>Swing</button>
          )}
          <button onClick={toggleBreakdown} className={breakdownOpen ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted}>Breakdown</button>
          <button onClick={toggleParliament} disabled={!dataReady} className={parliamentOpen ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted}>Parliament</button>
          <button onClick={() => setBubbleMapMode(v => !v)} className={btnBubbleClass}>Bubble Map</button>
        </div>

        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          <a
            href="https://x.com/realleochang"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-default text-ink-3 hover:border-ink-3 hover:text-ink transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.18em] leading-none">@realleochang</span>
          </a>

          {/* Contributors dropdown */}
          <div className="relative">
            <button
              onClick={() => setContributorsOpen(o => !o)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[8.5px] font-mono font-black uppercase tracking-[0.18em] leading-none transition-colors ${
                contributorsOpen
                  ? 'border-ink-3 text-ink bg-hover'
                  : 'border-default text-ink-3 hover:border-ink-3 hover:text-ink'
              }`}
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm1.5 7.5c.5-.25.5-.75.5-1s-.5-3-3-3.5a2.5 2.5 0 0 1 2.5 4.5z" fillRule="evenodd" clipRule="evenodd"/>
              </svg>
              <span className="hidden sm:inline">Contributors</span>
            </button>
            {contributorsOpen && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setContributorsOpen(false)} />
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-[100] w-56 rounded-[10px] bg-white border border-default overflow-hidden"
                  style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.13), 0 0 0 1px rgba(0,0,0,0.06)' }}
                >
                  <div className="px-3.5 pt-3 pb-2 border-b border-default">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-ink leading-none">Contributors</div>
                  </div>
                  <div className="px-3.5 py-2.5 space-y-2">
                    {[
                      { handle: 'kylejhutton' },
                      { handle: 'potatoConono' },
                    ].map(c => (
                      <a
                        key={c.handle}
                        href={`https://x.com/${c.handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 hover:opacity-70 transition-opacity"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3" aria-hidden="true">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                        <span className="text-[11px] font-mono font-semibold text-ink">@{c.handle}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                <line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="3.6" y1="10.4" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 relative">

        <div className="relative shrink-0">
          <div style={{
            display: 'grid',
            gridTemplateRows: scoreboardVisible ? '1fr' : '0fr',
            transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)',
          }}>
            <div className="overflow-hidden">
              <CanadaScoreboard tally={tally} votePcts={votePcts} rawVotes={rawVotes} activePreset={activePreset} />
            </div>
          </div>
          <button
            onClick={() => setScoreboardVisible(v => !v)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1"
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true">
              {scoreboardVisible
                ? <path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">
              {scoreboardVisible ? 'Hide' : 'Results'}
            </span>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 relative">
          {(parliamentOpen || parliamentExiting) && (
            <CaParliamentPanel tally={tally} exiting={parliamentExiting} onClose={toggleParliament} />
          )}
          <div className="flex-1 min-w-0 relative">
            {geojson ? (
              <div ref={containerRef} className="relative w-full h-full">
                <MapContainer
                  style={{ width: '100%', height: '100%' }}
                  center={[60, -96]}
                  zoom={4}
                  zoomControl={true}
                  attributionControl={false}
                >
                  <TileLayer
                    key={dark ? 'dark' : 'light'}
                    url={dark
                      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
                    }
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    subdomains="abcd"
                    maxZoom={20}
                    updateWhenZooming={false}
                    updateWhenIdle={true}
                  />
                  <CaMapController layerRef={layerRef} />
                  <GeoJSON
                    key="canada"
                    data={geojson}
                    style={geoStyle}
                    onEachFeature={handleEachFeature}
                    ref={layerRef as any}
                    {...({ smoothFactor: 0 } as any)}
                  />
                  {bubbleMapMode && bubbleData.map(b => (
                    <CircleMarker
                      key={`${b.id}-${simRunning}`}
                      center={b.center}
                      radius={b.radius}
                      pathOptions={{
                        fillColor: b.color,
                        fillOpacity: 0.85,
                        color: 'rgba(255,255,255,0.7)',
                        weight: 0.6,
                        opacity: 0.9,
                      }}
                      eventHandlers={{
                        click: () => {
                          if (multiSelectModeRef.current) {
                            setSelectedRidingIds(prev => { const n = new Set(prev); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n; });
                            return;
                          }
                          const geo = geoPropsMapRef.current.get(b.id);
                          if (!geo) return;
                          setSelectedRiding({ id: b.id, ...geo });
                        },
                        mousemove: (e) => {
                          if (multiSelectModeRef.current) { setTooltip(null); return; }
                          const data = byIdMapRef.current.get(b.id);
                          const geo  = geoPropsMapRef.current.get(b.id);
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (!data || !geo || !rect) return;
                          const preset = activePresetRef.current;
                          const rawResults = (preset === '2025' || preset === '2026' || preset === 'sim' || preset === 'blank')
                            ? (currentResultsRef.current[b.id] ?? {})
                            : {};
                          const totalReported = Object.values(rawResults).reduce((s, v) => s + v, 0);
                          const parties = Object.entries(rawResults)
                            .filter(([, v]) => v > 0)
                            .sort(([, a], [, bv]) => bv - a)
                            .map(([pid, votes]) => ({
                              id: pid, votes,
                              pct: totalReported > 0 ? Math.round((votes / totalReported) * 1000) / 10 : 0,
                            }));
                          const reportingPct = preset === 'sim' && data.validVotes > 0
                            ? (totalReported / data.validVotes) * 100
                            : undefined;
                          const lme = e as L.LeafletMouseEvent;
                          setTooltip({
                            x: lme.originalEvent.clientX - rect.left,
                            y: lme.originalEvent.clientY - rect.top,
                            name_en: geo.name_en, name_fr: geo.name_fr, province: geo.province,
                            electorate: data.electorate, validVotes: data.validVotes, parties,
                            reportingPct,
                          });
                        },
                        mouseout: () => setTooltip(null),
                      }}
                    />
                  ))}
                  <MapFitter geojson={geojson} />
                </MapContainer>

                {tooltip && containerRef.current && (
                  <MapTooltip
                    tooltip={tooltip}
                    containerW={containerRef.current.clientWidth}
                    containerH={containerRef.current.clientHeight}
                  />
                )}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider animate-pulse">Loading map…</span>
              </div>
            )}
          </div>

          {!multiSelectMode && selectedRiding && (
            <RidingPanel
              {...selectedRiding}
              results={selectedPanelResults}
              results2025={byIdMap.get(selectedRiding.id)?.results2025}
              validVotes={selectedPanelValidVotes}
              activePreset={activePreset}
              onClose={() => setSelectedRiding(null)}
              onResultsChange={handleRidingResultsChange}
            />
          )}

          {multiSelectMode && selectedRidingIds.size > 0 && (
            <CaMultiSelectPanel
              selectedIds={selectedRidingIds}
              byIdMap={byIdMap}
              currentResults={currentResults}
              onResultsChange={handleRidingResultsChange}
              onClose={() => { setMultiSelectMode(false); setSelectedRidingIds(new Set()); }}
            />
          )}

          {(swingOpen || swingExiting) && (
            <CaSwingPanel
              exiting={swingExiting}
              ridingData={ridingData}
              currentResults={currentResults}
              onResultsChange={handleRidingResultsChange}
              activePreset={activePreset}
              onReset={activePreset === '2026' ? load2026 : load2025}
              onClose={toggleSwing}
            />
          )}

          {(breakdownOpen || breakdownExiting) && (
            <CaBreakdownDrawer
              ridingData={ridingData}
              currentResults={currentResults}
              activePreset={activePreset}
              exiting={breakdownExiting}
              onClose={toggleBreakdown}
            />
          )}

          {(simOpen || simExiting) && (
            <CaSimulationPanel
              exiting={simExiting}
              ridingData={ridingData}
              onApplyResults={handleSimApplyResults}
              onUpdateRiding={handleRidingResultsChange}
              onClose={toggleSim}
              simRunning={simRunning}
              simProgress={simProgress}
              timersRef={simTimersRef}
              setSimRunning={setSimRunning}
              setSimProgress={setSimProgress}
              stopSim={stopSim}
            />
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — Canadian Federal Edition</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
        </div>
      </div>

    </div>
  );
}
