import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

type SaPartyId = 'ANC' | 'DA' | 'MK' | 'EFF' | 'IFP' | 'PA' | 'FFP' | 'RISE' | 'UDM';
type SaParty = { id: SaPartyId; name: string; fullName: string; color: string; seats2024: number; leader: string; wikiTitle?: string };

const SA_PARTIES: SaParty[] = [
  { id: 'ANC',  name: 'ANC',  fullName: 'African National Congress',  color: '#007A4D', seats2024: 159, leader: 'Cyril Ramaphosa',     wikiTitle: 'Cyril_Ramaphosa' },
  { id: 'DA',   name: 'DA',   fullName: 'Democratic Alliance',        color: '#1565C0', seats2024:  87, leader: 'John Steenhuisen',    wikiTitle: 'John_Steenhuisen' },
  { id: 'MK',   name: 'MK',   fullName: 'uMkhonto we Sizwe Party',    color: '#B71C1C', seats2024:  58, leader: 'Jacob Zuma',          wikiTitle: 'Jacob_Zuma' },
  { id: 'EFF',  name: 'EFF',  fullName: 'Economic Freedom Fighters',  color: '#E53935', seats2024:  39, leader: 'Julius Malema',       wikiTitle: 'Julius_Malema' },
  { id: 'IFP',  name: 'IFP',  fullName: 'Inkatha Freedom Party',      color: '#6A1B9A', seats2024:  17, leader: 'Velenkosini Hlabisa', wikiTitle: 'Velenkosini_Hlabisa' },
  { id: 'PA',   name: 'PA',   fullName: 'Patriotic Alliance',         color: '#E65100', seats2024:   9, leader: 'Gayton McKenzie',     wikiTitle: 'Gayton_McKenzie' },
  { id: 'FFP',  name: 'FF+',  fullName: 'Freedom Front Plus',         color: '#FF8F00', seats2024:   6, leader: 'Pieter Groenewald',   wikiTitle: 'Pieter_Groenewald' },
  { id: 'RISE', name: 'Rise', fullName: 'Rise Mzansi',                color: '#00838F', seats2024:   6, leader: 'Songezo Zibi',        wikiTitle: 'Songezo_Zibi' },
  { id: 'UDM',  name: 'UDM',  fullName: 'United Democratic Movement', color: '#558B2F', seats2024:   3, leader: 'Bantu Holomisa',      wikiTitle: 'Bantu_Holomisa' },
];

const SA_PARTY_MAP = Object.fromEntries(SA_PARTIES.map(p => [p.id, p])) as Record<SaPartyId, SaParty>;
const SA_TOTAL_SEATS = 400;
const SA_MAJORITY = 201;

const SA_VOTE_PCT_2024: Record<SaPartyId, number> = {
  ANC: 42.54, DA: 23.09, MK: 15.44, EFF: 10.08, IFP: 4.08, PA: 2.08, FFP: 1.12, RISE: 0.90, UDM: 0.68,
};
const SA_VOTE_RAW_2024: Record<SaPartyId, number> = {
  ANC: 6_494_000, DA: 3_531_000, MK: 2_364_000, EFF: 1_554_000,
  IFP: 620_000, PA: 320_000, FFP: 170_000, RISE: 140_000, UDM: 105_000,
};
const SA_GRAND_TOTAL_VOTES = 16_200_000;

type SaProvId = 'GP' | 'KZN' | 'WC' | 'EC' | 'LP' | 'MP' | 'NC' | 'NW' | 'FS';
type SaProvince = { id: SaProvId; name: string; pop: number; lat: number; lng: number; votes2024: number };

const SA_PROVINCES: SaProvince[] = [
  { id: 'GP',  name: 'Gauteng',        pop: 15_176_000, lat: -26.2, lng: 28.0, votes2024: 4_850_000 },
  { id: 'KZN', name: 'KwaZulu-Natal',  pop: 11_514_000, lat: -29.1, lng: 30.7, votes2024: 3_600_000 },
  { id: 'WC',  name: 'Western Cape',   pop:  7_052_000, lat: -33.2, lng: 21.9, votes2024: 2_450_000 },
  { id: 'EC',  name: 'Eastern Cape',   pop:  6_498_000, lat: -32.3, lng: 26.4, votes2024: 1_900_000 },
  { id: 'LP',  name: 'Limpopo',        pop:  5_928_000, lat: -23.4, lng: 29.4, votes2024: 1_600_000 },
  { id: 'MP',  name: 'Mpumalanga',     pop:  4_679_000, lat: -25.6, lng: 30.5, votes2024: 1_380_000 },
  { id: 'NC',  name: 'Northern Cape',  pop:  1_293_000, lat: -29.0, lng: 21.9, votes2024:   400_000 },
  { id: 'NW',  name: 'North West',     pop:  4_027_000, lat: -26.5, lng: 25.6, votes2024: 1_100_000 },
  { id: 'FS',  name: 'Free State',     pop:  2_887_000, lat: -28.5, lng: 26.8, votes2024:   850_000 },
];
const SA_PROV_MAP = Object.fromEntries(SA_PROVINCES.map(p => [p.id, p])) as Record<SaProvId, SaProvince>;

