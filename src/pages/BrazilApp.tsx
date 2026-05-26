import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON as ReactGeoJSON, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { BR_CANDIDATES, BR_CANDIDATE_MAP, BR_WIKI_TITLES } from '../data/brazilCandidates';
import type { BrCandidateId, BrCandidate } from '../data/brazilCandidates';
import { BR_2026_PARTIES, BR_2026_PARTY_MAP, BR_2026_WIKI_TITLES, BR_2026_LOCAL_PHOTOS, BR_IDEOLOGY_SCORE } from '../data/brazilCandidates';
import type { Br2026PartyId, Br2026Party } from '../data/brazilCandidates';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';
import { BRAZIL_2022_R1, STATE_2022R1_TOTALS } from '../data/brazil2022R1';
import { BRAZIL_2022_R2, STATE_2022R2_TOTALS } from '../data/brazil2022R2';

type ElectionKey = '2022R1' | '2022R2' | '2026R1' | '2026R2';

const BR_STATE_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá',
  BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco',
  PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina',
  SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};


const BR_REGIONS = [
  { id: 'Norte',       name: 'Norte',        states: ['AC','AM','AP','PA','RO','RR','TO'] },
  { id: 'Nordeste',    name: 'Nordeste',     states: ['AL','BA','CE','MA','PB','PE','PI','RN','SE'] },
  { id: 'CentroOeste', name: 'Centro-Oeste', states: ['DF','GO','MS','MT'] },
  { id: 'Sudeste',     name: 'Sudeste',      states: ['ES','MG','RJ','SP'] },
  { id: 'Sul',         name: 'Sul',          states: ['PR','RS','SC'] },
];

function getLastName(fullName: string): string {
  const parts = fullName.trim().split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] ?? fullName);
}

function stateFill(results: Partial<Record<string, number>>, getColor: (id: string) => string, dark = false): string {
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
  const lightness = dark ? 0.55 - t * (0.55 - 0.28) : 0.82 - t * (0.82 - 0.38);
  const c = hsl(baseColor);
  c.l = lightness;
  return c.formatHex();
}

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

// ── 2022 candidate tile ───────────────────────────────────────────────────────
interface BrCandTileProps {
  cand:    BrCandidate;
  votes:   number;
  votePct: number;
  isLeader: boolean;
  isWinner: boolean;
}

