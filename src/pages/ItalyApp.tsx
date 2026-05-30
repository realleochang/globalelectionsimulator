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
  IT_COALITIONS, IT_COAL_COLOR, IT_COAL_NAME, IT_COAL_PARTIES, IT_COAL_KEYS, itPartyColor,
} from '../data/italyData';
import type { ItPartyId } from '../data/italyData';

// ── Map layers ─────────────────────────────────────────────────────────────────
type LayerId = 'uni' | 'pluri' | 'reg';
const LAYERS: { id: LayerId; label: string; sub: string; file: string }[] = [
  { id: 'uni',   label: 'Constituencies',  sub: 'FPTP · 147 single-member', file: 'italy-uninominali.geojson' },
  { id: 'pluri', label: 'PR districts',    sub: 'Proportional · 49',        file: 'italy-plurinominali.geojson' },
  { id: 'reg',   label: 'Regions',         sub: 'Proportional · 20',        file: 'italy-regioni.geojson' },
];
const PARTY_KEYS = IT_PR_KEYS;                       // editable keys on PR layers
const COAL_KEYS = [...IT_COAL_KEYS];                  // editable keys on the FPTP layer

// baseline within-coalition party ratios (to split an aggregated coalition vote)
const COAL_PARTY_RATIO: Record<string, { pid: ItPartyId; r: number }[]> = (() => {
  const out: Record<string, { pid: ItPartyId; r: number }[]> = {};
  for (const [coal, pids] of Object.entries(IT_COAL_PARTIES)) {
    const tot = pids.reduce((s, p) => s + (IT_PARTY_MAP[p]?.prPct2022 || 0), 0) || 1;
    out[coal] = pids.map(p => ({ pid: p, r: (IT_PARTY_MAP[p]?.prPct2022 || 0) / tot }));
  }
  return out;
})();

// ── helpers ──────────────────────────────────────────────────────────────────
type Shares = Record<string, number>;
function shade(base: string, strength: number, dark: boolean): string {
  const t = Math.min(Math.max(strength, 0), 1); const c = hsl(base);
  c.l = dark ? (0.58 - t*0.28) : (0.84 - t*0.44); return c.formatHex();
}
function leadKey(layer: LayerId, sh: Shares): string {
  const keys = layer === 'uni' ? COAL_KEYS : PARTY_KEYS;
  return keys.reduce((b, k) => (sh[k]||0) > (sh[b]||0) ? k : b, keys[0]);
}
function keyColor(layer: LayerId, k: string): string { return layer === 'uni' ? (IT_COAL_COLOR[k]||'#9AA0A6') : itPartyColor(k); }
function keyName(layer: LayerId, k: string): string { return layer === 'uni' ? (IT_COAL_NAME[k]||k) : (IT_PARTY_MAP[k as ItPartyId]?.name || k); }
function keyFull(layer: LayerId, k: string): string { return layer === 'uni' ? (IT_COAL_NAME[k]||k) : (IT_PARTY_MAP[k as ItPartyId]?.fullName || k); }

// feature accessors
function fKey(layer: LayerId, p: Record<string, unknown>): string { return String(layer === 'reg' ? p.reg_name : p.den); }
function fName(layer: LayerId, p: Record<string, unknown>): string { return String(layer === 'reg' ? p.reg_name : p.den); }
function fVotes(p: Record<string, unknown>): number { return (p.votes as number) || 0; }
function fBaseShares(layer: LayerId, p: Record<string, unknown>): Shares | null {
  if (layer === 'uni') return (p.shares as Shares) || null;
  return (p.pr as Shares) || null;
}

// Redistribute slider change among unlocked keys (keeps total constant)
function redistribute(cur: Shares, keys: string[], changed: string, val: number, locks: Set<string>): Shares {
  const next = { ...cur }; next[changed] = Math.max(0, Math.min(100, val));
  const lockedSum = keys.filter(k => locks.has(k) && k !== changed).reduce((s,k)=>s+(next[k]||0),0);
  const others = keys.filter(k => k !== changed && !locks.has(k));
  const room = 100 - next[changed] - lockedSum;
  const oldOthers = others.reduce((s,k)=>s+(cur[k]||0),0);
  if (room <= 0) { others.forEach(k => next[k]=0); }
  else if (oldOthers <= 0) { others.forEach(k => next[k]=room/others.length); }
  else { others.forEach(k => next[k]=(cur[k]||0)/oldOthers*room); }
  return next;
}

