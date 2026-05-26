import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ────────────────────────────────────────────────────────────────
type ItPartyId = 'FDI' | 'PD' | 'M5S' | 'LEGA' | 'FI' | 'AZ' | 'AVS' | 'IV' | 'NM';

type ItParty = {
  id: ItPartyId;
  name: string;
  fullName: string;
  color: string;
  seats2022: number;
  leader: string;
  wikiTitle?: string;
};

const IT_PARTIES: ItParty[] = [
  { id: 'FDI',  name: 'FdI',    fullName: 'Fratelli d\'Italia',        color: '#1B3A6B', seats2022: 119, leader: 'Giorgia Meloni',      wikiTitle: 'Giorgia_Meloni' },
  { id: 'PD',   name: 'PD',     fullName: 'Partito Democratico',       color: '#CC0000', seats2022:  69, leader: 'Elly Schlein',         wikiTitle: 'Elly_Schlein' },
  { id: 'M5S',  name: 'M5S',    fullName: 'Movimento 5 Stelle',        color: '#D4A013', seats2022:  52, leader: 'Giuseppe Conte',       wikiTitle: 'Giuseppe_Conte' },
  { id: 'LEGA', name: 'Lega',   fullName: 'Lega',                      color: '#009933', seats2022:  30, leader: 'Matteo Salvini',       wikiTitle: 'Matteo_Salvini' },
  { id: 'FI',   name: 'FI',     fullName: 'Forza Italia',              color: '#0080C8', seats2022:  29, leader: 'Antonio Tajani',       wikiTitle: 'Antonio_Tajani' },
  { id: 'AZ',   name: 'Azione', fullName: 'Azione',                    color: '#CC5500', seats2022:  13, leader: 'Carlo Calenda',        wikiTitle: 'Carlo_Calenda' },
  { id: 'AVS',  name: 'AVS',    fullName: 'Alleanza Verdi-Sinistra',   color: '#2E7D32', seats2022:  12, leader: 'Nicola Fratoianni',    wikiTitle: 'Nicola_Fratoianni' },
  { id: 'IV',   name: 'IV',     fullName: 'Italia Viva',               color: '#EF233C', seats2022:   9, leader: 'Matteo Renzi',         wikiTitle: 'Matteo_Renzi' },
  { id: 'NM',   name: 'Noi Mod',fullName: 'Noi Moderati',              color: '#795548', seats2022:   7, leader: 'Maurizio Lupi',        wikiTitle: 'Maurizio_Lupi' },
];

const IT_PARTY_MAP = Object.fromEntries(IT_PARTIES.map(p => [p.id, p])) as Record<ItPartyId, ItParty>;
const IT_TOTAL_SEATS = 400;
const IT_MAJORITY = 201;
const IT_THRESHOLD = 4.0; // % — parties below this get no proportional seats

// 2022 national vote percentages (normalised from actual results, summing to 100)
const IT_VOTE_PCT_2022: Record<ItPartyId, number> = {
  FDI: 29.0, PD: 21.3, M5S: 17.1, LEGA: 9.8, FI: 9.0, AZ: 5.1, AVS: 4.1, IV: 3.5, NM: 1.1,
};

// Approximate raw votes — Camera proporzionale, 2022
const IT_VOTE_RAW_2022: Record<ItPartyId, number> = {
  FDI:  7_291_000, PD:   5_392_000, M5S:  4_345_000,
  LEGA: 2_463_000, FI:   2_279_000, AZ:   1_302_000,
  AVS:  1_024_000, IV:     855_000, NM:     315_000,
};
const IT_GRAND_TOTAL_VOTES = 25_266_000;

// 2024 European Parliament (normalised) — alternative scenario preset
const IT_VOTE_PCT_2024E: Record<ItPartyId, number> = {
  FDI: 29.7, PD: 24.7, M5S: 10.3, LEGA: 9.2, FI: 9.9, AZ: 3.5, AVS: 7.0, IV: 3.4, NM: 2.3,
};

// ── Region types ───────────────────────────────────────────────────────────────
type ItRegionId = 'PIE'|'VDA'|'LOM'|'TAA'|'VEN'|'FVG'|'LIG'|'EMR'|'TOS'|'UMB'
                |'MAR'|'LAZ'|'ABR'|'MOL'|'CAM'|'PUG'|'BAS'|'CAL'|'SIC'|'SAR';

type ItRegion = { id: ItRegionId; name: string; pop: number };

