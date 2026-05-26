import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Candidate types ────────────────────────────────────────────────────────────
type TwCandId = 'DPP' | 'KMT' | 'TPP';

type TwCandidate = {
  id: TwCandId;
  name: string;
  party: string;
  partyFull: string;
  color: string;
  votes2024: number;
  pct2024: number;
  wikiTitle?: string;
};

const TW_CANDIDATES: TwCandidate[] = [
  {
    id: 'DPP', name: 'Lai Ching-te', party: 'DPP', partyFull: 'Democratic Progressive Party',
    color: '#1B9431', votes2024: 5_586_019, pct2024: 40.05, wikiTitle: 'Lai_Ching-te',
  },
  {
    id: 'KMT', name: 'Hou Yu-ih', party: 'KMT', partyFull: 'Kuomintang',
    color: '#000099', votes2024: 4_671_021, pct2024: 33.49, wikiTitle: 'Hou_Yu-ih',
  },
  {
    id: 'TPP', name: 'Ko Wen-je', party: 'TPP', partyFull: "Taiwan People's Party",
    color: '#28C8C8', votes2024: 3_690_466, pct2024: 26.46, wikiTitle: 'Ko_Wen-je',
  },
];

const TW_CAND_MAP = Object.fromEntries(TW_CANDIDATES.map(c => [c.id, c])) as Record<TwCandId, TwCandidate>;
const TW_TOTAL_VOTES_2024 = 13_947_506;

// ── County types ───────────────────────────────────────────────────────────────
type TwCountyId =
  | 'TPE' | 'NTP' | 'TYN' | 'TCH' | 'TNN' | 'KHH'
  | 'KEE' | 'XCY' | 'CYC' | 'YIL' | 'XCC' | 'MAL'
  | 'CHH' | 'NAN' | 'YNL' | 'CYY' | 'PTG' | 'HLN'
  | 'TTG' | 'PHU' | 'KMN' | 'LCJ';

type TwCounty = { id: TwCountyId; name: string; votes2024: number };

const TW_COUNTIES: TwCounty[] = [
  { id: 'TPE', name: 'Taipei City',       votes2024: 1_705_000 },
  { id: 'NTP', name: 'New Taipei City',   votes2024: 2_100_000 },
  { id: 'TYN', name: 'Taoyuan County',    votes2024: 1_700_000 },
  { id: 'TCH', name: 'Taichung City',     votes2024: 1_850_000 },
  { id: 'TNN', name: 'Tainan City',       votes2024: 1_250_000 },
  { id: 'KHH', name: 'Kaohsiung City',    votes2024: 1_900_000 },
  { id: 'KEE', name: 'Keelung City',      votes2024:   330_000 },
  { id: 'XCY', name: 'Hsinchu City',      votes2024:   380_000 },
  { id: 'CYC', name: 'Chiayi City',       votes2024:   175_000 },
  { id: 'YIL', name: 'Yilan County',      votes2024:   360_000 },
  { id: 'XCC', name: 'Hsinchu County',    votes2024:   400_000 },
  { id: 'MAL', name: 'Miaoli County',     votes2024:   350_000 },
  { id: 'CHH', name: 'Changhua County',   votes2024:   600_000 },
  { id: 'NAN', name: 'Nantou County',     votes2024:   320_000 },
  { id: 'YNL', name: 'Yunlin County',     votes2024:   450_000 },
  { id: 'CYY', name: 'Chiayi County',     votes2024:   370_000 },
  { id: 'PTG', name: 'Pingtung County',   votes2024:   480_000 },
  { id: 'HLN', name: 'Hualien County',    votes2024:   240_000 },
  { id: 'TTG', name: 'Taitung County',    votes2024:   230_000 },
  { id: 'PHU', name: 'Penghu County',     votes2024:    80_000 },
  { id: 'KMN', name: 'Kinmen County',     votes2024:   120_000 },
  { id: 'LCJ', name: 'Lienchiang County', votes2024:    10_000 },
];

const TW_COUNTY_MAP = Object.fromEntries(TW_COUNTIES.map(c => [c.id, c])) as Record<TwCountyId, TwCounty>;