const SA_PROV_RESULTS_2024: Record<SaProvId, Record<SaPartyId, number>> = {
  GP:  { ANC:34.0, DA:28.0, MK:14.0, EFF:13.0, IFP:3.0,  PA:4.0, FFP:2.0, RISE:1.0, UDM:1.0 },
  KZN: { ANC:17.0, DA:15.0, MK:45.0, EFF:5.0,  IFP:14.0, PA:2.0, FFP:1.0, RISE:0.5, UDM:0.5 },
  WC:  { ANC:22.0, DA:56.0, MK:5.0,  EFF:5.0,  IFP:1.0,  PA:4.0, FFP:3.0, RISE:3.0, UDM:1.0 },
  EC:  { ANC:56.0, DA:14.0, MK:10.0, EFF:12.0, IFP:1.0,  PA:2.0, FFP:0.5, RISE:2.0, UDM:2.5 },
  LP:  { ANC:65.0, DA:8.0,  MK:10.0, EFF:13.0, IFP:1.0,  PA:1.0, FFP:0.5, RISE:0.5, UDM:1.0 },
  MP:  { ANC:52.0, DA:12.0, MK:18.0, EFF:10.0, IFP:4.0,  PA:2.0, FFP:1.0, RISE:0.5, UDM:0.5 },
  NC:  { ANC:48.0, DA:26.0, MK:8.0,  EFF:9.0,  IFP:1.0,  PA:5.0, FFP:2.0, RISE:0.5, UDM:0.5 },
  NW:  { ANC:50.0, DA:16.0, MK:16.0, EFF:11.0, IFP:2.0,  PA:3.0, FFP:1.0, RISE:0.5, UDM:0.5 },
  FS:  { ANC:55.0, DA:16.0, MK:11.0, EFF:13.0, IFP:1.0,  PA:2.0, FFP:1.0, RISE:0.5, UDM:0.5 },
};

function calcSeats(votePcts: Partial<Record<SaPartyId, number>>, totalSeats = SA_TOTAL_SEATS): Partial<Record<SaPartyId, number>> {
  const qualifying: Partial<Record<SaPartyId, number>> = {};
  let qualSum = 0;
  for (const [id, v] of Object.entries(votePcts) as [SaPartyId, number][]) {
    if ((v ?? 0) > 0) { qualifying[id] = v; qualSum += v; }
  }
  if (qualSum === 0) return {};
  const quotients: { id: SaPartyId; q: number }[] = [];
  for (const [id, v] of Object.entries(qualifying) as [SaPartyId, number][]) {
    for (let d = 1; d <= totalSeats; d++) quotients.push({ id, q: v / d });
  }
  quotients.sort((a, b) => b.q - a.q);
  const seats: Partial<Record<SaPartyId, number>> = {};
  for (let i = 0; i < Math.min(totalSeats, quotients.length); i++) {
    seats[quotients[i].id] = (seats[quotients[i].id] ?? 0) + 1;
  }
  return seats;
}

