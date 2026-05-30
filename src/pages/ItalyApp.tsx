import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';
import {
  IT_PARTIES, IT_PARTY_MAP, IT_TOTAL_SEATS, IT_MAJORITY, IT_PR_THRESHOLD, IT_PR_KEYS,
  IT_COALITIONS, IT_COAL_COLOR, IT_COAL_NAME, itPartyColor,
} from '../data/italyData';
import type { ItPartyId } from '../data/italyData';

// ── Map layers ─────────────────────────────────────────────────────────────────
type LayerId = 'uni' | 'pluri' | 'reg';
const LAYERS: { id: LayerId; label: string; sub: string; file: string; nameProp: string }[] = [
  { id: 'uni',   label: 'Collegi uninominali', sub: 'FPTP · 147 collegi',  file: 'italy-uninominali.geojson', nameProp: 'den' },
  { id: 'pluri', label: 'Collegi plurinominali', sub: 'Proporzionale · 49', file: 'italy-plurinominali.geojson', nameProp: 'den' },
  { id: 'reg',   label: 'Regioni',            sub: 'Proporzionale · 20',    file: 'italy-regioni.geojson', nameProp: 'reg_name' },
];

// Region populations (2011 census, for simulation vote weighting)
const IT_REGION_POP: Record<string, number> = {
  'Piemonte': 4357905, "Valle d'Aosta/Vallée d'Aoste": 126806, 'Lombardia': 9704151,
  'Trentino-Alto Adige/Südtirol': 1029585, 'Veneto': 4857210, 'Friuli-Venezia Giulia': 1218985,
  'Liguria': 1570694, 'Emilia-Romagna': 4342135, 'Toscana': 3672202, 'Umbria': 884268,
  'Marche': 1541319, 'Lazio': 5502886, 'Abruzzo': 1307309, 'Molise': 313660,
  'Campania': 5766810, 'Puglia': 4052566, 'Basilicata': 578036, 'Calabria': 1959050,
  'Sicilia': 5002904, 'Sardegna': 1639362,
};

// ── helpers ──────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
  if (isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(128,128,128,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
// Shade a base color toward lighter (low margin) → saturated (high margin)
function shadeByStrength(baseColor: string, strength: number, dark: boolean): string {
  const t = Math.min(Math.max(strength, 0), 1);
  const c = hsl(baseColor);
  c.l = dark ? (0.58 - t*(0.58-0.30)) : (0.84 - t*(0.84-0.40));
  return c.formatHex();
}

// Coalition leading from a PR record
function leadCoalitionOf(pr: Record<string, number>): string {
  const tot: Record<string, number> = {
    CDX: (pr.FDI||0)+(pr.LEGA||0)+(pr.FI||0)+(pr.NM||0),
    CSX: (pr.PD||0)+(pr.AVS||0)+(pr.PIU||0)+(pr.IC||0),
    M5S: pr.M5S||0, AZIV: pr.AZIV||0,
  };
  return Object.keys(tot).reduce((b,k)=>tot[k]>tot[b]?k:b,'CDX');
}
function leadPartyOf(pr: Record<string, number>): ItPartyId {
  return IT_PR_KEYS.reduce((b,p)=>(pr[p]||0)>(pr[b]||0)?p:b, 'FDI');
}

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function ScoreboardTile({ party, seats, pct, isWinner, hasMajority, dark }: {
  party: typeof IT_PARTIES[0]; seats: number; pct: number; isWinner: boolean; hasMajority: boolean; dark: boolean;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (party.wikiTitle) fetchWikiPhoto(party.wikiTitle).then(u => { if (live) setPhoto(u); });
    return () => { live = false; };
  }, [party.wikiTitle]);
  const initials = party.leader.split(/[ –]/).filter(Boolean).slice(0,2).map(s=>s[0]).join('');
  return (
    <div className={`relative shrink-0 rounded-[7px] border px-2.5 py-2 w-[148px] ${dark?'bg-[#10203a] border-white/10':'bg-white border-default'} ${isWinner?'ring-1 ring-[#c8a020]':''}`}>
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-[9px] font-bold text-white" style={{ background: party.color }}>
          {photo ? <img src={photo} alt={party.leader} className="w-full h-full object-cover" /> : initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black leading-none truncate text-ink">{party.name}</div>
          <div className="text-[7.5px] font-mono text-ink-3 truncate mt-0.5">{party.leader}</div>
        </div>
      </div>
      <div className="flex items-end justify-between mt-1.5">
        <span className="text-[22px] font-black leading-none tabular-nums" style={{ color: party.color }}>{seats}</span>
        <span className="text-[9px] font-mono text-ink-3 mb-0.5">{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)' }}>
        <div style={{ width: `${Math.min(100, pct*2.2)}%`, height:'100%', background: party.color }} />
      </div>
      {hasMajority && <div className="absolute -top-1.5 -right-1.5 text-[10px]">👑</div>}
    </div>
  );
}

// ── Scoreboard ───────────────────────────────────────────────────────────────
function ItalyScoreboard({ seats, pcts, dark }: {
  seats: Record<ItPartyId, number>; pcts: Record<ItPartyId, number>; dark: boolean;
}) {
  const ordered = useMemo(() =>
    IT_PARTIES.filter(p => (seats[p.id] ?? 0) > 0 || (pcts[p.id] ?? 0) >= 0.5)
      .sort((a,b) => (seats[b.id]??0) - (seats[a.id]??0) || (pcts[b.id]??0) - (pcts[a.id]??0)),
  [seats, pcts]);
  const top = ordered[0]?.id;
  return (
    <div className="flex gap-2 overflow-x-auto thin-scroll px-3 py-2">
      {ordered.map(p => (
        <ScoreboardTile key={p.id} party={p} seats={seats[p.id] ?? 0} pct={pcts[p.id] ?? 0}
          isWinner={p.id === top} hasMajority={(seats[p.id]??0) >= IT_MAJORITY} dark={dark} />
      ))}
    </div>
  );
}

// ── Map controller (no-smooth + resize) ───────────────────────────────────────
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const h = () => layerRef.current?.eachLayer((l) => { const p = l as unknown as { options?: { smoothFactor?: number } }; if (p.options) p.options.smoothFactor = 0; });
    map.on('zoomend', h);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => { map.off('zoomend', h); ro.disconnect(); };
  }, [map, layerRef]);
  return null;
}

