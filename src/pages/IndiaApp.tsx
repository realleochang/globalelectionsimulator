import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ════════════════════════════════════════════════════════════════════════════
//  INDIA — Lok Sabha (First-Past-The-Post, 543 single-member constituencies)
//  Three categories everywhere: NDA, INDIA, OTH (Independents + unaffiliated).
//  System mirrors the UK (FPTP single-member). 2024 data sourced from Wikipedia
//  "Results of the 2024 Indian general election". A seat ALWAYS goes to the real
//  winner — OTH (a catch-all of many separate candidates) can never win on
//  aggregate share alone.
// ════════════════════════════════════════════════════════════════════════════

type Cat = 'NDA' | 'INDIA' | 'OTH';
const CATS: Cat[] = ['NDA', 'INDIA', 'OTH'];
// Hemicycle order left → right: INDIA · OTH · NDA
const IN_LR_ORDER: Cat[] = ['INDIA', 'OTH', 'NDA'];

const IN_PARTIES: { id: Cat; name: string; full: string; color: string }[] = [
  { id: 'NDA',   name: 'NDA',   full: 'National Democratic Alliance', color: '#FF6B1A' },
  { id: 'INDIA', name: 'INDIA', full: 'INDIA Alliance',               color: '#1464C8' },
  { id: 'OTH',   name: 'OTH',   full: 'Others (Ind. & unaffiliated)', color: '#7A7F87' },
];
const IN_PARTY_MAP = Object.fromEntries(IN_PARTIES.map(p => [p.id, p])) as Record<Cat, typeof IN_PARTIES[number]>;
const IN_MAJORITY = 272;
const IN_TOTAL = 543;

const IN_LEADER: Record<Cat, { last: string; wiki?: string; initials?: string }> = {
  NDA:   { last: 'Modi',   wiki: 'Narendra_Modi' },
  INDIA: { last: 'Gandhi', wiki: 'Rahul_Gandhi' },
  OTH:   { last: 'Others', initials: 'OTH' },
};
// 2026 polling headline (vote %) → calibrated seat projection 352 / 182 / 9.
const IN_NAT_2026: Record<Cat, number> = { NDA: 47, INDIA: 39, OTH: 14 };

function catColor(c: Cat): string { return IN_PARTY_MAP[c]?.color ?? '#888'; }

