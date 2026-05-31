import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';
import {
  KR_PARTIES, KR_PARTY_MAP, KR_DISTRICTS, KR_LEADERS, KR_LEADERS_2026,
  KR_CODE_TO_NR, calcConstituencySeats, calcPRSeats, calcAssembly,
  ASSEMBLY_TOTAL, DIRECT_THRESHOLD,
  PR_VOTES_2024, PR_GRAND_TOTAL_2024,
  type KrPartyId, type KrDistrict,
} from '../data/southKorea2024';

// ── Types ──────────────────────────────────────────────────────────────────────
type TooltipState = {
  x: number; y: number;
  name: string; nr: number; state: string;
  parties: { id: KrPartyId; votes: number; pct: number }[];
  winner: KrPartyId | null;
} | null;

// ── Coloring ───────────────────────────────────────────────────────────────────
function getWkFill(results: Partial<Record<KrPartyId, number>>, dark: boolean): string {
  const sorted = (Object.entries(results) as [KrPartyId, number][])
    .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : '#E5E7EB';
  const [winner, winnerVotes] = sorted[0];
  const runnerUp = sorted[1]?.[1] ?? 0;
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const margin = total > 0 ? ((winnerVotes - runnerUp) / total) * 100 : 0;
  const baseColor = partyColor(winner, dark);
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark ? 0.55 - t * 0.29 : 0.82 - t * 0.46;
  const c = hsl(baseColor);
  c.l = lightness;
  return c.formatHex();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function fmtN(n: number) {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M';
  if (n >= 1_000) return Math.round(n/1_000)+'K';
  return n.toString();
}

// ── Dark-mode party colour helper ──────────────────────────────────────────────
function partyColor(id: KrPartyId, dark = false): string {
  const p = KR_PARTY_MAP[id];
  if (dark && p?.darkColor) return p.darkColor; // lighter shade for dark mode where base is too dark
  return p?.color ?? '#888';
}

const PARTY_DISPLAY_ID: Partial<Record<KrPartyId, string>> = {};

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function ScoreboardTile({ partyId, totalSeats, pct, votes, prPct, prRawVotes, isLeader, isWinner, hasMajority, dark, leaders }: {
  partyId: KrPartyId; totalSeats: number; pct: number; votes: number;
  prPct?: number; prRawVotes?: number;
  isLeader: boolean; isWinner: boolean;
  hasMajority?: boolean; dark?: boolean;
  leaders?: Partial<Record<KrPartyId, { name: string; wikiTitle?: string }>>;
}) {
  const party = KR_PARTY_MAP[partyId];
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const leader = (leaders ?? KR_LEADERS)[partyId];

  useEffect(() => {
    if (!leader?.wikiTitle) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(leader.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [leader?.wikiTitle]);
  const initials = leader?.name.split(' ').map((w: string) => w[0]).join('').slice(0,2) ?? party.name.slice(0,2);
  const color = partyColor(partyId, dark ?? false);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{
        '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: (isLeader || isWinner) ? color : hexToRgba(color, 0.30),
      } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={leader?.name} onError={() => setPhotoUrl(null)} />
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
        {hasMajority && !isWinner && (
          <span style={{ position: 'absolute', bottom: 2, right: 2, lineHeight: 1, fontSize: 11, color: '#16a34a', fontWeight: 800 }} title="Majority">✓</span>
        )}
      </div>
      <span className="cand-leader-name" title={leader?.name}>{leader?.name.split(' ').pop() ?? party.name}</span>
      <span className="cand-party-abbrev">{PARTY_DISPLAY_ID[partyId] ?? partyId}</span>
      <span className="cand-seats">{totalSeats}</span>
      <span className="cand-party-name">{party.name}</span>

      {/* Zweitstimme row (primary) */}
      {prPct !== undefined ? (<>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
          <span style={{ fontSize: 6.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, color: hexToRgba(color, 0.48), letterSpacing: '0.10em', textTransform: 'uppercase' }}>PR</span>
          <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color }}>{prPct.toFixed(1)}%</span>
        </div>
        <div style={{ width: '100%', textAlign: 'right', lineHeight: 1, marginBottom: 4 }}>
          <span className="cand-votes-full" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: '#7a7870' }}>{(prRawVotes ?? 0).toLocaleString()}</span>
          <span className="cand-votes-compact" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: '#7a7870' }}>{fmtN(prRawVotes ?? 0)}</span>
        </div>
        <div style={{ width: '100%', height: 1, background: hexToRgba(color, 0.14), marginBottom: 3 }} />
        {/* Erststimme row (secondary) */}
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
          <span style={{ fontSize: 6.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, color: hexToRgba(color, 0.48), letterSpacing: '0.10em', textTransform: 'uppercase' }}>DIST</span>
          <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: hexToRgba(color, 0.65) }}>{pct.toFixed(1)}%</span>
        </div>
        <div style={{ width: '100%', textAlign: 'right', lineHeight: 1, marginBottom: 4 }}>
          <span className="cand-votes-full" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: '#7a7870' }}>{votes.toLocaleString()}</span>
          <span className="cand-votes-compact" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: '#7a7870' }}>{fmtN(votes)}</span>
        </div>
      </>) : (<>
        {/* Erststimme only (no list data) */}
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
          <span style={{ fontSize: 6.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, color: hexToRgba(color, 0.48), letterSpacing: '0.10em', textTransform: 'uppercase' }}>DIST</span>
          <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
        </div>
        <div style={{ width: '100%', textAlign: 'right', lineHeight: 1, marginBottom: 4 }}>
          <span className="cand-votes-full" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: '#7a7870' }}>{votes.toLocaleString()}</span>
          <span className="cand-votes-compact" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: '#7a7870' }}>{fmtN(votes)}</span>
        </div>
      </>)}

      <div className="cand-bar-track" style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--bar-track)' }}>
        <div className="cand-bar-fill" style={{ height: '100%', borderRadius: 2, background: color, width: `${Math.min((prPct ?? pct) / 40 * 100, 100)}%`, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────────
const MAJORITY = Math.floor(ASSEMBLY_TOTAL / 2) + 1;
// Left → right political spectrum order for hemicycle (by KrParty.order)
const PARTY_LR_ORDER: KrPartyId[] = ['PROG', 'GJP', 'RKP', 'DEMALL', 'DPK', 'NFP', 'REF', 'PPP', 'PFP', 'LUP', 'IND', 'OTH'];

function KoreaScoreboard({ districts, currentResults, prList, directSeats: directSeatsOverride, dark, leaders }: {
  districts: KrDistrict[];
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>;
  prList?: Partial<Record<KrPartyId, number>>;
  directSeats?: Partial<Record<KrPartyId, number>>;
  dark?: boolean;
  leaders?: Partial<Record<KrPartyId, { name: string; wikiTitle?: string }>>;
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

  const { totalSeats, qualifyingParties } = useMemo(() => {
    const r = calcAssembly(districts, currentResults, prList ?? PR_VOTES_2024);
    return { totalSeats: r.totalSeats, qualifyingParties: r.eligible };
  }, [districts, currentResults, prList]);
  void directSeatsOverride;

  const { popularVote, grandTotal } = useMemo(() => {
    const pv: Partial<Record<KrPartyId, number>> = {};
    let gt = 0;
    for (const wk of districts) {
      const results = currentResults[wk.nr] ?? wk.votes;
      for (const [pid, v] of Object.entries(results) as [KrPartyId, number][]) {
        if (v > 0) { pv[pid] = (pv[pid] ?? 0) + v; gt += v; }
      }
    }
    return { popularVote: pv, grandTotal: gt };
  }, [districts, currentResults]);

  // Zweitstimmen data — use provided prop or fall back to 2025 official results
  const { zweitData, zweitTotal } = useMemo(() => {
    const zd: Partial<Record<KrPartyId, number>> = prList ?? PR_VOTES_2024;
    const zt = Object.values(zd).reduce((s, v) => s + (v ?? 0), 0);
    return { zweitData: zd, zweitTotal: zt };
  }, [prList]);

  // One card per bloc: fold each PR satellite (PFP→PPP, DemAll→DPK) into its parent,
  // combining the parent's constituency result with the satellite's party-list result.
  const cards = useMemo(() => {
    const satByParent: Partial<Record<KrPartyId, KrPartyId[]>> = {};
    for (const p of KR_PARTIES) if (p.parentId) (satByParent[p.parentId] ??= []).push(p.id);
    const isSatellite = new Set(KR_PARTIES.filter(p => p.parentId).map(p => p.id));
    return KR_PARTIES
      .filter(p => p.id !== 'OTH' && !isSatellite.has(p.id))
      .map(p => {
        const sats = satByParent[p.id] ?? [];
        const seats     = (totalSeats[p.id] ?? 0) + sats.reduce((s, id) => s + (totalSeats[id] ?? 0), 0);
        const distVotes = popularVote[p.id] ?? 0; // satellites contest no constituencies
        const prVotes   = (zweitData[p.id] ?? 0) + sats.reduce((s, id) => s + (zweitData[id] ?? 0), 0);
        const qualifies = qualifyingParties.has(p.id) || sats.some(id => qualifyingParties.has(id));
        return { id: p.id, seats, distVotes, prVotes, qualifies };
      })
      .filter(c => c.seats > 0 || c.distVotes > 0 || c.prVotes > 0 || c.qualifies)
      .sort((a, b) => b.seats - a.seats || b.prVotes - a.prVotes); // seats desc, then PR vote (≡ PR %)
  }, [totalSeats, popularVote, zweitData, qualifyingParties]);

  const maxSeats = cards.reduce((m, c) => Math.max(m, c.seats), 0);

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {cards.map(c => {
            const distPct = grandTotal > 0 ? (c.distVotes / grandTotal) * 100 : 0;
            const prPct   = zweitTotal > 0 ? (c.prVotes / zweitTotal) * 100 : 0;
            const isWinner = c.seats >= MAJORITY;
            const isLeader = c.seats > 0 && c.seats >= maxSeats;
            return (
              <ScoreboardTile key={c.id} partyId={c.id}
                totalSeats={c.seats} pct={distPct} votes={c.distVotes}
                prPct={prPct} prRawVotes={c.prVotes}
                isLeader={isLeader} isWinner={isWinner}
                hasMajority={isWinner} dark={dark} leaders={leaders}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Map controller ─────────────────────────────────────────────────────────────
function enforceNoSmooth(layer: L.GeoJSON) {
  layer.eachLayer((l: L.Layer) => {
    const p = l as any;
    if (p.options) p.options.smoothFactor = 0;
  });
}
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const h = () => { if (layerRef.current) enforceNoSmooth(layerRef.current); };
    map.on('zoomend', h);
    return () => { map.off('zoomend', h); };
  }, [map, layerRef]);

  // Invalidate Leaflet size whenever the map container resizes (e.g. scoreboard collapses)
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => { map.invalidateSize(); });
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);

  return null;
}

// ── Bubble overlay ─────────────────────────────────────────────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };

function zoomScale(zoom: number): number {
  // Full size at zoom 8+, shrinks down to 35% at zoom 4
  return Math.max(0.35, Math.min(1.0, (zoom - 4) / (8 - 4)));
}

function BubbleLayer({
  geoData, currentResults, wkLookup, containerRef, setTooltip, onSelect, currentResultsRef, dark,
}: {
  geoData: any;
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>;
  wkLookup: Record<number, KrDistrict>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: TooltipState) => void;
  onSelect: (nr: number) => void;
  currentResultsRef: React.MutableRefObject<Record<number, Partial<Record<KrPartyId, number>>>>;
  dark?: boolean;
}) {
  const map = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);

  // Rescale all markers when zoom changes
  useEffect(() => {
    const onZoom = () => {
      const scale = zoomScale(map.getZoom());
      for (const { marker, baseRadius } of bubblesRef.current) {
        marker.setRadius(baseRadius * scale);
      }
    };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);

  useEffect(() => {
    for (const { marker } of bubblesRef.current) marker.remove();
    bubblesRef.current = [];

    const scale = zoomScale(map.getZoom());
    const gj = L.geoJSON(geoData);
    gj.eachLayer((layer: L.Layer) => {
      const path = layer as any;
      const nr: number = KR_CODE_TO_NR[path.feature?.properties?.SGG_Code] ?? 0;
      const wk = wkLookup[nr];
      if (!wk) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds || !bounds.isValid()) return;
      const center = bounds.getCenter();

      const results = currentResults[nr] ?? wk.votes;
      const sorted = (Object.entries(results) as [KrPartyId, number][]).filter(([,v]) => v > 0).sort(([,a],[,b]) => b-a);
      if (sorted.length === 0) return;
      const [winId, winVotes] = sorted[0];
      const runnerUpVotes = sorted[1]?.[1] ?? 0;
      const total = sorted.reduce((s,[,v]) => s+v, 0);
      const margin = total > 0 ? ((winVotes - runnerUpVotes) / total) * 100 : 0;
      const baseRadius = 3 + Math.min(margin / 30, 1) * 10;
      const color = partyColor(winId, dark);

      const marker = L.circleMarker(center, {
        radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1, opacity: 0.9,
      }).addTo(map);

      marker.on('click', () => { setTooltip(null); onSelect(nr); });

      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const r = currentResultsRef.current[nr] ?? wk.votes;
        const tot = Object.values(r).reduce((s, v) => s + (v ?? 0), 0);
        const parties = (Object.entries(r) as [KrPartyId, number][])
          .filter(([,v]) => v > 0).sort(([,a],[,b]) => b-a).slice(0,5)
          .map(([id, votes]) => ({ id, votes, pct: tot > 0 ? (votes/tot)*100 : 0 }));
        const winner = parties[0]?.id ?? null;
        const name = wk.name;
        const state = wk.stateName;
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name, nr, state, parties, winner });
      });

      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });

    return () => {
      for (const { marker } of bubblesRef.current) marker.remove();
      bubblesRef.current = [];
    };
  }, [map, geoData, currentResults, wkLookup]);

  return null;
}