function calcProvVotes(natPcts: Record<SaPartyId, number>, provId: SaProvId): Record<SaPartyId, number> {
  const base = SA_PROV_RESULTS_2024[provId];
  const raw: Record<SaPartyId, number> = {} as Record<SaPartyId, number>;
  let total = 0;
  for (const p of SA_PARTIES) {
    const swing = (natPcts[p.id] ?? 0) - (SA_VOTE_PCT_2024[p.id] ?? 0);
    const v = Math.max(0, (base[p.id] ?? 0) + swing);
    raw[p.id] = v; total += v;
  }
  if (total === 0) return raw;
  for (const p of SA_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

function calcPartialSeats(natPcts: Record<SaPartyId, number>, declaredProvs: Set<SaProvId>): Partial<Record<SaPartyId, number>> {
  if (declaredProvs.size === 0) return {};
  const weighted: Partial<Record<SaPartyId, number>> = {};
  let totalPop = 0;
  for (const provId of declaredProvs) {
    const prov = SA_PROV_MAP[provId]; if (!prov) continue;
    const rv = calcProvVotes(natPcts, provId);
    for (const p of SA_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (rv[p.id] ?? 0) * prov.pop;
    totalPop += prov.pop;
  }
  if (totalPop === 0) return {};
  const norm: Partial<Record<SaPartyId, number>> = {};
  for (const p of SA_PARTIES) norm[p.id] = (weighted[p.id] ?? 0) / totalPop;
  return calcSeats(norm);
}

function redistributePcts(current: Record<SaPartyId, number>, changedId: SaPartyId, newRaw: number, locks: Set<SaPartyId>): Record<SaPartyId, number> {
  const ids = Object.keys(current) as SaPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<SaPartyId, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  else if (unlocked.length > 0) for (const id of unlocked) next[id] = remaining / unlocked.length;
  return next;
}

function partyColor(id: SaPartyId): string { return SA_PARTY_MAP[id]?.color ?? '#888'; }

function saRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random(); while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function saBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () => Math.max(0.02, Math.min(0.98, 0.5 + saRandNormal() * 0.18)))
    .sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type ProvTooltipState = {
  x: number; y: number; name: string;
  parties: { id: SaPartyId; pct: number }[];
  leader: SaPartyId | null;
} | null;

const SA_LR_ORDER: SaPartyId[] = ['EFF', 'RISE', 'MK', 'ANC', 'UDM', 'IFP', 'PA', 'FFP', 'DA'];

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function SaScoreboardTile({ partyId, seats, pct, rawVotes, isLeader, isWinner }: {
  partyId: SaPartyId; seats: number; pct: number; rawVotes: number; isLeader: boolean; isWinner: boolean;
}) {
  const party = SA_PARTY_MAP[partyId];
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!party.wikiTitle) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(party.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [party.wikiTitle]);

  const initials = party.leader.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color = partyColor(partyId);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha, borderColor: (isLeader || isWinner) ? color : hexToRgba(color, 0.30) } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={party.leader} onError={() => setPhotoUrl(null)} />
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
      <span className="cand-leader-name" title={party.leader}>{party.leader.split(' ').pop()}</span>
      <span className="cand-party-abbrev">{party.name}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name" title={party.fullName}>{party.fullName}</span>
      <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:1 }}>
        <span style={{ fontSize:6.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:600, color:hexToRgba(color, 0.48), letterSpacing:'0.10em', textTransform:'uppercase' }}>VOTES</span>
        <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ width:'100%', textAlign:'right', marginBottom:3 }}>
        <span className="cand-votes-full" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.65) }}>{rawVotes.toLocaleString()}</span>
        <span className="cand-votes-compact" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.65) }}>{fmtN(rawVotes)}</span>
      </div>
      <div className="cand-bar-track" style={{ width:'100%', height:3, borderRadius:2, background:'var(--bar-track)' }}>
        <div style={{ height:'100%', borderRadius:2, background:color, width:`${Math.min(pct/45*100,100)}%`, transition:'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────────
function SaScoreboard({ natPcts, simSeats, isBaseline }: {
  natPcts: Record<SaPartyId, number>;
  simSeats?: Partial<Record<SaPartyId, number>>;
  isBaseline?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const handler = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', handler, { passive: false }); return () => el.removeEventListener('wheel', handler);
  }, []);

  const seats = useMemo(() => simSeats ?? calcSeats(natPcts), [simSeats, natPcts]);
  const pctTotal = Object.values(natPcts).reduce((s, v) => s + (v ?? 0), 0);
  const sorted = useMemo(
    () => SA_PARTIES.filter(p => (seats[p.id] ?? 0) > 0 || (natPcts[p.id] ?? 0) > 0)
      .sort((a, b) => (seats[b.id] ?? 0) - (seats[a.id] ?? 0) || (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)),
    [seats, natPcts],
  );
  const leader = sorted[0]?.id ?? null;
  const winner = leader && (seats[leader] ?? 0) >= SA_MAJORITY ? leader : null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {sorted.map(party => {
            const s = seats[party.id] ?? 0;
            const pct = pctTotal > 0 ? (natPcts[party.id] ?? 0) / pctTotal * 100 : 0;
            const rawVotes = isBaseline ? SA_VOTE_RAW_2024[party.id] : Math.round((natPcts[party.id] ?? 0) / 100 * SA_GRAND_TOTAL_VOTES);
            return (
              <SaScoreboardTile key={party.id} partyId={party.id} seats={s} pct={pct}
                rawVotes={rawVotes} isLeader={party.id === leader && !winner} isWinner={party.id === winner} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Map controller ─────────────────────────────────────────────────────────────
function MapController() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// ── Province bubble layer (hardcoded coords — no GeoJSON) ──────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };
function zoomScale(zoom: number): number { return Math.max(0.40, Math.min(1.0, (zoom - 4) / (9 - 4))); }

function SaBubbleLayer({ natPcts, containerRef, setTooltip, onSelect, natPctsRef, declaredProvs, overrides }: {
  natPcts: Record<SaPartyId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: ProvTooltipState) => void;
  onSelect: (id: SaProvId) => void;
  natPctsRef: React.MutableRefObject<Record<SaPartyId, number>>;
  overrides?: Record<string, Record<SaPartyId, number>>;
  declaredProvs?: Set<SaProvId>;
}) {
  const map = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

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

    for (const prov of SA_PROVINCES) {
      if (declaredProvs && !declaredProvs.has(prov.id)) continue;
      const rv = overrides?.[prov.id] ?? calcProvVotes(natPcts, prov.id);
      const sorted = (Object.entries(rv) as [SaPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (!sorted.length) continue;
      const [winId, winPct] = sorted[0];
      const margin = winPct - (sorted[1]?.[1] ?? 0);
      const baseRadius = 7 + Math.min(margin / 20, 1) * 17;
      const color = partyColor(winId);
      const marker = L.circleMarker([prov.lat, prov.lng] as L.LatLngExpression, {
        radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1.5, opacity: 0.9,
      }).addTo(map);

      marker.on('click', () => { setTooltip(null); onSelectRef.current(prov.id); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
        const cur = overrides?.[prov.id] ?? calcProvVotes(natPctsRef.current, prov.id);
        const parties = (Object.entries(cur) as [SaPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5).map(([id, pct]) => ({ id, pct }));
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: prov.name, parties, leader: parties[0]?.id ?? null });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    }
    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  }, [map, natPcts, declaredProvs, overrides]);

  return null;
}

// ── Map view ───────────────────────────────────────────────────────────────────
function SaMapView({ natPcts, onSelect, dark, declaredProvs, overrides }: {
  natPcts: Record<SaPartyId, number>; onSelect: (id: SaProvId) => void;
  dark: boolean; declaredProvs?: Set<SaProvId>;
  overrides?: Record<string, Record<SaPartyId, number>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<ProvTooltipState>(null);
  const natPctsRef = useRef(natPcts);
  useEffect(() => { natPctsRef.current = natPcts; }, [natPcts]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[-29, 25]} zoom={5} minZoom={4} maxZoom={13}
        style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
        <TileLayer key={dark ? 'dark' : 'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd" updateWhenZooming={false} updateWhenIdle maxZoom={20} />
        <MapController />
        <SaBubbleLayer natPcts={natPcts} containerRef={containerRef}
          setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef} declaredProvs={declaredProvs} overrides={overrides} />
      </MapContainer>
      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 220; const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = {
          bg: dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
          title: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
          body: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', padding:'12px 14px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:tt.title }}>{tooltip.name}</div>
              <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.42)', marginTop:2 }}>Est. provincial result</div>
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
                {tooltip.parties.map(({ id, pct }, i) => {
                  const c = partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <span style={{ width:8, height:8, borderRadius:2, flexShrink:0, background:c }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{SA_PARTY_MAP[id]?.name ?? id}</span>
                      <span style={{ fontSize:12, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:c }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click bubble to open</div>
    </div>
  );
}

// ── Province panel (editable) ──────────────────────────────────────────────────
function SaProvPanel({ provId, natPcts, onUpdate, onClose, dark, override }: {
  provId: SaProvId; natPcts: Record<SaPartyId, number>;
  onUpdate: (id: SaProvId, pcts: Record<SaPartyId, number>) => void;
  onClose: () => void; dark?: boolean;
  override?: Record<SaPartyId, number>;
}) {
  const initPcts = () => {
    if (override) return { ...override };
    const rv = calcProvVotes(natPcts, provId);
    return Object.fromEntries(SA_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<SaPartyId, number>;
  };
  const [pcts, setPcts] = useState<Record<SaPartyId, number>>(initPcts);
  const [panelLocks, setPanelLocks] = useState<Set<SaPartyId>>(new Set());
  const [editId, setEditId] = useState<SaPartyId | null>(null);
  const [editVal, setEditVal] = useState('');
  const pctsRef = useRef(pcts);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);

  useEffect(() => {
    if (override) setPcts({ ...override });
    else {
      const rv = calcProvVotes(natPcts, provId);
      setPcts(Object.fromEntries(SA_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<SaPartyId, number>);
    }
    setPanelLocks(new Set()); setEditId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provId]);

  function applyChange(id: SaPartyId, val: number) {
    const next = redistributePcts(pctsRef.current, id, val, panelLocks);
    pctsRef.current = next; setPcts(next); onUpdate(provId, next);
  }
  function commitEdit(id: SaPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  const sorted = useMemo(() => SA_PARTIES.map(p => ({ ...p, pct: pcts[p.id] ?? 0 })).sort((a, b) => b.pct - a.pct), [pcts]);
  const prov = SA_PROV_MAP[provId]; const winner = sorted[0];
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{prov?.name ?? provId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{override ? 'Custom result · click % to edit' : 'Estimated result · click % to edit'}</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] border" style={{ borderColor:`${winner.color}33` }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background:winner.color }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
            <span className="text-[9px] font-mono text-ink-3">{winner.pct.toFixed(1)}%</span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-2.5">
        {sorted.filter(p => p.pct >= 0.1 || panelLocks.has(p.id)).map(p => {
          const pct = pcts[p.id] ?? 0; const isLocked = panelLocks.has(p.id);
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:p.color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                {editId === p.id
                  ? <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                      className="w-14 text-[11px] font-mono text-right border border-default rounded px-1 bg-canvas text-ink"
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(p.id, editVal)}
                      onKeyDown={e => { if (e.key==='Enter') commitEdit(p.id, editVal); if (e.key==='Escape') { setEditId(null); setEditVal(''); } }} />
                  : <button onClick={() => { if (!isLocked) { setEditId(p.id); setEditVal(pct.toFixed(1)); } }}
                      className={`text-[10px] font-mono font-semibold tabular-nums ${isLocked?'cursor-default':'hover:underline cursor-text'}`}
                      style={{ color:p.color }}>{pct.toFixed(1)}%</button>
                }
                <button onClick={() => setPanelLocks(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`} title={isLocked?'Unlock':'Lock'}>
                  {isLocked
                    ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  }
                </button>
              </div>
              <input type="range" min={0} max={75} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(p.id, parseFloat(e.target.value))}
                className="br-party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${(pct/75)*100}%` } as React.CSSProperties} />
            </div>
          );
        })}
        <div className="pt-2 border-t border-default space-y-2">
          <div>
            <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">Population</div>
            <div className="text-[11px] font-mono font-semibold text-ink">{prov?.pop.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">2024 Votes Cast</div>
            <div className="text-[11px] font-mono font-semibold text-ink">{prov?.votes2024.toLocaleString()}</div>
          </div>
          {override && (
            <button onClick={() => {
              const rv = calcProvVotes(natPcts, provId);
              const reset = Object.fromEntries(SA_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<SaPartyId, number>;
              setPcts(reset); setPanelLocks(new Set()); onUpdate(provId, reset);
            }} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Reset to Estimate
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Parliament hemicycle ───────────────────────────────────────────────────────
function SaParliamentPanel({ seats: seatsMap, onClose, exiting, dark }: { seats: Partial<Record<SaPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const seatColors: string[] = [];
  const legend: { id: SaPartyId; count: number; color: string }[] = [];
  for (const id of SA_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n === 0) continue;
    const color = partyColor(id);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;
  const W = 310, H = 180, cx = W/2, cy = H - 4, innerR = 52, rowSpacing = 9, rows = 6;
  const arcLengths = Array.from({ length: rows }, (_, i) => Math.PI * (innerR + i * rowSpacing));
  const totalArc = arcLengths.reduce((s, v) => s + v, 0);
  const floors = arcLengths.map(a => Math.floor((a / totalArc) * SA_TOTAL_SEATS));
  const remainder = SA_TOTAL_SEATS - floors.reduce((s, v) => s + v, 0);
  arcLengths.map((a, i) => ({ i, frac: (a/totalArc)*SA_TOTAL_SEATS - floors[i] }))
    .sort((a, b) => b.frac - a.frac).slice(0, remainder).forEach(({ i }) => floors[i]++);
  const rawPos: { x: number; y: number; θ: number; r: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const r = innerR + row * rowSpacing; const n = floors[row];
    for (let j = 0; j < n; j++) { const θ = Math.PI * (n - j - 0.5) / n; rawPos.push({ x: cx + r*Math.cos(θ), y: cy - r*Math.sin(θ), θ, r }); }
  }
  rawPos.sort((a, b) => b.θ - a.θ || a.r - b.r);
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit-left':'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">National Assembly</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {SA_MAJORITY} · no threshold</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats === 0
          ? <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">Load results or run simulation first</div>
          : <>
            <div className="px-2.5 pt-5 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
                <line x1={cx} y1={cy-innerR+4} x2={cx} y2={cy-(innerR+(rows-1)*rowSpacing)-8} stroke="rgba(0,0,0,0.10)" strokeWidth="1" strokeDasharray="3,3" />
                {rawPos.map(({ x, y }, i) => (
                  <circle key={i} cx={x} cy={y} r={2.8} fill={i < seatColors.length ? seatColors[i] : (dark?'#374151':'#e5e7eb')} />
                ))}
              </svg>
            </div>
            <div className="px-3.5 pb-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({ id, count, color }) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{ width:9, height:9, borderRadius:2, background:color, flexShrink:0 }} />
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{SA_PARTY_MAP[id].name}</span>
                    <span className="text-[9.5px] font-mono font-bold text-ink">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        }
      </div>
    </aside>
  );
}

// ── Coalition builder ──────────────────────────────────────────────────────────
const SA_PRESET_COALITIONS: { name: string; emoji: string; parties: SaPartyId[] }[] = [
  { name: 'GNU (Current)',     emoji: '🇿🇦', parties: ['ANC','DA','IFP','PA','FFP','RISE','UDM'] },
  { name: 'ANC + MK + EFF',   emoji: '✊',  parties: ['ANC','MK','EFF'] },
  { name: 'DA-Led Opposition', emoji: '🔵', parties: ['DA','IFP','FFP','RISE','PA'] },
  { name: 'ANC + MK',         emoji: '🤝', parties: ['ANC','MK'] },
];

function SaCoalitionPanel({ seats, onClose, exiting, dark }: { seats: Partial<Record<SaPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const [selected, setSelected] = useState<Set<SaPartyId>>(new Set(['ANC','DA','IFP','PA','FFP','RISE','UDM']));
  const toggle = (id: SaPartyId) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalCoalSeats = [...selected].reduce((s, id) => s + (seats[id] ?? 0), 0);
  const hasMajority = totalCoalSeats >= SA_MAJORITY;
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {SA_MAJORITY} seats · {SA_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {SA_PRESET_COALITIONS.map(coal => (
            <button key={coal.name} onClick={() => setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3 truncate">{coal.parties.map(id => SA_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {SA_LR_ORDER.map(id => {
            const party = SA_PARTY_MAP[id]; const s = seats[id] ?? 0;
            const isIn = selected.has(id); const color = partyColor(id);
            return (
              <button key={id} onClick={() => toggle(id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] border transition-colors ${isIn ? 'border-transparent' : 'border-default hover:bg-hover'}`}
                style={isIn ? { background: hexToRgba(color, 0.12), borderColor: hexToRgba(color, 0.40) } : {}}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="flex-1 text-[10px] font-medium text-ink truncate text-left">{party.fullName}</span>
                <span className="text-[9px] font-mono font-bold" style={{ color }}>{s}s</span>
                {isIn && <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 4.5l1.8 1.8L7 2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/></svg>}
              </button>
            );
          })}
        </div>
      </div>
      <div className={`px-3.5 py-3 border-t border-default shrink-0 ${hasMajority ? 'bg-emerald-500/10' : ''}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold text-ink">Coalition total</span>
          <span className="text-[20px] font-black font-mono" style={{ color: hasMajority ? '#16a34a' : '#ef4444' }}>{totalCoalSeats}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-black/8 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300" style={{ width:`${Math.min(totalCoalSeats/SA_TOTAL_SEATS*100,100)}%`, background: hasMajority ? '#16a34a' : '#ef4444' }} />
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority ? 'text-emerald-600' : 'text-red-500'}`}>
          {hasMajority ? `✓ MAJORITY (need ${SA_MAJORITY})` : `✗ ${SA_MAJORITY - totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Tutorial panel ─────────────────────────────────────────────────────────────
function SaTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>;
  const P  = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>;
  const Note = ({ children }: { children: React.ReactNode }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">South African Elections Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>Electoral System</H2>
        <P>South Africa uses <strong>closed-list proportional representation</strong>. Voters choose a party. The 400 National Assembly seats are divided proportionally among all parties that receive votes.</P>
        <Note>This simulator uses <strong>D'Hondt</strong> to allocate seats. South Africa's actual system uses the Droop quota — results are nearly identical in practice.</Note>
        <H2>No Threshold</H2>
        <P>There is <strong>no formal threshold</strong>. Even very small parties win seats. Roughly 0.25% of the national vote earns a single seat.</P>
        <H2>2024 Historic Election</H2>
        <P>In 2024, the <strong>ANC fell below 50%</strong> for the first time since 1994. The outcome was a <strong>Government of National Unity (GNU)</strong> — ANC + DA + IFP + several smaller parties, together holding 275+ seats.</P>
        <H2>9 Provinces on the Map</H2>
        <P>Each coloured bubble represents one of South Africa's 9 provinces. Bubble colour shows the leading party; size reflects the margin of victory. Click any bubble to see the provincial breakdown.</P>
        <H2>Sliders</H2>
        <P>Open <strong>Simulation</strong> to drag vote-share sliders. Lock any party to keep it fixed while others redistribute proportionally.</P>
        <H2>Coalition Builder</H2>
        <P>Click <strong>Coalition</strong> to toggle parties and see whether a combination reaches the 201-seat majority threshold.</P>
      </div>
    </aside>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────
export default function SouthAfricaApp() {
  const navigate = useNavigate();

  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  const [preset, setPreset]   = useState<'baseline'|'blank'|'custom'>('baseline');
  const [natPcts, setNatPcts] = useState<Record<SaPartyId, number>>(() => ({ ...SA_VOTE_PCT_2024 }));

  function loadBaseline() { setNatPcts({ ...SA_VOTE_PCT_2024 }); setPreset('baseline'); resetSim(); }
  function loadBlank()    { setNatPcts(Object.fromEntries(SA_PARTIES.map(p => [p.id, 100/SA_PARTIES.length])) as Record<SaPartyId, number>); setPreset('blank'); resetSim(); }

  const [selectedProv, setSelectedProv]           = useState<SaProvId | null>(null);
  const [provOverrides, setProvOverrides]         = useState<Record<string, Record<SaPartyId, number>>>({});
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [locks, setLocks]                         = useState<Set<SaPartyId>>(new Set());
  const [simOpen, setSimOpen]                     = useState(false);
  const [parliOpen, setParliOpen]                 = useState(false);
  const [coalitionOpen, setCoalitionOpen]         = useState(false);
  const [tutorialOpen, setTutorialOpen]           = useState(false);
  const [exitPanel, setExitPanel]                 = useState<string | null>(null);
  const exitTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const triggerExit = useCallback((panel: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  const [simSeats, setSimSeats]           = useState<Partial<Record<SaPartyId, number>> | undefined>();
  const [simProgress, setSimProgress]     = useState(0);
  const [simRunning, setSimRunning]       = useState(false);
  const [declaredProvs, setDeclaredProvs] = useState<Set<SaProvId> | undefined>();
  const simTimersRef        = useRef<ReturnType<typeof setTimeout>[]>([]);
  const natPctsAtSimStart   = useRef<Record<SaPartyId, number>>(natPcts);

  function stopSim() { simTimersRef.current.forEach(clearTimeout); simTimersRef.current = []; setSimRunning(false); }
  function resetSim() { stopSim(); setSimSeats(undefined); setDeclaredProvs(undefined); setSimProgress(0); }

  useEffect(() => {
    const el = headerScrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  const displaySeats = useMemo(() => simSeats ?? calcSeats(natPcts), [simSeats, natPcts]);

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  const showProv     = !!selectedProv && !simOpen;
  const showTutorial = tutorialOpen  || exitPanel === 'tutorial';
  const showParli    = parliOpen     || exitPanel === 'parli';
  const showCoal     = coalitionOpen || exitPanel === 'coal';

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="za">

      {/* ── Topbar ── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={loadBaseline} className={preset==='baseline' ? btnGold : btnMuted}>2024 Results</button>
          <button onClick={loadBlank}    className={preset==='blank'    ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => setSimOpen(v => !v)} className={simOpen ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => setScoreboardVisible(v => !v)} className={scoreboardVisible ? btnActive : btnMuted}>Scoreboard</button>
          <button onClick={() => { if (parliOpen) { setParliOpen(false); triggerExit('parli'); } else { setParliOpen(true); setCoalitionOpen(false); } }} className={parliOpen ? btnActive : btnMuted}>Parliament</button>
          <button onClick={() => { if (coalitionOpen) { setCoalitionOpen(false); triggerExit('coal'); } else { setCoalitionOpen(true); setParliOpen(false); } }} className={coalitionOpen ? btnActive : btnMuted}>Coalition</button>
          <button onClick={() => { if (tutorialOpen) { setTutorialOpen(false); triggerExit('tutorial'); } else setTutorialOpen(true); }} className={tutorialOpen ? btnActive : btnMuted}>Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors">{dark ? '☀' : '☾'}</button>
        </div>
      </header>

      {/* ── Scoreboard ── */}
      {scoreboardVisible && <SaScoreboard natPcts={natPcts} simSeats={simSeats} isBaseline={preset==='baseline'} />}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Parliament — LEFT */}
        {showParli && <SaParliamentPanel seats={displaySeats} onClose={() => { setParliOpen(false); triggerExit('parli'); }} exiting={exitPanel==='parli'} dark={dark} />}

        {/* Map */}
        <SaMapView natPcts={natPcts} onSelect={id => setSelectedProv(prev => prev === id ? null : id)} dark={dark} declaredProvs={declaredProvs} overrides={provOverrides} />

        {/* Right panels */}
        {simOpen && (
          <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Vote shares · D'Hondt · No threshold</p>
              </div>
              <button onClick={() => setSimOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
              {([...SA_PARTIES] as SaParty[]).sort((a, b) => (natPcts[b.id]??0) - (natPcts[a.id]??0)).map((party: SaParty) => {
                const pct = natPcts[party.id] ?? 0; const isLocked = locks.has(party.id); const color = partyColor(party.id);
                return (
                  <div key={party.id}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:color }} />
                      <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                      <button onClick={() => setLocks(prev => { const n = new Set(prev); n.has(party.id) ? n.delete(party.id) : n.add(party.id); return n; })}
                        className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`} title={isLocked?'Unlock':'Lock'}>
                        {isLocked
                          ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                          : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                        }
                      </button>
                    </div>
                    <input type="range" min={0} max={60} step={0.1} value={pct} disabled={isLocked}
                      onChange={e => { setNatPcts(redistributePcts(natPcts, party.id, parseFloat(e.target.value), locks)); setPreset('custom'); }}
                      className="br-party-slider w-full"
                      style={{ '--party-color': color, '--pct': `${(pct/60)*100}%` } as React.CSSProperties} />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[8px] font-mono text-ink-3">{party.name}</span>
                      <span className="text-[8.5px] font-mono tabular-nums text-ink-3">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button disabled={simRunning} onClick={() => {
                stopSim(); natPctsAtSimStart.current = { ...natPcts };
                const allProvs = [...SA_PROVINCES].sort(() => Math.random() - 0.5);
                const NCHUNKS = SA_PROVINCES.length;
                const chunkTimes = saBellCurveTimes(NCHUNKS, 10_000);
                setSimRunning(true); setSimProgress(0); setSimSeats(undefined); setDeclaredProvs(new Set());
                let declared = new Set<SaProvId>();
                const timers: ReturnType<typeof setTimeout>[] = [];
                for (let ci = 0; ci < NCHUNKS; ci++) {
                  const prov = allProvs[ci]; const t = chunkTimes[ci];
                  timers.push(setTimeout(() => {
                    declared = new Set(declared); declared.add(prov.id);
                    setDeclaredProvs(new Set(declared)); setSimProgress(declared.size);
                    setSimSeats(calcPartialSeats(natPctsAtSimStart.current, declared));
                    if (declared.size >= SA_PROVINCES.length) { setSimSeats(calcSeats(natPctsAtSimStart.current)); setSimRunning(false); }
                  }, t));
                }
                simTimersRef.current = timers;
              }}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {simRunning ? `${simProgress}/${SA_PROVINCES.length} provinces reporting…` : '▶ Run Simulation'}
              </button>
              {(simSeats || declaredProvs) && (
                <button onClick={resetSim} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showCoal && !simOpen && <SaCoalitionPanel seats={displaySeats} onClose={() => { setCoalitionOpen(false); triggerExit('coal'); }} exiting={exitPanel==='coal'} dark={dark} />}
        {showProv && selectedProv && !simOpen && !showCoal && (
          <SaProvPanel provId={selectedProv} natPcts={natPcts}
            onUpdate={(id, pcts) => setProvOverrides(prev => ({ ...prev, [id]: pcts }))}
            onClose={() => setSelectedProv(null)} dark={dark}
            override={provOverrides[selectedProv]} />
        )}
        {showTutorial && !simOpen && !showCoal && <SaTutorialPanel onClose={() => { setTutorialOpen(false); triggerExit('tutorial'); }} exiting={exitPanel==='tutorial'} dark={dark} />}
      </div>
    </div>
  );
}