// ── Seat model (Rosatellum) ─────────────────────────────────────────────────────
function largestRemainder(weights: Record<string, number>, total: number): Record<string, number> {
  const keys = Object.keys(weights);
  const sum = keys.reduce((s,k)=>s+Math.max(0,weights[k]),0);
  const out: Record<string, number> = Object.fromEntries(keys.map(k=>[k,0]));
  if (sum<=0||total<=0) return out;
  const ex = keys.map(k=>({k,e:Math.max(0,weights[k])/sum*total}));
  let used=0; for (const x of ex){ out[x.k]=Math.floor(x.e); used+=out[x.k]; }
  ex.sort((a,b)=>(b.e-Math.floor(b.e))-(a.e-Math.floor(a.e)));
  let i=0; while(used<total&&ex.length){ out[ex[i%ex.length].k]++; used++; i++; }
  return out;
}
const BASELINE_SEATS = Object.fromEntries(IT_PARTIES.map(p=>[p.id,p.seats2022])) as Record<ItPartyId,number>;
const BASELINE_PCT   = Object.fromEntries(IT_PARTIES.map(p=>[p.id,p.prPct2022])) as Record<ItPartyId,number>;
function computeSeats(natPct: Record<ItPartyId, number>): Record<ItPartyId, number> {
  const prW: Record<string, number> = {};
  for (const p of IT_PARTIES) { if (p.id==='ALTRI') continue; const v=natPct[p.id]||0; if (v>=IT_PR_THRESHOLD) prW[p.id]=v; }
  const pr = largestRemainder(prW, 245);
  const coalPct: Record<string, number> = { CDX:0, CSX:0, M5S:0, AZIV:0 };
  for (const c of IT_COALITIONS) coalPct[c.id]=c.parties.reduce((s,pid)=>s+(natPct[pid]||0),0);
  const coalW = Object.fromEntries(Object.entries(coalPct).map(([c,v])=>[c,Math.pow(Math.max(v,0.01),3.2)]));
  const coalF = largestRemainder(coalW, 147);
  const fptp: Record<string, number> = {};
  for (const c of IT_COALITIONS) { const w: Record<string,number>={}; c.parties.forEach(pid=>w[pid]=Math.sqrt(Math.max(0.04,natPct[pid]||0))); const a=largestRemainder(w,coalF[c.id]||0); for(const[pid,n]of Object.entries(a))fptp[pid]=(fptp[pid]||0)+n; }
  const ovW: Record<string, number> = {};
  for (const p of IT_PARTIES){ if(p.id==='ALTRI')continue; const v=natPct[p.id]||0; if(v>=1)ovW[p.id]=v; }
  const ov = largestRemainder(ovW, 8);
  const out = {} as Record<ItPartyId, number>;
  for (const p of IT_PARTIES) out[p.id]=(pr[p.id]||0)+(fptp[p.id]||0)+(ov[p.id]||0);
  return out;
}
// Convert accumulated per-key votes (coalition OR party) → national seats + pcts
function accToResult(layer: LayerId, acc: Record<string, number>): { seats: Record<ItPartyId,number>; pcts: Record<ItPartyId,number>; totalVotes: number } {
  const pv = {} as Record<ItPartyId, number>;
  if (layer === 'uni') {
    for (const coal of COAL_KEYS) { const cv = acc[coal]||0; (COAL_PARTY_RATIO[coal]||[]).forEach(({pid,r})=>pv[pid]=(pv[pid]||0)+cv*r); }
  } else {
    for (const p of PARTY_KEYS) pv[p as ItPartyId] = acc[p]||0;
  }
  const tot = Object.values(pv).reduce((s,v)=>s+v,0);
  const pcts = {} as Record<ItPartyId, number>;
  for (const p of IT_PARTIES) pcts[p.id] = tot>0 ? (pv[p.id]||0)/tot*100 : 0;
  const zero = Object.fromEntries(IT_PARTIES.map(p=>[p.id,0])) as Record<ItPartyId,number>;
  return { seats: tot>0 ? computeSeats(pcts) : zero, pcts, totalVotes: tot };
}

// ── Scoreboard ───────────────────────────────────────────────────────────────
function ScoreboardTile({ party, seats, pct, isWinner, hasMajority, dark }: {
  party: typeof IT_PARTIES[0]; seats: number; pct: number; isWinner: boolean; hasMajority: boolean; dark: boolean;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => { let live=true; if (party.wikiTitle) fetchWikiPhoto(party.wikiTitle).then(u=>{if(live)setPhoto(u);}); return ()=>{live=false;}; }, [party.wikiTitle]);
  const initials = party.leader.split(/[ –]/).filter(Boolean).slice(0,2).map(s=>s[0]).join('');
  return (
    <div className={`relative shrink-0 rounded-[7px] border px-2.5 py-2 w-[150px] ${dark?'bg-[#10203a] border-white/10':'bg-white border-default'} ${isWinner?'ring-1 ring-[#c8a020]':''}`}>
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
function ItalyScoreboard({ seats, pcts, dark }: { seats: Record<ItPartyId,number>; pcts: Record<ItPartyId,number>; dark: boolean; }) {
  const ordered = useMemo(() => IT_PARTIES.filter(p => (seats[p.id]??0)>0 || (pcts[p.id]??0)>=0.5)
    .sort((a,b)=>(seats[b.id]??0)-(seats[a.id]??0) || (pcts[b.id]??0)-(pcts[a.id]??0)), [seats, pcts]);
  const top = ordered[0]?.id;
  return (
    <div className="flex gap-2 overflow-x-auto thin-scroll px-3 py-2">
      {ordered.map(p => <ScoreboardTile key={p.id} party={p} seats={seats[p.id]??0} pct={pcts[p.id]??0} isWinner={p.id===top} hasMajority={(seats[p.id]??0)>=IT_MAJORITY} dark={dark} />)}
      {!ordered.length && <div className="text-[11px] font-mono text-ink-3 px-3 py-4">No results yet — project districts or run a simulation.</div>}
    </div>
  );
}

// ── Map controller ──────────────────────────────────────────────────────────────
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const h = () => layerRef.current?.eachLayer((l)=>{ const p=l as unknown as {options?:{smoothFactor?:number}}; if(p.options)p.options.smoothFactor=0; });
    map.on('zoomend', h);
    const ro = new ResizeObserver(() => map.invalidateSize()); ro.observe(map.getContainer());
    return () => { map.off('zoomend', h); ro.disconnect(); };
  }, [map, layerRef]);
  return null;
}
function zoomScale(z: number) { return Math.max(0.4, Math.min(1, (z-4)/4)); }
function BubbleLayer({ geoData, layer, current, onSelect }: {
  geoData: GeoJSON.FeatureCollection | null; layer: LayerId; current: (f: GeoJSON.Feature) => Shares | null; onSelect: (f: GeoJSON.Feature) => void;
}) {
  const map = useMap(); const ref = useRef<{m:L.CircleMarker;base:number}[]>([]);
  useEffect(()=>{ const z=()=>{const s=zoomScale(map.getZoom());ref.current.forEach(({m,base})=>m.setRadius(base*s));}; map.on('zoomend',z); return ()=>{map.off('zoomend',z);}; },[map]);
  useEffect(() => {
    ref.current.forEach(({m})=>m.remove()); ref.current=[];
    if (!geoData) return;
    const s = zoomScale(map.getZoom()); const gj = L.geoJSON(geoData as GeoJSON.GeoJsonObject);
    gj.eachLayer((lyr) => {
      const feat=(lyr as unknown as {feature?:GeoJSON.Feature}).feature; const b=(lyr as unknown as {getBounds?:()=>L.LatLngBounds}).getBounds?.();
      if(!feat||!b||!b.isValid())return;
      const sh = current(feat); if(!sh) return;
      const keys = layer==='uni'?COAL_KEYS:PARTY_KEYS;
      const sorted=keys.map(k=>sh[k]||0).sort((a,b)=>b-a);
      const margin=Math.max(0.06,((sorted[0]||0)-(sorted[1]||0))/100);
      const lead=leadKey(layer,sh); const c=b.getCenter();
      const base=Math.max(5,Math.min(26,5+margin*60));
      const m=L.circleMarker([c.lat,c.lng],{radius:base*s,fillColor:keyColor(layer,lead),fillOpacity:0.85,color:'#fff',weight:1});
      m.on('click',()=>onSelect(feat)); m.addTo(map); ref.current.push({m,base});
    });
    return ()=>{ ref.current.forEach(({m})=>m.remove()); ref.current=[]; };
  }, [geoData, layer, current, map, onSelect]);
  return null;
}