// ── Map ────────────────────────────────────────────────────────────────────────
function KoreaMapView({
  districts, currentResults, selectedNr, onSelect, dark, bubbleMap,
  multiSelectMode, selectedNrs, onMultiSelect,
}: {
  districts: KrDistrict[];
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>;
  selectedNr: number | null;
  onSelect: (nr: number) => void;
  dark: boolean;
  bubbleMap: boolean;
  multiSelectMode?: boolean;
  selectedNrs?: Set<number>;
  onMultiSelect?: (nr: number) => void;
}) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const layerRef       = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const currentResultsRef  = useRef(currentResults);
  const selectedNrRef      = useRef(selectedNr);
  const darkRef            = useRef(dark);
  const bubbleMapRef       = useRef(bubbleMap);
  const multiSelectModeRef = useRef(multiSelectMode);
  const selectedNrsRef     = useRef(selectedNrs);
  const onMultiSelectRef   = useRef(onMultiSelect);
  const onSelectRef        = useRef(onSelect);
  useEffect(() => { currentResultsRef.current   = currentResults;  }, [currentResults]);
  useEffect(() => { selectedNrRef.current       = selectedNr;      }, [selectedNr]);
  useEffect(() => { darkRef.current             = dark;            }, [dark]);
  useEffect(() => { bubbleMapRef.current        = bubbleMap;       }, [bubbleMap]);
  useEffect(() => { multiSelectModeRef.current  = multiSelectMode; }, [multiSelectMode]);
  useEffect(() => { selectedNrsRef.current      = selectedNrs;     }, [selectedNrs]);
  useEffect(() => { onMultiSelectRef.current    = onMultiSelect;   }, [onMultiSelect]);
  useEffect(() => { onSelectRef.current         = onSelect;        }, [onSelect]);

  const wkLookup = useMemo(() => {
    const m: Record<number, KrDistrict> = {};
    for (const wk of districts) m[wk.nr] = wk;
    return m;
  }, [districts]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}south-korea-constituencies.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  useEffect(() => {
    if (layerRef.current) enforceNoSmooth(layerRef.current);
  }, [geoData]);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const nr: number = KR_CODE_TO_NR[feature?.properties?.SGG_Code] ?? 0;
    const wk = wkLookup[nr];
    const results = currentResultsRef.current[nr] ?? wk?.votes ?? {};
    const fill = getWkFill(results, darkRef.current);
    const isSelected = nr === selectedNrRef.current;
    const isMultiSel = selectedNrsRef.current?.has(nr) ?? false;
    const borderColor = darkRef.current ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';
    if (bubbleMapRef.current) {
      return {
        fillOpacity: 0, weight: 0.4,
        color: darkRef.current ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)', opacity: 0.6,
      };
    }
    return {
      fillColor: fill, fillOpacity: 0.78,
      weight: (isSelected || isMultiSel) ? 2 : 0.4,
      color: isMultiSel ? '#2563EB' : (isSelected ? '#c8a020' : borderColor),
      opacity: 1,
    };
  }, [wkLookup]);

  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.setStyle((f: any) => getStyle(f));
  }, [currentResults, selectedNr, selectedNrs, dark, bubbleMap, getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const nr: number = KR_CODE_TO_NR[feature?.properties?.SGG_Code] ?? 0;
    const wkFeat = wkLookup[nr];
    const name: string = wkFeat?.name ?? '';
    const stateName: string = wkFeat?.stateName ?? '';

    layer.on('click', () => {
      if (multiSelectModeRef.current && onMultiSelectRef.current) {
        onMultiSelectRef.current(nr);
      } else {
        onSelectRef.current(nr);
      }
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleMapRef.current || multiSelectModeRef.current) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wk = wkLookup[nr];
      const results = currentResultsRef.current[nr] ?? wk?.votes ?? {};
      const total = Object.values(results).reduce((s, v) => s + (v ?? 0), 0);
      const parties = (Object.entries(results) as [KrPartyId, number][])
        .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5)
        .map(([id, votes]) => ({ id, votes, pct: total > 0 ? (votes / total) * 100 : 0 }));
      const winner = parties[0]?.id ?? null;
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name, nr, state: stateName, parties, winner });
    });

    layer.on('mouseout', () => setTooltip(null));
  }, [wkLookup]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer
        center={[36.3, 127.8]} zoom={7} minZoom={5} maxZoom={14}
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
        <MapController layerRef={layerRef} />
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
          <BubbleLayer
            geoData={geoData}
            currentResults={currentResults}
            wkLookup={wkLookup}
            containerRef={containerRef}
            setTooltip={setTooltip}
            onSelect={onSelect}
            currentResultsRef={currentResultsRef}
            dark={dark}
          />
        )}
      </MapContainer>

      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 230;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = {
          bg: dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
          title: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
          sub: dark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.42)',
          body: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
          muted: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.40)',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: tt.shadow, backdropFilter: 'blur(10px)', padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>{tooltip.name}</div>
              <div style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 2 }}>{tooltip.state}</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tooltip.parties.map(({ id, votes, pct }, i) => {
                  const p = KR_PARTY_MAP[id];
                  const pColor = partyColor(id, dark);
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: pColor }} />
                      <span style={{ flex: 1, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name ?? id}</span>
                      <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, marginRight: 4 }}>{votes.toLocaleString()}</span>
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

// ── Panel helpers ──────────────────────────────────────────────────────────────
function toPcts(results: Partial<Record<KrPartyId, number>>, ids: KrPartyId[]): Record<KrPartyId, number> {
  const total = ids.reduce((s, id) => s + (results[id] ?? 0), 0);
  if (total === 0) return Object.fromEntries(ids.map(id => [id, 100 / ids.length])) as Record<KrPartyId, number>;
  return Object.fromEntries(ids.map(id => [id, ((results[id] ?? 0) / total) * 100])) as Record<KrPartyId, number>;
}

function redistributePcts(current: Record<KrPartyId, number>, changedId: KrPartyId, newRaw: number, locks: Set<KrPartyId>): Record<KrPartyId, number> {
  const ids = Object.keys(current) as KrPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<KrPartyId, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) {
    for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  } else if (unlocked.length > 0) {
    const share = remaining / unlocked.length;
    for (const id of unlocked) next[id] = share;
  }
  return next;
}