const IT_REGIONS: ItRegion[] = [
  { id: 'PIE', name: 'Piemonte',             pop: 4_335_000 },
  { id: 'VDA', name: "Valle d'Aosta",        pop:   126_000 },
  { id: 'LOM', name: 'Lombardia',            pop: 10_017_000 },
  { id: 'TAA', name: 'Trentino-A.A.',        pop: 1_079_000 },
  { id: 'VEN', name: 'Veneto',               pop: 4_905_000 },
  { id: 'FVG', name: 'Friuli-V.G.',          pop: 1_211_000 },
  { id: 'LIG', name: 'Liguria',              pop: 1_524_000 },
  { id: 'EMR', name: 'Emilia-Romagna',       pop: 4_453_000 },
  { id: 'TOS', name: 'Toscana',              pop: 3_692_000 },
  { id: 'UMB', name: 'Umbria',               pop:   882_000 },
  { id: 'MAR', name: 'Marche',               pop: 1_525_000 },
  { id: 'LAZ', name: 'Lazio',               pop: 5_736_000 },
  { id: 'ABR', name: 'Abruzzo',              pop: 1_295_000 },
  { id: 'MOL', name: 'Molise',               pop:   305_000 },
  { id: 'CAM', name: 'Campania',             pop: 5_712_000 },
  { id: 'PUG', name: 'Puglia',              pop: 3_953_000 },
  { id: 'BAS', name: 'Basilicata',           pop:   553_000 },
  { id: 'CAL', name: 'Calabria',             pop: 1_894_000 },
  { id: 'SIC', name: 'Sicilia',              pop: 4_875_000 },
  { id: 'SAR', name: 'Sardegna',             pop: 1_611_000 },
];
const IT_REGION_MAP = Object.fromEntries(IT_REGIONS.map(r => [r.id, r])) as Record<ItRegionId, ItRegion>;

// GeoJSON `reg_name` → region ID
const IT_REGNAME_TO_ID: Record<string, ItRegionId> = {
  'Piemonte': 'PIE',                          "Valle d'Aosta/Vallée d'Aoste": 'VDA',
  'Lombardia': 'LOM',                         'Trentino-Alto Adige/Südtirol': 'TAA',
  'Veneto': 'VEN',                            'Friuli-Venezia Giulia': 'FVG',
  'Liguria': 'LIG',                           'Emilia-Romagna': 'EMR',
  'Toscana': 'TOS',                           'Umbria': 'UMB',
  'Marche': 'MAR',                            'Lazio': 'LAZ',
  'Abruzzo': 'ABR',                           'Molise': 'MOL',
  'Campania': 'CAM',                          'Puglia': 'PUG',
  'Basilicata': 'BAS',                        'Calabria': 'CAL',
  'Sicilia': 'SIC',                           'Sardegna': 'SAR',
};

// ── 2022 regional results (% by region, summing to 100 per region) ─────────────
const IT_REGION_RESULTS_2022: Record<ItRegionId, Record<ItPartyId, number>> = {
  PIE: { FDI:27, PD:20, M5S:14, LEGA:12, FI: 9, AZ:6, AVS:5, IV:5, NM:2 },
  VDA: { FDI:22, PD:22, M5S:12, LEGA:14, FI: 8, AZ:9, AVS:8, IV:4, NM:1 },
  LOM: { FDI:27, PD:19, M5S:11, LEGA:14, FI:10, AZ:7, AVS:5, IV:5, NM:2 },
  TAA: { FDI:22, PD:18, M5S:10, LEGA:11, FI: 8, AZ:11,AVS:12,IV:6, NM:2 },
  VEN: { FDI:27, PD:16, M5S:11, LEGA:15, FI:11, AZ:7, AVS:5, IV:5, NM:3 },
  FVG: { FDI:29, PD:17, M5S:11, LEGA:11, FI:10, AZ:9, AVS:6, IV:5, NM:2 },
  LIG: { FDI:28, PD:21, M5S:16, LEGA:10, FI: 9, AZ:6, AVS:5, IV:4, NM:1 },
  EMR: { FDI:22, PD:28, M5S:13, LEGA:12, FI: 7, AZ:7, AVS:6, IV:4, NM:1 },
  TOS: { FDI:22, PD:26, M5S:13, LEGA: 9, FI: 8, AZ:8, AVS:8, IV:5, NM:1 },
  UMB: { FDI:28, PD:21, M5S:15, LEGA:11, FI: 9, AZ:6, AVS:5, IV:4, NM:1 },
  MAR: { FDI:30, PD:20, M5S:15, LEGA:10, FI: 9, AZ:6, AVS:5, IV:4, NM:1 },
  LAZ: { FDI:33, PD:19, M5S:17, LEGA: 8, FI: 9, AZ:6, AVS:4, IV:3, NM:1 },
  ABR: { FDI:29, PD:18, M5S:18, LEGA: 9, FI: 9, AZ:6, AVS:5, IV:4, NM:2 },
  MOL: { FDI:28, PD:15, M5S:22, LEGA: 8, FI:11, AZ:5, AVS:4, IV:5, NM:2 },
  CAM: { FDI:20, PD:18, M5S:28, LEGA: 5, FI:10, AZ:6, AVS:5, IV:6, NM:2 },
  PUG: { FDI:25, PD:19, M5S:24, LEGA: 6, FI: 9, AZ:6, AVS:5, IV:5, NM:1 },
  BAS: { FDI:32, PD:16, M5S:18, LEGA: 8, FI:10, AZ:5, AVS:5, IV:4, NM:2 },
  CAL: { FDI:30, PD:14, M5S:19, LEGA: 7, FI:12, AZ:5, AVS:5, IV:6, NM:2 },
  SIC: { FDI:27, PD:15, M5S:26, LEGA: 7, FI:10, AZ:5, AVS:4, IV:4, NM:2 },
  SAR: { FDI:22, PD:20, M5S:22, LEGA: 8, FI: 8, AZ:7, AVS:6, IV:5, NM:2 },
};