// GeoJSON `name` property → county ID
const TW_NAME_TO_ID: Record<string, TwCountyId> = {
  'Taipei City': 'TPE',    'New Taipei City': 'NTP',  'Taoyuan County': 'TYN',
  'Taichung City': 'TCH',  'Tainan City': 'TNN',      'Kaohsiung City': 'KHH',
  'Keelung City': 'KEE',   'Hsinchu City': 'XCY',     'Chiayi City': 'CYC',
  'Yilan County': 'YIL',   'Hsinchu County': 'XCC',   'Miaoli County': 'MAL',
  'Changhua County': 'CHH','Nantou County': 'NAN',    'Yunlin County': 'YNL',
  'Chiayi County': 'CYY',  'Pingtung County': 'PTG',  'Hualien County': 'HLN',
  'Taitung County': 'TTG', 'Penghu County': 'PHU',    'Kinmen County': 'KMN',
  'Lienchiang County': 'LCJ',
};

// ── 2024 presidential results by county (source: CEC Taiwan) ──────────────────
const TW_COUNTY_RESULTS_2024: Record<TwCountyId, Record<TwCandId, number>> = {
  TPE: { DPP: 33.9, KMT: 32.3, TPP: 33.8 },
  NTP: { DPP: 36.2, KMT: 38.1, TPP: 25.7 },
  TYN: { DPP: 39.1, KMT: 34.2, TPP: 26.7 },
  TCH: { DPP: 42.3, KMT: 33.1, TPP: 24.6 },
  TNN: { DPP: 55.4, KMT: 25.2, TPP: 19.4 },
  KHH: { DPP: 48.7, KMT: 29.4, TPP: 21.9 },
  KEE: { DPP: 38.2, KMT: 36.1, TPP: 25.7 },
  XCY: { DPP: 38.5, KMT: 30.9, TPP: 30.6 },
  CYC: { DPP: 51.8, KMT: 27.4, TPP: 20.8 },
  YIL: { DPP: 44.6, KMT: 36.3, TPP: 19.1 },
  XCC: { DPP: 33.7, KMT: 42.4, TPP: 23.9 },
  MAL: { DPP: 31.8, KMT: 48.2, TPP: 20.0 },
  CHH: { DPP: 43.1, KMT: 36.4, TPP: 20.5 },
  NAN: { DPP: 37.2, KMT: 42.3, TPP: 20.5 },
  YNL: { DPP: 48.9, KMT: 33.9, TPP: 17.2 },
  CYY: { DPP: 50.1, KMT: 33.5, TPP: 16.4 },
  PTG: { DPP: 51.4, KMT: 30.9, TPP: 17.7 },
  HLN: { DPP: 25.8, KMT: 53.4, TPP: 20.8 },
  TTG: { DPP: 32.6, KMT: 48.3, TPP: 19.1 },
  PHU: { DPP: 37.2, KMT: 45.1, TPP: 17.7 },
  KMN: { DPP: 13.4, KMT: 66.9, TPP: 19.7 },
  LCJ: { DPP:  8.1, KMT: 78.2, TPP: 13.7 },
};

// ── Uniform national swing ─────────────────────────────────────────────────────
function calcCountyVotes(
  natPcts: Record<TwCandId, number>,
  countyId: TwCountyId,
): Record<TwCandId, number> {
  const base = TW_COUNTY_RESULTS_2024[countyId];
  const result: Record<TwCandId, number> = {} as Record<TwCandId, number>;
  let total = 0;
  for (const c of TW_CANDIDATES) {
    const swing = (natPcts[c.id] ?? 0) - c.pct2024;
    const v = Math.max(0, (base[c.id] ?? 0) + swing);
    result[c.id] = v;
    total += v;
  }
  if (total === 0) return result;
  for (const c of TW_CANDIDATES) result[c.id] = (result[c.id] / total) * 100;
  return result;
}

// Redistribute pcts when one slider moves (three-candidate version)
function redistributePcts(
  current: Record<TwCandId, number>,
  changedId: TwCandId,
  newRaw: number,
  locks: Set<TwCandId>,
): Record<TwCandId, number> {
  const ids = Object.keys(current) as TwCandId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<TwCandId, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) {
    for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  } else if (unlocked.length > 0) {
    for (const id of unlocked) next[id] = remaining / unlocked.length;
  }
  return next;
}

// ── Map colour helpers ─────────────────────────────────────────────────────────
function candColor(id: TwCandId): string { return TW_CAND_MAP[id]?.color ?? '#888'; }