// ── Constituency panel ─────────────────────────────────────────────────────────
function DistrictPanel({ wk, results, onClose, onUpdate, dark, isBlank, isProjected, onProject }: {
  wk: KrDistrict;
  results: Partial<Record<KrPartyId, number>>;
  onClose: () => void;
  onUpdate: (nr: number, newResults: Partial<Record<KrPartyId, number>>) => void;
  dark?: boolean;
  isBlank?: boolean;
  isProjected?: boolean;
  onProject?: () => void;
}) {
  const ids: KrPartyId[] = useMemo(
    () => KR_PARTIES.filter(p => p.tier !== 'pr' && p.id !== 'OTH').map(p => p.id),
    []
  );

  const [pcts, setPcts]     = useState<Record<KrPartyId, number>>(() => toPcts(results, ids));
  const [locks, setLocks]   = useState<Set<KrPartyId>>(new Set());
  const [editId, setEditId] = useState<KrPartyId | null>(null);
  const [editVal, setEditVal] = useState('');
  const [reporting, setReporting] = useState(100); // % of votes counted (blank-map / election-night)

  const pctsRef  = useRef(pcts);
  const locksRef = useRef(locks);
  useEffect(() => { pctsRef.current  = pcts;  }, [pcts]);
  useEffect(() => { locksRef.current = locks; }, [locks]);

  useEffect(() => {
    setPcts(toPcts(results, ids));
    setLocks(new Set());
    setEditId(null);
    setReporting(100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wk.nr]);

  const basePcts = useMemo(() => toPcts(wk.votes, ids), [wk.votes, ids]);

  const sortedIds = useMemo(
    () => [...ids].sort((a, b) => (results[b] ?? 0) - (results[a] ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, wk.nr]
  );

  const total = wk.validVotes;
  const winnerId = sortedIds.length > 0
    ? sortedIds.reduce((best, id) => (pcts[id] ?? 0) > (pcts[best] ?? 0) ? id : best)
    : undefined;
  const winnerParty = winnerId ? KR_PARTY_MAP[winnerId] : null;
  const winnerColor = winnerId ? partyColor(winnerId, dark ?? false) : '#888';
  const winnerPct = winnerId ? (pcts[winnerId] ?? 0) : 0;
  const runnerUpId = sortedIds.find(id => id !== winnerId);
  const margin = runnerUpId ? winnerPct - (pcts[runnerUpId] ?? 0) : winnerPct;

  function applyChange(id: KrPartyId, val: number) {
    const newPcts = redistributePcts(pctsRef.current, id, val, locksRef.current);
    pctsRef.current = newPcts;
    setPcts(newPcts);
    if (!isBlank) {
      const newVotes = Object.fromEntries(sortedIds.map(cid => [cid, Math.round((newPcts[cid] ?? 0) * total / 100)]));
      onUpdate(wk.nr, newVotes);
    }
  }

  function toggleLock(id: KrPartyId) {
    setLocks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (sortedIds.filter(i => !next.has(i) && i !== id).length >= 1) next.add(id);
      return next;
    });
  }

  function commitEdit(id: KrPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight truncate">{wk.name}</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {wk.stateName} · {total.toLocaleString()} votes
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>

        {winnerParty && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] bg-[#f8f7f4] border border-default"
            style={{ borderColor: `${winnerColor}33` }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: winnerColor }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winnerParty.name}</span>
            <span className="text-[9px] font-mono text-ink-3">{winnerPct.toFixed(1)}% · +{margin.toFixed(1)}pp</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
        {isBlank && (
          <div className="pb-2.5 mb-1 border-b border-default">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-ink-3">% Reporting</span>
              <span className="text-[10px] font-mono font-bold tabular-nums text-ink">{reporting}%</span>
            </div>
            <input type="range" min={0} max={100} step={1} value={reporting}
              onChange={e => setReporting(parseInt(e.target.value, 10))}
              className="party-slider w-full"
              style={{ '--party-color': '#c8a020', '--pct': `${reporting}%` } as React.CSSProperties} />
            <div className="text-[8px] font-mono text-ink-3 mt-0.5">{Math.round(total * reporting / 100).toLocaleString()} of {total.toLocaleString()} votes counted</div>
          </div>
        )}
        {sortedIds.map(id => {
          const party = KR_PARTY_MAP[id];
          const color = partyColor(id, dark ?? false);
          const pct = pcts[id] ?? 0;
          const base = basePcts[id] ?? 0;
          const delta = pct - base;
          const rawVotes = Math.round((pct / 100) * total * (reporting / 100));
          const isLocked = locks.has(id);
          return (
            <div key={id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.name}</span>
                {!isProjected && (
                  <button onClick={() => toggleLock(id)} title={isLocked ? 'Unlock' : 'Lock'}
                    className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${locks.has(id) ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>
                    {locks.has(id) ? (
                      <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    ) : (
                      <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    )}
                  </button>
                )}
                {editId === id && !isProjected ? (
                  <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                    className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink-2"
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(id, editVal)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(id, editVal); }
                      if (e.key === 'Escape') { setEditId(null); setEditVal(''); }
                    }} />
                ) : (
                  <span onClick={() => { if (!isLocked) { setEditId(id); setEditVal(pct.toFixed(1)); } }}
                    className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none"
                    style={{ cursor: isLocked ? 'default' : 'text' }}>
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(id, parseFloat(e.target.value))}
                className="party-slider w-full"
                style={{ '--party-color': color, '--pct': `${pct}%` } as React.CSSProperties}
              />
              <div className="flex justify-between items-center mt-0.5">
                <span className="text-[8px] font-mono tabular-nums text-ink-3">{rawVotes.toLocaleString()} votes</span>
                {Math.abs(delta) > 0.05 && (
                  <span className={`text-[8px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}pp
                  </span>
                )}
              </div>
              <div className="text-[8px] font-mono tabular-nums text-ink-3/55 leading-none mt-px">2024 · {base.toFixed(1)}% · {Math.round((base / 100) * total).toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      <div className="px-3.5 py-2 border-t border-default space-y-1.5">
        {isBlank && (
          <button
            onClick={() => {
              const f = total * reporting / 10000;
              const newVotes = Object.fromEntries(sortedIds.map(cid => [cid, Math.round((pcts[cid] ?? 0) * f)]));
              onUpdate(wk.nr, newVotes);
              onProject?.();
            }}
            className={`w-full py-2 flex items-center justify-center gap-1.5 text-[11px] font-mono font-bold rounded-[4px] text-white transition-colors ${isProjected ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            {isProjected && (
              <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M3.5 6.5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            {isProjected ? 'Update Projection' : 'Project Result'}
          </button>
        )}
        {!isProjected && (
          <button
            onClick={() => { setPcts(toPcts(wk.votes, ids)); setLocks(new Set()); setEditId(null); if (!isBlank) onUpdate(wk.nr, wk.votes); }}
            className="w-full py-1.5 text-[10px] font-mono rounded-[4px] border border-default text-ink-3 hover:bg-hover transition-colors"
          >Reset to 2024</button>
        )}
      </div>
    </aside>
  );
}

function PRPanel({ votes, onVotesChange, directSeats, onClose, exiting, dark }: {
  votes: Record<KrPartyId, number>;
  onVotesChange: (v: Record<KrPartyId, number>) => void;
  directSeats: Partial<Record<KrPartyId, number>>;
  onClose: () => void;
  exiting?: boolean;
  dark: boolean;
}) {
  // Convert incoming raw votes to percentages (over the fixed grand total)
  const rawToZweitPcts = (raw: Record<KrPartyId, number>): Record<KrPartyId, number> =>
    Object.fromEntries(
      KR_PARTIES.filter(p => p.id !== 'OTH').map(p => [
        p.id,
        parseFloat(((raw[p.id] ?? 0) / PR_GRAND_TOTAL_2024 * 100).toFixed(2)),
      ])
    ) as Record<KrPartyId, number>;

  const [pcts, setPcts] = useState<Record<KrPartyId, number>>(() => rawToZweitPcts(votes));
  const [locks, setLocks] = useState<Set<KrPartyId>>(new Set());
  const [editId, setEditId] = useState<KrPartyId | null>(null);
  const [editVal, setEditVal] = useState('');

  // Rebuild pcts if parent votes change (e.g. Reset preset)
  const prevVotesRef = useRef(votes);
  useEffect(() => {
    if (prevVotesRef.current !== votes) {
      prevVotesRef.current = votes;
      setPcts(rawToZweitPcts(votes));
      setLocks(new Set());
      setEditId(null);
    }
  }, [votes]);

  const pctsRef = useRef(pcts);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);

  const sum = useMemo(() => Object.values(pcts).reduce((s, v) => s + (v ?? 0), 0), [pcts]);
  const sumOk = Math.abs(sum - 100) < 0.015;

  function pctToRaw(p: Record<KrPartyId, number>): Record<KrPartyId, number> {
    return Object.fromEntries(
      KR_PARTIES.map(party => [
        party.id,
        Math.round((p[party.id as KrPartyId] ?? 0) / 100 * PR_GRAND_TOTAL_2024),
      ])
    ) as Record<KrPartyId, number>;
  }

  function applyPctChange(id: KrPartyId, newVal: number) {
    const clamped = Math.max(0, Math.min(100, newVal));
    const next = { ...pctsRef.current, [id]: clamped };
    pctsRef.current = next;
    setPcts(next);
    onVotesChange(pctToRaw(next));
  }

  function commitEdit(id: KrPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyPctChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  function toggleLock(id: KrPartyId) {
    setLocks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function resetTo2025() {
    const trackedSum = Object.values(PR_VOTES_2024).reduce((s, v) => s + (v ?? 0), 0);
    const raw = {
      ...Object.fromEntries(KR_PARTIES.filter(p => p.id !== 'OTH').map(p => [p.id, PR_VOTES_2024[p.id] ?? 0])),
      OTH: PR_GRAND_TOTAL_2024 - trackedSum,
    } as Record<KrPartyId, number>;
    onVotesChange(raw);
    setPcts(rawToZweitPcts(raw));
    setLocks(new Set());
    setEditId(null);
  }

  const { totalSeats, listSeats, constSeats, qualifyingParties } = useMemo(() => {
    const { prSeats, eligible } = calcPRSeats(votes, directSeats);
    const tot: Partial<Record<KrPartyId, number>> = {};
    for (const p of KR_PARTIES) { const t = (directSeats[p.id] ?? 0) + (prSeats[p.id] ?? 0); if (t > 0) tot[p.id] = t; }
    return { totalSeats: tot, listSeats: prSeats, constSeats: directSeats, qualifyingParties: eligible };
  }, [votes, directSeats]);

  const grandTotalSeats = Object.values(totalSeats).reduce((s, v) => s + (v ?? 0), 0);

  const sortedParties = useMemo(() => KR_PARTIES.filter(p => p.id !== 'OTH')
    .map(p => ({
      ...p,
      pct: pcts[p.id] ?? 0,
      rawVotes: Math.round((pcts[p.id] ?? 0) / 100 * PR_GRAND_TOTAL_2024),
      total: totalSeats[p.id] ?? 0, list: listSeats[p.id] ?? 0, const_: constSeats[p.id] ?? 0,
      qualifies: qualifyingParties.has(p.id), direct: directSeats[p.id] ?? 0,
    }))
    .sort((a, b) => b.total - a.total || b.pct - a.pct),
  [pcts, totalSeats, listSeats, constSeats, qualifyingParties, directSeats]);

  const inputIds = useMemo(() =>
    KR_PARTIES.filter(p => p.id !== 'OTH')
      .sort((a, b) => (pcts[b.id] ?? 0) - (pcts[a.id] ?? 0))
      .map(p => p.id),
  [pcts]);

  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-slide-out' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[14px] font-bold text-ink">Party List (PR)</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5">Party List (PR) · {grandTotalSeats}/{ASSEMBLY_TOTAL} seats · semi-linked</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {/* Seat allocation summary */}
        <div className="px-3.5 pt-3 pb-2.5 border-b border-default space-y-1.5">
          <div className="flex h-3 rounded overflow-hidden mb-2">
            {sortedParties.filter(p => p.qualifies).map(p => (
              <div key={p.id} title={`${p.name}: ${p.total}`}
                style={{ width: `${(p.total / ASSEMBLY_TOTAL) * 100}%`, background: partyColor(p.id, dark) }} />
            ))}
          </div>
          {sortedParties.filter(p => p.qualifies || p.direct >= DIRECT_THRESHOLD).map(p => (
            <div key={p.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: partyColor(p.id, dark) }} />
              <span className="text-[9px] font-medium text-ink w-12 shrink-0">{p.name}</span>
              <div className="flex-1 h-1 rounded overflow-hidden" style={{ background: dark ? 'rgba(80,140,220,0.13)' : 'rgba(0,0,0,0.07)' }}>
                {p.qualifies && <div style={{ width: `${(p.total / ASSEMBLY_TOTAL) * 100}%`, height: '100%', background: partyColor(p.id, dark) }} />}
              </div>
              {p.qualifies ? <>
                <span className="text-[8px] font-mono text-ink-3 tabular-nums w-5 text-right">{p.const_}C</span>
                <span className="text-[8px] text-ink-3">+</span>
                <span className="text-[8px] font-mono text-ink-3 tabular-nums w-5">{p.list}L</span>
                <span className="text-[10px] font-mono font-bold tabular-nums w-7 text-right" style={{ color: partyColor(p.id, dark) }}>{p.total}</span>
              </> : <span className="text-[8px] font-mono text-amber-600 ml-auto">below threshold</span>}
            </div>
          ))}
          <p className="text-[7.5px] font-mono text-ink-3 text-center pt-1">5% threshold or ≥{DIRECT_THRESHOLD} direct wins · SSW exempt</p>
        </div>

        {/* Per-party percentage inputs */}
        <div className="px-3.5 py-3 space-y-1.5">
          <div className="flex items-center gap-1 mb-2 text-[7.5px] font-mono text-ink-3 uppercase tracking-wider">
            <span className="flex-1">Party</span>
            <span className="w-16 text-right shrink-0">%</span>
            <span className="w-20 text-right shrink-0">Raw votes</span>
            <span className="w-8 text-right shrink-0">Δ pp</span>
            <span className="w-4" />
          </div>
          {inputIds.map(id => {
            const color = partyColor(id, dark);
            const pct = pcts[id] ?? 0;
            const rawVotes = Math.round(pct / 100 * PR_GRAND_TOTAL_2024);
            const qualifies = qualifyingParties.has(id);
            const isLocked = locks.has(id);
            const base2025 = PR_VOTES_2024[id] ?? 0;
            const basePct2025 = parseFloat((base2025 / PR_GRAND_TOTAL_2024 * 100).toFixed(2));
            const delta = pct - basePct2025;
            const isEditing = editId === id;
            return (
              <div key={id} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 ml-0.5 mr-0.5" style={{ background: color }} />
                <span className="text-[9.5px] font-medium text-ink truncate" style={{ minWidth: 0, flex: 1 }}>{KR_PARTY_MAP[id].name}</span>
                {isEditing
                  ? <input type="number" min={0} max={100} step={0.01} value={editVal} autoFocus
                      className="w-16 h-6 text-[9.5px] font-mono tabular-nums text-right px-1.5 rounded border focus:outline-none bg-white shrink-0"
                      style={{ borderColor: color }}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(id, editVal)}
                      onKeyDown={e => { if (e.key==='Enter') commitEdit(id, editVal); if (e.key==='Escape') { setEditId(null); setEditVal(''); } }} />
                  : <button disabled={isLocked}
                      onClick={() => { if (!isLocked) { setEditId(id); setEditVal(pct.toFixed(2)); } }}
                      className="w-16 h-6 text-[9.5px] font-mono tabular-nums text-right px-1.5 rounded border border-default hover:border-ink-3 disabled:opacity-50 disabled:cursor-default transition-colors shrink-0"
                      style={{ color: qualifies ? color : '#9ca3af' }}>
                      {pct.toFixed(2)}%
                    </button>}
                <span className="w-20 text-[8px] font-mono tabular-nums text-ink-3 text-right shrink-0">{rawVotes.toLocaleString()}</span>
                <span className={`w-8 text-[7.5px] font-mono tabular-nums text-right shrink-0 ${Math.abs(delta) > 0.005 ? (delta > 0 ? 'text-emerald-600' : 'text-red-500') : 'text-ink-3'}`}>
                  {Math.abs(delta) > 0.005 ? `${delta > 0 ? '+' : ''}${delta.toFixed(2)}` : ''}
                </span>
                <button onClick={() => toggleLock(id)} title={isLocked ? 'Unlock' : 'Lock'}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>
                  {isLocked
                    ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                </button>
              </div>
            );
          })}
          {/* Sum line */}
          <div className="flex items-center gap-1 pt-1.5 border-t border-default mt-1">
            <span className="flex-1 text-[8.5px] font-mono text-ink-3">Total</span>
            <span className={`text-[9px] font-mono font-bold tabular-nums shrink-0 ${sumOk ? 'text-emerald-600' : 'text-red-500'}`}>
              {sum.toFixed(2)}%
            </span>
            <span className="w-20" /><span className="w-8" /><span className="w-4" />
          </div>
        </div>

        <div className="px-3.5 pb-3">
          <button onClick={resetTo2025} className="w-full py-1.5 text-[10px] font-mono rounded-[4px] border border-default text-ink-3 hover:bg-hover transition-colors">
            Reset to 2024 official
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── State breakdown panel ──────────────────────────────────────────────────────
function BreakdownPanel({ districts, currentResults, prVotes, onClose, exiting, dark }: {
  districts: KrDistrict[];
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>;
  prVotes: Record<KrPartyId, number> | null;
  onClose: () => void;
  exiting?: boolean;
  dark?: boolean;
  isBaseline?: boolean;
}) {
  const { stateRows, activePids, grandTotals, grandDirect, grandList } = useMemo(() => {

    // Group WKs by state (needed for all modes)
    const stateMap = new Map<string, { name: string; wks: KrDistrict[] }>();
    for (const wk of districts) {
      if (!stateMap.has(wk.state)) stateMap.set(wk.state, { name: wk.stateName, wks: [] });
      stateMap.get(wk.state)!.wks.push(wk);
    }

    // Per-state breakdown
    const rows: {
      stateCode: string; name: string; wkCount: number;
      direct: Partial<Record<KrPartyId, number>>;
      list:   Partial<Record<KrPartyId, number>>;
      total:  Partial<Record<KrPartyId, number>>;
      directTotal: number; listTotal: number; stateTotal: number;
      listIsExact: boolean;
    }[] = [];

    // South Korea: constituency seats are regional (FPTP); the 46 PR seats are a single national pool.
    const natDirect = calcConstituencySeats(districts, currentResults);
    const { prSeats: natList } = calcPRSeats(prVotes ?? PR_VOTES_2024, natDirect);
    const natTotal: Partial<Record<KrPartyId, number>> = {};
    for (const p of KR_PARTIES) {
      const t = (natDirect[p.id] ?? 0) + (natList[p.id] ?? 0);
      if (t > 0) natTotal[p.id] = t;
    }

    // Per-region constituency (FPTP) seats from current results
    for (const [stateCode, { name, wks }] of stateMap) {
      const direct: Partial<Record<KrPartyId, number>> = {};
      for (const wk of wks) {
        const r = currentResults[wk.nr] ?? wk.votes;
        let winner: KrPartyId | null = null, maxV = 0;
        for (const [pid, v] of Object.entries(r) as [KrPartyId, number][]) {
          if ((v ?? 0) > maxV) { maxV = v; winner = pid as KrPartyId; }
        }
        if (winner) direct[winner] = (direct[winner] ?? 0) + 1;
      }
      const directTotal = Object.values(direct).reduce((s, v) => s + (v ?? 0), 0);
      rows.push({ stateCode, name, wkCount: wks.length, direct, list: {}, total: { ...direct }, directTotal, listTotal: 0, stateTotal: directTotal, listIsExact: true });
    }
    rows.sort((a, b) => b.wkCount - a.wkCount);

    // National PR pool (46 seats) as its own card
    const prTotalSeats = Object.values(natList).reduce((s, v) => s + (v ?? 0), 0);
    if (prTotalSeats > 0) {
      rows.push({ stateCode: "PR", name: "Proportional — national list (46)", wkCount: 0, direct: {}, list: { ...natList }, total: { ...natList }, directTotal: 0, listTotal: prTotalSeats, stateTotal: prTotalSeats, listIsExact: true });
    }

    const grandTotals = natTotal, grandDirect = natDirect, grandList = natList;
    const activePids = KR_PARTIES
      .filter(p => p.id !== "OTH" && (grandTotals[p.id] ?? 0) > 0)
      .sort((a, b) => (grandTotals[b.id] ?? 0) - (grandTotals[a.id] ?? 0))
      .map(p => p.id);

    return { stateRows: rows, activePids, grandTotals, grandDirect, grandList };
  }, [districts, currentResults, prVotes]);

  const grandTotal = Object.values(grandTotals).reduce((s, v) => s + (v ?? 0), 0);

  return (
    <aside className={`w-80 shrink-0 flex flex-col overflow-hidden border-l border-default ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} ${exiting ? 'panel-slide-out' : 'panel-slide'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0`}>
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">Regional Breakdown</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
            Constituency seats per region · national PR pool
          </p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      {/* National summary row */}
      <div className={`px-3.5 py-2 border-b border-default shrink-0 ${dark ? 'bg-white/4' : 'bg-[#f8f7f4]'}`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-ink-3">National Total — {grandTotal} seats</span>
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-1">
          {activePids.map(pid => {
            const color = partyColor(pid, dark ?? false);
            return (
              <div key={pid} className="flex items-center gap-1 text-[8.5px]">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="font-mono font-semibold text-ink">{pid}</span>
                <span className="font-mono text-ink-3">{grandDirect[pid] ?? 0}+{grandList[pid] ?? 0}=<span className="font-bold text-ink">{grandTotals[pid] ?? 0}</span></span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-state cards */}
      <div className="flex-1 overflow-y-auto thin-scroll divide-y divide-default">
        {stateRows.map(({ stateCode, name, wkCount, direct, list, total, directTotal, listTotal, stateTotal, listIsExact }) => {
          const directSorted = (Object.entries(direct) as [KrPartyId, number][]).sort(([,a],[,b]) => b - a);
          const listSorted   = (Object.entries(list)   as [KrPartyId, number][]).sort(([,a],[,b]) => b - a);
          const stateActive  = activePids.filter(pid => (total[pid] ?? 0) > 0);

          return (
            <div key={stateCode} className="px-3.5 py-2.5">
              {/* State header */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-ink truncate pr-2">{name}</span>
                <span className="text-[8px] font-mono text-ink-3 shrink-0">{wkCount} WKs · {stateTotal} seats</span>
              </div>

              {/* Direct bar */}
              <div className="mb-1">
                <div className="text-[7px] font-mono uppercase tracking-wider text-ink-3 mb-0.5">Direct ({directTotal})</div>
                <div className="flex h-1.5 rounded overflow-hidden bg-black/8">
                  {directSorted.map(([pid, n]) => (
                    <div key={pid} title={`${pid}: ${n} direct`}
                      style={{ width: `${(n / wkCount) * 100}%`, background: partyColor(pid, dark ?? false) }} />
                  ))}
                </div>
              </div>

              {/* List bar */}
              {listTotal > 0 && (
                <div className="mb-1.5">
                  <div className="text-[7px] font-mono uppercase tracking-wider text-ink-3 mb-0.5">
                    {listIsExact ? `List ${listTotal}` : `~List ${listTotal}`}
                  </div>
                  <div className="flex h-1.5 rounded overflow-hidden bg-black/8">
                    {listSorted.map(([pid, n]) => (
                      <div key={pid} title={`${pid}: ${listIsExact ? '' : '~'}${n} list`}
                        style={{ width: `${(n / Math.max(listTotal, 1)) * 100}%`, background: partyColor(pid, dark ?? false), opacity: 0.75 }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Party totals grid */}
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                {stateActive.map(pid => {
                  const d = direct[pid] ?? 0;
                  const l = list[pid]   ?? 0;
                  const t = total[pid]  ?? 0;
                  return (
                    <div key={pid} className="flex items-center gap-0.5 text-[8px]">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: partyColor(pid, dark ?? false) }} />
                      <span className="font-mono font-semibold text-ink">{pid}</span>
                      <span className="font-mono text-ink-3">{d}+{l}=</span>
                      <span className="font-mono font-bold text-ink">{t}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Tutorial panel ─────────────────────────────────────────────────────────────
function TutorialPanel({ onClose, exiting }: { onClose: () => void; exiting?: boolean }) {
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
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">National Assembly Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">

        {/* ── The Korean system ── */}
        <H2>The Korean Electoral System</H2>
        <P>South Korea elects its <strong>300-seat National Assembly</strong> with a <strong>mixed system</strong>. Every voter casts <strong>two votes</strong>:</P>
        <div className="flex gap-2 mb-2">
          <div className="flex-1 bg-[#f8f7f4] border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">Jiyeokgu · District</div>
            <div className="text-[10px] text-ink-2 leading-relaxed">First-past-the-post in each of the <strong>254</strong> single-member constituencies. Most votes wins.</div>
          </div>
          <div className="flex-1 bg-[#f8f7f4] border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">Biryedaepyo · Party List</div>
            <div className="text-[10px] text-ink-2 leading-relaxed">A separate party vote that allocates the <strong>46</strong> proportional (PR) seats.</div>
          </div>
        </div>
        <Note>A party's total = constituency wins + PR seats. The tiers are largely parallel, with a partial proportional top-up on the PR side.</Note>

        {/* ── Satellite parties ── */}
        <H2>Satellite Parties (2024)</H2>
        <P>PR seats use a <strong>semi-linked</strong> formula (jun-yeondong) that <em>subtracts</em> a party's district wins from its proportional entitlement. To dodge it, the two majors ran <strong>satellite list parties</strong>:</P>
        <div className="space-y-1 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div>• <strong>People Power Party</strong> → list satellite <strong>People Future</strong> (Gukminui-mirae).</div>
          <div>• <strong>Democratic Party</strong> → list satellite <strong>Democratic Alliance</strong> (Deobureo-minju-yeonhap).</div>
        </div>
        <Note>The satellites won zero districts, so the subtraction didn't bite — they captured the PR seats their parents couldn't. They appear in their parent's colour. This reproduces the real 2024 Assembly exactly.</Note>

        {/* ── Seat calculation ── */}
        <H2>How PR Seats Are Allocated</H2>
        <P>Only parties past the <em>threshold</em> share the 46 PR seats:</P>
        <div className="bg-[#f8f7f4] border border-default rounded-[4px] px-2.5 py-2 mb-2 space-y-1">
          <div className="flex items-start gap-2 text-[10px] text-ink-2"><span className="text-emerald-600 font-bold shrink-0">✓</span><span><strong>≥ 3%</strong> of the national party-list vote, OR</span></div>
          <div className="flex items-start gap-2 text-[10px] text-ink-2"><span className="text-emerald-600 font-bold shrink-0">✓</span><span>won <strong>≥ 5 constituency seats</strong>.</span></div>
        </div>
        <P>Each qualifying party's linked entitlement is roughly <em>½ × (its proportional share of 300 − its constituency seats)</em>. In 2024 all 46 PR seats used this formula — yielding People Future 18, Democratic Alliance 14, Rebuilding Korea 12, Reform 2.</P>
        <Note>Blocs: Democratic 175 (161+14) · People Power 108 (90+18) · Rebuilding Korea 12 · Reform 3 · New Future 1 · Progressive 1.</Note>

        {/* ── Presets ── */}
        <H2>Map Presets</H2>
        <div className="space-y-2 mb-2">
          <div><Tag>2024 Baseline</Tag><span className="text-[10px] text-ink-2">The actual 10 April 2024 (22nd) National Assembly result.</span></div>
          <div><Tag>2026 Polling</Tag><span className="text-[10px] text-ink-2">A projection (post-2025 realignment) applied as a uniform swing. The next real election is 2028.</span></div>
          <div><Tag>Blank Map</Tag><span className="text-[10px] text-ink-2">All districts empty — project results manually, election-night style.</span></div>
        </div>

        {/* ── Editing a district ── */}
        <H2>Editing a Constituency</H2>
        <P>Click any shaded district to open its panel on the right.</P>
        <Step n={1}>Drag a party's slider <em>or</em> click its percentage to type a value.</Step>
        <Step n={2}>Adjusting one party redistributes the rest among unlocked parties.</Step>
        <Step n={3}>Click the <strong>lock icon</strong> to fix a party's share while you change others.</Step>
        <Step n={4}>Hit <Tag>Reset to 2024</Tag> to restore that seat's official result, or open the in-panel <Tag>Baseline</Tag> reference to see the 2024 numbers.</Step>

        {/* ── Blank map ── */}
        <H2>Blank Map Mode</H2>
        <Note>In Blank Map mode nothing updates until you explicitly project — like watching returns come in on election night. The % reporting slider (top of the panel) scales the raw votes shown.</Note>
        <Step n={1}>Open <Tag color="border border-gold text-gold bg-transparent">Party List</Tag> and enter the national PR vote shares.</Step>
        <Step n={2}>Click a district, set the sliders and % reporting, then click <Tag color="bg-emerald-600 text-white">Project Result</Tag> — only then do the map and dashboard update for that seat.</Step>
        <Step n={3}>Re-click <Tag color="bg-emerald-600 text-white">Update</Tag> to revise a seat. Projected seats show a green badge.</Step>

        {/* ── Party list ── */}
        <H2>Party List Panel</H2>
        <P>The <Tag>Party List</Tag> panel sets each list party's <strong>PR vote %</strong> (shares renormalise to 100%). It shows live PR-seat allocation. A party below 3% with fewer than 5 district wins shows <strong>0 PR seats</strong> — blocked by the threshold.</P>

        {/* ── Multi-select ── */}
        <H2>Multi-Select</H2>
        <P>Click <Tag>Multi-select</Tag>, then click several districts. Apply one uniform swing (e.g. <em>DPK +5pp</em>) across all selected seats at once.</P>

        {/* ── Simulation ── */}
        <H2>Election Night Simulation</H2>
        <P>Click <Tag>▶ Simulation</Tag>, set target district + party-list shares, and pick a duration (1, 2, 5 or 10 minutes).</P>
        <P>Districts are called in random batches on a bell-curve schedule. Hover a called seat to see its % reported and current count; the scoreboard updates live. The Parties button locks while a sim runs.</P>

        {/* ── Scoreboard ── */}
        <H2>Reading the Scoreboard</H2>
        <P>Cards are ordered by seats. Each shows:</P>
        <div className="space-y-1.5 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div className="flex items-start gap-2"><span className="shrink-0 font-mono font-bold text-ink w-10">PR</span><span>Party-list % and raw votes.</span></div>
          <div className="flex items-start gap-2"><span className="shrink-0 font-mono font-bold text-ink w-10">DIST</span><span>Constituency vote % and raw votes.</span></div>
          <div className="flex items-start gap-2"><span className="shrink-0 font-mono font-bold text-ink w-10">#</span><span>Total seats (constituency + PR), in large type.</span></div>
        </div>
        <div className="space-y-1.5 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div className="flex items-start gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-gold mt-1" /><span><strong>Gold border</strong> — most seats.</span></div>
          <div className="flex items-start gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-1" /><span><strong>Green shimmer</strong> — majority (≥ 151 seats).</span></div>
        </div>

        {/* ── Regional Breakdown ── */}
        <H2>Regional Breakdown</H2>
        <P>Click <Tag>Breakdown</Tag> for constituency seats in each of the 17 regions (Seoul, Gyeonggi, the Honam and Yeongnam provinces, etc.), plus the 46-seat national PR pool and a national summary.</P>

        {/* ── Parliament ── */}
        <H2>Parliament View</H2>
        <P>Click <Tag>Parliament</Tag> for a semicircle of all 300 seats, arranged left → right by ideology and coloured by party.</P>

        {/* ── Bubble map ── */}
        <H2>Bubble Map</H2>
        <P>Toggle <Tag color="bg-emerald-600 text-white">Bubble Map</Tag> to swap the choropleth for circles sized by <strong>raw vote margin</strong> (winner − runner-up) — a big circle means a big win in absolute votes, not just a high percentage.</P>


        <div className="h-4" />
      </div>
    </aside>
  );
}

// ── Parliament hemicycle panel ─────────────────────────────────────────────────
function ParliamentPanel({ seats: totalSeatsMap, onClose, exiting, dark }: {
  seats: Partial<Record<KrPartyId, number>>;
  onClose: () => void;
  exiting?: boolean;
  dark?: boolean;
}) {
  // Build left→right ordered seat colour array
  const seatColors: string[] = [];
  const legend: { id: KrPartyId; count: number; color: string }[] = [];
  for (const id of PARTY_LR_ORDER) {
    const n = totalSeatsMap[id] ?? 0;
    if (n === 0) continue;
    const color = partyColor(id, dark ?? false);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;

  // Hemicycle geometry
  const W = 310, H = 178;
  const cx = W / 2, cy = H - 5;
  const innerR = 58, rowSpacing = 8, rows = 12;

  // Distribute totalSeats across rows proportional to arc circumference
  const arcLengths = Array.from({ length: rows }, (_, i) => Math.PI * (innerR + i * rowSpacing));
  const totalArc = arcLengths.reduce((s, v) => s + v, 0);
  const floors = arcLengths.map(a => Math.floor((a / totalArc) * totalSeats));
  const remainder = totalSeats - floors.reduce((s, v) => s + v, 0);
  arcLengths
    .map((a, i) => ({ i, frac: (a / totalArc) * totalSeats - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, remainder)
    .forEach(({ i }) => floors[i]++);

  // Generate positions with angles, then sort "bundt cake" style:
  // left→right by angle, inner→outer within each radial column
  const rawPos: { x: number; y: number; θ: number; r: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const r = innerR + row * rowSpacing;
    const n = floors[row];
    for (let j = 0; j < n; j++) {
      const θ = Math.PI * (n - j - 0.5) / n; // π (left) → 0 (right)
      rawPos.push({ x: cx + r * Math.cos(θ), y: cy - r * Math.sin(θ), θ, r });
    }
  }
  rawPos.sort((a, b) => b.θ - a.θ || a.r - b.r); // descending θ (left first), ascending r (inner first)
  const positions = rawPos;

  const outerR = innerR + (rows - 1) * rowSpacing;
  const seatR = 2.7;

  return (
    <aside className={`w-80 shrink-0 bg-white border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit-left' : 'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">National Assembly — 300 seats</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {MAJORITY}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats === 0 ? (
          <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">
            Set list votes first to see parliament composition
          </div>
        ) : (
          <>
            <div className="px-2.5 pt-5 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
                {/* Centre reference line */}
                <line
                  x1={cx} y1={cy - innerR + 4}
                  x2={cx} y2={cy - outerR - 8}
                  stroke="rgba(0,0,0,0.10)"
                  strokeWidth="1" strokeDasharray="3,3"
                />
                {positions.map(({ x, y }, i) => (
                  <circle key={i} cx={x} cy={y} r={seatR}
                    fill={i < seatColors.length ? seatColors[i] : '#e5e7eb'} />
                ))}
              </svg>
            </div>

            {/* Legend */}
            <div className="px-3.5 pb-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({ id, count, color }) => {
                  const party = KR_PARTY_MAP[id];
                  return (
                    <div key={id} className="flex items-center gap-1.5">
                      <div style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
                      <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{party.name}</span>
                      <span className="text-[9.5px] font-mono font-bold text-ink">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// ── Poll swing helper ──────────────────────────────────────────────────────────
function applyPollSwing(pollPcts: Record<KrPartyId, number>): Record<number, Partial<Record<KrPartyId, number>>> {
  // national constituency baseline share per party (2024 FPTP votes)
  const natBase: Partial<Record<KrPartyId, number>> = {};
  let natTotal = 0;
  for (const wk of KR_DISTRICTS) for (const [id, v] of Object.entries(wk.votes) as [KrPartyId, number][]) { natBase[id] = (natBase[id] ?? 0) + (v ?? 0); natTotal += (v ?? 0); }
  const swing: Partial<Record<KrPartyId, number>> = {};
  for (const p of KR_PARTIES) {
    const base2024 = natTotal > 0 ? ((natBase[p.id] ?? 0) / natTotal) * 100 : 0;
    swing[p.id] = (pollPcts[p.id] ?? 0) - base2024;
  }
  const out: Record<number, Partial<Record<KrPartyId, number>>> = {};
  for (const wk of KR_DISTRICTS) {
    const base = wk.votes;
    const total = Object.values(base).reduce((s, v) => s + (v ?? 0), 0);
    if (total === 0) { out[wk.nr] = {}; continue; }
    const ids = (Object.keys(base) as KrPartyId[]).filter(id => (base[id] ?? 0) > 0);
    const adj: Partial<Record<KrPartyId, number>> = {};
    for (const id of ids) adj[id] = Math.max(0, ((base[id] ?? 0) / total) * 100 + (swing[id] ?? 0));
    const adjSum = Object.values(adj).reduce((s, v) => s + (v ?? 0), 0);
    out[wk.nr] = adjSum > 0
      ? Object.fromEntries(ids.map(id => [id, Math.round(((adj[id] ?? 0) / adjSum) * wk.validVotes)]))
      : {};
  }
  return out;
}

// ── 2026 polling projection ──────────────────────────────────────────────────
// Hypothetical scenario after the Dec-2024 martial-law crisis, Yoon's impeachment and
// the 2025 snap presidential election (won by DPK's Lee Jae-myung). The next REAL
// legislative election is 2028, so this is a projection, not a scheduled contest.
// Constituency-side national vote-share targets (applied as a uniform swing from the 2024 FPTP baseline):
const POLL_2026_PCTS: Record<KrPartyId, number> = {
  DPK: 47, PPP: 35, REF: 8, IND: 3, GJP: 2.5, PROG: 1.5, NFP: 1, LUP: 1,
  DEMALL: 0, PFP: 0, RKP: 0, OTH: 0,
};
// PR (party-list) projection — list votes flow to the list parties
// (the 2024 satellites stand in for the two majors' lists: DEMALL≈DPK, PFP≈PPP):
const POLL_2026_PR: Record<KrPartyId, number> = {
  DEMALL: 41, PFP: 30, RKP: 12, REF: 8, GJP: 3, NFP: 2, LUP: 2, OTH: 2,
  DPK: 0, PPP: 0, PROG: 0, IND: 0,
};

// National Erststimmen aggregate if 2026 polling swing is applied to all WKs
const POLL_2026_CONST_PCTS: Partial<Record<KrPartyId, number>> = (() => {
  const allResults = applyPollSwing(POLL_2026_PCTS);
  const nat: Partial<Record<KrPartyId, number>> = {};
  let total = 0;
  for (const wk of KR_DISTRICTS) {
    for (const [id, v] of Object.entries(allResults[wk.nr] ?? {}) as [KrPartyId, number][]) {
      nat[id] = (nat[id] ?? 0) + v;
      total += v;
    }
  }
  const pcts: Partial<Record<KrPartyId, number>> = {};
  for (const [id, v] of Object.entries(nat) as [KrPartyId, number][])
    pcts[id as KrPartyId] = total > 0 ? (v / total) * 100 : 0;
  return pcts;
})();

// ── Simulation helpers ─────────────────────────────────────────────────────────
function randNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Simulation panel ───────────────────────────────────────────────────────────
const SIM_PARTY_IDS: KrPartyId[] = ['DPK', 'PPP', 'REF', 'PROG', 'GJP', 'NFP', 'LUP', 'IND'];

function KrSimulationPanel({
  onStart, onClose, simRunning, simProgress, stopSim, dark,
}: {
  onStart: (erstResults: Record<number, Partial<Record<KrPartyId, number>>>, prVotes: Record<KrPartyId, number>, durationMs: number) => void;
  onClose: () => void;
  simRunning: boolean;
  simProgress: number;
  stopSim: () => void;
  dark?: boolean;
}) {
  // Initialize Erststimmen from 2026 polling national constituency percentages
  const [erstPcts, setErstPcts] = useState<Record<KrPartyId, number>>(() => {
    const base = Object.fromEntries(
      SIM_PARTY_IDS.map(id => [id, POLL_2026_CONST_PCTS[id] ?? 0])
    ) as Record<KrPartyId, number>;
    const s = Object.values(base).reduce((a, b) => a + b, 0);
    if (s > 0) for (const id of SIM_PARTY_IDS) base[id] = (base[id] ?? 0) / s * 100;
    return base;
  });

  const [duration, setDuration] = useState(120_000);
  const [editId, setEditId] = useState<KrPartyId | null>(null);
  const [editVal, setEditVal] = useState('');

  const erstSum = useMemo(() => Object.values(erstPcts).reduce((s, v) => s + v, 0), [erstPcts]);
  const erstOk  = Math.abs(erstSum - 100) < 0.5;
  const canPlay = erstOk && !simRunning;

  // Derive Zweitstimmen: same swing as constituency swing from 2026 polling baseline
  const prPcts = useMemo<Record<KrPartyId, number>>(() => {
    const raw: Partial<Record<KrPartyId, number>> = {};
    for (const id of SIM_PARTY_IDS) {
      const constSwing = (erstPcts[id] ?? 0) - (POLL_2026_CONST_PCTS[id] ?? 0);
      raw[id] = Math.max(0, (POLL_2026_PCTS[id] ?? 0) + constSwing);
    }
    const sum = Object.values(raw).reduce((s, v) => s + (v ?? 0), 0);
    if (sum <= 0) return raw as Record<KrPartyId, number>;
    return Object.fromEntries(SIM_PARTY_IDS.map(id => [id, ((raw[id] ?? 0) / sum) * 100])) as Record<KrPartyId, number>;
  }, [erstPcts]);

  function applyErstChange(id: KrPartyId, val: number) {
    setErstPcts(prev => redistributePcts(prev, id, Math.max(0, Math.min(100, val)), new Set()));
  }
  function commitEdit(id: KrPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyErstChange(id, n);
    setEditId(null); setEditVal('');
  }

  function handlePlay() {
    if (!canPlay) return;
    const allResults = applyPollSwing(erstPcts);
    const prVotes = Object.fromEntries(
      SIM_PARTY_IDS.map(id => [id, Math.round((prPcts[id] ?? 0) / 100 * PR_GRAND_TOTAL_2024)])
    ) as Record<KrPartyId, number>;
    onStart(allResults, prVotes, duration);
  }

  const durations = [
    { label: '1m', ms: 60_000 }, { label: '2m', ms: 120_000 },
    { label: '5m', ms: 300_000 }, { label: '10m', ms: 600_000 },
  ];

  const erstSorted = [...SIM_PARTY_IDS].sort((a, b) => (erstPcts[b] ?? 0) - (erstPcts[a] ?? 0));
  const zweitSorted = [...SIM_PARTY_IDS].sort((a, b) => (prPcts[b] ?? 0) - (prPcts[a] ?? 0));

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight">Election Night</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">South Korea Simulation</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-4">
        {/* Erststimmen — editable */}
        <div>
          <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-ink-3 mb-2">Constituency Vote (254 seats)</div>
          <div className="space-y-1.5">
            {erstSorted.map(id => {
              const color = partyColor(id, dark);
              const pct = erstPcts[id] ?? 0;
              const isEditing = editId === id;
              return (
                <div key={id} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[9.5px] font-medium text-ink flex-1 truncate">{KR_PARTY_MAP[id].name}</span>
                  {isEditing
                    ? <input type="number" min={0} max={100} step={0.01} value={editVal} autoFocus
                        className="w-14 h-5 text-[9.5px] font-mono tabular-nums text-right px-1 rounded border focus:outline-none bg-white"
                        style={{ borderColor: color }}
                        onChange={e => setEditVal(e.target.value)}
                        onBlur={() => commitEdit(id, editVal)}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(id, editVal); if (e.key === 'Escape') { setEditId(null); setEditVal(''); } }} />
                    : <button
                        onClick={() => { setEditId(id); setEditVal(pct.toFixed(2)); }}
                        className="w-14 h-5 text-[9.5px] font-mono tabular-nums text-right px-1 rounded border border-default hover:border-ink-3 transition-colors"
                        style={{ color }}>
                        {pct.toFixed(2)}%
                      </button>}
                </div>
              );
            })}
            <div className={`text-[8.5px] font-mono font-bold text-right pt-1 border-t border-default ${erstOk ? 'text-emerald-600' : 'text-red-500'}`}>
              Total: {erstSum.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Zweitstimmen — auto-derived, read-only */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-ink-3">Party-List Vote (46 seats)</div>
            <span className="text-[7.5px] font-mono text-ink-3 bg-ink/6 rounded px-1 py-0.5">auto</span>
          </div>
          <div className="space-y-1.5">
            {zweitSorted.map(id => {
              const color = partyColor(id, dark);
              const pct = prPcts[id] ?? 0;
              const base = POLL_2026_PCTS[id] ?? 0;
              const delta = pct - base;
              return (
                <div key={id} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[9.5px] font-medium text-ink-3 flex-1 truncate">{KR_PARTY_MAP[id].name}</span>
                  {Math.abs(delta) > 0.05 && (
                    <span className={`text-[7.5px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                    </span>
                  )}
                  <span className="w-14 text-[9.5px] font-mono tabular-nums text-right" style={{ color, opacity: 0.75 }}>
                    {pct.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Duration */}
        <div>
          <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-ink-3 mb-2">Duration</div>
          <div className="flex gap-1.5">
            {durations.map(d => (
              <button key={d.label} onClick={() => setDuration(d.ms)}
                className={`flex-1 py-1 text-[9px] font-mono rounded border transition-colors ${duration === d.ms ? 'bg-gold text-white border-gold' : 'border-default text-ink-3 hover:bg-hover'}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Progress */}
        {simRunning && (
          <div>
            <div className="text-[9px] font-mono text-ink-3 mb-1">{simProgress} / 254 declared</div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
              <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${(simProgress / 254) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="px-3.5 py-2.5 border-t border-default shrink-0">
        {simRunning
          ? <button onClick={stopSim}
              className="w-full py-2 text-[11px] font-mono font-bold rounded-[4px] bg-red-600 text-white hover:bg-red-700 transition-colors">
              ■ Stop Simulation
            </button>
          : <button onClick={handlePlay} disabled={!canPlay}
              className={`w-full py-2 text-[11px] font-mono font-bold rounded-[4px] transition-colors ${canPlay ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-ink/10 text-ink-3 cursor-not-allowed'}`}>
              {!erstOk ? '⚠ Constituency must sum to 100' : '▶ Run Simulation'}
            </button>}
      </div>
    </aside>
  );
}

// ── Multi-select panel — additive (mirrors DistrictPanel) ────────────────────
function MultiSelectPanel({ selectedNrs, districts, onUpdate, onClose, dark, currentResults }: {
  selectedNrs: Set<number>;
  districts: KrDistrict[];
  onUpdate: (nr: number, r: Partial<Record<KrPartyId, number>>) => void;
  onClose: () => void;
  dark: boolean;
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>;
}) {
  const wkMap = useMemo(() => {
    const m: Record<number, KrDistrict> = {};
    for (const wk of districts) m[wk.nr] = wk;
    return m;
  }, [districts]);

  const ids: KrPartyId[] = useMemo(
    () => KR_PARTIES.filter(p => p.tier !== 'pr' && p.id !== 'OTH').map(p => p.id),
    []
  );

  // Compute aggregate from actual (resolved) results
  const { initPcts, basePcts, totalVotes } = useMemo(() => {
    const agg: Record<string, number> = {};
    let tv = 0;
    for (const nr of selectedNrs) {
      const wk = wkMap[nr];
      if (!wk) continue;
      const res = currentResults[nr] ?? wk.votes;
      for (const id of ids) { agg[id] = (agg[id] ?? 0) + (res[id] ?? 0); }
      tv += wk.validVotes;
    }
    const aggTotal = ids.reduce((s, id) => s + (agg[id] ?? 0), 0);
    const ip: Record<KrPartyId, number> = {} as any;
    const bp: Record<KrPartyId, number> = {} as any;
    // base from 2025 erststimmen aggregate
    const baseAgg: Record<string, number> = {};
    for (const nr of selectedNrs) {
      const wk = wkMap[nr];
      if (!wk) continue;
      for (const id of ids) { baseAgg[id] = (baseAgg[id] ?? 0) + (wk.votes[id] ?? 0); }
    }
    const baseTotal = ids.reduce((s, id) => s + (baseAgg[id] ?? 0), 0);
    for (const id of ids) {
      ip[id] = aggTotal > 0 ? (agg[id] ?? 0) / aggTotal * 100 : 100 / ids.length;
      bp[id] = baseTotal > 0 ? (baseAgg[id] ?? 0) / baseTotal * 100 : 100 / ids.length;
    }
    return { initPcts: ip, basePcts: bp, totalVotes: tv };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNrs, wkMap, ids]);

  const [pcts, setPcts] = useState<Record<KrPartyId, number>>(initPcts);
  const [locks, setLocks] = useState<Set<KrPartyId>>(new Set());
  const [editId, setEditId] = useState<KrPartyId | null>(null);
  const [editVal, setEditVal] = useState('');

  const pctsRef  = useRef(pcts);
  const locksRef = useRef(locks);
  useEffect(() => { pctsRef.current  = pcts;  }, [pcts]);
  useEffect(() => { locksRef.current = locks; }, [locks]);

  // Re-init when selection changes
  useEffect(() => {
    setPcts(initPcts);
    setLocks(new Set());
    setEditId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNrs]);

  const sortedIds = useMemo(
    () => [...ids].sort((a, b) => (initPcts[b] ?? 0) - (initPcts[a] ?? 0)),
    [ids, initPcts]
  );

  const winnerId = sortedIds.length > 0
    ? sortedIds.reduce((best, id) => (pcts[id] ?? 0) > (pcts[best] ?? 0) ? id : best)
    : undefined;
  const winnerPct = winnerId ? (pcts[winnerId] ?? 0) : 0;
  const runnerUpId = sortedIds.find(id => id !== winnerId);
  const margin = runnerUpId ? winnerPct - (pcts[runnerUpId] ?? 0) : winnerPct;
  const winnerParty = winnerId ? KR_PARTY_MAP[winnerId] : null;
  const winnerColor = winnerId ? partyColor(winnerId, dark) : '#888';

  function applyChange(id: KrPartyId, val: number) {
    const newPcts = redistributePcts(pctsRef.current, id, val, locksRef.current);
    pctsRef.current = newPcts;
    setPcts(newPcts);
    for (const nr of selectedNrs) {
      const wk = wkMap[nr];
      if (!wk) continue;
      onUpdate(nr, Object.fromEntries(ids.map(cid => [cid, Math.round((newPcts[cid] ?? 0) * wk.validVotes / 100)])));
    }
  }

  function toggleLock(id: KrPartyId) {
    setLocks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (sortedIds.filter(i => !next.has(i) && i !== id).length >= 1) next.add(id);
      return next;
    });
  }

  function commitEdit(id: KrPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-ink leading-tight">{selectedNrs.size} constituencies selected</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {totalVotes.toLocaleString()} votes total
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>

        {winnerParty && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] bg-[#f8f7f4] border border-default"
            style={{ borderColor: `${winnerColor}33` }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: winnerColor }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winnerParty.name}</span>
            <span className="text-[9px] font-mono text-ink-3">{winnerPct.toFixed(1)}% · +{margin.toFixed(1)}pp</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
        {sortedIds.map(id => {
          const color = partyColor(id, dark);
          const pct = pcts[id] ?? 0;
          const base = basePcts[id] ?? 0;
          const delta = pct - base;
          const isLocked = locks.has(id);
          return (
            <div key={id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{KR_PARTY_MAP[id].name}</span>
                <button onClick={() => toggleLock(id)} title={isLocked ? 'Unlock' : 'Lock'}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>
                  {isLocked ? (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  ) : (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  )}
                </button>
                {editId === id ? (
                  <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                    className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink-2"
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(id, editVal)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(id, editVal); }
                      if (e.key === 'Escape') { setEditId(null); setEditVal(''); }
                    }} />
                ) : (
                  <span onClick={() => { if (!isLocked) { setEditId(id); setEditVal(pct.toFixed(1)); } }}
                    className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none"
                    style={{ cursor: isLocked ? 'default' : 'text' }}>
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(id, parseFloat(e.target.value))}
                className="party-slider w-full"
                style={{ '--party-color': color, '--pct': `${pct}%` } as React.CSSProperties}
              />
              {Math.abs(delta) > 0.05 && (
                <div className="flex justify-end mt-0.5">
                  <span className={`text-[8px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}pp
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-3.5 py-2 border-t border-default">
        <p className="text-[8px] font-mono text-ink-3 text-center uppercase tracking-wide">Applied uniformly to all {selectedNrs.size} selected</p>
      </div>
    </aside>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────
export default function SouthKoreaApp() {
  const navigate = useNavigate();

  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Election state ───────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<'baseline' | 'blank' | 'polling2026'>('polling2026');
  const [currentResults, setCurrentResults] = useState<Record<number, Partial<Record<KrPartyId, number>>>>(
    () => applyPollSwing(POLL_2026_PCTS)
  );

  function makePR2024(): Record<KrPartyId, number> {
    const trackedSum = Object.values(PR_VOTES_2024).reduce((s, v) => s + (v ?? 0), 0);
    return {
      ...Object.fromEntries(KR_PARTIES.filter(p => p.id !== 'OTH').map(p => [p.id, PR_VOTES_2024[p.id] ?? 0])),
      OTH: PR_GRAND_TOTAL_2024 - trackedSum,
    } as Record<KrPartyId, number>;
  }

  function loadBaseline() { setCurrentResults({}); setPreset('baseline'); setPrVotes(makePR2024()); }
  function loadPolling2026() {
    setCurrentResults(applyPollSwing(POLL_2026_PCTS));
    setPreset('polling2026');
    const gt = PR_GRAND_TOTAL_2024;
    setPrVotes(Object.fromEntries(
      KR_PARTIES.map(p => [p.id, Math.round((POLL_2026_PR[p.id] ?? 0) / 100 * gt)])
    ) as Record<KrPartyId, number>);
  }
  function loadBlank() {
    const blank: Record<number, Partial<Record<KrPartyId, number>>> = {};
    for (const wk of KR_DISTRICTS) blank[wk.nr] = {};
    setCurrentResults(blank);
    setPreset('blank');
    setPrVotes(Object.fromEntries(KR_PARTIES.map(p => [p.id, 0])) as Record<KrPartyId, number>);
    setProjectedNrs(new Set());
    setScoreboardVisible(false);
  }

  function updateWk(nr: number, results: Partial<Record<KrPartyId, number>>) {
    setCurrentResults(prev => ({ ...prev, [nr]: results }));
    if (preset !== 'blank') setPreset('baseline');
  }

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [selectedNr, setSelectedNr]           = useState<number | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedNrs, setSelectedNrs]         = useState<Set<number>>(new Set());
  const [projectedNrs, setProjectedNrs]       = useState<Set<number>>(new Set());
  const [prOpen, setPrOpen]             = useState(false);
  const [parliOpen, setParliOpen]             = useState(false);
  const [prVotes, setPrVotes]           = useState<Record<KrPartyId, number> | null>(() => {
    const gt = PR_GRAND_TOTAL_2024;
    return Object.fromEntries(
      KR_PARTIES.map(p => [p.id, Math.round((POLL_2026_PR[p.id] ?? 0) / 100 * gt)])
    ) as Record<KrPartyId, number>;
  });
  const [bubbleMap, setBubbleMap]               = useState(false);
  const [tutorialOpen, setTutorialOpen]         = useState(false);
  const [tutorialExiting, setTutorialExiting]   = useState(false);
  const [breakdownOpen, setBreakdownOpen]       = useState(false);
  const [breakdownExiting, setBreakdownExiting] = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [exitPanel, setExitPanel]             = useState<string | null>(null);
  const exitTimerRef                          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef                       = useRef<HTMLDivElement>(null);

  // ── Simulation state ─────────────────────────────────────────────────────────
  const [simOpen, setSimOpen]       = useState(false);
  const [simExiting, setSimExiting] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function stopSim() {
    simTimersRef.current.forEach(clearTimeout);
    simTimersRef.current = [];
    setSimRunning(false);
  }

  function handleSimStart(
    allResults: Record<number, Partial<Record<KrPartyId, number>>>,
    newPrVotes: Record<KrPartyId, number>,
    durationMs: number,
  ) {
    stopSim();
    const blank: Record<number, Partial<Record<KrPartyId, number>>> = {};
    for (const wk of KR_DISTRICTS) blank[wk.nr] = {};
    setCurrentResults(blank);
    setPreset('blank');
    setPrVotes(Object.fromEntries(KR_PARTIES.map(p => [p.id, 0])) as Record<KrPartyId, number>); // PR ramps up as districts report
    setProjectedNrs(new Set());
    setScoreboardVisible(false);
    setSimRunning(true);
    setSimProgress(0);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let declared = 0;

    KR_DISTRICTS.forEach(wk => {
      const t = Math.max(2000, Math.min(durationMs * 0.98,
        (durationMs / 2) + randNormal() * (durationMs / 6)));
      const fullResult = allResults[wk.nr] ?? wk.votes;

      timers.push(setTimeout(() => {
        const partial: Partial<Record<KrPartyId, number>> = {};
        for (const [id, v] of Object.entries(fullResult) as [KrPartyId, number][])
          partial[id] = Math.round(v * 0.35);
        setCurrentResults(prev => ({ ...prev, [wk.nr]: partial }));
      }, t * 0.6));

      timers.push(setTimeout(() => {
        setCurrentResults(prev => ({ ...prev, [wk.nr]: fullResult }));
        declared++;
        setSimProgress(declared);
        // Party-list (PR) votes report little-by-little, in step with constituency counting
        const frac = declared / 254;
        setPrVotes(Object.fromEntries(KR_PARTIES.map(p => [p.id, Math.round((newPrVotes[p.id] ?? 0) * frac)])) as Record<KrPartyId, number>);
        if (declared >= 254) setSimRunning(false);
      }, t));
    });

    simTimersRef.current = timers;
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

  // Auto-show scoreboard when blank map gets its first results (sim path)
  useEffect(() => {
    if (preset === 'blank' && (projectedNrs.size > 0 || simProgress > 0)) {
      setScoreboardVisible(true);
    }
  }, [preset, projectedNrs.size, simProgress]);

  // Auto-show scoreboard once list seats have been filled in blank mode
  useEffect(() => {
    if (preset === 'blank' && prVotes && Object.values(prVotes).some(v => (v ?? 0) > 0)) {
      setScoreboardVisible(true);
    }
  }, [preset, prVotes]);

  const triggerExit = useCallback((panel: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  function handleMultiSelect(nr: number) {
    setSelectedNrs(prev => {
      const next = new Set(prev);
      if (next.has(nr)) next.delete(nr); else next.add(nr);
      return next;
    });
  }

  const resolvedResults = useMemo(() => {
    const r: Record<number, Partial<Record<KrPartyId, number>>> = {};
    for (const wk of KR_DISTRICTS) r[wk.nr] = currentResults[wk.nr] ?? wk.votes;
    return r;
  }, [currentResults]);

  // districts that have reported (blank-map / election-night) — drives the % reporting widget
  const reportedCount = useMemo(() => {
    let n = 0;
    for (const wk of KR_DISTRICTS) {
      const r = currentResults[wk.nr];
      if (r && Object.values(r).some(v => (v ?? 0) > 0)) n++;
    }
    return n;
  }, [currentResults]);

  const directSeats = useMemo(() => calcConstituencySeats(KR_DISTRICTS, resolvedResults), [resolvedResults]);

  // South Korea seats every FPTP winner (no German-style "losing winners" adjustment).
  const effectiveDirectSeats = directSeats;

  const parliSeats = useMemo<Partial<Record<KrPartyId, number>>>(() => {
    if (!prVotes) return {};
    return calcAssembly(KR_DISTRICTS, resolvedResults, prVotes).totalSeats;
  }, [resolvedResults, prVotes]);

  const selectedWk = selectedNr !== null ? KR_DISTRICTS.find(w => w.nr === selectedNr) ?? null : null;

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  const showWkPanel    = !!selectedNr && !multiSelectMode && !prOpen;
  const showMultiPanel = multiSelectMode && selectedNrs.size > 0;
  const showPR      = prOpen;
  const showParli      = parliOpen;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="kr">

      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>

        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button onClick={loadBaseline}    className={preset === 'baseline'    ? btnGold : btnMuted}>2024 Baseline</button>
          <button onClick={loadPolling2026} className={preset === 'polling2026' ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset === 'blank'       ? btnGold : btnMuted}>Blank Map</button>

          <button
            onClick={() => {
              if (prOpen) { setPrOpen(false); triggerExit('pr'); }
              else { setPrOpen(true); }
            }}
            className={prOpen ? btnActive : preset === 'blank' ? `${btnBase} border-2 border-gold text-gold animate-pulse hover:bg-gold hover:text-white` : btnMuted}
          >Party List</button>

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button
            onClick={() => {
              if (simOpen) {
                setSimExiting(true);
                setTimeout(() => { setSimExiting(false); setSimOpen(false); }, 280);
              } else {
                setSimOpen(true);
              }
            }}
            className={simOpen ? btnActive : btnMuted}
          >▶ Simulation</button>

          <button
            onClick={() => {
              if (multiSelectMode) { setMultiSelectMode(false); setSelectedNrs(new Set()); }
              else { setMultiSelectMode(true); setSelectedNr(null); }
            }}
            className={multiSelectMode ? btnActive : btnMuted}
          >{multiSelectMode ? `⊕ ${selectedNrs.size} sel.` : 'Multi-select'}</button>

          <button
            onClick={() => {
              if (parliOpen) { setParliOpen(false); triggerExit('parli'); }
              else { setParliOpen(true); }
            }}
            className={parliOpen ? btnActive : btnMuted}
          >Parliament</button>

          <button
            onClick={() => {
              if (breakdownOpen) {
                setBreakdownExiting(true);
                setTimeout(() => { setBreakdownExiting(false); setBreakdownOpen(false); }, 280);
              } else { setBreakdownOpen(true); }
            }}
            className={breakdownOpen ? btnActive : btnMuted}
          >Breakdown</button>

          <button
            onClick={() => setBubbleMap(v => !v)}
            className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnMuted}
          >Bubble Map</button>

          <button
            onClick={() => {
              if (tutorialOpen) {
                setTutorialExiting(true);
                setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280);
              } else {
                setTutorialOpen(true);
              }
            }}
            className={tutorialOpen ? btnActive : btnMuted}
            title="How to play"
          >Tutorial</button>
        </div>

        {/* Right controls */}
        <div className="shrink-0 flex items-center gap-2.5 pr-4">
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

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 relative">

        {/* Scoreboard */}
        <div className="relative shrink-0">
          <div style={{ display: 'grid', gridTemplateRows: scoreboardVisible ? '1fr' : '0fr', transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)' }}>
            <div className="overflow-hidden">
              <KoreaScoreboard
                districts={KR_DISTRICTS}
                currentResults={resolvedResults}
                prList={prVotes ?? undefined}
                directSeats={prVotes ? effectiveDirectSeats : undefined}
                dark={dark}
                leaders={preset === 'polling2026' || preset === 'blank' ? { ...KR_LEADERS, ...KR_LEADERS_2026 } : KR_LEADERS}
              />
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
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">{scoreboardVisible ? 'Hide' : 'Results'}</span>
          </button>
        </div>

        {/* Map + panels */}
        <div className="flex flex-1 min-h-0 relative">
          {/* Parliament panel — left side */}
          {(showParli || exitPanel === 'parli') && (
            <ParliamentPanel
              seats={parliSeats}
              onClose={() => { setParliOpen(false); triggerExit('parli'); }}
              exiting={exitPanel === 'parli'}
              dark={dark}
            />
          )}
          <div className="flex-1 min-w-0 relative">
            <KoreaMapView
              districts={KR_DISTRICTS}
              currentResults={resolvedResults}
              selectedNr={selectedNr}
              onSelect={nr => {
                setSelectedNr(prev => prev === nr ? null : nr);
                setPrOpen(false);
              }}
              dark={dark}
              bubbleMap={bubbleMap}
              multiSelectMode={multiSelectMode}
              selectedNrs={selectedNrs}
              onMultiSelect={handleMultiSelect}
            />
            {preset === 'blank' && (
              <div className="absolute bottom-3 left-3 z-[500] pointer-events-none flex flex-col items-start gap-1">
                {simRunning && (
                  <div className="flex items-center gap-1.5 bg-red-600 text-white rounded-full px-2.5 py-1 shadow-md">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    <span className="text-[9px] font-mono font-bold tracking-[0.15em] uppercase">Live</span>
                  </div>
                )}
                <div className={`rounded-[6px] px-3 py-1.5 shadow-md border text-left ${dark ? 'bg-[rgba(13,27,46,0.92)] border-white/10 text-white' : 'bg-white/95 border-default text-ink'}`}>
                  <div className="text-[8px] font-mono uppercase tracking-wider text-ink-3 leading-none mb-0.5">Reporting</div>
                  <div className="text-[15px] font-mono font-bold tabular-nums leading-none">{Math.round((reportedCount / KR_DISTRICTS.length) * 100)}%</div>
                  <div className="text-[8px] font-mono text-ink-3 leading-none mt-0.5">{reportedCount} / {KR_DISTRICTS.length} seats</div>
                </div>
              </div>
            )}
          </div>

          {multiSelectMode && selectedNrs.size === 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] bg-white border border-default rounded-full px-4 py-1.5 text-[10px] font-mono text-ink-3 shadow-sm pointer-events-none">
              Click constituencies to select
            </div>
          )}


          {/* Panels */}
          {showWkPanel && selectedWk && (
            <DistrictPanel
              wk={selectedWk}
              results={resolvedResults[selectedWk.nr] ?? {}}
              onClose={() => setSelectedNr(null)}
              onUpdate={updateWk}
              dark={dark}
              isBlank={preset === 'blank'}
              isProjected={projectedNrs.has(selectedWk.nr)}
              onProject={() => setProjectedNrs(prev => new Set([...prev, selectedWk.nr]))}
            />
          )}
          {showMultiPanel && (
            <MultiSelectPanel
              selectedNrs={selectedNrs}
              districts={KR_DISTRICTS}
              onUpdate={updateWk}
              onClose={() => { setMultiSelectMode(false); setSelectedNrs(new Set()); }}
              dark={dark}
              currentResults={resolvedResults}
            />
          )}
          {(breakdownOpen || breakdownExiting) && (
            <BreakdownPanel
              districts={KR_DISTRICTS}
              currentResults={resolvedResults}
              prVotes={prVotes}
              onClose={() => {
                setBreakdownExiting(true);
                setTimeout(() => { setBreakdownExiting(false); setBreakdownOpen(false); }, 280);
              }}
              exiting={breakdownExiting}
              dark={dark}
              isBaseline={preset === 'baseline'}
            />
          )}
          {(showPR || exitPanel === 'pr') && prVotes && (
            <PRPanel
              votes={prVotes}
              onVotesChange={setPrVotes}
              directSeats={effectiveDirectSeats}
              onClose={() => { setPrOpen(false); triggerExit('pr'); }}
              exiting={exitPanel === 'pr'}
              dark={dark}
            />
          )}
          {(simOpen || simExiting) && (
            <KrSimulationPanel
              onStart={handleSimStart}
              onClose={() => {
                setSimExiting(true);
                setTimeout(() => { setSimExiting(false); setSimOpen(false); }, 280);
              }}
              simRunning={simRunning}
              simProgress={simProgress}
              stopSim={stopSim}
              dark={dark}
            />
          )}
          {/* Tutorial panel — right side */}
          {(tutorialOpen || tutorialExiting) && (
            <TutorialPanel
              onClose={() => {
                setTutorialExiting(true);
                setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280);
              }}
              exiting={tutorialExiting}
            />
          )}
        </div>

        {/* Branding */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — South Korea National Assembly Edition</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
        </div>
      </div>
    </div>
  );
}