// ── Seat allocation: D'Hondt with 4% threshold ─────────────────────────────────
function calcSeats(
  votePcts: Partial<Record<ItPartyId, number>>,
  totalSeats = IT_TOTAL_SEATS,
  threshold = IT_THRESHOLD,
): Partial<Record<ItPartyId, number>> {
  const qualifying: Partial<Record<ItPartyId, number>> = {};
  let qualSum = 0;
  for (const [id, v] of Object.entries(votePcts) as [ItPartyId, number][]) {
    if ((v ?? 0) >= threshold) { qualifying[id] = v; qualSum += v; }
  }
  if (qualSum === 0) return {};
  const quotients: { id: ItPartyId; q: number }[] = [];
  for (const [id, v] of Object.entries(qualifying) as [ItPartyId, number][]) {
    for (let d = 1; d <= totalSeats; d++) quotients.push({ id, q: v / d });
  }
  quotients.sort((a, b) => b.q - a.q);
  const seats: Partial<Record<ItPartyId, number>> = {};
  for (let i = 0; i < Math.min(totalSeats, quotients.length); i++) {
    seats[quotients[i].id] = (seats[quotients[i].id] ?? 0) + 1;
  }
  return seats;
}

// Partial simulation: weight seats by declared region populations
function calcPartialSeats(
  natPcts: Record<ItPartyId, number>,
  declaredRegions: Set<ItRegionId>,
): Partial<Record<ItPartyId, number>> {
  if (declaredRegions.size === 0) return {};
  const weighted: Partial<Record<ItPartyId, number>> = {};
  let totalPop = 0;
  for (const regId of declaredRegions) {
    const reg = IT_REGION_MAP[regId];
    if (!reg) continue;
    const rv = calcRegionVotes(natPcts, regId);
    for (const p of IT_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (rv[p.id] ?? 0) * reg.pop;
    totalPop += reg.pop;
  }
  if (totalPop === 0) return {};
  const norm: Partial<Record<ItPartyId, number>> = {};
  for (const p of IT_PARTIES) norm[p.id] = (weighted[p.id] ?? 0) / totalPop;
  return calcSeats(norm);
}

// Uniform national swing model for regional vote estimates
function calcRegionVotes(
  natPcts: Record<ItPartyId, number>,
  regId: ItRegionId,
): Record<ItPartyId, number> {
  const base = IT_REGION_RESULTS_2022[regId];
  const raw: Record<ItPartyId, number> = {} as Record<ItPartyId, number>;
  let total = 0;
  for (const p of IT_PARTIES) {
    const swing = (natPcts[p.id] ?? 0) - (IT_VOTE_PCT_2022[p.id] ?? 0);
    const v = Math.max(0, (base[p.id] ?? 0) + swing);
    raw[p.id] = v; total += v;
  }
  if (total === 0) return raw;
  for (const p of IT_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

// Redistribute pcts proportionally when one slider changes
function redistributePcts(
  current: Record<ItPartyId, number>,
  changedId: ItPartyId,
  newRaw: number,
  locks: Set<ItPartyId>,
): Record<ItPartyId, number> {
  const ids = Object.keys(current) as ItPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<ItPartyId, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  else if (unlocked.length > 0) for (const id of unlocked) next[id] = remaining / unlocked.length;
  return next;
}

// ── Map colour ─────────────────────────────────────────────────────────────────
function partyColor(id: ItPartyId): string { return IT_PARTY_MAP[id]?.color ?? '#888'; }

function getRegionFill(natPcts: Record<ItPartyId, number>, regId: ItRegionId, dark: boolean, overrides?: Record<string, Record<ItPartyId, number>>): string {
  const rv = overrides?.[regId] ?? calcRegionVotes(natPcts, regId);
  const sorted = (Object.entries(rv) as [ItPartyId, number][]).sort(([, a], [, b]) => b - a);
  if (!sorted.length) return dark ? '#374151' : '#E5E7EB';
  const [winner, winPct] = sorted[0];
  const runnerUp = sorted[1]?.[1] ?? 0;
  const t = Math.min(Math.max((winPct - runnerUp) / 25, 0), 1);
  const c = hsl(partyColor(winner));
  c.l = dark ? 0.52 - t * 0.28 : 0.80 - t * 0.44;
  return c.formatHex();
}

// ── Bell-curve simulation timing ───────────────────────────────────────────────
function itRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random(); while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function itBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () => Math.max(0.02, Math.min(0.98, 0.5 + itRandNormal() * 0.18)))
    .sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

// ── Helpers ────────────────────────────────────────────────────────────────────
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

// ── Tooltip type ───────────────────────────────────────────────────────────────
type RegTooltipState = {
  x: number; y: number; name: string;
  parties: { id: ItPartyId; pct: number }[];
  leader: ItPartyId | null;
} | null;

// ── Political left → right order for hemicycle ────────────────────────────────
const IT_LR_ORDER: ItPartyId[] = ['AVS','PD','M5S','IV','AZ','NM','FI','LEGA','FDI'];

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function ItScoreboardTile({ partyId, seats, pct, rawVotes, belowThreshold, isLeader, isWinner, dark: _dark }: {
  partyId: ItPartyId; seats: number; pct: number; rawVotes: number;
  belowThreshold: boolean; isLeader: boolean; isWinner: boolean; dark?: boolean;
}) {
  const party = IT_PARTY_MAP[partyId];
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
      style={{
        '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: (isLeader || isWinner) ? color : hexToRgba(color, belowThreshold ? 0.18 : 0.30),
        opacity: belowThreshold ? 0.55 : 1,
      } as React.CSSProperties}
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
        {belowThreshold && (
          <span style={{ position:'absolute', bottom:2, right:2, fontSize:8, background:'rgba(0,0,0,0.45)', color:'#fff', borderRadius:2, padding:'0 2px', fontFamily:'monospace' }}>
            &lt;4%
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
        <div style={{ height:'100%', borderRadius:2, background:color, width:`${Math.min(pct/35*100,100)}%`, transition:'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────────
function ItScoreboard({ natPcts, simSeats, isBaseline, dark }: {
  natPcts: Record<ItPartyId, number>;
  simSeats?: Partial<Record<ItPartyId, number>>;
  isBaseline?: boolean;
  dark?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault(); el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const seats = useMemo(() => simSeats ?? calcSeats(natPcts), [simSeats, natPcts]);
  const pctTotal = Object.values(natPcts).reduce((s, v) => s + (v ?? 0), 0);

  const sorted = useMemo(
    () => IT_PARTIES
      .filter(p => (seats[p.id] ?? 0) > 0 || (natPcts[p.id] ?? 0) > 0)
      .sort((a, b) => (seats[b.id] ?? 0) - (seats[a.id] ?? 0) || (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)),
    [seats, natPcts],
  );

  const leader = sorted[0]?.id ?? null;
  const winner = leader && (seats[leader] ?? 0) >= IT_MAJORITY ? leader : null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {sorted.map(party => {
            const s = seats[party.id] ?? 0;
            const pct = pctTotal > 0 ? (natPcts[party.id] ?? 0) / pctTotal * 100 : 0;
            const rawVotes = isBaseline
              ? IT_VOTE_RAW_2022[party.id]
              : Math.round((natPcts[party.id] ?? 0) / 100 * IT_GRAND_TOTAL_VOTES);
            const belowThreshold = (natPcts[party.id] ?? 0) < IT_THRESHOLD;
            return (
              <ItScoreboardTile key={party.id} partyId={party.id} seats={s} pct={pct}
                rawVotes={rawVotes} belowThreshold={belowThreshold}
                isLeader={party.id === leader && !winner} isWinner={party.id === winner}
                dark={dark} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Map controller ─────────────────────────────────────────────────────────────
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  useEffect(() => {
    const h = () => layerRef.current?.eachLayer((l: L.Layer) => { (l as any).options && ((l as any).options.smoothFactor = 0); });
    map.on('zoomend', h); return () => { map.off('zoomend', h); };
  }, [map, layerRef]);
  return null;
}

// ── Bubble overlay ─────────────────────────────────────────────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };
function zoomScale(zoom: number): number { return Math.max(0.40, Math.min(1.0, (zoom - 4) / (9 - 4))); }

function ItBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef, declaredRegions,
}: {
  geoData: any; natPcts: Record<ItPartyId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: RegTooltipState) => void;
  onSelect: (id: ItRegionId) => void;
  natPctsRef: React.MutableRefObject<Record<ItPartyId, number>>;
  declaredRegions?: Set<ItRegionId>;
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
      const regName: string = (layer as any).feature?.properties?.reg_name ?? '';
      const regId = IT_REGNAME_TO_ID[regName];
      if (!regId) return;
      if (declaredRegions && !declaredRegions.has(regId)) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();
      const rv = calcRegionVotes(natPcts, regId);
      const sorted = (Object.entries(rv) as [ItPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (!sorted.length) return;
      const [winId, winPct] = sorted[0];
      const margin = winPct - (sorted[1]?.[1] ?? 0);
      const baseRadius = 5 + Math.min(margin / 20, 1) * 14;
      const color = partyColor(winId);
      const marker = L.circleMarker(center, { radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1, opacity: 0.9 }).addTo(map);
      marker.on('click', () => { setTooltip(null); onSelect(regId); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cur = calcRegionVotes(natPctsRef.current, regId);
        const parties = (Object.entries(cur) as [ItPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5).map(([id, pct]) => ({ id, pct }));
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: regName, parties, leader: parties[0]?.id ?? null });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });
    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  }, [map, geoData, natPcts]);

  return null;
}

// ── Map view ───────────────────────────────────────────────────────────────────
function ItMapView({ natPcts, selectedRegion, onSelect, dark, bubbleMap, declaredRegions, overrides }: {
  natPcts: Record<ItPartyId, number>; selectedRegion: ItRegionId | null;
  onSelect: (id: ItRegionId) => void; dark: boolean; bubbleMap: boolean;
  declaredRegions?: Set<ItRegionId>;
  overrides?: Record<string, Record<ItPartyId, number>>;
}) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const layerRef        = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<RegTooltipState>(null);

  const natPctsRef      = useRef(natPcts);
  const selectedRef     = useRef(selectedRegion);
  const darkRef         = useRef(dark);
  const bubbleRef       = useRef(bubbleMap);
  const onSelectRef     = useRef(onSelect);
  const declaredRef     = useRef(declaredRegions);
  const overridesRef    = useRef(overrides);
  useEffect(() => { natPctsRef.current  = natPcts;       }, [natPcts]);
  useEffect(() => { selectedRef.current = selectedRegion; }, [selectedRegion]);
  useEffect(() => { darkRef.current     = dark;           }, [dark]);
  useEffect(() => { bubbleRef.current   = bubbleMap;      }, [bubbleMap]);
  useEffect(() => { onSelectRef.current = onSelect;       }, [onSelect]);
  useEffect(() => { declaredRef.current = declaredRegions; }, [declaredRegions]);
  useEffect(() => { overridesRef.current = overrides;     }, [overrides]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}italy-regions.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const regName: string = feature?.properties?.reg_name ?? '';
    const regId = IT_REGNAME_TO_ID[regName];
    const isSelected = regId === selectedRef.current;
    const borderColor = darkRef.current ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';
    if (bubbleRef.current) return { fillOpacity:0, weight:0.4, color: darkRef.current ? 'rgba(255,255,255,0.18)':'rgba(0,0,0,0.18)', opacity:0.6 };
    if (!regId) return { fillColor: darkRef.current?'#374151':'#E5E7EB', fillOpacity:0.5, weight:0.4, color:borderColor, opacity:1 };
    const isDeclared = !declaredRef.current || declaredRef.current.has(regId);
    if (!isDeclared) return { fillColor: darkRef.current?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:0.4, color:borderColor, opacity:1 };
    const fill = getRegionFill(natPctsRef.current, regId, darkRef.current, overridesRef.current);
    return { fillColor:fill, fillOpacity:0.80, weight: isSelected?2:0.5, color: isSelected?'#c8a020':borderColor, opacity:1 };
  }, []);

  useEffect(() => { layerRef.current?.setStyle((f: any) => getStyle(f)); }, [natPcts, selectedRegion, dark, bubbleMap, declaredRegions, overrides, getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const regName: string = feature?.properties?.reg_name ?? '';
    const regId = IT_REGNAME_TO_ID[regName];
    layer.on('click', () => { if (regId) onSelectRef.current(regId); });
    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleRef.current || !regId) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rv = calcRegionVotes(natPctsRef.current, regId);
      const parties = (Object.entries(rv) as [ItPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5).map(([id, pct]) => ({ id, pct }));
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: regName, parties, leader: parties[0]?.id ?? null });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[42.5, 12.5]} zoom={6} minZoom={5} maxZoom={13}
        style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
        <TileLayer key={dark?'dark':'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd" updateWhenZooming={false} updateWhenIdle maxZoom={20} />
        <MapController layerRef={layerRef} />
        {geoData && <GeoJSON ref={layerRef as any} data={geoData} style={(f:any)=>getStyle(f)} onEachFeature={onEachFeature} {...({smoothFactor:0} as any)} />}
        {geoData && bubbleMap && <ItBubbleLayer geoData={geoData} natPcts={natPcts} containerRef={containerRef}
          setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef} declaredRegions={declaredRegions} />}
      </MapContainer>
      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 220; const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = { bg: dark?'rgba(18,24,44,0.96)':'rgba(255,255,255,0.97)', border: dark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.08)',
          shadow: dark?'0 6px 28px rgba(0,0,0,0.5)':'0 6px 28px rgba(0,0,0,0.12)',
          title: dark?'rgba(255,255,255,0.92)':'rgba(0,0,0,0.85)', body: dark?'rgba(255,255,255,0.85)':'rgba(0,0,0,0.78)' };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', padding:'12px 14px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:tt.title }}>{tooltip.name}</div>
              <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color: dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.42)', marginTop:2 }}>Est. regional result</div>
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
                {tooltip.parties.map(({ id, pct }, i) => {
                  const pColor = partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <span style={{ width:8, height:8, borderRadius:2, flexShrink:0, background:pColor }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{IT_PARTY_MAP[id]?.name ?? id}</span>
                      <span style={{ fontSize:12, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:pColor }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click to open</div>
    </div>
  );
}

// ── Region breakdown panel (editable) ─────────────────────────────────────────
function ItRegionPanel({ regId, natPcts, onUpdate, onClose, dark, override }: {
  regId: ItRegionId; natPcts: Record<ItPartyId, number>;
  onUpdate: (id: ItRegionId, pcts: Record<ItPartyId, number>) => void;
  onClose: () => void; dark?: boolean;
  override?: Record<ItPartyId, number>;
}) {
  const initPcts = () => {
    if (override) return { ...override };
    const rv = calcRegionVotes(natPcts, regId);
    return Object.fromEntries(IT_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<ItPartyId, number>;
  };
  const [pcts, setPcts] = useState<Record<ItPartyId, number>>(initPcts);
  const [panelLocks, setPanelLocks] = useState<Set<ItPartyId>>(new Set());
  const [editId, setEditId] = useState<ItPartyId | null>(null);
  const [editVal, setEditVal] = useState('');
  const pctsRef = useRef(pcts);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);

  useEffect(() => {
    if (override) setPcts({ ...override });
    else {
      const rv = calcRegionVotes(natPcts, regId);
      setPcts(Object.fromEntries(IT_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<ItPartyId, number>);
    }
    setPanelLocks(new Set()); setEditId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regId]);

  function applyChange(id: ItPartyId, val: number) {
    const next = redistributePcts(pctsRef.current, id, val, panelLocks);
    pctsRef.current = next; setPcts(next); onUpdate(regId, next);
  }
  function commitEdit(id: ItPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  const sorted = useMemo(() => IT_PARTIES.map(p => ({ ...p, pct: pcts[p.id] ?? 0 })).sort((a, b) => b.pct - a.pct), [pcts]);
  const reg = IT_REGION_MAP[regId]; const winner = sorted[0];
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{reg?.name ?? regId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{override ? 'Custom result · click % to edit' : 'Estimated result · click % to edit'}</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] border border-default" style={{ borderColor:`${winner.color}33` }}>
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
                {pct < IT_THRESHOLD && pct > 0 && <span className="text-[7px] font-mono text-red-400 shrink-0">&lt;4%</span>}
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
              <input type="range" min={0} max={60} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(p.id, parseFloat(e.target.value))}
                className="br-party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${(pct/60)*100}%` } as React.CSSProperties} />
            </div>
          );
        })}
        <div className="pt-2 border-t border-default space-y-2">
          <div>
            <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mb-1">Population (2022 approx.)</div>
            <div className="text-[11px] font-mono font-semibold text-ink">{reg?.pop.toLocaleString()}</div>
          </div>
          {override && (
            <button onClick={() => {
              const rv = calcRegionVotes(natPcts, regId);
              const reset = Object.fromEntries(IT_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<ItPartyId, number>;
              setPcts(reset); setPanelLocks(new Set()); onUpdate(regId, reset);
            }} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Reset to Estimate
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Parliament hemicycle panel ─────────────────────────────────────────────────
function ItParliamentPanel({ seats: seatsMap, onClose, exiting, dark }: { seats: Partial<Record<ItPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const seatColors: string[] = [];
  const legend: { id: ItPartyId; count: number; color: string }[] = [];
  for (const id of IT_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n === 0) continue;
    const color = partyColor(id);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;
  const W = 310, H = 180, cx = W/2, cy = H - 4, innerR = 52, rowSpacing = 9, rows = 6;
  const arcLengths = Array.from({ length: rows }, (_, i) => Math.PI * (innerR + i * rowSpacing));
  const totalArc = arcLengths.reduce((s, v) => s + v, 0);
  const floors = arcLengths.map(a => Math.floor((a / totalArc) * IT_TOTAL_SEATS));
  const remainder = IT_TOTAL_SEATS - floors.reduce((s, v) => s + v, 0);
  arcLengths.map((a, i) => ({ i, frac: (a/totalArc)*IT_TOTAL_SEATS - floors[i] }))
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
          <h2 className="text-[13px] font-bold text-ink leading-none">Camera dei Deputati</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {IT_MAJORITY} · threshold 4%</div>
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
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{IT_PARTY_MAP[id].name}</span>
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

// ── Coalition builder panel ────────────────────────────────────────────────────
const IT_PRESET_COALITIONS: { name: string; emoji: string; parties: ItPartyId[] }[] = [
  { name: 'Governo Meloni',  emoji: '🇮🇹', parties: ['FDI','LEGA','FI','NM'] },
  { name: 'Campo Largo',     emoji: '🌹', parties: ['PD','M5S','AVS','IV'] },
  { name: 'Centro',          emoji: '⚖️', parties: ['AZ','IV','NM','FI'] },
  { name: 'Tutti vs FdI',    emoji: '🤝', parties: ['PD','M5S','AVS','IV','AZ'] },
];

function ItCoalitionPanel({ seats, onClose, exiting, dark }: { seats: Partial<Record<ItPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const [selected, setSelected] = useState<Set<ItPartyId>>(new Set(['FDI','LEGA','FI','NM']));
  const toggle = (id: ItPartyId) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalCoalSeats = [...selected].reduce((s, id) => s + (seats[id] ?? 0), 0);
  const hasMajority = totalCoalSeats >= IT_MAJORITY;
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {IT_MAJORITY} seats · {IT_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      {/* Presets */}
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {IT_PRESET_COALITIONS.map(coal => (
            <button key={coal.name} onClick={() => setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id => IT_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Party toggles */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {IT_LR_ORDER.map(id => {
            const party = IT_PARTY_MAP[id]; const s = seats[id] ?? 0;
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

      {/* Coalition total */}
      <div className={`px-3.5 py-3 border-t border-default shrink-0 ${hasMajority ? 'bg-emerald-500/10' : ''}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold text-ink">Coalition total</span>
          <span className="text-[20px] font-black font-mono" style={{ color: hasMajority ? '#16a34a' : '#ef4444' }}>{totalCoalSeats}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-black/8 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300" style={{ width:`${Math.min(totalCoalSeats/IT_TOTAL_SEATS*100, 100)}%`, background: hasMajority ? '#16a34a' : '#ef4444' }} />
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority ? 'text-emerald-600' : 'text-red-500'}`}>
          {hasMajority ? `✓ MAJORITY (need ${IT_MAJORITY})` : `✗ ${IT_MAJORITY - totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Tutorial panel ─────────────────────────────────────────────────────────────
function ItTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>;
  const P  = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>;
  const Note = ({ children }: { children: React.ReactNode }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Italian Elections Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>The Rosatellum</H2>
        <P>Italy uses a <strong>mixed electoral system</strong> (Rosatellum bis, 2017). 36% of Camera seats are won by FPTP in single-member constituencies; 64% by proportional party lists.</P>
        <Note>This simulator models a <strong>simplified proportional</strong> version with a 4% threshold — parties below this get <strong>zero seats</strong>. Real FPTP bonus seats are not modelled.</Note>
        <H2>Camera dei Deputati</H2>
        <P>The lower house has <strong>400 seats</strong> (reduced in 2022 from 630). A majority requires <strong>201 seats</strong>. Elections are held every 5 years.</P>
        <H2>4% Threshold</H2>
        <P>Individual parties need at least <strong>4%</strong> nationally to receive proportional seats. In the scoreboard, parties below this threshold appear faded with a "&lt;4%" badge.</P>
        <H2>Italian Coalitions</H2>
        <P>Italian politics revolves around coalitions. The current government is the <strong>Governo Meloni</strong> (FdI + Lega + FI + Noi Moderati). The centre-left opposes with PD + M5S + AVS.</P>
        <H2>Simulation</H2>
        <P>Click <strong>▶ Simulation</strong> to adjust vote shares. Regions declare one by one, with partial seat counts live-updating.</P>
        <H2>Coalition Builder</H2>
        <P>Click <strong>Coalition</strong> to open the builder. Toggle parties to see if they can command a 201-seat majority.</P>
      </div>
    </aside>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────
export default function ItalyApp() {
  const navigate = useNavigate();

  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  const [preset, setPreset]   = useState<'baseline'|'poll2024'|'blank'|'custom'>('baseline');
  const [natPcts, setNatPcts] = useState<Record<ItPartyId, number>>(() => ({ ...IT_VOTE_PCT_2022 }));

  function loadBaseline() { setNatPcts({ ...IT_VOTE_PCT_2022 }); setPreset('baseline'); resetSim(); }
  function loadPoll2024()  { setNatPcts({ ...IT_VOTE_PCT_2024E }); setPreset('poll2024'); resetSim(); }
  function loadBlank()     { setNatPcts(Object.fromEntries(IT_PARTIES.map(p => [p.id, 100/IT_PARTIES.length])) as Record<ItPartyId, number>); setPreset('blank'); resetSim(); }

  const [selectedRegion, setSelectedRegion]     = useState<ItRegionId | null>(null);
  const [regionOverrides, setRegionOverrides]   = useState<Record<string, Record<ItPartyId, number>>>({});
  const [bubbleMap, setBubbleMap]               = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [locks, setLocks]                         = useState<Set<ItPartyId>>(new Set());
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

  const [simSeats, setSimSeats]             = useState<Partial<Record<ItPartyId, number>> | undefined>();
  const [simProgress, setSimProgress]       = useState(0);
  const [simRunning, setSimRunning]         = useState(false);
  const [declaredRegions, setDeclaredRegions] = useState<Set<ItRegionId> | undefined>();
  const simTimersRef      = useRef<ReturnType<typeof setTimeout>[]>([]);
  const natPctsAtSimStart = useRef<Record<ItPartyId, number>>(natPcts);

  function stopSim() { simTimersRef.current.forEach(clearTimeout); simTimersRef.current = []; setSimRunning(false); }
  function resetSim() { stopSim(); setSimSeats(undefined); setDeclaredRegions(undefined); setSimProgress(0); }

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

  const showRegion   = !!selectedRegion && !simOpen;
  const showTutorial = tutorialOpen  || exitPanel === 'tutorial';
  const showParli    = parliOpen     || exitPanel === 'parli';
  const showCoal     = coalitionOpen || exitPanel === 'coal';

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="it">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={loadBaseline} className={preset==='baseline' ? btnGold : btnMuted}>2022 Results</button>
          <button onClick={loadPoll2024} className={preset==='poll2024' ? btnGold : btnMuted}>2024 Europee</button>
          <button onClick={loadBlank}   className={preset==='blank'    ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => setSimOpen(v => !v)} className={simOpen ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => setBubbleMap(v => !v)} className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnMuted}>Bubble Map</button>
          <button onClick={() => setScoreboardVisible(v => !v)} className={scoreboardVisible ? btnActive : btnMuted}>Scoreboard</button>
          <button onClick={() => { if (parliOpen) { setParliOpen(false); triggerExit('parli'); } else { setParliOpen(true); setCoalitionOpen(false); } }} className={parliOpen ? btnActive : btnMuted}>Parliament</button>
          <button onClick={() => { if (coalitionOpen) { setCoalitionOpen(false); triggerExit('coal'); } else { setCoalitionOpen(true); setParliOpen(false); } }} className={coalitionOpen ? btnActive : btnMuted}>Coalition</button>
          <button onClick={() => { if (tutorialOpen) { setTutorialOpen(false); triggerExit('tutorial'); } else setTutorialOpen(true); }} className={tutorialOpen ? btnActive : btnMuted}>Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors">{dark ? '☀' : '☾'}</button>
        </div>
      </header>

      {/* ── Scoreboard ─────────────────────────────────────────────────────── */}
      {scoreboardVisible && <ItScoreboard natPcts={natPcts} simSeats={simSeats} isBaseline={preset==='baseline'} dark={dark} />}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Parliament — LEFT */}
        {showParli && <ItParliamentPanel seats={displaySeats} onClose={() => { setParliOpen(false); triggerExit('parli'); }} exiting={exitPanel==='parli'} dark={dark} />}

        {/* Map */}
        <ItMapView natPcts={natPcts} selectedRegion={selectedRegion}
          onSelect={id => setSelectedRegion(prev => prev === id ? null : id)}
          dark={dark} bubbleMap={bubbleMap} declaredRegions={declaredRegions} overrides={regionOverrides} />

        {/* Right panels — first match wins */}
        {simOpen && (
          <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Vote shares · D'Hondt · 4% threshold</p>
              </div>
              <button onClick={() => setSimOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
              {([...IT_PARTIES] as ItParty[]).sort((a, b) => (natPcts[b.id]??0) - (natPcts[a.id]??0)).map((party: ItParty) => {
                const pct = natPcts[party.id] ?? 0; const isLocked = locks.has(party.id); const color = partyColor(party.id);
                return (
                  <div key={party.id}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:color }} />
                      <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                      {pct < IT_THRESHOLD && pct > 0 && <span className="text-[7px] font-mono text-red-400">&lt;4%</span>}
                      <button onClick={() => setLocks(prev => { const n = new Set(prev); n.has(party.id) ? n.delete(party.id) : n.add(party.id); return n; })}
                        className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`} title={isLocked?'Unlock':'Lock'}>
                        {isLocked
                          ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                          : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                        }
                      </button>
                    </div>
                    <input type="range" min={0} max={50} step={0.1} value={pct} disabled={isLocked}
                      onChange={e => { setNatPcts(redistributePcts(natPcts, party.id, parseFloat(e.target.value), locks)); setPreset('custom'); }}
                      className="br-party-slider w-full"
                      style={{ '--party-color': color, '--pct': `${(pct/50)*100}%` } as React.CSSProperties} />
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
                const allRegs = [...IT_REGIONS].sort(() => Math.random() - 0.5);
                const NCHUNKS = 10; const chunkTimes = itBellCurveTimes(NCHUNKS, 12_000);
                const chunks: ItRegion[][] = Array.from({ length: NCHUNKS }, () => []);
                allRegs.forEach((r, i) => chunks[i % NCHUNKS].push(r));
                setSimRunning(true); setSimProgress(0); setSimSeats(undefined); setDeclaredRegions(new Set());
                let declared = new Set<ItRegionId>();
                const timers: ReturnType<typeof setTimeout>[] = [];
                for (let ci = 0; ci < NCHUNKS; ci++) {
                  const chunk = chunks[ci]; const t = chunkTimes[ci];
                  timers.push(setTimeout(() => {
                    for (const r of chunk) declared.add(r.id);
                    const snap = new Set(declared); setDeclaredRegions(snap); setSimProgress(snap.size);
                    setSimSeats(calcPartialSeats(natPctsAtSimStart.current, snap));
                    if (snap.size >= IT_REGIONS.length) { setSimSeats(calcSeats(natPctsAtSimStart.current)); setSimRunning(false); }
                  }, t));
                }
                simTimersRef.current = timers;
              }}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {simRunning ? `${simProgress}/${IT_REGIONS.length} regions reporting…` : '▶ Run Simulation'}
              </button>
              {(simSeats || declaredRegions) && (
                <button onClick={resetSim} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showCoal && !simOpen && <ItCoalitionPanel seats={displaySeats} onClose={() => { setCoalitionOpen(false); triggerExit('coal'); }} exiting={exitPanel==='coal'} dark={dark} />}
        {showRegion && selectedRegion && !simOpen && !showCoal && (
          <ItRegionPanel regId={selectedRegion} natPcts={natPcts}
            onUpdate={(id, pcts) => setRegionOverrides(prev => ({ ...prev, [id]: pcts }))}
            onClose={() => setSelectedRegion(null)} dark={dark}
            override={regionOverrides[selectedRegion]} />
        )}
        {showTutorial && !simOpen && !showCoal && <ItTutorialPanel onClose={() => { setTutorialOpen(false); triggerExit('tutorial'); }} exiting={exitPanel==='tutorial'} dark={dark} />}
      </div>
    </div>
  );
}
