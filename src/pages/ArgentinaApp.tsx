import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { AR_CANDIDATES, AR_CANDIDATE_MAP, AR_WIKI_TITLES } from '../data/argentinaCandidates';
import type { ArCandidateId, ArCandidate } from '../data/argentinaCandidates';
import { AR_2027_PARTIES, AR_2027_PARTY_MAP, AR_2027_WIKI_TITLES } from '../data/argentina2027Parties';
import type { Ar2027PartyId, Ar2027Party } from '../data/argentina2027Parties';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';
import { ARGENTINA_2023_R1, OVERSEAS_TERRITORIES, PROV_2023R1_TOTALS } from '../data/argentina2023R1';
import { ARGENTINA_2023_R2, PROV_2023R2_TOTALS } from '../data/argentina2023R2';

type ElectionKey = '2023R1' | '2023R2' | '2027R1' | '2027R2';

// Returns the surname (last word) — "Sergio Massa" → "Massa",
// "Juan Schiaretti" → "Schiaretti".
function getLastName(fullName: string): string {
  const parts = fullName.trim().split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? fullName);
}

// ── Coloring ─────────────────────────────────────────────────────────────────
function deptFill(results: Partial<Record<string, number>>, getColor: (id: string) => string, dark = false): string {
  const sorted = (Object.entries(results) as [string, number | undefined][])
    .filter((e): e is [string, number] => (e[1] ?? 0) > 0)
    .sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : '#E5E7EB';
  const [winnerId, winnerVotes] = sorted[0];
  const runnerUpVotes = sorted[1]?.[1] ?? 0;
  const totalVotes = sorted.reduce((s, [, v]) => s + v, 0);
  const margin = totalVotes > 0 ? ((winnerVotes - runnerUpVotes) / totalVotes) * 100 : 0;
  const baseColor = getColor(winnerId);
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark
    ? 0.55 - t * (0.55 - 0.28)
    : 0.82 - t * (0.82 - 0.38);
  const c = hsl(baseColor);
  c.l = lightness;
  return c.formatHex();
}

// ── Scoreboard helpers ────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(128,128,128,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
function fmtVotes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return n.toString();
}
// ── Per-candidate tile (needs own component so hooks work inside .map) ────────
interface ArCandTileProps {
  cand:     ArCandidate;
  votes:    number;
  votePct:  number;
  isLeader: boolean;
  isWinner: boolean;
}

const AR_CAND_LOCAL_PHOTOS: Partial<Record<string, string>> = {
  MIL: '/leaders/javier-milei.jpg',
};

function ArCandTile({ cand, votes, votePct, isLeader, isWinner }: ArCandTileProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (AR_CAND_LOCAL_PHOTOS[cand.id]) { setPhotoUrl(AR_CAND_LOCAL_PHOTOS[cand.id]!); return; }
    const title = AR_WIKI_TITLES[cand.id];
    if (!title) return;
    let cancelled = false;
    fetchWikiPhoto(title).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [cand.id]);

  const color      = cand.color;
  const colorAlpha = hexToRgba(color, 0.13);
  const initials   = cand.name.trim().split(/\s+/).filter(Boolean).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2);
  const barPct     = Math.min(Math.max(votePct, 0), 100);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha, width: 'auto', minWidth: 90 } as React.CSSProperties}
    >
      <div id={`cand-photo-${cand.id}`}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={cand.name} onError={() => setPhotoUrl(null)} />
            : <span className="cand-initials">{initials}</span>
          }
        </div>
        {isWinner && (
          <span className="called-tick">
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
              <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        )}
      </div>
      <span className="cand-leader-name" title={cand.name}>{cand.name}</span>
      <div className="cand-party-name" title={cand.party}>{cand.party}</div>
      <div className="cand-pct">
        <span className="pct-number">{votePct.toFixed(1)}%</span>
      </div>
      <div className="cand-votes">
        <span className="cand-votes-full">{votes.toLocaleString()} votes</span>
        <span className="cand-votes-compact">{fmtVotes(votes)} votes</span>
      </div>
      <div className="cand-bar-track">
        <div className="cand-bar-fill" style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