// ── Bubble overlay (size by leading margin) ────────────────────────────────────
function zoomScale(z: number) { return Math.max(0.4, Math.min(1, (z-4)/(8-4))); }
function BubbleLayer({ geoData, layer, onSelect }: {
  geoData: GeoJSON.FeatureCollection | null; layer: LayerId; onSelect: (f: GeoJSON.Feature) => void;
}) {
  const map = useMap();
  const markersRef = useRef<{ m: L.CircleMarker; base: number }[]>([]);
  useEffect(() => {
    const onZoom = () => { const s = zoomScale(map.getZoom()); markersRef.current.forEach(({m,base}) => m.setRadius(base*s)); };
    map.on('zoomend', onZoom); return () => { map.off('zoomend', onZoom); };
  }, [map]);
  useEffect(() => {
    markersRef.current.forEach(({m}) => m.remove());
    markersRef.current = [];
    if (!geoData) return;
    const s = zoomScale(map.getZoom());
    const gj = L.geoJSON(geoData as GeoJSON.GeoJsonObject);
    gj.eachLayer((lyr) => {
      const feat = (lyr as unknown as { feature?: GeoJSON.Feature }).feature;
      const b = (lyr as unknown as { getBounds?: () => L.LatLngBounds }).getBounds?.();
      if (!feat || !b || !b.isValid()) return;
      const props = feat.properties as Record<string, unknown>;
      let color = '#9AA0A6', margin = 0.2;
      if (layer === 'uni') { color = IT_COAL_COLOR[(props.coal as string) || 'NONE'] || '#9AA0A6'; margin = 0.5; }
      else {
        const pr = props.pr as Record<string, number> | null; if (!pr) return;
        const lead = leadPartyOf(pr); color = itPartyColor(lead);
        const sorted = IT_PR_KEYS.map(k=>pr[k]||0).sort((a,b)=>b-a);
        margin = Math.max(0.08, ((sorted[0]||0) - (sorted[1]||0))/100);
      }
      const c = b.getCenter();
      const base = Math.max(5, Math.min(26, 5 + margin*55));
      const m = L.circleMarker([c.lat, c.lng], { radius: base*s, fillColor: color, fillOpacity: 0.82, color: '#fff', weight: 1 });
      m.on('click', () => onSelect(feat));
      m.addTo(map); markersRef.current.push({ m, base });
    });
    return () => { markersRef.current.forEach(({m}) => m.remove()); markersRef.current = []; };
  }, [geoData, layer, map, onSelect]);
  return null;
}