// ── Map view ─────────────────────────────────────────────────────────────────
function ItalyMapView({ layer, geoData, getResult, getReporting, dark, bubble, mode, onSelect, selectedKey }: {
  layer: LayerId; geoData: GeoJSON.FeatureCollection | null;
  getResult: (f: GeoJSON.Feature) => Shares | null;  // current shares to display, or null = blank/not-reported
  getReporting: (f: GeoJSON.Feature) => number | null; // % reported (blank/sim), or null in results mode
  dark: boolean; bubble: boolean; mode: 'results'|'blank'|'sim';
  onSelect: (f: GeoJSON.Feature) => void; selectedKey: string | null;
}) {
  const layerRef = useRef<L.GeoJSON | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number;name:string;win:string;rows:{label:string;color:string;val:string}[];rep:number|null} | null>(null);
  const ctx = useRef({ layer, getResult, getReporting, dark, selectedKey, mode });
  useEffect(()=>{ ctx.current={layer,getResult,getReporting,dark,selectedKey,mode}; },[layer,getResult,getReporting,dark,selectedKey,mode]);

  const fill = useCallback((f: GeoJSON.Feature): string => {
    const sh = ctx.current.getResult(f);
    if (!sh) return ctx.current.dark ? '#2c3a52' : '#dfe3ea';
    const keys = ctx.current.layer==='uni'?COAL_KEYS:PARTY_KEYS;
    const sorted = keys.map(k=>sh[k]||0).sort((a,b)=>b-a);
    const margin = ((sorted[0]||0)-(sorted[1]||0))/40;
    return shade(keyColor(ctx.current.layer, leadKey(ctx.current.layer, sh)), 0.42+margin, ctx.current.dark);
  }, []);
  const style = useCallback((f?: GeoJSON.Feature): L.PathOptions => {
    if (!f) return {};
    const sel = fKey(ctx.current.layer, f.properties as Record<string,unknown>) === ctx.current.selectedKey;
    if (bubble) return { fillOpacity:0, weight:0.4, color: ctx.current.dark?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.16)', opacity:0.6 };
    return { fillColor: fill(f), fillOpacity:0.85, weight: sel?2.2:0.4, color: sel?'#c8a020':(ctx.current.dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.3)'), opacity:1 };
  }, [fill, bubble]);
  useEffect(()=>{ layerRef.current?.setStyle((f)=>style(f as GeoJSON.Feature)); });

  const onEach = useCallback((f: GeoJSON.Feature, lyr: L.Layer) => {
    lyr.on('click', () => onSelect(f));
    lyr.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubble) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
      const props = f.properties as Record<string, unknown>;
      const sh = ctx.current.getResult(f); const rep = ctx.current.getReporting(f);
      const votes = fVotes(props); const repVotes = rep!=null ? Math.round(votes*rep/100) : votes;
      const keys = ctx.current.layer==='uni'?COAL_KEYS:PARTY_KEYS;
      let win=''; let rows:{label:string;color:string;val:string}[]=[];
      if (sh) {
        win = ctx.current.layer==='uni' ? keyName(ctx.current.layer, leadKey(ctx.current.layer, sh)) : keyName(ctx.current.layer, leadKey(ctx.current.layer, sh));
        rows = keys.map(k=>({k,v:sh[k]||0})).filter(r=>r.v>=1).sort((a,b)=>b.v-a.v).slice(0,5)
          .map(r=>({ label: keyName(ctx.current.layer,r.k), color: keyColor(ctx.current.layer,r.k), val: `${r.v.toFixed(1)}% · ${Math.round(repVotes*r.v/100).toLocaleString()}` }));
      }
      setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top, name:fName(ctx.current.layer,props), win, rows, rep });
    });
    lyr.on('mouseout', () => setTooltip(null));
  }, [bubble, onSelect]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[42.2,12.5]} zoom={6} minZoom={5} maxZoom={12} style={{width:'100%',height:'100%'}} zoomControl preferCanvas>
        <TileLayer key={dark?'d':'l'} url={dark?'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png':'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'} attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" />
        <MapController layerRef={layerRef} />
        {geoData && !bubble && <GeoJSON key={layer+mode} data={geoData} ref={(r)=>{layerRef.current=r as unknown as L.GeoJSON;}} style={(f)=>style(f as GeoJSON.Feature)} onEachFeature={onEach} />}
        {geoData && bubble && <BubbleLayer geoData={geoData} layer={layer} current={getResult} onSelect={onSelect} />}
      </MapContainer>
      {tooltip && (
        <div className="absolute z-[1000] pointer-events-none rounded-[6px] px-2.5 py-1.5 shadow-lg" style={{ left:tooltip.x+14, top:tooltip.y+8, background:dark?'rgba(8,16,40,0.97)':'rgba(255,255,255,0.98)', border:`1px solid ${dark?'rgba(255,255,255,0.12)':'rgba(0,0,0,0.1)'}`, maxWidth:250 }}>
          <div className="text-[11px] font-bold mb-0.5" style={{ color:dark?'#e8eef8':'#111' }}>{tooltip.name}</div>
          {tooltip.rep!=null && <div className="text-[8px] font-mono uppercase tracking-wide mb-1" style={{ color: tooltip.rep>=100?'#16a34a':tooltip.rep>0?'#f59e0b':'#9aa0a6' }}>{tooltip.rep>0?`${tooltip.rep}% reporting`:'Not yet reporting'}</div>}
          {tooltip.win && <div className="text-[8px] font-mono uppercase tracking-wide mb-1 text-ink-3">▸ {tooltip.win}</div>}
          {tooltip.rows.map((r,i)=>(
            <div key={i} className="flex items-center gap-1.5 text-[9.5px]" style={{ color:dark?'#cfd8ea':'#333' }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background:r.color }} />
              <span className="flex-1 truncate">{r.label}</span>
              <span className="font-mono tabular-nums text-[9px]">{r.val}</span>
            </div>
          ))}
          {!tooltip.rows.length && <div className="text-[9px] font-mono text-ink-3">No votes counted yet</div>}
        </div>
      )}
    </div>
  );
}