function BrCandTile({ cand, votes, votePct, isLeader, isWinner }: BrCandTileProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    const title = BR_WIKI_TITLES[cand.id];
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
      <div className="cand-pct"><span className="pct-number">{votePct.toFixed(1)}%</span></div>
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

// ── 2022 scoreboard ───────────────────────────────────────────────────────────
function BrazilScoreboard({ stateResults, round }: {
  stateResults: Record<string, Partial<Record<string, number>>>;
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
    const popularVote: Partial<Record<BrCandidateId, number>> = {};
    let grandTotal = 0;
    for (const r of Object.values(stateResults)) {
      for (const [cid, votes] of Object.entries(r)) {
        if ((votes ?? 0) > 0) {
          const id = cid as BrCandidateId;
          popularVote[id] = (popularVote[id] ?? 0) + (votes as number);
          grandTotal += (votes as number);
        }
      }
    }
    return { popularVote, grandTotal };
  }, [stateResults]);

  const allSorted = useMemo(() => [...BR_CANDIDATES]
    .filter(c => (popularVote[c.id] ?? 0) > 0)
    .sort((a, b) => (popularVote[b.id] ?? 0) - (popularVote[a.id] ?? 0)),
  [popularVote]);

  const sorted = round === 1 ? allSorted.filter(c => BR_R1_MAIN_IDS.has(c.id)) : allSorted;

  const othersVotes = round === 1
    ? BR_R1_OTHER_IDS.reduce((s, id) => s + (popularVote[id] ?? 0), 0)
    : 0;
  const othersPct = grandTotal > 0 ? (othersVotes / grandTotal) * 100 : 0;

  const topCandId = sorted[0]?.id;
  const winnerIds = useMemo<Set<BrCandidateId>>(() => {
    if (round === 2) return new Set(topCandId ? [topCandId] : []);
    if (grandTotal > 0) {
      const majority = allSorted.find(c => (popularVote[c.id] ?? 0) / grandTotal > 0.5);
      if (majority) return new Set([majority.id]);
    }
    return new Set(allSorted.slice(0, 2).map(c => c.id));
  }, [round, allSorted, topCandId, grandTotal, popularVote]);

  return (
    <div className="relative bg-white border-b border-default shrink-0 select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-1.5 mx-auto w-fit">
          {sorted.map(cand => {
            const votes   = popularVote[cand.id] ?? 0;
            const votePct = grandTotal > 0 ? (votes / grandTotal) * 100 : 0;
            return (
              <BrCandTile
                key={cand.id}
                cand={cand}
                votes={votes}
                votePct={votePct}
                isLeader={cand.id === topCandId}
                isWinner={winnerIds.has(cand.id)}
              />
            );
          })}
          {othersVotes > 0 && (
            <div className="cand-col"
              style={{ '--cand-color': '#6B7280', '--cand-color-alpha': 'rgba(107,114,128,0.11)', width: 'auto', minWidth: 90 } as React.CSSProperties}>
              <div>
                <div className="cand-circle-frame">
                  <span className="cand-initials" style={{ fontSize: 10, letterSpacing: '-0.03em' }}>+{BR_R1_OTHER_IDS.length}</span>
                </div>
              </div>
              <span className="cand-leader-name">Others</span>
              <div className="cand-party-name">{BR_R1_OTHER_IDS.length} candidates</div>
              <div className="cand-pct"><span className="pct-number">{othersPct.toFixed(1)}%</span></div>
              <div className="cand-votes">
                <span className="cand-votes-full">{othersVotes.toLocaleString()} votes</span>
                <span className="cand-votes-compact">{fmtVotes(othersVotes)} votes</span>
              </div>
              <div className="cand-bar-track">
                <div className="cand-bar-fill" style={{ width: `${Math.min(othersPct, 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Leader dropdown (for 2026 tiles) ─────────────────────────────────────────
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
      setPos({ top: openUpward ? r.top - 4 : r.bottom + 4, left: r.left + r.width / 2, upward: openUpward });
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
              left: pos.left, transform: 'translateX(-50%)',
              minWidth: 200, maxHeight: 300, overflowY: 'auto',
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

// ── 2026 party tile ───────────────────────────────────────────────────────────
interface Br2026CandTileProps {
  party:          Br2026Party;
  votes:          number;
  votePct:        number;
  isLeader:       boolean;
  isWinner:       boolean;
  isR1?:          boolean;
  pickedCandidate: string;
  onPick:         (partyId: Br2026PartyId, candidate: string) => void;
}

function Br2026CandTile({ party, votes, votePct, isLeader, isWinner, isR1, pickedCandidate, onPick }: Br2026CandTileProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    setPhotoUrl(null);
    const localPath = BR_2026_LOCAL_PHOTOS[pickedCandidate];
    if (localPath) {
      setPhotoUrl(`${import.meta.env.BASE_URL}${localPath}`);
      return;
    }
    const title = BR_2026_WIKI_TITLES[pickedCandidate];
    if (!title) return;
    let cancelled = false;
    fetchWikiPhoto(title).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [pickedCandidate]);

  const color       = party.color;
  const colorAlpha  = hexToRgba(color, 0.13);
  const initials    = pickedCandidate.trim().split(/\s+/).filter(Boolean).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2);
  const barPct      = Math.min(Math.max(votePct, 0), 100);
  const hasMultiple = party.candidates.length > 1;
  const lastName    = getLastName(pickedCandidate);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha, width: 'auto', minWidth: 90 } as React.CSSProperties}
    >
      <div id={`cand-photo-2026-${party.id}`}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={pickedCandidate} onError={() => setPhotoUrl(null)} />
            : <span className="cand-initials">{initials}</span>
          }
        </div>
        {isWinner && (
          isR1 ? (
            <span className="called-tick">
              <span className="animate-pulse" style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 14, borderRadius: 8, background: color,
                fontSize: '5.5px', fontWeight: 900, color: '#fff',
                fontFamily: 'ui-monospace, monospace', letterSpacing: '0.08em',
                textTransform: 'uppercase', whiteSpace: 'nowrap',
                boxShadow: `0 0 0 2px white, 0 0 0 3.5px ${color}`,
              }}>ADVANCE</span>
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
        <LeaderDropdown options={party.candidates} value={pickedCandidate} color={color} onChange={v => onPick(party.id, v)} />
      ) : (
        <span className="cand-leader-name" title={pickedCandidate}>{lastName}</span>
      )}
      <div className="cand-party-name" title={party.name}>
        <span className="font-mono" style={{ fontSize: '7px', color }}>{party.id}</span>
        {' '}{party.name}
      </div>
      <div className="cand-pct"><span className="pct-number">{votePct.toFixed(1)}%</span></div>
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

const BR_R1_MAIN_IDS = new Set<BrCandidateId>(['LUL', 'BOL', 'TEB', 'CIR']);
const BR_R1_OTHER_IDS: BrCandidateId[] = ['SOR', 'DAV', 'KEL', 'PER', 'SOF', 'VER', 'EYM'];

// ── Map helpers ───────────────────────────────────────────────────────────────
type StateInfo = { code: string; nom: string };

const BR_CENTROIDS: Record<string, [number, number]> = {
  AC: [-9.02,  -70.81], AL: [-9.57,  -36.78], AM: [-3.47,  -65.10], AP: [1.41,  -51.77],
  BA: [-12.96, -41.73], CE: [-5.50,  -39.32], DF: [-15.78, -47.93], ES: [-19.19, -40.34],
  GO: [-15.83, -49.61], MA: [-4.97,  -45.28], MG: [-18.51, -44.55], MS: [-20.51, -54.54],
  MT: [-12.96, -55.66], PA: [-3.79,  -52.48], PB: [-7.12,  -36.72], PE: [-8.38,  -37.86],
  PI: [-7.72,  -42.73], PR: [-24.89, -51.55], RJ: [-22.25, -42.66], RN: [-5.84,  -36.53],
  RO: [-11.22, -62.81], RR: [2.04,   -61.38], RS: [-29.68, -53.31], SC: [-27.25, -50.22],
  SE: [-10.57, -37.45], SP: [-22.28, -48.52], TO: [-10.18, -48.33],
};

// ── Map view ──────────────────────────────────────────────────────────────────
function BrMapView({
  stateResults, getCandInfo, selectedCode, onSelect,
  reportingPct, reportingLabel, reportingStates, reportingTotal,
  stateReportingPct, bubbleMode, dark, othersIds,
}: {
  stateResults: Record<string, Partial<Record<string, number>>>;
  getCandInfo: (id: string) => { name: string; color: string };
  selectedCode: string | null;
  onSelect: (s: StateInfo) => void;
  reportingPct?: number;
  reportingLabel?: string;
  reportingStates?: number;
  reportingTotal?: number;
  stateReportingPct?: Record<string, number>;
  bubbleMode?: boolean;
  dark?: boolean;
  othersIds?: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const geoLayerRef = useRef<L.GeoJSON | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [geojson, setGeojson] = useState<any>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; code: string; nom: string } | null>(null);

  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    fetch('/brazil-states.geojson').then(r => r.json()).then(setGeojson);
  }, []);

  // Re-style all polygons whenever results, selection, dark mode, or bubble mode change
  useEffect(() => {
    const layer = geoLayerRef.current;
    if (!layer) return;
    if (bubbleMode) {
      layer.setStyle(() => ({ fillColor: dark ? '#1e2d4a' : '#d1d5db', fillOpacity: 0.55, color: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)', weight: 1 }));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layer.setStyle((feature: any) => {
        const code = feature?.properties?.sigla as string;
        const r = stateResults[code] ?? {};
        const sel = code === selectedCode;
        return {
          fillColor: stateFill(r, id => getCandInfo(id).color, dark),
          fillOpacity: 0.82,
          color: sel ? '#c8a020' : (dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)'),
          weight: sel ? 2.5 : 1,
        };
      });
    }
  }, [stateResults, getCandInfo, selectedCode, dark, bubbleMode]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getStyle = useCallback((feature?: any): L.PathOptions => {
    const code = feature?.properties?.sigla as string;
    const r = stateResults[code] ?? {};
    const sel = code === selectedCode;
    return {
      fillColor: stateFill(r, id => getCandInfo(id).color, dark),
      fillOpacity: 0.82,
      color: sel ? '#c8a020' : (dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)'),
      weight: sel ? 2.5 : 1,
    };
  }, [stateResults, getCandInfo, selectedCode, dark]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const code = feature?.properties?.sigla as string;
    const nom = BR_STATE_NAMES[code] ?? code;
    layer.on('click', () => onSelectRef.current({ code, nom }));
    layer.on('mousemove', (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: (e as L.LeafletMouseEvent).originalEvent.clientX - rect.left,
        y: (e as L.LeafletMouseEvent).originalEvent.clientY - rect.top,
        code, nom,
      });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer
        center={[-14.5, -50]}
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
        {geojson && (
          <ReactGeoJSON
            data={geojson}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={bubbleMode ? (() => ({ fillColor: dark ? '#1e2d4a' : '#d1d5db', fillOpacity: 0.55, color: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)', weight: 1 })) as any : getStyle as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onEachFeature={onEachFeature as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={(layer: any) => { geoLayerRef.current = layer; }}
          />
        )}
        {bubbleMode && (() => {
          const maxTotal = Math.max(...Object.keys(BR_CENTROIDS).map(c => {
            const rv = stateResults[c] ?? {};
            return (Object.values(rv) as number[]).reduce((s, v) => s + (v ?? 0), 0);
          }), 1);
          return Object.entries(BR_CENTROIDS).map(([code, [lat, lng]]) => {
          const r = stateResults[code] ?? {};
          const stateTotal = (Object.values(r) as number[]).reduce((s, v) => s + (v ?? 0), 0);
          const sortedR = (Object.entries(r) as [string, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
          const winnerId = sortedR[0]?.[0];
          const winnerColor = winnerId ? getCandInfo(winnerId).color : (dark ? '#4b5563' : '#9ca3af');
          const nom = BR_STATE_NAMES[code] ?? code;
          const radius = stateTotal > 0 ? 6 + (stateTotal / maxTotal) * 26 : 5;
          const sel = code === selectedCode;
          return (
            <CircleMarker
              key={code}
              center={[lat, lng]}
              radius={radius}
              pathOptions={{
                fillColor: winnerColor,
                fillOpacity: stateTotal > 0 ? 0.82 : 0.25,
                color: sel ? '#c8a020' : (dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.28)'),
                weight: sel ? 2.5 : 1.2,
              }}
              eventHandlers={{
                click: () => onSelectRef.current({ code, nom }),
                mousemove: (e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, code, nom });
                },
                mouseout: () => setTooltip(null),
              }}
            />
          );
        });
        })()}
      </MapContainer>

      {/* Reporting badge */}
      {reportingPct !== undefined && reportingPct > 0 && (
        <div className="absolute top-3 left-3 z-[1000] rounded-[10px] overflow-hidden select-none"
          style={{
            background: dark ? 'rgba(12,18,36,0.92)' : 'rgba(255,255,255,0.96)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'}`,
            boxShadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
            minWidth: 130,
          }}>
          <div className="px-3 pt-2.5 pb-2">
            <div className="text-[8px] font-mono uppercase tracking-[0.16em] mb-2"
              style={{ color: dark ? 'rgba(140,170,220,0.65)' : 'rgba(0,0,0,0.42)' }}>
              {reportingLabel ?? 'Reporting'}
            </div>
            <div className="flex items-baseline gap-1.5 mb-2.5">
              <span className="text-[34px] font-black leading-none tabular-nums"
                style={{ letterSpacing: '-0.02em', color: dark ? 'rgba(220,235,255,0.95)' : '#1a1a1a' }}>
                {(reportingPct * 100).toFixed(1)}
              </span>
              <span className="text-[16px] font-bold pb-1" style={{ color: dark ? 'rgba(180,205,240,0.75)' : '#4a4844' }}>%</span>
            </div>
            <div className="w-full h-[6px] rounded-full overflow-hidden mb-2.5"
              style={{ background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)' }}>
              <div className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${Math.min(reportingPct * 100, 100)}%`, background: 'linear-gradient(90deg,#009C3B 0%,#FFDF00 50%,#009C3B 100%)' }} />
            </div>
            {reportingStates !== undefined && reportingTotal !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-mono tabular-nums" style={{ color: dark ? 'rgba(140,170,220,0.65)' : undefined }}>
                  <span className="font-bold" style={{ color: dark ? 'rgba(220,235,255,0.9)' : '#1a1a1a' }}>{reportingStates}</span>
                  <span className={dark ? 'text-[rgba(140,170,220,0.65)]' : 'text-ink-3'}> / {reportingTotal} states</span>
                </span>
                <span className="text-[9px] font-mono font-semibold"
                  style={{ color: reportingStates >= reportingTotal ? '#34d399' : '#60a5fa' }}>
                  {reportingStates >= reportingTotal ? 'All in' : `${reportingTotal - reportingStates} to go`}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">
        Scroll to zoom · Drag to pan · Click to open
      </div>

      {/* Hover tooltip — mirrors what the state slider panel shows */}
      {tooltip && (() => {
        const r = stateResults[tooltip.code] ?? {};
        const othersSet = new Set(othersIds ?? []);

        // Separate slider-visible candidates from the "Others" bucket
        const mainEntries = (Object.entries(r) as [string, number | undefined][])
          .filter((e): e is [string, number] => (e[1] ?? 0) > 0 && !othersSet.has(e[0]))
          .sort(([, a], [, b]) => b - a);
        const othersTotal = othersIds
          ? (Object.entries(r) as [string, number | undefined][])
              .filter((e): e is [string, number] => (e[1] ?? 0) > 0 && othersSet.has(e[0]))
              .reduce((s, [, v]) => s + v, 0)
          : 0;
        // Build display rows — same grouping the slider panel uses
        const rows: Array<[string, number]> = [
          ...mainEntries,
          ...(othersTotal > 0 ? [['__others__', othersTotal] as [string, number]] : []),
        ];

        const total = rows.reduce((s, [, v]) => s + v, 0);
        const topPct = rows[0] ? (rows[0][1] / total) * 100 : 100;
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 240;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const stRptPct = stateReportingPct?.[tooltip.code];
        const isPartial = stRptPct !== undefined && stRptPct < 0.9995;
        const tt = {
          bg:    dark ? 'rgba(18,24,44,0.97)'          : 'rgba(255,255,255,0.98)',
          border:dark ? 'rgba(255,255,255,0.09)'        : 'rgba(0,0,0,0.08)',
          shadow:dark ? '0 8px 32px rgba(0,0,0,0.55)'  : '0 8px 32px rgba(0,0,0,0.13)',
          title: dark ? 'rgba(255,255,255,0.92)'        : 'rgba(0,0,0,0.85)',
          sub:   dark ? 'rgba(255,255,255,0.38)'        : 'rgba(0,0,0,0.40)',
          body:  dark ? 'rgba(255,255,255,0.82)'        : 'rgba(0,0,0,0.75)',
          muted: dark ? 'rgba(255,255,255,0.30)'        : 'rgba(0,0,0,0.38)',
          track: dark ? 'rgba(255,255,255,0.08)'        : 'rgba(0,0,0,0.06)',
          hint:  dark ? 'rgba(255,255,255,0.22)'        : 'rgba(0,0,0,0.28)',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: tt.shadow, padding: '10px 12px' }}>
              <div className="font-bold text-[12px] mb-0.5" style={{ color: tt.title }}>{tooltip.nom}</div>
              <div className="text-[9px] font-mono uppercase tracking-wide mb-2.5" style={{ color: tt.sub }}>
                {total > 0 ? total.toLocaleString() + ' votes' : 'No data'}
                {isPartial && (
                  <span className="ml-1.5 px-1 py-[1px] rounded-[3px] text-[8px] font-bold uppercase"
                    style={{ background: 'rgba(250,166,26,0.18)', color: '#FAA61A', letterSpacing: '0.06em' }}>
                    {(stRptPct * 100).toFixed(0)}% reporting
                  </span>
                )}
              </div>
              {rows.length > 0 ? rows.map(([id, votes]) => {
                const isOthers = id === '__others__';
                const info = isOthers
                  ? { name: `Others (${othersIds?.length ?? 0} candidates)`, color: '#6B7280' }
                  : getCandInfo(id);
                const pct  = total > 0 ? (votes / total) * 100 : 0;
                const barW = topPct > 0 ? (pct / topPct) * 100 : 0;
                return (
                  <div key={id} className="mb-2">
                    <div className="flex items-center gap-1.5 mb-[3px]">
                      <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: info.color }} />
                      <span className="flex-1 text-[9.5px] font-medium truncate leading-none" style={{ color: tt.body }}>{info.name}</span>
                      <span className="font-mono text-[10px] font-bold tabular-nums shrink-0" style={{ color: info.color }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-[4px] rounded-full overflow-hidden" style={{ background: tt.track }}>
                        <div className="h-full rounded-full" style={{ width: `${barW}%`, background: info.color }} />
                      </div>
                      <span className="font-mono text-[8px] tabular-nums shrink-0" style={{ color: tt.muted, minWidth: 48, textAlign: 'right' }}>{votes.toLocaleString()}</span>
                    </div>
                  </div>
                );
              }) : (
                <div className="text-[9.5px] font-mono" style={{ color: tt.muted }}>No results</div>
              )}
              {/* Link to slider panel */}
              <div className="mt-2 pt-2 flex items-center gap-1" style={{ borderTop: `1px solid ${tt.border}` }}>
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ color: tt.hint, flexShrink: 0 }}>
                  <path d="M1 4.5h7M5 2l2.5 2.5L5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[8px] font-mono uppercase tracking-[0.10em]" style={{ color: tt.hint }}>
                  Click state to open slider panel
                </span>
              </div>
            </div>
          </div>
        );
      })()}
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
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
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

// ── State panel (slider) ──────────────────────────────────────────────────────
function StatePanel({
  state, results, allIds, getCandInfo, roundLabel, onClose, onUpdate, fixedTotal, isProjected, onProject, showRefData, onToggleRef, refLabel, othersIds,
}: {
  state:      StateInfo;
  results:    Partial<Record<string, number>>;
  allIds:     string[];
  getCandInfo:(id: string) => { name: string; color: string };
  roundLabel: string;
  onClose:    () => void;
  onUpdate:   (code: string, newResults: Partial<Record<string, number>>) => void;
  fixedTotal?: number;
  isProjected?: boolean;
  onProject?:  (code: string) => void;
  showRefData?: boolean;
  onToggleRef?: () => void;
  refLabel?:   string;
  othersIds?:  string[];
}) {
  const othersSet = useMemo(() => new Set(othersIds ?? []), [othersIds?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pcts, setPcts]           = useState<Record<string, number>>(() => toPcts(results, allIds));
  const [locks, setLocks]         = useState<Set<string>>(() => new Set(othersIds ?? []));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState('');

  const pctsRef  = useRef(pcts);
  const locksRef = useRef(locks);
  useEffect(() => { pctsRef.current  = pcts;  }, [pcts]);
  useEffect(() => { locksRef.current = locks; }, [locks]);

  useEffect(() => {
    setPcts(toPcts(results, allIds));
    setLocks(new Set(othersIds ?? []));
    setEditingId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.code, roundLabel]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => [...allIds].sort((a, b) => (results[b] ?? 0) - (results[a] ?? 0)), [allIds, state.code]);

  const total = useMemo(() => {
    const fromResults = allIds.reduce((s, id) => s + (results[id] ?? 0), 0);
    return (fixedTotal !== undefined && fixedTotal > 0) ? fixedTotal : fromResults;
  }, [allIds, results, fixedTotal]);

  const winnerId   = ids.length > 0 ? ids.reduce((best, id) => (pcts[id] ?? 0) > (pcts[best] ?? 0) ? id : best) : undefined;
  const winnerInfo = winnerId ? getCandInfo(winnerId) : null;
  const winnerPct  = winnerId ? (pcts[winnerId] ?? 0) : 0;
  const runnerUpId = ids.find(id => id !== winnerId);
  const margin     = runnerUpId ? winnerPct - (pcts[runnerUpId] ?? 0) : winnerPct;
  const liveVotes  = Object.fromEntries(ids.map(id => [id, Math.round((pcts[id] ?? 0) * total / 100)]));
  const previewFill = stateFill(liveVotes, id => getCandInfo(id).color);

  function applyChange(id: string, newVal: number) {
    const newPcts = redistributePcts(pctsRef.current, id, newVal, locksRef.current);
    pctsRef.current = newPcts;
    setPcts(newPcts);
    const newVotes = Object.fromEntries(ids.map(cid => [cid, Math.round((newPcts[cid] ?? 0) * total / 100)]));
    onUpdate(state.code, newVotes);
  }

  function toggleLock(id: string) {
    setLocks(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else { if (ids.filter(i => !next.has(i) && i !== id).length >= 1) next.add(id); }
      return next;
    });
  }

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight truncate">{state.nom}</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              State · {state.code} · {total.toLocaleString()} votes
            </p>
          </div>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink transition-colors shrink-0 text-base leading-none mt-0.5">×</button>
        </div>
        {winnerInfo && (
          <div className="mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: previewFill }} />
            <span className="text-[12px] font-semibold text-ink flex-1 truncate">{winnerInfo.name}</span>
            <span className="font-mono text-[11px] font-semibold text-ink-2">{winnerPct.toFixed(1)}%</span>
            <span className="text-[10px] font-mono text-ink-3">+{margin.toFixed(1)}</span>
          </div>
        )}
      </div>

      {isProjected !== undefined && (
        <div className="px-3.5 py-2 border-b border-default">
          {isProjected ? (
            <div className="flex items-center justify-center gap-1.5 h-8 text-[10.5px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[5px] tracking-wide uppercase select-none">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <circle cx="5.5" cy="5.5" r="5.5" fill="#059669"/>
                <path d="M2.5 5.5l2 2L8.5 3.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Projected
            </div>
          ) : (
            <button
              onClick={() => {
                const newVotes = Object.fromEntries(ids.map(id => [id, Math.round((pcts[id] ?? 0) * total / 100)]));
                onUpdate(state.code, newVotes);
                onProject?.(state.code);
              }}
              className="w-full h-8 text-[11px] font-mono font-bold rounded-[5px] bg-[#2563EB] text-white hover:bg-[#1d4ed8] active:bg-[#1e40af] transition-colors uppercase tracking-wide shadow-sm"
            >
              Project Result
            </button>
          )}
        </div>
      )}

      {onToggleRef && (
        <div className="px-3.5 py-1.5 border-b border-default">
          <button onClick={onToggleRef}
            className={`w-full h-7 text-[10px] font-mono rounded-[5px] transition-colors uppercase tracking-wide ${
              showRefData
                ? 'bg-[#f0f0f0] text-ink font-semibold border border-default'
                : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'
            }`}>
            {showRefData ? `← Hide ${refLabel ?? 'Ref'}` : `Show ${refLabel ?? 'Ref'} →`}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-3">
        <p className="text-[8.5px] font-mono uppercase tracking-wider text-ink-3">{roundLabel}</p>
        {ids.filter(id => !othersSet.has(id)).map(id => {
          const info      = getCandInfo(id);
          const pct       = pcts[id] ?? 0;
          const isLocked  = locks.has(id);
          const isEditing = editingId === id;
          const rawVotes  = Math.round(pct * total / 100);
          return (
            <div key={id}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: info.color }} />
                <span className="text-[10.5px] font-semibold text-ink flex-1 truncate leading-none">{info.name}</span>
                <button onClick={() => toggleLock(id)}
                  className={`shrink-0 w-[15px] h-[15px] flex items-center justify-center transition-colors ${isLocked ? '' : 'text-ink-3 hover:text-ink'}`}
                  style={isLocked ? { color: info.color } : {}} title={isLocked ? 'Unlock' : 'Lock'}>
                  {isLocked ? (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  ) : (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none" opacity="0.4"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  )}
                </button>
                {isEditing ? (
                  <input
                    className="w-[46px] text-right text-[10px] font-mono font-bold tabular-nums bg-transparent outline-none border-b shrink-0"
                    style={{ color: info.color, borderColor: `${info.color}88` }}
                    value={editingVal} autoFocus
                    onChange={e => setEditingVal(e.target.value)}
                    onBlur={() => { const n = parseFloat(editingVal); if (!isNaN(n)) applyChange(id, n); setEditingId(null); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { const n = parseFloat(editingVal); if (!isNaN(n)) applyChange(id, n); setEditingId(null); }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button onClick={() => { if (!isLocked) { setEditingId(id); setEditingVal(pct.toFixed(1)); } }}
                    className="text-[10.5px] font-mono font-bold tabular-nums shrink-0 min-w-[42px] text-right"
                    style={{ color: info.color, cursor: isLocked ? 'default' : 'text' }}
                    title={isLocked ? `Locked at ${pct.toFixed(1)}%` : 'Click to type %'}>
                    {pct.toFixed(1)}%
                  </button>
                )}
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(id, parseFloat(e.target.value))}
                className="br-party-slider w-full"
                style={{ '--party-color': info.color, '--pct': `${pct}%` } as React.CSSProperties} />
              <div className="flex justify-between mt-0.5">
                <span className="text-[8px] font-mono text-ink-3">{id}</span>
                <span className="text-[8.5px] font-mono tabular-nums text-ink-3">{rawVotes.toLocaleString()} votes</span>
              </div>
            </div>
          );
        })}
        {othersSet.size > 0 && (() => {
          const othersPct   = [...othersSet].reduce((s, id) => s + (pcts[id] ?? 0), 0);
          const othersVotes = Math.round(othersPct * total / 100);
          return (
            <div className="pt-1 border-t border-black/[0.07]">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full shrink-0 bg-[#6B7280]" />
                <span className="text-[10.5px] font-semibold text-ink-2 flex-1 truncate leading-none">
                  Others <span className="font-normal text-ink-3 text-[9px]">({othersSet.size} candidates)</span>
                </span>
                <span className="text-[10.5px] font-mono font-bold tabular-nums text-[#6B7280] shrink-0 min-w-[42px] text-right">{othersPct.toFixed(1)}%</span>
              </div>
              <div className="w-full h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
                <div className="h-full rounded-full bg-[#9CA3AF]" style={{ width: `${Math.min(othersPct, 100)}%` }} />
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[8px] font-mono text-ink-3">fixed</span>
                <span className="text-[8.5px] font-mono tabular-nums text-ink-3">{othersVotes.toLocaleString()} votes</span>
              </div>
            </div>
          );
        })()}
      </div>
      <div className="px-3.5 py-2 border-t border-default">
        <p className="text-[8px] font-mono text-ink-3 text-center uppercase tracking-wide">Drag slider · Click % to type · 🔒 to lock</p>
      </div>
    </aside>
  );
}

// ── Simulation helpers ────────────────────────────────────────────────────────
function brRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function brBellCurveTimes(n: number, totalMs: number): number[] {
  const mean = totalMs / 2;
  const std  = totalMs / 6;
  return Array.from({ length: n }, () =>
    Math.max(500, Math.min(totalMs - 200, Math.round(mean + std * brRandNormal())))
  ).sort((a, b) => a - b);
}

// Maps 2026 party to the closest 2022 R1 candidate for the baseline regional swing model
const BR_PARTY_2022_REF: Partial<Record<string, BrCandidateId>> = {
  PT:     'LUL', // Lula's own party — use Lula 2022 regional pattern
  PL:     'BOL', // Flávio carries his father's brand and voter base
  PSD:    'BOL', // Caiado is right-of-center, closer to Bolsonaro coalition
  NOVO:   'BOL', // Zema is libertarian-right
  MISSAO: 'TEB', // Renan Santos is center, closest to Tebet
  AVANTE: 'CIR', // Cury is center, closest to Ciro Gomes
};

// Per-candidate regional strength multipliers (applied on top of 2022 baseline swing)
// >1.0 = stronger than national avg in that state; <1.0 = weaker
// Sources: governor home-state bonuses, historical PT/PL regional patterns,
//          Caiado's GO agribusiness base, Zema's MG dominance, Cury's SP media reach
const BR_REGIONAL_BIAS: Partial<Record<string, Partial<Record<string, number>>>> = {

  // ── Lula da Silva (PT) ───────────────────────────────────────────────────────
  // PT's heartland is the Northeast; weakest in the South and agribusiness belt
  PT: {
    // Nordeste stronghold
    BA: 1.34, CE: 1.30, MA: 1.33, PI: 1.29, PB: 1.23, PE: 1.24,
    RN: 1.18, SE: 1.17, AL: 1.14,
    // Norte moderately strong
    PA: 1.19, AM: 1.13, AP: 1.08, TO: 1.08, RO: 0.97, RR: 0.91, AC: 0.93,
    // Sudeste — split: slight edge in MG/RJ, weak in SP/ES
    MG: 1.07, RJ: 1.01, ES: 0.91, SP: 0.88,
    // Sul — weakest region for PT
    PR: 0.74, RS: 0.67, SC: 0.62,
    // Centro-Oeste — agribusiness country, unfriendly to PT
    GO: 0.82, MT: 0.71, MS: 0.84, DF: 0.87,
  },

  // ── Flávio Bolsonaro (PL) ────────────────────────────────────────────────────
  // Carries father's brand: dominant in the South, strong in the agribusiness belt,
  // catastrophic in the Northeast — a mirror image of PT
  PL: {
    // Sul — father's strongest region
    RS: 1.33, SC: 1.38, PR: 1.28,
    // Sudeste — RJ is Bolsonaro family base; SP suburban belt
    RJ: 1.23, ES: 1.15, SP: 1.09, MG: 0.97,
    // Centro-Oeste — agribusiness + evangelical belt
    GO: 1.17, MT: 1.26, MS: 1.12, DF: 1.09,
    // Norte — strong in frontier states (RO, RR)
    RO: 1.26, RR: 1.33, AC: 1.11, TO: 0.93, PA: 0.83, AM: 0.87, AP: 0.90,
    // Nordeste — PT's heartland; PL's wasteland
    BA: 0.59, CE: 0.56, MA: 0.55, PI: 0.52, PB: 0.66,
    PE: 0.60, RN: 0.67, SE: 0.63, AL: 0.70,
  },

  // ── Ronaldo Caiado (PSD) ─────────────────────────────────────────────────────
  // Two-term governor of Goiás — massive home-state bonus; strong in the
  // agribusiness belt; weaker in the Northeast and Amazônia
  PSD: {
    // Centro-Oeste — Caiado's political home
    GO: 1.53, DF: 1.36, MS: 1.29, MT: 1.22,
    // Sudeste — agribusiness + SP business class
    MG: 1.16, SP: 1.12, ES: 1.09, RJ: 0.97,
    // Sul — right-of-center voters, competes with PL
    PR: 1.12, RS: 1.04, SC: 1.06,
    // Norte — less name recognition
    PA: 0.88, AM: 0.83, AP: 0.84, RO: 0.90, RR: 0.80, TO: 0.89, AC: 0.85,
    // Nordeste — weaker than PL there, but not as extreme
    BA: 0.79, CE: 0.74, MA: 0.75, PI: 0.71, PB: 0.79,
    PE: 0.77, RN: 0.77, SE: 0.77, AL: 0.81,
  },

  // ── Romeu Zema (NOVO) ────────────────────────────────────────────────────────
  // Two-term governor of Minas Gerais — enormous MG bonus; libertarian
  // economics resonates in DF, ES, SP; very weak where state capacity matters most
  NOVO: {
    // Sudeste — MG is his kingdom; SP financial class; ES business-friendly
    MG: 1.54, ES: 1.28, SP: 1.22, RJ: 1.06,
    // DF — libertarian economists, federal civil servants
    DF: 1.40,
    // Sul — libertarian-friendly voters
    PR: 1.26, RS: 1.32, SC: 1.30,
    // Centro-Oeste — moderate
    GO: 1.16, MT: 1.08, MS: 1.07,
    // Norte — very weak: state-dependent economies, less NOVO appeal
    PA: 0.77, AM: 0.70, AP: 0.72, RO: 0.80, RR: 0.68, TO: 0.78, AC: 0.72,
    // Nordeste — weakest region: social programs are popular, NOVO opposes them
    BA: 0.60, CE: 0.56, MA: 0.54, PI: 0.56, PB: 0.64,
    PE: 0.61, RN: 0.62, SE: 0.64, AL: 0.66,
  },

  // ── Renan Santos (Missão) ────────────────────────────────────────────────────
  // Religious-conservative centrist; strongest where evangelical Christianity
  // is dominant (Centro-Oeste interior, suburban Sul, interior SP)
  MISSAO: {
    // Evangelical belt / conservative interior
    GO: 1.20, DF: 1.16, MS: 1.13, PR: 1.16, SC: 1.14, RS: 1.08,
    // Sudeste large urban centers — evangelical megachurches
    SP: 1.14, MG: 1.10, RJ: 1.07, ES: 1.10,
    // Norte — mixed
    RO: 0.97, PA: 0.91, AM: 0.93, TO: 0.99, AC: 0.90, AP: 0.88, RR: 0.85,
    // Nordeste — moderate: Catholic-heavy, some evangelical growth
    BA: 0.89, CE: 0.87, MA: 0.89, PI: 0.88, PB: 0.91,
    PE: 0.90, RN: 0.91, SE: 0.91, AL: 0.90,
  },

  // ── Augusto Cury (Avante) ────────────────────────────────────────────────────
  // Bestselling psychiatrist/author with strong media presence in SP and RJ;
  // appeal is urban, educated, center; low name-rec in the interior and Norte
  AVANTE: {
    // Urban Sudeste — media market
    SP: 1.30, RJ: 1.20, MG: 1.14, ES: 1.09,
    // Sul — educated, center-leaning cities
    PR: 1.10, RS: 1.08, SC: 1.07,
    // DF — urban professionals
    GO: 1.07, DF: 1.11,
    // Norte — low media penetration
    RR: 0.79, AC: 0.81, AP: 0.82, RO: 0.85, AM: 0.84, TO: 0.87, PA: 0.88,
    // Nordeste — moderate name-rec, less center-elite appeal
    BA: 0.89, CE: 0.87, MA: 0.87, PI: 0.87, PB: 0.90,
    PE: 0.90, RN: 0.90, SE: 0.91, AL: 0.90,
  },
};

function simulateBrazilR1(
  presets: Record<string, number>,
  enabledIds: string[],
): Record<string, Partial<Record<string, number>>> {
  const nat2022: Record<string, number> = {};
  let nat2022Grand = 0;
  for (const dept of Object.values(BRAZIL_2022_R1)) {
    for (const [cid, v] of Object.entries(dept)) {
      if ((v ?? 0) > 0) { nat2022[cid] = (nat2022[cid] ?? 0) + (v as number); nat2022Grand += v as number; }
    }
  }

  const out: Record<string, Partial<Record<string, number>>> = {};
  for (const code of Object.keys(STATE_2022R1_TOTALS)) {
    const stateTotal = STATE_2022R1_TOTALS[code] ?? 0;
    if (stateTotal === 0) continue;
    const raw: Record<string, number> = {};
    for (const pid of enabledIds) {
      const preset   = presets[pid] ?? 0;
      const refCand  = BR_PARTY_2022_REF[pid];
      let ri = 1.0;
      if (refCand) {
        const dRef = (BRAZIL_2022_R1[code]?.[refCand] ?? 0);
        const dPct = stateTotal > 0 ? dRef / stateTotal : 0;
        const nPct = nat2022Grand > 0 ? (nat2022[refCand] ?? 0) / nat2022Grand : 0;
        ri = nPct > 0.001 ? Math.max(0.1, Math.min(4.0, dPct / nPct)) : 1.0;
      }
      const regionalBias = BR_REGIONAL_BIAS[pid]?.[code] ?? 1.0;
      raw[pid] = Math.max(0.001, preset * ri * regionalBias + brRandNormal() * 1.5);
    }
    const rawSum = Object.values(raw).reduce((s, v) => s + v, 0);
    const blended: Record<string, number> = {};
    for (const pid of enabledIds) {
      blended[pid] = 0.7 * ((raw[pid] ?? 0) * (rawSum > 0 ? 100 / rawSum : 0)) + 0.3 * (presets[pid] ?? 0);
    }
    const blendSum = Object.values(blended).reduce((s, v) => s + v, 0);
    const norm = blendSum > 0 ? 100 / blendSum : 0;
    const entries = enabledIds.map(pid => ({ pid, exact: (blended[pid] ?? 0) * norm * stateTotal / 100 }));
    const floors  = entries.map(e => ({ pid: e.pid, floor: Math.floor(e.exact), rem: e.exact % 1 }));
    let assigned  = floors.reduce((s, f) => s + f.floor, 0);
    floors.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < stateTotal - assigned; i++) floors[i].floor++;
    const r: Partial<Record<string, number>> = {};
    for (const { pid, floor } of floors) if (floor > 0) r[pid] = floor;
    out[code] = r;
  }
  return out;
}

// ── Brazil ideology groups & R2 transfer ─────────────────────────────────────
// G0: PSOL (0)  G1: PT/PDT (2-3)  G2: REDE (4)
// G3: MDB (6)   G4: PSD/UNIÃO (8-9)  G5: PP/NOVO/PL (10-12)
function brGroup(score: number): number {
  if (score <= 1) return 0;
  if (score <= 3) return 1;
  if (score <= 5) return 2;
  if (score <= 7) return 3;
  if (score <= 9) return 4;
  return 5;
}

// Transfer rates [toLeft, toRight] — left=lower ideology score candidate
// Calibrated from 2022 Brazilian R2 voter surveys (MDB endorsed Lula ~65%;
// PDT/REDE split ~60% Lula; PSD/UNIÃO ~35% Lula; PP/PL ~5% Lula)
const BR_TRANSFER: Record<string, [number, number]> = {
  // G0 (PSOL) vs G5 (PP/PL)
  '0-0-5': [0.97, 0.01], '1-0-5': [0.92, 0.03], '2-0-5': [0.72, 0.14],
  '3-0-5': [0.62, 0.20], '4-0-5': [0.30, 0.52], '5-0-5': [0.05, 0.93],
  // G1 (PT/PDT) vs G5
  '0-1-5': [0.96, 0.01], '1-1-5': [0.97, 0.01], '2-1-5': [0.65, 0.18],
  '3-1-5': [0.60, 0.22], '4-1-5': [0.28, 0.55], '5-1-5': [0.05, 0.93],
  // G2 (REDE) vs G5
  '0-2-5': [0.85, 0.05], '1-2-5': [0.75, 0.12], '2-2-5': [0.97, 0.01],
  '3-2-5': [0.68, 0.18], '4-2-5': [0.28, 0.55], '5-2-5': [0.06, 0.92],
  // G3 (MDB) vs G5
  '0-3-5': [0.80, 0.08], '1-3-5': [0.72, 0.12], '2-3-5': [0.68, 0.18],
  '3-3-5': [0.97, 0.01], '4-3-5': [0.38, 0.48], '5-3-5': [0.12, 0.85],
  // G4 (PSD/UNIÃO) vs G5
  '0-4-5': [0.55, 0.08], '1-4-5': [0.48, 0.12], '2-4-5': [0.62, 0.15],
  '3-4-5': [0.50, 0.30], '4-4-5': [0.97, 0.01], '5-4-5': [0.18, 0.80],
  // G0 vs G4
  '0-0-4': [0.90, 0.03], '1-0-4': [0.78, 0.08], '2-0-4': [0.58, 0.25],
  '3-0-4': [0.20, 0.68], '4-0-4': [0.05, 0.93], '5-0-4': [0.04, 0.62],
  // G1 vs G4
  '0-1-4': [0.88, 0.04], '1-1-4': [0.97, 0.01], '2-1-4': [0.50, 0.32],
  '3-1-4': [0.18, 0.68], '4-1-4': [0.05, 0.93], '5-1-4': [0.04, 0.65],
  // G2 vs G4
  '0-2-4': [0.82, 0.06], '1-2-4': [0.70, 0.12], '2-2-4': [0.97, 0.01],
  '3-2-4': [0.15, 0.78], '4-2-4': [0.06, 0.90], '5-2-4': [0.04, 0.58],
  // G3 vs G4
  '0-3-4': [0.62, 0.10], '1-3-4': [0.52, 0.15], '2-3-4': [0.65, 0.22],
  '3-3-4': [0.97, 0.01], '4-3-4': [0.20, 0.75], '5-3-4': [0.10, 0.80],
  // G0 vs G3
  '0-0-3': [0.97, 0.01], '1-0-3': [0.85, 0.06], '2-0-3': [0.55, 0.30],
  '3-0-3': [0.08, 0.90], '4-0-3': [0.05, 0.85], '5-0-3': [0.04, 0.60],
  // G1 vs G3
  '0-1-3': [0.85, 0.05], '1-1-3': [0.97, 0.01], '2-1-3': [0.45, 0.40],
  '3-1-3': [0.08, 0.88], '4-1-3': [0.05, 0.82], '5-1-3': [0.04, 0.55],
  // G2 vs G3
  '0-2-3': [0.82, 0.06], '1-2-3': [0.70, 0.12], '2-2-3': [0.97, 0.01],
  '3-2-3': [0.15, 0.82], '4-2-3': [0.06, 0.80], '5-2-3': [0.04, 0.58],
  // G0 vs G1
  '0-0-1': [0.97, 0.01], '1-0-1': [0.12, 0.85], '2-0-1': [0.38, 0.42],
  '3-0-1': [0.22, 0.30], '4-0-1': [0.10, 0.22], '5-0-1': [0.05, 0.15],
  // G0 vs G2
  '0-0-2': [0.97, 0.01], '1-0-2': [0.60, 0.28], '2-0-2': [0.15, 0.82],
  '3-0-2': [0.12, 0.68], '4-0-2': [0.05, 0.72], '5-0-2': [0.03, 0.45],
  // G1 vs G2
  '0-1-2': [0.75, 0.08], '1-1-2': [0.97, 0.01], '2-1-2': [0.28, 0.65],
  '3-1-2': [0.15, 0.68], '4-1-2': [0.05, 0.78], '5-1-2': [0.04, 0.52],
};

function brTransferFallback(voterScore: number, leftScore: number, rightScore: number): [number, number] {
  const dL = Math.abs(voterScore - leftScore);
  const dR = Math.abs(voterScore - rightScore);
  const tot = dL + dR || 1;
  const abstain = Math.min(0.55, Math.pow((dL + dR) / 2 / 12, 0.6) * 0.85);
  return [(1 - abstain) * (dR / tot), (1 - abstain) * (dL / tot)];
}

function simulateBrazilR2FromTransfers(
  r1Results: Record<string, Partial<Record<string, number>>>,
  r2Candidates: [string, string],
): Record<string, Partial<Record<string, number>>> {
  const [candA, candB] = r2Candidates;
  if (!candA || !candB) return {};
  const scoreA = BR_IDEOLOGY_SCORE[candA] ?? 6;
  const scoreB = BR_IDEOLOGY_SCORE[candB] ?? 6;
  const leftId    = scoreA <= scoreB ? candA : candB;
  const rightId   = scoreA <= scoreB ? candB : candA;
  const leftScore  = Math.min(scoreA, scoreB);
  const rightScore = Math.max(scoreA, scoreB);
  const leftGroup  = brGroup(leftScore);
  const rightGroup = brGroup(rightScore);

  const out: Record<string, Partial<Record<string, number>>> = {};
  for (const code of Object.keys(STATE_2022R2_TOTALS)) {
    const stateTotal = STATE_2022R2_TOTALS[code] ?? 0;
    if (stateTotal === 0) continue;
    const r1Dept  = r1Results[code] ?? {};
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
        const vs = BR_IDEOLOGY_SCORE[cid] ?? 6;
        const vg = brGroup(vs);
        const key = `${vg}-${leftGroup}-${rightGroup}`;
        const rates = BR_TRANSFER[key] ?? brTransferFallback(vs, leftScore, rightScore);
        [tL, tR] = rates;
      }
      toLeft  += frac * tL;
      toRight += frac * tR;
    }
    const active = toLeft + toRight;
    if (active <= 0) continue;
    const leftShare  = toLeft / active;
    const leftVotes  = Math.round(leftShare * stateTotal);
    const rightVotes = stateTotal - leftVotes;
    const r: Partial<Record<string, number>> = {};
    if (leftVotes  > 0) r[leftId]  = leftVotes;
    if (rightVotes > 0) r[rightId] = rightVotes;
    out[code] = r;
  }
  return out;
}

function simulateBrazilR2WithTarget(
  r1Results: Record<string, Partial<Record<string, number>>>,
  r2Candidates: [string, string],
  targetPcts: [number, number],
): Record<string, Partial<Record<string, number>>> {
  const raw = simulateBrazilR2FromTransfers(r1Results, r2Candidates);
  if (Object.keys(raw).length === 0) return raw;
  const [candA, candB] = r2Candidates;
  const scoreA = BR_IDEOLOGY_SCORE[candA] ?? 6;
  const scoreB = BR_IDEOLOGY_SCORE[candB] ?? 6;
  const leftId  = scoreA <= scoreB ? candA : candB;
  const rightId = scoreA <= scoreB ? candB : candA;
  const targetLeftPct = (scoreA <= scoreB ? targetPcts[0] : targetPcts[1]) / 100;
  let rawNatLeft = 0, rawNatRight = 0;
  for (const r of Object.values(raw)) {
    rawNatLeft  += r[leftId]  ?? 0;
    rawNatRight += r[rightId] ?? 0;
  }
  const rawNatTotal = rawNatLeft + rawNatRight;
  if (rawNatTotal === 0) return raw;
  const rawLeftPct = rawNatLeft / rawNatTotal;
  const out: Record<string, Partial<Record<string, number>>> = {};
  for (const code of Object.keys(STATE_2022R2_TOTALS)) {
    const stateTotal = STATE_2022R2_TOTALS[code] ?? 0;
    if (stateTotal === 0) continue;
    const r = raw[code];
    if (!r) continue;
    const dL = r[leftId]  ?? 0;
    const dR = r[rightId] ?? 0;
    if (dL + dR === 0) continue;
    const deviation  = dL / (dL + dR) - rawLeftPct;
    const adjLeft    = Math.max(0.01, Math.min(0.99, targetLeftPct + deviation));
    const leftVotes  = Math.round(stateTotal * adjLeft);
    const rightVotes = stateTotal - leftVotes;
    const dept: Partial<Record<string, number>> = {};
    if (leftVotes  > 0) dept[leftId]  = leftVotes;
    if (rightVotes > 0) dept[rightId] = rightVotes;
    out[code] = dept;
  }
  return out;
}

// ── Simulation panel ──────────────────────────────────────────────────────────
type SimState = 'idle' | 'r1_running' | 'r1_won' | 'r2_input' | 'r2_running';

function BrSimulationPanel({
  enabledIds, getCandInfo, simState, r2Candidates, r2CandR1Pcts,
  simProgress, simTotal, onRunR1, onRunR2, onStop, onReset, onClose,
}: {
  enabledIds:    string[];
  getCandInfo:   (id: string) => { name: string; color: string };
  simState:      SimState;
  r2Candidates:  [string, string];
  r2CandR1Pcts:  [number, number];
  simProgress:   number;
  simTotal:      number;
  onRunR1:       (presets: Record<string, number>, duration: number) => void;
  onRunR2:       (pcts: [number, number], duration: number) => void;
  onStop:        () => void;
  onReset:       () => void;
  onClose:       () => void;
}) {
  const parseN = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : Math.max(0, n); };
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

  const [r2Inputs, setR2Inputs] = useState(['', '']);
  useEffect(() => { setR2Inputs(['', '']); }, [r2Candidates[0], r2Candidates[1]]);
  const r2Total = parseN(r2Inputs[0]) + parseN(r2Inputs[1]);
  const r2Valid = r2Total >= 99.95 && r2Total <= 100.05;

  const isRunning  = simState === 'r1_running' || simState === 'r2_running';
  const phaseColor = simState === 'r2_running' ? '#7C3AED' : '#2563EB';
  const phaseLabel = simState === 'r2_running' ? 'Round 2' : 'Round 1';
  const r1WonInfo  = simState === 'r1_won' ? getCandInfo(r2Candidates[0]) : null;

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-bold text-ink leading-tight">Simulation</h1>
          <p className="text-[9.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
            {simState === 'r2_input' || simState === 'r2_running' ? 'Round 2 · 2026' : simState === 'r1_won' ? 'Winner Declared · R1' : '2026 Election Night'}
          </p>
        </div>
        <button onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2.5">
        <div className="tutorial-note rounded-[5px] px-2.5 py-2 text-[9px] font-mono leading-relaxed">
          <span className="font-bold">Realistic scenarios only.</span> This simulator uses real state-level data and regional swing modelling. Absurd inputs will produce meaningless projections — garbage in, garbage out.
        </div>

        {(simState === 'r2_input' || simState === 'r2_running') && (
          <>
            <div className="rounded-[6px] border border-[#7C3AED]/20 bg-[#7C3AED]/5 px-3 py-2.5">
              <p className="text-[9px] text-ink-2 leading-[1.5]">
                Round 1 is done. Enter your predicted Round 2 national percentages — geographic variation is modelled automatically.
              </p>
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
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">R2 National % — must total 100</div>
            {r2Candidates.map((id, i) => {
              const info = getCandInfo(id);
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: info.color }} />
                  <span className="flex-1 text-[10.5px] truncate text-ink font-medium">{info.name}</span>
                  <input type="number" min="0" max="100" step="0.1"
                    value={r2Inputs[i]} disabled={simState === 'r2_running'}
                    onChange={e => setR2Inputs(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                    className="w-16 h-6 border border-default rounded-[4px] text-right px-1.5 text-[10.5px] font-mono text-ink bg-white disabled:opacity-50 focus:outline-none focus:border-ink/30"
                    placeholder="0" />
                  <span className="text-[9.5px] font-mono text-ink-3">%</span>
                </div>
              );
            })}
          </>
        )}

        {simState === 'r1_won' && r1WonInfo && (
          <>
            <div className="rounded-[6px] border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <p className="text-[9px] text-emerald-700 leading-[1.5] font-semibold">
                First-round victory! A candidate crossed 50% — no runoff needed.
              </p>
            </div>
            <div className="rounded-[5px] border border-default bg-canvas px-3 py-4 flex flex-col items-center gap-2 text-center">
              <div className="w-4 h-4 rounded-full" style={{ background: r1WonInfo.color }} />
              <p className="text-[14px] font-bold text-ink leading-tight">{r1WonInfo.name}</p>
              <p className="text-[16px] font-mono font-bold tabular-nums" style={{ color: r1WonInfo.color }}>
                {r2CandR1Pcts[0].toFixed(1)}%
              </p>
              <p className="text-[8.5px] font-mono text-ink-3 uppercase tracking-widest">Round 1 Winner</p>
            </div>
          </>
        )}

        {(simState === 'idle' || simState === 'r1_running') && (
          <>
            <div className="rounded-[6px] border border-[#2563EB]/20 bg-[#2563EB]/5 px-3 py-2.5">
              <p className="text-[9px] text-ink-2 leading-[1.5]">
                Customize candidates via the <span className="font-bold text-ink">Parties</span> button. After Round 1 finishes you'll enter the Round 2 matchup.
              </p>
            </div>
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">R1 National % — must total 100</div>
            {enabledIds.map(id => {
              const info  = getCandInfo(id);
              const isTop2 = top2.some(t => t.id === id);
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: info.color }} />
                  <span className={`flex-1 text-[10.5px] truncate ${isTop2 && r1Valid ? 'font-semibold text-ink' : 'text-ink'}`}>{info.name}</span>
                  <input type="number" min="0" max="100" step="0.1"
                    value={r1Inputs[id] ?? ''} disabled={simState === 'r1_running'}
                    onChange={e => setR1Inputs(prev => ({ ...prev, [id]: e.target.value }))}
                    className="w-16 h-6 border border-default rounded-[4px] text-right px-1.5 text-[10.5px] font-mono text-ink bg-canvas disabled:opacity-50 focus:outline-none focus:border-ink/30"
                    placeholder="0" />
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

      <div className="px-3.5 py-3 border-t border-default space-y-2.5">
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
        {!isRunning && simState !== 'r1_won' && (
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
        {isRunning && (
          <div>
            <div className="flex justify-between text-[9.5px] font-mono mb-1">
              <span style={{ color: phaseColor }} className="font-semibold">{phaseLabel}</span>
              <span className="text-ink-3">{simProgress} / {simTotal} states</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#eae8e3] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${simTotal > 0 ? (simProgress / simTotal) * 100 : 0}%`, background: phaseColor }} />
            </div>
          </div>
        )}
        {simState === 'idle' && !r1Valid && r1Total > 0.05 && (
          <p className="text-[9.5px] font-mono text-red-500 text-center">Total must be exactly 100%</p>
        )}
        {simState === 'r2_input' && !r2Valid && r2Total > 0.05 && (
          <p className="text-[9.5px] font-mono text-red-500 text-center">Total must be exactly 100%</p>
        )}
        {isRunning && (
          <button onClick={onStop}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-[#B91C1C] text-white hover:bg-[#991B1B]">
            ⏹  Stop Simulation
          </button>
        )}
        {simState === 'idle' && (
          <button onClick={() => { if (!r1Valid || isRunning) return; const p: Record<string,number>={}; for (const id of enabledIds) p[id]=parseN(r1Inputs[id]??''); onRunR1(p, duration); }} disabled={!r1Valid}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-[#2563EB] text-white hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed">
            ▶  Run Round 1
          </button>
        )}
        {simState === 'r2_input' && (
          <button onClick={() => { if (!r2Valid || isRunning) return; onRunR2([parseN(r2Inputs[0]), parseN(r2Inputs[1])], duration); }} disabled={!r2Valid}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-[#7C3AED] text-white hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed">
            ▶  Run Round 2
          </button>
        )}
        {simState === 'r1_won' && (
          <button onClick={onReset}
            className="w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm bg-ink/10 text-ink hover:bg-ink/15">
            ↺  New Simulation
          </button>
        )}
      </div>
    </aside>
  );
}

// ── Reference panel ───────────────────────────────────────────────────────────
function BrRefPanel({ state, results, label, onClose, getCandInfo: getCandInfoProp }: {
  state:         StateInfo;
  results:       Partial<Record<string, number>>;
  label:         string;
  onClose:       () => void;
  getCandInfo?:  (id: string) => { name: string; color: string };
}) {
  const sorted = Object.entries(results)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  const resolveInfo = (id: string) => {
    if (getCandInfoProp) return getCandInfoProp(id);
    const cand = BR_CANDIDATE_MAP[id as BrCandidateId];
    return cand ? { name: getLastName(cand.name), color: cand.color } : null;
  };

  return (
    <aside className="w-52 shrink-0 bg-surface border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3 pt-3 pb-2.5 border-b border-default flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[12px] font-bold text-ink leading-tight truncate">{state.nom}</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{label}</p>
        </div>
        <button onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded-[3px] text-ink-3 hover:bg-hover hover:text-ink transition-colors shrink-0 text-sm leading-none mt-0.5">×</button>
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
                <span className="text-[9px] font-medium text-ink flex-1 truncate leading-none" style={{ fontWeight: i === 0 ? 600 : 400 }}>{info.name}</span>
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
          <span>Total</span><span className="tabular-nums">{total.toLocaleString()}</span>
        </div>
      </div>
    </aside>
  );
}

// ── Regional summary panel ────────────────────────────────────────────────────
function BrSummaryPanel({ stateResults, getCandInfo, roundLabel, onClose }: {
  stateResults: Record<string, Partial<Record<string, number>>>;
  getCandInfo:  (id: string) => { name: string; color: string };
  roundLabel:   string;
  onClose:      () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { natTotals, grandTotal } = useMemo(() => {
    const natTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const r of Object.values(stateResults)) {
      for (const [id, v] of Object.entries(r) as [string, number][]) {
        if ((v ?? 0) > 0) { natTotals[id] = (natTotals[id] ?? 0) + v; grandTotal += v; }
      }
    }
    return { natTotals, grandTotal };
  }, [stateResults]);

  const natSorted = useMemo(() =>
    (Object.entries(natTotals) as [string, number][]).sort(([, a], [, b]) => b - a),
  [natTotals]);

  const leader    = natSorted[0];
  const runnerUp  = natSorted[1];
  const leaderInfo    = leader   ? getCandInfo(leader[0])   : null;
  const runnerUpInfo  = runnerUp ? getCandInfo(runnerUp[0]) : null;
  const leaderPct    = leader   && grandTotal > 0 ? (leader[1]   / grandTotal) * 100 : 0;
  const runnerUpPct  = runnerUp && grandTotal > 0 ? (runnerUp[1] / grandTotal) * 100 : 0;
  const natMargin    = leaderPct - runnerUpPct;

  const { statesWon, closestState, biggestState } = useMemo(() => {
    const won: Record<string, number> = {};
    let closest = { code: '', margin: 999, name: '' };
    let biggest = { code: '', margin: 0,   name: '' };
    for (const [code, r] of Object.entries(stateResults)) {
      const ds = (Object.entries(r) as [string, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (!ds[0]) continue;
      won[ds[0][0]] = (won[ds[0][0]] ?? 0) + 1;
      const dt = ds.reduce((s, [, v]) => s + v, 0);
      if (dt === 0) continue;
      const m = ds[1] ? ((ds[0][1] - ds[1][1]) / dt) * 100 : 100;
      if (m < closest.margin) closest = { code, margin: m, name: BR_STATE_NAMES[code] ?? code };
      if (m > biggest.margin) biggest = { code, margin: m, name: BR_STATE_NAMES[code] ?? code };
    }
    return { statesWon: won, closestState: closest, biggestState: biggest };
  }, [stateResults]);

  const reportingStates = Object.values(stateResults).filter(r => Object.values(r).some(v => (v ?? 0) > 0)).length;

  const regionData = useMemo(() => BR_REGIONS.map(region => {
    const agg: Record<string, number> = {};
    let statesWith = 0;
    for (const code of region.states) {
      const r = stateResults[code] ?? {};
      if (Object.values(r).some(v => (v ?? 0) > 0)) statesWith++;
      for (const [pid, v] of Object.entries(r) as [string, number][])
        if ((v ?? 0) > 0) agg[pid] = (agg[pid] ?? 0) + v;
    }
    const sorted = (Object.entries(agg) as [string, number][]).sort(([, a], [, b]) => b - a);
    const total  = sorted.reduce((s, [, v]) => s + v, 0);
    const winner = sorted[0]; const runner = sorted[1];
    const info   = winner ? getCandInfo(winner[0]) : null;
    const pct    = winner && total > 0 ? (winner[1] / total) * 100 : 0;
    const margin = runner && total > 0 ? pct - (runner[1] / total) * 100 : pct;
    const stateData = region.states.map(code => {
      const r  = stateResults[code] ?? {};
      const ds = (Object.entries(r) as [string, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      const dt = ds.reduce((s, [, v]) => s + v, 0);
      const dW = ds[0]; const dI = dW ? getCandInfo(dW[0]) : null;
      const dPct = dW && dt > 0 ? (dW[1] / dt) * 100 : 0;
      const dMgn = ds[1] ? dPct - (ds[1][1] / dt) * 100 : dPct;
      return { code, name: BR_STATE_NAMES[code] ?? code, dI, dPct, dMgn, hasData: ds.length > 0 };
    });
    return { ...region, sorted, total, winner, info, pct, margin, statesWith, stateData };
  }), [stateResults, getCandInfo]);

  const totalStates = BR_REGIONS.reduce((s, r) => s + r.states.length, 0);

  function fmtM(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return n.toLocaleString();
  }

  const hasData = grandTotal > 0;

  return (
    <aside className="w-[296px] shrink-0 bg-white border-r border-default flex flex-col overflow-hidden z-10"
      style={{ boxShadow: '2px 0 18px rgba(0,0,0,0.09)' }}>

      {/* ── Header ── */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-default flex items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-[13.5px] font-bold text-ink leading-tight">Election Summary</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{roundLabel} · {reportingStates}/{totalStates} states reporting</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {hasData ? (
          <>
            {/* ── National vote share ── */}
            <div className="px-3.5 pt-3 pb-2.5">
              <p className="text-[7.5px] font-mono uppercase tracking-[0.16em] text-ink-3 mb-2.5">National Popular Vote</p>

              {/* Stacked bar */}
              <div className="flex w-full h-[22px] rounded-lg overflow-hidden mb-3" style={{ gap: 1.5 }}>
                {natSorted.map(([id, votes]) => {
                  const info = getCandInfo(id);
                  const w = (votes / grandTotal) * 100;
                  if (w < 0.4) return null;
                  return (
                    <div key={id} title={`${info.name}: ${w.toFixed(2)}%`}
                      style={{ width: `${w}%`, background: info.color, flexShrink: 0, minWidth: w > 1 ? 3 : 0 }} />
                  );
                })}
              </div>

              {/* Candidate rows */}
              <div className="space-y-[7px]">
                {natSorted.filter(([, v]) => v / grandTotal > 0.0005).map(([id, votes]) => {
                  const info = getCandInfo(id);
                  const pct  = (votes / grandTotal) * 100;
                  const barW = leaderPct > 0 ? (pct / leaderPct) * 100 : 0;
                  return (
                    <div key={id}>
                      <div className="flex items-center gap-1.5 mb-[3px]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: info.color }} />
                        <span className="flex-1 text-[9.5px] font-semibold text-ink truncate leading-none">{info.name}</span>
                        <span className="font-mono text-[10.5px] font-black tabular-nums shrink-0" style={{ color: info.color }}>{pct.toFixed(2)}%</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
                          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${barW}%`, background: info.color, opacity: 0.85 }} />
                        </div>
                        <span className="font-mono text-[8px] tabular-nums text-ink-3 shrink-0 w-9 text-right">{fmtM(votes)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Stat cards ── */}
            <div className="px-3 pb-3 grid grid-cols-2 gap-2">
              {/* Leader margin */}
              <div className="col-span-2 rounded-xl px-3 py-2.5 flex items-center gap-3"
                style={{ background: leaderInfo ? `${leaderInfo.color}18` : '#f5f5f5', border: `1px solid ${leaderInfo?.color ?? '#eee'}28` }}>
                <div>
                  <div className="font-mono text-[26px] font-black tabular-nums leading-none" style={{ color: leaderInfo?.color ?? '#888', letterSpacing: '-0.03em' }}>
                    +{natMargin.toFixed(2)}<span className="text-[14px]">%</span>
                  </div>
                  <div className="text-[7.5px] font-mono uppercase tracking-[0.12em] text-ink-3 mt-0.5">National lead margin</div>
                </div>
                <div className="flex-1 flex flex-col items-end gap-0.5">
                  {leaderInfo && <div className="text-[9px] font-semibold text-ink">{leaderInfo.name.split(' ').slice(-1)[0]}</div>}
                  {runnerUpInfo && <div className="text-[8px] font-mono text-ink-3">vs {runnerUpInfo.name.split(' ').slice(-1)[0]} {runnerUpPct.toFixed(1)}%</div>}
                </div>
              </div>

              {/* States won – leader */}
              <div className="rounded-xl px-3 py-2.5"
                style={{ background: leaderInfo ? `${leaderInfo.color}14` : '#f5f5f5', border: `1px solid ${leaderInfo?.color ?? '#eee'}22` }}>
                <div className="font-mono text-[28px] font-black leading-none tabular-nums" style={{ color: leaderInfo?.color ?? '#888' }}>
                  {statesWon[leader?.[0] ?? ''] ?? 0}
                </div>
                <div className="text-[7.5px] font-mono uppercase tracking-[0.1em] mt-0.5 leading-tight" style={{ color: leaderInfo?.color ?? '#888', opacity: 0.7 }}>
                  {leaderInfo?.name.split(' ').slice(-1)[0]} states
                </div>
              </div>

              {/* States won – runner-up */}
              <div className="rounded-xl px-3 py-2.5"
                style={{ background: runnerUpInfo ? `${runnerUpInfo.color}14` : '#f5f5f5', border: `1px solid ${runnerUpInfo?.color ?? '#eee'}22` }}>
                <div className="font-mono text-[28px] font-black leading-none tabular-nums" style={{ color: runnerUpInfo?.color ?? '#888' }}>
                  {statesWon[runnerUp?.[0] ?? ''] ?? 0}
                </div>
                <div className="text-[7.5px] font-mono uppercase tracking-[0.1em] mt-0.5 leading-tight" style={{ color: runnerUpInfo?.color ?? '#888', opacity: 0.7 }}>
                  {runnerUpInfo?.name.split(' ').slice(-1)[0]} states
                </div>
              </div>

              {/* Closest / biggest */}
              {closestState.code && (
                <div className="rounded-xl px-3 py-2 bg-black/[0.025] border border-black/[0.05]">
                  <div className="text-[7.5px] font-mono uppercase tracking-[0.1em] text-ink-3 mb-0.5">Closest race</div>
                  <div className="text-[11px] font-bold text-ink truncate leading-tight">{closestState.name}</div>
                  <div className="text-[9px] font-mono text-ink-2">+{closestState.margin.toFixed(1)}%</div>
                </div>
              )}
              {biggestState.code && (
                <div className="rounded-xl px-3 py-2 bg-black/[0.025] border border-black/[0.05]">
                  <div className="text-[7.5px] font-mono uppercase tracking-[0.1em] text-ink-3 mb-0.5">Biggest win</div>
                  <div className="text-[11px] font-bold text-ink truncate leading-tight">{biggestState.name}</div>
                  <div className="text-[9px] font-mono text-ink-2">+{biggestState.margin.toFixed(1)}%</div>
                </div>
              )}
            </div>

            <div className="mx-3.5 border-t border-black/[0.06]" />
          </>
        ) : null}

        {/* ── Regions ── */}
        <div className="pt-2">
          <p className="text-[7.5px] font-mono uppercase tracking-[0.16em] text-ink-3 px-3.5 pb-1.5">By Region</p>
          {regionData.map(region => {
            const isExpanded = expanded === region.id;
            return (
              <div key={region.id} className="border-b border-black/[0.05] last:border-b-0">
                <button onClick={() => setExpanded(prev => prev === region.id ? null : region.id)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-black/[0.025] transition-colors text-left">
                  <div className="w-[3px] self-stretch rounded-full shrink-0 min-h-[32px]"
                    style={{ background: region.info ? region.info.color : '#E5E7EB' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-ink leading-tight">{region.name}</div>
                    {region.info ? (
                      <>
                        <div className="flex items-center gap-1.5 mt-[3px]">
                          <span className="text-[9px] font-semibold text-ink-2 truncate">{getLastName(region.info.name)}</span>
                          <span className="font-mono text-[9.5px] font-bold tabular-nums shrink-0" style={{ color: region.info.color }}>{region.pct.toFixed(1)}%</span>
                          <span className="text-[8px] font-mono text-ink-3 shrink-0">+{region.margin.toFixed(1)}</span>
                        </div>
                        <div className="flex w-full h-[3.5px] rounded-full overflow-hidden mt-1.5" style={{ gap: 1 }}>
                          {region.sorted.slice(0, 6).map(([id, votes]) => {
                            const info = getCandInfo(id); const w = (votes / region.total) * 100;
                            return <div key={id} style={{ width: `${w}%`, background: info.color, flexShrink: 0 }} />;
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="text-[8.5px] font-mono text-ink-3 mt-0.5">No results</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-[7.5px] font-mono text-ink-3">{region.statesWith}/{region.states.length}</span>
                    <svg width="7" height="4" viewBox="0 0 7 4" fill="none" className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''} text-ink-3`}>
                      <path d="M1 1L3.5 3L6 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-black/[0.05] pb-0.5" style={{ background: 'rgba(0,0,0,0.018)' }}>
                    {region.stateData.map(st => (
                      <div key={st.code} className="flex items-center gap-2 px-4 py-[4px]">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: st.dI?.color ?? '#ddd' }} />
                        <span className="text-[9px] text-ink flex-1 truncate">{st.name}</span>
                        {st.hasData ? (
                          <>
                            <span className="font-mono text-[8.5px] font-bold tabular-nums shrink-0" style={{ color: st.dI?.color ?? '#888' }}>{st.dPct.toFixed(1)}%</span>
                            <span className="font-mono text-[7.5px] text-ink-3 w-9 text-right shrink-0">+{st.dMgn.toFixed(1)}</span>
                          </>
                        ) : (
                          <span className="text-[8.5px] font-mono text-ink-3">—</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Footer total ── */}
        {hasData && (
          <div className="px-3.5 py-3 border-t border-black/[0.06] flex items-center justify-between mt-1">
            <span className="text-[8px] font-mono text-ink-3 uppercase tracking-wide">Total valid votes</span>
            <span className="text-[12px] font-mono font-black text-ink tabular-nums">{fmtM(grandTotal)}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Main BrazilApp ────────────────────────────────────────────────────────────
export default function BrazilApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [selectedState, setSelectedState] = useState<StateInfo | null>(null);
  const [activeElection, setActiveElection] = useState<ElectionKey>('2022R1');
  const [overrides, setOverrides] = useState<Record<ElectionKey, Record<string, Partial<Record<string, number>>>>>({
    '2022R1': {}, '2022R2': {}, '2026R1': {}, '2026R2': {},
  });
  const [picks2026, setPicks2026] = useState<Record<string, string>>(() =>
    Object.fromEntries(BR_2026_PARTIES.map(p => [p.id, p.candidates[0] ?? '']))
  );
  const [hiddenParty2026, setHiddenParty2026] = useState<Set<string>>(new Set());
  const [projected2026R1, setProjected2026R1] = useState<Set<string>>(new Set());
  const [projected2026R2, setProjected2026R2] = useState<Set<string>>(new Set());
  const [showPartyFilter, setShowPartyFilter] = useState(false);
  const [showSimPanel, setShowSimPanel] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [bubbleMode, setBubbleMode] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [showRefPanel, setShowRefPanel] = useState(false);
  const [simState, setSimState] = useState<SimState>('idle');
  const [simProgress, setSimProgress] = useState(0);
  const [simTotal, setSimTotal] = useState(0);
  const [r2AwaitCandidates, setR2AwaitCandidates] = useState<[string, string]>(['', '']);
  const [r2AwaitR1Pcts, setR2AwaitR1Pcts] = useState<[number, number]>([0, 0]);
  const [stateReportingPct2026R1, setStateReportingPct2026R1] = useState<Record<string, number>>({});
  const r1ResultsRef   = useRef<Record<string, Partial<Record<string, number>>>>({});
  const simTimersRef   = useRef<ReturnType<typeof setTimeout>[]>([]);
  const partyFilterRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPartyFilter) return;
    function handler(e: MouseEvent) {
      if (partyFilterRef.current && !partyFilterRef.current.contains(e.target as Node))
        setShowPartyFilter(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPartyFilter]);

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

  // Base data (2022 uses real results; 2026 starts empty)
  const baseStateData = useMemo((): Record<string, Partial<Record<string, number>>> => {
    if (activeElection === '2022R1') return BRAZIL_2022_R1 as Record<string, Partial<Record<string, number>>>;
    if (activeElection === '2022R2') return BRAZIL_2022_R2 as Record<string, Partial<Record<string, number>>>;
    return {};
  }, [activeElection]);

  const workingStateResults = useMemo<Record<string, Partial<Record<string, number>>>>(
    () => ({ ...baseStateData, ...overrides[activeElection] }),
    [activeElection, baseStateData, overrides],
  );

  // For 2026, only projected states appear on map/scoreboard
  const stateResults = useMemo<Record<string, Partial<Record<string, number>>>>(() => {
    if (activeElection === '2026R1') {
      const out: Record<string, Partial<Record<string, number>>> = {};
      for (const [code, r] of Object.entries(workingStateResults))
        if (projected2026R1.has(code)) out[code] = r;
      return out;
    }
    if (activeElection === '2026R2') {
      const out: Record<string, Partial<Record<string, number>>> = {};
      for (const [code, r] of Object.entries(workingStateResults))
        if (projected2026R2.has(code)) out[code] = r;
      return out;
    }
    return workingStateResults;
  }, [activeElection, workingStateResults, projected2026R1, projected2026R2]);

  // Live reporting tracker for 2026R1 — drives ADVANCE badges
  const r2026Reporting = useMemo(() => {
    const totalVotes = Object.values(STATE_2022R1_TOTALS).reduce((s, v) => s + v, 0);
    let reportedVotes = 0;
    const tally: Record<string, number> = {};
    for (const [code, r] of Object.entries(overrides['2026R1'])) {
      if (!projected2026R1.has(code)) continue;
      const dSum = Object.values(r).reduce((s: number, v) => s + (v ?? 0), 0);
      if (dSum > 0) {
        reportedVotes += dSum;
        for (const [pid, v] of Object.entries(r))
          if ((v ?? 0) > 0) tally[pid] = (tally[pid] ?? 0) + (v as number);
      }
    }
    const reportingPct    = totalVotes > 0 ? reportedVotes / totalVotes : 0;
    const remainingVotes  = Math.max(0, totalVotes - reportedVotes);
    const sorted          = Object.entries(tally).sort(([, a], [, b]) => b - a);
    const projectedSet    = new Set<string>();
    const LOCK_SHARE      = 0.65;
    const thirdVotes      = sorted[2]?.[1] ?? 0;
    if (sorted.length >= 1 && reportingPct >= 0.20) {
      const [p1id, p1votes] = sorted[0];
      if (p1votes > thirdVotes + LOCK_SHARE * remainingVotes) projectedSet.add(p1id);
    }
    if (sorted.length >= 2 && reportingPct >= 0.35) {
      const [p2id, p2votes] = sorted[1];
      if (p2votes > thirdVotes + LOCK_SHARE * remainingVotes) projectedSet.add(p2id);
    }
    return { reportingPct, projectedSet };
  }, [overrides, projected2026R1]);

  // Live reporting tracker for 2026R2 — drives winner badge
  const r2026R2Reporting = useMemo(() => {
    const totalVotes = Object.values(STATE_2022R2_TOTALS).reduce((s, v) => s + v, 0);
    let reportedVotes = 0;
    const tally: Record<string, number> = {};
    for (const [code, r] of Object.entries(overrides['2026R2'])) {
      if (!projected2026R2.has(code)) continue;
      const dSum = Object.values(r).reduce((s: number, v) => s + (v ?? 0), 0);
      if (dSum > 0) {
        reportedVotes += STATE_2022R2_TOTALS[code] ?? dSum;
        for (const [pid, v] of Object.entries(r))
          if ((v ?? 0) > 0) tally[pid] = (tally[pid] ?? 0) + (v as number);
      }
    }
    const reportingPct   = totalVotes > 0 ? reportedVotes / totalVotes : 0;
    const remainingVotes = Math.max(0, totalVotes - reportedVotes);
    const sorted         = Object.entries(tally).sort(([, a], [, b]) => b - a);
    const projectedWinner = new Set<string>();
    if (sorted.length >= 2 && reportingPct >= 0.20) {
      const [p1id, p1votes] = sorted[0];
      const [, p2votes]     = sorted[1];
      if (p1votes > p2votes + 0.65 * remainingVotes) projectedWinner.add(p1id);
    }
    return { reportingPct, projectedWinner };
  }, [overrides, projected2026R2]);

  const panelAllIds = useMemo(() => {
    if (activeElection === '2022R1') return BR_CANDIDATES.map(c => c.id as string);
    if (activeElection === '2022R2') return ['LUL', 'BOL'];
    if (activeElection === '2026R1') return BR_2026_PARTIES.map(p => p.id as string).filter(id => !hiddenParty2026.has(id));
    return Array.from(r2026Reporting.projectedSet);
  }, [activeElection, hiddenParty2026, r2026Reporting]);

  const getCandInfo = useCallback((id: string): { name: string; color: string } => {
    if (activeElection.startsWith('2022')) {
      const cand = BR_CANDIDATE_MAP[id as BrCandidateId];
      return cand ? { name: cand.name, color: cand.color } : { name: id, color: '#888' };
    }
    const party = BR_2026_PARTY_MAP[id as Br2026PartyId];
    if (!party) return { name: id, color: '#888' };
    return { name: picks2026[id] ?? party.candidates[0] ?? id, color: party.color };
  }, [activeElection, picks2026]);

  const roundLabel = useMemo(() => {
    if (activeElection === '2022R1') return 'Round 1 · Oct 2, 2022';
    if (activeElection === '2022R2') return 'Round 2 · Oct 30, 2022';
    if (activeElection === '2026R1') return 'Round 1 · 2026';
    return 'Round 2 · 2026';
  }, [activeElection]);

  const handleStateUpdate = useCallback((code: string, newResults: Partial<Record<string, number>>) => {
    setOverrides(prev => ({ ...prev, [activeElection]: { ...prev[activeElection], [code]: newResults } }));
  }, [activeElection]);

  const handlePick2026 = useCallback((partyId: Br2026PartyId, candidate: string) => {
    setPicks2026(prev => ({ ...prev, [partyId]: candidate }));
  }, []);

  const stopSimulation = useCallback(() => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];
    setSimState('idle');
    setStateReportingPct2026R1({});
  }, []);

  const reset2026 = useCallback(() => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];
    setSimState('idle');
    setProjected2026R1(new Set());
    setProjected2026R2(new Set());
    setOverrides(prev => ({ ...prev, '2026R1': {}, '2026R2': {} }));
    setStateReportingPct2026R1({});
    setActiveElection('2026R1');
    setShowRefPanel(false);
  }, []);

  const runR1Simulation = useCallback((presets: Record<string, number>, duration: number) => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];
    const enabledIds = Object.keys(presets);
    setProjected2026R1(new Set());
    setProjected2026R2(new Set());
    setStateReportingPct2026R1({});
    setActiveElection('2026R1');

    const r1Results = simulateBrazilR1(presets, enabledIds);
    r1ResultsRef.current = r1Results;

    const r1NatTotals: Record<string, number> = {};
    for (const r of Object.values(r1Results))
      for (const [pid, v] of Object.entries(r))
        if ((v as number) > 0) r1NatTotals[pid] = (r1NatTotals[pid] ?? 0) + (v as number);
    const grandTotal  = Object.values(r1NatTotals).reduce((s, v) => s + v, 0);
    const sortedR1    = Object.entries(r1NatTotals).sort(([, a], [, b]) => b - a);
    const top2Ids: [string, string]   = [sortedR1[0]?.[0] ?? '', sortedR1[1]?.[0] ?? ''];
    const top2Pcts: [number, number]  = [
      grandTotal > 0 ? (r1NatTotals[top2Ids[0]] ?? 0) / grandTotal * 100 : 0,
      grandTotal > 0 ? (r1NatTotals[top2Ids[1]] ?? 0) / grandTotal * 100 : 0,
    ];

    const stateCodes = Object.keys(STATE_2022R1_TOTALS);
    const totalMs    = duration * 1000;
    const N_BATCHES  = 5;

    setSimState('r1_running');
    setSimProgress(0);
    setSimTotal(stateCodes.length);

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Bell-curve final times: when each state's last batch fires.
    // Mean at 50% of duration, std at 20% — most states finish in the middle.
    // Clamp to [100ms, totalMs - 200ms] so some states fire almost immediately.
    const mean = totalMs * 0.50;
    const std  = totalMs * 0.20;
    const finalTimes = stateCodes.map(() =>
      Math.max(100, Math.min(totalMs - 200, Math.round(mean + std * brRandNormal())))
    );

    for (let si = 0; si < stateCodes.length; si++) {
      const code = stateCodes[si];
      const fullResults = r1Results[code] ?? {};
      const finalTime   = finalTimes[si];

      // 5 random batch sizes summing to 1
      const rands   = Array.from({ length: N_BATCHES }, () => 0.2 + Math.random() * 0.8);
      const randSum = rands.reduce((s, v) => s + v, 0);
      const cumPcts: number[] = [];
      let acc = 0;
      for (let i = 0; i < N_BATCHES; i++) {
        acc += rands[i] / randSum;
        cumPcts.push(i === N_BATCHES - 1 ? 1.0 : acc);
      }

      // Batch times: first batch fires immediately (t≈0), rest spread to finalTime.
      // This gives instant visual feedback while keeping the bell-curve distribution
      // for when states finish reporting.
      const batchTimes: number[] = [
        0,
        Math.round(finalTime * 0.25),
        Math.round(finalTime * 0.50),
        Math.round(finalTime * 0.75),
        finalTime,
      ];

      for (let bi = 0; bi < N_BATCHES; bi++) {
        const cumPct   = cumPcts[bi];
        const fireAt   = batchTimes[bi];
        const isFinal  = bi === N_BATCHES - 1;

        timers.push(setTimeout(() => {
          const scaledResults: Partial<Record<string, number>> = {};
          for (const [pid, v] of Object.entries(fullResults))
            scaledResults[pid] = Math.round((v as number) * cumPct);

          setOverrides(prev => ({ ...prev, '2026R1': { ...prev['2026R1'], [code]: scaledResults } }));
          setProjected2026R1(prev => { const n = new Set(prev); n.add(code); return n; });
          setStateReportingPct2026R1(prev => ({ ...prev, [code]: cumPct }));
          if (isFinal) setSimProgress(prev => prev + 1);
        }, fireAt));
      }
    }

    timers.push(setTimeout(() => {
      setR2AwaitCandidates(top2Ids);
      setR2AwaitR1Pcts(top2Pcts);
      setShowSimPanel(true);
      if (top2Pcts[0] >= 50) {
        setSimState('r1_won');
      } else {
        setSimState('r2_input');
      }
    }, totalMs + 2000));
    simTimersRef.current = timers;
  }, []);

  const runR2Simulation = useCallback((pcts: [number, number], duration: number) => {
    simTimersRef.current.forEach(t => clearTimeout(t));
    simTimersRef.current = [];
    const r2Results = simulateBrazilR2WithTarget(r1ResultsRef.current, r2AwaitCandidates, pcts);
    setOverrides(prev => ({ ...prev, '2026R2': { ...prev['2026R2'], ...r2Results } }));
    const stateCodes = Object.keys(STATE_2022R2_TOTALS);
    const shuffled   = [...stateCodes].sort(() => Math.random() - 0.5);
    const totalMs    = duration * 1000;
    const NCHUNKS    = 10;
    const chunkTimes = brBellCurveTimes(NCHUNKS, totalMs);
    const chunks: string[][] = Array.from({ length: NCHUNKS }, () => []);
    shuffled.forEach((code, i) => chunks[i % NCHUNKS].push(code));
    setActiveElection('2026R2');
    setSimState('r2_running');
    setSimProgress(0);
    setSimTotal(stateCodes.length);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let declared = 0;
    for (let ci = 0; ci < NCHUNKS; ci++) {
      const chunk = chunks[ci];
      const t     = chunkTimes[ci];
      timers.push(setTimeout(() => {
        setProjected2026R2(prev => { const n = new Set(prev); for (const c of chunk) n.add(c); return n; });
        declared += chunk.length;
        setSimProgress(declared);
      }, t));
    }
    timers.push(setTimeout(() => setSimState('idle'), totalMs + 2000));
    simTimersRef.current = timers;
  }, [r2AwaitCandidates]);

  const isSimRunning = simState === 'r1_running' || simState === 'r2_running';

  // Reporting values for the map badge (2026 only)
  const reportingPct = activeElection === '2026R1'
    ? r2026Reporting.reportingPct
    : activeElection === '2026R2'
    ? r2026R2Reporting.reportingPct
    : undefined;
  const reportingStates = activeElection === '2026R1'
    ? projected2026R1.size
    : activeElection === '2026R2'
    ? projected2026R2.size
    : undefined;
  const reportingTotal = activeElection.startsWith('2026') ? 27 : undefined;

  // Reference data for the ref panel (2022 vs current working data)
  const refPanelData = useMemo(() => {
    if (!selectedState) return null;
    if (activeElection === '2026R1') return BRAZIL_2022_R1[selectedState.code] ?? {};
    if (activeElection === '2026R2') return BRAZIL_2022_R2[selectedState.code] ?? {};
    return null;
  }, [selectedState, activeElection]);

  const btnBase  = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnMuted = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnGold  = `${btnBase} bg-gold text-white hover:bg-gold-deep`;

  // Fixed totals for the state panel (use 2022 actual totals as denominator)
  const getFixedTotal = useCallback((code: string) => {
    if (activeElection === '2022R1' || activeElection === '2026R1') return STATE_2022R1_TOTALS[code];
    return STATE_2022R2_TOTALS[code];
  }, [activeElection]);

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="br">

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => setActiveElection('2022R1')} disabled={isSimRunning}
            className={activeElection === '2022R1' ? btnGold : btnMuted}>2022 R1</button>
          <button onClick={() => setActiveElection('2022R2')} disabled={isSimRunning}
            className={activeElection === '2022R2' ? btnGold : btnMuted}>2022 R2</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-1" />

          {/* 2026 connected pair */}
          <div className="flex items-stretch shrink-0">
            <button onClick={() => setActiveElection('2026R1')}
              className={`h-7 pl-3 pr-2 text-[11px] font-mono font-medium rounded-l-[4px] rounded-r-none border border-r-0 tracking-wide uppercase transition-colors duration-75 ${activeElection === '2026R1' ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}>
              2026 R1</button>
            <div className={`flex items-center justify-center w-5 border-y ${activeElection.startsWith('2026') ? 'bg-[#2563EB]/10 border-[#2563EB]' : 'bg-[#f5f4f0] border-default'}`}>
              <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                <path d="M0.5 3h5M4 1l2.5 2L4 5" stroke={activeElection.startsWith('2026') ? '#2563EB' : '#9ca3af'} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <button
              onClick={() => {
                setActiveElection('2026R2');
                if (simState === 'r2_input') setShowSimPanel(true);
              }}
              className={`h-7 pl-2 pr-3 text-[11px] font-mono font-medium rounded-r-[4px] rounded-l-none border border-l-0 tracking-wide uppercase transition-colors duration-75 ${simState === 'r2_input' ? 'br-r2-cta bg-[#2563EB] text-white border-[#2563EB]' : activeElection === '2026R2' ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}>
              R2</button>
          </div>

          <button onClick={reset2026} title="Reset 2026"
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-4.13"/>
            </svg>
          </button>

          {activeElection === '2026R1' && (
            <button className={btnMuted} disabled={isSimRunning}
              onClick={e => { e.stopPropagation(); setShowPartyFilter(v => !v); }}>
              Parties
            </button>
          )}

          {activeElection.startsWith('2026') && (
            <button
              className={`${btnBase} flex items-center gap-1.5 ${showSimPanel ? 'bg-[#7C3AED] text-white border border-[#7C3AED]' : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'}`}
              onClick={() => setShowSimPanel(v => !v)}>
              <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor" aria-hidden="true">
                <path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/>
              </svg>
              Simulation
            </button>
          )}

          <button className={summaryOpen ? `${btnBase} bg-ink/8 border border-default text-ink` : btnMuted}
            onClick={() => setSummaryOpen(v => !v)}>Summary</button>
          <button className={bubbleMode ? `${btnBase} bg-ink/8 border border-default text-ink` : btnMuted}
            onClick={() => setBubbleMode(v => !v)}>Bubble Map</button>
          <button
            onClick={() => setTutorialOpen(v => !v)}
            className={tutorialOpen ? `${btnBase} bg-ink/8 border border-default text-ink` : btnMuted}>Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          <button onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Light mode' : 'Dark mode'}>
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

      {/* ── Scoreboard ──────────────────────────────────────────── */}
      <div className="relative shrink-0">
        <div style={{ display: 'grid', gridTemplateRows: scoreboardVisible ? '1fr' : '0fr', transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)' }}>
          <div className="overflow-hidden">
            {activeElection.startsWith('2022') ? (
              <BrazilScoreboard stateResults={stateResults} round={activeElection === '2022R1' ? 1 : 2} />
            ) : (
              <Br2026Scoreboard
                stateResults={stateResults}
                election={activeElection as '2026R1' | '2026R2'}
                allPartyIds={panelAllIds}
                picks={picks2026}
                onPick={handlePick2026}
                projectedAdvancers={
                  activeElection === '2026R1' ? r2026Reporting.projectedSet
                  : activeElection === '2026R2' ? r2026R2Reporting.projectedWinner
                  : undefined
                }
              />
            )}
          </div>
        </div>
        <button onClick={() => setScoreboardVisible(v => !v)}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1">
          <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true">
            {scoreboardVisible
              ? <path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              : <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>}
          </svg>
          <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">
            {scoreboardVisible ? 'Hide' : 'Results'}
          </span>
        </button>
      </div>

      {/* ── Map + panel row ─────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Summary panel (left) */}
        {summaryOpen && (
          <BrSummaryPanel
            stateResults={stateResults}
            getCandInfo={getCandInfo}
            roundLabel={roundLabel}
            onClose={() => setSummaryOpen(false)}
          />
        )}

        <div className="flex-1 min-w-0 relative">

          {/* Party filter popup */}
          {showPartyFilter && activeElection === '2026R1' && (
            <div ref={partyFilterRef}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[500] bg-white rounded-[10px] overflow-hidden"
              style={{ width: 256, boxShadow: '0 8px 32px rgba(0,0,0,0.16),0 0 0 1px rgba(0,0,0,0.07)' }}>
              <div className="px-3 pt-2.5 pb-2 border-b border-default flex items-center justify-between">
                <span className="text-[11px] font-bold text-ink uppercase tracking-wider">2026 Parties</span>
                <div className="flex items-center gap-2">
                  <button className="text-[9px] font-mono text-ink-3 hover:text-ink" onClick={() => setHiddenParty2026(new Set())}>All</button>
                  <button className="text-[9px] font-mono text-ink-3 hover:text-ink" onClick={() => setHiddenParty2026(new Set(BR_2026_PARTIES.map(p => p.id)))}>None</button>
                  <button className="w-5 h-5 flex items-center justify-center rounded-[3px] text-ink-3 hover:bg-hover hover:text-ink text-base leading-none" onClick={() => setShowPartyFilter(false)}>×</button>
                </div>
              </div>
              <div className="py-1 max-h-64 overflow-y-auto thin-scroll">
                {BR_2026_PARTIES.map(party => {
                  const hidden = hiddenParty2026.has(party.id);
                  return (
                    <button key={party.id} onClick={() => setHiddenParty2026(prev => { const n = new Set(prev); hidden ? n.delete(party.id) : n.add(party.id); return n; })}
                      className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-hover transition-colors text-left">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: party.color, opacity: hidden ? 0.25 : 1 }} />
                      <span className={`flex-1 text-[10px] font-mono ${hidden ? 'text-ink-3 line-through' : 'text-ink font-medium'}`}>{party.id}</span>
                      <span className="text-[9px] text-ink-3 truncate max-w-[120px]">{party.name}</span>
                      <div className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${hidden ? 'border-default' : 'bg-[#2563EB] border-[#2563EB]'}`}>
                        {!hidden && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2L7 1" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <BrMapView
            stateResults={stateResults}
            getCandInfo={getCandInfo}
            selectedCode={selectedState?.code ?? null}
            onSelect={s => {
              if (isSimRunning) return;
              setSelectedState(s);
              setShowRefPanel(false);
              setShowSimPanel(false);
            }}
            reportingPct={reportingPct}
            reportingLabel={activeElection === '2026R1' ? 'Round 1 Reporting' : 'Round 2 Reporting'}
            reportingStates={reportingStates}
            reportingTotal={reportingTotal}
            stateReportingPct={activeElection === '2026R1' ? stateReportingPct2026R1 : undefined}
            bubbleMode={bubbleMode}
            dark={dark}
            othersIds={activeElection === '2022R1' ? BR_R1_OTHER_IDS : undefined}
          />
        </div>

        {/* Ref panel */}
        {selectedState && showRefPanel && refPanelData && (
          <BrRefPanel
            state={selectedState}
            results={refPanelData}
            label={activeElection === '2026R1' ? 'Reference · 2022 R1' : 'Reference · 2022 R2'}
            onClose={() => setShowRefPanel(false)}
          />
        )}

        {/* State slider panel */}
        {selectedState && !showSimPanel && !isSimRunning && (
          <StatePanel
            state={selectedState}
            results={workingStateResults[selectedState.code] ?? {}}
            allIds={panelAllIds}
            getCandInfo={getCandInfo}
            roundLabel={roundLabel}
            onClose={() => setSelectedState(null)}
            onUpdate={handleStateUpdate}
            fixedTotal={getFixedTotal(selectedState.code)}
            isProjected={activeElection === '2026R1' ? projected2026R1.has(selectedState.code)
              : activeElection === '2026R2' ? projected2026R2.has(selectedState.code)
              : undefined}
            onProject={code => {
              if (activeElection === '2026R1') setProjected2026R1(prev => new Set([...prev, code]));
              if (activeElection === '2026R2') setProjected2026R2(prev => new Set([...prev, code]));
            }}
            showRefData={showRefPanel}
            onToggleRef={activeElection.startsWith('2026') && refPanelData ? () => setShowRefPanel(v => !v) : undefined}
            refLabel={activeElection === '2026R1' ? '2022 R1' : '2022 R2'}
            othersIds={activeElection === '2022R1' ? BR_R1_OTHER_IDS : undefined}
          />
        )}

        {/* Tutorial panel */}
        {tutorialOpen && (
          <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default flex items-start justify-between gap-2 shrink-0">
              <div>
                <h2 className="text-[15px] font-bold text-ink leading-tight">How to Play</h2>
                <p className="text-[9.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Brazil Presidential Simulator</p>
              </div>
              <button onClick={() => setTutorialOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5">×</button>
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-4 text-[11px] text-ink-2 leading-relaxed">
              <div>
                <p className="font-bold text-ink mb-1">🗺️ Explore 2022</p>
                <p>Click any state to open its results panel. Drag the sliders or click a percentage to type it directly.</p>
              </div>
              <div>
                <p className="font-bold text-ink mb-1">🎯 Electoral System</p>
                <p>Brazil uses a two-round system. If no candidate wins an outright majority in Round 1, the top two advance to Round 2. In 2022, Lula beat Bolsonaro 50.90% to 49.10% — the closest Brazilian presidential race ever.</p>
              </div>
              <div>
                <p className="font-bold text-ink mb-1">🔮 Simulate 2026</p>
                <p>Switch to <strong>2026 R1</strong>, open <strong>Simulation</strong>, optionally toggle parties via <strong>Parties</strong>, then enter your predicted national percentages. The model distributes votes regionally using 2022 as a baseline.</p>
              </div>
              <div>
                <p className="font-bold text-ink mb-1">🗳️ Vote Transfer</p>
                <p>After Round 1, you enter Round 2 percentages. The model transfers votes from eliminated parties using an ideology-based model — PSOL/PT voters lean strongly left, MDB splits toward the winner, PL voters go right.</p>
              </div>
              <div>
                <p className="font-bold text-ink mb-1">📍 Regions</p>
                <p>Use <strong>Summary</strong> to see aggregated results by macro-region: Norte, Nordeste, Centro-Oeste, Sudeste, Sul.</p>
              </div>
              <div>
                <p className="font-bold text-ink mb-1">🔒 Lock Sliders</p>
                <p>Click the padlock icon on any slider to lock it while adjusting others. Useful for pinning a party's share.</p>
              </div>
            </div>
          </aside>
        )}

        {/* Simulation panel */}
        {showSimPanel && activeElection.startsWith('2026') && (
          <BrSimulationPanel
            enabledIds={panelAllIds}
            getCandInfo={getCandInfo}
            simState={simState}
            r2Candidates={r2AwaitCandidates}
            r2CandR1Pcts={r2AwaitR1Pcts}
            simProgress={simProgress}
            simTotal={simTotal}
            onRunR1={runR1Simulation}
            onRunR2={runR2Simulation}
            onStop={stopSimulation}
            onReset={reset2026}
            onClose={() => setShowSimPanel(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── 2026 scoreboard ───────────────────────────────────────────────────────────
function Br2026Scoreboard({ stateResults, election, allPartyIds, picks, onPick, projectedAdvancers }: {
  stateResults: Record<string, Partial<Record<string, number>>>;
  election: '2026R1' | '2026R2';
  allPartyIds: string[];
  picks: Record<string, string>;
  onPick: (partyId: Br2026PartyId, candidate: string) => void;
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
    for (const r of Object.values(stateResults)) {
      for (const [pid, votes] of Object.entries(r)) {
        if ((votes ?? 0) > 0) {
          popularVote[pid] = (popularVote[pid] ?? 0) + (votes as number);
          grandTotal += (votes as number);
        }
      }
    }
    return { popularVote, grandTotal };
  }, [stateResults]);

  const parties = useMemo(() =>
    allPartyIds
      .map(id => BR_2026_PARTY_MAP[id as Br2026PartyId])
      .filter((p): p is Br2026Party => !!p)
      .sort((a, b) => (popularVote[b.id] ?? 0) - (popularVote[a.id] ?? 0)),
  [allPartyIds, popularVote]);

  const top2Ids = useMemo(() => grandTotal > 0 ? new Set(parties.slice(0, 2).map(p => p.id)) : new Set<string>(), [parties, grandTotal]);
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
              <Br2026CandTile
                key={party.id}
                party={party}
                votes={votes}
                votePct={votePct}
                isLeader={top2Ids.has(party.id)}
                isWinner={winnerIds.has(party.id)}
                isR1={election === '2026R1'}
                pickedCandidate={picked ?? ''}
                onPick={onPick}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