// ── Data types ──────────────────────────────────────────────────────────────
type Shares = Record<Cat, number>;
interface PcResult {
  state: string; no: number; pc_name: string;
  win: Cat; runner: Cat; winPct: number; runnerPct: number; marginPct: number;
  margin: number | null; totalVotes: number; shares: Shares;
}
interface ResultsPayload { nat2024: Shares; seats2024: Record<Cat, number>; results: Record<string, PcResult>; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function fmtN(n: number): string {
  if (n >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}
function seatFill(win: Cat, marginPct: number, dark: boolean): string {
  const c = hsl(catColor(win));
  c.l = dark ? 0.55 - Math.min(marginPct / 30, 1) * 0.28 : 0.80 - Math.min(marginPct / 30, 1) * 0.42;
  return c.formatHex();
}
// Two-contender uniform swing: a seat flips between its real win/runner contenders.
function seatOutcome(r: PcResult, swing: Shares): { winner: Cat; relMargin: number } {
  const rel = r.marginPct + ((swing[r.win] ?? 0) - (swing[r.runner] ?? 0));
  return rel >= 0 ? { winner: r.win, relMargin: rel } : { winner: r.runner, relMargin: -rel };
}
// Apply a swing (delta) to baseline shares and renormalise to 100 — for display.
function swungShares(base: Shares, swing: Shares): Shares {
  const o = {} as Shares; let s = 0;
  for (const c of CATS) { o[c] = Math.max(0, (base[c] ?? 0) + (swing[c] ?? 0)); s += o[c]; }
  if (s > 0) for (const c of CATS) o[c] = o[c] / s * 100;
  return o;
}
const swingMag = (a: Shares, b: Shares) => Math.abs(a.NDA - b.NDA) + Math.abs(a.INDIA - b.INDIA) + Math.abs(a.OTH - b.OTH);
// 2026 calibrated flip set: 52 most-marginal INDIA + 7 most-marginal OTH → NDA.
function compute2026Flips(results: Record<string, PcResult>): Set<string> {
  const ent = Object.entries(results);
  const ind = ent.filter(([, r]) => r.win === 'INDIA').sort((a, b) => a[1].marginPct - b[1].marginPct).slice(0, 52);
  const oth = ent.filter(([, r]) => r.win === 'OTH').sort((a, b) => a[1].marginPct - b[1].marginPct).slice(0, 7);
  return new Set([...ind, ...oth].map(([k]) => k));
}
// Three-way slider redistribution (keeps total at 100, respects locks).
function redistribute(cur: Shares, changed: Cat, val: number, locks: Set<Cat>): Shares {
  const lockedSum = CATS.filter(c => locks.has(c) && c !== changed).reduce((s, c) => s + cur[c], 0);
  const clamped = Math.min(Math.max(val, 0), 100 - lockedSum);
  const others = CATS.filter(c => !locks.has(c) && c !== changed);
  const remaining = 100 - lockedSum - clamped;
  const next: Shares = { ...cur, [changed]: clamped };
  const oSum = others.reduce((s, c) => s + cur[c], 0);
  if (oSum > 0) for (const c of others) next[c] = cur[c] / oSum * remaining;
  else for (const c of others) next[c] = remaining / others.length;
  return next;
}
function winnerOfShares(sh: Shares): Cat {
  let best: Cat = 'OTH', bv = -1; for (const c of CATS) if (sh[c] > bv) { bv = sh[c]; best = c; } return best;
}
// Bell-curve reveal times for the live count.
function randNormal() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function bellTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () => Math.max(0.02, Math.min(0.98, 0.5 + randNormal() * 0.2))).sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

// ════════════════════════════════════════════════════════════════════════════
//  Avatar
// ════════════════════════════════════════════════════════════════════════════
function Avatar({ cat }: { cat: Cat }) {
  const info = IN_LEADER[cat];
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!info.wiki) { setUrl(null); return; }
    let c = false; fetchWikiPhoto(info.wiki).then(u => { if (!c) setUrl(u); }); return () => { c = true; };
  }, [info.wiki]);
  return (
    <div className="cand-circle-frame">
      {url ? <img src={url} alt={info.last} onError={() => setUrl(null)} /> : <span className="cand-initials">{info.initials ?? info.last.slice(0, 2)}</span>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Scoreboard
// ════════════════════════════════════════════════════════════════════════════
function InScoreboard({ seats, natPct, natVotes, declaredTotal }: { seats: Record<Cat, number>; natPct: Shares; natVotes: Shares; declaredTotal?: number }) {
  const leader = useMemo(() => { let b: Cat = 'NDA', bv = -1; for (const c of CATS) if (seats[c] > bv) { bv = seats[c]; b = c; } return b; }, [seats]);
  const hasMaj = seats[leader] >= IN_MAJORITY;
  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div className="flex gap-2 px-3 py-2 mx-auto w-fit items-stretch">
        {[...IN_LR_ORDER].sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0)).map(c => {
          const p = IN_PARTY_MAP[c]; const s = seats[c] ?? 0; const color = p.color;
          const isLeader = c === leader; const win = isLeader && hasMaj;
          return (
            <div key={c} className={`cand-col${isLeader && !win ? ' is-leader' : ''}${win ? ' is-winner' : ''}`}
              style={{ '--cand-color': color, '--cand-color-alpha': hexToRgba(color, 0.13), borderColor: isLeader ? color : hexToRgba(color, 0.3) } as React.CSSProperties}>
              <div style={{ position: 'relative' }}>
                <Avatar cat={c} />
                {win && <span className="called-tick"><svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="8.5" fill={color} /><path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
              </div>
              <span className="cand-leader-name" title={IN_LEADER[c].last}>{IN_LEADER[c].last}</span>
              <span className="cand-party-abbrev">{p.name}</span>
              <span className="cand-seats">{s}</span>
              <span className="cand-party-name" title={p.full}>{p.full.replace(/\s*\([^)]*\)/, '')}</span>
              <div style={{ width: '100%', textAlign: 'center' }}>
                <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color }}>{(natPct[c] ?? 0).toFixed(1)}%</span>
              </div>
              <div style={{ width: '100%', textAlign: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 8, fontFamily: '"JetBrains Mono",monospace', color: hexToRgba(color, 0.7) }}>{Math.round(natVotes[c] ?? 0).toLocaleString('en-US')}</span>
              </div>
              <div className="cand-bar-track" style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--bar-track)' }}>
                <div className="cand-bar-fill" style={{ height: '100%', borderRadius: 2, background: color, width: `${Math.min((natPct[c] ?? 0) / 50 * 100, 100)}%`, transition: 'width 0.3s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
      {declaredTotal != null && declaredTotal < IN_TOTAL && (
        <div className="text-center pb-1 text-[8.5px] font-mono text-ink-3 uppercase tracking-[0.15em]">{declaredTotal} / {IN_TOTAL} declared</div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Map controller + bubble layer
// ════════════════════════════════════════════════════════════════════════════
function MapController() {
  const map = useMap();
  useEffect(() => { const ro = new ResizeObserver(() => map.invalidateSize()); ro.observe(map.getContainer()); return () => ro.disconnect(); }, [map]);
  return null;
}
function zoomScale(z: number) { return Math.max(0.2, Math.min(2.4, (z - 4) / (8 - 4) + 0.3)); }

function InBubbleLayer({ geoData, winners, rawMargin, declared, onSelect, onHover, onLeave }: {
  geoData: any; winners: Record<string, Cat>; rawMargin: Record<string, number>;
  declared?: Set<string>; onSelect: (k: string) => void;
  onHover: (key: string, name: string, state: string, clientX: number, clientY: number) => void; onLeave: () => void;
}) {
  const map = useMap();
  const markersRef = useRef<{ m: L.CircleMarker; base: number }[]>([]);
  const hoverRef = useRef({ onHover, onLeave }); hoverRef.current = { onHover, onLeave };
  useEffect(() => {
    const onZoom = () => { const s = zoomScale(map.getZoom()); for (const { m, base } of markersRef.current) m.setRadius(base * s); };
    map.on('zoomend', onZoom); return () => { map.off('zoomend', onZoom); };
  }, [map]);
  useEffect(() => {
    for (const { m } of markersRef.current) m.remove(); markersRef.current = [];
    const s = zoomScale(map.getZoom());
    L.geoJSON(geoData).eachLayer((layer: any) => {
      const key = layer.feature?.properties?.key; if (!key) return;
      if (declared && !declared.has(key)) return;
      const win = winners[key]; if (!win) return;
      const bounds = layer.getBounds?.(); if (!bounds?.isValid()) return;
      const p = layer.feature.properties;
      const base = 3 + 0.05 * Math.sqrt(Math.max(0, rawMargin[key] ?? 0));
      const color = catColor(win);
      const m = L.circleMarker(bounds.getCenter(), { radius: Math.min(26, base) * s, color, fillColor: color, fillOpacity: 0.7, weight: 1, opacity: 0.9 }).addTo(map);
      m.on('click', () => onSelect(key));
      m.on('mousemove', (e: L.LeafletMouseEvent) => hoverRef.current.onHover(key, p.pc_name, p.st_name, e.originalEvent.clientX, e.originalEvent.clientY));
      m.on('mouseout', () => hoverRef.current.onLeave());
      markersRef.current.push({ m, base: Math.min(26, base) });
    });
    return () => { for (const { m } of markersRef.current) m.remove(); markersRef.current = []; };
  }, [map, geoData, winners, rawMargin, declared]);
  return null;
}

// ── Tooltip state ──────────────────────────────────────────────────────────
type Tip = { x: number; y: number; name: string; state: string; win: Cat | null; shares: Shares; raw: Record<Cat, number>; reporting?: number } | null;

// ════════════════════════════════════════════════════════════════════════════
//  Map view
// ════════════════════════════════════════════════════════════════════════════
function InMapView({ geoData, winners, marginByKey, sharesByKey, rawByKey, rawMargin, baseResults, selected, onSelect, dark, bubble, blankMode, projected, declared }: {
  geoData: GeoJSON.FeatureCollection | null;
  winners: Record<string, Cat>; marginByKey: Record<string, number>;
  sharesByKey: Record<string, Shares>; rawByKey: Record<string, Record<Cat, number>>;
  rawMargin: Record<string, number>; baseResults: Record<string, PcResult>;
  selected: string | null; onSelect: (k: string | null) => void; dark: boolean;
  bubble: boolean; blankMode: boolean; projected?: Set<string>; declared?: Set<string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const refs = useRef({ winners, sharesByKey, rawByKey, baseResults, blankMode, projected, declared });
  refs.current = { winners, sharesByKey, rawByKey, baseResults, blankMode, projected, declared };
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const key = feature?.properties?.key ?? ''; const isSel = key === selected;
    const border = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.28)';
    if (bubble) return { fillOpacity: 0, weight: 0.4, color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)', opacity: 0.6 };
    const declaredOk = !declared || declared.has(key);
    const projectedOk = !blankMode || (projected?.has(key) ?? false);
    const win = winners[key];
    if (!win || !declaredOk || !projectedOk) return { fillColor: dark ? '#1f2937' : '#d8dde6', fillOpacity: 0.62, weight: isSel ? 2 : 0.3, color: isSel ? '#c8a020' : border, opacity: 1 };
    return { fillColor: seatFill(win, marginByKey[key] ?? 0, dark), fillOpacity: 0.84, weight: isSel ? 2 : 0.3, color: isSel ? '#c8a020' : border, opacity: 1 };
  }, [winners, marginByKey, selected, dark, bubble, blankMode, projected, declared]);

  useEffect(() => { layerRef.current?.setStyle((f: any) => getStyle(f)); }, [getStyle]);

  // Shared tooltip builder — used by both the choropleth and the bubble overlay.
  const showTip = useCallback((key: string, name: string, state: string, clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
    const R = refs.current;
    const declaredOk = !R.declared || R.declared.has(key);
    const projectedOk = !R.blankMode || (R.projected?.has(key) ?? false);
    const sh = R.sharesByKey[key]; if (!sh || !declaredOk || !projectedOk) { setTip(null); return; }
    setTip({ x: clientX - rect.left, y: clientY - rect.top, name, state, win: R.winners[key] ?? null, shares: sh, raw: R.rawByKey[key] ?? { NDA: 0, INDIA: 0, OTH: 0 }, reporting: R.declared ? 100 : undefined });
  }, []);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const key = feature?.properties?.key ?? ''; const p = feature.properties;
    layer.on('click', () => onSelectRef.current(key));
    layer.on('mousemove', (e: L.LeafletMouseEvent) => showTip(key, p.pc_name, p.st_name, e.originalEvent.clientX, e.originalEvent.clientY));
    layer.on('mouseout', () => setTip(null));
  }, [showTip]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[22.6, 80]} zoom={5} style={{ width: '100%', height: '100%' }} zoomControl worldCopyJump={false}>
        <TileLayer key={dark ? 'd' : 'l'} url={dark ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'} attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" updateWhenIdle maxZoom={18} />
        <MapController />
        {geoData && <GeoJSON ref={layerRef as any} data={geoData} style={(f: any) => getStyle(f)} onEachFeature={onEachFeature} {...({ smoothFactor: 0.6 } as any)} />}
        {geoData && bubble && <InBubbleLayer geoData={geoData} winners={winners} rawMargin={rawMargin} declared={declared} onSelect={k => onSelect(k)} onHover={showTip} onLeave={() => setTip(null)} />}
      </MapContainer>
      {tip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999; const TW = 232;
        const left = tip.x + 16 + TW > cw ? tip.x - TW - 8 : tip.x + 16;
        const tt = { bg: dark ? 'rgba(18,24,44,0.97)' : 'rgba(255,255,255,0.98)', border: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)', title: dark ? '#fff' : '#111', sub: dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)', body: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)' };
        const sorted = CATS.map(c => [c, tip.shares[c] ?? 0] as [Cat, number]).sort((a, b) => b[1] - a[1]);
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tip.y - 20), width: TW }}>
            <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: '0 6px 28px rgba(0,0,0,0.25)', backdropFilter: 'blur(12px)', padding: '11px 13px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: tt.title }}>{tip.name}</div>
              <div style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 2, textTransform: 'capitalize' }}>{tip.state.toLowerCase()}{tip.reporting != null ? ` · ${tip.reporting}% in` : ''}</div>
              {/* proportional vote-share bar */}
              <div style={{ marginTop: 9, display: 'flex', width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                {sorted.map(([c, v]) => v > 0 ? <div key={c} title={`${IN_PARTY_MAP[c].name} ${v.toFixed(1)}%`} style={{ width: `${v}%`, background: catColor(c) }} /> : null)}
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {sorted.map(([c, v]) => (
                  <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: catColor(c) }} />
                    <span style={{ flex: 1, fontSize: 11, fontWeight: c === tip.win ? 700 : 400, color: tt.body }}>{IN_PARTY_MAP[c].name}</span>
                    <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.sub }}>{Math.round(tip.raw[c] ?? 0).toLocaleString('en-US')}</span>
                    <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: catColor(c), minWidth: 42, textAlign: 'right' }}>{v.toFixed(1)}%</span>
                    {c === tip.win && <span style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: catColor(c) }}>WON</span>}
                  </div>
                ))}
              </div>
              {tip.win && sorted[0][0] !== tip.win && sorted[0][0] === 'OTH' && (
                <div style={{ marginTop: 7, paddingTop: 6, borderTop: `1px solid ${tt.border}`, fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, lineHeight: 1.35 }}>
                  OTH {sorted[0][1].toFixed(1)}% is split across many candidates — seat goes to {IN_PARTY_MAP[tip.win].name}.
                </div>
              )}
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click a seat</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Constituency panel (Blank Map): set shares + % reporting + project + 2024 ref
// ════════════════════════════════════════════════════════════════════════════
function InConstPanel({ pcKey, base, current, override, reporting, projected, blankMode, onOverride, onReporting, onProject, onReset, onClose, dark }: {
  pcKey: string; base: PcResult; current: Shares; override?: Shares; reporting: number; projected: boolean; blankMode: boolean;
  onOverride: (s: Shares) => void; onReporting: (n: number) => void; onProject: () => void; onReset: () => void; onClose: () => void; dark?: boolean;
}) {
  const [draft, setDraft] = useState<Shares>(() => override ?? { ...current });
  const [locks, setLocks] = useState<Set<Cat>>(new Set());
  const [touched, setTouched] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const [localRpt, setLocalRpt] = useState(reporting);
  useEffect(() => { setDraft(override ?? { ...current }); setTouched(false); setLocalRpt(reporting); }, [pcKey]); // eslint-disable-line
  const sliderTrack = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const total = base.totalVotes;
  const winNow = winnerOfShares(draft);

  const setVal = (c: Cat, v: number) => { const n = redistribute(draft, c, v, locks); setDraft(n); setTouched(true); onOverride(n); };

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">{base.pc_name}</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-1 uppercase tracking-wide">{base.state.toLowerCase()} · 1 seat</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-2.5 pb-1 border-b border-default shrink-0">
        <button onClick={() => setShowRef(v => !v)} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
          {showRef ? 'Hide' : 'Show'} 2024 Result
        </button>
        {showRef && (
          <div className="mt-2 mb-1 rounded-[5px] border border-default p-2 space-y-1">
            <div className="text-[8px] font-mono uppercase tracking-[0.14em] text-ink-3">2024 actual</div>
            {CATS.map(c => [c, base.shares[c]] as [Cat, number]).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
              <div key={c} className="flex items-center gap-1.5 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor(c) }} />
                <span className="flex-1 text-ink">{IN_PARTY_MAP[c].name}{c === base.win ? ' ✓' : ''}</span>
                <span className="font-mono text-ink-2">{v.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* % reporting slider on top (blank-map only) */}
      {blankMode && (
        <div className="px-3.5 pt-3 pb-1 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-mono font-bold uppercase tracking-[0.12em] text-ink-3">% Reporting</span>
            <span className="text-[11px] font-mono font-bold" style={{ color: localRpt < 50 ? '#ef4444' : localRpt < 100 ? '#f59e0b' : '#16a34a' }}>{localRpt}%</span>
          </div>
          <div style={{ position: 'relative', height: 16, display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 4, background: sliderTrack }} />
            <input type="range" min={1} max={100} step={1} value={localRpt}
              onChange={e => { setLocalRpt(+e.target.value); onReporting(+e.target.value); setTouched(true); }}
              className="br-party-slider w-full" style={{ '--party-color': localRpt < 50 ? '#ef4444' : localRpt < 100 ? '#f59e0b' : '#16a34a', '--pct': `${localRpt}%` } as React.CSSProperties} />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
        {CATS.map(c => {
          const pct = draft[c] ?? 0; const color = catColor(c); const isLocked = locks.has(c);
          const raw = Math.round(pct / 100 * total * (blankMode ? localRpt / 100 : 1));
          return (
            <div key={c}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] font-medium text-ink flex-1 leading-none">{IN_PARTY_MAP[c].full}</span>
                <button onClick={() => setLocks(p => { const n = new Set(p); n.has(c) ? n.delete(c) : n.add(c); return n; })} className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>{isLocked ? '🔒' : '🔓'}</button>
                <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>{pct.toFixed(1)}%</span>
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked} onChange={e => setVal(c, parseFloat(e.target.value))} className="br-party-slider w-full" style={{ '--party-color': color, '--pct': `${pct}%` } as React.CSSProperties} />
              <div className="text-[8px] font-mono mt-0.5" style={{ color: dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)' }}>{raw.toLocaleString()} votes{c === winNow ? ' · leads' : ''}</div>
            </div>
          );
        })}
      </div>
      <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
        {blankMode ? (
          <>
            <button onClick={onProject} disabled={!touched && !projected}
              className={`w-full h-8 rounded-[4px] text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors ${!touched && !projected ? 'border border-default text-ink-3 opacity-50 cursor-not-allowed' : projected ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
              {!touched && !projected ? 'Adjust a slider first' : projected ? '↻ Update Projection' : '📍 Project Result'}
            </button>
            {projected && <button onClick={onReset} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover">Clear projection</button>}
          </>
        ) : (
          <>
            <div className="text-[8.5px] font-mono text-ink-3 text-center">Edits apply live to this seat.</div>
            <button onClick={onReset} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover">Reset to {IN_PARTY_MAP[base.win].name} result</button>
          </>
        )}
      </div>
    </aside>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Parliament (Parliamentary Composition) — 543-seat semicircle
// ════════════════════════════════════════════════════════════════════════════
function InParliamentPanel({ seats, onClose, exiting, dark }: { seats: Record<Cat, number>; onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const total = CATS.reduce((s, c) => s + (seats[c] ?? 0), 0);
  const lead: Cat = CATS.reduce((b, c) => (seats[c] ?? 0) > (seats[b] ?? 0) ? c : b, 'NDA');
  const leadN = seats[lead] ?? 0;
  const flat: Cat[] = []; for (const c of IN_LR_ORDER) for (let i = 0; i < (seats[c] ?? 0); i++) flat.push(c);
  const ROWS = 13, innerR = 78, outerR = 210, CX = 230, CY = 232;
  const rowR = Array.from({ length: ROWS }, (_, i) => innerR + (outerR - innerR) * (i / (ROWS - 1)));
  const arc = rowR.reduce((s, r) => s + r * Math.PI, 0);
  const perRow = rowR.map(r => Math.max(1, Math.round(r * Math.PI / arc * total)));
  let diff = total - perRow.reduce((s, n) => s + n, 0), idx = perRow.length - 1;
  while (diff !== 0) { perRow[idx] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1; idx = (idx - 1 + perRow.length) % perRow.length; }
  const slots: { x: number; y: number; a: number; r: number }[] = [];
  for (let row = 0; row < ROWS; row++) { const r = rowR[row], n = perRow[row]; for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); const a = Math.PI - t * Math.PI; slots.push({ x: CX + Math.cos(a) * r, y: CY - Math.sin(a) * r, a, r }); } }
  slots.sort((p, q) => (q.a - p.a) || (p.r - q.r));
  const dots = slots.map((s, k) => ({ x: s.x, y: s.y, color: catColor(flat[k] ?? IN_LR_ORDER[IN_LR_ORDER.length - 1]) }));
  const sub = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
  return (
    <aside className={`w-[380px] shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h1 className="text-[14px] font-bold text-ink leading-none">Parliamentary Composition</h1><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Lok Sabha · {total} of 543 · Majority {IN_MAJORITY}</p></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3 pt-3 pb-2 shrink-0">
        <svg viewBox="18 6 424 236" width="100%" height="auto" style={{ display: 'block' }}>
          {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={4.6} fill={d.color} stroke={dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.85)'} strokeWidth="0.5" />)}
          <line x1={CX} y1="14" x2={CX} y2="54" stroke={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'} strokeWidth="1" strokeDasharray="3 3" />
          <text x={CX} y="10" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono, monospace" fill={sub}>272</text>
          {/* central tally fills the empty middle of the hemicycle */}
          <text x={CX} y={CY - 36} textAnchor="middle" fontSize="40" fontWeight="800" fontFamily="Barlow Condensed, sans-serif" fill={catColor(lead)}>{leadN}</text>
          <text x={CX} y={CY - 18} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill={catColor(lead)}>{IN_PARTY_MAP[lead].name}</text>
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize="8.5" fontFamily="JetBrains Mono, monospace" fill={sub}>{leadN >= IN_MAJORITY ? `MAJORITY +${leadN - IN_MAJORITY}` : `${IN_MAJORITY - leadN} short`}</text>
        </svg>
      </div>
      <div className="px-3.5 pb-3.5 grid grid-cols-3 gap-2">
        {[...IN_LR_ORDER].sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0)).map(c => (
          <div key={c} className="flex items-center gap-2 px-2 py-1.5 rounded-[4px] border border-default">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: catColor(c) }} />
            <span className="text-[11px] font-semibold text-ink">{IN_PARTY_MAP[c].name}</span>
            <span className="ml-auto text-[11px] font-mono text-ink-2">{seats[c] ?? 0}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Breakdown panel
// ════════════════════════════════════════════════════════════════════════════
function InBreakdownPanel({ seats, natPct, data, winners, onClose, exiting, dark }: {
  seats: Record<Cat, number>; natPct: Shares; data: ResultsPayload; winners: Record<string, Cat>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const ink3 = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.32)'; const cardBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const total = CATS.reduce((s, c) => s + seats[c], 0);
  const leader: Cat = CATS.reduce((b, c) => seats[c] > seats[b] ? c : b, 'NDA');
  // seats changed vs 2024
  let changed = 0; for (const [k, r] of Object.entries(data.results)) if (winners[k] && winners[k] !== r.win) changed++;
  // closest current seats (smallest margin among declared)
  const enp = total > 0 ? 1 / CATS.reduce((s, c) => { const sh = seats[c] / total; return s + sh * sh; }, 0) : 0;
  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="flex items-baseline justify-between gap-2" style={{ background: cardBg, borderRadius: 5, padding: '5px 8px' }}>
      <span className="text-[9.5px] font-mono text-ink-3 flex-1">{label}</span>
      <div className="text-right"><span className="text-[11px] font-mono font-bold text-ink">{value}</span>{sub && <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{sub}</div>}</div>
    </div>
  );
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h2 className="text-[13px] font-bold text-ink leading-none">Breakdown</h2><div className="text-[9px] font-mono text-ink-3 mt-0.5">Lok Sabha — nerd stats</div></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
        <div>
          <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{ color: ink3 }}>Seats & Vote Share</div>
          <div className="space-y-1.5">
            {[...IN_LR_ORDER].sort((a, b) => seats[b] - seats[a]).map(c => {
              const p = IN_PARTY_MAP[c]; const sSwing = seats[c] - data.seats2024[c]; const vSwing = (natPct[c] ?? 0) - data.nat2024[c];
              return (
                <div key={c} style={{ background: cardBg, borderRadius: 5, padding: '6px 8px', borderLeft: `3px solid ${p.color}` }}>
                  <div className="flex items-center justify-between">
                    <div><div className="text-[10px] font-bold text-ink">{p.name}</div><div className="text-[8px] font-mono" style={{ color: ink3 }}>{(natPct[c] ?? 0).toFixed(1)}% vote</div></div>
                    <div className="text-right"><span className="text-[18px] font-black font-mono" style={{ color: p.color }}>{seats[c]}</span>
                      <div className="text-[7.5px] font-mono" style={{ color: sSwing > 0 ? '#16a34a' : sSwing < 0 ? '#ef4444' : ink3 }}>{sSwing >= 0 ? '+' : ''}{sSwing} vs 2024</div></div>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                    <div style={{ width: `${seats[c] / IN_TOTAL * 100}%`, height: '100%', borderRadius: 4, background: p.color }} />
                  </div>
                  <div className="text-[7.5px] font-mono mt-1" style={{ color: vSwing >= 0 ? '#16a34a' : '#ef4444' }}>{vSwing >= 0 ? '+' : ''}{vSwing.toFixed(1)}pp vote swing</div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{ color: ink3 }}>Electoral Statistics</div>
          <div className="space-y-1.5">
            <Stat label="Largest alliance" value={`${IN_PARTY_MAP[leader].name} — ${seats[leader]}`} sub={seats[leader] >= IN_MAJORITY ? `✓ majority (+${seats[leader] - IN_MAJORITY})` : `${IN_MAJORITY - seats[leader]} short`} />
            <Stat label="Effective No. of Parties" value={enp.toFixed(2)} sub="1/Σsᵢ² — fragmentation" />
            <Stat label="Seats changed vs 2024" value={String(changed)} sub="flips from the actual result" />
            <Stat label="System" value="FPTP" sub="single-member · 543 seats" />
            <Stat label="Total seats" value={`${total} / ${IN_TOTAL}`} />
          </div>
        </div>
      </div>
    </aside>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Tutorial
// ════════════════════════════════════════════════════════════════════════════
function InTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H = ({ c }: { c: string }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P = ({ c }: { c: string }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <h2 className="text-[13px] font-bold text-ink leading-none">How it works</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-4 py-4">
        <H c="The system" /><P c="India elects 543 MPs to the Lok Sabha by first-past-the-post: one seat per constituency, won by whoever finishes first. Majority is 272." />
        <H c="Three categories" /><P c="Every seat is coloured NDA, INDIA, or OTH. OTH bundles independents and unaffiliated parties — so its combined share can be highest in a seat that a major alliance actually won. The seat always goes to the real winner." />
        <H c="2024 Result · 2026 Polling" /><P c="Switch between the actual 2024 result (NDA 293 · INDIA 234 · OTH 16) and a 2026 polling projection (NDA 352 · INDIA 182 · OTH 9 at 47/39/14)." />
        <H c="Blank Map" /><P c="Call seats yourself: click a constituency, set the three shares and a % reporting, then Project. Open '2024 Result' for a reference." />
        <H c="Simulation" /><P c="Watch an election night unfold — pick a length, hit Run, and constituencies declare in timed batches with a live count." />
        <H c="Bubble Map" /><P c="Each seat becomes a bubble sized by its raw vote margin (winner minus runner-up). Hover any bubble for the district's result." />
        <H c="Analysis" /><P c="Open Analysis for a state-by-state breakdown — seats, raw votes and vote share per alliance for every state/UT, plus national totals and fun highlights." />
        <H c="Parliament" /><P c="A 543-seat semicircle sorted left→right by ideology: INDIA · OTH · NDA, with the 272 majority line." />
      </div>
    </aside>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Reporting widget (live count, red flashing dot)
// ════════════════════════════════════════════════════════════════════════════
function InReportingWidget({ declared, live, dark }: { declared: number; live: boolean; dark?: boolean }) {
  const bg = dark ? 'rgba(7,13,28,0.9)' : 'rgba(255,255,255,0.94)'; const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)'; const ink2 = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';
  const pct = declared / IN_TOTAL * 100;
  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none" style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, backdropFilter: 'blur(10px)', padding: '10px 13px', minWidth: 180, boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}>
      <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{ color: live ? '#ef4444' : ink2 }}>
        {live ? (<><span className="relative flex h-2 w-2 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#ef4444' }} /><span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: '#ef4444' }} /></span><span>Live Count</span></>) : <span>📊 Results</span>}
      </div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">{declared} <span className="text-[10px] font-semibold" style={{ color: ink2 }}>/ {IN_TOTAL}</span></div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{ color: ink2 }}>seats declared</div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: live ? '#3b82f6' : '#16a34a' }} /></div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{ color: live ? '#3b82f6' : '#16a34a' }}>{pct.toFixed(0)}% counted</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Analysis — fun stats by state/region
// ════════════════════════════════════════════════════════════════════════════
interface StateAgg { name: string; seats: Record<Cat, number>; votes: Record<Cat, number>; total: number; n: number; seatTotal: number; lead: Cat; share: Record<Cat, number>; }
function InAnalysisPanel({ winners, rawByKey, data, onClose, exiting, dark }: {
  winners: Record<string, Cat>; rawByKey: Record<string, Record<Cat, number>>; data: ResultsPayload;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const ink3 = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.32)'; const cardBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const { states, natVotes, natTotal } = useMemo(() => {
    const by: Record<string, StateAgg> = {};
    const natVotes: Record<Cat, number> = { NDA: 0, INDIA: 0, OTH: 0 }; let natTotal = 0;
    for (const [key, r] of Object.entries(data.results)) {
      const w = winners[key]; const raw = rawByKey[key] ?? { NDA: 0, INDIA: 0, OTH: 0 };
      const s = by[r.state] ?? (by[r.state] = { name: r.state, seats: { NDA: 0, INDIA: 0, OTH: 0 }, votes: { NDA: 0, INDIA: 0, OTH: 0 }, total: 0, n: 0, seatTotal: 0, lead: 'NDA', share: { NDA: 0, INDIA: 0, OTH: 0 } });
      if (w) { s.seats[w]++; s.seatTotal++; }
      for (const c of CATS) { s.votes[c] += raw[c]; natVotes[c] += raw[c]; }
      const t = raw.NDA + raw.INDIA + raw.OTH; s.total += t; natTotal += t; s.n++;
    }
    const states = Object.values(by).map(s => {
      s.lead = CATS.reduce((b, c) => s.seats[c] > s.seats[b] ? c : b, 'NDA');
      s.share = { NDA: s.total ? s.votes.NDA / s.total * 100 : 0, INDIA: s.total ? s.votes.INDIA / s.total * 100 : 0, OTH: s.total ? s.votes.OTH / s.total * 100 : 0 };
      return s;
    }).sort((a, b) => b.seatTotal - a.seatTotal || b.total - a.total);
    return { states, natVotes, natTotal };
  }, [winners, rawByKey, data]);

  const natShare = (c: Cat) => natTotal ? natVotes[c] / natTotal * 100 : 0;
  const biggest = states[0];
  const mostOTH = [...states].sort((a, b) => b.share.OTH - a.share.OTH)[0];
  const cap = (s: string) => s.toLowerCase().replace(/\b\w/g, m => m.toUpperCase());

  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h2 className="text-[13px] font-bold text-ink leading-none">Analysis</h2><div className="text-[9px] font-mono text-ink-3 mt-0.5">Votes & seats by region</div></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
        {/* National */}
        <div>
          <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{ color: ink3 }}>National · {fmtN(natTotal)} votes</div>
          <div className="space-y-1.5">
            {[...CATS].sort((a, b) => natShare(b) - natShare(a)).map(c => (
              <div key={c} style={{ background: cardBg, borderRadius: 5, padding: '5px 8px' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor(c) }} />
                  <span className="text-[10px] font-bold text-ink flex-1">{IN_PARTY_MAP[c].name}</span>
                  <span className="text-[10px] font-mono font-bold" style={{ color: catColor(c) }}>{natShare(c).toFixed(1)}%</span>
                  <span className="text-[8.5px] font-mono text-ink-3 w-14 text-right">{fmtN(natVotes[c])}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}><div style={{ width: `${natShare(c)}%`, height: '100%', background: catColor(c) }} /></div>
              </div>
            ))}
          </div>
        </div>
        {/* Fun highlights */}
        <div>
          <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{ color: ink3 }}>Highlights</div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2" style={{ background: cardBg, borderRadius: 5, padding: '5px 8px' }}>
              <span className="text-[9.5px] font-mono text-ink-3 flex-1">Biggest prize</span>
              <div className="text-right"><span className="text-[11px] font-mono font-bold text-ink">{cap(biggest?.name ?? '')}</span><div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{biggest?.seatTotal} seats · {IN_PARTY_MAP[biggest?.lead ?? 'NDA'].name} led</div></div>
            </div>
            <div className="flex items-baseline justify-between gap-2" style={{ background: cardBg, borderRadius: 5, padding: '5px 8px' }}>
              <span className="text-[9.5px] font-mono text-ink-3 flex-1">Strongest OTH region</span>
              <div className="text-right"><span className="text-[11px] font-mono font-bold text-ink">{cap(mostOTH?.name ?? '')}</span><div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{mostOTH?.share.OTH.toFixed(1)}% OTH vote</div></div>
            </div>
            <div className="flex items-baseline justify-between gap-2" style={{ background: cardBg, borderRadius: 5, padding: '5px 8px' }}>
              <span className="text-[9.5px] font-mono text-ink-3 flex-1">States / UTs</span>
              <span className="text-[11px] font-mono font-bold text-ink">{states.length}</span>
            </div>
          </div>
        </div>
        {/* By state */}
        <div>
          <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{ color: ink3 }}>By State / UT</div>
          <div className="space-y-1.5">
            {states.map(s => (
              <div key={s.name} style={{ background: cardBg, borderRadius: 5, padding: '6px 8px', borderLeft: `3px solid ${catColor(s.lead)}` }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10.5px] font-semibold text-ink truncate">{cap(s.name)}</span>
                  <span className="text-[8.5px] font-mono shrink-0 ml-2" style={{ color: ink3 }}>{s.seatTotal} {s.seatTotal === 1 ? 'seat' : 'seats'}</span>
                </div>
                <div className="flex w-full h-2 rounded-full overflow-hidden mb-1" style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                  {IN_LR_ORDER.map(c => s.seats[c] > 0 ? <div key={c} title={`${IN_PARTY_MAP[c].name} ${s.seats[c]}`} style={{ width: `${s.seats[c] / s.seatTotal * 100}%`, background: catColor(c) }} /> : null)}
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {[...IN_LR_ORDER].sort((a, b) => s.seats[b] - s.seats[a]).filter(c => s.seats[c] > 0 || s.share[c] >= 1).map(c => (
                    <span key={c} className="inline-flex items-center gap-0.5 text-[8.5px] font-mono" style={{ color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor(c) }} />{IN_PARTY_MAP[c].name}<b className="text-ink">{s.seats[c]}</b>·{s.share[c].toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  National vote-share sliders (Swing + Simulation) — type or drag, auto-balanced to 100
// ════════════════════════════════════════════════════════════════════════════
function NatSliders({ target, onChange, dark }: { target: Shares; onChange: (s: Shares) => void; dark?: boolean }) {
  return (
    <div className="space-y-3.5">
      {CATS.map(c => (
        <div key={c}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-ink flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: catColor(c) }} />{IN_PARTY_MAP[c].name}</span>
            <div className="flex items-center gap-1">
              <input type="number" min={0} max={100} step={0.1} value={+(target[c] ?? 0).toFixed(1)}
                onChange={e => { const v = parseFloat(e.target.value); onChange(redistribute(target, c, Number.isFinite(v) ? v : 0, new Set())); }}
                className={`w-14 h-6 px-1 text-right text-[11px] font-mono font-bold rounded-[4px] border outline-none focus:border-blue-500 ${dark ? 'bg-[#0a1626] border-white/15' : 'bg-white border-black/15'}`} style={{ color: catColor(c) }} />
              <span className="text-[10px] font-mono text-ink-3">%</span>
            </div>
          </div>
          <input type="range" min={0} max={70} step={0.5} value={Math.min(target[c] ?? 0, 70)} onChange={e => onChange(redistribute(target, c, parseFloat(e.target.value), new Set()))}
            className="br-party-slider w-full" style={{ '--party-color': catColor(c), '--pct': `${(target[c] ?? 0) / 70 * 100}%` } as React.CSSProperties} />
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Main app
// ════════════════════════════════════════════════════════════════════════════
export default function IndiaApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(true);
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [preset, setPreset] = useState<'baseline' | 'polling2026' | 'blank'>('baseline');
  const [selected, setSelected] = useState<string | null>(null);
  const [bubble, setBubble] = useState(false);
  const [scoreboardOn, setScoreboardOn] = useState(true);

  const [leftPanel, setLeftPanel] = useState<'parli' | null>(null);
  const [rightPanel, setRightPanel] = useState<'sim' | 'tutorial' | 'breakdown' | 'swing' | 'analysis' | null>(null);
  const [exitLeft, setExitLeft] = useState<string | null>(null);
  const [exitRight, setExitRight] = useState<string | null>(null);
  const tL = useRef<ReturnType<typeof setTimeout> | null>(null); const tR = useRef<ReturnType<typeof setTimeout> | null>(null);

  // per-constituency overrides (any preset) + blank-map projection state
  const [overrides, setOverrides] = useState<Record<string, Shares>>({});
  const [projectedConsts, setProjectedConsts] = useState<Set<string>>(new Set());
  const [reporting, setReporting] = useState<Record<string, number>>({});
  // national vote-share target (Swing / Simulation sliders)
  const [natTarget, setNatTarget] = useState<Shares>({ NDA: 44.2, INDIA: 40.4, OTH: 15.4 });

  // simulation state
  const [simDuration, setSimDuration] = useState<60000 | 120000 | 300000 | 600000>(120000);
  const [simRunning, setSimRunning] = useState(false);
  const [declared, setDeclared] = useState<Set<string> | null>(null);
  const simTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}india-results-2024.json`).then(r => r.json()).then((d: ResultsPayload) => { setData(d); setNatTarget({ ...d.nat2024 }); }).catch(console.error);
    fetch(`${import.meta.env.BASE_URL}india-constituencies.geojson`).then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const nat2024 = data?.nat2024 ?? { NDA: 44.2, INDIA: 40.4, OTH: 15.4 };
  const choosePreset = (p: 'baseline' | 'polling2026' | 'blank') => {
    setPreset(p); resetSim(); setSelected(null); setOverrides({});
    if (p !== 'blank') { setProjectedConsts(new Set()); setReporting({}); }
    setNatTarget(p === 'polling2026' ? { ...IN_NAT_2026 } : { ...nat2024 });
  };
  // Let a vertical scroll wheel scroll the header tabs horizontally on small screens.
  useEffect(() => {
    const el = headerScrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  const flips2026 = useMemo(() => data ? compute2026Flips(data.results) : new Set<string>(), [data]);

  const openLeft = useCallback((p: 'parli') => {
    setLeftPanel(cur => { if (cur === p) { setExitLeft(p); tL.current = setTimeout(() => setExitLeft(null), 280); return null; } if (cur) { setExitLeft(cur); tL.current = setTimeout(() => setExitLeft(null), 280); } return p; });
  }, []);
  const openRight = useCallback((p: 'sim' | 'tutorial' | 'breakdown' | 'swing' | 'analysis') => {
    setRightPanel(cur => { if (cur === p) { setExitRight(p); tR.current = setTimeout(() => setExitRight(null), 280); return null; } if (cur) { setExitRight(cur); tR.current = setTimeout(() => setExitRight(null), 280); } if (p === 'sim' || p === 'swing') setSelected(null); return p; });
  }, []);

  function stopSim() { simTimers.current.forEach(clearTimeout); simTimers.current = []; setSimRunning(false); }
  function runSim() {
    if (!data) return; stopSim(); setSelected(null);
    const keys = Object.keys(data.results).sort(() => Math.random() - 0.5);
    const times = bellTimes(keys.length, simDuration);
    setSimRunning(true); setDeclared(new Set());
    const local = new Set<string>(); const timers: ReturnType<typeof setTimeout>[] = [];
    keys.forEach((k, i) => timers.push(setTimeout(() => {
      local.add(k); setDeclared(new Set(local));
      if (local.size >= keys.length) setSimRunning(false);
    }, times[i])));
    simTimers.current = timers;
  }
  function resetSim() { stopSim(); setDeclared(null); }

  // Sim panel "armed" = open with no run yet (declared==null, not running): the map, tooltips,
  // scoreboard and bubbles must stay BLANK — no preview — until Run is clicked. Model it as sim
  // mode over an empty declared set so nothing is counted. (CLAUDE.md: never premap sim results;
  // adjusting the sliders must not preview anything before the run button is pressed.)
  const emptyDeclared = useRef<Set<string>>(new Set()).current;
  const simArmed = rightPanel === 'sim' && !simRunning && declared == null;
  const effDeclared = simArmed ? emptyDeclared : declared;
  const effSimMode = simRunning || effDeclared != null;

  // ── Active scenario winners / shares / raw votes ──
  // Unified engine: per-seat shares = override, else canonical (real 2024 / calibrated 2026)
  // when no national swing, else the baseline shares swung by (natTarget − nat2024). Winners
  // come from the two-contender swing (honours the OTH-fragmentation rule) or argmax for
  // explicit overrides. Simulation reveals this scenario seat-by-seat (declared filter).
  const { winners, marginByKey, sharesByKey, rawByKey, rawMargin, seats, natPct, natVotes, declaredTotal } = useMemo(() => {
    const winners: Record<string, Cat> = {}; const marginByKey: Record<string, number> = {};
    const sharesByKey: Record<string, Shares> = {}; const rawByKey: Record<string, Record<Cat, number>> = {};
    const rawMargin: Record<string, number> = {}; const seats: Record<Cat, number> = { NDA: 0, INDIA: 0, OTH: 0 };
    const natV: Shares = { NDA: 0, INDIA: 0, OTH: 0 }; let natTot = 0;
    let natP: Shares = { NDA: 0, INDIA: 0, OTH: 0 }; let declaredTotal = IN_TOTAL;
    if (data) {
      const simMode = effSimMode;
      const blankMode = preset === 'blank' && !simMode;
      const swing: Shares = { NDA: natTarget.NDA - data.nat2024.NDA, INDIA: natTarget.INDIA - data.nat2024.INDIA, OTH: natTarget.OTH - data.nat2024.OTH };
      const canonNat = preset === 'polling2026' ? IN_NAT_2026 : data.nat2024;
      const swingActive = swingMag(natTarget, canonNat) > 0.05;
      for (const [key, r] of Object.entries(data.results)) {
        let win: Cat; let relMargin: number; let shares: Shares;
        const ov = overrides[key];
        if (blankMode) {
          if (!projectedConsts.has(key)) { sharesByKey[key] = ov ?? r.shares; rawByKey[key] = { NDA: 0, INDIA: 0, OTH: 0 }; continue; }
          shares = ov ?? r.shares; win = winnerOfShares(shares); const so = CATS.map(c => shares[c]).sort((a, b) => b - a); relMargin = so[0] - so[1];
        } else if (ov) {
          shares = ov; win = winnerOfShares(ov); const so = CATS.map(c => ov[c]).sort((a, b) => b - a); relMargin = so[0] - so[1];
        } else if (preset === 'polling2026' && !swingActive) {
          win = flips2026.has(key) ? 'NDA' : r.win; relMargin = seatOutcome(r, swing).relMargin; shares = swungShares(r.shares, swing);
        } else if (!swingActive) {
          win = r.win; relMargin = r.marginPct; shares = r.shares;
        } else {
          const o = seatOutcome(r, swing); win = o.winner; relMargin = o.relMargin; shares = swungShares(r.shares, swing);
        }
        winners[key] = win; marginByKey[key] = relMargin; sharesByKey[key] = shares;
        const rpt = blankMode ? (reporting[key] ?? 100) / 100 : 1;
        const tv = r.totalVotes * rpt;
        rawByKey[key] = { NDA: Math.round(shares.NDA / 100 * tv), INDIA: Math.round(shares.INDIA / 100 * tv), OTH: Math.round(shares.OTH / 100 * tv) };
        rawMargin[key] = Math.abs(r.margin ?? 0);
        const counted = !simMode || effDeclared?.has(key);
        if (counted) seats[win]++;
        // national tally — accumulate ONLY from counted constituencies so the dashboard's
        // % and raw votes grow live as seats declare during the simulation. tv is the
        // reporting-adjusted total (= full total in sim/normal, % reporting in blank mode).
        if (counted) { for (const c of CATS) natV[c] += shares[c] / 100 * tv; natTot += tv; }
      }
      natP = natTot > 0 ? { NDA: natV.NDA / natTot * 100, INDIA: natV.INDIA / natTot * 100, OTH: natV.OTH / natTot * 100 } : { NDA: 0, INDIA: 0, OTH: 0 };
      declaredTotal = simMode ? (effDeclared?.size ?? 0) : (blankMode ? projectedConsts.size : IN_TOTAL);
    }
    return { winners, marginByKey, sharesByKey, rawByKey, rawMargin, seats, natPct: natP, natVotes: natV, declaredTotal };
  }, [data, preset, overrides, projectedConsts, reporting, flips2026, simRunning, effDeclared, effSimMode, natTarget]);

  const btnBase = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  const showBreakdown = rightPanel === 'breakdown' || exitRight === 'breakdown';
  const showAnalysis = rightPanel === 'analysis' || exitRight === 'analysis';
  const showParli = leftPanel === 'parli' || exitLeft === 'parli';
  const showTutorial = rightPanel === 'tutorial' || exitRight === 'tutorial';
  const showSwing = rightPanel === 'swing' || exitRight === 'swing';
  const simMode = effSimMode;
  // Click a seat to adjust it in any preset (not during a live sim).
  const showConst = !!selected && rightPanel !== 'sim' && rightPanel !== 'swing' && !simRunning;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="in">
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo /></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <img src={`${import.meta.env.BASE_URL}india-flag.png`} alt="India" className="h-4 rounded-[2px] shrink-0 opacity-90" />
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">India · Lok Sabha</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => choosePreset('baseline')} className={preset === 'baseline' && !simMode ? btnGold : btnMuted}>2024 Result</button>
          <button onClick={() => choosePreset('polling2026')} className={preset === 'polling2026' && !simMode ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={() => choosePreset('blank')} className={preset === 'blank' && !simMode ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => openRight('swing')} className={rightPanel === 'swing' ? btnActive : btnMuted}>⇄ Swing</button>
          <button onClick={() => { if (rightPanel !== 'sim') choosePreset('blank'); openRight('sim'); }} className={rightPanel === 'sim' ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => setScoreboardOn(v => !v)} className={scoreboardOn ? btnActive : btnMuted}>Scoreboard</button>
          <button onClick={() => openRight('breakdown')} className={rightPanel === 'breakdown' ? btnActive : btnMuted}>Breakdown</button>
          <button onClick={() => openRight('analysis')} className={rightPanel === 'analysis' ? btnActive : btnMuted}>Analysis</button>
          <button onClick={() => openLeft('parli')} className={leftPanel === 'parli' ? btnActive : btnMuted}>Parliament</button>
          <button onClick={() => setBubble(v => !v)} className={bubble ? `${btnBase} bg-emerald-600 text-white hover:bg-emerald-700` : btnMuted}>Bubble Map</button>
          <button onClick={() => openRight('tutorial')} className={rightPanel === 'tutorial' ? btnActive : btnMuted}>Tutorial</button>
        </div>
        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors" title="Toggle dark mode">{dark ? '☀' : '☾'}</button>
        </div>
      </header>

      {scoreboardOn && <InScoreboard seats={seats} natPct={natPct} natVotes={natVotes} declaredTotal={simMode ? declaredTotal : undefined} />}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showParli && <InParliamentPanel seats={seats} onClose={() => openLeft('parli')} exiting={exitLeft === 'parli'} dark={dark} />}

        <div className="relative flex-1 min-w-0 min-h-0">
          <InMapView geoData={geoData} winners={winners} marginByKey={marginByKey} sharesByKey={sharesByKey} rawByKey={rawByKey} rawMargin={rawMargin}
            baseResults={data?.results ?? {}} selected={selected} onSelect={setSelected} dark={dark} bubble={bubble}
            blankMode={preset === 'blank' && !simMode} projected={projectedConsts} declared={effSimMode ? (effDeclared ?? emptyDeclared) : undefined} />
          {(simMode || preset === 'blank') && <InReportingWidget declared={declaredTotal} live={simRunning} dark={dark} />}
        </div>

        {rightPanel === 'sim' && (
          <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div><h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Live election-night reveal</p></div>
              <button onClick={() => openRight('sim')} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="px-3.5 py-3 space-y-4 flex-1 overflow-y-auto thin-scroll">
              <div>
                <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">Vote share to simulate</div>
                <NatSliders target={natTarget} onChange={simRunning ? () => {} : (v) => { setNatTarget(v); if (declared != null) setDeclared(null); }} dark={dark} />
              </div>
              <div>
                <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Length</div>
                <div className="flex gap-1.5">
                  {([['1m', 60000], ['2m', 120000], ['5m', 300000], ['10m', 600000]] as const).map(([l, ms]) => (
                    <button key={ms} disabled={simRunning} onClick={() => setSimDuration(ms)} className={`flex-1 py-1.5 rounded-[4px] border text-[10px] font-mono font-bold transition-colors ${simDuration === ms ? 'bg-blue-600 text-white border-blue-600' : 'border-default text-ink-3 hover:bg-hover'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <p className="text-[8.5px] font-mono text-ink-3 leading-relaxed">Set the national vote share, then Run — all 543 seats declare in random bell-curve-timed batches. The map and scoreboard fill live; hover a called seat for its result.</p>
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button disabled={simRunning} onClick={runSim} className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">{simRunning ? `${declaredTotal}/${IN_TOTAL} declared…` : '▶ Run Simulation'}</button>
              {(declared != null) && <button onClick={resetSim} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover">Reset</button>}
            </div>
          </aside>
        )}

        {showSwing && data && (
          <aside className={`w-64 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exitRight === 'swing' ? 'panel-exit' : 'panel-slide'}`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div><h2 className="text-[14px] font-bold text-ink leading-none">⇄ National Swing</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Type or drag a vote share</p></div>
              <button onClick={() => openRight('swing')} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="px-3.5 py-3 flex-1 overflow-y-auto thin-scroll space-y-4">
              <NatSliders target={natTarget} onChange={setNatTarget} dark={dark} />
              <button onClick={() => choosePreset(preset === 'blank' ? 'baseline' : preset)} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover">Reset to {preset === 'polling2026' ? '2026' : '2024'}</button>
              <p className="text-[8.5px] font-mono text-ink-3 leading-relaxed">Every seat's 2024 result shifts by your swing and is recomputed first-past-the-post. Watch the seat tally and map change instantly.</p>
            </div>
          </aside>
        )}

        {showConst && selected && data?.results[selected] && (
          <InConstPanel key={selected} pcKey={selected} base={data.results[selected]} current={sharesByKey[selected] ?? data.results[selected].shares} override={overrides[selected]} reporting={reporting[selected] ?? 100} projected={projectedConsts.has(selected)} blankMode={preset === 'blank'}
            onOverride={s => setOverrides(p => ({ ...p, [selected]: s }))} onReporting={n => setReporting(p => ({ ...p, [selected]: n }))}
            onProject={() => setProjectedConsts(p => new Set([...p, selected]))}
            onReset={() => { setProjectedConsts(p => { const n = new Set(p); n.delete(selected); return n; }); setOverrides(p => { const n = { ...p }; delete n[selected]; return n; }); }}
            onClose={() => setSelected(null)} dark={dark} />
        )}

        {showBreakdown && data && <InBreakdownPanel seats={seats} natPct={natPct} data={data} winners={winners} onClose={() => openRight('breakdown')} exiting={exitRight === 'breakdown'} dark={dark} />}
        {showAnalysis && data && <InAnalysisPanel winners={winners} rawByKey={rawByKey} data={data} onClose={() => openRight('analysis')} exiting={exitRight === 'analysis'} dark={dark} />}
        {showTutorial && <InTutorialPanel onClose={() => openRight('tutorial')} exiting={exitRight === 'tutorial'} dark={dark} />}
      </div>
    </div>
  );
}