// ── Map view (3-layer) ─────────────────────────────────────────────────────────
function ItalyMapView({ layer, geoData, liveResults, dark, bubble, onSelect, selectedKey }: {
  layer: LayerId;
  geoData: GeoJSON.FeatureCollection | null;
  liveResults: Record<string, Record<string, number>> | null; // sim overrides keyed by feature name
  dark: boolean;
  bubble: boolean;
  onSelect: (f: GeoJSON.Feature) => void;
  selectedKey: string | null;
}) {
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [tooltip, setTooltip] = useState<{ x:number;y:number;name:string;rows:{label:string;color:string;val:string}[];win:string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctx = useRef({ layer, liveResults, dark, selectedKey });
  useEffect(() => { ctx.current = { layer, liveResults, dark, selectedKey }; }, [layer, liveResults, dark, selectedKey]);

  const featKey = useCallback((f: GeoJSON.Feature) => {
    const p = f.properties as Record<string, unknown>;
    return String(layer === 'reg' ? p.reg_name : p.den);
  }, [layer]);

  const fillFor = useCallback((f: GeoJSON.Feature): string => {
    const p = f.properties as Record<string, unknown>;
    const live = ctx.current.liveResults?.[featKey(f)];
    if (ctx.current.layer === 'uni') {
      const coal = (live ? leadCoalitionOf(live) : (p.coal as string)) || 'NONE';
      return shadeByStrength(IT_COAL_COLOR[coal] || '#9AA0A6', 0.62, ctx.current.dark);
    }
    const pr = (live as Record<string,number>) || (p.pr as Record<string,number> | null);
    if (!pr) return ctx.current.dark ? '#33415a' : '#dfe3ea';
    const lead = leadPartyOf(pr);
    const sorted = IT_PR_KEYS.map(k=>pr[k]||0).sort((a,b)=>b-a);
    const margin = ((sorted[0]||0)-(sorted[1]||0))/40;
    return shadeByStrength(itPartyColor(lead), 0.35+margin, ctx.current.dark);
  }, [featKey]);

  const style = useCallback((f?: GeoJSON.Feature): L.PathOptions => {
    if (!f) return {};
    const sel = featKey(f) === ctx.current.selectedKey;
    if (bubble) return { fillOpacity: 0, weight: 0.4, color: ctx.current.dark?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.16)', opacity: 0.6 };
    return { fillColor: fillFor(f), fillOpacity: 0.82, weight: sel?2.2:0.4, color: sel?'#c8a020':(ctx.current.dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.3)'), opacity: 1 };
  }, [featKey, fillFor, bubble]);

  useEffect(() => { layerRef.current?.setStyle((f) => style(f as GeoJSON.Feature)); }, [layer, liveResults, dark, bubble, selectedKey, style]);

  const onEach = useCallback((f: GeoJSON.Feature, lyr: L.Layer) => {
    lyr.on('click', () => onSelect(f));
    lyr.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubble) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
      const p = f.properties as Record<string, unknown>;
      const live = ctx.current.liveResults?.[featKey(f)];
      const name = String(layer==='reg' ? p.reg_name : (p.den ?? p.reg_name));
      let rows: {label:string;color:string;val:string}[] = []; let win = '';
      if (layer === 'uni' && !live) {
        const coal = (p.coal as string)||'NONE'; win = IT_COAL_NAME[coal]||'—';
        rows = [{ label: win, color: IT_COAL_COLOR[coal]||'#999', val: 'vincitore' }];
      } else {
        const pr = (live as Record<string,number>) || (p.pr as Record<string,number> | null);
        if (pr) {
          const lead = leadPartyOf(pr); win = IT_PARTY_MAP[lead]?.name ?? '';
          rows = IT_PR_KEYS.map(k=>({ id:k, v: pr[k]||0 })).filter(r=>r.v>=1).sort((a,b)=>b.v-a.v).slice(0,5)
            .map(r => ({ label: IT_PARTY_MAP[r.id as ItPartyId].name, color: itPartyColor(r.id), val: r.v.toFixed(1)+'%' }));
        }
      }
      setTooltip({ x: e.originalEvent.clientX-rect.left, y: e.originalEvent.clientY-rect.top, name, rows, win });
    });
    lyr.on('mouseout', () => setTooltip(null));
  }, [featKey, layer, bubble, onSelect]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[42.2, 12.5]} zoom={6} minZoom={5} maxZoom={12} style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump
        preferCanvas>
        <TileLayer key={dark?'d':'l'} url={dark
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" />
        <MapController layerRef={layerRef} />
        {geoData && !bubble && (
          <GeoJSON key={layer} data={geoData} ref={(r) => { layerRef.current = r as unknown as L.GeoJSON; }}
            style={(f) => style(f as GeoJSON.Feature)} onEachFeature={onEach} />
        )}
        {geoData && bubble && <BubbleLayer geoData={geoData} layer={layer} onSelect={onSelect} />}
      </MapContainer>
      {tooltip && (
        <div className="absolute z-[1000] pointer-events-none rounded-[6px] px-2.5 py-1.5 shadow-lg"
          style={{ left: tooltip.x+14, top: tooltip.y+8, background: dark?'rgba(8,16,40,0.97)':'rgba(255,255,255,0.98)', border:`1px solid ${dark?'rgba(255,255,255,0.12)':'rgba(0,0,0,0.1)'}`, maxWidth: 230 }}>
          <div className="text-[11px] font-bold mb-1" style={{ color: dark?'#e8eef8':'#111' }}>{tooltip.name}</div>
          {tooltip.win && <div className="text-[8px] font-mono uppercase tracking-wide mb-1 text-ink-3">▸ {tooltip.win}</div>}
          {tooltip.rows.map((r,i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: dark?'#cfd8ea':'#333' }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
              <span className="flex-1 truncate">{r.label}</span>
              <span className="font-mono tabular-nums">{r.val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Rosatellum seat model (for the simulation what-if) ─────────────────────────
function largestRemainder(weights: Record<string, number>, total: number): Record<string, number> {
  const keys = Object.keys(weights);
  const sum = keys.reduce((s, k) => s + Math.max(0, weights[k]), 0);
  const out: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));
  if (sum <= 0 || total <= 0) return out;
  const exact = keys.map(k => ({ k, e: Math.max(0, weights[k]) / sum * total }));
  let used = 0;
  for (const x of exact) { out[x.k] = Math.floor(x.e); used += out[x.k]; }
  exact.sort((a, b) => (b.e - Math.floor(b.e)) - (a.e - Math.floor(a.e)));
  let i = 0;
  while (used < total && exact.length) { out[exact[i % exact.length].k]++; used++; i++; }
  return out;
}

const BASELINE_SEATS = Object.fromEntries(IT_PARTIES.map(p => [p.id, p.seats2022])) as Record<ItPartyId, number>;
const BASELINE_PCT   = Object.fromEntries(IT_PARTIES.map(p => [p.id, p.prPct2022])) as Record<ItPartyId, number>;

function computeSeats(natPct: Record<ItPartyId, number>): Record<ItPartyId, number> {
  // PR (245): national party threshold 3%, Hare largest remainder
  const prW: Record<string, number> = {};
  for (const p of IT_PARTIES) { if (p.id === 'ALTRI') continue; const v = natPct[p.id] || 0; if (v >= IT_PR_THRESHOLD) prW[p.id] = v; }
  const prSeats = largestRemainder(prW, 245);
  // FPTP (147): by coalition vote^k (FPTP bonus to plurality), split within coalition by sqrt(pct)
  const coalPct: Record<string, number> = { CDX: 0, CSX: 0, M5S: 0, AZIV: 0 };
  for (const c of IT_COALITIONS) coalPct[c.id] = c.parties.reduce((s, pid) => s + (natPct[pid] || 0), 0);
  const coalW = Object.fromEntries(Object.entries(coalPct).map(([c, v]) => [c, Math.pow(Math.max(v, 0.01), 3.2)]));
  const coalFptp = largestRemainder(coalW, 147);
  const fptp: Record<string, number> = {};
  for (const c of IT_COALITIONS) {
    const within: Record<string, number> = {};
    c.parties.forEach(pid => { within[pid] = Math.sqrt(Math.max(0.04, natPct[pid] || 0)); });
    const w = largestRemainder(within, coalFptp[c.id] || 0);
    for (const [pid, n] of Object.entries(w)) fptp[pid] = (fptp[pid] || 0) + n;
  }
  // Overseas (8): proportional among parties >=1%
  const ovW: Record<string, number> = {};
  for (const p of IT_PARTIES) { if (p.id === 'ALTRI') continue; const v = natPct[p.id] || 0; if (v >= 1) ovW[p.id] = v; }
  const ov = largestRemainder(ovW, 8);
  const out = {} as Record<ItPartyId, number>;
  for (const p of IT_PARTIES) out[p.id] = (prSeats[p.id] || 0) + (fptp[p.id] || 0) + (ov[p.id] || 0);
  return out;
}

// ── Inspect panel (clicked feature) ─────────────────────────────────────────────
function InspectPanel({ feature, layer, live, dark, onClose }: {
  feature: GeoJSON.Feature; layer: LayerId; live: Record<string, number> | null; dark: boolean; onClose: () => void;
}) {
  const p = feature.properties as Record<string, unknown>;
  const name = String(layer === 'reg' ? p.reg_name : p.den);
  const isUni = layer === 'uni' && !live;
  const pr = (live as Record<string, number>) || (p.pr as Record<string, number> | null);
  const rows = pr ? IT_PR_KEYS.map(k => ({ id: k as ItPartyId, v: pr[k] || 0 })).filter(r => r.v > 0).sort((a, b) => b.v - a.v) : [];
  const maxV = Math.max(1, ...rows.map(r => r.v));
  const coal = (p.coal as string) || 'NONE';
  return (
    <aside className={`w-64 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold text-ink leading-tight truncate">{name}</h2>
          <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mt-0.5">{LAYERS.find(l=>l.id===layer)?.sub}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2">
        {isUni ? (
          <div className="rounded-[6px] px-3 py-3 text-center" style={{ background: hexToRgba(IT_COAL_COLOR[coal]||'#999', 0.14) }}>
            <div className="text-[8px] font-mono uppercase tracking-[0.16em] text-ink-3">Collegio vinto da</div>
            <div className="text-[14px] font-black mt-1" style={{ color: IT_COAL_COLOR[coal]||'#999' }}>{IT_COAL_NAME[coal]||'—'}</div>
            <div className="text-[8px] font-mono text-ink-3 mt-1">Maggioritario · uninominale FPTP</div>
          </div>
        ) : rows.length ? rows.map(r => {
          const party = IT_PARTY_MAP[r.id];
          return (
            <div key={r.id}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: party.color }} />
                <span className="text-[10px] text-ink flex-1 truncate">{party.fullName}</span>
                <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: party.color }}>{r.v.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)' }}>
                <div style={{ width: `${r.v/maxV*100}%`, height:'100%', background: party.color, opacity:0.85 }} />
              </div>
            </div>
          );
        }) : <div className="text-[10px] font-mono text-ink-3 text-center py-4">No proportional vote in this area</div>}
      </div>
    </aside>
  );
}

// ── Parliament hemicycle (400 seats) ────────────────────────────────────────────
function ParliamentPanel({ seats, dark, onClose }: { seats: Record<ItPartyId, number>; dark: boolean; onClose: () => void; }) {
  const total = IT_TOTAL_SEATS;
  // Order seats left→right by ideology
  const flat: string[] = [];
  [...IT_PARTIES].sort((a, b) => a.ideology - b.ideology).forEach(p => {
    for (let i = 0; i < (seats[p.id] || 0); i++) flat.push(p.color);
  });
  // hemicycle layout
  const rows = 13;
  const dots: { x: number; y: number; c: string }[] = [];
  const rowCounts: number[] = [];
  let remaining = flat.length;
  const baseR = 1;
  let weightSum = 0; for (let r = 0; r < rows; r++) weightSum += (baseR + r);
  for (let r = 0; r < rows; r++) rowCounts.push(Math.max(1, Math.round((baseR + r) / weightSum * flat.length)));
  let diff = flat.length - rowCounts.reduce((a, b) => a + b, 0);
  let ri = rows - 1; while (diff !== 0) { rowCounts[ri] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1; ri = (ri - 1 + rows) % rows; }
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const n = rowCounts[r]; const radius = 0.42 + (r / rows) * 0.56;
    for (let i = 0; i < n && idx < flat.length; i++) {
      const frac = n === 1 ? 0.5 : i / (n - 1);
      const ang = Math.PI - frac * Math.PI;
      dots.push({ x: 0.5 + Math.cos(ang) * radius * 0.5, y: 0.95 - Math.sin(ang) * radius * 0.9, c: flat[idx] });
      idx++;
    }
    remaining -= n;
  }
  void remaining;
  // coalition tallies
  const coalSeats = IT_COALITIONS.map(c => ({ ...c, n: c.parties.reduce((s, pid) => s + (seats[pid] || 0), 0) }));
  const leadCoal = coalSeats.reduce((b, c) => c.n > b.n ? c : b, coalSeats[0]);
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">Camera dei Deputati</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{total} seats · majority {IT_MAJORITY}</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3">
        <svg viewBox="0 0 1 1" className="w-full" style={{ aspectRatio: '1 / 0.62' }}>
          {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={0.0075} fill={d.c} />)}
        </svg>
        <div className="text-center -mt-3 mb-3">
          <div className="text-[9px] font-mono uppercase tracking-wide text-ink-3">Leading coalition</div>
          <div className="text-[13px] font-black" style={{ color: leadCoal.color }}>{leadCoal.name} · {leadCoal.n}</div>
          <div className="text-[8px] font-mono mt-0.5" style={{ color: leadCoal.n >= IT_MAJORITY ? '#16a34a' : '#ef4444' }}>
            {leadCoal.n >= IT_MAJORITY ? '✓ Absolute majority' : `${IT_MAJORITY - leadCoal.n} short of majority`}
          </div>
        </div>
        <div className="space-y-1.5">
          {coalSeats.sort((a, b) => b.n - a.n).map(c => (
            <div key={c.id}>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                <span className="flex-1 text-ink font-medium truncate">{c.name}</span>
                <span className="font-mono font-bold tabular-nums text-ink">{c.n}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Breakdown stats panel ───────────────────────────────────────────────────────
function BreakdownPanel({ seats, pcts, dark, onClose }: {
  seats: Record<ItPartyId, number>; pcts: Record<ItPartyId, number>; dark: boolean; onClose: () => void;
}) {
  const totalSeats = IT_PARTIES.reduce((s, p) => s + (seats[p.id] || 0), 0);
  const coalSeats = IT_COALITIONS.map(c => ({ ...c, n: c.parties.reduce((s, pid) => s + (seats[pid] || 0), 0), v: c.parties.reduce((s, pid) => s + (pcts[pid] || 0), 0) }));
  const top = [...IT_PARTIES].sort((a, b) => (seats[b.id]||0)-(seats[a.id]||0))[0];
  const mostEfficient = [...IT_PARTIES].filter(p => (pcts[p.id]||0) > 1)
    .map(p => ({ p, ratio: (seats[p.id]||0) / Math.max(0.1, pcts[p.id]||0) }))
    .sort((a, b) => b.ratio - a.ratio)[0];
  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div className={`rounded-[6px] px-3 py-2 ${dark?'bg-white/5':'bg-black/[0.03]'}`}>
      <div className="text-[8px] font-mono uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <div className="text-[13px] font-bold mt-0.5" style={{ color: color || (dark?'#e8eef8':'#111') }}>{value}</div>
    </div>
  );
  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <h2 className="text-[14px] font-bold text-ink leading-none">Breakdown</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2">
        <Stat label="Total seats" value={`${totalSeats} / 400`} />
        <Stat label="Largest party" value={`${top.fullName} · ${seats[top.id]||0}`} color={top.color} />
        <Stat label="Most seat-efficient" value={mostEfficient ? `${mostEfficient.p.name} (${mostEfficient.ratio.toFixed(1)} seats/%)` : '—'} color={mostEfficient?.p.color} />
        <div className="text-[8px] font-mono uppercase tracking-[0.16em] text-ink-3 pt-2 pb-1">Coalitions · seats vs vote</div>
        {coalSeats.sort((a,b)=>b.n-a.n).map(c => (
          <div key={c.id} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
            <span className="text-[10px] text-ink flex-1 truncate">{c.name}</span>
            <span className="text-[9px] font-mono text-ink-3">{c.v.toFixed(1)}%</span>
            <span className="text-[11px] font-mono font-bold tabular-nums text-ink w-7 text-right">{c.n}</span>
          </div>
        ))}
        <div className="text-[8px] font-mono uppercase tracking-[0.16em] text-ink-3 pt-2 pb-1">Seats by party</div>
        {[...IT_PARTIES].filter(p=>(seats[p.id]||0)>0).sort((a,b)=>(seats[b.id]||0)-(seats[a.id]||0)).map(p => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-[10px] text-ink flex-1 truncate">{p.fullName}</span>
            <span className="text-[9px] font-mono text-ink-3">{(pcts[p.id]||0).toFixed(1)}%</span>
            <span className="text-[11px] font-mono font-bold tabular-nums text-ink w-7 text-right">{seats[p.id]||0}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ── Tutorial ─────────────────────────────────────────────────────────────────
function TutorialPanel({ dark, onClose }: { dark: boolean; onClose: () => void; }) {
  const H = ({ c }: { c: string }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P = ({ c }: { c: string }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">How to Play</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Rosatellum · Camera dei Deputati</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5">
        <H c="The Rosatellum mixed system" />
        <P c="The Chamber of Deputies has 400 seats: 147 elected first-past-the-post in single-member collegi (uninominali), 245 by proportional representation in multi-member collegi (plurinominali, 3% party threshold), and 8 by Italians abroad." />
        <H c="Map layers" />
        <P c="Toggle between three geographies for the same election: ▸ Collegi uninominali — the FPTP map, each shaded by the winning coalition. ▸ Collegi plurinominali — the proportional districts, shaded by the leading party. ▸ Regioni — the 20 regions, leading party in the proportional vote." />
        <H c="Coalitions vs parties" />
        <P c="Uninominali are contested by coalitions (centre-right, centre-left, M5S, Terzo Polo). Proportional seats are won by individual party lists. The scoreboard shows total seats per party; the parliament view groups them into coalitions." />
        <H c="Simulation" />
        <P c="Open Simulazione, set each party's national list percentage, and run. Regions report election-night style; the dashboard recomputes seats live via the Rosatellum (PR largest-remainder + an FPTP coalition bonus). The 2022 baseline shows the real, certified result." />
      </div>
    </aside>
  );
}

// ── Simulation panel ─────────────────────────────────────────────────────────
const SIM_IDS: ItPartyId[] = ['FDI','PD','M5S','LEGA','FI','AZIV','AVS','PIU','NM','IC'];
function randNormal() { let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function SimulationPanel({ inputs, setInputs, running, onRun, onStop, progress, dark, onClose }: {
  inputs: Record<ItPartyId, string>; setInputs: (f: (p: Record<ItPartyId,string>)=>Record<ItPartyId,string>)=>void;
  running: boolean; onRun: () => void; onStop: () => void; progress: number; dark: boolean; onClose: () => void;
}) {
  const total = SIM_IDS.reduce((s, id) => s + (parseFloat(inputs[id])||0), 0);
  // remaining share (below total) implicitly goes to sub-threshold / other parties
  const valid = total >= 55 && total <= 101;
  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">Simulazione</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">National list % → seats</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2.5">
        {SIM_IDS.map(id => {
          const p = IT_PARTY_MAP[id]; const v = parseFloat(inputs[id])||0;
          return (
            <div key={id}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[10px] text-ink flex-1 truncate">{p.name}</span>
                <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: p.color }}>{v.toFixed(1)}%</span>
              </div>
              <input type="range" min={0} max={45} step={0.1} value={v} disabled={running}
                onChange={e => setInputs(prev => ({ ...prev, [id]: e.target.value }))}
                className="br-party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${Math.min(100, v*2.2)}%` } as React.CSSProperties} />
            </div>
          );
        })}
      </div>
      <div className="px-3.5 py-3 border-t border-default space-y-2 shrink-0">
        <div className={`flex justify-between text-[10.5px] font-mono font-bold border rounded px-2.5 py-1.5 ${valid?'text-emerald-600 border-emerald-200 bg-emerald-50':'text-red-500 border-red-200 bg-red-50'}`}>
          <span>Total</span><span>{total.toFixed(1)}%</span>
        </div>
        {running ? (
          <>
            <div className="h-2 rounded-full overflow-hidden bg-black/10"><div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} /></div>
            <button onClick={onStop} className="w-full h-9 rounded text-[12px] font-mono font-bold uppercase tracking-wide bg-[#B91C1C] text-white hover:bg-[#991B1B]">⏹ Stop</button>
          </>
        ) : (
          <button onClick={onRun} disabled={!valid} className="w-full h-9 rounded text-[12px] font-mono font-bold uppercase tracking-wide bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">▶ Run election night</button>
        )}
      </div>
    </aside>
  );
}