function getCountyFill(natPcts: Record<TwCandId, number>, countyId: TwCountyId, dark: boolean, overrides?: Record<string, Record<TwCandId, number>>): string {
  const cv = overrides?.[countyId] ?? calcCountyVotes(natPcts, countyId);
  const sorted = (Object.entries(cv) as [TwCandId, number][]).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : '#E5E7EB';
  const [winner, winPct] = sorted[0];
  const runnerUp = sorted[1]?.[1] ?? 0;
  const t = Math.min(Math.max((winPct - runnerUp) / 30, 0), 1);
  const c = hsl(candColor(winner));
  c.l = dark ? 0.52 - t * 0.28 : 0.80 - t * 0.44;
  return c.formatHex();
}

// ── Bell-curve simulation timing ───────────────────────────────────────────────
function twRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function twBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () =>
    Math.max(0.02, Math.min(0.98, 0.5 + twRandNormal() * 0.18))
  ).sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

// ── Utility ────────────────────────────────────────────────────────────────────
function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Tooltip type ───────────────────────────────────────────────────────────────
type CountyTooltipState = {
  x: number; y: number; name: string;
  votes: { id: TwCandId; pct: number }[];
  leader: TwCandId | null;
} | null;

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function TwScoreboardTile({
  candId, pct, rawVotes, countiesWon, isLeader, isWinner, dark: _dark,
}: {
  candId: TwCandId; pct: number; rawVotes: number; countiesWon: number;
  isLeader: boolean; isWinner: boolean; dark?: boolean;
}) {
  const cand = TW_CAND_MAP[candId];
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cand.wikiTitle) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(cand.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [cand.wikiTitle]);

  const initials = cand.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color = candColor(candId);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{
        '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: (isLeader || isWinner) ? color : hexToRgba(color, 0.30),
        minWidth: 130, maxWidth: 180, flex: 1,
      } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
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
      <span className="cand-leader-name" title={cand.name}>{cand.name.split(' ').slice(-1)[0]}</span>
      <span className="cand-party-abbrev">{cand.party}</span>
      <span className="cand-seats">{pct.toFixed(1)}%</span>
      <span className="cand-party-name" title={cand.partyFull}>{cand.partyFull}</span>

      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 6.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, color: hexToRgba(color, 0.48), letterSpacing: '0.10em', textTransform: 'uppercase' }}>VOTES</span>
        <span className="cand-votes-full" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: hexToRgba(color, 0.65) }}>{rawVotes.toLocaleString()}</span>
        <span className="cand-votes-compact" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: hexToRgba(color, 0.65) }}>{fmtN(rawVotes)}</span>
      </div>

      <div className="cand-bar-track" style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--bar-track)' }}>
        <div style={{ height: '100%', borderRadius: 2, background: color, width: `${Math.min(pct / 55 * 100, 100)}%`, transition: 'width 0.3s ease' }} />
      </div>

      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 6.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, color: hexToRgba(color, 0.48), letterSpacing: '0.10em', textTransform: 'uppercase' }}>COUNTIES</span>
        <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color }}>{countiesWon}</span>
      </div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────────