// ── Scoreboard ────────────────────────────────────────────────────────────────
function ArgentinaScoreboard({ deptResults, round }: {
  deptResults: Record<string, Partial<Record<string, number>>>;
  round: 1 | 2;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const { popularVote, grandTotal } = useMemo(() => {
    const popularVote: Partial<Record<ArCandidateId, number>> = {};
    let grandTotal = 0;
    for (const r of Object.values(deptResults)) {
      for (const [cid, votes] of Object.entries(r)) {
        if ((votes ?? 0) > 0) {
          const id = cid as ArCandidateId;
          popularVote[id] = (popularVote[id] ?? 0) + (votes as number);
          grandTotal += (votes as number);
        }
      }
    }
    return { popularVote, grandTotal };
  }, [deptResults]);

  // Sort by popular vote descending; hide candidates with 0 votes (R2 has only 2)
  const sorted = useMemo(() => [...AR_CANDIDATES]
    .filter(c => (popularVote[c.id] ?? 0) > 0)
    .sort((a, b) => (popularVote[b.id] ?? 0) - (popularVote[a.id] ?? 0))
  , [popularVote]);

  const topCandId = sorted[0]?.id;

  // R1: apply Argentina's actual first-round win rule to the live (possibly edited) totals.
  // If the leader clears >45%, or >40% with a 10-point lead → single winner checkmark.
  // Otherwise top-2 advance → both get the checkmark.
  // R2: simple plurality winner.
  const winnerIds = useMemo<Set<ArCandidateId>>(() => {
    if (round === 2) return new Set(topCandId ? [topCandId] : []);
    if (sorted.length === 0 || grandTotal === 0) return new Set(sorted.slice(0, 2).map(c => c.id));
    const top1Pct = grandTotal > 0 ? ((popularVote[sorted[0].id] ?? 0) / grandTotal) * 100 : 0;
    const top2Pct = grandTotal > 0 ? ((popularVote[sorted[1]?.id ?? sorted[0].id] ?? 0) / grandTotal) * 100 : 0;
    const lead = top1Pct - top2Pct;
    if (top1Pct > 45 || (top1Pct > 40 && lead >= 10)) {
      return new Set(topCandId ? [topCandId] : []);  // outright winner
    }
    return new Set(sorted.slice(0, 2).map(c => c.id));  // top-2 advance
  }, [round, sorted, topCandId, popularVote, grandTotal]);

  return (
    <div className="relative bg-white border-b border-default shrink-0 select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-1.5 mx-auto w-fit">
            {sorted.map(cand => {
              const votes   = popularVote[cand.id] ?? 0;
              const votePct = grandTotal > 0 ? (votes / grandTotal) * 100 : 0;

              return (
                <ArCandTile
                  key={cand.id}
                  cand={cand}
                  votes={votes}
                  votePct={votePct}
                  isLeader={cand.id === topCandId}
                  isWinner={winnerIds.has(cand.id)}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}

const AR_LOCAL_PHOTOS: Record<string, string> = {
  'Javier Milei': '/leaders/javier-milei.jpg',
};

// ── Floating leader dropdown ──────────────────────────────────────────────────
function LeaderDropdown({ options, value, color, onChange }: {
  options: string[];
  value: string;
  color: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; upward: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const displayName = getLastName(value);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const dropHeight = Math.min(options.length * 36 + 8, 300);
      const openUpward = spaceBelow < dropHeight + 8;
      setPos({
        top: openUpward ? r.top - 4 : r.bottom + 4,
        left: r.left + r.width / 2,
        upward: openUpward,
      });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button ref={btnRef} onClick={handleToggle} className="cand-leader-wrap" style={{ background: 'none', border: 'none', padding: 0 }}>
        <span className="cand-leader-name">{displayName}</span>
        <svg className="leader-chevron" width="7" height="5" viewBox="0 0 7 5" fill="none" aria-hidden="true">
          <path d="M1 1l2.5 2.5L6 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[1999]" onClick={() => setOpen(false)} />
          <div className="fixed z-[2000] bg-white border border-default rounded-lg shadow-xl py-1"
            style={{
              top: pos.upward ? undefined : pos.top,
              bottom: pos.upward ? window.innerHeight - pos.top : undefined,
              left: pos.left,
              transform: 'translateX(-50%)',
              minWidth: 200,
              maxHeight: 300,
              overflowY: 'auto',
            }}>
            {options.map(opt => (
              <button key={opt} onClick={e => { e.stopPropagation(); onChange(opt); setOpen(false); }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-left transition-colors ${opt === value ? 'bg-[#f8f7f4]' : 'hover:bg-hover'}`}>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] font-mono text-ink leading-none flex-1">{opt}</span>
                {opt === value && (
                  <svg className="shrink-0 ml-1" width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4L3.2 5.8L6.5 2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── 2027 party tile (scoreboard) ─────────────────────────────────────────────
interface Ar2027CandTileProps {
  party: Ar2027Party;
  votes: number;
  votePct: number;
  isLeader: boolean;
  isWinner: boolean;
  isR1?: boolean;
  pickedCandidate: string;
  onPick: (partyId: Ar2027PartyId, candidate: string) => void;
}

function Ar2027CandTile({ party, votes, votePct, isLeader, isWinner, isR1, pickedCandidate, onPick }: Ar2027CandTileProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    const local = AR_LOCAL_PHOTOS[pickedCandidate];
    if (local) { setPhotoUrl(local); return; }
    setPhotoUrl(null);
    const title = AR_2027_WIKI_TITLES[pickedCandidate];
    if (!title) return;
    let cancelled = false;
    fetchWikiPhoto(title).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [pickedCandidate]);

  const color      = party.color;
  const colorAlpha = hexToRgba(color, 0.13);
  const initials   = pickedCandidate.trim().split(/\s+/).filter(Boolean).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2);
  const barPct     = Math.min(Math.max(votePct, 0), 100);
  const hasMultiple = party.candidates.length > 1;
  const lastName   = getLastName(pickedCandidate);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha, width: 'auto', minWidth: 90 } as React.CSSProperties}
    >
      <div id={`cand-photo-2027-${party.id}`}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={pickedCandidate} onError={() => setPhotoUrl(null)} />
            : <span className="cand-initials">{initials}</span>
          }
        </div>
        {isWinner && (
          isR1 ? (
            <span className="called-tick">
              <span
                className="animate-pulse"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 14, borderRadius: 8,
                  background: color, fontSize: '5.5px', fontWeight: 900, color: '#fff',
                  fontFamily: 'ui-monospace, monospace', letterSpacing: '0.08em',
                  textTransform: 'uppercase', whiteSpace: 'nowrap',
                  boxShadow: `0 0 0 2px white, 0 0 0 3.5px ${color}`,
                }}
              >ADVANCE</span>
            </span>
          ) : (
            <span className="called-tick">
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
                <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          )
        )}
      </div>
      {hasMultiple ? (
        <LeaderDropdown
          options={party.candidates}
          value={pickedCandidate}
          color={color}
          onChange={v => onPick(party.id, v)}
        />
      ) : (
        <span className="cand-leader-name" title={pickedCandidate}>{lastName}</span>
      )}
      <div className="cand-party-name" title={party.name}>
        <span className="font-mono" style={{ fontSize: '7px', color }}>{party.id}</span>
        {' '}{party.name}
      </div>
      <div className="cand-pct">
        <span className="pct-number">{votePct.toFixed(1)}%</span>
      </div>
      <div className="cand-votes">
        <span className="cand-votes-full">{votes.toLocaleString()} votes</span>
        <span className="cand-votes-compact">{fmtVotes(votes)} votes</span>
      </div>
      <div className="cand-bar-track">
        <div className="cand-bar-fill" style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

// ── 2027 scoreboard ────────────────────────────────────────────────────────────
function Ar2027Scoreboard({ deptResults, election, allPartyIds, picks, onPick, projectedAdvancers }: {
  deptResults: Record<string, Partial<Record<string, number>>>;
  election: '2027R1' | '2027R2';
  allPartyIds: string[];
  picks: Record<string, string>;
  onPick: (partyId: Ar2027PartyId, candidate: string) => void;
  projectedAdvancers?: Set<string>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const { popularVote, grandTotal } = useMemo(() => {
    const popularVote: Record<string, number> = {};
    let grandTotal = 0;
    for (const r of Object.values(deptResults)) {
      for (const [pid, votes] of Object.entries(r)) {
        if ((votes ?? 0) > 0) {
          popularVote[pid] = (popularVote[pid] ?? 0) + (votes as number);
          grandTotal += (votes as number);
        }
      }
    }
    return { popularVote, grandTotal };
  }, [deptResults]);

  const partyMap = useMemo(
    () => Object.fromEntries(AR_2027_PARTIES.map(p => [p.id, p])),
    [],
  );

  const parties = useMemo(() =>
    allPartyIds
      .map(id => partyMap[id])
      .filter((p): p is Ar2027Party => !!p)
      .sort((a, b) => (popularVote[b.id] ?? 0) - (popularVote[a.id] ?? 0)),
  [allPartyIds, partyMap, popularVote]);

  const top2Ids = useMemo(() => grandTotal > 0 ? new Set(parties.slice(0, 2).map(p => p.id)) : new Set<string>(), [parties, grandTotal]);
  // Both R1 and R2: only show badge when statistically projected
  const winnerIds = useMemo<Set<string>>(() => projectedAdvancers ?? new Set(), [projectedAdvancers]);

  return (
    <div className="relative bg-white border-b border-default shrink-0 select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-1.5 mx-auto w-fit">
            {parties.map(party => {
              const votes   = popularVote[party.id] ?? 0;
              const votePct = grandTotal > 0 ? (votes / grandTotal) * 100 : 0;
              const picked  = picks[party.id] ?? party.candidates[0];
              return (
                <Ar2027CandTile
                  key={party.id}
                  party={party}
                  votes={votes}
                  votePct={votePct}
                  isLeader={top2Ids.has(party.id)}
                  isWinner={winnerIds.has(party.id)}
                  isR1={election === '2027R1'}
                  pickedCandidate={picked}
                  onPick={onPick}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ── Real-world coordinates for each overseas territory ────────────────────────
const OVERSEAS_COORDS: Record<string, [number, number]> = {
  'ZZ':  [ 50.50,   10.50],  // Abroad + customs gates — placed over central Europe
};

const SHORT_NOM: Record<string, string> = {
  'ZZ':  'Abroad',
};

// ── Overseas markers rendered inside the Leaflet map at real coordinates ───────
function OverseasMarkers({
  deptResults,
  getCandInfo,
  onSelect,
}: {
  deptResults: Record<string, Partial<Record<string, number>>>;
  getCandInfo: (id: string) => { name: string; color: string };
  onSelect: (d: DeptInfo) => void;
}) {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const markers: L.Marker[] = [];

    for (const { code, nom } of OVERSEAS_TERRITORIES) {
      const coords = OVERSEAS_COORDS[code];
      if (!coords) continue;

      const r = deptResults[code] ?? {};
      const sorted = (Object.entries(r) as [string, number | undefined][])
        .filter((e): e is [string, number] => (e[1] ?? 0) > 0)
        .sort(([, a], [, b]) => b - a);
      const total       = sorted.reduce((s, [, v]) => s + v, 0);
      const winner      = sorted[0];
      const info        = winner ? getCandInfo(winner[0]) : { name: '', color: '#aaa' };
      const winnerColor = info.color;
      const winnerPct   = winner && total > 0 ? (winner[1] / total) * 100 : 0;
      const lastName    = getLastName(info.name);
      const shortNom    = SHORT_NOM[code] ?? nom;

      // Special label for ZZ
      const isZZ = code === 'ZZ';
      const topLine = isZZ ? '🌍 Abroad' : shortNom;

      const icon = L.divIcon({
        className: 'overseas-marker',
        iconSize:   [64, 64],
        iconAnchor: [32, 32],
        html: `<div style="
          width:64px;height:64px;border-radius:50%;
          background:${winnerColor};
          border:3px solid rgba(255,255,255,0.95);
          box-shadow:0 4px 18px rgba(0,0,0,0.42),0 0 0 2px ${winnerColor}88;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          cursor:pointer;color:#fff;text-align:center;
          font-family:ui-monospace,SFMono-Regular,monospace;
          line-height:1.2;user-select:none;
        " title="${nom}">
          <div style="font-size:7px;font-weight:700;opacity:.88;max-width:56px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 2px">${topLine}</div>
          <div style="font-size:12px;font-weight:900;letter-spacing:-.3px">${winner ? lastName : '—'}</div>
          <div style="font-size:9.5px;font-weight:700;opacity:.92">${winner ? winnerPct.toFixed(1) + '%' : '—'}</div>
        </div>`,
      });

      const marker = L.marker(coords as L.LatLngExpression, { icon });
      marker.on('click', () => onSelectRef.current({ code, nom }));
      marker.addTo(map);
      markers.push(marker);
    }

    return () => { markers.forEach(m => m.remove()); };
  }, [map, deptResults, getCandInfo]);

  return null;
}

// ── Map ───────────────────────────────────────────────────────────────────────
type DeptInfo = { code: string; nom: string };

function trEnforceNoSmooth(geoLayer: L.GeoJSON) {
  geoLayer.eachLayer((layer: L.Layer) => {
    const p = layer as any;
    if (p.options) p.options.smoothFactor = 0;
  });
}

function ArMapController({ layerRef }: { layerRef: { current: L.GeoJSON | null } }) {
  const map = useMap();
  useEffect(() => {
    const onZoomEnd = () => {
      if (!layerRef.current) return;
      trEnforceNoSmooth(layerRef.current);
    };
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map, layerRef]);
  return null;
}

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

function ArgentinaMapView({
  deptResults,
  getCandInfo,
  selectedCode,
  onSelect,
  reportingPct,
  reportingLabel = 'Reporting',
  reportingDepts,
  reportingTotal,
  multiSelectMode,
  selectedCodes,
  onMultiSelect,
  bubbleMapMode = false,
  simBatchFractions,
  dark = false,
}: {
  deptResults: Record<string, Partial<Record<string, number>>>;
  getCandInfo: (id: string) => { name: string; color: string };
  selectedCode: string | null;
  onSelect: (d: DeptInfo) => void;
  reportingPct?: number;
  reportingLabel?: string;
  reportingDepts?: number;
  reportingTotal?: number;
  multiSelectMode?: boolean;
  selectedCodes?: Set<string>;
  onMultiSelect?: (code: string) => void;
  bubbleMapMode?: boolean;
  simBatchFractions?: Record<string, number>;
  dark?: boolean;
}) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const layerRef        = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; code: string; nom: string } | null>(null);

  const deptResultsRef     = useRef(deptResults);
  const selectedCodeRef    = useRef(selectedCode);
  const getCandInfoRef     = useRef(getCandInfo);
  const onSelectRef        = useRef(onSelect);
  const multiSelectModeRef = useRef(multiSelectMode);
  const selectedCodesRef   = useRef(selectedCodes);
  const onMultiSelectRef   = useRef(onMultiSelect);
  const bubbleModeRef      = useRef(bubbleMapMode);
  const darkRef            = useRef(dark);
  useEffect(() => { deptResultsRef.current     = deptResults;     }, [deptResults]);
  useEffect(() => { selectedCodeRef.current    = selectedCode;    }, [selectedCode]);
  useEffect(() => { getCandInfoRef.current     = getCandInfo;     }, [getCandInfo]);
  useEffect(() => { onSelectRef.current        = onSelect;        }, [onSelect]);
  useEffect(() => { multiSelectModeRef.current = multiSelectMode; }, [multiSelectMode]);
  useEffect(() => { selectedCodesRef.current   = selectedCodes;   }, [selectedCodes]);
  useEffect(() => { onMultiSelectRef.current   = onMultiSelect;   }, [onMultiSelect]);
  useEffect(() => { bubbleModeRef.current      = bubbleMapMode;   }, [bubbleMapMode]);
  useEffect(() => { darkRef.current            = dark;            }, [dark]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}argentina-provinces.geojson`)
      .then(r => r.json())
      .then(setGeoData)
      .catch(console.error);
  }, []);

  // Enforce smoothFactor: 0 on every child layer once GeoJSON is mounted
  useEffect(() => {
    if (!layerRef.current) return;
    trEnforceNoSmooth(layerRef.current);
  }, [geoData]);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const code: string = feature?.properties?.code ?? '';
    const r = deptResultsRef.current[code] ?? {};
    const fill = deptFill(r, id => getCandInfoRef.current(id).color, darkRef.current);
    const isSelected = code === selectedCodeRef.current;
    const isMultiSelected = selectedCodesRef.current?.has(code) ?? false;
    const baseColor = darkRef.current ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';
    return {
      fillColor: fill,
      fillOpacity: 0.72,
      weight: (isSelected || isMultiSelected) ? 2 : 0.5,
      color: isMultiSelected ? '#2563EB' : (isSelected ? '#c8a020' : baseColor),
      opacity: 1,
    };
  }, []);

  useEffect(() => {
    if (!layerRef.current) return;
    if (bubbleMapMode) {
      layerRef.current.setStyle(() => ({ fillOpacity: 0, weight: 0.4, color: dark ? '#666' : '#bbb', opacity: 0.6 }));
    } else {
      layerRef.current.setStyle((f: any) => getStyle(f));
    }
  }, [bubbleMapMode, deptResults, selectedCode, selectedCodes, dark, getStyle]);

  const bubbleData = useMemo(() => {
    if (!bubbleMapMode || !geoData) return [];
    let maxMargin = 1;
    const items: { code: string; nom: string; center: [number, number]; margin: number; color: string }[] = [];
    for (const feature of geoData.features) {
      const code: string = feature.properties?.code ?? '';
      const nom:  string = feature.properties?.nom  ?? code;
      const r = deptResults[code] ?? {};
      const sorted = (Object.entries(r) as [string, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (sorted.length === 0) continue;
      const margin = sorted.length >= 2 ? sorted[0][1] - sorted[1][1] : sorted[0][1];
      if (margin > maxMargin) maxMargin = margin;
      const color = deptFill(r, id => getCandInfo(id).color, dark);
      items.push({ code, nom, center: computeCentroid(feature.geometry), margin, color });
    }
    return items.map(it => ({ ...it, radius: 2 + Math.sqrt(it.margin / maxMargin) * 12 }));
  }, [bubbleMapMode, geoData, deptResults, getCandInfo]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const code: string = feature.properties?.code ?? '';
    const nom:  string = feature.properties?.nom  ?? code;

    layer.on('click', () => {
      if (multiSelectModeRef.current && onMultiSelectRef.current) {
        onMultiSelectRef.current(code);
      } else {
        onSelectRef.current({ code, nom });
      }
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleModeRef.current) { setTooltip(null); return; }
      if (multiSelectModeRef.current) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, code, nom });
    });

    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer
        center={[-40, -64]}
        zoom={4}
        minZoom={2}
        style={{ width: '100%', height: '100%' }}
        zoomControl
        worldCopyJump
      >
        <TileLayer
          key={dark ? 'dark' : 'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
          }
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          updateWhenZooming={false}
          updateWhenIdle={true}
          maxZoom={20}
        />
        <ArMapController layerRef={layerRef} />
        {geoData && (
          <GeoJSON
            ref={layerRef as any}
            data={geoData}
            style={(f: any) => bubbleMapMode
              ? { fillOpacity: 0, weight: 0.4, color: '#bbb', opacity: 0.6 }
              : getStyle(f)
            }
            onEachFeature={onEachFeature}
            {...({ smoothFactor: 0 } as any)}
          />
        )}
        {bubbleData.map(b => (
          <CircleMarker
            key={b.code}
            center={b.center}
            radius={b.radius}
            pathOptions={{ fillColor: b.color, fillOpacity: 0.85, color: 'rgba(255,255,255,0.7)', weight: 0.6, opacity: 0.9 }}
            eventHandlers={{
              click: () => {
                if (multiSelectModeRef.current && onMultiSelectRef.current) {
                  onMultiSelectRef.current(b.code);
                } else {
                  onSelectRef.current({ code: b.code, nom: b.nom });
                }
              },
              mousemove: (e) => {
                if (multiSelectModeRef.current) { setTooltip(null); return; }
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return;
                setTooltip({
                  x: (e as L.LeafletMouseEvent).originalEvent.clientX - rect.left,
                  y: (e as L.LeafletMouseEvent).originalEvent.clientY - rect.top,
                  code: b.code,
                  nom: b.nom,
                });
              },
              mouseout: () => setTooltip(null),
            }}
          />
        ))}
        <OverseasMarkers deptResults={deptResults} getCandInfo={getCandInfo} onSelect={onSelect} />
      </MapContainer>

      {/* Hover tooltip */}
      {tooltip && (() => {
        const r = deptResults[tooltip.code] ?? {};
        const sorted = (Object.entries(r) as [string, number | undefined][])
          .filter((e): e is [string, number] => (e[1] ?? 0) > 0)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 4);
        const total = (Object.values(deptResults[tooltip.code] ?? {}) as number[]).reduce((s, v) => s + v, 0);
        const batchFrac = simBatchFractions?.[tooltip.code];
        const isPartial = batchFrac !== undefined && batchFrac > 0 && batchFrac < 1;
        const reportingPctTip = isPartial ? batchFrac : (total > 0 ? 1 : 0);
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 228;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = {
          bg:    dark ? 'rgba(18,24,44,0.96)'        : 'rgba(255,255,255,0.97)',
          border:dark ? 'rgba(255,255,255,0.09)'     : 'rgba(0,0,0,0.08)',
          shadow:dark ? '0 6px 28px rgba(0,0,0,0.5)': '0 6px 28px rgba(0,0,0,0.12)',
          title: dark ? 'rgba(255,255,255,0.92)'     : 'rgba(0,0,0,0.85)',
          sub:   dark ? 'rgba(255,255,255,0.40)'     : 'rgba(0,0,0,0.42)',
          body:  dark ? 'rgba(255,255,255,0.85)'     : 'rgba(0,0,0,0.78)',
          muted: dark ? 'rgba(255,255,255,0.35)'     : 'rgba(0,0,0,0.40)',
        };
        const GOLD = '#D4A017';
        return (
          <div
            className="absolute pointer-events-none z-[1000]"
            style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}
          >
            <div style={{
              background: tt.bg,
              borderRadius: 10,
              border: `1px solid ${tt.border}`,
              boxShadow: tt.shadow,
              backdropFilter: 'blur(10px)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>{tooltip.nom}</div>
              {/* % reporting line — gold during live counting */}
              {(isPartial || (simBatchFractions && total > 0)) && (
                <div style={{
                  fontSize: 9.5, fontFamily: '"JetBrains Mono",monospace',
                  color: GOLD, fontWeight: 700, marginTop: 3,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: GOLD,
                    animation: isPartial ? 'ar-live-blink 0.9s ease-in-out infinite' : 'none',
                  }} />
                  {isPartial
                    ? `${(reportingPctTip * 100).toFixed(0)}% reporting`
                    : '100% reporting'}
                </div>
              )}
              {!simBatchFractions && (
                <div style={{ fontSize: 9.5, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 3 }}>
                  Province {tooltip.code}
                </div>
              )}
              {sorted.length === 0 ? (
                <div style={{ marginTop: 10, fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, fontStyle: 'italic' }}>
                  No votes yet
                </div>
              ) : (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {sorted.map(([id, votes], i) => {
                    const info = getCandInfo(id);
                    const pct = total > 0 ? (votes / total) * 100 : 0;
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: info.color }} />
                        <span style={{ flex: 1, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {getLastName(info.name)}
                        </span>
                        <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, marginRight: 4 }}>
                          {votes.toLocaleString()}
                        </span>
                        <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: info.color }}>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {reportingPct !== undefined && (
        <div className="absolute bottom-12 left-3 z-[1000] w-52 select-none pointer-events-none">
          <div
            className="backdrop-blur-md rounded-[14px] overflow-hidden"
            style={{
              background: dark ? 'rgba(12,20,46,0.97)' : 'rgba(255,255,255,0.95)',
              boxShadow: dark
                ? '0 6px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(80,120,220,0.18)'
                : '0 6px 28px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.07)',
            }}
          >
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #2563EB 0%, #7C3AED 100%)' }} />
            <div className="px-4 pt-3 pb-3.5">
              <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5"
                style={{ color: dark ? 'rgba(140,170,220,0.65)' : undefined }}
              >
                {reportingLabel}
              </div>
              <div className="flex items-baseline gap-1.5 mb-2.5">
                <span
                  className="text-[34px] font-black leading-none tabular-nums"
                  style={{ letterSpacing: '-0.02em', color: dark ? 'rgba(220,235,255,0.95)' : '#1a1a1a' }}
                >
                  {(reportingPct * 100).toFixed(1)}
                </span>
                <span
                  className="text-[16px] font-bold pb-1"
                  style={{ color: dark ? 'rgba(180,205,240,0.75)' : '#4a4844' }}
                >%</span>
              </div>
              <div
                className="w-full h-[6px] rounded-full overflow-hidden mb-2.5"
                style={{ background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)' }}
              >
                <div className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${Math.min(reportingPct * 100, 100)}%`, background: 'linear-gradient(90deg, #2563EB 0%, #7C3AED 100%)' }} />
              </div>
              {reportingDepts !== undefined && reportingTotal !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] font-mono tabular-nums" style={{ color: dark ? 'rgba(140,170,220,0.65)' : undefined }}>
                    <span className="font-bold" style={{ color: dark ? 'rgba(220,235,255,0.9)' : '#1a1a1a' }}>{reportingDepts}</span>
                    <span className={dark ? 'text-[rgba(140,170,220,0.65)]' : 'text-ink-3'}> / {reportingTotal} depts</span>
                  </span>
                  <span className="text-[9px] font-mono font-semibold" style={{ color: reportingDepts >= reportingTotal ? '#34d399' : '#60a5fa' }}>
                    {reportingDepts >= reportingTotal ? 'All in' : `${reportingTotal - reportingDepts} to go`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {OVERSEAS_TERRITORIES.length > 0 && (
        <div className="absolute bottom-7 left-1/2 -translate-x-1/2 text-[9.5px] text-ink-3 select-none z-[1000] font-mono bg-white/80 backdrop-blur-sm px-2.5 py-0.5 rounded-full pointer-events-none whitespace-nowrap">
          🌍 Overseas votes shown off-map
        </div>
      )}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">
        Scroll to zoom · Drag to pan · Click to open
      </div>
    </div>
  );
}

// ── Slider helpers ────────────────────────────────────────────────────────────
function toPcts(results: Partial<Record<string, number>>, allIds: string[]): Record<string, number> {
  const total = allIds.reduce((s, id) => s + (results[id] ?? 0), 0);
  if (total === 0) return Object.fromEntries(allIds.map(id => [id, 100 / allIds.length]));
  return Object.fromEntries(allIds.map(id => [id, ((results[id] ?? 0) / total) * 100]));
}

function redistributePcts(
  current: Record<string, number>,
  changedId: string,
  newRaw: number,
  locks: Set<string>,
): Record<string, number> {
  const ids = Object.keys(current);
  const lockedSum = ids
    .filter(id => locks.has(id) && id !== changedId)
    .reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped  = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining   = 100 - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<string, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) {
    for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  } else if (unlocked.length > 0) {
    const share = remaining / unlocked.length;
    for (const id of unlocked) next[id] = share;
  }
  return next;
}

// ── Province panel ──────────────────────────────────────────────────────────
function ProvincePanel({
  dept, results, allIds, getCandInfo, roundLabel, onClose, onUpdate, fixedTotal, isProjected, onProject, show2023Ref, onToggle2023Ref, refPanelLabel, showR1Ref, onToggleR1Ref, dark = false,
}: {
  dept: DeptInfo;
  results: Partial<Record<string, number>>;
  allIds: string[];
  getCandInfo: (id: string) => { name: string; color: string };
  roundLabel: string;
  onClose: () => void;
  onUpdate: (code: string, newResults: Partial<Record<string, number>>) => void;
  fixedTotal?: number;
  isProjected?: boolean;
  onProject?: (code: string) => void;
  show2023Ref?: boolean;
  onToggle2023Ref?: () => void;
  refPanelLabel?: string;
  showR1Ref?: boolean;
  onToggleR1Ref?: () => void;
  dark?: boolean;
}) {
  const [pcts, setPcts]           = useState<Record<string, number>>(() => toPcts(results, allIds));
  const [locks, setLocks]         = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState('');

  const pctsRef  = useRef(pcts);
  const locksRef = useRef(locks);
  useEffect(() => { pctsRef.current  = pcts;  }, [pcts]);
  useEffect(() => { locksRef.current = locks; }, [locks]);

  useEffect(() => {
    setPcts(toPcts(results, allIds));
    setLocks(new Set());
    setEditingId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept.code, roundLabel]);

  // Sort once when a new dept opens — don't re-sort as sliders change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() =>
    [...allIds].sort((a, b) => (results[b] ?? 0) - (results[a] ?? 0)),
  [allIds, dept.code]);

  const total = useMemo(() => {
    const fromResults = allIds.reduce((s, id) => s + (results[id] ?? 0), 0);
    return (fixedTotal !== undefined && fixedTotal > 0) ? fixedTotal : fromResults;
  }, [allIds, results, fixedTotal]);

  const winnerId = ids.length > 0
    ? ids.reduce((best, id) => (pcts[id] ?? 0) > (pcts[best] ?? 0) ? id : best)
    : undefined;
  const winnerInfo = winnerId ? getCandInfo(winnerId) : null;
  const winnerPct  = winnerId ? (pcts[winnerId] ?? 0) : 0;
  const runnerUpId = ids.find(id => id !== winnerId);
  const margin     = runnerUpId ? winnerPct - (pcts[runnerUpId] ?? 0) : winnerPct;
  const liveVotes  = Object.fromEntries(ids.map(id => [id, Math.round((pcts[id] ?? 0) * total / 100)]));
  const previewFill = deptFill(liveVotes, id => getCandInfo(id).color);

  function applyChange(id: string, newVal: number) {
    const newPcts = redistributePcts(pctsRef.current, id, newVal, locksRef.current);
    pctsRef.current = newPcts;
    setPcts(newPcts);
    const newVotes = Object.fromEntries(ids.map(cid => [cid, Math.round((newPcts[cid] ?? 0) * total / 100)]));
    onUpdate(dept.code, newVotes);
  }

  function toggleLock(id: string) {
    setLocks(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (ids.filter(i => !next.has(i) && i !== id).length >= 1) next.add(id);
      }
      return next;
    });
  }

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight truncate">{dept.nom}</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {OVERSEAS_TERRITORIES.some(t => t.code === dept.code)
                ? 'Territoire'
                : `Province ${dept.code}`} · {total.toLocaleString()} votes
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink transition-colors shrink-0 text-base leading-none mt-0.5"
          >×</button>
        </div>
        {winnerInfo && (
          <div className={`mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] border border-default ${dark ? 'bg-white/5' : 'bg-[#f8f7f4]'}`}>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: previewFill }} />
            <span className="text-[12px] font-semibold text-ink flex-1 truncate">{winnerInfo.name}</span>
            <span className="font-mono text-[11px] font-semibold text-ink-2">{winnerPct.toFixed(1)}%</span>
            <span className="text-[10px] font-mono text-ink-3">+{margin.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* ── Project Result button (2027R1 only) ─────────────────── */}
      {isProjected !== undefined && (
        <div className="px-3.5 py-2 border-b border-default">
          {isProjected ? (
            <div className="flex items-center justify-center gap-1.5 h-8 text-[10.5px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[5px] tracking-wide uppercase select-none">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <circle cx="5.5" cy="5.5" r="5.5" fill="#059669"/>
                <path d="M2.5 5.5l2 2L8.5 3.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Result Projected
            </div>
          ) : (
            <button
              onClick={() => {
                const newVotes = Object.fromEntries(
                  ids.map(id => [id, Math.round((pcts[id] ?? 0) * total / 100)])
                );
                onUpdate(dept.code, newVotes);
                onProject?.(dept.code);
              }}
              className="w-full h-8 text-[11px] font-mono font-bold rounded-[5px] bg-[#2563EB] text-white hover:bg-[#1d4ed8] active:bg-[#1e40af] transition-colors uppercase tracking-wide shadow-sm"
            >
              Project Result
            </button>
          )}
        </div>
      )}

      {/* ── R1 reference toggle (2027R2 only) ──────────────────── */}
      {onToggleR1Ref && (
        <div className="px-3.5 py-1.5 border-b border-default">
          <button
            onClick={onToggleR1Ref}
            className={`w-full h-7 text-[10px] font-mono rounded-[5px] transition-colors uppercase tracking-wide ${
              showR1Ref
                ? 'bg-[#7C3AED]/8 text-[#7C3AED] font-semibold border border-[#7C3AED]/30'
                : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'
            }`}
          >
            {showR1Ref ? '← Hide R1 Results' : 'Show R1 Results →'}
          </button>
        </div>
      )}

      {/* ── 2023 R1 reference toggle (2027R1 only) ──────────────── */}
      {onToggle2023Ref && (
        <div className="px-3.5 py-1.5 border-b border-default">
          <button
            onClick={onToggle2023Ref}
            className={`w-full h-7 text-[10px] font-mono rounded-[5px] transition-colors uppercase tracking-wide ${
              show2023Ref
                ? dark
                  ? 'bg-white/10 text-ink font-semibold border border-white/20'
                  : 'bg-[#f0f0f0] text-ink font-semibold border border-default'
                : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'
            }`}
          >
            {show2023Ref ? `← Hide ${refPanelLabel ?? '2023'} Results` : `Show ${refPanelLabel ?? '2023'} Results →`}
          </button>
        </div>
      )}

      {/* ── Sliders ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-4">
        <p className="text-[8.5px] font-mono uppercase tracking-wider text-ink-3">{roundLabel}</p>

        {ids.map(id => {
          const info     = getCandInfo(id);
          const pct      = pcts[id] ?? 0;
          const isLocked  = locks.has(id);
          const isEditing = editingId === id;

          return (
            <div key={id}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button
                  onClick={() => toggleLock(id)}
                  className="shrink-0 w-[15px] h-[15px] flex items-center justify-center transition-colors"
                  style={{ color: isLocked ? info.color : '#ccc' }}
                  title={isLocked ? 'Unlock' : 'Lock'}
                >
                  {isLocked ? (
                    <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
                      <rect x="1" y="5" width="8" height="7" rx="1.5" fill="currentColor"/>
                      <path d="M3 5V3.5a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                      <circle cx="5" cy="8.5" r="1" fill="white"/>
                    </svg>
                  ) : (
                    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" opacity="0.5">
                      <rect x="1" y="5" width="8" height="7" rx="1.5" fill="currentColor"/>
                      <path d="M3 5V3.5A2 2 0 017 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                    </svg>
                  )}
                </button>
                <span className="text-[9.5px] font-medium text-ink flex-1 truncate leading-none">
                  {info.name}
                  <span className="ml-1 font-mono text-[8px] text-ink-3">({id})</span>
                </span>
                {isEditing ? (
                  <input
                    className="w-[46px] text-right text-[9px] font-mono tabular-nums bg-transparent outline-none border-b shrink-0"
                    style={{ color: info.color, borderColor: `${info.color}88` }}
                    value={editingVal}
                    autoFocus
                    onChange={e => setEditingVal(e.target.value)}
                    onBlur={() => { const n = parseFloat(editingVal); if (!isNaN(n)) applyChange(id, n); setEditingId(null); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { const n = parseFloat(editingVal); if (!isNaN(n)) applyChange(id, n); setEditingId(null); }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => { if (!isLocked) { setEditingId(id); setEditingVal(pct.toFixed(1)); } }}
                    className="text-[9px] font-mono font-semibold tabular-nums shrink-0"
                    style={{ color: info.color, cursor: isLocked ? 'default' : 'text' }}
                    title={isLocked ? `Locked at ${pct.toFixed(1)}%` : 'Click to type %'}
                  >
                    {pct.toFixed(1)}%
                  </button>
                )}
              </div>

              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}


                onChange={e => applyChange(id, parseFloat(e.target.value))}


                className="br-party-slider w-full"


                style={{ '--party-color': info.color, '--pct': `${pct}%` } as React.CSSProperties} />


              <div className="text-right text-[8.5px] font-mono text-ink-3 mt-0.5">


                {Math.round(pct * total / 100).toLocaleString()} votes


              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="px-3.5 py-2 border-t border-default">
        <p className="text-[8px] font-mono text-ink-3 text-center uppercase tracking-wide">
          Drag sliders · Click % to type · Lock to fix
        </p>
      </div>
    </aside>
  );
}

// ── Simulation constants ──────────────────────────────────────────────────────
// Maps each projected 2027 party to the 2023 candidate whose provincial pattern it
// most resembles — La Libertad Avanza inherits Milei's geography, Fuerza Patria
// (Peronism) Massa's, PRO/JxC and the UCR Bullrich's, Hacemos Schiaretti's, FIT Bregman's.
const AR_PARTY_2023_REF: Partial<Record<string, string>> = {
  FIT: 'BRE', FP: 'MAS', UCR: 'BUL', HNP: 'SCH', PRO: 'BUL', LLA: 'MIL',
};
// Ideology axis 0 (left) → 17 (right). Includes both the 2023 candidates and the
// 2027 parties so the runoff transfer model works in baseline and projection modes.
const AR_IDEOLOGY_SCORE: Record<string, number> = {
  // 2023 candidates
  BRE: 2, MAS: 6, SCH: 9, BUL: 12, MIL: 16,
  // 2027 parties
  FIT: 1, FP: 6, UCR: 8, HNP: 9, PRO: 12, LLA: 16,
};

function trRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Generate 10 batch fire-times for one province.
// All provinces start near the beginning (first batch in first 20% of total).
// The remaining 9 batches land at fully random times up to totalMs.
// This means every province is reporting from near t=0, but individual
// batches trickle in unpredictably until the very end — creating maximum suspense.
function arProvBatchTimes(totalMs: number): number[] {
  const BATCHES = 10;
  // First batch: random in [0, 20% of totalMs]
  const firstT = Math.round(Math.random() * totalMs * 0.20);
  // Remaining 9: fully random in [firstT, totalMs], independently shuffled
  const rest = Array.from({ length: BATCHES - 1 }, () =>
    firstT + Math.round(Math.random() * (totalMs - firstT))
  );
  return [firstT, ...rest].sort((a, b) => a - b);
}

// Build noisy partial votes for a province at batch fraction f (0-1).
// Each candidate's running share drifts from a starting noise toward the true final value.
// At f=1 the result snaps exactly to finalVotes.
function arPartialVotes(
  finalVotes: Record<string, number>,
  f: number,   // fraction of votes counted (0–1)
  seed: number, // stable per-province seed for noise direction
): Record<string, number> {
  const ids = Object.keys(finalVotes);
  const finalTotal = ids.reduce((s, id) => s + finalVotes[id], 0);
  if (finalTotal === 0 || f <= 0) return Object.fromEntries(ids.map(id => [id, 0]));
  if (f >= 1) return { ...finalVotes };

  const counted = Math.round(finalTotal * f);
  // Each candidate gets a noisy share; noise amplitude shrinks as f→1
  const noiseAmp = 0.18 * (1 - f);   // ±18% noise at start, collapses to 0 at end
  const noisyShares: Record<string, number> = {};
  let shareSum = 0;
  ids.forEach((id, i) => {
    const trueShare = finalVotes[id] / finalTotal;
    // deterministic-ish noise per candidate per province using seed
    const phase = (seed * 7919 + i * 1301) % 1;
    const noise = noiseAmp * Math.sin(phase * Math.PI * 2 + f * Math.PI);
    noisyShares[id] = Math.max(0.001, trueShare + noise);
    shareSum += noisyShares[id];
  });
  // Normalise and round to integer votes
  const raw = ids.map(id => Math.round((noisyShares[id] / shareSum) * counted));
  // Fix rounding residual on the largest candidate
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const diff = counted - rawSum;
  const maxIdx = raw.reduce((bi, v, i) => v > raw[bi] ? i : bi, 0);
  raw[maxIdx] = Math.max(0, raw[maxIdx] + diff);
  return Object.fromEntries(ids.map((id, i) => [id, raw[i]]));
}

function simulateArgentinaR1(
  presets: Record<string, number>,
  enabledIds: string[],
): Record<string, Partial<Record<string, number>>> {
  // Compute 2023 R1 national totals per candidate
  const nat2023: Record<string, number> = {};
  let nat2023Grand = 0;
  for (const dept of Object.values(ARGENTINA_2023_R1)) {
    for (const [cid, v] of Object.entries(dept)) {
      if ((v ?? 0) > 0) { nat2023[cid] = (nat2023[cid] ?? 0) + (v as number); nat2023Grand += v as number; }
    }
  }

  const out: Record<string, Partial<Record<string, number>>> = {};
  for (const code of Object.keys(PROV_2023R1_TOTALS)) {
    const deptTotal = PROV_2023R1_TOTALS[code] ?? 0;
    if (deptTotal === 0) continue;
    const raw: Record<string, number> = {};
    for (const pid of enabledIds) {
      const preset = presets[pid] ?? 0;
      const refCand = AR_PARTY_2023_REF[pid];
      let ri = 1.0;
      if (refCand) {
        const dRef = ((ARGENTINA_2023_R1 as Record<string, Record<string, number>>)[code]?.[refCand] ?? 0);
        const dPct = deptTotal > 0 ? dRef / deptTotal : 0;
        const nPct = nat2023Grand > 0 ? (nat2023[refCand] ?? 0) / nat2023Grand : 0;
        ri = nPct > 0.001 ? Math.max(0.1, Math.min(4.0, dPct / nPct)) : 1.0;
      }
      raw[pid] = Math.max(0.001, preset * ri + trRandNormal() * 1.5);
    }
    // Blend 70% regional + 30% flat national preset to keep national totals sane
    const rawSum = Object.values(raw).reduce((s, v) => s + v, 0);
    const blended: Record<string, number> = {};
    for (const pid of enabledIds) {
      blended[pid] = 0.7 * ((raw[pid] ?? 0) * (rawSum > 0 ? 100 / rawSum : 0)) + 0.3 * (presets[pid] ?? 0);
    }
    const blendSum = Object.values(blended).reduce((s, v) => s + v, 0);
    const norm = blendSum > 0 ? 100 / blendSum : 0;
    // Largest-remainder integer votes
    const entries = enabledIds.map(pid => ({ pid, exact: (blended[pid] ?? 0) * norm * deptTotal / 100 }));
    const floors = entries.map(e => ({ pid: e.pid, floor: Math.floor(e.exact), rem: e.exact % 1 }));
    let assigned = floors.reduce((s, f) => s + f.floor, 0);
    floors.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < deptTotal - assigned; i++) floors[i].floor++;
    const r: Partial<Record<string, number>> = {};
    for (const { pid, floor } of floors) if (floor > 0) r[pid] = floor;
    out[code] = r;
  }
  return out;
}


// ── Ideology-based R2 vote-transfer model ─────────────────────────────────────
//
// Groups (by ideology score): 0=Hard left (FIT)  1=Left  2=Peronist centre-left
//         (Unión por la Patria)  3=Centre / provincial (Hacemos, UCR)
//         4=Centre-right (PRO / Juntos por el Cambio)  5=Libertarian right (LLA)
//
// Transfer table entry: [toLeft, toRight]  (abstain = 1 − toLeft − toRight)
// Key: `${voterGroup}-${leftCandGroup}-${rightCandGroup}`
//
// Estimates from the 2023 Argentine balotaje: Bullrich (JxC) endorsed Milei and her
// vote broke decisively to the libertarian right, Schiaretti's centrists split with a
// slight Milei lean, while the FIT/left leaned to Massa with heavy abstention.

function trGroup(score: number): number {
  if (score <= 2) return 0;
  if (score <= 4) return 1;
  if (score <= 7) return 2;
  if (score <= 11) return 3;
  if (score <= 13) return 4;
  return 5;
}

const AR_TRANSFER: Record<string, [number, number]> = {
  // The 2023 balotaje pattern: Peronist centre-left (G2) vs libertarian right (G5)
  '0-2-5': [0.55, 0.10],  // FIT / hard left → Massa lean, heavy abstention
  '1-2-5': [0.58, 0.10],
  '3-2-5': [0.34, 0.46],  // Schiaretti / provincial centre → slight Milei lean
  '4-2-5': [0.15, 0.75],  // Bullrich / JxC right → broke decisively for Milei
  '5-2-5': [0.05, 0.93],

  // Peronist centre-left (G2) vs centre-right JxC (G4) — e.g. Massa/Kicillof vs Bullrich
  '0-2-4': [0.60, 0.18],
  '3-2-4': [0.42, 0.40],
  '5-2-4': [0.20, 0.66],  // libertarian right → leans the centre-right finalist

  // Centre-right JxC (G4) vs libertarian right (G5) — e.g. Bullrich vs Milei
  '0-4-5': [0.45, 0.12],
  '2-4-5': [0.50, 0.16],
  '3-4-5': [0.42, 0.30],
};

// Fallback: pure inverse-distance weighting with abstention scaling
function trTransferFallback(voterScore: number, leftScore: number, rightScore: number): [number, number] {
  const dL = Math.abs(voterScore - leftScore);
  const dR = Math.abs(voterScore - rightScore);
  const tot = dL + dR || 1;
  const abstain = Math.min(0.52, Math.pow((dL + dR) / 2 / 17, 0.6) * 0.88);
  return [(1 - abstain) * (dR / tot), (1 - abstain) * (dL / tot)];
}

// Compute dept-level R2 results from R1 dept results via ideological vote transfer
function simulateArgentinaR2FromTransfers(
  r1Results: Record<string, Partial<Record<string, number>>>,
  r2Candidates: [string, string],
): Record<string, Partial<Record<string, number>>> {
  const [candA, candB] = r2Candidates;
  if (!candA || !candB) return {};

  const scoreA = AR_IDEOLOGY_SCORE[candA] ?? 8;
  const scoreB = AR_IDEOLOGY_SCORE[candB] ?? 8;
  const leftId  = scoreA <= scoreB ? candA : candB;
  const rightId = scoreA <= scoreB ? candB : candA;
  const leftScore  = Math.min(scoreA, scoreB);
  const rightScore = Math.max(scoreA, scoreB);
  const leftGroup  = trGroup(leftScore);
  const rightGroup = trGroup(rightScore);

  const out: Record<string, Partial<Record<string, number>>> = {};

  for (const code of Object.keys(PROV_2023R2_TOTALS)) {
    const deptTotal = PROV_2023R2_TOTALS[code] ?? 0;
    if (deptTotal === 0) continue;

    const r1Dept = r1Results[code] ?? {};
    const r1Total = Object.values(r1Dept).reduce((s: number, v) => s + (v ?? 0), 0);
    if (r1Total === 0) continue;

    let toLeft = 0, toRight = 0;

    for (const [cid, votes] of Object.entries(r1Dept) as [string, number][]) {
      if ((votes ?? 0) <= 0) continue;
      const frac = votes / r1Total;
      let tL: number, tR: number;

      if (cid === leftId)       { tL = 0.97; tR = 0.01; }
      else if (cid === rightId) { tL = 0.01; tR = 0.97; }
      else {
        const vs = AR_IDEOLOGY_SCORE[cid] ?? 8;
        const vg = trGroup(vs);
        const key = `${vg}-${leftGroup}-${rightGroup}`;
        const rates = AR_TRANSFER[key] ?? trTransferFallback(vs, leftScore, rightScore);
        [tL, tR] = rates;
      }

      toLeft  += frac * tL;
      toRight += frac * tR;
    }

    const active = toLeft + toRight;
    if (active <= 0) continue;
    const leftShare  = toLeft / active;
    const leftVotes  = Math.round(leftShare * deptTotal);
    const rightVotes = deptTotal - leftVotes;

    const r: Partial<Record<string, number>> = {};
    if (leftVotes  > 0) r[leftId]  = leftVotes;
    if (rightVotes > 0) r[rightId] = rightVotes;
    out[code] = r;
  }

  return out;
}

// Logit / sigmoid helpers — the runoff swing is applied on the log-odds scale
// (a "proportional"/uniform-swing model) rather than the raw percentage scale.
// This preserves each province's ideological ordering: a stronghold stays a
// stronghold unless the national result is a genuine landslide, instead of every
// province flipping in lock-step the moment the national number crosses 50%.
const trLogit   = (p: number): number => { const c = Math.min(0.985, Math.max(0.015, p)); return Math.log(c / (1 - c)); };
const trSigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

// Geographic spread factor (>1). Widens the gap between a candidate's home turf
// and hostile ground so ideological strongholds show decisive margins — Córdoba,
// Mendoza and Patagonia break hard for the libertarian right, the Greater Buenos
// Aires conurbano and the northern provinces for the Peronists — matching the real
// 2023 balotaje. It only shapes the *distribution*; the national total is
// re-centred to the target below.
const AR_R2_SPREAD = 1.7;

// Scale ideology-derived dept results so the national split matches the player's
// target %. Each province keeps the lean implied by its R1 ideology mix (via the
// transfer table), that lean is exaggerated on the logit scale by AR_R2_SPREAD, and
// then every province is shifted by ONE national constant (found by bisection) so
// the turnout-weighted national result equals the target exactly. Consequence: a
// right-wing "Divers" candidate cannot carry a left bastion like Paris over a
// left-wing opponent unless they are winning nationally by a landslide.
function simulateArgentinaR2WithTarget(
  r1Results: Record<string, Partial<Record<string, number>>>,
  r2Candidates: [string, string],
  targetPcts: [number, number], // [% for r2Candidates[0], % for r2Candidates[1]]
): Record<string, Partial<Record<string, number>>> {
  const raw = simulateArgentinaR2FromTransfers(r1Results, r2Candidates);
  if (Object.keys(raw).length === 0) return raw;

  const [candA, candB] = r2Candidates;
  const scoreA = AR_IDEOLOGY_SCORE[candA] ?? 8;
  const scoreB = AR_IDEOLOGY_SCORE[candB] ?? 8;
  const leftId  = scoreA <= scoreB ? candA : candB;
  const rightId = scoreA <= scoreB ? candB : candA;
  const targetLeftPct = Math.min(0.99, Math.max(0.01,
    (scoreA <= scoreB ? targetPcts[0] : targetPcts[1]) / 100));

  // National raw left share — the centre the per-province leans deviate from.
  let rawNatLeft = 0, rawNatRight = 0;
  for (const r of Object.values(raw)) {
    rawNatLeft  += r[leftId]  ?? 0;
    rawNatRight += r[rightId] ?? 0;
  }
  const rawNatTotal = rawNatLeft + rawNatRight;
  if (rawNatTotal === 0) return raw;
  const rawNatLogit = trLogit(rawNatLeft / rawNatTotal);

  // Per-province exaggerated lean (log-odds, centred near 0 nationally).
  const codes: string[] = [];
  const base:  number[] = [];
  const totals: number[] = [];
  for (const code of Object.keys(PROV_2023R2_TOTALS)) {
    const deptTotal = PROV_2023R2_TOTALS[code] ?? 0;
    const r = raw[code];
    if (deptTotal === 0 || !r) continue;
    const dL = r[leftId] ?? 0, dR = r[rightId] ?? 0;
    if (dL + dR === 0) continue;
    codes.push(code);
    base.push(AR_R2_SPREAD * (trLogit(dL / (dL + dR)) - rawNatLogit));
    totals.push(deptTotal);
  }
  if (codes.length === 0) return raw;
  const grandTotal = totals.reduce((s, t) => s + t, 0);

  // Bisect for the single national shift that makes the turnout-weighted left
  // share equal the target (national share is monotonic increasing in `shift`).
  const natLeftShareAt = (shift: number): number => {
    let left = 0;
    for (let i = 0; i < codes.length; i++) left += totals[i] * trSigmoid(shift + base[i]);
    return left / grandTotal;
  };
  let lo = -16, hi = 16;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (natLeftShareAt(mid) < targetLeftPct) lo = mid; else hi = mid;
  }
  const shift = (lo + hi) / 2;

  const out: Record<string, Partial<Record<string, number>>> = {};
  for (let i = 0; i < codes.length; i++) {
    const deptTotal = totals[i];
    const adjLeft = Math.min(0.99, Math.max(0.01, trSigmoid(shift + base[i])));
    const leftVotes  = Math.round(deptTotal * adjLeft);
    const rightVotes = deptTotal - leftVotes;
    const dept: Partial<Record<string, number>> = {};
    if (leftVotes  > 0) dept[leftId]  = leftVotes;
    if (rightVotes > 0) dept[rightId] = rightVotes;
    out[codes[i]] = dept;
  }
  return out;
}

// ── Argentina Simulation Panel ───────────────────────────────────────────────────
type SimState = 'idle' | 'r1_running' | 'r1_winner' | 'r2_input' | 'r2_running';

interface ArSimPanelProps {
  enabledIds: string[];
  getCandInfo: (id: string) => { name: string; color: string };
  simState: SimState;
  r2Candidates: [string, string]; // top 2 from R1, populated when simState === 'r2_input' | 'r2_running'
  r2CandR1Pcts: [number, number]; // their R1 national % (for display)
  simProgress: number;
  simTotal: number;
  onRunR1: (presets: Record<string, number>, duration: number) => void;
  onRunR2: (pcts: [number, number], duration: number) => void;
  onStop: () => void;
  onClose: () => void;
}

function ArSimulationPanel({
  enabledIds, getCandInfo, simState, r2Candidates, r2CandR1Pcts,
  simProgress, simTotal, onRunR1, onRunR2, onStop, onClose,
}: ArSimPanelProps) {
  const parseN = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : Math.max(0, n); };

  // ── R1 inputs state ──
  const [r1Inputs, setR1Inputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(enabledIds.map(id => [id, '']))
  );
  const [duration, setDuration] = useState<60 | 120 | 300 | 600>(60);
  const enabledKey = enabledIds.join(',');
  useEffect(() => {
    setR1Inputs(prev => {
      const next: Record<string, string> = {};
      for (const id of enabledIds) next[id] = prev[id] ?? '';
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  const r1Total = enabledIds.reduce((s, id) => s + parseN(r1Inputs[id] ?? ''), 0);
  const r1Valid = r1Total >= 99.95 && r1Total <= 100.05;

  const top2 = useMemo(() =>
    [...enabledIds]
      .map(id => ({ id, pct: parseN(r1Inputs[id] ?? '') }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 2)
      .filter(x => x.pct > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [r1Inputs, enabledKey]);

  // ── R2 inputs state ──
  const [r2Inputs, setR2Inputs] = useState(['', '']);
  useEffect(() => { setR2Inputs(['', '']); }, [r2Candidates[0], r2Candidates[1]]);

  const r2Total = parseN(r2Inputs[0]) + parseN(r2Inputs[1]);
  const r2Valid = r2Total >= 99.95 && r2Total <= 100.05;

  const isRunning = simState === 'r1_running' || simState === 'r2_running';
  const phaseColor = simState === 'r2_running' ? '#7C3AED' : '#2563EB';
  const phaseLabel = simState === 'r2_running' ? 'Round 2' : 'Round 1';
  const r1WinnerInfo = simState === 'r1_winner' && top2.length > 0 ? getCandInfo(top2[0].id) : null;

  const handleRunR1 = () => {
    if (!r1Valid || isRunning) return;
    const presets: Record<string, number> = {};
    for (const id of enabledIds) presets[id] = parseN(r1Inputs[id] ?? '');
    onRunR1(presets, duration);
  };

  const handleRunR2 = () => {
    if (!r2Valid || isRunning) return;
    onRunR2([parseN(r2Inputs[0]), parseN(r2Inputs[1])], duration);
  };

  const headerSubtitle = simState === 'r2_input' || simState === 'r2_running'
    ? 'Round 2 · 2027'
    : simState === 'r1_winner'
    ? '🏆 Round 1 Winner'
    : '2027 Election Night';

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-bold text-ink leading-tight">Simulation</h1>
          <p className="text-[9.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{headerSubtitle}</p>
        </div>
        <button onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5"
        >×</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2.5">

        {/* Realism warning */}

        {/* ── R1 OUTRIGHT WINNER ── */}
        {simState === 'r1_winner' && r1WinnerInfo && (
          <div className="rounded-[8px] border-2 border-yellow-400 bg-yellow-50 px-3 py-3 space-y-2 text-center">
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-yellow-700">Round 1 — Outright Winner</div>
            <div className="text-[13px] font-bold text-ink leading-tight">{r1WinnerInfo.name}</div>
            <div className="text-[10.5px] font-mono font-bold tabular-nums" style={{ color: r1WinnerInfo.color }}>
              {top2[0] ? top2[0].pct.toFixed(1) : '—'}% · Win secured in Round 1
            </div>
            <div className="text-[9px] text-ink-2 leading-relaxed">
              Cleared Argentina's first-round threshold (&gt;45%, or &gt;40% with a 10-point lead) — no balotaje needed. Election is decided.
            </div>
          </div>
        )}

        {/* ── R2 INPUT view ── */}
        {(simState === 'r2_input' || simState === 'r2_running') && (
          <>
            <div className="rounded-[6px] border border-[#7C3AED]/20 bg-[#7C3AED]/5 px-3 py-2.5">
              <div className="flex gap-2">
                <span className="text-[#7C3AED] shrink-0 mt-[1px]">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                    <circle cx="5.5" cy="5.5" r="5" stroke="#7C3AED" strokeWidth="1.1"/>
                    <rect x="5" y="4.5" width="1" height="3.5" rx="0.5" fill="#7C3AED"/>
                    <rect x="5" y="2.8" width="1" height="1" rx="0.5" fill="#7C3AED"/>
                  </svg>
                </span>
                <p className="text-[9px] text-ink-2 leading-[1.5]">
                  Round 1 is done. Enter your predicted R2 national percentages for the two finalists — geographic variation is modelled automatically.
                </p>
              </div>
            </div>

            <div className="rounded-[5px] border border-default bg-canvas px-2.5 py-2 space-y-1.5">
              <p className="text-[7.5px] font-mono font-bold uppercase tracking-[0.13em] text-ink-3">Round 2 Finalists</p>
              {r2Candidates.map((id, i) => {
                const info = getCandInfo(id);
                return (
                  <div key={id} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: info.color }} />
                    <span className="flex-1 text-[9.5px] font-medium text-ink truncate">{info.name}</span>
                    <span className="text-[8.5px] font-mono text-ink-3">R1: {r2CandR1Pcts[i].toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>

            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">
              R2 National % — must total 100
            </div>
            {r2Candidates.map((id, i) => {
              const info = getCandInfo(id);
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: info.color }} />
                  <span className="flex-1 text-[10.5px] truncate text-ink font-medium">{info.name}</span>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={r2Inputs[i]}
                    disabled={simState === 'r2_running'}
                    onChange={e => setR2Inputs(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                    className="w-16 h-6 border border-default rounded-[4px] text-right px-1.5 text-[10.5px] font-mono text-ink bg-white disabled:opacity-50 focus:outline-none focus:border-ink/30"
                    placeholder="0"
                  />
                  <span className="text-[9.5px] font-mono text-ink-3">%</span>
                </div>
              );
            })}
          </>
        )}

        {/* ── R1 INPUT view ── */}
        {(simState === 'idle' || simState === 'r1_running') && (
          <>
            <div className="rounded-[6px] border border-[#2563EB]/20 bg-[#2563EB]/5 px-3 py-2.5">
              <div className="flex gap-2">
                <span className="text-[#2563EB] shrink-0 mt-[1px]">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                    <circle cx="5.5" cy="5.5" r="5" stroke="#2563EB" strokeWidth="1.1"/>
                    <rect x="5" y="4.5" width="1" height="3.5" rx="0.5" fill="#2563EB"/>
                    <rect x="5" y="2.8" width="1" height="1" rx="0.5" fill="#2563EB"/>
                  </svg>
                </span>
                <p className="text-[9px] text-ink-2 leading-[1.5]">
                  Customize candidates via the <span className="font-bold text-ink">Parties</span> button. After Round 1 finishes you'll enter the Round 2 matchup.
                </p>
              </div>
            </div>

            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">
              R1 National % — must total 100
            </div>
            {enabledIds.map(id => {
              const info = getCandInfo(id);
              const isTop2 = top2.some(t => t.id === id);
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: info.color }} />
                  <span className={`flex-1 text-[10.5px] truncate ${isTop2 && r1Valid ? 'font-semibold text-ink' : 'text-ink'}`}>{info.name}</span>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={r1Inputs[id] ?? ''}
                    disabled={simState === 'r1_running'}
                    onChange={e => setR1Inputs(prev => ({ ...prev, [id]: e.target.value }))}
                    className="w-16 h-6 border border-default rounded-[4px] text-right px-1.5 text-[10.5px] font-mono text-ink bg-canvas disabled:opacity-50 focus:outline-none focus:border-ink/30"
                    placeholder="0"
                  />
                  <span className="text-[9.5px] font-mono text-ink-3">%</span>
                </div>
              );
            })}

            {top2.length === 2 && r1Valid && (
              <div className="rounded-[5px] border border-[#7C3AED]/20 bg-[#7C3AED]/5 px-2.5 py-2 space-y-1">
                <p className="text-[7.5px] font-mono font-bold uppercase tracking-[0.13em] text-[#7C3AED]">Projected R2 Matchup</p>
                {top2.map(({ id, pct }) => {
                  const info = getCandInfo(id);
                  return (
                    <div key={id} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: info.color }} />
                      <span className="flex-1 text-[9px] text-ink truncate font-medium">{info.name}</span>
                      <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color: info.color }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3.5 py-3 border-t border-default space-y-2.5">

        {/* Total indicator — only show for the active input phase */}
        {(simState === 'idle' || simState === 'r1_running') && (
          <div className={`flex justify-between text-[10.5px] font-mono font-bold border rounded-[4px] px-2.5 py-1.5 ${r1Valid ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : r1Total > 0.05 ? 'text-red-500 border-red-200 bg-red-50' : 'text-ink-3 border-default'}`}>
            <span>Total</span><span>{r1Total.toFixed(1)}%</span>
          </div>
        )}
        {(simState === 'r2_input' || simState === 'r2_running') && (
          <div className={`flex justify-between text-[10.5px] font-mono font-bold border rounded-[4px] px-2.5 py-1.5 ${r2Valid ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : r2Total > 0.05 ? 'text-red-500 border-red-200 bg-red-50' : 'text-ink-3 border-default'}`}>
            <span>Total</span><span>{r2Total.toFixed(1)}%</span>
          </div>
        )}

        {/* Duration picker — only when not running */}
        {!isRunning && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] font-mono text-ink-3 uppercase tracking-wide shrink-0">Duration</span>
            {([60, 120, 300, 600] as const).map(d => (
              <button key={d} onClick={() => setDuration(d)}
                className={`flex-1 h-7 text-[10px] font-mono font-medium rounded-[4px] border transition-colors ${duration === d ? 'bg-ink/8 border-ink/20 text-ink' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}>
                {d === 60 ? '1m' : d === 120 ? '2m' : d === 300 ? '5m' : '10m'}
              </button>
            ))}
          </div>
        )}

        {/* Progress bar when running */}
        {isRunning && (
          <div>
            <div className="flex justify-between text-[9.5px] font-mono mb-1">
              <span style={{ color: phaseColor }} className="font-semibold">{phaseLabel}</span>
              <span className="text-ink-3">{simProgress} / {simTotal} depts</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#eae8e3] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${simTotal > 0 ? (simProgress / simTotal) * 100 : 0}%`, background: phaseColor }} />
            </div>
          </div>
        )}

        {/* Error hints */}
        {simState === 'idle' && !r1Valid && r1Total > 0.05 && (
          <p className="text-[9.5px] font-mono text-red-500 text-center">Total must be exactly 100%</p>
        )}
        {simState === 'r2_input' && !r2Valid && r2Total > 0.05 && (
          <p className="text-[9.5px] font-mono text-red-500 text-center">Total must be exactly 100%</p>
        )}

        {/* Action button */}
        {isRunning && (
          <button onClick={onStop}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-[#B91C1C] text-white hover:bg-[#991B1B]">
            ⏹  Stop Simulation
          </button>
        )}
        {simState === 'idle' && (
          <button onClick={handleRunR1} disabled={!r1Valid}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-[#2563EB] text-white hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed">
            ▶  Run Round 1
          </button>
        )}
        {simState === 'r2_input' && (
          <button onClick={handleRunR2} disabled={!r2Valid}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-[#7C3AED] text-white hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed">
            ▶  Run Round 2
          </button>
        )}
        {simState === 'r1_winner' && (
          <button onClick={onStop}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-[#374151] text-white hover:bg-[#1f2937]">
            ↩  Reset
          </button>
        )}
      </div>
    </aside>
  );
}

// ── Reference Panel (2023 results or 2027R1 results for comparison) ──────────
function Ar2023RefPanel({ dept, results, label, onClose, getCandInfo: getCandInfoProp }: {
  dept: DeptInfo;
  results: Partial<Record<string, number>>;
  label: string;
  onClose: () => void;
  getCandInfo?: (id: string) => { name: string; color: string };
}) {
  const sorted = Object.entries(results)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  const resolveInfo = (id: string) => {
    if (getCandInfoProp) return getCandInfoProp(id);
    const cand = AR_CANDIDATE_MAP[id as ArCandidateId];
    return cand ? { name: getLastName(cand.name), color: cand.color } : null;
  };

  return (
    <aside className="w-52 shrink-0 bg-surface border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3 pt-3 pb-2.5 border-b border-default flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[12px] font-bold text-ink leading-tight truncate">{dept.nom}</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{label}</p>
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded-[3px] text-ink-3 hover:bg-hover hover:text-ink transition-colors shrink-0 text-sm leading-none mt-0.5"
        >×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2.5 thin-scroll space-y-2">
        {sorted.map(([id, votes], i) => {
          const info = resolveInfo(id);
          if (!info) return null;
          const pct = total > 0 ? (votes / total) * 100 : 0;
          return (
            <div key={id}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: info.color }} />
                <span className="text-[9px] font-medium text-ink flex-1 truncate leading-none" style={{ fontWeight: i === 0 ? 600 : 400 }}>
                  {info.name}
                </span>
                <span className="text-[9px] font-mono font-semibold tabular-nums" style={{ color: info.color }}>{pct.toFixed(1)}%</span>
              </div>
              <div className="h-[3.5px] rounded-full bg-black/6 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: info.color }} />
              </div>
              <div className="text-right font-mono text-[8px] text-ink-3 mt-0.5 tabular-nums">{votes.toLocaleString()}</div>
            </div>
          );
        })}
        <div className="pt-1.5 border-t border-default flex justify-between text-[8.5px] font-mono text-ink-3">
          <span>Total</span>
          <span className="tabular-nums">{total.toLocaleString()}</span>
        </div>
      </div>
    </aside>
  );
}

// ── Argentina Multi-Select Panel ─────────────────────────────────────────────────
function ArMultiSelectPanel({
  selectedDepts,
  workingDeptResults,
  allIds,
  getCandInfo,
  activeElection,
  projected2027,
  onUpdateMany,
  onProjectMany,
}: {
  selectedDepts: Set<string>;
  workingDeptResults: Record<string, Partial<Record<string, number>>>;
  allIds: string[];
  getCandInfo: (id: string) => { name: string; color: string };
  activeElection: ElectionKey;
  projected2027: Set<string>;
  onUpdateMany: (updates: Record<string, Partial<Record<string, number>>>) => void;
  onProjectMany: (codes: string[]) => void;
}) {
  const [locks, setLocks] = useState<Set<string>>(new Set());
  useEffect(() => { setLocks(new Set()); }, [selectedDepts]);

  const selKey = useMemo(() => [...selectedDepts].sort().join(','), [selectedDepts]);

  // Stable sort order: only recompute when selection or allIds changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedIds = useMemo(() => {
    if (selectedDepts.size === 0) return [];
    const initAgg: Record<string, number> = Object.fromEntries(allIds.map(id => [id, 0]));
    for (const code of selectedDepts) {
      const r = workingDeptResults[code] ?? {};
      for (const id of allIds) initAgg[id] += (r[id] ?? 0);
    }
    return [...allIds].sort((a, b) => (initAgg[b] ?? 0) - (initAgg[a] ?? 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, allIds]);

  if (selectedDepts.size === 0) return null;

  const is2027R1 = activeElection === '2027R1';

  function getDeptTotal(code: string): number {
    if (is2027R1) return PROV_2023R1_TOTALS[code] ?? 0;
    const r = workingDeptResults[code] ?? {};
    return allIds.reduce((s, id) => s + (r[id] ?? 0), 0);
  }

  const aggregateTotalVotes = Array.from(selectedDepts).reduce((s, code) => s + getDeptTotal(code), 0);

  const aggregateVotes: Record<string, number> = Object.fromEntries(allIds.map(id => [id, 0]));
  for (const code of selectedDepts) {
    const r = workingDeptResults[code] ?? {};
    for (const id of allIds) aggregateVotes[id] += (r[id] ?? 0);
  }

  const winnerInfo   = sortedIds[0] ? getCandInfo(sortedIds[0]) : null;
  const winnerVotes  = sortedIds[0] ? (aggregateVotes[sortedIds[0]] ?? 0) : 0;
  const runnerUpVotes = sortedIds[1] ? (aggregateVotes[sortedIds[1]] ?? 0) : 0;

  function handleSlider(partyId: string, newAggPct: number) {
    const currentAggPct = aggregateTotalVotes > 0
      ? ((aggregateVotes[partyId] ?? 0) / aggregateTotalVotes) * 100
      : 0;
    const deltaPct = newAggPct - currentAggPct;

    const updates: Record<string, Partial<Record<string, number>>> = {};
    for (const code of selectedDepts) {
      const deptTotal = getDeptTotal(code);
      if (deptTotal === 0) continue;
      const r = workingDeptResults[code] ?? {};
      const currentPcts = toPcts(r, allIds);
      const newPct = Math.max(0, Math.min((currentPcts[partyId] ?? 0) + deltaPct, 100));
      const newPcts = redistributePcts(currentPcts, partyId, newPct, locks);
      const newVotes: Partial<Record<string, number>> = {};
      for (const id of allIds) newVotes[id] = Math.round((newPcts[id] ?? 0) * deptTotal / 100);
      updates[code] = newVotes;
    }
    onUpdateMany(updates);
  }

  const unprojectedCount = is2027R1
    ? Array.from(selectedDepts).filter(code => !projected2027.has(code)).length
    : 0;

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">

      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight">
              {selectedDepts.size} Depts Selected
            </h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {aggregateTotalVotes.toLocaleString()} combined votes
            </p>
          </div>
        </div>

        {winnerInfo && winnerVotes > 0 && (
          <div className="mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: winnerInfo.color }} />
            <span className="text-[12px] font-semibold text-ink flex-1 truncate">{winnerInfo.name}</span>
            <span className="font-mono text-[11px] font-semibold text-ink-2">
              {aggregateTotalVotes > 0 ? ((winnerVotes / aggregateTotalVotes) * 100).toFixed(1) : '0.0'}%
            </span>
            {sortedIds[1] && (
              <span className="text-[10px] font-mono text-ink-3">
                +{aggregateTotalVotes > 0
                  ? (((winnerVotes - runnerUpVotes) / aggregateTotalVotes) * 100).toFixed(1)
                  : '0.0'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Project All button for 2027R1 */}
      {is2027R1 && (
        <div className="px-3.5 py-2 border-b border-default">
          {unprojectedCount > 0 ? (
            <button
              onClick={() => {
                const updates: Record<string, Partial<Record<string, number>>> = {};
                const toProject: string[] = [];
                for (const code of selectedDepts) {
                  if (!projected2027.has(code)) {
                    updates[code] = workingDeptResults[code] ?? {};
                    toProject.push(code);
                  }
                }
                onUpdateMany(updates);
                onProjectMany(toProject);
              }}
              className="w-full h-8 text-[11px] font-mono font-bold rounded-[5px] bg-[#2563EB] text-white hover:bg-[#1d4ed8] active:bg-[#1e40af] transition-colors uppercase tracking-wide shadow-sm"
            >
              Project {unprojectedCount} Dept{unprojectedCount !== 1 ? 's' : ''}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-1.5 h-8 text-[10.5px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[5px] tracking-wide uppercase select-none">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <circle cx="5.5" cy="5.5" r="5.5" fill="#059669"/>
                <path d="M2.5 5.5l2 2L8.5 3.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              All Projected
            </div>
          )}
        </div>
      )}

      {/* Sliders */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-2">
        {sortedIds.map(partyId => {
          const info     = getCandInfo(partyId);
          const votes    = aggregateVotes[partyId] ?? 0;
          const pct      = aggregateTotalVotes > 0 ? (votes / aggregateTotalVotes) * 100 : 0;
          const isLocked = locks.has(partyId);

          return (
            <div key={partyId}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: info.color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{info.name}</span>
                <button
                  onClick={() => setLocks(prev => { const n = new Set(prev); n.has(partyId) ? n.delete(partyId) : n.add(partyId); return n; })}
                  title={isLocked ? 'Unlock' : 'Lock'}
                  className={`w-4 h-4 flex items-center justify-center transition-colors shrink-0 ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}
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
                <span className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none">
                  {pct.toFixed(1)}%
                </span>
              </div>

              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}


                onChange={e => handleSlider(partyId, parseFloat(e.target.value))}


                className="br-party-slider w-full"


                style={{ '--party-color': info.color, '--pct': `${pct}%` } as React.CSSProperties} />


              <div className="text-right text-[8.5px] font-mono text-ink-3 mt-0.5">


                {votes.toLocaleString()} votes


              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3.5 py-2 border-t border-default">
        <p className="text-[8px] font-mono text-ink-3 text-center uppercase tracking-wide">
          Drag sliders · Lock to fix · Delta applied per dept
        </p>
      </div>
    </aside>
  );
}

// ── Region data ──────────────────────────────────────────────────────────────
const AR_DEPT_NAMES: Record<string, string> = {
  BA:'Buenos Aires', DF:'CABA', CT:'Catamarca', CC:'Chaco',
  CH:'Chubut', CB:'Córdoba', CN:'Corrientes', ER:'Entre Ríos',
  FM:'Formosa', JY:'Jujuy', LP:'La Pampa', LR:'La Rioja',
  MZ:'Mendoza', MN:'Misiones', NQ:'Neuquén', RN:'Río Negro',
  SA:'Salta', SJ:'San Juan', SL:'San Luis', SC:'Santa Cruz',
  SF:'Santa Fe', SE:'Santiago del Estero', TF:'Tierra del Fuego', TM:'Tucumán',
};

// Argentina's standard geographic regions (the 24 jurisdictions grouped).
const AR_REGIONS: { id: string; name: string; depts: string[] }[] = [
  { id: 'PAM', name: 'Pampeana',  depts: ['BA','DF','CB','SF','ER','LP'] },
  { id: 'NOA', name: 'Noroeste',  depts: ['JY','SA','TM','CT','SE'] },
  { id: 'NEA', name: 'Noreste',   depts: ['CC','CN','FM','MN'] },
  { id: 'CUY', name: 'Cuyo',      depts: ['MZ','SJ','SL','LR'] },
  { id: 'PAT', name: 'Patagonia', depts: ['NQ','RN','CH','SC','TF'] },
];

// ── Summary Panel ─────────────────────────────────────────────────────────────
interface ArSummaryPanelProps {
  deptResults: Record<string, Partial<Record<string, number>>>;
  getCandInfo: (id: string) => { name: string; color: string };
  roundLabel: string;
  onClose: () => void;
}

function ArSummaryPanel({ deptResults, getCandInfo, roundLabel, onClose }: ArSummaryPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const regionData = useMemo(() => AR_REGIONS.map(region => {
    const agg: Record<string, number> = {};
    let deptsWith = 0;
    for (const code of region.depts) {
      const r = deptResults[code] ?? {};
      const hasData = Object.values(r).some(v => (v ?? 0) > 0);
      if (hasData) deptsWith++;
      for (const [pid, v] of Object.entries(r) as [string, number][]) {
        if ((v ?? 0) > 0) agg[pid] = (agg[pid] ?? 0) + v;
      }
    }
    const sorted = (Object.entries(agg) as [string, number][]).sort(([, a], [, b]) => b - a);
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    const winner = sorted[0];
    const info = winner ? getCandInfo(winner[0]) : null;
    const pct = winner && total > 0 ? (winner[1] / total) * 100 : 0;
    const runnerUpPct = sorted[1] ? (sorted[1][1] / total) * 100 : 0;
    const margin = pct - runnerUpPct;
    let color = '#E5E7EB';
    if (info) {
      const t = Math.min(Math.max(margin / 30, 0), 1);
      const lightness = 0.82 - t * (0.82 - 0.38);
      const c = hsl(info.color); c.l = lightness; color = c.formatHex();
    }
    const deptData = region.depts.map(code => {
      const r = deptResults[code] ?? {};
      const ds = (Object.entries(r) as [string, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      const dt = ds.reduce((s, [, v]) => s + v, 0);
      const dWinner = ds[0];
      const dInfo = dWinner ? getCandInfo(dWinner[0]) : null;
      const dPct = dWinner && dt > 0 ? (dWinner[1] / dt) * 100 : 0;
      return { code, name: AR_DEPT_NAMES[code] ?? code, dInfo, dPct, hasData: ds.length > 0 };
    });
    return { ...region, sorted, total, winner, info, pct, margin, color, deptsWith, deptData };
  }), [deptResults, getCandInfo]);

  const totalDepts = AR_REGIONS.reduce((s, r) => s + r.depts.length, 0);
  const totalWith  = regionData.reduce((s, r) => s + r.deptsWith, 0);

  return (
    <aside className="w-72 shrink-0 bg-white border-r border-default flex flex-col overflow-hidden z-10" style={{ boxShadow: '2px 0 12px rgba(0,0,0,0.07)' }}>
      <div className="px-3.5 pt-3 pb-2.5 border-b border-default flex items-start justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-tight">Regional Summary</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{roundLabel} · {totalWith}/{totalDepts} depts</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {regionData.map(region => {
          const isExpanded = expanded === region.id;
          return (
            <div key={region.id} className="border-b border-black/5">
              <button
                onClick={() => setExpanded(prev => prev === region.id ? null : region.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-black/[0.025] transition-colors text-left"
              >
                <div className="w-2.5 self-stretch rounded-sm shrink-0" style={{ background: region.color, minHeight: 28 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10.5px] font-bold text-ink leading-tight truncate">{region.name}</div>
                  {region.info ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: region.info.color }} />
                      <span className="text-[9px] font-mono text-ink-2 truncate">{getLastName(region.info.name)}</span>
                      <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color: region.info.color }}>{region.pct.toFixed(1)}%</span>
                    </div>
                  ) : (
                    <div className="text-[9px] font-mono text-ink-3 mt-0.5">No results yet</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[8px] font-mono text-ink-3">{region.deptsWith}/{region.depts.length}</span>
                  <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''} text-ink-3`} aria-hidden="true">
                    <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-black/5" style={{ background: 'rgba(0,0,0,0.018)' }}>
                  {region.deptData.map(dept => (
                    <div key={dept.code} className="flex items-center gap-2 px-4 py-[5px]">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dept.dInfo?.color ?? '#ddd' }} />
                      <span className="text-[8.5px] font-mono text-ink-3 w-6 shrink-0 tabular-nums">{dept.code}</span>
                      <span className="text-[9.5px] text-ink flex-1 truncate">{dept.name}</span>
                      {dept.hasData ? (
                        <span className="text-[9px] font-mono font-bold tabular-nums shrink-0" style={{ color: dept.dInfo?.color ?? '#888' }}>{dept.dPct.toFixed(1)}%</span>
                      ) : (
                        <span className="text-[8.5px] font-mono text-ink-3 shrink-0">—</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Tutorial panel ────────────────────────────────────────────────────────────
function ArTutorialPanel({ onClose, exiting }: { onClose: () => void; exiting?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>
  );
  const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>
  );
  const Note = ({ children }: { children: React.ReactNode }) => (
    <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>
  );
  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <div className="flex gap-2 mb-1.5">
      <span className="shrink-0 w-4 h-4 rounded-full bg-gold text-white text-[8px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span className="text-[11px] text-ink leading-relaxed">{children}</span>
    </div>
  );
  const Tag = ({ children, color = 'bg-ink/8 text-ink' }: { children: React.ReactNode; color?: string }) => (
    <span className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono font-semibold ${color} mr-1`}>{children}</span>
  );

  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Presidential Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">

        <H2>Argentina's Two-Round System</H2>
        <P>Argentina elects its <strong>President</strong> by direct popular vote — one national contest tallied across <strong>24 jurisdictions</strong> (23 provinces plus the Autonomous City of Buenos Aires).</P>
        <div className="flex gap-2 mb-2">
          <div className="flex-1 bg-[#f8f7f4] border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">Round 1</div>
            <div className="text-[10px] text-ink-2 leading-relaxed">All candidates run. A candidate wins outright with <strong>&gt;45%</strong> of valid votes, or <strong>&gt;40%</strong> with at least a <strong>10-point lead</strong> over the runner-up.</div>
          </div>
          <div className="flex-1 bg-[#f8f7f4] border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">Round 2 (Balotaje)</div>
            <div className="text-[10px] text-ink-2 leading-relaxed">If nobody clears the Round 1 threshold, the top two advance to a runoff. The higher vote total wins.</div>
          </div>
        </div>
        <Note>In 2023 Massa led the first round with 36.78% — short of the threshold — forcing a runoff, which Javier Milei won with 55.65% over Massa's 44.35%.</Note>

        <H2>Map Presets</H2>
        <div className="space-y-2 mb-2">
          <div><Tag>2023 R1</Tag><span className="text-[10px] text-ink-2">Actual first-round results (22 Oct 2023), by province.</span></div>
          <div><Tag>2023 R2</Tag><span className="text-[10px] text-ink-2">Actual runoff results (19 Nov 2023) — Milei vs Massa.</span></div>
          <div><Tag>2027 R1</Tag><span className="text-[10px] text-ink-2">Blank canvas for the next election — fill in R1 by province.</span></div>
          <div><Tag>2027 R2</Tag><span className="text-[10px] text-ink-2">Projects the runoff based on your R1 inputs and transfer flows.</span></div>
        </div>

        <H2>Editing a Province</H2>
        <P>Click any province on the map to open its result panel on the right.</P>
        <Step n={1}>Drag sliders or click a percentage to type a value for each candidate.</Step>
        <Step n={2}>Adjusting one candidate redistributes shares among unlocked candidates.</Step>
        <Step n={3}>In <strong>2027 R1</strong>, click <Tag color="bg-emerald-600 text-white">Project</Tag> to commit the result and advance the top two to R2.</Step>
        <Step n={4}>Toggle <strong>2023 R1 Reference</strong> to compare your inputs against historical results side-by-side.</Step>

        <H2>Candidate Selection (2027)</H2>
        <P>Each party fielding a 2027 candidate lets you pick who leads it — click the <strong>chevron</strong> next to a leader's name in the scoreboard to choose from alternatives. This affects the photo and label only; vote shares are set independently.</P>

        <H2>Round 2 Transfer Model</H2>
        <P>When you move to <Tag>2027 R2</Tag>, the simulator calculates the runoff using a transfer-flow model: voters of eliminated first-round candidates redistribute to the two finalists by ideological proximity, with abstention modelled per bloc distance.</P>
        <Note>Bullrich's (Juntos por el Cambio) voters break heavily to the libertarian right; FIT and the left lean to the Peronist finalist with heavy abstention — matching the real 2023 balotaje. Provinces you haven't projected in R1 use 2023 R1 as the base.</Note>

        <H2>Simulation</H2>
        <P>Click <Tag>▶ Sim</Tag> to open the simulation panel. Run R1 or R2 automatically — provinces report one by one in a random order with modelled uncertainty, mimicking election-night results coming in.</P>

        <H2>Reading the Scoreboard</H2>
        <P>The scoreboard shows each candidate's national vote share and raw votes. In <strong>R1</strong>, the top-two candidates carry an <Tag color="bg-blue-600 text-white">ADVANCE</Tag> badge if no one wins outright. In <strong>R2</strong>, the winner gets a checkmark ✓.</P>
        <Note>To win in Round 1 a candidate needs &gt;45% of valid votes, or &gt;40% with a 10-point lead. Otherwise it goes to a runoff, where a simple majority of the two-person vote wins.</Note>

        <div className="h-4" />
      </div>
    </aside>
  );
}

// ── Main Argentina App ───────────────────────────────────────────────────────────
export default function ArgentinaApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [selectedDept, setSelectedDept] = useState<DeptInfo | null>(null);
  const [activeElection, setActiveElection] = useState<ElectionKey>('2023R1');
  const [overrides, setOverrides] = useState<Record<ElectionKey, Record<string, Partial<Record<string, number>>>>>({
    '2023R1': {}, '2023R2': {}, '2027R1': {}, '2027R2': {},
  });
  const [picks2027, setPicks2027] = useState<Record<string, string>>(() =>
    Object.fromEntries(AR_2027_PARTIES.map(p => [p.id, p.candidates[0]]))
  );
  const [hiddenParty2027, setHiddenParty2027] = useState<Set<string>>(new Set(['NE']));
  const [projected2027, setProjected2027] = useState<Set<string>>(new Set());
  const [projected2027R2, setProjected2027R2] = useState<Set<string>>(new Set());
  const [showPartyFilter, setShowPartyFilter] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  const [show2023Ref, setShow2023Ref] = useState(false);
  const [show2027R1Ref, setShow2027R1Ref] = useState(false);
  const [showSimPanel, setShowSimPanel] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [bubbleMapMode, setBubbleMapMode] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialExiting, setTutorialExiting] = useState(false);
  const [simState, setSimState] = useState<SimState>('idle');
  const [simProgress, setSimProgress] = useState(0);
  const [simTotal, setSimTotal] = useState(0);
  const [simR1WinnerId, setSimR1WinnerId] = useState<string>('');
  const [simR1Pcts, setSimR1Pcts] = useState<[number, number]>([0, 0]);
  const [winnerOverlayDismissed, setWinnerOverlayDismissed] = useState(false);
  const [r2AwaitCandidates, setR2AwaitCandidates] = useState<[string, string]>(['', '']);
  const [r2AwaitR1Pcts, setR2AwaitR1Pcts] = useState<[number, number]>([0, 0]);
  // Batch reporting: fraction 0-1 per province, drives partial results on map/tooltip
  const [simBatchFractions,   setSimBatchFractions]   = useState<Record<string, number>>({});
  const [simBatchFractionsR2, setSimBatchFractionsR2] = useState<Record<string, number>>({});
  const r1ResultsRef = useRef<Record<string, Partial<Record<string, number>>>>({});
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const partyFilterRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPartyFilter) return;
    function handler(e: MouseEvent) {
      if (partyFilterRef.current && !partyFilterRef.current.contains(e.target as Node)) {
        setShowPartyFilter(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPartyFilter]);

  const baseDeptData = useMemo((): Record<string, Partial<Record<string, number>>> => {
    if (activeElection === '2023R1') return ARGENTINA_2023_R1 as Record<string, Partial<Record<string, number>>>;
    if (activeElection === '2023R2') return ARGENTINA_2023_R2 as Record<string, Partial<Record<string, number>>>;
    return {};
  }, [activeElection]);

  // Working results — what slider panels read (includes unconfirmed edits)
  const workingDeptResults = useMemo<Record<string, Partial<Record<string, number>>>>(
    () => ({ ...baseDeptData, ...overrides[activeElection] }),
    [activeElection, baseDeptData, overrides],
  );

  // Published results — what the map and scoreboard see.
  // 2027R1: fully projected depts show exact votes; partial batch depts show noisy partial votes.
  // 2027R2: only fully projected depts shown.
  const deptResults = useMemo<Record<string, Partial<Record<string, number>>>>(() => {
    if (activeElection === '2027R1') {
      const out: Record<string, Partial<Record<string, number>>> = {};
      for (const [code, r] of Object.entries(workingDeptResults)) {
        if (projected2027.has(code)) {
          out[code] = r;  // fully reported — exact final votes
        } else {
          const f = simBatchFractions[code];
          if (f && f > 0) {
            // In-progress batch: noisy partial votes for suspense
            const final = Object.fromEntries(
              Object.entries(r).map(([id, v]) => [id, (v as number) ?? 0])
            ) as Record<string, number>;
            const seed = Object.keys(PROV_2023R1_TOTALS).indexOf(code);
            out[code] = arPartialVotes(final, f, seed);
          }
        }
      }
      return out;
    }
    if (activeElection === '2027R2') {
      const out: Record<string, Partial<Record<string, number>>> = {};
      for (const [code, r] of Object.entries(workingDeptResults)) {
        if (projected2027R2.has(code)) {
          out[code] = r;
        } else {
          const f = simBatchFractionsR2[code];
          if (f && f > 0) {
            const final = Object.fromEntries(
              Object.entries(r).map(([id, v]) => [id, (v as number) ?? 0])
            ) as Record<string, number>;
            const seed = Object.keys(PROV_2023R2_TOTALS).indexOf(code);
            out[code] = arPartialVotes(final, f, seed);
          }
        }
      }
      return out;
    }
    return workingDeptResults;
  }, [activeElection, workingDeptResults, projected2027, projected2027R2, simBatchFractions, simBatchFractionsR2]);

  // ── 2027 R1 projection engine — always live, drives both R1 ADVANCE badges and R2 panel ──
  const r2027Reporting = useMemo(() => {
    const totalVotes = Object.values(PROV_2023R1_TOTALS).reduce((s, v) => s + v, 0);
    let reportedVotes = 0;
    const tally: Record<string, number> = {};
    for (const [code, r] of Object.entries(overrides['2027R1'])) {
      const provTotal = PROV_2023R1_TOTALS[code] ?? 0;
      // fully projected provinces count 100%; partial batches count their fraction
      const frac = projected2027.has(code) ? 1 : (simBatchFractions[code] ?? 0);
      if (frac <= 0) continue;
      const deptSum = Object.values(r).reduce((s: number, v) => s + (v ?? 0), 0);
      if (deptSum > 0) {
        reportedVotes += (provTotal || deptSum) * frac;
        for (const [pid, v] of Object.entries(r)) {
          if ((v ?? 0) > 0) tally[pid] = (tally[pid] ?? 0) + (v as number) * frac;
        }
      }
    }
    const reportingPct = totalVotes > 0 ? reportedVotes / totalVotes : 0;
    const remainingVotes = Math.max(0, totalVotes - reportedVotes);
    const sorted = Object.entries(tally).sort(([, a], [, b]) => b - a);
    const projectedSet = new Set<string>();
    const LOCK_SHARE = 0.65;
    const thirdVotes = sorted[2]?.[1] ?? 0;
    if (sorted.length >= 1 && reportingPct >= 0.20) {
      const [p1id, p1votes] = sorted[0];
      if (p1votes > thirdVotes + LOCK_SHARE * remainingVotes) projectedSet.add(p1id);
    }
    if (sorted.length >= 2 && reportingPct >= 0.35) {
      const [p2id, p2votes] = sorted[1];
      if (p2votes > thirdVotes + LOCK_SHARE * remainingVotes) projectedSet.add(p2id);
    }
    return { reportingPct, projectedSet };
  }, [overrides, projected2027, simBatchFractions]);

  // ── 2027 R2 projection engine — drives winner badge in scoreboard ──
  const r2027R2Reporting = useMemo(() => {
    const totalVotes = Object.values(PROV_2023R2_TOTALS).reduce((s, v) => s + v, 0);
    let reportedVotes = 0;
    const tally: Record<string, number> = {};
    for (const [code, r] of Object.entries(overrides['2027R2'])) {
      const provTotal = PROV_2023R2_TOTALS[code] ?? 0;
      const frac = projected2027R2.has(code) ? 1 : (simBatchFractionsR2[code] ?? 0);
      if (frac <= 0) continue;
      const deptSum = Object.values(r).reduce((s: number, v) => s + (v ?? 0), 0);
      if (deptSum > 0) {
        reportedVotes += (provTotal || deptSum) * frac;
        for (const [pid, v] of Object.entries(r)) {
          if ((v ?? 0) > 0) tally[pid] = (tally[pid] ?? 0) + (v as number) * frac;
        }
      }
    }
    const reportingPct = totalVotes > 0 ? reportedVotes / totalVotes : 0;
    const remainingVotes = Math.max(0, totalVotes - reportedVotes);
    const sorted = Object.entries(tally).sort(([, a], [, b]) => b - a);
    const projectedWinner = new Set<string>();
    const LOCK_SHARE = 0.65;
    if (sorted.length >= 2 && reportingPct >= 0.20) {
      const [p1id, p1votes] = sorted[0];
      const [, p2votes] = sorted[1];
      if (p1votes > p2votes + LOCK_SHARE * remainingVotes) projectedWinner.add(p1id);
    }
    return { reportingPct, projectedWinner };
  }, [overrides, projected2027R2, simBatchFractionsR2]);

  const panelAllIds = useMemo(() => {
    if (activeElection === '2023R1') return AR_CANDIDATES.map(c => c.id as string);
    if (activeElection === '2023R2') return ['MIL', 'MAS'];   // Milei vs Massa (balotaje)
    if (activeElection === '2027R1') return AR_2027_PARTIES.map(p => p.id as string).filter(id => !hiddenParty2027.has(id));
    // R2: only candidates officially projected to advance from R1 (empty until projections exist)
    return Array.from(r2027Reporting.projectedSet);
  }, [activeElection, hiddenParty2027, r2027Reporting]);

  const getCandInfo = useCallback((id: string): { name: string; color: string } => {
    if (activeElection.startsWith('2023')) {
      const cand = AR_CANDIDATE_MAP[id as ArCandidateId];
      return cand ? { name: cand.name, color: cand.color } : { name: id, color: '#888' };
    }
    const party = AR_2027_PARTY_MAP[id as Ar2027PartyId];
    if (!party) return { name: id, color: '#888' };
    return { name: picks2027[id] ?? party.candidates[0], color: party.color };
  }, [activeElection, picks2027]);

  const roundLabel = useMemo(() => {
    if (activeElection === '2023R1') return 'Round 1 · 22 Oct 2023';
    if (activeElection === '2023R2') return 'Round 2 · 19 Nov 2023';
    if (activeElection === '2027R1') return 'Round 1 · 2027';
    return 'Round 2 · 2027';
  }, [activeElection]);

  const handleDeptUpdate = useCallback((code: string, newResults: Partial<Record<string, number>>) => {
    setOverrides(prev => ({
      ...prev,
      [activeElection]: { ...prev[activeElection], [code]: newResults },
    }));
  }, [activeElection]);

  const handlePick2027 = useCallback((partyId: Ar2027PartyId, candidate: string) => {
    setPicks2027(prev => ({ ...prev, [partyId]: candidate }));
  }, []);

  const handleMultiSelect = useCallback((code: string) => {
    setSelectedDepts(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }, []);

  const handleUpdateMany = useCallback((updates: Record<string, Partial<Record<string, number>>>) => {
    setOverrides(prev => ({
      ...prev,
      [activeElection]: { ...prev[activeElection], ...updates },
    }));
  }, [activeElection]);

  const handleProjectMany = useCallback((codes: string[]) => {
    setProjected2027(prev => new Set([...prev, ...codes]));
  }, []);

  const getCandInfo2027 = useCallback((id: string): { name: string; color: string } => {
    const party = AR_2027_PARTY_MAP[id as Ar2027PartyId];
    if (!party) return { name: id, color: '#888' };
    return { name: picks2027[id] ?? party.candidates[0], color: party.color };
  }, [picks2027]);

  const stopSimulation = useCallback(() => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];
    setSimBatchFractions({});
    setSimBatchFractionsR2({});
    setSimState('idle');
  }, []);

  const resetArgentina2027 = useCallback(() => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];
    setSimState('idle');
    setSimBatchFractions({});
    setSimBatchFractionsR2({});
    setProjected2027(new Set());
    setProjected2027R2(new Set());
    setOverrides(prev => ({ ...prev, '2027R1': {}, '2027R2': {} }));
    setActiveElection('2027R1');
    setShow2023Ref(false);
    setShow2027R1Ref(false);
  }, []);

  const runR1Simulation = useCallback((presets: Record<string, number>, duration: number) => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];

    const enabledIds = Object.keys(presets);
    setProjected2027(new Set());
    setProjected2027R2(new Set());
    setActiveElection('2027R1');

    const r1Results = simulateArgentinaR1(presets, enabledIds);
    r1ResultsRef.current = r1Results;

    // Derive top 2 from R1 national totals for display
    const r1NatTotals: Record<string, number> = {};
    for (const r of Object.values(r1Results)) {
      for (const [pid, v] of Object.entries(r)) {
        if ((v as number) > 0) r1NatTotals[pid] = (r1NatTotals[pid] ?? 0) + (v as number);
      }
    }
    const grandTotal = Object.values(r1NatTotals).reduce((s, v) => s + v, 0);
    const sortedR1 = Object.entries(r1NatTotals).sort(([, a], [, b]) => b - a);
    const top2Ids: [string, string] = [sortedR1[0]?.[0] ?? '', sortedR1[1]?.[0] ?? ''];
    const top2Pcts: [number, number] = [
      grandTotal > 0 ? (r1NatTotals[top2Ids[0]] ?? 0) / grandTotal * 100 : 0,
      grandTotal > 0 ? (r1NatTotals[top2Ids[1]] ?? 0) / grandTotal * 100 : 0,
    ];

    setOverrides(prev => ({ ...prev, '2027R1': { ...prev['2027R1'], ...r1Results } }));
    setSimBatchFractions({});

    const BATCHES = 10;
    const deptCodesR1 = Object.keys(PROV_2023R1_TOTALS);
    const totalMs = duration * 1000;

    setSimState('r1_running');
    setSimProgress(0);
    setSimTotal(deptCodesR1.length);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let r1Declared = 0;

    for (const code of deptCodesR1) {
      // Random cumulative fractions for 10 batches
      const cuts = [0, ...Array.from({length: BATCHES - 1}, () => Math.random()).sort((a,b)=>a-b), 1];
      // Every province starts early, batches land randomly over the full duration
      const batchTimes = arProvBatchTimes(totalMs);

      for (let b = 0; b < BATCHES; b++) {
        const cumFrac = cuts[b + 1];
        const isLast  = b === BATCHES - 1;
        timers.push(setTimeout(() => {
          if (isLast) {
            setSimBatchFractions(prev => ({ ...prev, [code]: 1 }));
            setProjected2027(prev => new Set([...prev, code]));
            r1Declared++;
            setSimProgress(r1Declared);
          } else {
            setSimBatchFractions(prev => ({ ...prev, [code]: cumFrac }));
          }
        }, batchTimes[b]));
      }
    }

    // After all provinces finish: apply Argentina's win rule.
    // No extra delay — fires right after the last batch.
    timers.push(setTimeout(() => {
      const r1Lead = top2Pcts[0] - top2Pcts[1];
      if (top2Pcts[0] > 45 || (top2Pcts[0] > 40 && r1Lead >= 10)) {
        setSimR1WinnerId(top2Ids[0]);
        setSimR1Pcts([top2Pcts[0], top2Pcts[1]]);
        setWinnerOverlayDismissed(false);
        setSimState('r1_winner');
      } else {
        setR2AwaitCandidates(top2Ids);
        setR2AwaitR1Pcts(top2Pcts);
        setSimState('r2_input');
      }
      setShowSimPanel(true);
    }, totalMs + 200));

    simTimersRef.current = timers;
  }, []);

  const runR2Simulation = useCallback((pcts: [number, number], duration: number) => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];

    const r2Results = simulateArgentinaR2WithTarget(r1ResultsRef.current, r2AwaitCandidates, pcts);
    setOverrides(prev => ({ ...prev, '2027R2': { ...prev['2027R2'], ...r2Results } }));
    setSimBatchFractionsR2({});

    const BATCHES = 10;
    const deptCodesR2 = Object.keys(PROV_2023R2_TOTALS);
    const totalMs = duration * 1000;

    setActiveElection('2027R2');
    setSimState('r2_running');
    setSimProgress(0);
    setSimTotal(deptCodesR2.length);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let r2Declared = 0;

    for (const code of deptCodesR2) {
      const cuts = [0, ...Array.from({length: BATCHES - 1}, () => Math.random()).sort((a,b)=>a-b), 1];
      const batchTimes = arProvBatchTimes(totalMs);

      for (let b = 0; b < BATCHES; b++) {
        const cumFrac = cuts[b + 1];
        const isLast  = b === BATCHES - 1;
        timers.push(setTimeout(() => {
          if (isLast) {
            setSimBatchFractionsR2(prev => ({ ...prev, [code]: 1 }));
            setProjected2027R2(prev => new Set([...prev, code]));
            r2Declared++;
            setSimProgress(r2Declared);
          } else {
            setSimBatchFractionsR2(prev => ({ ...prev, [code]: cumFrac }));
          }
        }, batchTimes[b]));
      }
    }

    timers.push(setTimeout(() => setSimState('idle'), totalMs + 200));
    simTimersRef.current = timers;
  }, [r2AwaitCandidates]);

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

  const btnBase     = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnMuted    = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnGold     = `${btnBase} bg-gold text-white hover:bg-gold-deep`;

  const isSimRunning = simState === 'r1_running' || simState === 'r2_running';

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="fr">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>

        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        {/* Scrollable control strip */}
        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => { setActiveElection('2023R1'); setOverrides(p => ({...p,'2023R1':{}})); setSelectedDept(null); }} disabled={isSimRunning} className={activeElection === '2023R1' ? btnGold : btnMuted}>2023 R1</button>
          <button onClick={() => { setActiveElection('2023R2'); setOverrides(p => ({...p,'2023R2':{}})); setSelectedDept(null); }} disabled={isSimRunning} className={activeElection === '2023R2' ? btnGold : btnMuted}>2023 R2</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-1" />
          {/* 2027 connected pair */}
          <div className="flex items-stretch shrink-0">
            <button
              onClick={() => setActiveElection('2027R1')}
              className={`h-7 pl-3 pr-2 text-[11px] font-mono font-medium rounded-l-[4px] rounded-r-none border border-r-0 tracking-wide uppercase transition-colors duration-75 ${activeElection === '2027R1' ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}
            >2027 R1</button>
            <div className={`flex items-center justify-center w-5 border-y ${activeElection.startsWith('2027') ? 'bg-[#2563EB]/10 border-[#2563EB]' : 'bg-[#f5f4f0] border-default'}`}>
              <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                <path d="M0.5 3h5M4 1l2.5 2L4 5" stroke={activeElection.startsWith('2027') ? '#2563EB' : '#9ca3af'} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <button
              onClick={() => setActiveElection('2027R2')}
              className={`h-7 pl-2 pr-3 text-[11px] font-mono font-medium rounded-r-[4px] rounded-l-none border border-l-0 tracking-wide uppercase transition-colors duration-75 ${activeElection === '2027R2' ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}
            >R2</button>
          </div>
          <button
            onClick={resetArgentina2027}
            title="Reset all 2027 results"
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors shrink-0"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-4.13"/>
            </svg>
          </button>
          {activeElection === '2027R1' && (
            <button
              className={btnMuted}
              disabled={isSimRunning}
              title="Show / hide parties"
              onClick={e => { e.stopPropagation(); setShowPartyFilter(v => !v); }}
            >
              Parties
            </button>
          )}
          {activeElection.startsWith('2027') && (
            <button
              className={`${btnBase} flex items-center gap-1.5 ${showSimPanel ? 'bg-[#7C3AED] text-white border border-[#7C3AED]' : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'}`}
              onClick={() => setShowSimPanel(v => !v)}
            >
              <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor" aria-hidden="true">
                <path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/>
              </svg>
              Simulation
            </button>
          )}
          {isSimRunning && (
            <div className="flex items-center gap-1.5 px-2.5 h-7 rounded-[4px] bg-red-600 text-white select-none shrink-0" style={{animation:'none'}}>
              <span style={{
                display:'inline-block', width:7, height:7, borderRadius:'50%',
                background:'#fff', animation:'ar-live-blink 0.9s ease-in-out infinite',
              }}/>
              <span className="text-[11px] font-mono font-bold tracking-widest uppercase">Live</span>
            </div>
          )}
          <button
            disabled={isSimRunning}
            className={multiSelectMode
              ? `${btnBase} bg-[#2563EB] text-white border border-[#2563EB]`
              : btnMuted}
            title={multiSelectMode ? 'Exit multi-select' : 'Select multiple provinces'}
            onClick={() => {
              if (multiSelectMode) {
                setMultiSelectMode(false);
                setSelectedDepts(new Set());
              } else {
                setMultiSelectMode(true);
                setSelectedDept(null);
              }
            }}
          >
            {multiSelectMode ? 'Exit Select' : 'Multi-Select'}
          </button>
          <button
            className={summaryOpen ? `${btnBase} bg-ink/8 border border-default text-ink` : btnMuted}
            onClick={() => setSummaryOpen(v => !v)}
            title="Regional summary"
          >
            Summary
          </button>
          <button
            className={bubbleMapMode
              ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700`
              : btnMuted}
            onClick={() => setBubbleMapMode(v => !v)}
            title="Toggle bubble margin map"
          >
            Bubble Map
          </button>
          <button
            onClick={() => {
              if (tutorialOpen) {
                setTutorialExiting(true);
                setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280);
              } else { setTutorialOpen(true); }
            }}
            className={tutorialOpen ? `${btnBase} bg-ink/8 border border-default text-ink` : btnMuted}
            title="How to play"
          >Tutorial</button>
        </div>

        {/* Right controls */}
        <div className="shrink-0 flex items-center gap-2.5 pr-4">

          <button
            onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Light mode' : 'Dark mode'}
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

      {/* ── Scoreboard (collapsible) ─────────────────────────────────── */}
      <div className="relative shrink-0">
        <div style={{
          display: 'grid',
          gridTemplateRows: scoreboardVisible ? '1fr' : '0fr',
          transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)',
        }}>
          <div className="overflow-hidden">
            {activeElection.startsWith('2023') ? (
              <ArgentinaScoreboard deptResults={deptResults} round={activeElection === '2023R1' ? 1 : 2} />
            ) : (
              <Ar2027Scoreboard
                deptResults={deptResults}
                election={activeElection as '2027R1' | '2027R2'}
                allPartyIds={panelAllIds}
                picks={picks2027}
                onPick={handlePick2027}
                projectedAdvancers={
                  simState === 'r1_winner' && simR1WinnerId
                    ? new Set([simR1WinnerId])
                    : activeElection === '2027R1' ? r2027Reporting.projectedSet
                    : activeElection === '2027R2' ? r2027R2Reporting.projectedWinner
                    : undefined
                }
              />
            )}
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

      {/* ── Map + panel row ──────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">
        {summaryOpen && (
          <ArSummaryPanel
            deptResults={deptResults}
            getCandInfo={getCandInfo}
            roundLabel={roundLabel}
            onClose={() => setSummaryOpen(false)}
          />
        )}
        <div className="flex-1 min-w-0 relative">

          {/* Party filter panel — anchored to top-left of map */}
          {showPartyFilter && activeElection === '2027R1' && (
            <div
              ref={partyFilterRef}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[500] bg-white rounded-[10px] overflow-hidden"
              style={{ width: 256, boxShadow: '0 8px 32px rgba(0,0,0,0.16),0 0 0 1px rgba(0,0,0,0.07)' }}
            >
              <div className="px-3 pt-2.5 pb-2 border-b border-default flex items-center justify-between">
                <span className="text-[11px] font-bold text-ink uppercase tracking-wider">2027 Parties</span>
                <div className="flex items-center gap-2">
                  <button className="text-[9px] font-mono text-ink-3 hover:text-ink transition-colors" onClick={() => setHiddenParty2027(new Set())}>All</button>
                  <button className="text-[9px] font-mono text-ink-3 hover:text-ink transition-colors" onClick={() => setHiddenParty2027(new Set(AR_2027_PARTIES.map(p => p.id)))}>None</button>
                  <button className="w-5 h-5 flex items-center justify-center rounded-[3px] text-ink-3 hover:bg-hover hover:text-ink transition-colors text-base leading-none" onClick={() => setShowPartyFilter(false)}>×</button>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto py-1 thin-scroll">
                {AR_2027_PARTIES.map(party => {
                  const visible = !hiddenParty2027.has(party.id);
                  return (
                    <button
                      key={party.id}
                      onClick={() => setHiddenParty2027(prev => { const next = new Set(prev); if (next.has(party.id)) next.delete(party.id); else next.add(party.id); return next; })}
                      className="w-full flex items-center gap-2.5 px-3 py-[5px] hover:bg-hover transition-colors text-left"
                    >
                      <span className="w-3.5 h-3.5 rounded-[3px] shrink-0 flex items-center justify-center transition-colors"
                        style={{ background: visible ? party.color : 'transparent', border: `1.5px solid ${party.color}` }}>
                        {visible && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      <span className="font-mono text-[9px] text-ink-3 shrink-0 w-6">{party.id}</span>
                      <span className="text-[10.5px] text-ink flex-1 truncate" style={{ opacity: visible ? 1 : 0.45 }}>{picks2027[party.id] ?? party.candidates[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* R2 empty state — shown when no R1 projections exist yet */}
          {activeElection === '2027R2' && panelAllIds.length === 0 && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none">
              <div className="bg-white/92 backdrop-blur-sm rounded-[14px] px-8 py-6 text-center max-w-sm"
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.13),0 0 0 1px rgba(0,0,0,0.06)' }}>
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" className="mx-auto mb-3" aria-hidden="true">
                  <circle cx="18" cy="18" r="17" stroke="#d1d5db" strokeWidth="1.5" fill="none"/>
                  <path d="M12 18h12M18 12v12" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <div className="text-[14px] font-bold text-ink mb-1.5 tracking-tight">No R1 projections yet</div>
                <div className="text-[11px] text-ink-3 font-mono leading-relaxed">
                  Project Round 1 provinces to see<br/>which candidates advance to Round 2.
                </div>
              </div>
            </div>
          )}

          {/* Multi-select floating bar */}
          {multiSelectMode && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[600] flex items-center gap-2 px-3.5 py-2 rounded-full select-none"
              style={{ background: 'rgba(15,15,20,0.88)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 16px rgba(0,0,0,0.35)' }}>
              <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-pulse shrink-0" />
              <span className="text-[11px] font-mono text-white/90">
                {selectedDepts.size > 0 ? `${selectedDepts.size} dept${selectedDepts.size !== 1 ? 's' : ''} selected` : 'Click depts to select'}
              </span>
              {selectedDepts.size > 0 && (
                <button
                  onClick={() => setSelectedDepts(new Set())}
                  className="text-[10px] font-mono text-white/50 hover:text-white/90 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <ArgentinaMapView
            deptResults={deptResults}
            getCandInfo={getCandInfo}
            selectedCode={multiSelectMode ? null : (selectedDept?.code ?? null)}
            onSelect={setSelectedDept}
            reportingPct={
              activeElection === '2027R1' ? r2027Reporting.reportingPct
              : activeElection === '2027R2' ? r2027R2Reporting.reportingPct
              : undefined
            }
            reportingLabel={activeElection === '2027R1' ? '2027 R1 Reporting' : '2027 R2 Reporting'}
            reportingDepts={
              activeElection === '2027R1' ? projected2027.size
              : activeElection === '2027R2' ? projected2027R2.size
              : undefined
            }
            reportingTotal={
              activeElection === '2027R1' ? Object.keys(PROV_2023R1_TOTALS).length
              : activeElection === '2027R2' ? Object.keys(PROV_2023R2_TOTALS).length
              : undefined
            }
            multiSelectMode={multiSelectMode}
            selectedCodes={selectedDepts}
            onMultiSelect={handleMultiSelect}
            bubbleMapMode={bubbleMapMode}
            simBatchFractions={
              activeElection === '2027R1' ? simBatchFractions
              : activeElection === '2027R2' ? simBatchFractionsR2
              : undefined
            }
            dark={dark}
          />
        </div>
        {showSimPanel ? (
          <ArSimulationPanel
            enabledIds={AR_2027_PARTIES.filter(p => !hiddenParty2027.has(p.id)).map(p => p.id)}
            getCandInfo={getCandInfo2027}
            simState={simState}
            r2Candidates={r2AwaitCandidates}
            r2CandR1Pcts={r2AwaitR1Pcts}
            simProgress={simProgress}
            simTotal={simTotal}
            onRunR1={runR1Simulation}
            onRunR2={runR2Simulation}
            onStop={stopSimulation}
            onClose={() => setShowSimPanel(false)}
          />
        ) : multiSelectMode ? (
          selectedDepts.size > 0 && (
            <ArMultiSelectPanel
              selectedDepts={selectedDepts}
              workingDeptResults={workingDeptResults}
              allIds={panelAllIds}
              getCandInfo={getCandInfo}
              activeElection={activeElection}
              projected2027={projected2027}
              onUpdateMany={handleUpdateMany}
              onProjectMany={handleProjectMany}
            />
          )
        ) : (
          selectedDept && (
            <>
              {show2027R1Ref && activeElection === '2027R2' && (
                <Ar2023RefPanel
                  dept={selectedDept}
                  results={overrides['2027R1'][selectedDept.code] ?? {}}
                  label="2027 Round 1 Results"
                  getCandInfo={getCandInfo2027}
                  onClose={() => setShow2027R1Ref(false)}
                />
              )}
              {show2023Ref && (
                <Ar2023RefPanel
                  dept={selectedDept}
                  results={
                    activeElection === '2027R2'
                      ? (ARGENTINA_2023_R2[selectedDept.code] ?? {})
                      : ((ARGENTINA_2023_R1 as Record<string, Partial<Record<string, number>>>)[selectedDept.code] ?? {})
                  }
                  label={activeElection === '2027R2' ? '2023 R2 Official' : '2023 R1 Official'}
                  onClose={() => setShow2023Ref(false)}
                />
              )}
              <ProvincePanel
                dept={selectedDept}
                results={workingDeptResults[selectedDept.code] ?? {}}
                allIds={panelAllIds}
                getCandInfo={getCandInfo}
                roundLabel={roundLabel}
                onClose={() => setSelectedDept(null)}
                onUpdate={handleDeptUpdate}
                fixedTotal={
                  activeElection === '2027R1' ? PROV_2023R1_TOTALS[selectedDept.code]
                  : activeElection === '2027R2' ? PROV_2023R2_TOTALS[selectedDept.code]
                  : undefined
                }
                isProjected={
                  activeElection === '2027R1' ? projected2027.has(selectedDept.code)
                  : activeElection === '2027R2' ? projected2027R2.has(selectedDept.code)
                  : undefined
                }
                onProject={
                  activeElection === '2027R1' ? (code) => setProjected2027(prev => new Set([...prev, code]))
                  : activeElection === '2027R2' ? (code) => setProjected2027R2(prev => new Set([...prev, code]))
                  : undefined
                }
                show2023Ref={show2023Ref}
                onToggle2023Ref={
                  activeElection === '2027R1' || activeElection === '2027R2'
                    ? () => setShow2023Ref(v => !v)
                    : undefined
                }
                refPanelLabel={activeElection === '2027R2' ? '2023 R2' : '2023 R1'}
                showR1Ref={show2027R1Ref}
                onToggleR1Ref={
                  activeElection === '2027R2'
                    ? () => setShow2027R1Ref(v => !v)
                    : undefined
                }
                dark={dark}
              />
            </>
          )
        )}
        {(tutorialOpen || tutorialExiting) && (
          <ArTutorialPanel
            onClose={() => { setTutorialExiting(true); setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280); }}
            exiting={tutorialExiting}
          />
        )}
      </div>

      {/* Branding stamp */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
        <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — Presidential Edition</span>
        <span className="text-[10px] text-white/40 font-mono">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
      </div>

      {/* ── R1 WINNER OVERLAY ────────────────────────────────────────── */}
      {simState === 'r1_winner' && simR1WinnerId && !winnerOverlayDismissed && createPortal(
        <ArR1WinnerOverlay
          winnerId={simR1WinnerId}
          winnerPct={simR1Pcts[0]}
          runnerUpPct={simR1Pcts[1]}
          getCandInfo={getCandInfo2027}
          onDismiss={() => setWinnerOverlayDismissed(true)}
        />,
        document.body
      )}
    </div>
  );
}

// ── R1 Winner fullscreen overlay ──────────────────────────────────────────────
function ArR1WinnerOverlay({
  winnerId, winnerPct, runnerUpPct, getCandInfo, onDismiss,
}: {
  winnerId: string;
  winnerPct: number;
  runnerUpPct: number;
  getCandInfo: (id: string) => { name: string; color: string };
  onDismiss: () => void;
}) {
  const info = getCandInfo(winnerId);
  const margin = winnerPct - runnerUpPct;
  // fetch winner photo
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    const party = AR_2027_PARTY_MAP[winnerId as Ar2027PartyId];
    const cand = party?.candidates[0] ?? winnerId;
    const title = AR_2027_WIKI_TITLES[cand] ?? cand.replace(/ /g, '_');
    let cancelled = false;
    fetchWikiPhoto(title).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [winnerId]);

  const c = info.color;
  // transparent dark scrim + colour wash from bottom
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)' }}
      onClick={onDismiss}
    >
      {/* stop propagation on card so only clicking outside dismisses */}
      <div
        onClick={e => e.stopPropagation()}
        className="relative flex flex-col items-center text-center px-10 py-10 rounded-[24px] max-w-[480px] w-full mx-4"
        style={{
          background: `linear-gradient(170deg, rgba(18,22,38,0.97) 0%, ${c}22 100%)`,
          border: `2px solid ${c}55`,
          boxShadow: `0 0 80px ${c}44, 0 24px 60px rgba(0,0,0,0.6)`,
        }}
      >
        {/* confetti-style accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 rounded-t-[22px]" style={{ background: c }} />

        {/* ROUND 1 WINNER label */}
        <div className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] mb-5" style={{ color: c }}>
          🇦🇷 Round 1 — Outright Winner
        </div>

        {/* Photo */}
        <div className="mb-5 relative">
          <div
            className="w-32 h-32 rounded-full overflow-hidden border-4 mx-auto"
            style={{ borderColor: c, boxShadow: `0 0 32px ${c}88` }}
          >
            {photoUrl
              ? <img src={photoUrl} alt={info.name} className="w-full h-full object-cover object-top" />
              : <div className="w-full h-full flex items-center justify-center text-[36px]"
                     style={{ background: `${c}22` }}>🇦🇷</div>
            }
          </div>
          {/* winner badge */}
          <div
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-mono font-bold text-white"
            style={{ background: c }}
          >
            ✓ ELECTED
          </div>
        </div>

        {/* Name */}
        <div className="text-[28px] font-black text-white leading-tight mb-1">{info.name}</div>
        <div className="text-[12px] font-mono text-white/50 mb-6">
          {AR_2027_PARTY_MAP[winnerId as Ar2027PartyId]?.name ?? ''}
        </div>

        {/* Vote stats */}
        <div className="flex gap-6 mb-8">
          <div className="flex flex-col items-center">
            <div className="text-[32px] font-black tabular-nums leading-none" style={{ color: c }}>
              {winnerPct.toFixed(1)}%
            </div>
            <div className="text-[10px] font-mono text-white/40 mt-1 uppercase tracking-wide">National vote</div>
          </div>
          <div className="w-px bg-white/10" />
          <div className="flex flex-col items-center">
            <div className="text-[32px] font-black tabular-nums leading-none text-white">
              +{margin.toFixed(1)}
            </div>
            <div className="text-[10px] font-mono text-white/40 mt-1 uppercase tracking-wide">Point margin</div>
          </div>
        </div>

        {/* Win condition note */}
        <div className="text-[10px] font-mono text-white/35 mb-8 leading-relaxed">
          {winnerPct > 45
            ? `Crossed the 45% threshold — no balotaje needed.`
            : `Over 40% with a ${margin.toFixed(1)}-point lead — no balotaje needed.`}
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="h-9 px-8 rounded-full text-[12px] font-mono font-bold uppercase tracking-wider text-white transition-all hover:opacity-80"
          style={{ background: c, boxShadow: `0 4px 20px ${c}66` }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