// ── Blank-map edit panel ────────────────────────────────────────────────────
function EditPanel({ feature, layer, existing, onProject, onShowRef, dark, onClose }: {
  feature: GeoJSON.Feature; layer: LayerId; existing: { shares: Shares; reporting: number } | undefined;
  onProject: (shares: Shares, reporting: number) => void; onShowRef: () => void; dark: boolean; onClose: () => void;
}) {
  const props = feature.properties as Record<string, unknown>;
  const keys = layer === 'uni' ? COAL_KEYS : PARTY_KEYS;
  const base = fBaseShares(layer, props) || Object.fromEntries(keys.map(k=>[k,0]));
  const votes = fVotes(props);
  const [draft, setDraft] = useState<Shares>(() => existing ? { ...existing.shares } : { ...base });
  const [reporting, setReporting] = useState<number>(() => existing ? existing.reporting : 100);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  useEffect(() => { setDraft(existing ? { ...existing.shares } : { ...base }); setReporting(existing ? existing.reporting : 100); setLocks(new Set()); setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fKey(layer, props), layer]);

  const repVotes = Math.round(votes * reporting / 100);
  const shown = keys.filter(k => (draft[k]||0) > 0 || layer==='uni' || (base[k]||0) > 0)
    .sort((a,b)=>(draft[b]||0)-(draft[a]||0));
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3 pb-2.5 border-b border-default shrink-0 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold text-ink leading-tight truncate">{fName(layer, props)}</h2>
          <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mt-0.5">{existing ? 'Projected · adjust & update' : 'Blank · set the result'}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="px-3.5 py-1.5 border-b border-default shrink-0">
        <button onClick={onShowRef} className="w-full h-7 text-[10px] font-mono rounded-[5px] border border-default text-ink-3 hover:bg-hover hover:text-ink uppercase tracking-wide">← Show 2022 result</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {/* % reporting on top */}
        <div className="px-3.5 pt-3 pb-3 border-b border-default">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[8px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">% Reporting</span>
            <span className="text-[13px] font-mono font-black tabular-nums" style={{ color: reporting<50?'#ef4444':reporting<100?'#f59e0b':'#16a34a' }}>{reporting}%</span>
          </div>
          <input type="range" min={1} max={100} step={1} value={reporting} onChange={e=>{ setReporting(+e.target.value); setTouched(true); }}
            className="br-party-slider w-full" style={{ '--party-color': reporting<50?'#ef4444':reporting<100?'#f59e0b':'#16a34a', '--pct': `${reporting}%` } as React.CSSProperties} />
          <div className="text-[8px] font-mono mt-0.5 text-ink-3">≈ {repVotes.toLocaleString()} of {votes.toLocaleString()} votes counted</div>
        </div>
        <div className="px-3.5 py-3 space-y-3">
          {shown.map(k => {
            const v = draft[k] || 0; const isLocked = locks.has(k); const col = keyColor(layer, k);
            return (
              <div key={k}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                  <span className="text-[10px] text-ink flex-1 truncate">{keyFull(layer, k)}</span>
                  <button onClick={()=>setLocks(p=>{const n=new Set(p);n.has(k)?n.delete(k):n.add(k);return n;})} className={`shrink-0 w-4 h-4 flex items-center justify-center ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`}>
                    {isLocked ? '🔒' : '🔓'}
                  </button>
                  <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: col }}>{v.toFixed(1)}%</span>
                </div>
                <input type="range" min={0} max={100} step={0.1} value={v} disabled={isLocked}
                  onChange={e=>{ setDraft(redistribute(draft, keys, k, parseFloat(e.target.value), locks)); setTouched(true); }}
                  className="br-party-slider w-full" style={{ '--party-color': col, '--pct': `${v}%` } as React.CSSProperties} />
                <div className="text-right text-[8px] font-mono text-ink-3 mt-0.5">{Math.round(repVotes * v/100).toLocaleString()} votes</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="px-3.5 py-3 border-t border-default shrink-0">
        <button onClick={()=>{ if(touched) onProject(draft, reporting); }} disabled={!touched}
          className={`w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors ${!touched?'border border-default text-ink-3 opacity-50 cursor-not-allowed':existing?'bg-emerald-600 text-white hover:bg-emerald-700':'bg-[#2563EB] text-white hover:bg-[#1d4ed8]'}`}>
          {!touched ? 'Adjust a slider first' : existing ? '↻ Update Projection' : '📍 Project Result'}
        </button>
      </div>
    </aside>
  );
}

// ── 2022 baseline reference (left popup) ────────────────────────────────────────
function BaselineRefPanel({ feature, layer, dark, onClose }: { feature: GeoJSON.Feature; layer: LayerId; dark: boolean; onClose: () => void; }) {
  const props = feature.properties as Record<string, unknown>;
  const keys = layer==='uni'?COAL_KEYS:PARTY_KEYS;
  const base = fBaseShares(layer, props) || {};
  const rows = keys.map(k=>({k,v:base[k]||0})).filter(r=>r.v>0).sort((a,b)=>b.v-a.v);
  const maxV = Math.max(1, ...rows.map(r=>r.v));
  return (
    <aside className={`w-60 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden panel-slide-left`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div className="min-w-0">
          <h2 className="text-[12px] font-bold text-ink leading-tight truncate">{fName(layer,props)} · 2022</h2>
          <div className="text-[8px] font-mono text-ink-3 uppercase tracking-wide mt-0.5">Official result · reference</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2">
        {rows.map(r=>{ const col=keyColor(layer,r.k); return (
          <div key={r.k}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
              <span className="text-[10px] text-ink flex-1 truncate">{keyName(layer,r.k)}</span>
              <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color: col }}>{r.v.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)' }}>
              <div style={{ width:`${r.v/maxV*100}%`, height:'100%', background:col, opacity:0.85 }} />
            </div>
          </div>
        ); })}
      </div>
    </aside>
  );
}

// ── Parliament hemicycle ────────────────────────────────────────────────────────
function ParliamentPanel({ seats, dark, onClose }: { seats: Record<ItPartyId,number>; dark: boolean; onClose: () => void; }) {
  const flat: string[] = [];
  [...IT_PARTIES].sort((a,b)=>a.ideology-b.ideology).forEach(p=>{ for(let i=0;i<(seats[p.id]||0);i++) flat.push(p.color); });
  const rows=13; const dots:{x:number;y:number;c:string}[]=[]; const rc:number[]=[];
  let ws=0; for(let r=0;r<rows;r++) ws+=1+r;
  for(let r=0;r<rows;r++) rc.push(Math.max(1,Math.round((1+r)/ws*flat.length)));
  let diff=flat.length-rc.reduce((a,b)=>a+b,0); let ri=rows-1; while(diff!==0){ rc[ri]+=diff>0?1:-1; diff+=diff>0?-1:1; ri=(ri-1+rows)%rows; }
  let idx=0; for(let r=0;r<rows;r++){ const n=rc[r]; const rad=0.42+(r/rows)*0.56; for(let i=0;i<n&&idx<flat.length;i++){ const fr=n===1?0.5:i/(n-1); const a=Math.PI-fr*Math.PI; dots.push({x:0.5+Math.cos(a)*rad*0.5,y:0.95-Math.sin(a)*rad*0.9,c:flat[idx]}); idx++; } }
  const coal = IT_COALITIONS.map(c=>({...c,n:c.parties.reduce((s,pid)=>s+(seats[pid]||0),0)}));
  const lead = coal.reduce((b,c)=>c.n>b.n?c:b,coal[0]);
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h2 className="text-[14px] font-bold text-ink leading-none">Chamber of Deputies</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{IT_TOTAL_SEATS} seats · majority {IT_MAJORITY}</p></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3">
        <svg viewBox="0 0 1 1" className="w-full" style={{ aspectRatio:'1 / 0.62' }}>{dots.map((d,i)=><circle key={i} cx={d.x} cy={d.y} r={0.0075} fill={d.c} />)}</svg>
        <div className="text-center -mt-3 mb-3">
          <div className="text-[9px] font-mono uppercase tracking-wide text-ink-3">Leading coalition</div>
          <div className="text-[13px] font-black" style={{ color: lead.color }}>{lead.name} · {lead.n}</div>
          <div className="text-[8px] font-mono mt-0.5" style={{ color: lead.n>=IT_MAJORITY?'#16a34a':'#ef4444' }}>{lead.n>=IT_MAJORITY?'✓ Absolute majority':`${IT_MAJORITY-lead.n} short of majority`}</div>
        </div>
        <div className="space-y-1.5">{coal.sort((a,b)=>b.n-a.n).map(c=>(
          <div key={c.id} className="flex items-center gap-1.5 text-[10px]"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background:c.color }} /><span className="flex-1 text-ink font-medium truncate">{c.name}</span><span className="font-mono font-bold tabular-nums text-ink">{c.n}</span></div>
        ))}</div>
      </div>
    </aside>
  );
}