function TwScoreboard({ natPcts, declaredCounties, isBaseline, dark }: {
  natPcts: Record<TwCandId, number>;
  declaredCounties?: Set<TwCountyId>;
  isBaseline?: boolean;
  dark?: boolean;
}) {
  const pctTotal = Object.values(natPcts).reduce((s, v) => s + (v ?? 0), 0);

  const countiesWon = useMemo((): Record<TwCandId, number> => {
    const wins: Record<TwCandId, number> = { DPP: 0, KMT: 0, TPP: 0 };
    const counties = declaredCounties
      ? TW_COUNTIES.filter(c => declaredCounties.has(c.id))
      : TW_COUNTIES;
    for (const county of counties) {
      const cv = calcCountyVotes(natPcts, county.id);
      const winner = (Object.entries(cv) as [TwCandId, number][])
        .sort(([, a], [, b]) => b - a)[0]?.[0];
      if (winner) wins[winner] = (wins[winner] ?? 0) + 1;
    }
    return wins;
  }, [natPcts, declaredCounties]);

  const sorted = useMemo(
    () => [...TW_CANDIDATES].sort((a, b) => (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)),
    [natPcts],
  );

  const leader = sorted[0]?.id ?? null;
  const allDeclared = !declaredCounties || declaredCounties.size >= TW_COUNTIES.length;
  const winner = allDeclared && leader ? leader : null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div className="flex gap-2 px-6 pt-2 pb-2 justify-center items-stretch max-w-2xl mx-auto">
        {sorted.map(cand => {
          const pct = pctTotal > 0 ? (natPcts[cand.id] ?? 0) / pctTotal * 100 : 0;
          const rawVotes = isBaseline
            ? cand.votes2024
            : Math.round((natPcts[cand.id] ?? 0) / 100 * TW_TOTAL_VOTES_2024);
          return (
            <TwScoreboardTile
              key={cand.id} candId={cand.id} pct={pct} rawVotes={rawVotes}
              countiesWon={countiesWon[cand.id] ?? 0}
              isLeader={cand.id === leader && !winner}
              isWinner={cand.id === winner}
              dark={dark}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Map controller ─────────────────────────────────────────────────────────────
function MapController() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// ── Bubble overlay ─────────────────────────────────────────────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };
function zoomScale(zoom: number): number { return Math.max(0.40, Math.min(1.0, (zoom - 4) / (9 - 4))); }

function TwBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef, declaredCounties,
}: {
  geoData: any; natPcts: Record<TwCandId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: CountyTooltipState) => void;
  onSelect: (id: TwCountyId) => void;
  natPctsRef: React.MutableRefObject<Record<TwCandId, number>>;
  declaredCounties?: Set<TwCountyId>;
}) {
  const map = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);

  useEffect(() => {
    const onZoom = () => {
      const scale = zoomScale(map.getZoom());
      for (const { marker, baseRadius } of bubblesRef.current) marker.setRadius(baseRadius * scale);
    };
    map.on('zoomend', onZoom); return () => { map.off('zoomend', onZoom); };
  }, [map]);

  useEffect(() => {
    for (const { marker } of bubblesRef.current) marker.remove();
    bubblesRef.current = [];
    const scale = zoomScale(map.getZoom());

    L.geoJSON(geoData).eachLayer((layer: L.Layer) => {
      const name: string = (layer as any).feature?.properties?.name ?? '';
      const countyId = TW_NAME_TO_ID[name];
      if (!countyId) return;
      if (declaredCounties && !declaredCounties.has(countyId)) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();
      const cv = calcCountyVotes(natPcts, countyId);
      const sorted = (Object.entries(cv) as [TwCandId, number][]).sort(([, a], [, b]) => b - a);
      if (!sorted.length) return;
      const [winId, winPct] = sorted[0];
      const margin = winPct - (sorted[1]?.[1] ?? 0);
      const baseRadius = 5 + Math.min(margin / 20, 1) * 14;
      const color = candColor(winId);
      const marker = L.circleMarker(center, { radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1, opacity: 0.9 }).addTo(map);
      marker.on('click', () => { setTooltip(null); onSelect(countyId); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cur = calcCountyVotes(natPctsRef.current, countyId);
        const votes = (Object.entries(cur) as [TwCandId, number][]).sort(([, a], [, b]) => b - a).map(([id, pct]) => ({ id: id as TwCandId, pct }));
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name, votes, leader: votes[0]?.id ?? null });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });
    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  }, [map, geoData, natPcts]);

  return null;
}

// ── Map view ───────────────────────────────────────────────────────────────────
function TwMapView({
  natPcts, selectedCounty, onSelect, dark, bubbleMap, declaredCounties, overrides,
}: {
  natPcts: Record<TwCandId, number>;
  selectedCounty: TwCountyId | null;
  onSelect: (id: TwCountyId) => void;
  dark: boolean;
  bubbleMap: boolean;
  declaredCounties?: Set<TwCountyId>;
  overrides?: Record<string, Record<TwCandId, number>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef     = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<CountyTooltipState>(null);

  const natPctsRef       = useRef(natPcts);
  const selectedRef      = useRef(selectedCounty);
  const darkRef          = useRef(dark);
  const bubbleRef        = useRef(bubbleMap);
  const onSelectRef      = useRef(onSelect);
  const declaredRef      = useRef(declaredCounties);
  const overridesRef     = useRef(overrides);
  useEffect(() => { natPctsRef.current  = natPcts;       }, [natPcts]);
  useEffect(() => { selectedRef.current = selectedCounty; }, [selectedCounty]);
  useEffect(() => { darkRef.current     = dark;           }, [dark]);
  useEffect(() => { bubbleRef.current   = bubbleMap;      }, [bubbleMap]);
  useEffect(() => { onSelectRef.current = onSelect;       }, [onSelect]);
  useEffect(() => { declaredRef.current = declaredCounties; }, [declaredCounties]);
  useEffect(() => { overridesRef.current = overrides;     }, [overrides]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}taiwan-counties.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const name: string = feature?.properties?.name ?? '';
    const countyId = TW_NAME_TO_ID[name];
    const isSelected = countyId === selectedRef.current;
    const borderColor = darkRef.current ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';

    if (bubbleRef.current) return { fillOpacity: 0, weight: 0.4, color: darkRef.current ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)', opacity: 0.6 };

    if (!countyId) return { fillColor: darkRef.current ? '#374151' : '#E5E7EB', fillOpacity: 0.5, weight: 0.4, color: borderColor, opacity: 1 };

    const isDeclared = !declaredRef.current || declaredRef.current.has(countyId);
    if (!isDeclared) return { fillColor: darkRef.current ? '#1f2937' : '#d1d5db', fillOpacity: 0.7, weight: 0.4, color: borderColor, opacity: 1 };

    const fill = getCountyFill(natPctsRef.current, countyId, darkRef.current, overridesRef.current);
    return {
      fillColor: fill, fillOpacity: 0.80,
      weight: isSelected ? 2 : 0.5,
      color: isSelected ? '#c8a020' : borderColor,
      opacity: 1,
    };
  }, []);

  useEffect(() => {
    layerRef.current?.setStyle((f: any) => getStyle(f));
  }, [natPcts, selectedCounty, dark, bubbleMap, declaredCounties, overrides, getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const name: string = feature?.properties?.name ?? '';
    const countyId = TW_NAME_TO_ID[name];

    layer.on('click', () => { if (countyId) onSelectRef.current(countyId); });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleRef.current || !countyId) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cv = calcCountyVotes(natPctsRef.current, countyId);
      const votes = (Object.entries(cv) as [TwCandId, number][])
        .sort(([, a], [, b]) => b - a)
        .map(([id, pct]) => ({ id, pct }));
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name, votes, leader: votes[0]?.id ?? null });
    });

    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer
        center={[23.7, 121.0]} zoom={7} minZoom={5} maxZoom={13}
        style={{ width: '100%', height: '100%' }}
        zoomControl worldCopyJump={false}
      >
        <TileLayer
          key={dark ? 'dark' : 'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd" updateWhenZooming={false} updateWhenIdle={true} maxZoom={20}
        />
        <MapController />
        {geoData && (
          <GeoJSON
            ref={layerRef as any}
            data={geoData}
            style={(f: any) => getStyle(f)}
            onEachFeature={onEachFeature}
            {...({ smoothFactor: 0 } as any)}
          />
        )}
        {geoData && bubbleMap && (
          <TwBubbleLayer
            geoData={geoData} natPcts={natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredCounties={declaredCounties}
          />
        )}
      </MapContainer>

      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW_TIP = 200;
        const left = tooltip.x + 18 + TW_TIP > cw ? tooltip.x - TW_TIP - 10 : tooltip.x + 18;
        const tt = {
          bg: dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
          title: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
          sub: dark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.42)',
          body: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW_TIP }}>
            <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: tt.shadow, backdropFilter: 'blur(10px)', padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>{tooltip.name}</div>
              <div style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 2 }}>Est. county result</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tooltip.votes.map(({ id, pct }, i) => {
                  const c = TW_CAND_MAP[id];
                  const pColor = candColor(id);
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: pColor }} />
                      <span style={{ flex: 1, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c?.name ?? id}</span>
                      <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: pColor }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">
        Scroll to zoom · Click to open
      </div>
    </div>
  );
}

