import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BR_CANDIDATE_MAP, BR_STATES, BR_STATE_MAP, IBGE_TO_STATE,
  BR_2022_R1, BR_2022_R2, BR_2026_POLL_PCTS,
  BR_R1_2022_IDS, BR_R2_2022_IDS, BR_2026_IDS,
  BR_NATIONAL_TOTAL_R1 as _r1, BR_NATIONAL_TOTAL_R2 as _r2,
  applyBr2026Swing,
  type BrCandidateId, type BrState,
} from '../data/brazil2022';

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

type Preset = 'r1_2022' | 'r2_2022' | 'polling2026' | 'blank';

type TooltipState = {
  x: number; y: number;
  name: string; code: string;
  region: string;
  parties: { id: BrCandidateId; votes: number; pct: number }[];
  winner: BrCandidateId | null;
} | null;

// candidate IDs active for a given preset
function activeCandidates(preset: Preset): BrCandidateId[] {
  if (preset === 'r2_2022')    return BR_R2_2022_IDS;
  if (preset === 'polling2026') return BR_2026_IDS;
  return BR_R1_2022_IDS;
}

// Determine winner + margin (0–1) from state result
function winnerOf(result: Partial<Record<BrCandidateId, number>>): { winner: BrCandidateId | null; margin: number } {
  const sorted = (Object.entries(result) as [BrCandidateId, number][])
    .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return { winner: null, margin: 0 };
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const [winnerId, w1] = sorted[0];
  const w2 = sorted[1]?.[1] ?? 0;
  const margin = total > 0 ? (w1 - w2) / total : 0;
  return { winner: winnerId, margin };
}

function stateFill(result: Partial<Record<BrCandidateId, number>>, dark: boolean): string {
  const { winner, margin } = winnerOf(result);
  if (!winner) return dark ? '#1e2535' : '#d4d4d4';
  const base = BR_CANDIDATE_MAP[winner]?.color ?? '#888';
  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);
  // blend towards background based on margin: 0pt → very pale, 30pt+ → full color
  const t = Math.min(margin * 3.5, 1); // saturate at ~29pt margin
  const bg = dark ? 20 : 235;
  const tr = Math.round(bg + (r - bg) * (0.25 + 0.75 * t));
  const tg = Math.round(bg + (g - bg) * (0.25 + 0.75 * t));
  const tb = Math.round(bg + (b - bg) * (0.25 + 0.75 * t));
  return `rgb(${tr},${tg},${tb})`;
}

// wiki photo fetching (same pattern as Germany)
async function fetchWikiPhoto(title: string): Promise<string | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&pithumbsize=120&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = data?.query?.pages ?? {};
    const page = Object.values(pages)[0] as any;
    return page?.thumbnail?.source ?? null;
  } catch { return null; }
}

// ── Map component ─────────────────────────────────────────────────────────────
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };

function BrazilBubbleLayer({
  geoData, currentResults, stateLookup, containerRef, setTooltip, onSelect,
}: {
  geoData: any;
  currentResults: Record<string, Partial<Record<BrCandidateId, number>>>;
  stateLookup: Record<string, BrState>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: TooltipState) => void;
  onSelect: (code: string) => void;
  dark?: boolean;
}) {
  const map = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);
  const resultsRef = useRef(currentResults);
  useEffect(() => { resultsRef.current = currentResults; }, [currentResults]);

  useEffect(() => {
    const onZoom = () => {
      const z = map.getZoom();
      const scale = Math.max(0.35, Math.min(1.0, (z - 3) / (7 - 3)));
      for (const { marker, baseRadius } of bubblesRef.current) marker.setRadius(baseRadius * scale);
    };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);

  useEffect(() => {
    for (const { marker } of bubblesRef.current) marker.remove();
    bubblesRef.current = [];
    const z = map.getZoom();
    const scale = Math.max(0.35, Math.min(1.0, (z - 3) / (7 - 3)));
    const gj = L.geoJSON(geoData);
    gj.eachLayer((layer: L.Layer) => {
      const path = layer as any;
      const ibge = parseInt(path.feature?.properties?.codarea ?? '0');
      const code = IBGE_TO_STATE[ibge];
      if (!code) return;
      const stateInfo = stateLookup[code];
      if (!stateInfo) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();
      const result = currentResults[code] ?? {};
      const sorted = (Object.entries(result) as [BrCandidateId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (sorted.length === 0) return;
      const [winId, w1] = sorted[0];
      const w2 = sorted[1]?.[1] ?? 0;
      const total = sorted.reduce((s, [, v]) => s + v, 0);
      const margin = total > 0 ? (w1 - w2) / total : 0;
      const baseRadius = 4 + Math.min(margin * 3.5, 1) * 12;
      const color = BR_CANDIDATE_MAP[winId]?.color ?? '#888';
      const marker = L.circleMarker(center, { radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1.2, opacity: 0.9 }).addTo(map);
      marker.on('click', () => { setTooltip(null); onSelect(code); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const r = resultsRef.current[code] ?? {};
        const tot = Object.values(r).reduce((s, v) => s + (v ?? 0), 0);
        const parties = (Object.entries(r) as [BrCandidateId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5)
          .map(([id, votes]) => ({ id, votes, pct: tot > 0 ? (votes / tot) * 100 : 0 }));
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: stateInfo.name, code, region: stateInfo.region, parties, winner: parties[0]?.id ?? null });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });
    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  }, [map, geoData, currentResults]);

  return null;
}

function BrazilMapView({
  currentResults, selectedCode, onSelect, dark, bubbleMap,
  multiSelectMode, selectedCodes, onMultiSelect,
}: {
  currentResults: Record<string, Partial<Record<BrCandidateId, number>>>;
  selectedCode: string | null;
  onSelect: (code: string) => void;
  dark: boolean;
  bubbleMap: boolean;
  multiSelectMode: boolean;
  selectedCodes: Set<string>;
  onMultiSelect: (code: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef     = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const resultsRef       = useRef(currentResults);
  const selectedCodeRef  = useRef(selectedCode);
  const darkRef          = useRef(dark);
  const bubbleMapRef     = useRef(bubbleMap);
  const multiRef         = useRef(multiSelectMode);
  const selectedCodesRef = useRef(selectedCodes);
  const onMultiRef       = useRef(onMultiSelect);
  const onSelectRef      = useRef(onSelect);
  useEffect(() => { resultsRef.current = currentResults; }, [currentResults]);
  useEffect(() => { selectedCodeRef.current = selectedCode; }, [selectedCode]);
  useEffect(() => { darkRef.current = dark; }, [dark]);
  useEffect(() => { bubbleMapRef.current = bubbleMap; }, [bubbleMap]);
  useEffect(() => { multiRef.current = multiSelectMode; }, [multiSelectMode]);
  useEffect(() => { selectedCodesRef.current = selectedCodes; }, [selectedCodes]);
  useEffect(() => { onMultiRef.current = onMultiSelect; }, [onMultiSelect]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}brazil-states.geojson`).then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const stateLookup = useMemo(() => BR_STATE_MAP, []);

  function getStyle(feature: any) {
    const ibge = parseInt(feature?.properties?.codarea ?? '0');
    const code = IBGE_TO_STATE[ibge];
    const result = resultsRef.current[code ?? ''] ?? {};
    const hasResult = Object.values(result).some(v => (v ?? 0) > 0);
    const fill = hasResult ? stateFill(result, darkRef.current) : (darkRef.current ? '#1e2535' : '#d4d4d4');
    const isSelected = selectedCodeRef.current === code || selectedCodesRef.current.has(code ?? '');
    return {
      fillColor: fill,
      fillOpacity: 0.9,
      color: isSelected ? '#f5c842' : (darkRef.current ? '#4a5568' : '#9ca3af'),
      weight: isSelected ? 2.5 : 0.8,
      opacity: 1,
    };
  }

  function onEachFeature(feature: any, layer: L.Layer) {
    const ibge = parseInt(feature?.properties?.codarea ?? '0');
    const code = IBGE_TO_STATE[ibge];
    const stateInfo = stateLookup[code];

    layer.on('click', () => {
      if (multiRef.current) { onMultiRef.current(code); return; }
      if (bubbleMapRef.current) return;
      onSelectRef.current(code);
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleMapRef.current || multiRef.current) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !stateInfo) return;
      const r = resultsRef.current[code] ?? {};
      const total = Object.values(r).reduce((s, v) => s + (v ?? 0), 0);
      const parties = (Object.entries(r) as [BrCandidateId, number][])
        .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5)
        .map(([id, votes]) => ({ id, votes, pct: total > 0 ? (votes / total) * 100 : 0 }));
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: stateInfo.name, code, region: stateInfo.region, parties, winner: parties[0]?.id ?? null });
    });
    layer.on('mouseout', () => setTooltip(null));
  }

  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.setStyle((feature: any) => getStyle(feature));
  }, [currentResults, selectedCode, selectedCodes, dark]);

  const tileUrl = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';

  // Brazil center / zoom
  const center: [number, number] = [-14.0, -52.0];

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <MapContainer
        center={center} zoom={4} minZoom={3} maxZoom={10}
        style={{ width: '100%', height: '100%', background: dark ? '#0d1526' : '#e8e8e8' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={tileUrl} subdomains="abcd" updateWhenZooming={false} updateWhenIdle={true} maxZoom={20} />
        <MapResizer />
        {geoData && (
          <GeoJSON
            ref={layerRef as any}
            data={geoData}
            style={(f: any) => getStyle(f)}
            onEachFeature={onEachFeature}
          />
        )}
        {geoData && bubbleMap && (
          <BrazilBubbleLayer
            geoData={geoData}
            currentResults={currentResults}
            stateLookup={stateLookup}
            containerRef={containerRef}
            setTooltip={setTooltip}
            onSelect={onSelect}
            dark={dark}
          />
        )}
      </MapContainer>

      {/* Tooltip */}
      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 230;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = {
          bg:     dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)',
          shadow: dark ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 32px rgba(0,0,0,0.13)',
          title:  dark ? '#e8edf8' : '#0d1526',
          sub:    dark ? '#6b7fa8' : '#8a9ab8',
          body:   dark ? '#c8d4ee' : '#2d3748',
          muted:  dark ? '#4a5b7a' : '#a0aec0',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: tt.shadow, backdropFilter: 'blur(10px)', padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: tt.title }}>{tooltip.name}</div>
              <div style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 2 }}>{tooltip.code} · {tooltip.region}</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tooltip.parties.map(({ id, votes, pct }, i) => {
                  const c = BR_CANDIDATE_MAP[id];
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: c?.color ?? '#888' }} />
                      <span style={{ flex: 1, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c?.lastName ?? id}</span>
                      <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, marginRight: 4 }}>{fmtN(votes)}</span>
                      <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: c?.color ?? '#888' }}>{pct.toFixed(1)}%</span>
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

// ── Scoreboard tile ───────────────────────────────────────────────────────────
function BrScoreboardTile({
  candidateId, votes, pct, isLeader, isWinner, isTop2,
}: {
  candidateId: BrCandidateId; votes: number; pct: number;
  isLeader: boolean; isWinner: boolean; isTop2: boolean; dark?: boolean;
}) {
  const cand  = BR_CANDIDATE_MAP[candidateId];
  const color = cand?.color ?? '#888';
  const colorAlpha = hexToRgba(color, 0.13);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cand?.wikiTitle) return;
    let cancelled = false;
    fetchWikiPhoto(cand.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [cand?.wikiTitle]);

  const initials = cand?.lastName.slice(0, 2).toUpperCase() ?? '??';

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha, borderColor: (isLeader || isWinner) ? color : hexToRgba(color, 0.30) } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={cand?.name} onError={() => setPhotoUrl(null)} />
            : <span className="cand-initials">{initials}</span>
          }
        </div>
        {isWinner && (
          <span className="called-tick">
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
              <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
              <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        )}
        {isTop2 && !isWinner && (
          <span style={{ position: 'absolute', bottom: 2, right: 2, lineHeight: 1, fontSize: 10, color: '#eab308', fontWeight: 800 }} title="Advances to R2">2</span>
        )}
      </div>
      <span className="cand-leader-name" title={cand?.name}>{cand?.lastName ?? candidateId}</span>
      <span className="cand-party-abbrev">{cand?.party || candidateId}</span>
      <span className="cand-seats">{pct.toFixed(1)}%</span>
      <span className="cand-party-name">{fmtN(votes)} votes</span>
      <div style={{ width: '100%', height: 3, borderRadius: 2, marginTop: 4, background: hexToRgba(color, 0.15) }}>
        <div style={{ width: `${Math.min(pct * 2, 100)}%`, height: '100%', borderRadius: 2, background: color }} />
      </div>
    </div>
  );
}

function BrazilScoreboard({
  currentResults, preset, dark,
}: {
  currentResults: Record<string, Partial<Record<BrCandidateId, number>>>;
  preset: Preset;
  dark: boolean;
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

  const ids = activeCandidates(preset);
  void (_r1 + _r2); // keep imports alive

  const totals = useMemo(() => {
    const t: Partial<Record<BrCandidateId, number>> = {};
    for (const stateResult of Object.values(currentResults)) {
      for (const [id, v] of Object.entries(stateResult) as [BrCandidateId, number][]) {
        t[id] = (t[id] ?? 0) + (v ?? 0);
      }
    }
    return t;
  }, [currentResults]);

  const grandTotal = Object.values(totals).reduce((s, v) => s + (v ?? 0), 0);

  const sorted = useMemo(() =>
    ids.map(id => ({ id, votes: totals[id] ?? 0, pct: grandTotal > 0 ? ((totals[id] ?? 0) / grandTotal) * 100 : 0 }))
       .sort((a, b) => b.votes - a.votes),
    [ids, totals, grandTotal]);

  const leaderId    = sorted[0]?.id ?? null;
  const isR1        = preset !== 'r2_2022';
  const top2Ids     = new Set(sorted.slice(0, 2).map(c => c.id));
  const MAJORITY    = 50;
  const winnerId    = sorted[0]?.pct > MAJORITY ? sorted[0].id : null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {sorted.map(({ id, votes, pct }) => (
            <BrScoreboardTile
              key={id}
              candidateId={id}
              votes={votes}
              pct={pct}
              isLeader={id === leaderId && !winnerId}
              isWinner={id === winnerId}
              isTop2={isR1 && !winnerId && top2Ids.has(id)}
              dark={dark}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── State slider panel ────────────────────────────────────────────────────────
function toPcts(result: Partial<Record<BrCandidateId, number>>, ids: BrCandidateId[]): Record<BrCandidateId, number> {
  const total = ids.reduce((s, id) => s + (result[id] ?? 0), 0);
  if (total === 0) return Object.fromEntries(ids.map(id => [id, 100 / ids.length])) as Record<BrCandidateId, number>;
  return Object.fromEntries(ids.map(id => [id, ((result[id] ?? 0) / total) * 100])) as Record<BrCandidateId, number>;
}

function StatePanel({
  stateInfo, result, preset, onClose, onUpdate, dark, isBlank, isProjected, onProject,
}: {
  stateInfo: BrState;
  result: Partial<Record<BrCandidateId, number>>;
  preset: Preset;
  onClose: () => void;
  onUpdate: (code: string, result: Partial<Record<BrCandidateId, number>>) => void;
  dark: boolean;
  isBlank: boolean;
  isProjected: boolean;
  onProject: () => void;
}) {
  const ids = activeCandidates(preset);
  const validVotes = preset === 'r2_2022' ? stateInfo.validVotesR2 : stateInfo.validVotesR1;

  const [pcts, setPcts] = useState<Record<BrCandidateId, number>>(() => toPcts(result, ids));
  const [locked, setLocked] = useState<Set<BrCandidateId>>(new Set());

  useEffect(() => { setPcts(toPcts(result, ids)); }, [JSON.stringify(result), preset]);

  const total = ids.reduce((s, id) => s + (pcts[id] ?? 0), 0);
  const sumOk = Math.abs(total - 100) < 0.5;

  function handleSlider(movedId: BrCandidateId, newPct: number) {
    if (isProjected) return;
    const delta = newPct - (pcts[movedId] ?? 0);
    const freeIds = ids.filter(id => id !== movedId && !locked.has(id));
    const freeSum = freeIds.reduce((s, id) => s + (pcts[id] ?? 0), 0);
    const next: Record<BrCandidateId, number> = { ...pcts, [movedId]: newPct };
    if (freeSum > 0) {
      for (const id of freeIds) next[id] = Math.max(0, (pcts[id] ?? 0) - delta * ((pcts[id] ?? 0) / freeSum));
    }
    // renormalize to 100
    const s = ids.reduce((acc, id) => acc + next[id], 0);
    if (s > 0) for (const id of ids) next[id] = (next[id] / s) * 100;
    setPcts(next);
    const votes = Object.fromEntries(ids.map(id => [id, Math.round(next[id] / 100 * validVotes)]));
    onUpdate(stateInfo.code, votes);
  }

  function handlePctInput(id: BrCandidateId, val: string) {
    if (isProjected) return;
    const n = parseFloat(val);
    if (isNaN(n) || n < 0 || n > 100) return;
    handleSlider(id, n);
  }

  const panelBg  = dark ? 'rgba(10,18,36,0.97)' : 'rgba(255,254,250,0.97)';
  const borderC  = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';

  return (
    <div className="panel-slide absolute right-0 top-0 h-full w-72 z-[300] flex flex-col" style={{ background: panelBg, borderLeft: `1px solid ${borderC}`, boxShadow: '-8px 0 32px rgba(0,0,0,0.18)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-default shrink-0">
        <div>
          <div className="text-[13px] font-bold text-ink">{stateInfo.name}</div>
          <div className="text-[9px] font-mono text-ink-3 uppercase tracking-wide">{stateInfo.code} · {stateInfo.region} · {fmtN(validVotes)} votes</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Sliders */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {ids.map(id => {
          const cand  = BR_CANDIDATE_MAP[id];
          const color = cand?.color ?? '#888';
          const pct   = pcts[id] ?? 0;
          const votes = Math.round(pct / 100 * validVotes);
          return (
            <div key={id}>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span className="flex-1 text-[11px] font-medium text-ink truncate">{cand?.lastName ?? id}</span>
                <input
                  type="number" min={0} max={100} step={0.1}
                  value={pct.toFixed(1)}
                  disabled={isProjected || locked.has(id)}
                  onChange={e => handlePctInput(id, e.target.value)}
                  className="w-14 text-right text-[11px] font-mono bg-transparent border-b border-default text-ink outline-none"
                />
                <span className="text-[10px] text-ink-3">%</span>
                {!isProjected && (
                  <button onClick={() => setLocked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                    className={`text-[10px] ${locked.has(id) ? 'text-gold' : 'text-ink-3 hover:text-ink'} transition-colors`}>
                    {locked.has(id) ? '🔒' : '🔓'}
                  </button>
                )}
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct}
                disabled={isProjected || locked.has(id)}
                onChange={e => handleSlider(id, parseFloat(e.target.value))}
                style={{ accentColor: color }}
                className="w-full h-1.5 cursor-pointer disabled:opacity-40"
              />
              <div className="text-[9px] font-mono text-ink-3 text-right">{fmtN(votes)}</div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-3 border-t border-default">
        <div className={`text-[10px] font-mono mb-2 text-center ${sumOk ? 'text-emerald-500' : 'text-red-500'}`}>
          Total: {total.toFixed(1)}% {sumOk ? '✓' : '⚠ must equal 100'}
        </div>
        {isBlank && !isProjected && (
          <button onClick={onProject}
            className="w-full h-8 rounded-lg text-[11px] font-mono font-semibold text-white transition-colors"
            style={{ background: '#16a34a' }}>
            Project Result ✓
          </button>
        )}
        {isProjected && (
          <div className="w-full h-8 rounded-lg text-[11px] font-mono font-semibold flex items-center justify-center gap-1.5 border"
            style={{ color: '#16a34a', borderColor: '#16a34a33' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#16a34a"/><path d="M3 6l2.5 2.5L9 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Projected
          </div>
        )}
      </div>
    </div>
  );
}

// ── Multi-select panel ────────────────────────────────────────────────────────
function BrMultiSelectPanel({
  selectedCodes, currentResults, preset, onClose, onUpdate, dark,
}: {
  selectedCodes: Set<string>;
  currentResults: Record<string, Partial<Record<BrCandidateId, number>>>;
  preset: Preset;
  onClose: () => void;
  onUpdate: (code: string, result: Partial<Record<BrCandidateId, number>>) => void;
  dark: boolean;
}) {
  const ids = activeCandidates(preset);

  const { aggVotes, aggTotal } = useMemo(() => {
    const agg: Partial<Record<BrCandidateId, number>> = {};
    let total = 0;
    for (const code of selectedCodes) {
      const r = currentResults[code] ?? {};
      for (const id of ids) { agg[id] = (agg[id] ?? 0) + (r[id] ?? 0); total += r[id] ?? 0; }
    }
    return { aggVotes: agg, aggTotal: total };
  }, [selectedCodes, currentResults, ids]);

  const [deltaPcts, setDeltaPcts] = useState<Record<BrCandidateId, number>>(
    Object.fromEntries(ids.map(id => [id, 0])) as Record<BrCandidateId, number>
  );

  function applyDelta() {
    for (const code of selectedCodes) {
      const stateInfo = BR_STATE_MAP[code];
      const validVotes = preset === 'r2_2022' ? stateInfo.validVotesR2 : stateInfo.validVotesR1;
      const base = toPcts(currentResults[code] ?? {}, ids);
      const next: Record<BrCandidateId, number> = { ...base };
      for (const id of ids) next[id] = Math.max(0, (base[id] ?? 0) + (deltaPcts[id] ?? 0));
      const s = ids.reduce((acc, id) => acc + next[id], 0);
      if (s > 0) for (const id of ids) next[id] = (next[id] / s) * 100;
      const votes = Object.fromEntries(ids.map(id => [id, Math.round(next[id] / 100 * validVotes)]));
      onUpdate(code, votes);
    }
    setDeltaPcts(Object.fromEntries(ids.map(id => [id, 0])) as Record<BrCandidateId, number>);
  }

  const panelBg = dark ? 'rgba(10,18,36,0.97)' : 'rgba(255,254,250,0.97)';
  const borderC = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';

  return (
    <div className="panel-slide absolute right-0 top-0 h-full w-72 z-[300] flex flex-col" style={{ background: panelBg, borderLeft: `1px solid ${borderC}`, boxShadow: '-8px 0 32px rgba(0,0,0,0.18)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-default shrink-0">
        <div>
          <div className="text-[13px] font-bold text-ink">Multi-select</div>
          <div className="text-[9px] font-mono text-ink-3">{selectedCodes.size} states selected</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        <div className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-1">Swing (±pp applied to all selected)</div>
        {ids.map(id => {
          const cand = BR_CANDIDATE_MAP[id];
          const color = cand?.color ?? '#888';
          const aggPct = aggTotal > 0 ? ((aggVotes[id] ?? 0) / aggTotal) * 100 : 0;
          const delta = deltaPcts[id] ?? 0;
          return (
            <div key={id}>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span className="flex-1 text-[11px] font-medium text-ink">{cand?.lastName ?? id}</span>
                <span className="text-[10px] font-mono text-ink-3">{aggPct.toFixed(1)}%</span>
                <span className="text-[10px] font-mono" style={{ color: delta >= 0 ? '#16a34a' : '#dc2626', minWidth: 36, textAlign: 'right' }}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}</span>
              </div>
              <input type="range" min={-30} max={30} step={0.5} value={delta}
                onChange={e => setDeltaPcts(prev => ({ ...prev, [id]: parseFloat(e.target.value) }))}
                style={{ accentColor: color }} className="w-full h-1.5 cursor-pointer"
              />
            </div>
          );
        })}
      </div>
      <div className="shrink-0 px-4 py-3 border-t border-default">
        <button onClick={applyDelta} className="w-full h-8 rounded-lg text-[11px] font-mono font-semibold text-white transition-colors" style={{ background: '#1a56db' }}>
          Apply Swing
        </button>
      </div>
    </div>
  );
}

// ── Simulation panel ──────────────────────────────────────────────────────────
function randNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function BrazilApp() {
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') === 'true');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Preset / results state ────────────────────────────────────────────────
  const [preset, setPreset] = useState<Preset>('r1_2022');
  const [currentResults, setCurrentResults] = useState<Record<string, Partial<Record<BrCandidateId, number>>>>(() => ({ ...BR_2022_R1 }));

  function loadR1() {
    setCurrentResults({ ...BR_2022_R1 });
    setPreset('r1_2022');
    setProjectedCodes(new Set());
    setScoreboardVisible(true);
    setSelectedCode(null);
  }
  function loadR2() {
    const r2: Record<string, Partial<Record<BrCandidateId, number>>> = {};
    for (const s of BR_STATES) r2[s.code] = { ...BR_2022_R2[s.code] };
    setCurrentResults(r2);
    setPreset('r2_2022');
    setProjectedCodes(new Set());
    setScoreboardVisible(true);
    setSelectedCode(null);
  }
  function load2026() {
    setCurrentResults(applyBr2026Swing());
    setPreset('polling2026');
    setProjectedCodes(new Set());
    setScoreboardVisible(true);
    setSelectedCode(null);
  }
  function loadBlank() {
    const blank: Record<string, Partial<Record<BrCandidateId, number>>> = {};
    for (const s of BR_STATES) blank[s.code] = {};
    setCurrentResults(blank);
    setPreset('blank');
    setProjectedCodes(new Set());
    setScoreboardVisible(false);
    setSelectedCode(null);
  }

  function updateState(code: string, result: Partial<Record<BrCandidateId, number>>) {
    setCurrentResults(prev => ({ ...prev, [code]: result }));
    if (preset !== 'blank') setPreset('r1_2022');
  }

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedCode,    setSelectedCode]    = useState<string | null>(null);
  const [projectedCodes,  setProjectedCodes]  = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedCodes,   setSelectedCodes]   = useState<Set<string>>(new Set());
  const [bubbleMap,       setBubbleMap]       = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [simOpen,    setSimOpen]    = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const simTimersRef    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  // Auto-show scoreboard when first blank map results arrive
  useEffect(() => {
    if (preset === 'blank' && (projectedCodes.size > 0 || simProgress > 0)) {
      setScoreboardVisible(true);
    }
  }, [preset, projectedCodes.size, simProgress]);

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

  function stopSim() {
    simTimersRef.current.forEach(clearTimeout);
    simTimersRef.current = [];
    setSimRunning(false);
  }

  function handleSimStart(allResults: Record<string, Partial<Record<BrCandidateId, number>>>, durationMs: number) {
    stopSim();
    const blank: Record<string, Partial<Record<BrCandidateId, number>>> = {};
    for (const s of BR_STATES) blank[s.code] = {};
    setCurrentResults(blank);
    setPreset('blank');
    setProjectedCodes(new Set());
    setScoreboardVisible(false);
    setSimRunning(true);
    setSimProgress(0);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let declared = 0;
    BR_STATES.forEach(state => {
      const t = Math.max(2000, Math.min(durationMs * 0.98, (durationMs / 2) + randNormal() * (durationMs / 6)));
      const fullResult = allResults[state.code] ?? {};
      timers.push(setTimeout(() => {
        const partial: Partial<Record<BrCandidateId, number>> = {};
        for (const [id, v] of Object.entries(fullResult) as [BrCandidateId, number][]) partial[id] = Math.round(v * 0.35);
        setCurrentResults(prev => ({ ...prev, [state.code]: partial }));
      }, t * 0.6));
      timers.push(setTimeout(() => {
        setCurrentResults(prev => ({ ...prev, [state.code]: fullResult }));
        declared++;
        setSimProgress(declared);
        if (declared >= 27) setSimRunning(false);
      }, t));
    });
    simTimersRef.current = timers;
  }

  function handleMultiSelect(code: string) {
    setSelectedCodes(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }

  const selectedState = selectedCode ? BR_STATE_MAP[selectedCode] ?? null : null;
  const showStatePanel = !!selectedCode && !multiSelectMode;
  const showMultiPanel = multiSelectMode && selectedCodes.size > 0;

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden">
      {/* Header */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => window.location.hash = '/'} className="shrink-0 flex items-center gap-2.5 pl-4 pr-3 h-full border-r border-default hover:bg-hover transition-colors">
          <img src={`${import.meta.env.BASE_URL}brazil-flag.png`} alt="Brazil" className="h-4 w-auto rounded-sm" />
          <div className="flex flex-col justify-center leading-none">
            <span className="font-display font-black uppercase tracking-[0.04em] text-[13px] text-ink">Brazil</span>
            <span className="text-[8px] font-mono text-ink-3 uppercase tracking-[0.12em]">Presidential Election</span>
          </div>
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={loadR1}   className={preset === 'r1_2022'     ? btnGold : btnMuted}>2022 Round 1</button>
          <button onClick={loadR2}   className={preset === 'r2_2022'     ? btnGold : btnMuted}>2022 Round 2</button>
          <button onClick={load2026} className={preset === 'polling2026' ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={loadBlank} className={preset === 'blank' ? `${btnBase} border-2 border-gold text-gold animate-pulse hover:bg-gold hover:text-white` : btnMuted}>Blank Map</button>

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button onClick={() => { if (simOpen) setSimOpen(false); else setSimOpen(true); }}
            className={simOpen ? btnActive : btnMuted}>▶ Simulation</button>

          <button onClick={() => { if (multiSelectMode) { setMultiSelectMode(false); setSelectedCodes(new Set()); } else { setMultiSelectMode(true); setSelectedCode(null); } }}
            className={multiSelectMode ? btnActive : btnMuted}>
            {multiSelectMode ? `⊕ ${selectedCodes.size} sel.` : 'Multi-select'}
          </button>

          <button onClick={() => setBubbleMap(v => !v)}
            className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnMuted}>
            Bubble Map
          </button>
        </div>

        {/* Right controls */}
        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          <div className="relative">
            <button onClick={() => setContributorsOpen(o => !o)}
              className={`w-7 h-7 flex items-center justify-center rounded-[4px] border transition-colors ${contributorsOpen ? 'border-ink-3 text-ink bg-hover' : 'border-default text-ink-3 hover:border-ink-3 hover:text-ink'}`}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm1.5 7.5c.5-.25.5-.75.5-1s-.5-3-3-3.5a2.5 2.5 0 0 1 2.5 4.5z" fillRule="evenodd" clipRule="evenodd"/>
              </svg>
            </button>
            {contributorsOpen && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setContributorsOpen(false)} />
                <div className="absolute right-0 top-[calc(100%+6px)] z-[100] w-56 rounded-[10px] bg-white border border-default overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.13)' }}>
                  <div className="px-3.5 pt-3 pb-2 border-b border-default">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-ink">Contributors</div>
                  </div>
                  <div className="px-3.5 py-2.5">
                    <a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      <span className="text-[11px] font-mono font-semibold text-ink">@realleochang</span>
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {dark
              ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none"/><line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2.5" y1="11.5" x2="3.6" y2="10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.5 9A6 6 0 0 1 5 1.5a.5.5 0 0 0-.6.6A6 6 0 1 0 12 9.6a.5.5 0 0 0-.5-.6z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
            }
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        {/* Scoreboard */}
        <div className="relative shrink-0">
          <div style={{ display: 'grid', gridTemplateRows: scoreboardVisible ? '1fr' : '0fr', transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)' }}>
            <div className="overflow-hidden">
              <BrazilScoreboard currentResults={currentResults} preset={preset} dark={dark} />
            </div>
          </div>
          <button onClick={() => setScoreboardVisible(v => !v)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1">
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
              {scoreboardVisible
                ? <path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>}
            </svg>
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">{scoreboardVisible ? 'Hide' : 'Results'}</span>
          </button>
        </div>

        {/* Map + panels */}
        <div className="flex flex-1 min-h-0 relative">
          <div className="flex-1 min-w-0 relative">
            <BrazilMapView
              currentResults={currentResults}
              selectedCode={selectedCode}
              onSelect={code => { setSelectedCode(prev => prev === code ? null : code); }}
              dark={dark}
              bubbleMap={bubbleMap}
              multiSelectMode={multiSelectMode}
              selectedCodes={selectedCodes}
              onMultiSelect={handleMultiSelect}
            />
          </div>

          {multiSelectMode && selectedCodes.size === 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] bg-white border border-default rounded-full px-4 py-1.5 text-[10px] font-mono text-ink-3 shadow-sm pointer-events-none">
              Click states to select
            </div>
          )}

          {/* Right panels */}
          {showStatePanel && selectedState && (
            <StatePanel
              stateInfo={selectedState}
              result={currentResults[selectedCode!] ?? {}}
              preset={preset}
              onClose={() => setSelectedCode(null)}
              onUpdate={updateState}
              dark={dark}
              isBlank={preset === 'blank'}
              isProjected={projectedCodes.has(selectedCode!)}
              onProject={() => setProjectedCodes(prev => new Set([...prev, selectedCode!]))}
            />
          )}

          {showMultiPanel && (
            <BrMultiSelectPanel
              selectedCodes={selectedCodes}
              currentResults={currentResults}
              preset={preset}
              onClose={() => { setMultiSelectMode(false); setSelectedCodes(new Set()); }}
              onUpdate={updateState}
              dark={dark}
            />
          )}

          {simOpen && (
            <BrSimulationPanel
              preset={preset}
              onStart={handleSimStart}
              onClose={() => setSimOpen(false)}
              simRunning={simRunning}
              simProgress={simProgress}
              stopSim={stopSim}
              dark={dark}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BrSimulationPanel({
  preset, onStart, onClose, simRunning, simProgress, stopSim, dark,
}: {
  preset: Preset;
  onStart: (allResults: Record<string, Partial<Record<BrCandidateId, number>>>, durationMs: number) => void;
  onClose: () => void;
  simRunning: boolean;
  simProgress: number;
  stopSim: () => void;
  dark: boolean;
}) {
  const ids = activeCandidates(preset);
  const [pcts, setPcts] = useState<Record<BrCandidateId, number>>(() => {
    const base = ids.map(id => ({ id, pct: BR_2026_POLL_PCTS[id] ?? (100 / ids.length) }));
    const s = base.reduce((acc, b) => acc + b.pct, 0);
    return Object.fromEntries(base.map(b => [b.id, (b.pct / s) * 100])) as Record<BrCandidateId, number>;
  });
  const [duration, setDuration] = useState(300);

  const total = ids.reduce((s, id) => s + (pcts[id] ?? 0), 0);
  const sumOk = Math.abs(total - 100) < 0.5;

  function buildAllResults(): Record<string, Partial<Record<BrCandidateId, number>>> {
    const out: Record<string, Partial<Record<BrCandidateId, number>>> = {};
    for (const state of BR_STATES) {
      const validVotes = preset === 'r2_2022' ? state.validVotesR2 : state.validVotesR1;
      out[state.code] = Object.fromEntries(ids.map(id => [id, Math.round((pcts[id] ?? 0) / 100 * validVotes)]));
    }
    return out;
  }

  const panelBg = dark ? 'rgba(10,18,36,0.97)' : 'rgba(255,254,250,0.97)';
  const borderC = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';

  return (
    <div className={`${simRunning ? '' : 'panel-slide '}absolute right-0 top-0 h-full w-72 z-[300] flex flex-col`} style={{ background: panelBg, borderLeft: `1px solid ${borderC}`, boxShadow: '-8px 0 32px rgba(0,0,0,0.18)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-default shrink-0">
        <div>
          <div className="text-[13px] font-bold text-ink">Simulation</div>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Brazil Presidential</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        <div className="text-[9px] font-mono text-ink-3 uppercase tracking-wide">National vote share</div>
        {ids.map(id => {
          const cand = BR_CANDIDATE_MAP[id];
          const color = cand?.color ?? '#888';
          return (
            <div key={id}>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span className="flex-1 text-[11px] font-medium text-ink">{cand?.lastName ?? id}</span>
                <input type="number" min={0} max={100} step={0.1} disabled={simRunning}
                  value={(pcts[id] ?? 0).toFixed(1)}
                  onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) setPcts(prev => ({ ...prev, [id]: Math.max(0, n) })); }}
                  className="w-14 text-right text-[11px] font-mono bg-transparent border-b border-default text-ink outline-none" />
                <span className="text-[10px] text-ink-3">%</span>
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pcts[id] ?? 0} disabled={simRunning}
                onChange={e => setPcts(prev => ({ ...prev, [id]: parseFloat(e.target.value) }))}
                style={{ accentColor: color }} className="w-full h-1.5 cursor-pointer disabled:opacity-40" />
            </div>
          );
        })}

        <div className="pt-2 border-t border-default">
          <div className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-2">Duration</div>
          <div className="flex gap-1 flex-wrap">
            {[[60,'1m'],[180,'3m'],[300,'5m'],[600,'10m']].map(([s, l]) => (
              <button key={s} disabled={simRunning} onClick={() => setDuration(Number(s))}
                className={`h-6 px-2.5 text-[10px] font-mono rounded border transition-colors ${duration === Number(s) ? 'bg-gold text-white border-gold' : 'border-default text-ink-3 hover:text-ink'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {simRunning && (
          <div>
            <div className="text-[9px] font-mono text-ink-3 mb-1">{simProgress} / 27 states declared</div>
            <div className="w-full h-1.5 rounded-full bg-black/10">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${(simProgress / 27) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-default">
        {simRunning
          ? <button onClick={stopSim} className="w-full h-8 rounded-lg text-[11px] font-mono font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors">■ Stop Simulation</button>
          : <button onClick={() => sumOk && onStart(buildAllResults(), duration * 1000)}
              className={`w-full h-8 rounded-lg text-[11px] font-mono font-semibold text-white transition-colors ${sumOk ? 'bg-gold hover:bg-gold-deep' : 'bg-ink/20 cursor-not-allowed'}`}>
              {!sumOk ? `⚠ Must sum to 100 (${total.toFixed(1)}%)` : '▶ Run Simulation'}
            </button>
        }
      </div>
    </div>
  );
}