// ── Breakdown ─────────────────────────────────────────────────────────────────
function BreakdownPanel({ seats, pcts, dark, onClose }: { seats: Record<ItPartyId,number>; pcts: Record<ItPartyId,number>; dark: boolean; onClose: () => void; }) {
  const totalSeats = IT_PARTIES.reduce((s,p)=>s+(seats[p.id]||0),0);
  const coal = IT_COALITIONS.map(c=>({...c,n:c.parties.reduce((s,pid)=>s+(seats[pid]||0),0),v:c.parties.reduce((s,pid)=>s+(pcts[pid]||0),0)}));
  const top=[...IT_PARTIES].sort((a,b)=>(seats[b.id]||0)-(seats[a.id]||0))[0];
  const eff=[...IT_PARTIES].filter(p=>(pcts[p.id]||0)>1).map(p=>({p,ratio:(seats[p.id]||0)/Math.max(0.1,pcts[p.id]||0)})).sort((a,b)=>b.ratio-a.ratio)[0];
  const Stat=({label,value,color}:{label:string;value:string;color?:string})=>(<div className={`rounded-[6px] px-3 py-2 ${dark?'bg-white/5':'bg-black/[0.03]'}`}><div className="text-[8px] font-mono uppercase tracking-[0.14em] text-ink-3">{label}</div><div className="text-[13px] font-bold mt-0.5" style={{ color: color||(dark?'#e8eef8':'#111') }}>{value}</div></div>);
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0"><h2 className="text-[14px] font-bold text-ink leading-none">Breakdown</h2><button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button></div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2">
        <Stat label="Total seats" value={`${totalSeats} / 400`} />
        <Stat label="Largest party" value={`${top.fullName} · ${seats[top.id]||0}`} color={top.color} />
        <Stat label="Most seat-efficient" value={eff?`${eff.p.name} (${eff.ratio.toFixed(1)} seats/%)`:'—'} color={eff?.p.color} />
        <div className="text-[8px] font-mono uppercase tracking-[0.16em] text-ink-3 pt-2 pb-1">Coalitions · seats vs vote</div>
        {coal.sort((a,b)=>b.n-a.n).map(c=>(<div key={c.id} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{background:c.color}}/><span className="text-[10px] text-ink flex-1 truncate">{c.name}</span><span className="text-[9px] font-mono text-ink-3">{c.v.toFixed(1)}%</span><span className="text-[11px] font-mono font-bold tabular-nums text-ink w-7 text-right">{c.n}</span></div>))}
        <div className="text-[8px] font-mono uppercase tracking-[0.16em] text-ink-3 pt-2 pb-1">Seats by party</div>
        {[...IT_PARTIES].filter(p=>(seats[p.id]||0)>0).sort((a,b)=>(seats[b.id]||0)-(seats[a.id]||0)).map(p=>(<div key={p.id} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full shrink-0" style={{background:p.color}}/><span className="text-[10px] text-ink flex-1 truncate">{p.fullName}</span><span className="text-[9px] font-mono text-ink-3">{(pcts[p.id]||0).toFixed(1)}%</span><span className="text-[11px] font-mono font-bold tabular-nums text-ink w-7 text-right">{seats[p.id]||0}</span></div>))}
      </div>
    </aside>
  );
}

// ── Tutorial ─────────────────────────────────────────────────────────────────
function TutorialPanel({ dark, onClose }: { dark: boolean; onClose: () => void; }) {
  const H=({c}:{c:string})=><div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P=({c}:{c:string})=><p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0"><div><h2 className="text-[14px] font-bold text-ink leading-none">How to Play</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Rosatellum · Chamber of Deputies</p></div><button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button></div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5">
        <H c="The mixed Rosatellum system" /><P c="The Chamber has 400 seats: 147 first-past-the-post in single-member constituencies (uninominali), 245 proportional in multi-member districts (3% party threshold), and 8 for Italians abroad." />
        <H c="Map layers" /><P c="Switch geographies for the same election: Constituencies (147 FPTP, shaded by winning coalition), PR districts (49) and Regions (20) shaded by the leading party. Toggle Bubble for a margin-sized view." />
        <H c="Blank Map" /><P c="Pick a layer, then click any district to open its panel. The % Reporting slider on top scales the raw votes; party/coalition sliders set the shares (lock any to pin it). Nothing changes on the map or dashboard until you press Project Result — re-click any district to Update its projection. Use ‘Show 2022 result’ for the real reference." />
        <H c="Simulation" /><P c="Set each party's national list %, choose a duration (1/2/5/10 min) and Run. Districts report in five random batches on a bell curve; the map fills and the dashboard recomputes seats live, election-night style. Hover a district for its % reporting and current votes." />
        <H c="Seats" /><P c="Totals follow the Rosatellum: proportional seats by largest-remainder over the 3% threshold, plus single-member seats with the usual coalition winner's bonus. The 2022 Results view shows the real certified outcome." />
      </div>
    </aside>
  );
}