// ── Running vote pcts from declared counties ───────────────────────────────────
function calcRunningPcts(
  natPcts: Record<TwCandId, number>,
  declaredCounties: Set<TwCountyId>,
): Record<TwCandId, number> | undefined {
  if (declaredCounties.size === 0) return undefined;
  let totalVotes = 0;
  const votes: Record<TwCandId, number> = { DPP: 0, KMT: 0, TPP: 0 };
  for (const county of TW_COUNTIES) {
    if (!declaredCounties.has(county.id)) continue;
    const cv = calcCountyVotes(natPcts, county.id);
    for (const c of TW_CANDIDATES) {
      votes[c.id] = (votes[c.id] ?? 0) + (cv[c.id] / 100) * county.votes2024;
    }
    totalVotes += county.votes2024;
  }
  if (totalVotes === 0) return undefined;
  const result: Record<TwCandId, number> = {} as Record<TwCandId, number>;
  for (const c of TW_CANDIDATES) result[c.id] = (votes[c.id] / totalVotes) * 100;
  return result;
}

// ── County breakdown panel (editable) ─────────────────────────────────────────
function TwCountyPanel({ countyId, natPcts, onUpdate, onClose, dark, override }: {
  countyId: TwCountyId; natPcts: Record<TwCandId, number>;
  onUpdate: (id: TwCountyId, pcts: Record<TwCandId, number>) => void;
  onClose: () => void; dark?: boolean;
  override?: Record<TwCandId, number>;
}) {
  const initPcts = () => {
    if (override) return { ...override };
    const cv = calcCountyVotes(natPcts, countyId);
    return Object.fromEntries(TW_CANDIDATES.map(c => [c.id, cv[c.id] ?? 0])) as Record<TwCandId, number>;
  };
  const [pcts, setPcts] = useState<Record<TwCandId, number>>(initPcts);
  const [panelLocks, setPanelLocks] = useState<Set<TwCandId>>(new Set());
  const [editId, setEditId] = useState<TwCandId | null>(null);
  const [editVal, setEditVal] = useState('');
  const pctsRef = useRef(pcts);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);

  useEffect(() => {
    if (override) setPcts({ ...override });
    else {
      const cv = calcCountyVotes(natPcts, countyId);
      setPcts(Object.fromEntries(TW_CANDIDATES.map(c => [c.id, cv[c.id] ?? 0])) as Record<TwCandId, number>);
    }
    setPanelLocks(new Set()); setEditId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countyId]);

  function applyChange(id: TwCandId, val: number) {
    const next = redistributePcts(pctsRef.current, id, val, panelLocks);
    pctsRef.current = next; setPcts(next); onUpdate(countyId, next);
  }
  function commitEdit(id: TwCandId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  const sorted = useMemo(() => TW_CANDIDATES.map(c => ({ ...c, pct: pcts[c.id] ?? 0 })).sort((a, b) => b.pct - a.pct), [pcts]);
  const county = TW_COUNTY_MAP[countyId]; const winner = sorted[0];

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{county?.name ?? countyId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{override ? 'Custom result · click % to edit' : 'Estimated result · click % to edit'}</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] border border-default" style={{ borderColor: `${winner.color}33` }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: winner.color }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.name}</span>
            <span className="text-[9px] font-mono text-ink-3">{winner.pct.toFixed(1)}%</span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
        {sorted.map(c => {
          const pct = pcts[c.id] ?? 0; const isLocked = panelLocks.has(c.id);
          return (
            <div key={c.id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{c.name}</span>
                <span className="text-[8px] font-mono text-ink-3 shrink-0">{c.party}</span>
                {editId === c.id
                  ? <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                      className="w-14 text-[11px] font-mono text-right border border-default rounded px-1 bg-canvas text-ink"
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(c.id, editVal)}
                      onKeyDown={e => { if (e.key==='Enter') commitEdit(c.id, editVal); if (e.key==='Escape') { setEditId(null); setEditVal(''); } }} />
                  : <button onClick={() => { if (!isLocked) { setEditId(c.id); setEditVal(pct.toFixed(1)); } }}
                      className={`text-[10px] font-mono font-semibold tabular-nums ${isLocked?'cursor-default':'hover:underline cursor-text'}`}
                      style={{ color: c.color }}>{pct.toFixed(1)}%</button>
                }
                <button onClick={() => setPanelLocks(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`} title={isLocked?'Unlock':'Lock'}>
                  {isLocked
                    ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  }
                </button>
              </div>
              <input type="range" min={0} max={80} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(c.id, parseFloat(e.target.value))}
                className="br-party-slider w-full"
                style={{ '--party-color': c.color, '--pct': `${(pct/80)*100}%` } as React.CSSProperties} />
            </div>
          );
        })}
        <div className="pt-2 border-t border-default space-y-2">
          <div>
            <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mb-1">2024 votes cast (approx.)</div>
            <div className="text-[11px] font-mono font-semibold text-ink">{county?.votes2024.toLocaleString()}</div>
          </div>
          {override && (
            <button onClick={() => {
              const cv = calcCountyVotes(natPcts, countyId);
              const reset = Object.fromEntries(TW_CANDIDATES.map(c => [c.id, cv[c.id] ?? 0])) as Record<TwCandId, number>;
              setPcts(reset); setPanelLocks(new Set()); onUpdate(countyId, reset);
            }} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Reset to Estimate
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Tutorial panel ──────────────────────────────────────────────────────────────
function TwTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>
  );
  const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>
  );
  const Note = ({ children }: { children: React.ReactNode }) => (
    <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>
  );
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Taiwan Presidential Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>The Taiwan Presidential System</H2>
        <P>Taiwan's president is elected directly by popular vote. The candidate with the <strong>most votes wins</strong> — no runoff, no threshold, simple plurality.</P>
        <Note>Elections are held every 4 years. Turnout is typically 70–75% of ~19.5 million eligible voters.</Note>

        <H2>Three-Party Race</H2>
        <P><strong>DPP</strong> (green) is centre-left and pro-Taiwan sovereignty. <strong>KMT</strong> (blue) is centre-right and favours closer ties with Beijing. <strong>TPP</strong> (teal) is a centrist populist party founded by Ko Wen-je.</P>

        <H2>Counties on the Map</H2>
        <P>Taiwan has 22 counties and cities. They are coloured by whichever candidate leads based on estimated local vote shares. Click any county to see its breakdown.</P>
        <Note>Eastern counties (Hualien, Taitung) are geographically large but have far fewer voters than the western cities.</Note>

        <H2>Simulation</H2>
        <P>Click <strong>▶ Simulation</strong> to open the panel. Adjust the three vote-share sliders (they sum to 100%), then click <strong>Run Simulation</strong>. Counties declare one by one with running national vote totals updating live.</P>

        <H2>2024 Result</H2>
        <P>Lai Ching-te (DPP) won with 40.05%, defeating Hou Yu-ih (KMT) at 33.49% and Ko Wen-je (TPP) at 26.46%. DPP won 13 of 22 counties.</P>
      </div>
    </aside>
  );
}

// ── Main app ────────────────────────────────────────────────────────────────────
export default function TaiwanApp() {
  const navigate = useNavigate();

  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  const [preset, setPreset]   = useState<'baseline' | 'blank' | 'custom'>('baseline');
  const [natPcts, setNatPcts] = useState<Record<TwCandId, number>>({ DPP: 40.05, KMT: 33.49, TPP: 26.46 });

  function loadBaseline() {
    setNatPcts({ DPP: 40.05, KMT: 33.49, TPP: 26.46 });
    setPreset('baseline');
    setDeclaredCounties(undefined);
    stopSim();
  }
  function loadBlank() {
    setNatPcts({ DPP: 33.33, KMT: 33.33, TPP: 33.34 });
    setPreset('blank');
    setDeclaredCounties(undefined);
    stopSim();
  }

  const [selectedCounty, setSelectedCounty]     = useState<TwCountyId | null>(null);
  const [countyOverrides, setCountyOverrides]   = useState<Record<string, Record<TwCandId, number>>>({});
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [locks, setLocks]                         = useState<Set<TwCandId>>(new Set());
  const [simOpen, setSimOpen]                     = useState(false);
  const [tutorialOpen, setTutorialOpen]           = useState(false);
  const [exitPanel, setExitPanel]                 = useState<string | null>(null);
  const exitTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const triggerExit = useCallback((panel: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  const [bubbleMap, setBubbleMap]               = useState(false);
  const [simRunning, setSimRunning]             = useState(false);
  const [simProgress, setSimProgress]           = useState(0);
  const [declaredCounties, setDeclaredCounties] = useState<Set<TwCountyId> | undefined>();
  const simTimersRef        = useRef<ReturnType<typeof setTimeout>[]>([]);
  const natPctsAtSimStart   = useRef<Record<TwCandId, number>>(natPcts);

  function stopSim() {
    simTimersRef.current.forEach(clearTimeout);
    simTimersRef.current = [];
    setSimRunning(false);
  }

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

  const displayPcts = useMemo((): Record<TwCandId, number> => {
    if (!declaredCounties || declaredCounties.size === 0) return natPcts;
    return calcRunningPcts(natPctsAtSimStart.current, declaredCounties) ?? natPcts;
  }, [declaredCounties, natPcts]);

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  const showCounty   = !!selectedCounty && !simOpen;
  const showTutorial = tutorialOpen || exitPanel === 'tutorial';

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="tw">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={loadBaseline}  className={preset === 'baseline' ? btnGold : btnMuted}>2024 Results</button>
          <button onClick={loadBlank} className={preset === 'blank'    ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => setSimOpen(v => !v)} className={simOpen ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => setBubbleMap(v => !v)} className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnMuted}>Bubble Map</button>
          <button onClick={() => setScoreboardVisible(v => !v)} className={scoreboardVisible ? btnActive : btnMuted}>Scoreboard</button>
          <button
            onClick={() => {
              if (tutorialOpen) { setTutorialOpen(false); triggerExit('tutorial'); }
              else setTutorialOpen(true);
            }}
            className={tutorialOpen ? btnActive : btnMuted}>Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors" title="Toggle dark mode">
            {dark ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── Scoreboard ─────────────────────────────────────────────────────── */}
      {scoreboardVisible && (
        <TwScoreboard
          natPcts={displayPcts}
          declaredCounties={declaredCounties}
          isBaseline={preset === 'baseline' && !declaredCounties}
          dark={dark}
        />
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Map */}
        <TwMapView
          natPcts={natPcts}
          selectedCounty={selectedCounty}
          onSelect={id => setSelectedCounty(prev => prev === id ? null : id)}
          dark={dark}
          bubbleMap={bubbleMap}
          declaredCounties={declaredCounties}
          overrides={countyOverrides}
        />

        {/* Simulation panel */}
        {simOpen && (
          <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">National vote shares · Plurality</p>
              </div>
              <button onClick={() => setSimOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>

            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-4">
              {TW_CANDIDATES.map(cand => {
                const pct = natPcts[cand.id] ?? 0;
                const isLocked = locks.has(cand.id);
                const color = candColor(cand.id);
                return (
                  <div key={cand.id}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{cand.name}</span>
                      <button
                        onClick={() => setLocks(prev => { const n = new Set(prev); n.has(cand.id) ? n.delete(cand.id) : n.add(cand.id); return n; })}
                        className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}
                        title={isLocked ? 'Unlock' : 'Lock'}
                      >
                        {isLocked
                          ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                          : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                        }
                      </button>
                    </div>
                    <input type="range" min={0} max={80} step={0.1} value={pct} disabled={isLocked}
                      onChange={e => {
                        const next = redistributePcts(natPcts, cand.id, parseFloat(e.target.value), locks);
                        setNatPcts(next);
                        setPreset('custom');
                      }}
                      className="br-party-slider w-full"
                      style={{ '--party-color': color, '--pct': `${(pct / 80) * 100}%` } as React.CSSProperties}
                    />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[8px] font-mono text-ink-3">{cand.party}</span>
                      <span className="text-[8.5px] font-mono tabular-nums text-ink-3">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button
                disabled={simRunning}
                onClick={() => {
                  stopSim();
                  natPctsAtSimStart.current = { ...natPcts };
                  const allCounties = [...TW_COUNTIES].sort(() => Math.random() - 0.5);
                  const NCHUNKS = 8;
                  const chunkTimes = twBellCurveTimes(NCHUNKS, 11_000);
                  const chunks: TwCounty[][] = Array.from({ length: NCHUNKS }, () => []);
                  allCounties.forEach((c, i) => chunks[i % NCHUNKS].push(c));
                  setSimRunning(true);
                  setSimProgress(0);
                  setDeclaredCounties(new Set());
                  let declared = new Set<TwCountyId>();
                  const timers: ReturnType<typeof setTimeout>[] = [];
                  for (let ci = 0; ci < NCHUNKS; ci++) {
                    const chunk = chunks[ci];
                    const t = chunkTimes[ci];
                    timers.push(setTimeout(() => {
                      for (const c of chunk) declared.add(c.id);
                      const snap = new Set(declared);
                      setDeclaredCounties(snap);
                      setSimProgress(snap.size);
                      if (snap.size >= TW_COUNTIES.length) setSimRunning(false);
                    }, t));
                  }
                  simTimersRef.current = timers;
                }}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {simRunning ? `${simProgress}/${TW_COUNTIES.length} counties reporting…` : '▶ Run Simulation'}
              </button>
              {declaredCounties && (
                <button
                  onClick={() => { stopSim(); setDeclaredCounties(undefined); setSimProgress(0); }}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
                  Reset
                </button>
              )}
            </div>
          </aside>
        )}

        {showCounty && selectedCounty && !simOpen && (
          <TwCountyPanel
            countyId={selectedCounty}
            natPcts={natPcts}
            onUpdate={(id, pcts) => setCountyOverrides(prev => ({ ...prev, [id]: pcts }))}
            onClose={() => setSelectedCounty(null)}
            dark={dark}
            override={countyOverrides[selectedCounty]}
          />
        )}

        {showTutorial && !simOpen && (
          <TwTutorialPanel
            onClose={() => { setTutorialOpen(false); triggerExit('tutorial'); }}
            exiting={exitPanel === 'tutorial'}
            dark={dark}
          />
        )}
      </div>
    </div>
  );
}
