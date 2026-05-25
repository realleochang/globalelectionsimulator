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
  const lats: [number, number, number, string][] = [
    [7.6,  11.2, 2.8, '#12B6CF'],
    [13.2, 13.7, 3.4, '#02A95B'],
    [16.0, 14.0, 3.6, '#E4003B'],
    [18.8, 13.7, 3.4, '#FAA61A'],
    [24.4, 11.2, 2.8, '#0087DC'],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <defs>
        <clipPath id="ca-logo-clip"><circle cx="16" cy="16" r="14" /></clipPath>
        <radialGradient id="ca-logo-shine" cx="32%" cy="24%" r="52%">
          <stop offset="0%"   stopColor="white" stopOpacity="0.80" />
          <stop offset="45%"  stopColor="white" stopOpacity="0.12" />
          <stop offset="100%" stopColor="white" stopOpacity="0"    />
        </radialGradient>
        <radialGradient id="ca-logo-depth" cx="70%" cy="72%" r="55%">
          <stop offset="0%"   stopColor="rgba(20,60,120,0.18)" />
          <stop offset="100%" stopColor="rgba(20,60,120,0)"    />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="rgba(180,215,255,0.09)" clipPath="url(#ca-logo-clip)" />
      <g clipPath="url(#ca-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`bk-${y}`} d={`M${16-rx} ${y} A${rx} ${ry} 0 0 0 ${16+rx} ${y}`}
            stroke={color} strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
        ))}
      </g>
      <g clipPath="url(#ca-logo-clip)" fill="none" strokeLinecap="round"
         stroke="rgba(80,140,210,0.22)" strokeWidth="0.6" strokeDasharray="2 2">
        <ellipse cx="16" cy="16" rx="8" ry="14" />
        <ellipse cx="16" cy="16" rx="4" ry="14" />
      </g>
      <g clipPath="url(#ca-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`ft-${y}`} d={`M${16-rx} ${y} A${rx} ${ry} 0 0 1 ${16+rx} ${y}`}
            stroke={color} strokeWidth="1.30" strokeOpacity="0.90" />
        ))}
      </g>
      <g clipPath="url(#ca-logo-clip)" fill="none" stroke="rgba(80,140,210,0.32)" strokeLinecap="round">
        <line x1="16" y1="2" x2="16" y2="30" strokeWidth="0.70" />
        <ellipse cx="16" cy="16" rx="8" ry="14" strokeWidth="0.65" />
        <ellipse cx="16" cy="16" rx="4" ry="14" strokeWidth="0.55" />
      </g>
      <circle cx="16" cy="16" r="14" fill="url(#ca-logo-depth)" />
      <circle cx="16" cy="16" r="14" fill="url(#ca-logo-shine)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(140,195,255,0.55)" strokeWidth="1.1" />
      <circle cx="16" cy="16" r="13.4" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.5" />
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
function CanadaScoreboard({ tally, votePcts, rawVotes, activePreset, hiddenParties }: {
  tally:     Record<string, number>;
  votePcts:  Record<string, number>;
  rawVotes:  Record<string, number>;
  activePreset: string | null;
  hiddenParties?: Set<string>;
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

  const visibleParties = hiddenParties && hiddenParties.size > 0
    ? sortedParties.filter(p => !hiddenParties.has(p.id))
    : sortedParties;

  const topSeatPartyId = sortedParties.find(p => (tally[p.id] ?? 0) > 0)?.id ?? null;
  const topSeats       = topSeatPartyId ? (tally[topSeatPartyId] ?? 0) : 0;
  const hasMajority    = topSeats >= CA_MAJORITY;

  return (
    <div className="shrink-0 border-b border-default bg-canvas">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-2 mx-auto w-fit">
          {visibleParties.map(p => {
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
  onReportingCommit?: (id: string, pct: number) => void;
}
function RidingPanel({ name_en, name_fr, province, id, results, results2025, validVotes, activePreset, onClose, onResultsChange, onReportingCommit }: RidingPanelProps) {
  const total = validVotes ?? 0;

  // Slider + lock state
  const [sliderPcts, setSliderPcts] = useState<Record<string, number>>({});
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [projected, setProjected] = useState(false);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [reporting, setReporting] = useState('');
  const reportingNum = parseFloat(reporting) || 0;
  const showReporting = activePreset === 'sim';

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

  // Reset locks and reporting when riding changes
  useEffect(() => { setLocked(new Set()); setReporting(''); }, [id]);

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
    onReportingCommit?.(id, parseFloat(reporting) || 0);
    setProjected(true);
  }, [sliderPcts, id, total, onResultsChange, onReportingCommit, reporting]);

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
    <div className="w-[280px] shrink-0 border-l border-default bg-surface flex flex-col overflow-y-auto z-10">
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

          {/* % Reporting slider — blank map and live sim */}
          {showReporting && (
            <div className="mb-3 pb-3 border-b border-default">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">% Reporting</div>
                <span className="text-[12px] font-mono font-semibold tabular-nums text-ink">
                  {Math.round(reportingNum)}%
                </span>
              </div>
              <input
                type="range" min={0} max={100} step={1}
                value={reportingNum}
                onChange={e => { setReporting(e.target.value); setProjected(false); }}
                className="ca-party-slider w-full"
                style={{ '--party-color': '#c8a020', '--pct': `${reportingNum}%` } as React.CSSProperties}
              />
            </div>
          )}

          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">
            {activePreset === '2025' ? '2025 Result' : activePreset === '2026' ? '2026 Projection' : activePreset === 'sim' ? 'Simulation' : 'Manual Entry'}
          </div>
          <div className="space-y-3.5">
            {sliderParties.map(p => {
              const pct = sliderPcts[p.id] ?? 0;
              const reportingFactor = showReporting ? reportingNum / 100 : 1;
              const votes = Math.round((pct / 100) * total * reportingFactor);
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
          ) : (
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
function MapTooltip({ tooltip, containerW, containerH, dark = true }: {
  tooltip: NonNullable<TooltipState>;
  containerW: number;
  containerH: number;
  dark?: boolean;
}) {
  const TW = 272;
  const isSim = tooltip.reportingPct !== undefined;
  const TH_EST = (isSim ? 80 : 120) + tooltip.parties.length * 48;
  const left = tooltip.x + 18 + TW > containerW ? tooltip.x - TW - 10 : tooltip.x + 18;
  const top  = Math.max(6, Math.min(tooltip.y - 20, containerH - TH_EST - 8));

  const reportingLabel = isSim
    ? (tooltip.reportingPct! >= 99.5 ? '100% reporting' : `${tooltip.reportingPct!.toFixed(0)}% reporting`)
    : null;

  const tt = {
    bg:     dark ? 'rgba(18,24,44,0.96)'        : 'rgba(255,255,255,0.97)',
    border: dark ? 'rgba(255,255,255,0.09)'     : 'rgba(0,0,0,0.08)',
    shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)': '0 6px 28px rgba(0,0,0,0.12)',
    title:  dark ? 'rgba(255,255,255,0.92)'     : 'rgba(0,0,0,0.85)',
    sub2:   dark ? 'rgba(255,255,255,0.32)'     : 'rgba(0,0,0,0.38)',
    sub:    dark ? 'rgba(255,255,255,0.42)'     : 'rgba(0,0,0,0.42)',
    body:   dark ? 'rgba(255,255,255,0.85)'     : 'rgba(0,0,0,0.78)',
    muted:  dark ? 'rgba(255,255,255,0.38)'     : 'rgba(0,0,0,0.40)',
    dim:    dark ? 'rgba(255,255,255,0.28)'     : 'rgba(0,0,0,0.35)',
    divider:dark ? 'rgba(255,255,255,0.06)'     : 'rgba(0,0,0,0.07)',
  };

  return (
    <div
      className="absolute pointer-events-none z-[1000]"
      style={{ left, top, width: TW }}
    >
      <div style={{
        background: tt.bg,
        borderRadius: 10,
        border: `1px solid ${tt.border}`,
        boxShadow: tt.shadow,
        backdropFilter: 'blur(10px)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 16px 10px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>
            {tooltip.name_en}
          </div>
          {tooltip.name_fr !== tooltip.name_en && (
            <div style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.sub2, marginTop: 2 }}>
              {tooltip.name_fr}
            </div>
          )}
          <div style={{ fontSize: 10.5, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 3 }}>
            {isSim ? (
              <>{tooltip.province} · <span style={{ color: '#c8a020', fontWeight: 700 }}>{reportingLabel}</span></>
            ) : tooltip.province}
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
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: isWinner ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
                <span style={{ fontSize: 10.5, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, marginRight: 6 }}>
                  {votes.toLocaleString()}
                </span>
                <span style={{ fontSize: 13, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color, minWidth: 44, textAlign: 'right' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          }) : (
            <p style={{ fontSize: 11, color: tt.dim, fontStyle: 'italic', margin: '4px 0 4px' }}>
              {isSim ? 'Not yet reporting' : 'No results — click a preset'}
            </p>
          )}
        </div>

        {/* Footer */}
        {!isSim && (
          <div style={{ borderTop: `1px solid ${tt.divider}`, padding: '7px 16px', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.dim }}>
              {tooltip.validVotes.toLocaleString()} votes cast
            </span>
            <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.dim }}>
              {tooltip.electorate > 0 ? `${tooltip.electorate.toLocaleString()} electorate` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Canada Parliament geometry ────────────────────────────────────────────────
const CA_TOTAL    = 343;
const CA_MAJORITY = 172;
// 7 rows, 13 px step — each row has ~7.2 px arc per seat (dot ⌀ 5 px → ~2 px gap, no overlap)
const CA_HEMI_ROWS   = [31, 37, 43, 49, 55, 61, 67] as const; // sum = 343
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

function generateCaResultUNS(
  riding: RidingData,
  targetPcts: Record<string, number>,
  national2026: Record<string, number>,
): Record<string, number> {
  // Start from 2026 per-riding polling data; fall back to 2025 if missing
  const csvData = DATA_CA_2026[riding.id];
  const result: Record<string, number> = {};
  if (csvData) {
    for (const [pid, frac] of Object.entries(csvData)) result[pid] = Math.round(frac * riding.validVotes);
  } else {
    Object.assign(result, riding.results2025);
  }
  // Apply additive swing from 2026 national baseline to target
  for (const [pid, targetPct] of Object.entries(targetPcts)) {
    if (pid === 'BQ' && !QC_PROVINCES.has(riding.province)) continue;
    const baseline = national2026[pid] ?? 0;
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
      seatShare: ((seats[p] ?? 0) / 343) * 100,
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
    <aside className={`w-80 shrink-0 bg-surface border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
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
  hiddenParties,
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
  hiddenParties?: Set<string>;
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

  const buildAllResults = useCallback((): Record<string, Record<string, number>> => {
    // Compute 2026 national baseline from DATA_CA_2026 × validVotes
    const totals: Record<string, number> = {};
    let totalVotes = 0;
    for (const r of ridingData) {
      const d = DATA_CA_2026[r.id];
      if (!d) continue;
      for (const [pid, frac] of Object.entries(d)) {
        const v = frac * r.validVotes;
        totals[pid] = (totals[pid] ?? 0) + v;
        totalVotes += v;
      }
    }
    const national2026: Record<string, number> = {};
    for (const [pid, v] of Object.entries(totals)) national2026[pid] = totalVotes > 0 ? v / totalVotes : 0;

    const targetPcts: Record<string, number> = {};
    for (const p of CA_SIM_INPUT_PARTIES) targetPcts[p.id] = parseNum(inputs[p.id] ?? '');
    const all: Record<string, Record<string, number>> = {};
    for (const r of ridingData) all[r.id] = generateCaResultUNS(r, targetPcts, national2026);
    return all;
  }, [ridingData, inputs]);

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
          {CA_SIM_INPUT_PARTIES.filter(p => !hiddenParties?.has(p.id)).map(p => (
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
          {CA_SIM_INPUT_PARTIES.filter(p => !hiddenParties?.has(p.id)).map(p => {
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
              <span>{simProgress} / 343 declared</span>
              <span>{Math.round((simProgress / 343) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${(simProgress / 343) * 100}%` }} />
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
const DATA_CA_2026: Record<string, Record<string, number>> = {
  '10001':{CON:0.2928,GRN:0.0222,LIB:0.5568,NDP:0.117,OTH:0.0044,PPC:0.0069},
  '10002':{CON:0.1999,GRN:0.0211,LIB:0.6433,NDP:0.1273,OTH:0.0026,PPC:0.0058},
  '10003':{CON:0.4707,GRN:0.017,LIB:0.4295,NDP:0.0691,OTH:0.0051,PPC:0.0087},
  '10004':{CON:0.3367,GRN:0.0204,LIB:0.48,NDP:0.1495,OTH:0.0047,PPC:0.0087},
  '10005':{CON:0.4334,GRN:0.0173,LIB:0.4184,NDP:0.1045,OTH:0.0176,PPC:0.0088},
  '10006':{CON:0.189,GRN:0.0302,LIB:0.5489,NDP:0.2253,PPC:0.0067},
  '10007':{CON:0.4042,GRN:0.0183,LIB:0.4616,NDP:0.1021,OTH:0.0049,PPC:0.009},
  '11001':{CON:0.3161,GRN:0.0291,LIB:0.5626,NDP:0.0646,OTH:0.0208,PPC:0.0069},
  '11002':{CON:0.2313,GRN:0.0324,LIB:0.6157,NDP:0.1094,OTH:0.0048,PPC:0.0064},
  '11003':{CON:0.3642,GRN:0.0447,LIB:0.502,NDP:0.076,OTH:0.0049,PPC:0.0083},
  '11004':{CON:0.3047,GRN:0.0694,LIB:0.5489,NDP:0.065,OTH:0.0048,PPC:0.0072},
  '12001':{CON:0.3908,GRN:0.0271,LIB:0.4809,NDP:0.0894,OTH:0.0039,PPC:0.0079},
  '12002':{CON:0.3617,GRN:0.0293,LIB:0.4956,NDP:0.1012,OTH:0.0043,PPC:0.0079},
  '12003':{CON:0.366,GRN:0.0229,LIB:0.514,NDP:0.0854,OTH:0.0044,PPC:0.0073},
  '12004':{CON:0.3881,GRN:0.0318,LIB:0.4698,NDP:0.0974,OTH:0.005,PPC:0.008},
  '12005':{CON:0.1706,GRN:0.0358,LIB:0.6255,NDP:0.161,OTH:0.0004,PPC:0.0067},
  '12006':{CON:0.1231,GRN:0.0452,LIB:0.5165,NDP:0.3052,OTH:0.0039,PPC:0.0062},
  '12007':{CON:0.2109,GRN:0.0307,LIB:0.614,NDP:0.1332,OTH:0.0047,PPC:0.0065},
  '12008':{CON:0.2739,GRN:0.0341,LIB:0.582,NDP:0.0978,OTH:0.0049,PPC:0.0073},
  '12009':{CON:0.2641,GRN:0.0271,LIB:0.5947,NDP:0.1025,OTH:0.0049,PPC:0.0068},
  '12010':{CON:0.3222,GRN:0.0421,LIB:0.4983,NDP:0.1181,OTH:0.0098,PPC:0.0096},
  '12011':{CON:0.2942,GRN:0.024,LIB:0.4861,NDP:0.1273,OTH:0.0601,PPC:0.0083},
  '13001':{CON:0.199,GRN:0.0389,LIB:0.631,NDP:0.1184,OTH:0.0046,PPC:0.0081},
  '13002':{CON:0.2826,GRN:0.0442,LIB:0.5835,NDP:0.0761,OTH:0.0066,PPC:0.007},
  '13003':{CON:0.2635,GRN:0.0584,LIB:0.5914,NDP:0.0675,OTH:0.0127,PPC:0.0065},
  '13004':{CON:0.4651,GRN:0.0398,LIB:0.3957,NDP:0.085,OTH:0.005,PPC:0.0094},
  '13005':{CON:0.3273,GRN:0.0324,LIB:0.5369,NDP:0.0886,OTH:0.0049,PPC:0.0099},
  '13006':{CON:0.4088,GRN:0.0434,LIB:0.4569,NDP:0.0769,OTH:0.0049,PPC:0.0091},
  '13007':{CON:0.2477,GRN:0.0445,LIB:0.592,NDP:0.1042,OTH:0.0047,PPC:0.007},
  '13008':{CON:0.3119,GRN:0.0356,LIB:0.5662,NDP:0.0785,OTH:0.0009,PPC:0.0069},
  '13009':{CON:0.4569,GRN:0.0345,LIB:0.4047,NDP:0.0883,OTH:0.0055,PPC:0.0102},
  '13010':{CON:0.5245,GRN:0.0386,LIB:0.3595,NDP:0.0632,OTH:0.0052,PPC:0.0091},
  '24001':{BQ:0.3278,CON:0.1984,GRN:0.0176,LIB:0.4112,NDP:0.0348,OTH:0.0026,PPC:0.0076},
  '24002':{BQ:0.4772,CON:0.1719,GRN:0.0185,LIB:0.2727,NDP:0.0408,OTH:0.0121,PPC:0.0067},
  '24003':{BQ:0.1489,CON:0.1223,GRN:0.0484,LIB:0.5721,NDP:0.0962,OTH:0.0057,PPC:0.0065},
  '24004':{BQ:0.1903,CON:0.1828,GRN:0.025,LIB:0.5449,NDP:0.0474,OTH:0.0026,PPC:0.0069},
  '24005':{BQ:0.2217,CON:0.2239,GRN:0.019,LIB:0.4884,NDP:0.0371,OTH:0.0028,PPC:0.0071},
  '24006':{BQ:0.1374,CON:0.5864,GRN:0.0125,LIB:0.2101,NDP:0.0286,OTH:0.0029,PPC:0.0221},
  '24007':{BQ:0.4325,CON:0.1724,GRN:0.0179,LIB:0.3325,NDP:0.0357,OTH:0.0028,PPC:0.0062},
  '24008':{BQ:0.2801,CON:0.2751,GRN:0.0207,LIB:0.3696,NDP:0.0483,PPC:0.0063},
  '24009':{BQ:0.4608,CON:0.1957,GRN:0.0193,LIB:0.2844,NDP:0.0312,OTH:0.0028,PPC:0.0058},
  '24010':{BQ:0.18,CON:0.4581,GRN:0.0182,LIB:0.2941,NDP:0.0365,OTH:0.0028,PPC:0.0102},
  '24011':{BQ:0.4663,CON:0.1144,GRN:0.0207,LIB:0.3426,NDP:0.0478,OTH:0.0027,PPC:0.0055},
  '24012':{BQ:0.3274,CON:0.1451,GRN:0.0137,LIB:0.2393,NDP:0.265,OTH:0.0026,PPC:0.0068},
  '24013':{BQ:0.1571,CON:0.1376,GRN:0.0298,LIB:0.575,NDP:0.0814,OTH:0.0115,PPC:0.0076},
  '24014':{BQ:0.2726,CON:0.1681,GRN:0.0216,LIB:0.4954,NDP:0.0334,OTH:0.0028,PPC:0.0061},
  '24015':{BQ:0.1248,CON:0.1624,GRN:0.0203,LIB:0.6348,NDP:0.0491,OTH:0.0027,PPC:0.0059},
  '24016':{BQ:0.1817,CON:0.3886,GRN:0.0178,LIB:0.3579,NDP:0.039,OTH:0.0065,PPC:0.0086},
  '24017':{BQ:0.2819,CON:0.1939,GRN:0.0177,LIB:0.4648,NDP:0.0329,OTH:0.0028,PPC:0.0059},
  '24018':{BQ:0.3075,CON:0.314,GRN:0.0144,LIB:0.3245,NDP:0.0303,OTH:0.0029,PPC:0.0065},
  '24019':{BQ:0.2556,CON:0.1947,GRN:0.0241,LIB:0.4693,NDP:0.046,OTH:0.0028,PPC:0.0074},
  '24020':{BQ:0.1963,CON:0.4282,GRN:0.0164,LIB:0.3196,NDP:0.0292,OTH:0.0031,PPC:0.0072},
  '24021':{BQ:0.4204,CON:0.2238,GRN:0.0158,LIB:0.275,NDP:0.0266,OTH:0.0314,PPC:0.007},
  '24022':{BQ:0.1171,CON:0.1825,GRN:0.0223,LIB:0.6065,NDP:0.0565,OTH:0.0082,PPC:0.0069},
  '24023':{BQ:0.4174,CON:0.2028,GRN:0.0152,LIB:0.2916,NDP:0.0623,OTH:0.0027,PPC:0.008},
  '24024':{BQ:0.4436,CON:0.1056,GRN:0.0154,LIB:0.3891,NDP:0.0271,OTH:0.0139,PPC:0.0053},
  '24025':{BQ:0.1533,CON:0.1708,GRN:0.0178,LIB:0.6091,NDP:0.0399,OTH:0.0022,PPC:0.0068},
  '24026':{BQ:0.2522,CON:0.0861,GRN:0.034,LIB:0.4539,NDP:0.164,OTH:0.0048,PPC:0.0049},
  '24027':{BQ:0.12,CON:0.1886,GRN:0.0163,LIB:0.6159,NDP:0.0503,OTH:0.0027,PPC:0.0063},
  '24028':{BQ:0.112,CON:0.1461,GRN:0.0286,LIB:0.63,NDP:0.0736,OTH:0.0039,PPC:0.0058},
  '24029':{BQ:0.4799,CON:0.1326,GRN:0.0238,LIB:0.3195,NDP:0.0359,OTH:0.0027,PPC:0.0056},
  '24030':{BQ:0.397,CON:0.2776,GRN:0.0138,LIB:0.2728,NDP:0.0289,OTH:0.0029,PPC:0.0069},
  '24031':{BQ:0.4166,CON:0.1104,GRN:0.0246,LIB:0.382,NDP:0.0584,OTH:0.0029,PPC:0.0051},
  '24032':{BQ:0.3385,CON:0.1519,GRN:0.0148,LIB:0.4521,NDP:0.0348,OTH:0.0028,PPC:0.0051},
  '24033':{BQ:0.4526,CON:0.2215,GRN:0.0184,LIB:0.2703,NDP:0.0269,OTH:0.0028,PPC:0.0074},
  '24034':{BQ:0.029,CON:0.2111,GRN:0.02,LIB:0.6884,NDP:0.042,OTH:0.0027,PPC:0.0068},
  '24035':{BQ:0.1985,CON:0.1165,GRN:0.031,LIB:0.5049,NDP:0.132,OTH:0.0117,PPC:0.0053},
  '24036':{BQ:0.4398,CON:0.1311,GRN:0.0224,LIB:0.3598,NDP:0.037,OTH:0.0028,PPC:0.0069},
  '24037':{BQ:0.1365,CON:0.0712,GRN:0.0395,LIB:0.4964,NDP:0.2335,OTH:0.0184,PPC:0.0046},
  '24038':{BQ:0.1342,CON:0.2835,GRN:0.0239,LIB:0.4953,NDP:0.0502,OTH:0.0026,PPC:0.0103},
  '24039':{BQ:0.3533,CON:0.1601,GRN:0.0218,LIB:0.4217,NDP:0.034,OTH:0.0028,PPC:0.0063},
  '24040':{BQ:0.189,CON:0.4428,GRN:0.0171,LIB:0.3039,NDP:0.035,OTH:0.0028,PPC:0.0093},
  '24041':{BQ:0.2487,CON:0.1466,GRN:0.0253,LIB:0.4882,NDP:0.0747,OTH:0.0097,PPC:0.0067},
  '24042':{BQ:0.3711,CON:0.1198,GRN:0.0287,LIB:0.4026,NDP:0.0694,OTH:0.0025,PPC:0.0059},
  '24043':{BQ:0.2,CON:0.1748,GRN:0.0257,LIB:0.5531,NDP:0.0374,OTH:0.0026,PPC:0.0064},
  '24044':{BQ:0.1827,CON:0.4128,GRN:0.0154,LIB:0.3415,NDP:0.0361,OTH:0.0028,PPC:0.0086},
  '24045':{BQ:0.2186,CON:0.1767,GRN:0.0257,LIB:0.5159,NDP:0.0535,OTH:0.0026,PPC:0.007},
  '24046':{BQ:0.1596,CON:0.5532,GRN:0.0169,LIB:0.2274,NDP:0.0293,OTH:0.0037,PPC:0.0099},
  '24047':{BQ:0.3903,CON:0.2007,GRN:0.02,LIB:0.3426,NDP:0.0377,OTH:0.0028,PPC:0.0059},
  '24048':{BQ:0.0249,CON:0.3515,GRN:0.041,LIB:0.4996,NDP:0.0679,OTH:0.0041,PPC:0.0109},
  '24049':{BQ:0.3391,CON:0.1175,GRN:0.0173,LIB:0.4795,NDP:0.0389,OTH:0.0028,PPC:0.0049},
  '24050':{BQ:0.4454,CON:0.2028,GRN:0.0254,LIB:0.2708,NDP:0.0446,OTH:0.0026,PPC:0.0084},
  '24051':{BQ:0.3292,CON:0.3194,GRN:0.0148,LIB:0.3024,NDP:0.025,OTH:0.0029,PPC:0.0062},
  '24052':{BQ:0.0411,CON:0.1707,GRN:0.0324,LIB:0.6389,NDP:0.0967,OTH:0.0141,PPC:0.0061},
  '24053':{BQ:0.1044,CON:0.1009,GRN:0.1171,LIB:0.5274,NDP:0.1421,OTH:0.0024,PPC:0.0057},
  '24054':{BQ:0.1395,CON:0.0784,GRN:0.0534,LIB:0.4764,NDP:0.2082,OTH:0.0375,PPC:0.0065},
  '24055':{BQ:0.4438,CON:0.1003,GRN:0.0201,LIB:0.3919,NDP:0.0357,OTH:0.0027,PPC:0.0055},
  '24056':{BQ:0.0454,CON:0.267,GRN:0.0339,LIB:0.5956,NDP:0.0435,OTH:0.0062,PPC:0.0084},
  '24057':{BQ:0.0959,CON:0.2472,GRN:0.018,LIB:0.5594,NDP:0.0687,OTH:0.0027,PPC:0.0082},
  '24058':{BQ:0.175,CON:0.4649,GRN:0.0167,LIB:0.3066,NDP:0.026,OTH:0.0029,PPC:0.0078},
  '24059':{BQ:0.2669,CON:0.1287,GRN:0.0516,LIB:0.3878,NDP:0.1335,OTH:0.0221,PPC:0.0093},
  '24060':{BQ:0.4086,CON:0.1318,GRN:0.0154,LIB:0.3942,NDP:0.0392,OTH:0.0055,PPC:0.0052},
  '24061':{BQ:0.2638,CON:0.3213,GRN:0.0221,LIB:0.338,NDP:0.0302,OTH:0.0154,PPC:0.0092},
  '24062':{BQ:0.4456,CON:0.1156,GRN:0.0103,LIB:0.3599,NDP:0.0275,OTH:0.036,PPC:0.0051},
  '24063':{BQ:0.3209,CON:0.1539,GRN:0.0176,LIB:0.4683,NDP:0.0319,OTH:0.0025,PPC:0.0049},
  '24064':{BQ:0.4197,CON:0.1833,GRN:0.0207,LIB:0.318,NDP:0.048,OTH:0.0026,PPC:0.0076},
  '24065':{BQ:0.1859,CON:0.0566,GRN:0.0393,LIB:0.3323,NDP:0.378,OTH:0.0029,PPC:0.0049},
  '24066':{BQ:0.4307,CON:0.1595,GRN:0.0194,LIB:0.3469,NDP:0.0351,OTH:0.0028,PPC:0.0055},
  '24067':{BQ:0.434,CON:0.144,GRN:0.0223,LIB:0.3533,NDP:0.0376,OTH:0.0028,PPC:0.0059},
  '24068':{BQ:0.0498,CON:0.2544,GRN:0.0216,LIB:0.6032,NDP:0.0614,OTH:0.0024,PPC:0.0073},
  '24069':{BQ:0.0622,CON:0.1779,GRN:0.0192,LIB:0.6499,NDP:0.0808,OTH:0.0026,PPC:0.0074},
  '24070':{BQ:0.2049,CON:0.2223,GRN:0.0166,LIB:0.5157,NDP:0.0302,OTH:0.004,PPC:0.0062},
  '24071':{BQ:0.3852,CON:0.1558,GRN:0.0188,LIB:0.3964,NDP:0.0341,OTH:0.0027,PPC:0.007},
  '24072':{BQ:0.2544,CON:0.1119,GRN:0.0295,LIB:0.5191,NDP:0.0764,OTH:0.0027,PPC:0.006},
  '24073':{BQ:0.385,CON:0.1474,GRN:0.0157,LIB:0.4051,NDP:0.0383,OTH:0.0028,PPC:0.0056},
  '24074':{BQ:0.3096,CON:0.1628,GRN:0.0201,LIB:0.4631,NDP:0.0355,OTH:0.0027,PPC:0.0061},
  '24075':{BQ:0.2698,CON:0.2476,GRN:0.0142,LIB:0.4248,NDP:0.0349,OTH:0.0031,PPC:0.0057},
  '24076':{BQ:0.1413,CON:0.2042,GRN:0.0189,LIB:0.5927,NDP:0.0337,OTH:0.0027,PPC:0.0064},
  '24077':{BQ:0.0824,CON:0.164,GRN:0.0276,LIB:0.6355,NDP:0.0797,OTH:0.0044,PPC:0.0063},
  '24078':{BQ:0.1565,CON:0.2122,GRN:0.0269,LIB:0.5239,NDP:0.0692,OTH:0.0025,PPC:0.0088},
  '35001':{CON:0.3091,GRN:0.0143,LIB:0.5897,NDP:0.0614,OTH:0.0144,PPC:0.0111},
  '35002':{CON:0.4571,GRN:0.0141,LIB:0.4061,NDP:0.0791,OTH:0.0287,PPC:0.0149},
  '35003':{CON:0.4389,GRN:0.039,LIB:0.4622,NDP:0.0411,OTH:0.007,PPC:0.0117},
  '35004':{CON:0.4803,GRN:0.0184,LIB:0.4089,NDP:0.0709,OTH:0.0069,PPC:0.0146},
  '35005':{CON:0.425,GRN:0.0198,LIB:0.4621,NDP:0.0577,OTH:0.0212,PPC:0.0141},
  '35006':{CON:0.3559,GRN:0.0183,LIB:0.5294,NDP:0.077,OTH:0.0068,PPC:0.0126},
  '35007':{CON:0.1661,GRN:0.0209,LIB:0.6684,NDP:0.127,OTH:0.0074,PPC:0.0102},
  '35008':{CON:0.4065,GRN:0.013,LIB:0.4864,NDP:0.0648,OTH:0.016,PPC:0.0132},
  '35009':{CON:0.3875,GRN:0.0172,LIB:0.5179,NDP:0.063,OTH:0.0026,PPC:0.0119},
  '35010':{CON:0.3629,GRN:0.0176,LIB:0.5253,NDP:0.0625,OTH:0.0175,PPC:0.0143},
  '35011':{CON:0.3776,GRN:0.0076,LIB:0.5418,NDP:0.0482,OTH:0.003,PPC:0.0218},
  '35012':{CON:0.3882,GRN:0.0128,LIB:0.524,NDP:0.0541,OTH:0.0069,PPC:0.014},
  '35013':{CON:0.39,GRN:0.0111,LIB:0.5307,NDP:0.0474,OTH:0.0086,PPC:0.0122},
  '35014':{CON:0.4115,GRN:0.0112,LIB:0.5151,NDP:0.0464,OTH:0.0023,PPC:0.0134},
  '35015':{CON:0.4337,GRN:0.0239,LIB:0.4438,NDP:0.0791,OTH:0.0072,PPC:0.0123},
  '35016':{CON:0.436,GRN:0.0329,LIB:0.4305,NDP:0.0732,OTH:0.012,PPC:0.0153},
  '35017':{CON:0.3267,GRN:0.0123,LIB:0.5963,NDP:0.0511,OTH:0.0025,PPC:0.0111},
  '35018':{CON:0.3562,GRN:0.0119,LIB:0.5594,NDP:0.0533,OTH:0.0068,PPC:0.0124},
  '35019':{CON:0.3956,GRN:0.0227,LIB:0.4944,NDP:0.0729,OTH:0.0014,PPC:0.013},
  '35020':{CON:0.373,GRN:0.011,LIB:0.5437,NDP:0.0418,OTH:0.0192,PPC:0.0113},
  '35021':{CON:0.4827,GRN:0.0161,LIB:0.3924,NDP:0.0866,OTH:0.007,PPC:0.015},
  '35022':{CON:0.1487,GRN:0.0301,LIB:0.5259,NDP:0.2771,OTH:0.0076,PPC:0.0106},
  '35023':{CON:0.3414,GRN:0.0142,LIB:0.5673,NDP:0.0585,OTH:0.0074,PPC:0.0111},
  '35024':{CON:0.2558,GRN:0.0155,LIB:0.6514,NDP:0.0559,OTH:0.0105,PPC:0.0109},
  '35025':{CON:0.5061,GRN:0.0285,LIB:0.3804,NDP:0.0627,OTH:0.0054,PPC:0.0168},
  '35026':{CON:0.3922,GRN:0.0118,LIB:0.5295,NDP:0.0479,OTH:0.007,PPC:0.0115},
  '35027':{CON:0.4047,GRN:0.0205,LIB:0.4556,NDP:0.0959,OTH:0.0067,PPC:0.0166},
  '35028':{CON:0.4757,GRN:0.0115,LIB:0.3945,NDP:0.0968,OTH:0.0069,PPC:0.0145},
  '35029':{CON:0.3442,GRN:0.0184,LIB:0.5594,NDP:0.0558,OTH:0.0065,PPC:0.0157},
  '35030':{CON:0.3064,GRN:0.0154,LIB:0.6032,NDP:0.0594,OTH:0.0035,PPC:0.0121},
  '35031':{CON:0.3315,GRN:0.0146,LIB:0.5643,NDP:0.0714,OTH:0.0036,PPC:0.0146},
  '35032':{CON:0.439,GRN:0.0141,LIB:0.4681,NDP:0.0593,OTH:0.007,PPC:0.0125},
  '35033':{CON:0.2309,GRN:0.1227,LIB:0.5608,NDP:0.0683,OTH:0.0059,PPC:0.0114},
  '35034':{CON:0.4853,GRN:0.0162,LIB:0.3991,NDP:0.0753,OTH:0.0108,PPC:0.0132},
  '35035':{CON:0.469,GRN:0.0157,LIB:0.4176,NDP:0.0759,OTH:0.0069,PPC:0.0149},
  '35036':{CON:0.1902,GRN:0.0308,LIB:0.3295,NDP:0.4256,OTH:0.0106,PPC:0.0132},
  '35037':{CON:0.3944,GRN:0.0144,LIB:0.4931,NDP:0.0773,OTH:0.0068,PPC:0.0139},
  '35038':{CON:0.313,GRN:0.0149,LIB:0.454,NDP:0.201,OTH:0.0035,PPC:0.0137},
  '35039':{CON:0.2862,GRN:0.0171,LIB:0.5818,NDP:0.1016,OTH:0.0024,PPC:0.0108},
  '35040':{CON:0.4498,GRN:0.018,LIB:0.4356,NDP:0.0772,OTH:0.007,PPC:0.0124},
  '35041':{CON:0.2754,GRN:0.0099,LIB:0.5741,NDP:0.119,OTH:0.0078,PPC:0.0137},
  '35042':{CON:0.4376,GRN:0.0194,LIB:0.4462,NDP:0.0738,OTH:0.0095,PPC:0.0135},
  '35043':{CON:0.2787,GRN:0.0171,LIB:0.6368,NDP:0.0555,OTH:0.0014,PPC:0.0105},
  '35044':{CON:0.3849,GRN:0.0094,LIB:0.4026,NDP:0.18,OTH:0.0065,PPC:0.0167},
  '35045':{CON:0.3765,GRN:0.0152,LIB:0.3576,NDP:0.2297,OTH:0.0065,PPC:0.0145},
  '35046':{CON:0.2297,GRN:0.0184,LIB:0.6436,NDP:0.0912,OTH:0.0065,PPC:0.0105},
  '35047':{CON:0.5302,GRN:0.014,LIB:0.398,NDP:0.0385,OTH:0.0073,PPC:0.012},
  '35048':{CON:0.2495,GRN:0.3871,LIB:0.2912,NDP:0.0551,OTH:0.0037,PPC:0.0134},
  '35049':{CON:0.3633,GRN:0.0627,LIB:0.4851,NDP:0.0664,OTH:0.0063,PPC:0.0162},
  '35050':{CON:0.3933,GRN:0.0277,LIB:0.4977,NDP:0.0681,OTH:0.0014,PPC:0.0119},
  '35051':{CON:0.4085,GRN:0.0186,LIB:0.4861,NDP:0.0664,OTH:0.0068,PPC:0.0135},
  '35052':{CON:0.4104,GRN:0.0174,LIB:0.4763,NDP:0.076,OTH:0.0069,PPC:0.013},
  '35053':{CON:0.2312,GRN:0.0201,LIB:0.5685,NDP:0.1674,OTH:0.0012,PPC:0.0116},
  '35054':{CON:0.2735,GRN:0.0211,LIB:0.2751,NDP:0.408,OTH:0.0056,PPC:0.0166},
  '35055':{CON:0.2851,GRN:0.0108,LIB:0.5801,NDP:0.1039,OTH:0.0079,PPC:0.0121},
  '35056':{CON:0.3713,GRN:0.0117,LIB:0.5543,NDP:0.0489,OTH:0.0025,PPC:0.0113},
  '35057':{CON:0.3333,GRN:0.0204,LIB:0.5776,NDP:0.0515,OTH:0.0035,PPC:0.0138},
  '35058':{CON:0.4076,GRN:0.0143,LIB:0.5193,NDP:0.0399,OTH:0.006,PPC:0.0129},
  '35059':{CON:0.4263,GRN:0.0164,LIB:0.4524,NDP:0.0891,OTH:0.0031,PPC:0.0128},
  '35060':{CON:0.4003,GRN:0.0156,LIB:0.5249,NDP:0.0445,OTH:0.0031,PPC:0.0116},
  '35061':{CON:0.3345,GRN:0.0147,LIB:0.5692,NDP:0.0627,OTH:0.006,PPC:0.0128},
  '35062':{CON:0.3621,GRN:0.0137,LIB:0.5367,NDP:0.0643,OTH:0.0085,PPC:0.0147},
  '35063':{CON:0.3224,GRN:0.0108,LIB:0.596,NDP:0.0547,OTH:0.0036,PPC:0.0124},
  '35064':{CON:0.3583,GRN:0.0139,LIB:0.5627,NDP:0.0496,OTH:0.0045,PPC:0.0109},
  '35065':{CON:0.3365,GRN:0.0165,LIB:0.5622,NDP:0.0624,OTH:0.0067,PPC:0.0156},
  '35066':{CON:0.3637,GRN:0.0118,LIB:0.5499,NDP:0.056,OTH:0.0069,PPC:0.0116},
  '35067':{CON:0.2572,GRN:0.0106,LIB:0.6657,NDP:0.0498,OTH:0.0068,PPC:0.0098},
  '35068':{CON:0.4085,GRN:0.019,LIB:0.4957,NDP:0.0564,OTH:0.0068,PPC:0.0136},
  '35069':{CON:0.5047,GRN:0.0167,LIB:0.4084,NDP:0.0503,OTH:0.0072,PPC:0.0126},
  '35070':{CON:0.4032,GRN:0.0134,LIB:0.4826,NDP:0.0819,OTH:0.0064,PPC:0.0124},
  '35071':{CON:0.3891,GRN:0.0138,LIB:0.4693,NDP:0.1102,OTH:0.0032,PPC:0.0144},
  '35072':{CON:0.4226,GRN:0.0169,LIB:0.4612,NDP:0.0709,OTH:0.0151,PPC:0.0133},
  '35073':{CON:0.3562,GRN:0.015,LIB:0.4927,NDP:0.1158,OTH:0.0067,PPC:0.0136},
  '35074':{CON:0.4021,GRN:0.014,LIB:0.4956,NDP:0.0673,OTH:0.0089,PPC:0.0121},
  '35075':{CON:0.3652,GRN:0.0101,LIB:0.5468,NDP:0.0644,OTH:0.0022,PPC:0.0112},
  '35076':{CON:0.3652,GRN:0.0106,LIB:0.5714,NDP:0.0418,OTH:0.0004,PPC:0.0106},
  '35077':{CON:0.2081,GRN:0.0128,LIB:0.7004,NDP:0.06,OTH:0.0094,PPC:0.0093},
  '35078':{CON:0.3788,GRN:0.0172,LIB:0.4436,NDP:0.1388,OTH:0.0065,PPC:0.0151},
  '35079':{CON:0.0886,GRN:0.0332,LIB:0.5485,NDP:0.3094,OTH:0.0124,PPC:0.0079},
  '35080':{CON:0.1939,GRN:0.014,LIB:0.6603,NDP:0.1116,OTH:0.0102,PPC:0.01},
  '35081':{CON:0.1467,GRN:0.0288,LIB:0.6624,NDP:0.1377,OTH:0.0154,PPC:0.009},
  '35082':{CON:0.1975,GRN:0.0162,LIB:0.6437,NDP:0.1274,OTH:0.0048,PPC:0.0104},
  '35083':{CON:0.4355,GRN:0.0211,LIB:0.4067,NDP:0.0898,OTH:0.0331,PPC:0.0137},
  '35084':{CON:0.4197,GRN:0.0312,LIB:0.4505,NDP:0.0756,OTH:0.0066,PPC:0.0163},
  '35085':{CON:0.4282,GRN:0.0269,LIB:0.4303,NDP:0.0914,OTH:0.0066,PPC:0.0165},
  '35086':{CON:0.3279,GRN:0.013,LIB:0.5743,NDP:0.0677,OTH:0.0066,PPC:0.0106},
  '35087':{CON:0.3315,GRN:0.0122,LIB:0.5776,NDP:0.0608,OTH:0.006,PPC:0.0118},
  '35088':{CON:0.325,GRN:0.0178,LIB:0.5824,NDP:0.0583,OTH:0.0042,PPC:0.0122},
  '35089':{CON:0.4377,GRN:0.0137,LIB:0.4847,NDP:0.0491,OTH:0.0037,PPC:0.0111},
  '35090':{CON:0.4316,GRN:0.0147,LIB:0.4013,NDP:0.1046,OTH:0.032,PPC:0.0158},
  '35091':{CON:0.3533,GRN:0.0127,LIB:0.4922,NDP:0.123,OTH:0.0059,PPC:0.0129},
  '35092':{CON:0.3336,GRN:0.0129,LIB:0.5701,NDP:0.0641,OTH:0.0067,PPC:0.0125},
  '35093':{CON:0.298,GRN:0.0151,LIB:0.5961,NDP:0.0708,OTH:0.0066,PPC:0.0134},
  '35094':{CON:0.2399,GRN:0.0165,LIB:0.6572,NDP:0.0687,OTH:0.0066,PPC:0.0112},
  '35095':{CON:0.25,GRN:0.01,LIB:0.6425,NDP:0.0797,OTH:0.0065,PPC:0.0112},
  '35096':{CON:0.2559,GRN:0.0185,LIB:0.6105,NDP:0.0984,OTH:0.0057,PPC:0.011},
  '35097':{CON:0.2122,GRN:0.0538,LIB:0.5194,NDP:0.0955,OTH:0.1071,PPC:0.0119},
  '35098':{CON:0.4322,GRN:0.0211,LIB:0.47,NDP:0.0572,OTH:0.007,PPC:0.0126},
  '35099':{CON:0.3948,GRN:0.026,LIB:0.483,NDP:0.0799,OTH:0.0034,PPC:0.0129},
  '35100':{CON:0.2284,GRN:0.0127,LIB:0.6085,NDP:0.1381,OTH:0.0022,PPC:0.0101},
  '35101':{CON:0.3146,GRN:0.0119,LIB:0.5373,NDP:0.1133,OTH:0.0105,PPC:0.0124},
  '35102':{CON:0.4726,GRN:0.0155,LIB:0.432,NDP:0.0602,OTH:0.0054,PPC:0.0142},
  '35103':{CON:0.299,GRN:0.0183,LIB:0.5251,NDP:0.1372,OTH:0.0064,PPC:0.014},
  '35104':{CON:0.3857,GRN:0.0122,LIB:0.4358,NDP:0.1461,OTH:0.0069,PPC:0.0133},
  '35105':{CON:0.114,GRN:0.033,LIB:0.4816,NDP:0.3521,OTH:0.0094,PPC:0.0099},
  '35106':{CON:0.5779,GRN:0.01,LIB:0.3519,NDP:0.0408,OTH:0.0073,PPC:0.0121},
  '35107':{CON:0.3453,GRN:0.0122,LIB:0.4958,NDP:0.1265,OTH:0.0067,PPC:0.0134},
  '35108':{CON:0.2727,GRN:0.0135,LIB:0.5654,NDP:0.1296,OTH:0.0065,PPC:0.0124},
  '35109':{CON:0.1351,GRN:0.0237,LIB:0.6098,NDP:0.213,OTH:0.0095,PPC:0.0088},
  '35110':{CON:0.1201,GRN:0.026,LIB:0.6191,NDP:0.2209,OTH:0.0048,PPC:0.0091},
  '35111':{CON:0.2554,GRN:0.0122,LIB:0.6452,NDP:0.074,OTH:0.003,PPC:0.0101},
  '35112':{CON:0.1502,GRN:0.0272,LIB:0.5749,NDP:0.2284,OTH:0.0099,PPC:0.0094},
  '35113':{CON:0.5079,GRN:0.0117,LIB:0.4192,NDP:0.0413,OTH:0.0071,PPC:0.0127},
  '35114':{CON:0.2482,GRN:0.0329,LIB:0.6142,NDP:0.0836,OTH:0.0105,PPC:0.0106},
  '35115':{CON:0.424,GRN:0.0286,LIB:0.4757,NDP:0.052,OTH:0.007,PPC:0.0127},
  '35116':{CON:0.3543,GRN:0.0121,LIB:0.5595,NDP:0.0584,OTH:0.0037,PPC:0.012},
  '35117':{CON:0.3471,GRN:0.0145,LIB:0.5576,NDP:0.0614,OTH:0.0067,PPC:0.0126},
  '35118':{CON:0.3672,GRN:0.0111,LIB:0.4836,NDP:0.1161,OTH:0.0084,PPC:0.0136},
  '35119':{CON:0.2645,GRN:0.0183,LIB:0.2818,NDP:0.4141,OTH:0.006,PPC:0.0153},
  '35120':{CON:0.4493,GRN:0.0143,LIB:0.4551,NDP:0.0592,OTH:0.0068,PPC:0.0152},
  '35121':{CON:0.4671,GRN:0.0168,LIB:0.4336,NDP:0.0615,OTH:0.007,PPC:0.014},
  '35122':{CON:0.3032,GRN:0.0136,LIB:0.5631,NDP:0.0995,OTH:0.0064,PPC:0.0142},
  '46001':{CON:0.5258,GRN:0.0305,LIB:0.1725,NDP:0.2392,OTH:0.0109,PPC:0.0212},
  '46002':{CON:0.1703,GRN:0.039,LIB:0.4808,NDP:0.2814,OTH:0.01,PPC:0.0186},
  '46003':{CON:0.3416,GRN:0.0175,LIB:0.2561,NDP:0.3583,OTH:0.0112,PPC:0.0153},
  '46004':{CON:0.3959,GRN:0.0161,LIB:0.4885,NDP:0.0701,OTH:0.0107,PPC:0.0188},
  '46005':{CON:0.6236,GRN:0.0234,LIB:0.2708,NDP:0.0457,OTH:0.0112,PPC:0.0254},
  '46006':{CON:0.5878,GRN:0.0243,LIB:0.3053,NDP:0.0477,OTH:0.0111,PPC:0.0238},
  '46007':{CON:0.5971,GRN:0.0237,LIB:0.2673,NDP:0.0795,OTH:0.0113,PPC:0.0212},
  '46008':{CON:0.2548,GRN:0.0158,LIB:0.6336,NDP:0.0684,OTH:0.0103,PPC:0.0171},
  '46009':{CON:0.5155,GRN:0.0238,LIB:0.342,NDP:0.066,OTH:0.0324,PPC:0.0203},
  '46010':{CON:0.162,GRN:0.0282,LIB:0.3814,NDP:0.3888,OTH:0.0256,PPC:0.0141},
  '46011':{CON:0.2764,GRN:0.0138,LIB:0.6198,NDP:0.0605,OTH:0.013,PPC:0.0164},
  '46012':{CON:0.2833,GRN:0.0144,LIB:0.6306,NDP:0.0441,OTH:0.0104,PPC:0.0172},
  '46013':{CON:0.2112,GRN:0.0175,LIB:0.662,NDP:0.063,OTH:0.0315,PPC:0.0148},
  '46014':{CON:0.3325,GRN:0.0163,LIB:0.5842,NDP:0.0391,OTH:0.0105,PPC:0.0175},
  '47001':{CON:0.6712,GRN:0.0188,LIB:0.2061,NDP:0.0477,OTH:0.0295,PPC:0.0267},
  '47002':{CON:0.679,GRN:0.021,LIB:0.2016,NDP:0.0569,OTH:0.0107,PPC:0.0308},
  '47003':{CON:0.1888,GRN:0.0261,LIB:0.6683,NDP:0.0909,OTH:0.0098,PPC:0.0161},
  '47004':{CON:0.6548,GRN:0.0183,LIB:0.2055,NDP:0.0816,OTH:0.0112,PPC:0.0287},
  '47005':{CON:0.6176,GRN:0.0247,LIB:0.2237,NDP:0.0967,OTH:0.0107,PPC:0.0266},
  '47006':{CON:0.4235,GRN:0.0143,LIB:0.4749,NDP:0.0593,OTH:0.0109,PPC:0.0171},
  '47007':{CON:0.5451,GRN:0.0367,LIB:0.3032,NDP:0.0818,OTH:0.0107,PPC:0.0225},
  '47008':{CON:0.4263,GRN:0.0145,LIB:0.482,NDP:0.0483,OTH:0.0109,PPC:0.018},
  '47009':{CON:0.4164,GRN:0.0144,LIB:0.4482,NDP:0.0932,OTH:0.0109,PPC:0.017},
  '47010':{CON:0.4127,GRN:0.0135,LIB:0.4582,NDP:0.0876,OTH:0.0109,PPC:0.0172},
  '47011':{CON:0.4417,GRN:0.0217,LIB:0.3087,NDP:0.1992,OTH:0.011,PPC:0.0178},
  '47012':{CON:0.7343,GRN:0.0179,LIB:0.1227,NDP:0.0458,OTH:0.0471,PPC:0.0323},
  '47013':{CON:0.7086,GRN:0.0201,LIB:0.1373,NDP:0.0579,OTH:0.0455,PPC:0.0307},
  '47014':{CON:0.6781,GRN:0.0341,LIB:0.1731,NDP:0.056,OTH:0.0276,PPC:0.0312},
  '48001':{CON:0.5765,GRN:0.0191,LIB:0.2913,NDP:0.0534,OTH:0.0354,PPC:0.0243},
  '48002':{CON:0.7045,GRN:0.0179,LIB:0.1571,NDP:0.0661,OTH:0.0292,PPC:0.0251},
  '48003':{CON:0.6616,GRN:0.0128,LIB:0.222,NDP:0.0466,OTH:0.0324,PPC:0.0247},
  '48004':{CON:0.3857,GRN:0.0143,LIB:0.5324,NDP:0.0401,OTH:0.0089,PPC:0.0185},
  '48005':{CON:0.3465,GRN:0.0139,LIB:0.5489,NDP:0.0574,OTH:0.0154,PPC:0.0178},
  '48006':{CON:0.4699,GRN:0.0134,LIB:0.4487,NDP:0.04,OTH:0.0092,PPC:0.0188},
  '48007':{CON:0.4832,GRN:0.0283,LIB:0.3841,NDP:0.0567,OTH:0.0229,PPC:0.0247},
  '48008':{CON:0.4883,GRN:0.017,LIB:0.4132,NDP:0.0385,OTH:0.022,PPC:0.021},
  '48009':{CON:0.3729,GRN:0.0153,LIB:0.5295,NDP:0.042,OTH:0.0207,PPC:0.0196},
  '48010':{CON:0.5246,GRN:0.0162,LIB:0.3621,NDP:0.0474,OTH:0.0282,PPC:0.0214},
  '48011':{CON:0.4692,GRN:0.0166,LIB:0.43,NDP:0.0477,OTH:0.016,PPC:0.0205},
  '48012':{CON:0.5496,GRN:0.0125,LIB:0.3449,NDP:0.0438,OTH:0.0285,PPC:0.0207},
  '48013':{CON:0.4782,GRN:0.0162,LIB:0.4347,NDP:0.0374,OTH:0.0131,PPC:0.0203},
  '48014':{CON:0.4132,GRN:0.01,LIB:0.4225,NDP:0.0389,OTH:0.0936,PPC:0.0217},
  '48015':{CON:0.2639,GRN:0.0158,LIB:0.4822,NDP:0.1866,OTH:0.0326,PPC:0.0189},
  '48016':{CON:0.3648,GRN:0.0077,LIB:0.4084,NDP:0.0645,OTH:0.1317,PPC:0.0229},
  '48017':{CON:0.3253,GRN:0.0141,LIB:0.2124,NDP:0.4074,OTH:0.0212,PPC:0.0196},
  '48018':{CON:0.4004,GRN:0.0148,LIB:0.406,NDP:0.1273,OTH:0.0268,PPC:0.0246},
  '48019':{CON:0.4064,GRN:0.0144,LIB:0.4422,NDP:0.0878,OTH:0.0272,PPC:0.022},
  '48020':{CON:0.3619,GRN:0.0249,LIB:0.5136,NDP:0.0562,OTH:0.0229,PPC:0.0205},
  '48021':{CON:0.4077,GRN:0.012,LIB:0.4528,NDP:0.0731,OTH:0.0291,PPC:0.0253},
  '48022':{CON:0.217,GRN:0.0134,LIB:0.2018,NDP:0.5326,OTH:0.0187,PPC:0.0166},
  '48023':{CON:0.4143,GRN:0.0147,LIB:0.4668,NDP:0.0741,OTH:0.0091,PPC:0.021},
  '48024':{CON:0.6391,GRN:0.0202,LIB:0.2462,NDP:0.0426,OTH:0.0289,PPC:0.023},
  '48025':{CON:0.7033,GRN:0.0159,LIB:0.202,NDP:0.0447,OTH:0.01,PPC:0.0241},
  '48026':{CON:0.6981,GRN:0.0178,LIB:0.1679,NDP:0.0664,OTH:0.0263,PPC:0.0236},
  '48027':{CON:0.7066,GRN:0.0185,LIB:0.1718,NDP:0.0596,OTH:0.0193,PPC:0.0241},
  '48028':{CON:0.6241,GRN:0.0195,LIB:0.2257,NDP:0.0873,OTH:0.021,PPC:0.0223},
  '48029':{CON:0.4836,GRN:0.0165,LIB:0.3954,NDP:0.0534,OTH:0.0308,PPC:0.0203},
  '48030':{CON:0.6323,GRN:0.019,LIB:0.2263,NDP:0.0689,OTH:0.0284,PPC:0.025},
  '48031':{CON:0.6386,GRN:0.0185,LIB:0.2361,NDP:0.0628,OTH:0.0205,PPC:0.0235},
  '48032':{CON:0.5976,GRN:0.0192,LIB:0.1523,NDP:0.0721,OTH:0.128,PPC:0.0307},
  '48033':{CON:0.5799,GRN:0.0143,LIB:0.1335,NDP:0.1257,OTH:0.1078,PPC:0.0389},
  '48034':{CON:0.6009,GRN:0.023,LIB:0.282,NDP:0.0585,OTH:0.013,PPC:0.0226},
  '48035':{CON:0.5282,GRN:0.0364,LIB:0.3315,NDP:0.0715,OTH:0.0112,PPC:0.0212},
  '48036':{CON:0.5119,GRN:0.0235,LIB:0.3614,NDP:0.0686,OTH:0.0121,PPC:0.0225},
  '48037':{CON:0.5622,GRN:0.0317,LIB:0.3109,NDP:0.0583,OTH:0.0125,PPC:0.0245},
  '59001':{CON:0.3441,GRN:0.0123,LIB:0.3421,NDP:0.0376,OTH:0.2539,PPC:0.0101},
  '59002':{CON:0.327,GRN:0.0143,LIB:0.4542,NDP:0.1868,OTH:0.01,PPC:0.0078},
  '59003':{CON:0.2812,GRN:0.0161,LIB:0.6197,NDP:0.0664,OTH:0.0098,PPC:0.0069},
  '59004':{CON:0.5458,GRN:0.0226,LIB:0.3454,NDP:0.0704,OTH:0.0085,PPC:0.0072},
  '59005':{CON:0.4935,GRN:0.0201,LIB:0.3985,NDP:0.0791,OTH:0.0015,PPC:0.0072},
  '59006':{CON:0.4174,GRN:0.0123,LIB:0.5054,NDP:0.0475,OTH:0.0103,PPC:0.0072},
  '59007':{CON:0.4486,GRN:0.0183,LIB:0.3174,NDP:0.1909,OTH:0.0176,PPC:0.0072},
  '59008':{CON:0.3707,GRN:0.012,LIB:0.5124,NDP:0.078,OTH:0.0199,PPC:0.0072},
  '59009':{CON:0.2966,GRN:0.0252,LIB:0.2562,NDP:0.4125,OTH:0.0035,PPC:0.0061},
  '59010':{CON:0.3165,GRN:0.0227,LIB:0.3085,NDP:0.3355,OTH:0.0101,PPC:0.0068},
  '59011':{CON:0.3672,GRN:0.0118,LIB:0.5471,NDP:0.0565,OTH:0.0101,PPC:0.0075},
  '59012':{CON:0.2378,GRN:0.0295,LIB:0.5277,NDP:0.1913,OTH:0.0079,PPC:0.0059},
  '59013':{CON:0.3842,GRN:0.0125,LIB:0.5216,NDP:0.0637,OTH:0.0102,PPC:0.0078},
  '59014':{CON:0.4628,GRN:0.0288,LIB:0.4314,NDP:0.0587,OTH:0.0104,PPC:0.008},
  '59015':{CON:0.4558,GRN:0.0183,LIB:0.4438,NDP:0.064,OTH:0.0104,PPC:0.0078},
  '59016':{CON:0.4038,GRN:0.0127,LIB:0.5239,NDP:0.0415,OTH:0.0102,PPC:0.0079},
  '59017':{CON:0.4561,GRN:0.0107,LIB:0.4748,NDP:0.044,OTH:0.0069,PPC:0.0076},
  '59018':{CON:0.5064,GRN:0.0172,LIB:0.4077,NDP:0.0503,OTH:0.0105,PPC:0.0079},
  '59019':{CON:0.2993,GRN:0.1859,LIB:0.3075,NDP:0.1903,OTH:0.0098,PPC:0.0072},
  '59020':{CON:0.2641,GRN:0.0163,LIB:0.3834,NDP:0.3206,OTH:0.009,PPC:0.0067},
  '59021':{CON:0.3369,GRN:0.0227,LIB:0.2917,NDP:0.3414,OTH:0.0013,PPC:0.0061},
  '59022':{CON:0.2852,GRN:0.02,LIB:0.6424,NDP:0.0456,OTH:0.0008,PPC:0.006},
  '59023':{CON:0.4529,GRN:0.0134,LIB:0.4889,NDP:0.0375,OTH:0.0006,PPC:0.0067},
  '59024':{CON:0.4121,GRN:0.0145,LIB:0.4917,NDP:0.0654,OTH:0.009,PPC:0.0074},
  '59025':{CON:0.3484,GRN:0.0113,LIB:0.4748,NDP:0.1573,OTH:0.0013,PPC:0.007},
  '59026':{CON:0.6566,GRN:0.0256,LIB:0.2307,NDP:0.0677,OTH:0.0108,PPC:0.0086},
  '59027':{CON:0.4342,GRN:0.0118,LIB:0.4886,NDP:0.048,OTH:0.0104,PPC:0.007},
  '59028':{CON:0.4012,GRN:0.0122,LIB:0.5235,NDP:0.0456,OTH:0.0102,PPC:0.0073},
  '59029':{CON:0.2049,GRN:0.392,LIB:0.3449,NDP:0.0422,OTH:0.0091,PPC:0.0069},
  '59030':{CON:0.3842,GRN:0.0188,LIB:0.4095,NDP:0.1696,OTH:0.0103,PPC:0.0077},
  '59031':{CON:0.4148,GRN:0.0149,LIB:0.1311,NDP:0.4121,OTH:0.0196,PPC:0.0075},
  '59032':{CON:0.3942,GRN:0.0164,LIB:0.5443,NDP:0.0275,OTH:0.0102,PPC:0.0074},
  '59033':{CON:0.3778,GRN:0.0127,LIB:0.5244,NDP:0.0731,OTH:0.0052,PPC:0.0068},
  '59034':{CON:0.3797,GRN:0.0082,LIB:0.5344,NDP:0.0639,OTH:0.0067,PPC:0.0072},
  '59035':{CON:0.2557,GRN:0.017,LIB:0.5976,NDP:0.1238,OTH:0.0002,PPC:0.0058},
  '59036':{CON:0.1392,GRN:0.022,LIB:0.3829,NDP:0.4438,OTH:0.0073,PPC:0.005},
  '59037':{CON:0.3027,GRN:0.0158,LIB:0.562,NDP:0.1023,OTH:0.0101,PPC:0.0072},
  '59038':{CON:0.2353,GRN:0.0185,LIB:0.6525,NDP:0.0776,OTH:0.0099,PPC:0.0062},
  '59039':{CON:0.1994,GRN:0.0127,LIB:0.3934,NDP:0.3788,OTH:0.01,PPC:0.0058},
  '59040':{CON:0.2513,GRN:0.0209,LIB:0.6665,NDP:0.0452,OTH:0.01,PPC:0.0062},
  '59041':{CON:0.4406,GRN:0.0196,LIB:0.4664,NDP:0.0547,OTH:0.0102,PPC:0.0086},
  '59042':{CON:0.1311,GRN:0.0332,LIB:0.5742,NDP:0.253,OTH:0.0038,PPC:0.0047},
  '59043':{CON:0.2783,GRN:0.0375,LIB:0.6422,NDP:0.0352,OTH:0.0007,PPC:0.0062},
  '60001':{CON:0.3086,GRN:0.0274,LIB:0.519,NDP:0.0883,OTH:0.0088,PPC:0.0478},
  '61001':{CON:0.2574,GRN:0.0148,LIB:0.5154,NDP:0.1546,OTH:0.0086,PPC:0.0492},
  '62001':{CON:0.2006,GRN:0.0175,LIB:0.3915,NDP:0.3294,OTH:0.0082,PPC:0.0527},
};

function CaTutorialPanel({ onClose, exiting }: { onClose: () => void; exiting: boolean }) {
  return (
    <div className={`panel-slide${exiting ? ' panel-exit' : ''}`}
      style={{ width: 320, flexShrink: 0, overflowY: 'auto', background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', zIndex: 400 }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1f2937' }}>How to Play</span>
        <button onClick={onClose} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>

        {/* System */}
        <div>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>The System — FPTP</div>
          <p style={{ fontSize: 11.5, color: '#374151', lineHeight: 1.65, margin: 0 }}>
            Canada elects 343 Members of Parliament in single-member ridings using First Past the Post. The candidate with the most votes in each riding wins — no majority needed. The party with 172+ seats forms government.
          </p>
          <div style={{ marginTop: 9, display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, padding: '8px 10px', borderRadius: 7, background: '#f0f9ff', border: '1px solid #bae6fd' }}>
              <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 10, color: '#0369a1', marginBottom: 2 }}>343 ridings</div>
              <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5 }}>Winner takes the seat — highest vote share wins</div>
            </div>
            <div style={{ flex: 1, padding: '8px 10px', borderRadius: 7, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 10, color: '#15803d', marginBottom: 2 }}>172 majority</div>
              <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5 }}>Needed for an outright parliamentary majority</div>
            </div>
          </div>
          <div style={{ marginTop: 7, padding: '8px 10px', borderRadius: 7, background: '#fff7ed', border: '1px solid #fed7aa' }}>
            <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 10, color: '#c2410c', marginBottom: 2 }}>Bloc Québécois</div>
            <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5 }}>BQ only runs candidates in Quebec (78 ridings). Their seat count comes entirely from Quebec.</div>
          </div>
        </div>

        {/* Map presets */}
        <div>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Map Presets</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { label: '2025 Election', desc: 'Official April 2025 results — LIB majority government' },
              { label: '2026 Polling', desc: 'Hypothetical 2026 scenario based on polling averages' },
              { label: 'Blank Map', desc: 'Start from scratch — set every riding manually' },
              { label: 'Simulation', desc: 'Run a randomised election with current percentages' },
            ].map(({ label, desc }) => (
              <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 9, color: '#6366f1', background: '#eef2ff', borderRadius: 4, padding: '2px 5px', marginTop: 1, whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontSize: 10.5, color: '#374151', lineHeight: 1.5 }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Editing ridings */}
        <div>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Editing Ridings</div>
          <ol style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              'Click any riding on the map to open its slider panel.',
              'Drag the sliders to redistribute vote shares — totals always sum to 100%.',
              'Use Multi-select to apply the same swing to many ridings at once.',
              'Use the Swing panel for uniform national shifts across all ridings.',
            ].map((s, i) => (
              <li key={i} style={{ fontSize: 10.5, color: '#374151', lineHeight: 1.55 }}>{s}</li>
            ))}
          </ol>
        </div>

        {/* Scoreboard */}
        <div>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Scoreboard</div>
          <p style={{ fontSize: 11.5, color: '#374151', lineHeight: 1.65, margin: 0 }}>
            Each card shows the party leader, abbreviation, current seat count, and national vote share. Cards are sorted by seat count. The seat-count bar scales to 172 (majority). A checkmark appears on the party holding a majority.
          </p>
        </div>

        {/* Tools */}
        <div>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Other Tools</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { label: 'Breakdown', desc: 'Province-by-province seat and vote breakdown.' },
              { label: 'Parliament', desc: 'Proportional arc diagram of the current seat tally.' },
              { label: 'Bubble Map', desc: 'Switch from geographic to bubble layout — each riding is a circle sized by voter turnout.' },
              { label: 'Simulation', desc: 'Auto-fills all ridings riding-by-riding, province by province, with animated results.' },
            ].map(({ label, desc }) => (
              <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 9, color: '#374151', background: '#f3f4f6', borderRadius: 4, padding: '2px 5px', marginTop: 1, whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontSize: 10.5, color: '#374151', lineHeight: 1.5 }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

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
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialExiting, setTutorialExiting] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [hiddenParties, setHiddenParties] = useState<Set<string>>(new Set());
  const [partiesOpen, setPartiesOpen] = useState(false);
  const partiesDropRef = useRef<HTMLDivElement>(null);
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

    const results: Record<string, Record<string, number>> = {};
    for (const r of data) {
      const csvData = DATA_CA_2026[r.id];
      if (!csvData) { results[r.id] = { ...r.results2025 }; continue; }

      const newResults: Record<string, number> = {};
      let assigned = 0;
      for (const [pid, frac] of Object.entries(csvData)) {
        const votes = Math.round(frac * r.validVotes);
        newResults[pid] = votes;
        assigned += votes;
      }

      const diff = r.validVotes - assigned;
      if (diff !== 0) {
        const top = Object.entries(newResults)
          .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)[0]?.[0];
        if (top) newResults[top] = (newResults[top] ?? 0) + diff;
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
            <span className="font-display font-black uppercase tracking-[0.04em] text-[14px] text-ink leading-none">
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
          {(activePreset === 'blank' || simOpen) && (
            <div ref={partiesDropRef} className="relative shrink-0">
              <button
                onClick={() => setPartiesOpen(o => !o)}
                className={`${btnBase} flex items-center gap-1 ${partiesOpen ? 'border-[#c8a020] bg-[#c8a020] text-white' : btnInactive}`}
              >
                Parties
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true" style={{ marginTop: 1 }}>
                  <path d="M1.5 2.5L4 5.5L6.5 2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {partiesOpen && (
                <>
                  <div className="fixed inset-0 z-[99]" onClick={() => setPartiesOpen(false)} />
                  <div className="absolute left-0 top-[calc(100%+6px)] z-[100] w-44 rounded-[8px] bg-white border border-default overflow-hidden shadow-md">
                    <div className="px-3 py-2 border-b border-default">
                      <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">Toggle Parties</span>
                    </div>
                    <div className="py-1">
                      {CA_PARTIES.map(p => {
                        const hidden = hiddenParties.has(p.id);
                        return (
                          <label key={p.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-hover cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!hidden}
                              onChange={() => setHiddenParties(prev => {
                                const n = new Set(prev);
                                if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                                return n;
                              })}
                              className="w-3 h-3 rounded"
                              style={{ accentColor: p.color }}
                            />
                            <span className="text-[11px] font-mono text-ink" style={{ color: p.color, fontWeight: 600 }}>{p.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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
          <button
            onClick={() => setTutorialOpen(v => !v)}
            className={tutorialOpen ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted}
          >Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          {/* Contributors dropdown */}
          <div className="relative">
            <button
              onClick={() => setContributorsOpen(o => !o)}
              className={`w-7 h-7 flex items-center justify-center rounded-[4px] border transition-colors ${
                contributorsOpen
                  ? 'border-ink-3 text-ink bg-hover'
                  : 'border-default text-ink-3 hover:border-ink-3 hover:text-ink'
              }`}
              title="Contributors"
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm1.5 7.5c.5-.25.5-.75.5-1s-.5-3-3-3.5a2.5 2.5 0 0 1 2.5 4.5z" fillRule="evenodd" clipRule="evenodd"/>
              </svg>
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
                    {/* Creator */}
                    <a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3" aria-hidden="true">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      <span className="text-[11px] font-mono font-semibold text-ink">@realleochang</span>
                    </a>
                    {[
                      { handle: 'RealAlbanianPat' },
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
              <CanadaScoreboard tally={tally} votePcts={votePcts} rawVotes={rawVotes} activePreset={activePreset} hiddenParties={hiddenParties} />
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
                    dark={dark}
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
              hiddenParties={hiddenParties}
            />
          )}

          {(tutorialOpen || tutorialExiting) && (
            <CaTutorialPanel
              onClose={() => { setTutorialExiting(true); setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280); }}
              exiting={tutorialExiting}
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