// ── Simulation panel ─────────────────────────────────────────────────────────
const SIM_IDS: ItPartyId[] = ['FDI','PD','M5S','LEGA','FI','AZIV','AVS','PIU','NM','IC'];
const DURATIONS: { s: number; label: string }[] = [{s:60,label:'1 min'},{s:120,label:'2 min'},{s:300,label:'5 min'},{s:600,label:'10 min'}];
function SimulationPanel({ inputs, setInputs, duration, setDuration, running, onRun, onStop, progress, dark, onClose }: {
  inputs: Record<ItPartyId,string>; setInputs: (f:(p:Record<ItPartyId,string>)=>Record<ItPartyId,string>)=>void;
  duration: number; setDuration: (s:number)=>void; running: boolean; onRun: ()=>void; onStop: ()=>void; progress: number; dark: boolean; onClose: ()=>void;
}) {
  const total = SIM_IDS.reduce((s,id)=>s+(parseFloat(inputs[id])||0),0);
  const valid = total>=55 && total<=101;
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0"><div><h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">National list % → election night</p></div><button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base">×</button></div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2.5">
        {SIM_IDS.map(id=>{ const p=IT_PARTY_MAP[id]; const v=parseFloat(inputs[id])||0; return (
          <div key={id}>
            <div className="flex items-center gap-1.5 mb-0.5"><span className="w-2 h-2 rounded-full shrink-0" style={{background:p.color}}/><span className="text-[10px] text-ink flex-1 truncate">{p.name}</span><span className="text-[10px] font-mono font-bold tabular-nums" style={{color:p.color}}>{v.toFixed(1)}%</span></div>
            <input type="range" min={0} max={45} step={0.1} value={v} disabled={running} onChange={e=>setInputs(prev=>({...prev,[id]:e.target.value}))} className="br-party-slider w-full" style={{ '--party-color':p.color,'--pct':`${Math.min(100,v*2.2)}%` } as React.CSSProperties} />
          </div>
        ); })}
      </div>
      <div className="px-3.5 py-3 border-t border-default space-y-2 shrink-0">
        <div className={`flex justify-between text-[10.5px] font-mono font-bold border rounded px-2.5 py-1.5 ${valid?'text-emerald-600 border-emerald-200 bg-emerald-50':'text-red-500 border-red-200 bg-red-50'}`}><span>Total</span><span>{total.toFixed(1)}%</span></div>
        {!running && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-mono text-ink-3 uppercase shrink-0 mr-1">Length</span>
            {DURATIONS.map(d=><button key={d.s} onClick={()=>setDuration(d.s)} className={`flex-1 h-7 text-[9.5px] font-mono rounded border transition-colors ${duration===d.s?'bg-ink/10 border-ink/25 text-ink':'border-default text-ink-3 hover:bg-hover'}`}>{d.label}</button>)}
          </div>
        )}
        {running ? (<>
          <div className="h-2 rounded-full overflow-hidden bg-black/10"><div className="h-full bg-blue-600 transition-all" style={{ width:`${progress}%` }} /></div>
          <button onClick={onStop} className="w-full h-9 rounded text-[12px] font-mono font-bold uppercase tracking-wide bg-[#B91C1C] text-white hover:bg-[#991B1B]">⏹ Stop</button>
        </>) : (
          <button onClick={onRun} disabled={!valid} className="w-full h-9 rounded text-[12px] font-mono font-bold uppercase tracking-wide bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">▶ Run election night</button>
        )}
      </div>
    </aside>
  );
}