// ── Main app ─────────────────────────────────────────────────────────────────
type Panel = 'none' | 'parliament' | 'breakdown' | 'tutorial' | 'sim' | 'inspect';

export default function ItalyApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(true);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  const [layer, setLayer] = useState<LayerId>('uni');
  const [mode, setMode] = useState<'baseline' | 'sim'>('baseline');
  const [bubble, setBubble] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [selected, setSelected] = useState<GeoJSON.Feature | null>(null);

  // geojson cache per layer
  const [geo, setGeo] = useState<Record<LayerId, GeoJSON.FeatureCollection | null>>({ uni: null, pluri: null, reg: null });
  useEffect(() => {
    LAYERS.forEach(l => {
      fetch(`${import.meta.env.BASE_URL}${l.file}`).then(r => r.json())
        .then((fc: GeoJSON.FeatureCollection) => setGeo(prev => ({ ...prev, [l.id]: fc })))
        .catch(console.error);
    });
  }, []);

  // simulation state
  const [simInputs, setSimInputs] = useState<Record<ItPartyId, string>>(() =>
    Object.fromEntries(IT_PARTIES.map(p => [p.id, String(p.prPct2022)])) as Record<ItPartyId, string>);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [liveSeats, setLiveSeats] = useState<Record<ItPartyId, number> | null>(null);
  const [livePct, setLivePct] = useState<Record<ItPartyId, number> | null>(null);
  const [liveResults, setLiveResults] = useState<Record<string, Record<string, number>> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const seats = mode === 'sim' && liveSeats ? liveSeats : BASELINE_SEATS;
  const pcts  = mode === 'sim' && livePct ? livePct : BASELINE_PCT;

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  const stopSim = useCallback(() => { clearTimers(); setRunning(false); setProgress(0); setLiveResults(null); setLiveSeats(null); setLivePct(null); setMode('baseline'); }, []);

  const runSim = useCallback(() => {
    const regGeo = geo.reg; if (!regGeo) return;
    const target = Object.fromEntries(SIM_IDS.map(id => [id, parseFloat(simInputs[id]) || 0])) as Record<ItPartyId, number>;
    // uniform swing vs baseline national
    const swing = Object.fromEntries(SIM_IDS.map(id => [id, target[id] - BASELINE_PCT[id]])) as Record<ItPartyId, number>;
    setMode('sim'); setRunning(true); setProgress(0); setLiveResults({});
    setLiveSeats(Object.fromEntries(IT_PARTIES.map(p => [p.id, 0])) as Record<ItPartyId, number>);
    setLivePct(Object.fromEntries(IT_PARTIES.map(p => [p.id, 0])) as Record<ItPartyId, number>);

    const feats = regGeo.features.filter(f => (f.properties as Record<string,unknown>).pr);
    const order = [...feats].sort(() => Math.random() - 0.5);
    const n = order.length;
    // bell-curve report times over ~14s
    const totalMs = 14000;
    const times = order.map(() => Math.max(400, Math.min(totalMs-300, totalMs/2 + (totalMs/6)*randNormal()))).sort((a,b)=>a-b);
    const acc: Record<string, number> = {}; let accPop = 0; const accLive: Record<string, Record<string, number>> = {};
    let reported = 0;
    order.forEach((f, i) => {
      timersRef.current.push(setTimeout(() => {
        const props = f.properties as Record<string, unknown>;
        const base = props.pr as Record<string, number>;
        const key = String(props.reg_name);
        const pop = IT_REGION_POP[key] || 1_000_000;
        // swung region pct
        const swung: Record<string, number> = {};
        IT_PR_KEYS.forEach(k => { swung[k] = Math.max(0, (base[k] || 0) + (swing[k as ItPartyId] || 0)); });
        accLive[key] = swung;
        setLiveResults({ ...accLive });
        accPop += pop;
        IT_PR_KEYS.forEach(k => { acc[k] = (acc[k] || 0) + swung[k] * pop; });
        // national estimate from reported regions
        const est = {} as Record<ItPartyId, number>;
        const sumAll = IT_PR_KEYS.reduce((s, k) => s + (acc[k] || 0), 0);
        IT_PR_KEYS.forEach(k => { est[k as ItPartyId] = sumAll > 0 ? (acc[k] || 0) / sumAll * 100 : 0; });
        setLivePct({ ...est } as Record<ItPartyId, number>);
        setLiveSeats(computeSeats(est));
        reported++; setProgress(Math.round(reported / n * 100));
        if (reported === n) {
          // finalize with exact target
          setLivePct({ ...(Object.fromEntries(IT_PARTIES.map(p=>[p.id, target[p.id as ItPartyId] ?? 0])) as Record<ItPartyId, number>) });
          setLiveSeats(computeSeats(target));
          setRunning(false);
        }
      }, times[i]));
    });
  }, [geo.reg, simInputs]);

  useEffect(() => () => clearTimers(), []);

  const selectedKey = selected ? String(layer === 'reg' ? (selected.properties as Record<string,unknown>).reg_name : (selected.properties as Record<string,unknown>).den) : null;
  const onSelectFeature = useCallback((f: GeoJSON.Feature) => { setSelected(f); setPanel('inspect'); }, []);

  // when sim runs, force PR layer view (FPTP needs per-collegio shares we don't swing)
  useEffect(() => { if (running && layer === 'uni') setLayer('reg'); }, [running, layer]);

  const btn = (active: boolean) => `h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors uppercase tracking-wide shrink-0 ${active ? 'bg-[#c8a020] text-white' : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'}`;

  return (
    <div className={`h-screen flex flex-col ${dark ? 'dark' : ''}`} style={{ background: dark ? '#0a1426' : '#f3f1ec' }}>
      {/* Header */}
      <div className="h-[52px] shrink-0 flex items-center gap-2 px-2 border-b border-default" style={{ background: dark ? '#0d1b2e' : '#fff' }}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2 hover:opacity-80 pl-2 shrink-0" title="Home"><GlobeLogo /></button>
        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto thin-scroll px-1">
          <div className="w-px h-4 bg-black/10 shrink-0" />
          <button onClick={() => { stopSim(); }} className={btn(mode==='baseline')}>2022 Baseline</button>
          <button onClick={() => setPanel('sim')} className={btn(panel==='sim')}>Simulazione</button>
          <div className="w-px h-4 bg-black/10 shrink-0" />
          {/* layer toggle */}
          {LAYERS.map(l => (
            <button key={l.id} onClick={() => setLayer(l.id)} disabled={running && l.id==='uni'}
              className={`h-7 px-2.5 text-[10px] font-mono rounded-[4px] transition-colors tracking-wide shrink-0 ${layer===l.id ? 'bg-[#2563EB] text-white' : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'} disabled:opacity-30`}
              title={l.sub}>{l.label}</button>
          ))}
          <div className="w-px h-4 bg-black/10 shrink-0" />
          <button onClick={() => setBubble(b => !b)} className={btn(bubble)}>Bubble</button>
          <button onClick={() => setPanel('parliament')} className={btn(panel==='parliament')}>Parliament</button>
          <button onClick={() => setPanel('breakdown')} className={btn(panel==='breakdown')}>Breakdown</button>
          <button onClick={() => setPanel('tutorial')} className={btn(panel==='tutorial')}>Tutorial</button>
        </div>
        <button onClick={() => setDark(d => !d)} className="w-8 h-8 flex items-center justify-center rounded hover:bg-hover text-ink-3 shrink-0">{dark ? '☀' : '🌙'}</button>
      </div>

      {/* Scoreboard */}
      <div className="shrink-0 border-b border-default" style={{ background: dark ? '#0b1730' : '#faf9f6' }}>
        <ItalyScoreboard seats={seats} pcts={pcts} dark={dark} />
        {mode === 'sim' && (
          <div className="px-3 pb-1.5 -mt-1 text-[8.5px] font-mono uppercase tracking-wide flex items-center gap-1.5" style={{ color: running ? '#ef4444' : '#16a34a' }}>
            <span className={`w-1.5 h-1.5 rounded-full ${running?'animate-pulse':''}`} style={{ background: running?'#ef4444':'#16a34a' }} />
            {running ? `Counting… ${progress}% of regions reporting` : 'Projection complete · model estimate'}
          </div>
        )}
      </div>

      {/* Map + panels */}
      <div className="flex-1 min-h-0 flex relative">
        <div className="flex-1 min-w-0 relative">
          <ItalyMapView layer={layer} geoData={geo[layer]} liveResults={liveResults} dark={dark} bubble={bubble}
            onSelect={onSelectFeature} selectedKey={selectedKey} />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] text-[9px] font-mono px-2.5 py-0.5 rounded-full pointer-events-none"
            style={{ background: dark?'rgba(13,27,46,0.85)':'rgba(255,255,255,0.85)', color: dark?'#9fb0cc':'#666' }}>
            {LAYERS.find(l=>l.id===layer)?.label} · {LAYERS.find(l=>l.id===layer)?.sub}
          </div>
        </div>
        {panel === 'inspect' && selected && <InspectPanel feature={selected} layer={layer} live={liveResults?.[selectedKey || ''] || null} dark={dark} onClose={() => setPanel('none')} />}
        {panel === 'parliament' && <ParliamentPanel seats={seats} dark={dark} onClose={() => setPanel('none')} />}
        {panel === 'breakdown' && <BreakdownPanel seats={seats} pcts={pcts} dark={dark} onClose={() => setPanel('none')} />}
        {panel === 'tutorial' && <TutorialPanel dark={dark} onClose={() => setPanel('none')} />}
        {panel === 'sim' && <SimulationPanel inputs={simInputs} setInputs={setSimInputs} running={running} onRun={runSim} onStop={stopSim} progress={progress} dark={dark} onClose={() => setPanel('none')} />}
      </div>
    </div>
  );
}