// ── Main app ─────────────────────────────────────────────────────────────────
type Mode = 'results' | 'blank' | 'sim';
type Panel = 'none' | 'parliament' | 'breakdown' | 'tutorial' | 'sim' | 'edit';
type Override = { shares: Shares; reporting: number };
function randNormal() { let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
const emptyOv = (): Record<LayerId, Record<string, Override>> => ({ uni:{}, pluri:{}, reg:{} });

export default function ItalyApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(true);
  useEffect(()=>{ document.documentElement.classList.toggle('dark', dark); }, [dark]);

  const [layer, setLayer] = useState<LayerId>('uni');
  const [mode, setMode] = useState<Mode>('results');
  const [bubble, setBubble] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [selected, setSelected] = useState<GeoJSON.Feature | null>(null);
  const [showRef, setShowRef] = useState(false);

  const [geo, setGeo] = useState<Record<LayerId, GeoJSON.FeatureCollection | null>>({ uni:null, pluri:null, reg:null });
  useEffect(()=>{ LAYERS.forEach(l=>{ fetch(`${import.meta.env.BASE_URL}${l.file}`).then(r=>r.json()).then((fc:GeoJSON.FeatureCollection)=>setGeo(prev=>({...prev,[l.id]:fc}))).catch(console.error); }); }, []);

  const [overrides, setOverrides] = useState<Record<LayerId, Record<string, Override>>>(emptyOv());
  const [simInputs, setSimInputs] = useState<Record<ItPartyId,string>>(()=>Object.fromEntries(IT_PARTIES.map(p=>[p.id,String(p.prPct2022)])) as Record<ItPartyId,string>);
  const [duration, setDuration] = useState(60);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current=[]; };
  useEffect(()=>()=>clearTimers(), []);

  // votes lookup for active layer
  const votesByKey = useMemo(()=>{ const m:Record<string,number>={}; geo[layer]?.features.forEach(f=>{ m[fKey(layer,f.properties as Record<string,unknown>)]=fVotes(f.properties as Record<string,unknown>); }); return m; }, [geo, layer]);
  const totalFeatures = geo[layer]?.features.filter(f=>fBaseShares(layer,f.properties as Record<string,unknown>)).length || 0;

  // live dashboard
  const live = useMemo(() => {
    if (mode === 'results') return { seats: BASELINE_SEATS, pcts: BASELINE_PCT };
    const ov = overrides[layer] || {}; const acc: Record<string, number> = {}; const keys = layer==='uni'?COAL_KEYS:PARTY_KEYS;
    for (const [k, o] of Object.entries(ov)) { const rv = (votesByKey[k]||0)*o.reporting/100; keys.forEach(kk=>acc[kk]=(acc[kk]||0)+((o.shares[kk]||0)/100)*rv); }
    return accToResult(layer, acc);
  }, [mode, overrides, layer, votesByKey]);
  const seats = live.seats, pcts = live.pcts;
  const reportedCount = mode==='results' ? 0 : Object.keys(overrides[layer]||{}).length;
  const reportingPct = totalFeatures>0 ? Math.round(reportedCount/totalFeatures*100) : 0;

  const getResult = useCallback((f: GeoJSON.Feature): Shares | null => {
    const p = f.properties as Record<string, unknown>;
    if (mode === 'results') return fBaseShares(layer, p);
    return overrides[layer]?.[fKey(layer, p)]?.shares ?? null;
  }, [mode, layer, overrides]);
  const getReporting = useCallback((f: GeoJSON.Feature): number | null => {
    if (mode === 'results') return null;
    return overrides[layer]?.[fKey(layer, f.properties as Record<string,unknown>)]?.reporting ?? 0;
  }, [mode, layer, overrides]);

  const selectedKey = selected ? fKey(layer, selected.properties as Record<string,unknown>) : null;
  const onSelectFeature = useCallback((f: GeoJSON.Feature) => {
    setSelected(f);
    if (mode === 'blank') setPanel('edit');
  }, [mode]);

  const switchMode = (m: Mode) => {
    clearTimers(); setRunning(false); setProgress(0); setOverrides(emptyOv()); setSelected(null); setShowRef(false);
    setMode(m); setPanel(m==='sim' ? 'sim' : 'none');
  };

  const projectFeature = (shares: Shares, reporting: number) => {
    if (!selected) return;
    const key = fKey(layer, selected.properties as Record<string,unknown>);
    setOverrides(prev => ({ ...prev, [layer]: { ...prev[layer], [key]: { shares: { ...shares }, reporting } } }));
  };

  const runSim = useCallback(() => {
    const fc = geo[layer]; if (!fc) return;
    const feats = fc.features.filter(f=>fBaseShares(layer, f.properties as Record<string,unknown>));
    const target = Object.fromEntries(SIM_IDS.map(id=>[id, parseFloat(simInputs[id])||0])) as Record<ItPartyId,number>;
    const swing = Object.fromEntries(SIM_IDS.map(id=>[id, target[id]-BASELINE_PCT[id]])) as Record<ItPartyId,number>;
    setMode('sim'); setRunning(true); setProgress(0); setOverrides(emptyOv()); setPanel('sim');
    // precompute each feature's reported shares (baseline + swing)
    const reported: { key: string; shares: Shares }[] = feats.map(f => {
      const p = f.properties as Record<string,unknown>; const base = fBaseShares(layer, p)!; const out: Shares = {};
      if (layer === 'uni') {
        for (const coal of COAL_KEYS) { const cs = (COAL_PARTY_RATIO[coal]||[]).reduce((s,{pid})=>s+(swing[pid]||0),0); out[coal] = Math.max(0,(base[coal]||0)+cs); }
      } else { for (const k of PARTY_KEYS) out[k] = Math.max(0,(base[k]||0)+(swing[k as ItPartyId]||0)); }
      return { key: fKey(layer, p), shares: out };
    });
    // 5 random-sized batches, bell-curve report times
    const shuffled = [...reported].sort(()=>Math.random()-0.5);
    const nB = 5; const sizes: number[] = []; let rem = shuffled.length;
    for (let i=0;i<nB-1;i++){ const s=Math.max(1,Math.round(shuffled.length*(0.1+Math.random()*0.3))); sizes.push(Math.min(s,rem-(nB-1-i))); rem-=sizes[i]; }
    sizes.push(rem);
    const totalMs = duration*1000;
    const times = Array.from({length:nB},()=>Math.max(800,Math.min(totalMs-400, totalMs/2 + (totalMs/6)*randNormal()))).sort((a,b)=>a-b);
    let off=0, done=0;
    sizes.forEach((sz, bi) => {
      const batch = shuffled.slice(off, off+sz); off+=sz;
      timersRef.current.push(setTimeout(() => {
        setOverrides(prev => { const lay={...prev[layer]}; batch.forEach(b=>lay[b.key]={shares:b.shares,reporting:100}); return {...prev,[layer]:lay}; });
        done += batch.length; setProgress(Math.round(done/shuffled.length*100));
        if (done >= shuffled.length) setRunning(false);
      }, times[bi]));
    });
  }, [geo, layer, simInputs, duration]);

  const stopSim = useCallback(() => { clearTimers(); setRunning(false); }, []);

  const btn = (active: boolean) => `h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors uppercase tracking-wide shrink-0 ${active?'bg-[#c8a020] text-white':'border border-default text-ink-3 hover:bg-hover hover:text-ink'}`;

  return (
    <div className={`h-screen flex flex-col ${dark?'dark':''}`} style={{ background: dark?'#0a1426':'#f3f1ec' }}>
      <div className="h-[52px] shrink-0 flex items-center gap-2 px-2 border-b border-default" style={{ background: dark?'#0d1b2e':'#fff' }}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2 hover:opacity-80 pl-2 shrink-0" title="Home"><GlobeLogo /></button>
        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto thin-scroll px-1">
          <div className="w-px h-4 bg-black/10 shrink-0" />
          <button onClick={()=>switchMode('results')} disabled={running} className={btn(mode==='results')}>2022 Results</button>
          <button onClick={()=>switchMode('blank')} disabled={running} className={btn(mode==='blank')}>Blank Map</button>
          <button onClick={()=>{ if(mode!=='sim') switchMode('sim'); else setPanel('sim'); }} disabled={running} className={btn(mode==='sim')}>Simulation</button>
          <div className="w-px h-4 bg-black/10 shrink-0" />
          {LAYERS.map(l=>(<button key={l.id} onClick={()=>{ setLayer(l.id); setSelected(null); setShowRef(false); if(panel==='edit')setPanel('none'); }} disabled={running} title={l.sub}
            className={`h-7 px-2.5 text-[10px] font-mono rounded-[4px] transition-colors tracking-wide shrink-0 ${layer===l.id?'bg-[#2563EB] text-white':'border border-default text-ink-3 hover:bg-hover hover:text-ink'} disabled:opacity-30`}>{l.label}</button>))}
          <div className="w-px h-4 bg-black/10 shrink-0" />
          <button onClick={()=>setBubble(b=>!b)} className={btn(bubble)}>Bubble</button>
          <button onClick={()=>setPanel('parliament')} className={btn(panel==='parliament')}>Parliament</button>
          <button onClick={()=>setPanel('breakdown')} className={btn(panel==='breakdown')}>Breakdown</button>
          <button onClick={()=>setPanel('tutorial')} className={btn(panel==='tutorial')}>Tutorial</button>
        </div>
        <button onClick={()=>setDark(d=>!d)} className="w-8 h-8 flex items-center justify-center rounded hover:bg-hover text-ink-3 shrink-0">{dark?'☀':'🌙'}</button>
      </div>

      <div className="shrink-0 border-b border-default" style={{ background: dark?'#0b1730':'#faf9f6' }}>
        <ItalyScoreboard seats={seats} pcts={pcts} dark={dark} />
      </div>

      <div className="flex-1 min-h-0 flex relative">
        {showRef && selected && <BaselineRefPanel feature={selected} layer={layer} dark={dark} onClose={()=>setShowRef(false)} />}
        <div className="flex-1 min-w-0 relative">
          <ItalyMapView layer={layer} geoData={geo[layer]} getResult={getResult} getReporting={getReporting} dark={dark} bubble={bubble} mode={mode}
            onSelect={onSelectFeature} selectedKey={selectedKey} />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] text-[9px] font-mono px-2.5 py-0.5 rounded-full pointer-events-none" style={{ background: dark?'rgba(13,27,46,0.85)':'rgba(255,255,255,0.85)', color: dark?'#9fb0cc':'#666' }}>
            {LAYERS.find(l=>l.id===layer)?.label} · {LAYERS.find(l=>l.id===layer)?.sub}
          </div>
          {mode!=='results' && (
            <div className="absolute bottom-2 left-2 z-[1000] flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: dark?'rgba(13,27,46,0.9)':'rgba(255,255,255,0.92)', border:`1px solid ${dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.08)'}` }}>
              <span className={`w-1.5 h-1.5 rounded-full ${running?'animate-pulse':''}`} style={{ background: running?'#ef4444':reportingPct>0?'#16a34a':'#9aa0a6' }} />
              <span className="text-[9px] font-mono tabular-nums" style={{ color: dark?'#cfd8ea':'#444' }}>{running?'LIVE · ':''}{reportingPct}% reporting · {reportedCount}/{totalFeatures}</span>
            </div>
          )}
        </div>
        {panel==='edit' && mode==='blank' && selected && <EditPanel feature={selected} layer={layer} existing={overrides[layer]?.[selectedKey||'']} onProject={projectFeature} onShowRef={()=>setShowRef(true)} dark={dark} onClose={()=>{setPanel('none');}} />}
        {panel==='parliament' && <ParliamentPanel seats={seats} dark={dark} onClose={()=>setPanel('none')} />}
        {panel==='breakdown' && <BreakdownPanel seats={seats} pcts={pcts} dark={dark} onClose={()=>setPanel('none')} />}
        {panel==='tutorial' && <TutorialPanel dark={dark} onClose={()=>setPanel('none')} />}
        {panel==='sim' && <SimulationPanel inputs={simInputs} setInputs={setSimInputs} duration={duration} setDuration={setDuration} running={running} onRun={runSim} onStop={stopSim} progress={progress} dark={dark} onClose={()=>setPanel('none')} />}
      </div>
    </div>
  );
}

