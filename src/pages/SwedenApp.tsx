import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ───────────────────────────────────────────────────────────────
type SePartyId = 'S' | 'SD' | 'M' | 'C' | 'V' | 'KD' | 'L' | 'MP';

type SeParty = {
  id:             SePartyId;
  name:           string;
  fullName:       string;
  color:          string;
  seats2022:      number;
  leader:         string;   // 2022 baseline leader
  wikiTitle?:     string;
  leader2026?:    string;   // different from 2022 leader
  wikiTitle2026?: string;
};

const SE_PARTIES: SeParty[] = [
  { id: 'S',  name: 'S',  fullName: 'Social Democrats',    color: '#ED1B34', seats2022: 107,
    leader: 'Magdalena Andersson', wikiTitle: 'Magdalena_Andersson' },
  { id: 'SD', name: 'SD', fullName: 'Sweden Democrats',    color: '#EDB820', seats2022:  73,
    leader: 'Jimmie Åkesson',      wikiTitle: 'Jimmie_Åkesson' },
  { id: 'M',  name: 'M',  fullName: 'Moderate Party',      color: '#1B4F8A', seats2022:  68,
    leader: 'Ulf Kristersson',     wikiTitle: 'Ulf_Kristersson' },
  { id: 'V',  name: 'V',  fullName: 'Left Party',          color: '#C8101E', seats2022:  24,
    leader: 'Nooshi Dadgostar',    wikiTitle: 'Nooshi_Dadgostar' },
  { id: 'C',  name: 'C',  fullName: 'Centre Party',        color: '#009A44', seats2022:  24,
    leader: 'Annie Lööf',          wikiTitle: 'Annie_Lööf',
    leader2026: 'Muharrem Demirok', wikiTitle2026: 'Muharrem_Demirok' },
  { id: 'KD', name: 'KD', fullName: 'Christian Democrats', color: '#283593', seats2022:  19,
    leader: 'Ebba Busch',          wikiTitle: 'Ebba_Busch' },
  { id: 'MP', name: 'MP', fullName: 'Green Party',         color: '#53A330', seats2022:  18,
    leader: 'Märta Stenevi',       wikiTitle: 'Märta_Stenevi',
    leader2026: 'Daniel Helldén',  wikiTitle2026: 'Daniel_Helldén' },
  { id: 'L',  name: 'L',  fullName: 'Liberals',            color: '#5BA4CF', seats2022:  16,
    leader: 'Johan Pehrson',       wikiTitle: 'Johan_Pehrson' },
];

const SE_PARTY_MAP = Object.fromEntries(SE_PARTIES.map(p => [p.id, p])) as Record<SePartyId, SeParty>;
const SE_TOTAL_SEATS = 349;
const SE_MAJORITY    = 175;

// 2022 national results — source: Valmyndigheten (official final count)
const SE_VOTE_PCT_2022: Record<SePartyId, number> = {
  S: 30.33, SD: 20.54, M: 19.10, V: 6.75, C: 6.71, KD: 5.34, MP: 5.08, L: 4.72,
};
const SE_VOTE_RAW_2022: Record<SePartyId, number> = {
  S: 1_906_474, SD: 1_285_782, M: 1_197_898, V: 422_908,
  C:   420_415, KD:   334_614, MP:  318_255, L: 295_622,
};
const SE_GRAND_TOTAL_VOTES = 6_270_383;

// 2026 polling scenario — based on Demoskop/Novus polling averages 2025
// S leads, SD drops; V/L up; MP borderline
const SE_VOTE_PCT_2026: Record<SePartyId, number> = {
  S: 34.0, SD: 18.5, M: 17.0, V: 9.0, C: 5.5, KD: 5.0, MP: 4.0, L: 5.5,
};

// ── County types ───────────────────────────────────────────────────────────────
type SeCountyId =
  | 'SEAB' | 'SEAC' | 'SEBD' | 'SEC'  | 'SED'  | 'SEE'  | 'SEF'  | 'SEG'
  | 'SEH'  | 'SEI'  | 'SEK'  | 'SEM'  | 'SEN'  | 'SEO'  | 'SES'  | 'SET'
  | 'SEU'  | 'SEW'  | 'SEX'  | 'SEY'  | 'SEZ';

type SeCounty = { id: SeCountyId; name: string };

const SE_COUNTIES: SeCounty[] = [
  { id: 'SEAB', name: 'Stockholm'        }, { id: 'SEAC', name: 'Västerbotten'    },
  { id: 'SEBD', name: 'Norrbotten'       }, { id: 'SEC',  name: 'Uppsala'         },
  { id: 'SED',  name: 'Södermanland'     }, { id: 'SEE',  name: 'Östergötland'    },
  { id: 'SEF',  name: 'Jönköping'        }, { id: 'SEG',  name: 'Kronoberg'       },
  { id: 'SEH',  name: 'Kalmar'           }, { id: 'SEI',  name: 'Gotland'         },
  { id: 'SEK',  name: 'Blekinge'         }, { id: 'SEM',  name: 'Skåne'           },
  { id: 'SEN',  name: 'Halland'          }, { id: 'SEO',  name: 'Västra Götaland' },
  { id: 'SES',  name: 'Värmland'         }, { id: 'SET',  name: 'Örebro'          },
  { id: 'SEU',  name: 'Västmanland'      }, { id: 'SEW',  name: 'Dalarna'         },
  { id: 'SEX',  name: 'Gävleborg'        }, { id: 'SEY',  name: 'Västernorrland'  },
  { id: 'SEZ',  name: 'Jämtland'         },
];

const SE_GEOID_TO_ID: Record<string, SeCountyId> = {
  SEAB: 'SEAB', SEAC: 'SEAC', SEBD: 'SEBD', SEC: 'SEC',  SED: 'SED',
  SEE:  'SEE',  SEF:  'SEF',  SEG:  'SEG',  SEH: 'SEH',  SEI: 'SEI',
  SEK:  'SEK',  SEM:  'SEM',  SEN:  'SEN',  SEO: 'SEO',  SES: 'SES',
  SET:  'SET',  SEU:  'SEU',  SEW:  'SEW',  SEX: 'SEX',  SEY: 'SEY',
  SEZ:  'SEZ',
};

// ── Modified Sainte-Laguë — divisors 1.4, 3, 5, 7 … ; 4% national threshold ──
function calcSainteLague(
  votePcts: Partial<Record<SePartyId, number>>,
  totalSeats = SE_TOTAL_SEATS,
  threshold  = 4.0,
): Partial<Record<SePartyId, number>> {
  const qualifying = (Object.entries(votePcts) as [SePartyId, number][])
    .filter(([, v]) => (v ?? 0) >= threshold);
  if (qualifying.length === 0) return {};
  const quotients: { id: SePartyId; q: number }[] = [];
  for (const [id, v] of qualifying) {
    if (v <= 0) continue;
    for (let d = 0; d <= totalSeats; d++) {
      quotients.push({ id, q: v / (d === 0 ? 1.4 : 2 * d + 1) });
    }
  }
  quotients.sort((a, b) => b.q - a.q);
  const seats: Partial<Record<SePartyId, number>> = {};
  for (let i = 0; i < Math.min(totalSeats, quotients.length); i++) {
    seats[quotients[i].id] = (seats[quotients[i].id] ?? 0) + 1;
  }
  return seats;
}

// County electorate weights (% of national eligible voters, 2022)
const SE_COUNTY_WEIGHTS: Record<SeCountyId, number> = {
  SEAB: 23.5, SEAC:  2.7, SEBD:  2.5, SEC:   4.0, SED:   3.0,
  SEE:   4.5, SEF:   3.5, SEG:   1.9, SEH:   2.5, SEI:   0.7,
  SEK:   1.7, SEM:  12.0, SEN:   3.0, SEO:  16.5, SES:   2.8,
  SET:   3.2, SEU:   2.7, SEW:   2.8, SEX:   2.8, SEY:   2.4,
  SEZ:   1.3,
};
const SE_TOTAL_COUNTY_WEIGHT = Object.values(SE_COUNTY_WEIGHTS).reduce((s, v) => s + v, 0);

// Partial-result seats: weighted average of declared counties → Sainte-Laguë
function calcPartialSeats(
  natPcts:         Record<SePartyId, number>,
  countyFractions: Partial<Record<SeCountyId, number>>,
  countyOverrides?: Partial<Record<SeCountyId, Partial<Record<SePartyId, number>>>>,
): Partial<Record<SePartyId, number>> {
  const entries = Object.entries(countyFractions) as [SeCountyId, number][];
  if (entries.length === 0) return {};
  const weighted: Partial<Record<SePartyId, number>> = {};
  let totalW = 0;
  for (const [cId, fraction] of entries) {
    if (!fraction) continue;
    const w  = (SE_COUNTY_WEIGHTS[cId] ?? 0) * fraction;
    const cv = calcCountyVotes(natPcts, cId, countyOverrides?.[cId]);
    for (const p of SE_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * w;
    totalW += w;
  }
  if (totalW === 0) return {};
  const norm: Partial<Record<SePartyId, number>> = {};
  for (const p of SE_PARTIES) norm[p.id] = (weighted[p.id] ?? 0) / totalW;
  return calcSainteLague(norm);
}

// 2022 county-level results — derived from official Valmyndigheten constituency data
// Constituencies aggregated to counties (e.g. Skåne = Malmö + Skåne NE/S/W)
// Percentages are normalised to the 8 main parties only (excl. "other" parties)
const SE_COUNTY_RESULTS_2022: Record<SeCountyId, Partial<Record<SePartyId, number>>> = {
  // Stockholm (city + county constituencies combined)
  SEAB: { S: 28.0, SD: 14.9, M: 22.3, V:  8.7, C:  8.0, KD:  4.2, MP:  7.3, L:  6.5 },
  // Uppsala
  SEC:  { S: 29.6, SD: 18.5, M: 18.6, V:  8.0, C:  7.4, KD:  6.0, MP:  6.8, L:  5.1 },
  // Södermanland
  SED:  { S: 33.4, SD: 23.3, M: 19.5, V:  5.3, C:  6.0, KD:  4.8, MP:  4.1, L:  3.6 },
  // Östergötland
  SEE:  { S: 30.9, SD: 21.5, M: 20.1, V:  5.7, C:  6.6, KD:  6.0, MP:  4.7, L:  4.5 },
  // Jönköping
  SEF:  { S: 29.4, SD: 23.6, M: 19.0, V:  4.0, C:  7.6, KD:  9.4, MP:  3.3, L:  3.7 },
  // Kronoberg
  SEG:  { S: 31.4, SD: 24.0, M: 19.8, V:  5.1, C:  6.1, KD:  6.9, MP:  3.5, L:  3.2 },
  // Kalmar
  SEH:  { S: 32.2, SD: 24.8, M: 18.0, V:  4.7, C:  6.6, KD:  7.1, MP:  3.4, L:  3.2 },
  // Gotland
  SEI:  { S: 35.2, SD: 15.9, M: 17.1, V:  6.5, C: 11.9, KD:  4.0, MP:  6.6, L:  2.9 },
  // Blekinge
  SEK:  { S: 31.5, SD: 28.9, M: 18.1, V:  4.5, C:  4.9, KD:  5.6, MP:  2.9, L:  3.6 },
  // Skåne (Malmö + Skåne NE + Skåne S + Skåne W)
  SEM:  { S: 27.2, SD: 25.6, M: 20.4, V:  6.5, C:  5.7, KD:  4.8, MP:  5.0, L:  4.9 },
  // Halland
  SEN:  { S: 28.6, SD: 22.8, M: 22.7, V:  4.1, C:  7.1, KD:  6.1, MP:  3.6, L:  4.9 },
  // Västra Götaland (Gothenburg + VG East/North/South/West)
  SEO:  { S: 29.6, SD: 20.9, M: 19.2, V:  7.8, C:  6.4, KD:  6.0, MP:  5.4, L:  4.8 },
  // Värmland
  SES:  { S: 35.0, SD: 23.0, M: 17.2, V:  5.1, C:  6.4, KD:  5.9, MP:  3.7, L:  3.8 },
  // Örebro
  SET:  { S: 33.8, SD: 22.5, M: 17.0, V:  6.2, C:  6.4, KD:  5.4, MP:  4.1, L:  4.6 },
  // Västmanland
  SEU:  { S: 32.4, SD: 24.0, M: 19.4, V:  6.2, C:  5.5, KD:  5.1, MP:  3.2, L:  4.2 },
  // Dalarna
  SEW:  { S: 32.1, SD: 26.1, M: 16.7, V:  5.4, C:  6.6, KD:  6.1, MP:  3.9, L:  3.1 },
  // Gävleborg
  SEX:  { S: 35.2, SD: 24.4, M: 16.4, V:  6.0, C:  6.3, KD:  5.2, MP:  3.5, L:  3.0 },
  // Västernorrland
  SEY:  { S: 39.9, SD: 20.9, M: 14.1, V:  5.8, C:  7.5, KD:  5.5, MP:  3.5, L:  2.8 },
  // Jämtland
  SEZ:  { S: 36.5, SD: 20.4, M: 15.0, V:  5.7, C:  9.3, KD:  5.5, MP:  5.1, L:  2.7 },
  // Västerbotten
  SEAC: { S: 41.2, SD: 14.6, M: 14.3, V:  8.6, C:  7.9, KD:  4.8, MP:  5.5, L:  3.2 },
  // Norrbotten
  SEBD: { S: 42.1, SD: 20.5, M: 13.7, V:  7.1, C:  5.3, KD:  5.2, MP:  3.5, L:  2.6 },
};

// ── Simulation helpers ─────────────────────────────────────────────────────────
function seRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Generate n timestamps that cluster around the midpoint (bell curve over [0,totalMs])
function seBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () =>
    Math.max(0.02, Math.min(0.98, 0.5 + seRandNormal() * 0.18))
  ).sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

// Proportional swing: county_pct = base_2022 × (new_nat / old_nat), normalised
function calcCountyVotes(
  natPcts:   Record<SePartyId, number>,
  countyId:  SeCountyId,
  override?: Partial<Record<SePartyId, number>>,
): Record<SePartyId, number> {
  if (override && Object.keys(override).length > 0) {
    const raw: Record<SePartyId, number> = {} as Record<SePartyId, number>;
    let total = 0;
    for (const p of SE_PARTIES) { raw[p.id] = Math.max(0, override[p.id] ?? 0); total += raw[p.id]; }
    if (total === 0) return raw;
    for (const p of SE_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
    return raw;
  }
  const base = SE_COUNTY_RESULTS_2022[countyId] ?? {};
  const raw: Record<SePartyId, number> = {} as Record<SePartyId, number>;
  let total = 0;
  for (const p of SE_PARTIES) {
    const newNat = natPcts[p.id] ?? 0;
    const oldNat = SE_VOTE_PCT_2022[p.id] ?? 0;
    const basePct = base[p.id] ?? 0;
    raw[p.id] = newNat === 0 ? 0 : oldNat === 0 ? newNat : basePct * (newNat / oldNat);
    total += raw[p.id];
  }
  if (total === 0) return raw;
  for (const p of SE_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

// ── Format / colour helpers ────────────────────────────────────────────────────
type CountyTooltipState = {
  x:          number;
  y:          number;
  name:       string;
  parties:    { id: SePartyId; pct: number; rawVotes?: number }[];
  leader:     SePartyId | null;
  reportingPct?: number;  // for simulation tooltips
} | null;

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return String(n);
}

function hexToRgba(hex: string, alpha: number): string {
  const h    = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function partyColor(id: SePartyId): string { return SE_PARTY_MAP[id]?.color ?? '#888'; }

function getCountyFill(
  natPcts:   Record<SePartyId, number>,
  countyId:  SeCountyId,
  dark:      boolean,
  override?: Partial<Record<SePartyId, number>>,
): string {
  const pv     = calcCountyVotes(natPcts, countyId, override);
  const sorted = (Object.entries(pv) as [SePartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : '#E5E7EB';
  const [winner, winPct] = sorted[0];
  const margin = winPct - (sorted[1]?.[1] ?? 0);
  const c = hsl(partyColor(winner));
  c.l = dark ? 0.55 - Math.min(margin / 20, 1) * 0.29 : 0.82 - Math.min(margin / 20, 1) * 0.46;
  return c.formatHex();
}

// Redistribute % when one slider moves; unlocked others absorb the change
function redistributePcts(
  current:   Record<SePartyId, number>,
  changedId: SePartyId,
  newRaw:    number,
  locks:     Set<SePartyId>,
): Record<SePartyId, number> {
  const ids       = Object.keys(current) as SePartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped   = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked  = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
  const next: Record<SePartyId, number> = { ...current, [changedId]: clamped };
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  if (unlockedSum > 0) {
    for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  } else if (unlocked.length > 0) {
    const share = remaining / unlocked.length;
    for (const id of unlocked) next[id] = share;
  }
  return next;
}

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function SeScoreboardTile({
  partyId, seats, pct, rawVotes, isLeader, isWinner, is2026, dark: _dark,
}: {
  partyId:   SePartyId;
  seats:     number;
  pct:       number;
  rawVotes?: number;
  isLeader:  boolean;
  isWinner:  boolean;
  is2026?:   boolean;
  dark?:     boolean;
}) {
  const party      = SE_PARTY_MAP[partyId];
  const leaderName = is2026 && party.leader2026 ? party.leader2026 : party.leader;
  const leaderWiki = is2026 && party.wikiTitle2026 ? party.wikiTitle2026 : party.wikiTitle;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!leaderWiki) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(leaderWiki).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [leaderWiki]);

  const initials   = leaderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color      = partyColor(partyId);
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
            ? <img src={photoUrl} alt={leaderName} onError={() => setPhotoUrl(null)} />
            : <span className="cand-initials">{initials}</span>}
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
      <span className="cand-leader-name" title={leaderName}>{leaderName.split(' ').pop()}</span>
      <span className="cand-party-abbrev">{party.name}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name" title={party.fullName}>{party.fullName}</span>

      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 6.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, color: hexToRgba(color, 0.48), letterSpacing: '0.10em', textTransform: 'uppercase' }}>VOTES</span>
        <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
      </div>
      {rawVotes != null && (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
          <span className="cand-votes-full"    style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: hexToRgba(color, 0.65) }}>{rawVotes.toLocaleString()}</span>
          <span className="cand-votes-compact" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: hexToRgba(color, 0.65) }}>{fmtN(rawVotes)}</span>
        </div>
      )}
      <div className="cand-bar-track" style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--bar-track)' }}>
        <div className="cand-bar-fill" style={{ height: '100%', borderRadius: 2, background: color, width: `${Math.min(pct / 40 * 100, 100)}%`, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────────
const SE_LEFT_BLOC_IDS:  SePartyId[] = ['V', 'MP', 'S'];
const SE_RIGHT_BLOC_IDS: SePartyId[] = ['L', 'KD', 'M', 'SD'];

function SeScoreboard({
  natPcts, simSeats, isBaseline, is2026, dark, reportedVoteScale,
}: {
  natPcts:           Record<SePartyId, number>;
  simSeats?:         Partial<Record<SePartyId, number>>;
  isBaseline?:       boolean;
  is2026?:           boolean;
  dark?:             boolean;
  reportedVoteScale?: number;
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

  const seats = useMemo(() => simSeats ?? calcSainteLague(natPcts), [simSeats, natPcts]);

  const pctTotal = Object.values(natPcts).reduce((s, v) => s + (v ?? 0), 0);
  const scale    = reportedVoteScale ?? 1;

  // All 8 parties, omit if 0 seats AND <0.1% vote
  const visible = useMemo(
    () => (['V','MP','S','C','L','KD','M','SD'] as SePartyId[])
      .filter(id => (seats[id] ?? 0) > 0 || (natPcts[id] ?? 0) >= 0.1),
    [seats, natPcts],
  );

  // Per-tile leader/winner indicators
  const bySeats     = [...visible].sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0));
  const topParty    = bySeats[0] ?? null;
  const indivWinner = topParty && (seats[topParty] ?? 0) >= SE_MAJORITY ? topParty : null;

  // Bloc seat totals — drive C placement
  const leftBlocSeats  = SE_LEFT_BLOC_IDS.reduce((s, id) => s + (seats[id] ?? 0), 0);
  const rightBlocSeats = SE_RIGHT_BLOC_IDS.reduce((s, id) => s + (seats[id] ?? 0), 0);
  // C follows the larger bloc (sits to its right). If left is larger: [Left][C][Right]; else [Left][Right][C]
  const cAfterRight = rightBlocSeats >= leftBlocSeats;

  const makeTile = (id: SePartyId, inGroup = false) => {
    const s        = seats[id] ?? 0;
    const pct      = pctTotal > 0 ? (natPcts[id] ?? 0) / pctTotal * 100 : 0;
    const rawVotes = isBaseline
      ? Math.round((SE_VOTE_RAW_2022[id] ?? 0) * scale)
      : Math.round((natPcts[id] ?? 0) / 100 * SE_GRAND_TOTAL_VOTES * scale);
    const isLeader = !inGroup && id === topParty && !indivWinner;
    const isWinner = !inGroup && id === indivWinner;
    return (
      <SeScoreboardTile key={id} partyId={id} seats={s} pct={pct} rawVotes={rawVotes}
        isLeader={isLeader} isWinner={isWinner} is2026={is2026} dark={dark} />
    );
  };

  // Within each bloc, sort by decreasing seats
  const sortedBloc = (ids: SePartyId[]) =>
    ids.filter(id => visible.includes(id)).sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0));

  const renderBloc = (ids: SePartyId[], label: string) => {
    const shown = sortedBloc(ids);
    if (shown.length === 0) return null;
    return (
      <div className="ni-group">
        <span className="ni-group-label">{label}</span>
        <div className="ni-group-tiles">
          {shown.map(id => makeTile(id, true))}
        </div>
      </div>
    );
  };

  const cTile = visible.includes('C') ? makeTile('C') : null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">

          {/* Left Bloc: V + MP + S */}
          {renderBloc(SE_LEFT_BLOC_IDS, 'Vänster')}

          {/* C between blocs when left is larger */}
          {!cAfterRight && cTile}

          {/* Right Bloc: L + KD + M + SD */}
          {renderBloc(SE_RIGHT_BLOC_IDS, 'Tidö')}

          {/* C after right bloc when right is larger (default: 2022 baseline) */}
          {cAfterRight && cTile}

        </div>
      </div>
    </div>
  );
}

// ── Left-right ideological order ──────────────────────────────────────────────
const SE_LR_ORDER: SePartyId[] = ['V', 'MP', 'S', 'C', 'L', 'KD', 'M', 'SD'];

// ── Coalition presets ─────────────────────────────────────────────────────────
const SE_PRESET_COALITIONS: { name: string; emoji: string; parties: SePartyId[] }[] = [
  { name: 'Tidö Coalition',    emoji: '🇸🇪', parties: ['M', 'SD', 'KD', 'L'] },
  { name: 'Red-Green Bloc',    emoji: '🌹',  parties: ['S', 'V', 'MP'] },
  { name: 'Alliansen',         emoji: '🤝',  parties: ['M', 'C', 'L', 'KD'] },
  { name: 'Social Dem. Broad', emoji: '🌊',  parties: ['S', 'C', 'MP', 'L'] },
];

// ── Map controller ────────────────────────────────────────────────────────────
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  useEffect(() => {
    const h = () => {
      layerRef.current?.eachLayer((l: L.Layer) => {
        const p = l as any;
        if (p.options) p.options.smoothFactor = 0;
      });
    };
    map.on('zoomend', h);
    return () => { map.off('zoomend', h); };
  }, [map, layerRef]);
  return null;
}

// ── Bubble overlay ────────────────────────────────────────────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };
function zoomScale(zoom: number): number { return Math.max(0.15, Math.min(2.0, (zoom - 4) / (8 - 4))); }

function SeBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef,
  declaredCounties, countyOverrides, countyOverridesRef, blankMode, projectedCounties,
  simCountyFractions,
}: {
  geoData:            any;
  natPcts:            Record<SePartyId, number>;
  containerRef:       React.RefObject<HTMLDivElement | null>;
  setTooltip:         (t: CountyTooltipState) => void;
  onSelect:           (id: SeCountyId) => void;
  natPctsRef:         React.MutableRefObject<Record<SePartyId, number>>;
  declaredCounties?:  Set<SeCountyId>;
  countyOverrides?:   Partial<Record<SeCountyId, Partial<Record<SePartyId, number>>>>;
  countyOverridesRef: React.MutableRefObject<Partial<Record<SeCountyId, Partial<Record<SePartyId, number>>>>>;
  blankMode?:         boolean;
  projectedCounties?: Set<SeCountyId>;
  simCountyFractions?: Partial<Record<SeCountyId, number>>;
}) {
  const map        = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);
  const simFracRef = useRef(simCountyFractions ?? {});
  useEffect(() => { simFracRef.current = simCountyFractions ?? {}; }, [simCountyFractions]);

  useEffect(() => {
    const onZoom = () => {
      const scale = zoomScale(map.getZoom());
      for (const { marker, baseRadius } of bubblesRef.current) marker.setRadius(baseRadius * scale);
    };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);

  useEffect(() => {
    for (const { marker } of bubblesRef.current) marker.remove();
    bubblesRef.current = [];
    const scale = zoomScale(map.getZoom());

    L.geoJSON(geoData).eachLayer((layer: L.Layer) => {
      const path     = layer as any;
      const geoId: string = path.feature?.properties?.id ?? '';
      const countyId = SE_GEOID_TO_ID[geoId];
      if (!countyId) return;
      if (declaredCounties && !declaredCounties.has(countyId)) return;
      if (blankMode && !(projectedCounties?.has(countyId))) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();

      const pv     = calcCountyVotes(natPcts, countyId, countyOverrides?.[countyId]);
      const sorted = (Object.entries(pv) as [SePartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (sorted.length === 0) return;
      const [winId, winPct] = sorted[0];
      const runnerUp        = sorted[1]?.[1] ?? 0;
      const margin          = winPct - runnerUp;
      const baseRadius      = 14 + Math.min(margin / 10, 1) * 24;
      const color           = partyColor(winId);

      const marker = L.circleMarker(center, {
        radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1, opacity: 0.9,
      }).addTo(map);

      marker.on('click', () => { setTooltip(null); onSelect(countyId); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cur       = calcCountyVotes(natPctsRef.current, countyId, countyOverridesRef.current?.[countyId]);
        const fraction  = simFracRef.current[countyId] ?? 1;
        const cntVotes  = SE_GRAND_TOTAL_VOTES * (SE_COUNTY_WEIGHTS[countyId] ?? 0) / SE_TOTAL_COUNTY_WEIGHT;
        const parties   = (Object.entries(cur) as [SePartyId, number][])
          .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 6)
          .map(([id, pct]) => ({
            id: id as SePartyId,
            pct,
            rawVotes: Math.round(pct / 100 * cntVotes * fraction),
          }));
        const county    = SE_COUNTIES.find(c => c.id === countyId);
        setTooltip({
          x: e.originalEvent.clientX - rect.left,
          y: e.originalEvent.clientY - rect.top,
          name: county?.name ?? geoId,
          parties,
          leader: parties[0]?.id ?? null,
          reportingPct: Math.round(fraction * 100),
        });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });

    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoData, natPcts, blankMode, projectedCounties, declaredCounties]);

  return null;
}

// ── Map view ──────────────────────────────────────────────────────────────────
type SeCountyDraft = { countyId: SeCountyId; pcts: Record<SePartyId, number>; rptPct: number };

function SeMapView({
  natPcts, selectedCounty, onSelect, dark, bubbleMap,
  declaredCounties, countyOverrides, blankMode, projectedCounties, simCountyFractions,
  countyDraft, simNatPcts,
}: {
  natPcts:             Record<SePartyId, number>;
  selectedCounty:      SeCountyId | null;
  onSelect:            (id: SeCountyId) => void;
  dark:                boolean;
  bubbleMap:           boolean;
  declaredCounties?:   Set<SeCountyId>;
  countyOverrides?:    Partial<Record<SeCountyId, Partial<Record<SePartyId, number>>>>;
  blankMode?:          boolean;
  projectedCounties?:  Set<SeCountyId>;
  simCountyFractions?: Partial<Record<SeCountyId, number>>;
  countyDraft?:        SeCountyDraft | null;
  simNatPcts?:         Record<SePartyId, number> | null;
}) {
  const containerRef       = useRef<HTMLDivElement>(null);
  const layerRef           = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<CountyTooltipState>(null);

  const natPctsRef         = useRef(natPcts);
  const selectedRef        = useRef(selectedCounty);
  const darkRef            = useRef(dark);
  const bubbleRef          = useRef(bubbleMap);
  const onSelectRef        = useRef(onSelect);
  const declaredRef        = useRef(declaredCounties);
  const countyOverridesRef = useRef(countyOverrides ?? {});
  const blankModeRef       = useRef(blankMode ?? false);
  const projectedRef       = useRef(projectedCounties ?? new Set<SeCountyId>());
  const simFracRef2        = useRef(simCountyFractions ?? {});
  const countyDraftRef2    = useRef<SeCountyDraft | null>(countyDraft ?? null);
  const simNatPctsRef2     = useRef<Record<SePartyId, number> | null>(simNatPcts ?? null);

  useEffect(() => { natPctsRef.current         = natPcts;               }, [natPcts]);
  useEffect(() => { selectedRef.current        = selectedCounty;        }, [selectedCounty]);
  useEffect(() => { darkRef.current            = dark;                  }, [dark]);
  useEffect(() => { bubbleRef.current          = bubbleMap;             }, [bubbleMap]);
  useEffect(() => { onSelectRef.current        = onSelect;              }, [onSelect]);
  useEffect(() => { declaredRef.current        = declaredCounties;      }, [declaredCounties]);
  useEffect(() => { countyOverridesRef.current = countyOverrides ?? {};  }, [countyOverrides]);
  useEffect(() => { blankModeRef.current       = blankMode ?? false;    }, [blankMode]);
  useEffect(() => { projectedRef.current       = projectedCounties ?? new Set(); }, [projectedCounties]);
  useEffect(() => { simFracRef2.current        = simCountyFractions ?? {}; }, [simCountyFractions]);
  useEffect(() => { countyDraftRef2.current    = countyDraft ?? null;       }, [countyDraft]);
  useEffect(() => { simNatPctsRef2.current     = simNatPcts ?? null;        }, [simNatPcts]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}sweden-counties.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  // getStyle closes over current props/state directly so react-leaflet's updateGeoJSON
  // re-applies styles correctly when any dep changes (refs are stale at apply-time).
  const getStyle = useCallback((feature: any): L.PathOptions => {
    const geoId    = feature?.properties?.id ?? '';
    const countyId = SE_GEOID_TO_ID[geoId];
    const isSel    = countyId === selectedCounty;
    const border   = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';

    if (bubbleMap) {
      return { fillOpacity: 0, weight: 0.4, color: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)', opacity: 0.6 };
    }
    if (!countyId) return { fillColor: dark ? '#374151' : '#E5E7EB', fillOpacity: 0.5, weight: 0.4, color: border, opacity: 1 };

    // Simulation data takes priority — check before blank-mode grey
    const simFrac    = simCountyFractions?.[countyId];
    const hasSimData = simFrac !== undefined && simFrac > 0;

    if (blankMode && !hasSimData) {
      const hasOverride = !!countyOverrides?.[countyId] && Object.keys(countyOverrides[countyId]!).length > 0;
      if (!hasOverride) return { fillColor: dark ? '#1f2937' : '#d1d5db', fillOpacity: 0.7, weight: isSel ? 2 : 0.4, color: isSel ? '#c8a020' : border, opacity: 1 };
    }

    const isDeclared = !declaredCounties || declaredCounties.has(countyId);
    if (!isDeclared && !hasSimData) return { fillColor: dark ? '#1f2937' : '#d1d5db', fillOpacity: 0.7, weight: 0.4, color: border, opacity: 1 };

    const effectiveNatPcts = simNatPcts ?? natPcts;
    const fill = getCountyFill(effectiveNatPcts, countyId, dark, countyOverrides?.[countyId]);
    const opacity = isDeclared ? 0.78 : Math.max(0.35, 0.78 * (simFrac ?? 1));
    return { fillColor: fill, fillOpacity: opacity, weight: isSel ? 2 : 0.4, color: isSel ? '#c8a020' : border, opacity: 1 };
  }, [natPcts, selectedCounty, dark, bubbleMap, declaredCounties, countyOverrides, blankMode, simCountyFractions, simNatPcts]);

  // Belt-and-suspenders: also call setStyle manually when getStyle changes
  useEffect(() => {
    layerRef.current?.setStyle((f: any) => getStyle(f));
  }, [getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const geoId    = feature?.properties?.id ?? '';
    const countyId = SE_GEOID_TO_ID[geoId];

    layer.on('click', () => { if (countyId) onSelectRef.current(countyId); });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleRef.current || !countyId) { setTooltip(null); return; }

      const draft    = countyDraftRef2.current;
      const hasDraft = draft?.countyId === countyId;

      if (blankModeRef.current) {
        const hasOverride = !!countyOverridesRef.current[countyId] && Object.keys(countyOverridesRef.current[countyId]!).length > 0;
        if (!hasOverride && !hasDraft) { setTooltip(null); return; }
      }

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Draft overrides committed data for the open county
      const overrideToUse   = hasDraft ? draft!.pcts : countyOverridesRef.current?.[countyId];
      const fraction = hasDraft
        ? draft!.rptPct / 100
        : simFracRef2.current[countyId] ?? (declaredRef.current?.has(countyId) ? 1 : undefined);

      // During simulation use the sim's national percentages for county projections
      const effectiveNatPcts = simNatPctsRef2.current ?? natPctsRef.current;
      const cntVotes = SE_GRAND_TOTAL_VOTES * (SE_COUNTY_WEIGHTS[countyId] ?? 0) / SE_TOTAL_COUNTY_WEIGHT;
      const pv       = calcCountyVotes(effectiveNatPcts, countyId, overrideToUse);
      const parties  = (Object.entries(pv) as [SePartyId, number][])
        .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 6)
        .map(([id, pct]) => ({
          id: id as SePartyId,
          pct,
          rawVotes: Math.round(pct / 100 * cntVotes * (fraction ?? 1)),
        }));
      const county = SE_COUNTIES.find(c => c.id === countyId);
      setTooltip({
        x: e.originalEvent.clientX - rect.left,
        y: e.originalEvent.clientY - rect.top,
        name: county?.name ?? geoId,
        parties,
        leader: parties[0]?.id ?? null,
        reportingPct: fraction != null ? Math.round(fraction * 100) : undefined,
      });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[63, 17]} zoom={5} style={{ width: '100%', height: '100%' }} zoomControl worldCopyJump={false}>
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
          <SeBubbleLayer
            geoData={geoData} natPcts={natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredCounties={declaredCounties} countyOverrides={countyOverrides}
            countyOverridesRef={countyOverridesRef} blankMode={blankMode}
            projectedCounties={projectedCounties} simCountyFractions={simCountyFractions}
          />
        )}
      </MapContainer>

      {/* ── Tooltip ── */}
      {tooltip && (() => {
        const cw   = containerRef.current?.clientWidth ?? 9999;
        const TW   = 228;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt   = {
          bg: dark ? 'rgba(18,24,44,0.97)' : 'rgba(255,255,255,0.98)',
          border: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.55)' : '0 6px 28px rgba(0,0,0,0.13)',
          title: dark ? 'rgba(255,255,255,0.93)' : 'rgba(0,0,0,0.86)',
          sub:   dark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.42)',
          body:  dark ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.79)',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: tt.shadow, backdropFilter: 'blur(12px)', padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>{tooltip.name}</div>
              <div style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 2 }}>
                {tooltip.reportingPct != null ? `${tooltip.reportingPct}% reporting` : 'Estimated county result'}
              </div>
              <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {tooltip.parties.map(({ id, pct, rawVotes }, i) => {
                  const pColor = partyColor(id);
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: pColor }} />
                      <span style={{ flex: 1, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{SE_PARTY_MAP[id]?.name ?? id}</span>
                      <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: pColor }}>{pct.toFixed(1)}%</span>
                      {rawVotes != null && (
                        <span style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginLeft: 2 }}>{rawVotes.toLocaleString()}</span>
                      )}
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

// ── Parliament hemicycle — 7 rows, well-spaced ────────────────────────────────
function SeParliamentPanel({ seats: seatsMap, onClose, exiting, dark }: {
  seats:    Partial<Record<SePartyId, number>>;
  onClose:  () => void;
  exiting?: boolean;
  dark?:    boolean;
}) {
  // Build seat colour array in ideological order (left → right)
  const seatColors: string[] = [];
  const legend: { id: SePartyId; count: number; color: string }[] = [];
  for (const id of SE_LR_ORDER) {
    const n = seatsMap[id] ?? 0;
    if (n === 0) continue;
    const color = partyColor(id);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;

  // Hemicycle geometry — 7 rows so dots never crowd
  const W = 380, H = 215;
  const cx = W / 2, cy = H - 6;
  const innerR = 68, rowSpacing = 18, numRows = 7;

  const radii      = Array.from({ length: numRows }, (_, i) => innerR + i * rowSpacing);
  const arcLens    = radii.map(r => Math.PI * r);
  const totalArc   = arcLens.reduce((s, v) => s + v, 0);

  // Largest-remainder proportional allocation to rows
  const rawPerRow  = arcLens.map(a => (a / totalArc) * SE_TOTAL_SEATS);
  const floored    = rawPerRow.map(Math.floor);
  const remainder  = SE_TOTAL_SEATS - floored.reduce((s, v) => s + v, 0);
  rawPerRow
    .map((v, i) => ({ i, rem: v - floored[i] }))
    .sort((a, b) => b.rem - a.rem)
    .slice(0, remainder)
    .forEach(({ i }) => floored[i]++);

  // Generate positions: θ goes from ~π (left) to ~0 (right) — ideological axis
  const positions: { x: number; y: number; θ: number; r: number }[] = [];
  for (let row = 0; row < numRows; row++) {
    const r = radii[row];
    const n = floored[row];
    for (let j = 0; j < n; j++) {
      const θ = Math.PI - Math.PI * (j + 0.5) / n;
      positions.push({ x: cx + r * Math.cos(θ), y: cy - r * Math.sin(θ), θ, r });
    }
  }
  // Sort: highest θ first (leftmost ideology), ties broken by innermost row
  positions.sort((a, b) => b.θ - a.θ || a.r - b.r);

  const dotR = 2.6;

  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit-left' : 'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Riksdag Hemicycle</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {SE_MAJORITY} · sorted by ideology</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats === 0 ? (
          <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">
            Load results or run simulation first
          </div>
        ) : (
          <>
            <div className="px-1 pt-4 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
                {/* centre axis line */}
                <line x1={cx} y1={cy - innerR + 2} x2={cx} y2={cy - (innerR + (numRows-1)*rowSpacing) - 10}
                  stroke={dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}
                  strokeWidth="1" strokeDasharray="3,4" />
                {/* majority threshold arc indicator */}
                <text x={cx - 2} y={cy - innerR - 14} textAnchor="middle"
                  style={{ fontSize: 8, fill: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.30)', fontFamily: '"JetBrains Mono",monospace' }}>
                  ← left · right →
                </text>
                {positions.map(({ x, y }, i) => (
                  <circle key={i} cx={x} cy={y} r={dotR}
                    fill={i < seatColors.length ? seatColors[i] : (dark ? '#2d3748' : '#e5e7eb')}
                    opacity={i < seatColors.length ? 1 : 0.4}
                  />
                ))}
                {/* majority line */}
                <line x1={cx} y1={cy - innerR - 2} x2={cx} y2={cy - (innerR + (numRows-1)*rowSpacing) - 4}
                  stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="2,3" opacity="0.6" />
              </svg>
            </div>
            <div className="px-3.5 pb-4">
              {/* Left/Right bloc summary */}
              {(() => {
                const left  = ['V','MP','S'] as SePartyId[];
                const right = ['M','SD','KD','L'] as SePartyId[];
                const lSeats = left.reduce((s,id) => s + (seatsMap[id]??0), 0);
                const rSeats = right.reduce((s,id) => s + (seatsMap[id]??0), 0);
                const cSeats = seatsMap['C'] ?? 0;
                return (
                  <div className="flex items-center gap-1.5 mb-3 text-[9px] font-mono">
                    <span style={{ color: '#ED1B34', fontWeight: 700 }}>Left {lSeats}</span>
                    <span style={{ color: dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)' }}>·</span>
                    <span style={{ color: '#009A44', fontWeight: 700 }}>C {cSeats}</span>
                    <span style={{ color: dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)' }}>·</span>
                    <span style={{ color: '#1B4F8A', fontWeight: 700 }}>Right {rSeats}</span>
                    <span style={{ color: dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)', marginLeft: 'auto' }}>need {SE_MAJORITY}</span>
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({ id, count, color }) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{SE_PARTY_MAP[id].name}</span>
                    <span className="text-[9.5px] font-mono font-bold text-ink">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// ── Coalition builder panel ────────────────────────────────────────────────────
function SeCoalitionPanel({ seats, onClose, exiting, dark }: {
  seats:    Partial<Record<SePartyId, number>>;
  onClose:  () => void;
  exiting?: boolean;
  dark?:    boolean;
}) {
  const [selected, setSelected] = useState<Set<SePartyId>>(new Set(['M', 'SD', 'KD', 'L']));
  const toggle = (id: SePartyId) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalCoalSeats = [...selected].reduce((s, id) => s + (seats[id] ?? 0), 0);
  const hasMajority    = totalCoalSeats >= SE_MAJORITY;

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {SE_MAJORITY} seats · {SE_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {SE_PRESET_COALITIONS.map(coal => (
            <button key={coal.name} onClick={() => setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id => SE_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {SE_LR_ORDER.map(id => {
            const party = SE_PARTY_MAP[id];
            const s     = seats[id] ?? 0;
            const isIn  = selected.has(id);
            const color = partyColor(id);
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
        <div className="mt-1 h-2 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${Math.min(totalCoalSeats / SE_TOTAL_SEATS * 100, 100)}%`, background: hasMajority ? '#16a34a' : '#ef4444' }} />
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority ? 'text-emerald-600' : 'text-red-500'}`}>
          {hasMajority ? `✓ MAJORITY (need ${SE_MAJORITY})` : `✗ ${SE_MAJORITY - totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Parties visibility panel ───────────────────────────────────────────────────
function SePartiesPanel({ hiddenParties, onToggle, onClose, dark }: {
  hiddenParties: Set<SePartyId>; onToggle: (id: SePartyId) => void; onClose: () => void; dark?: boolean;
}) {
  const allHidden = SE_LR_ORDER.every(id => hiddenParties.has(id));
  return (
    <aside className={`w-56 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">Parties</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Show in sliders</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 thin-scroll">
        {SE_LR_ORDER.map(id => {
          const party  = SE_PARTY_MAP[id];
          const hidden = hiddenParties.has(id);
          return (
            <button key={id} onClick={() => onToggle(id)}
              className={`w-full flex items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-hover ${hidden ? 'opacity-40' : ''}`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: party.color }} />
              <span className="text-[10.5px] font-medium text-ink flex-1 truncate">{party.name} · {party.fullName}</span>
              <span className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center shrink-0 ${hidden ? 'border border-default' : ''}`}
                style={hidden ? {} : { background: party.color }}>
                {!hidden && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="px-3.5 pb-3 pt-2 border-t border-default shrink-0">
        <button
          onClick={() => { for (const id of SE_LR_ORDER) { if (allHidden ? hiddenParties.has(id) : !hiddenParties.has(id)) onToggle(id); } }}
          className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
          {allHidden ? 'Show All' : 'Hide All'}
        </button>
      </div>
    </aside>
  );
}

// ── County breakdown panel ─────────────────────────────────────────────────────
function SeCountyPanel({
  countyId, natPcts, countyOverride, onOverride, onResetOverride, onClose,
  isBlankMode, isProjected, reportingPct, onProject, onReportingPctChange,
  onDraftChange, hiddenParties, dark,
}: {
  countyId:              SeCountyId;
  natPcts:               Record<SePartyId, number>;
  countyOverride?:       Partial<Record<SePartyId, number>>;
  onOverride:            (pcts: Partial<Record<SePartyId, number>>) => void;
  onResetOverride:       () => void;
  onClose:               () => void;
  isBlankMode?:          boolean;
  isProjected?:          boolean;
  reportingPct?:         number;
  onProject?:            () => void;
  onReportingPctChange?: (pct: number) => void;
  onDraftChange?:        (pcts: Record<SePartyId, number>, rptPct: number) => void;
  hiddenParties?:        Set<SePartyId>;
  dark?:                 boolean;
}) {
  const [locks, setLocks]               = useState<Set<SePartyId>>(new Set());
  const baseVotes = useMemo(() => calcCountyVotes(natPcts, countyId), [natPcts, countyId]);
  const [draftPcts, setDraftPcts]       = useState<Record<SePartyId, number>>(() =>
    countyOverride && Object.keys(countyOverride).length > 0 ? { ...calcCountyVotes(natPcts, countyId, countyOverride) } : { ...baseVotes }
  );
  const [localRptPct, setLocalRptPct]   = useState(reportingPct ?? 100);
  const [touched, setTouched]           = useState(!!countyOverride && Object.keys(countyOverride).length > 0);

  useEffect(() => {
    setLocks(new Set());
    const base = calcCountyVotes(natPcts, countyId);
    setDraftPcts(countyOverride && Object.keys(countyOverride).length > 0 ? { ...calcCountyVotes(natPcts, countyId, countyOverride) } : { ...base });
    setLocalRptPct(reportingPct ?? 100);
    setTouched(!!countyOverride && Object.keys(countyOverride).length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countyId]);

  // Propagate live draft upward so tooltip + scoreboard always reflect current sliders
  useEffect(() => {
    if (isBlankMode) onDraftChange?.(draftPcts, localRptPct);
  }, [draftPcts, localRptPct, isBlankMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveLocks = useMemo(() => new Set<SePartyId>([...locks, ...(hiddenParties ?? [])]), [locks, hiddenParties]);
  const displayPv      = isBlankMode ? draftPcts : calcCountyVotes(natPcts, countyId, countyOverride);
  const [sortedIds]    = useState<SePartyId[]>(() => SE_PARTIES.map(p => p.id).sort((a,b) => (baseVotes[b]??0)-(baseVotes[a]??0)));
  const county         = SE_COUNTIES.find(c => c.id === countyId);
  const winner         = SE_PARTIES.reduce((best, p) => (displayPv[p.id]??0) > (displayPv[best.id]??0) ? p : best, SE_PARTIES[0]);
  const hasOverride    = !!countyOverride && Object.keys(countyOverride).length > 0;
  const countyTotalVotes = Math.round(SE_GRAND_TOTAL_VOTES * (SE_COUNTY_WEIGHTS[countyId]??0) / SE_TOTAL_COUNTY_WEIGHT);

  const handleSlider = (id: SePartyId, val: number) => {
    if (isBlankMode) {
      setDraftPcts(redistributePcts(draftPcts, id, val, effectiveLocks));
      setTouched(true);
    } else {
      onOverride(redistributePcts(displayPv as Record<SePartyId,number>, id, val, effectiveLocks));
    }
  };

  const handleProject = () => {
    if (!touched) return;
    onOverride(draftPcts);
    onReportingPctChange?.(localRptPct);
    onProject?.();
  };

  const sliderTrack = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{county?.name ?? countyId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {isBlankMode ? (isProjected ? 'Projected · adjust & re-project' : 'Blank map · set county result') : (hasOverride ? 'Custom override' : 'Estimated · drag sliders')}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px]" style={{ borderLeft: `3px solid ${winner.color}`, background: dark ? 'rgba(255,255,255,0.04)' : '#f8f7f4' }}>
          <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
          <span className="text-[9px] font-mono text-ink-3">{(displayPv[winner.id]??0).toFixed(1)}%</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {/* % Reporting slider — TOP in blank mode */}
        {isBlankMode && (
          <div className="px-3.5 pt-3 pb-3 border-b border-default">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] font-mono font-bold uppercase tracking-[0.14em]" style={{ color: dark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.40)' }}>% Reporting</span>
              <span className="text-[13px] font-mono font-black tabular-nums" style={{ color: localRptPct < 50 ? '#ef4444' : localRptPct < 100 ? '#f59e0b' : '#16a34a' }}>{localRptPct}%</span>
            </div>
            <div style={{ position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 4, background: sliderTrack }} />
              <div style={{ position: 'absolute', left: 0, width: `${localRptPct}%`, height: 4, borderRadius: 4, background: localRptPct < 50 ? '#ef4444' : localRptPct < 100 ? '#f59e0b' : '#16a34a', transition: 'width 0.05s' }} />
              <input type="range" min={1} max={100} step={1} value={localRptPct}
                onChange={e => { setLocalRptPct(+e.target.value); setTouched(true); }}
                className="br-party-slider w-full"
                style={{ '--party-color': localRptPct < 50 ? '#ef4444' : localRptPct < 100 ? '#f59e0b' : '#16a34a', '--pct': `${localRptPct}%`, position: 'relative', zIndex: 1 } as React.CSSProperties}
              />
            </div>
            <div className="text-[8px] font-mono mt-0.5" style={{ color: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.32)' }}>
              ≈{Math.round(countyTotalVotes * localRptPct / 100).toLocaleString()} votes counted
            </div>
          </div>
        )}

        {/* Party sliders */}
        <div className="px-3.5 space-y-3 py-3">
          {sortedIds.filter(id => !hiddenParties?.has(id) && (isBlankMode || (displayPv[id]??0) >= 0.1 || locks.has(id))).map(id => {
            const p       = SE_PARTY_MAP[id];
            const pct     = displayPv[id] ?? 0;
            const isLocked = locks.has(id);
            const color   = p.color;
            const rawVotes = Math.round((pct/100) * countyTotalVotes * (isBlankMode ? localRptPct/100 : 1));
            return (
              <div key={id}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                  <button onClick={() => setLocks(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; })}
                    className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}
                    title={isLocked ? 'Unlock' : 'Lock'}>
                    {isLocked
                      ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                  </button>
                  <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>{pct.toFixed(1)}%</span>
                </div>
                <input type="range" min={0} max={70} step={0.1} value={pct} disabled={isLocked}
                  onChange={e => handleSlider(id, parseFloat(e.target.value))}
                  className="br-party-slider w-full"
                  style={{ '--party-color': color, '--pct': `${(pct/70)*100}%` } as React.CSSProperties}
                />
                <div className="flex justify-between mt-0.5">
                  <span className="text-[8px] font-mono" style={{ color: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.28)' }}>~{rawVotes.toLocaleString()}</span>
                  {pct < 4 && <span className="text-[7.5px] font-mono" style={{ color: '#f59e0b' }}>⚠ below 4%</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      {isBlankMode ? (
        <div className="px-3.5 py-2.5 border-t border-default shrink-0 space-y-1.5">
          <button onClick={handleProject} disabled={!touched}
            className={`w-full h-8 rounded-[4px] text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors ${
              !touched ? 'border border-default text-ink-3 opacity-50 cursor-not-allowed'
                : isProjected ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}>
            {!touched ? 'Adjust a slider first' : isProjected ? '↻ Update Result' : '📍 Project Result'}
          </button>
          {hasOverride && (
            <button onClick={() => { onResetOverride(); setTouched(false); setDraftPcts({...calcCountyVotes(natPcts,countyId)}); }}
              className="w-full h-6 rounded-[4px] border border-default text-ink-3 text-[9px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Clear projection
            </button>
          )}
        </div>
      ) : hasOverride ? (
        <div className="px-3.5 py-2.5 border-t border-default shrink-0">
          <button onClick={onResetOverride} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
            Reset to calculated
          </button>
        </div>
      ) : null}
    </aside>
  );
}

// ── Breakdown panel ────────────────────────────────────────────────────────────
function SeBreakdownPanel({ seats, natPcts, isBaseline, onClose, exiting, dark }: {
  seats:       Partial<Record<SePartyId, number>>;
  natPcts:     Record<SePartyId, number>;
  isBaseline?: boolean;
  onClose:     () => void;
  exiting?:    boolean;
  dark?:       boolean;
}) {
  const totalS  = SE_LR_ORDER.reduce((s,id) => s+(seats[id]??0), 0);
  const totalV  = SE_PARTIES.reduce((s,p) => s+(natPcts[p.id]??0), 0);
  const left    = (['V','MP','S'] as SePartyId[]).reduce((s,id) => s+(seats[id]??0), 0);
  const right   = (['M','SD','KD','L'] as SePartyId[]).reduce((s,id) => s+(seats[id]??0), 0);
  const centre  = seats['C'] ?? 0;

  const enp = totalS > 0
    ? 1 / SE_LR_ORDER.reduce((s,id) => { const sh=(seats[id]??0)/totalS; return s+sh*sh; }, 0)
    : 0;

  const gallagher = Math.sqrt(
    SE_PARTIES.reduce((s,p) => {
      const v = totalV > 0 ? (natPcts[p.id]??0)/totalV*100 : 0;
      const sv = totalS > 0 ? (seats[p.id]??0)/totalS*100 : 0;
      return s + Math.pow(v-sv,2);
    }, 0) / 2
  );

  const sub = SE_PARTIES.filter(p => (natPcts[p.id]??0) < 4).reduce((s,p) => s+(natPcts[p.id]??0), 0);
  const largest = [...SE_LR_ORDER].sort((a,b) => (seats[b]??0)-(seats[a]??0))[0];
  const shortOf = SE_MAJORITY - (seats[largest]??0);

  const ink2   = dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)';
  const ink3   = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const cardBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div>
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{ color: ink3 }}>{title}</div>
        <div className="space-y-1.5">{children}</div>
      </div>
    );
  }
  function Stat({ label, value, sub: s }: { label: string; value: string; sub?: string }) {
    return (
      <div className="flex items-baseline justify-between gap-2" style={{ background: cardBg, borderRadius: 5, padding: '5px 8px' }}>
        <span className="text-[9.5px] font-mono text-ink-3 flex-1">{label}</span>
        <div className="text-right">
          <span className="text-[11px] font-mono font-bold text-ink">{value}</span>
          {s && <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{s}</div>}
        </div>
      </div>
    );
  }

  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit-left' : 'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Breakdown</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Advanced election statistics</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      {totalS === 0 ? (
        <div className="flex items-center justify-center flex-1 text-[11px] font-mono text-ink-3 px-4 text-center">Load results or run simulation first</div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
          <Section title="Two Blocs">
            {[
              { label:'Left Bloc', desc:'V + MP + S', seats:left, color:'#ED1B34' },
              { label:'Centre',    desc:'C',          seats:centre, color:'#009A44' },
              { label:'Right Bloc',desc:'M + SD + KD + L', seats:right, color:'#1B4F8A' },
            ].map(b => (
              <div key={b.label} style={{ background: cardBg, borderRadius:5, padding:'6px 8px', borderLeft:`3px solid ${b.color}` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold text-ink">{b.label}</div>
                    <div className="text-[8px] font-mono" style={{ color: ink2 }}>{b.desc}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-[18px] font-black font-mono" style={{ color: b.color }}>{b.seats}</span>
                    <div className="text-[7.5px] font-mono" style={{ color: b.seats >= SE_MAJORITY ? '#16a34a' : ink3 }}>
                      {b.seats >= SE_MAJORITY ? '✓ majority' : `need ${SE_MAJORITY - b.seats} more`}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                  <div style={{ width:`${Math.min(b.seats/SE_TOTAL_SEATS*100,100)}%`, height:'100%', borderRadius:4, background: b.color }} />
                </div>
              </div>
            ))}
          </Section>

          <Section title="Electoral Statistics">
            <Stat label="Effective No. of Parties (ENP)" value={enp.toFixed(2)} sub="1/Σsᵢ² · higher = more fragmented" />
            <Stat label="Gallagher Index" value={gallagher.toFixed(2)} sub="lower = more proportional" />
            <Stat label="Largest party" value={`${SE_PARTY_MAP[largest].name} — ${seats[largest]??0} seats`} sub={shortOf > 0 ? `${shortOf} short of majority` : '✓ Majority achieved'} />
            <Stat label="Sub-threshold vote waste" value={`${sub.toFixed(1)}%`} sub="votes for parties below 4% — wasted" />
          </Section>

          <Section title="Swing vs 2022">
            {SE_LR_ORDER.filter(id => (natPcts[id]??0)>0.5 || (isBaseline && SE_VOTE_PCT_2022[id]>0)).map(id => {
              const vSwing = (natPcts[id]??0) - SE_VOTE_PCT_2022[id];
              const sSwing = (seats[id]??0) - (SE_PARTY_MAP[id].seats2022??0);
              const color  = partyColor(id);
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px', display:'flex', alignItems:'center', gap:8 }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background:color }} />
                  <span className="text-[10px] font-medium text-ink flex-1">{SE_PARTY_MAP[id].name}</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{ color: vSwing>=0 ? '#16a34a':'#ef4444', minWidth:40, textAlign:'right' }}>
                    {vSwing>=0?'+':''}{vSwing.toFixed(1)}%
                  </span>
                  <span className="text-[9px] font-mono tabular-nums" style={{ color: sSwing>=0?'#16a34a':'#ef4444', minWidth:36, textAlign:'right' }}>
                    {sSwing>=0?'+':''}{sSwing}s
                  </span>
                </div>
              );
            })}
          </Section>

          <Section title="Vote → Seat Translation">
            {SE_LR_ORDER.filter(id => (natPcts[id]??0)>=0.5).map(id => {
              const vPct = totalV>0 ? (natPcts[id]??0)/totalV*100 : 0;
              const sPct = totalS>0 ? (seats[id]??0)/totalS*100 : 0;
              const diff = sPct - vPct;
              const color = partyColor(id);
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9.5px] font-medium text-ink">{SE_PARTY_MAP[id].name}</span>
                    <span className="text-[8.5px] font-mono" style={{ color: Math.abs(diff)<1?ink3:diff>0?'#16a34a':'#ef4444' }}>
                      {diff>0?'+':''}{diff.toFixed(1)}% seat bonus
                    </span>
                  </div>
                  <div className="flex gap-1 items-center">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)' }}>
                      <div style={{ width:`${Math.min(vPct/40*100,100)}%`, height:'100%', background: hexToRgba(color,0.45), borderRadius:4 }} />
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{vPct.toFixed(1)}%v</span>
                  </div>
                  <div className="flex gap-1 items-center mt-0.5">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)' }}>
                      <div style={{ width:`${Math.min(sPct/40*100,100)}%`, height:'100%', background: color, borderRadius:4 }} />
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{sPct.toFixed(1)}%s</span>
                  </div>
                </div>
              );
            })}
          </Section>

          <Section title="Coalition Presets">
            {SE_PRESET_COALITIONS.map(coal => {
              const cs = coal.parties.reduce((s,id) => s+(seats[id as SePartyId]??0), 0);
              const ok = cs >= SE_MAJORITY;
              return (
                <div key={coal.name} style={{ background: cardBg, borderRadius:5, padding:'6px 8px', display:'flex', alignItems:'center', gap:8 }}>
                  <span>{coal.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[9.5px] font-bold text-ink truncate">{coal.name}</div>
                    <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{coal.parties.map(id=>SE_PARTY_MAP[id as SePartyId]?.name).join('+')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-black font-mono" style={{ color: ok?'#16a34a':'#ef4444' }}>{cs}</div>
                    <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{ok?'✓ maj':'✗ no maj'}</div>
                  </div>
                </div>
              );
            })}
          </Section>
        </div>
      )}
    </aside>
  );
}

// ── Tutorial panel ─────────────────────────────────────────────────────────────
function SeTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ c }: { c: string }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P  = ({ c }: { c: string }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  const Note = ({ c }: { c: string }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{c}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Swedish Riksdag Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2 c="The Swedish Electoral System" />
        <P c="Sweden uses Modified Sainte-Laguë proportional representation. Voters choose a party list; seats in the 349-seat Riksdag are allocated proportionally." />
        <Note c="The first divisor is 1.4 (not 1), which slightly disadvantages very small parties. Subsequent divisors are 3, 5, 7, …" />
        <H2 c="The 4% Threshold" />
        <P c="A party must win at least 4% of the national vote to enter the Riksdag. Parties below this threshold receive no seats." />
        <Note c="In 2022, all 8 major parties cleared the threshold. MP (5.1%) and L (4.7%) came closest to falling below." />
        <H2 c="Two Blocs" />
        <P c="Right bloc (Tidökoalitionen): M + SD + KD + L — won 176/349 in 2022, currently governing." />
        <P c="Red-Green bloc: S + V + MP — 148/349 in 2022. C (Centre) sits between blocs." />
        <H2 c="Blank Map Mode" />
        <P c="Click a county, adjust its sliders, set the % reporting, then hit Project Result. The national scoreboard only updates after you project." />
        <H2 c="Simulation" />
        <P c="Set your national vote shares in the Simulation panel, pick a speed, then click Run. Each county reports in 5 random-sized batches on a bell-curve schedule." />
        <H2 c="Parliament View" />
        <P c="Shows 349 seats in a hemicycle sorted left→right by ideology: V · MP · S · C · L · KD · M · SD." />
      </div>
    </aside>
  );
}

// ── Reporting widget ───────────────────────────────────────────────────────────
function SeReportingWidget({ projectedCounties, countyReportingPct, simCountyFractions, isSim, dark }: {
  projectedCounties:  Set<SeCountyId>;
  countyReportingPct: Partial<Record<SeCountyId, number>>;
  simCountyFractions: Partial<Record<SeCountyId, number>>;
  isSim:              boolean;
  dark?:              boolean;
}) {
  const bg = dark ? 'rgba(7,13,28,0.90)' : 'rgba(255,255,255,0.94)';
  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
  const ink2 = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';

  let reportedW = 0, projCount = 0;
  if (isSim) {
    for (const [cId, frac] of Object.entries(simCountyFractions) as [SeCountyId,number][]) {
      reportedW += (SE_COUNTY_WEIGHTS[cId]??0) * (frac??0);
      if ((frac??0) > 0) projCount++;
    }
  } else {
    for (const cId of projectedCounties) {
      const rPct = (countyReportingPct[cId]??100)/100;
      reportedW += (SE_COUNTY_WEIGHTS[cId]??0) * rPct;
      projCount++;
    }
  }
  const reportedPct = Math.min(100, (reportedW / SE_TOTAL_COUNTY_WEIGHT) * 100);

  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none"
      style={{ background: bg, border:`1px solid ${border}`, borderRadius:10, backdropFilter:'blur(10px)', padding:'10px 13px', minWidth:170, boxShadow:'0 4px 20px rgba(0,0,0,0.18)' }}>
      <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{ color: ink2 }}>
        {isSim ? '⚡ Live Count' : '📊 Results'}
      </div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">
        {projCount} <span className="text-[10px] font-semibold" style={{ color: ink2 }}>/ {SE_COUNTIES.length}</span>
      </div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{ color: ink2 }}>{isSim ? 'counties declared' : 'counties projected'}</div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width:`${reportedPct}%`, background: isSim?'#3b82f6':'#16a34a' }} />
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{ color: isSim?'#3b82f6':'#16a34a' }}>{reportedPct.toFixed(1)}% of votes</div>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function SwedenApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Preset / national pcts ─────────────────────────────────────────────────
  const [preset, setPreset]   = useState<'baseline'|'blank'|'polling2026'|'custom'>('polling2026');
  const [natPcts, setNatPcts] = useState<Record<SePartyId,number>>(() => ({ ...SE_VOTE_PCT_2026 }));

  function loadBaseline()    { setNatPcts({...SE_VOTE_PCT_2022}); setPreset('baseline'); resetMapState(); }
  function loadPolling2026() { setNatPcts({...SE_VOTE_PCT_2026}); setPreset('polling2026'); resetMapState(); }
  function loadBlank()       { setNatPcts(Object.fromEntries(SE_PARTIES.map(p=>[p.id,100/SE_PARTIES.length])) as Record<SePartyId,number>); setPreset('blank'); resetMapState(); }

  function resetMapState() {
    setSimSeats(undefined); setDeclaredCounties(undefined);
    setCountyOverrides({}); setProjectedCounties(new Set());
    setCountyReportingPct({}); setSimCountyFractions({});
    setCountyDraft(null); setSimNatPcts(null);
    stopSim();
  }

  // ── County overrides (blank map) ───────────────────────────────────────────
  const [countyOverrides, setCountyOverrides]       = useState<Partial<Record<SeCountyId,Partial<Record<SePartyId,number>>>>>({});
  const [projectedCounties, setProjectedCounties]   = useState<Set<SeCountyId>>(new Set());
  const [countyReportingPct, setCountyReportingPct] = useState<Partial<Record<SeCountyId,number>>>({});
  // Live draft from the open county panel — updates on every slider drag
  const [countyDraft, setCountyDraft] = useState<SeCountyDraft|null>(null);

  const blankDisplayPcts = useMemo<Record<SePartyId,number>>(() => {
    const zero = Object.fromEntries(SE_PARTIES.map(p=>[p.id,0])) as Record<SePartyId,number>;
    if (preset !== 'blank') return zero;
    const weighted: Partial<Record<SePartyId,number>> = {};
    let totalW = 0;
    // Only committed (projected) counties contribute — draft is live-only until button click
    for (const cId of projectedCounties) {
      const cv   = calcCountyVotes(natPcts, cId, countyOverrides[cId]);
      const rPct = (countyReportingPct[cId]??100)/100;
      const w    = (SE_COUNTY_WEIGHTS[cId]??0) * rPct;
      for (const p of SE_PARTIES) weighted[p.id] = (weighted[p.id]??0) + (cv[p.id]??0) * w;
      totalW += w;
    }
    if (totalW === 0) return zero;
    return Object.fromEntries(SE_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<SePartyId,number>;
  }, [preset, projectedCounties, countyOverrides, countyReportingPct, natPcts]);

  const blankVoteScale = useMemo(() => {
    if (preset !== 'blank') return 1;
    const projW = [...projectedCounties]
      .reduce((s,cId) => s + (SE_COUNTY_WEIGHTS[cId]??0) * ((countyReportingPct[cId]??100)/100), 0);
    return Math.min(1, projW / SE_TOTAL_COUNTY_WEIGHT);
  }, [preset, projectedCounties, countyReportingPct]);

  // For 2022/2026 modes: if any counties are overridden, reflect them in the national display
  const overrideDisplayPcts = useMemo<Record<SePartyId,number>>(() => {
    const hasAny = Object.values(countyOverrides).some(o => o && Object.keys(o).length > 0);
    if (!hasAny) return natPcts;
    const weighted: Partial<Record<SePartyId,number>> = {};
    let totalW = 0;
    for (const c of SE_COUNTIES) {
      const cv = calcCountyVotes(natPcts, c.id, countyOverrides[c.id]);
      const w  = SE_COUNTY_WEIGHTS[c.id] ?? 0;
      for (const p of SE_PARTIES) weighted[p.id] = (weighted[p.id]??0) + (cv[p.id]??0) * w;
      totalW += w;
    }
    if (totalW === 0) return natPcts;
    return Object.fromEntries(SE_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<SePartyId,number>;
  }, [natPcts, countyOverrides]);

  const displayPcts = preset === 'blank' ? blankDisplayPcts : overrideDisplayPcts;

  // ── UI state ───────────────────────────────────────────────────────────────
  const [selectedCounty, setSelectedCounty] = useState<SeCountyId|null>(null);
  const [bubbleMap,   setBubbleMap]         = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [hiddenParties, setHiddenParties]   = useState<Set<SePartyId>>(new Set());

  // Panel state — left and right sides are mutually exclusive on same side
  const [leftPanel,  setLeftPanel]  = useState<'parties'|'parli'|'breakdown'|null>(null);
  const [rightPanel, setRightPanel] = useState<'sim'|'tutorial'|'coalition'|null>(null);
  const [exitLeft,   setExitLeft]   = useState<string|null>(null);
  const [exitRight,  setExitRight]  = useState<string|null>(null);

  const exitTimerL = useRef<ReturnType<typeof setTimeout>|null>(null);
  const exitTimerR = useRef<ReturnType<typeof setTimeout>|null>(null);

  const openLeft  = useCallback((panel: 'parties'|'parli'|'breakdown') => {
    if (leftPanel === panel) {
      setExitLeft(panel);
      setLeftPanel(null);
      exitTimerL.current = setTimeout(() => setExitLeft(null), 280);
    } else {
      if (leftPanel) { setExitLeft(leftPanel); exitTimerL.current = setTimeout(() => setExitLeft(null), 280); }
      setLeftPanel(panel);
    }
  }, [leftPanel]);

  const openRight = useCallback((panel: 'sim'|'tutorial'|'coalition') => {
    if (rightPanel === panel) {
      setExitRight(panel);
      setRightPanel(null);
      exitTimerR.current = setTimeout(() => setExitRight(null), 280);
    } else {
      if (rightPanel) { setExitRight(rightPanel); exitTimerR.current = setTimeout(() => setExitRight(null), 280); }
      if (panel === 'sim') setSelectedCounty(null);
      setRightPanel(panel);
    }
  }, [rightPanel]);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = headerScrollRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX)>Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft+=e.deltaY; };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // ── Simulation ─────────────────────────────────────────────────────────────
  const [simDraftPcts,       setSimDraftPcts]       = useState<Record<SePartyId,number>>(() => ({...SE_VOTE_PCT_2026}));
  const [simDraftLocks,      setSimDraftLocks]       = useState<Set<SePartyId>>(new Set());
  const [, setSimDraftTouched]     = useState(false);
  const [simDuration,        setSimDuration]         = useState<60000|120000|300000|600000>(120000);
  const [simNatPcts,         setSimNatPcts]          = useState<Record<SePartyId,number>|null>(null);
  const [simSeats,           setSimSeats]            = useState<Partial<Record<SePartyId,number>>|undefined>();
  const [simProgress,        setSimProgress]         = useState(0);
  const [simRunning,         setSimRunning]          = useState(false);
  const [declaredCounties,   setDeclaredCounties]    = useState<Set<SeCountyId>|undefined>();
  const [simCountyFractions, setSimCountyFractions]  = useState<Partial<Record<SeCountyId,number>>>({});
  const simTimersRef     = useRef<ReturnType<typeof setTimeout>[]>([]);
  const simNatPctsRef    = useRef<Record<SePartyId,number>>(natPcts);

  // Initialise sim draft when panel opens
  useEffect(() => {
    if (rightPanel === 'sim') { setSimDraftPcts({...natPcts}); setSimDraftTouched(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanel === 'sim']);

  const simEffLocks = useMemo(() => new Set<SePartyId>([...simDraftLocks,...hiddenParties]), [simDraftLocks, hiddenParties]);
  const [simSortOrder] = useState<SePartyId[]>(() => SE_LR_ORDER.slice());

  function stopSim() { simTimersRef.current.forEach(clearTimeout); simTimersRef.current = []; setSimRunning(false); }

  function runSim() {
    stopSim();
    setSimDraftTouched(false);
    simNatPctsRef.current = { ...simDraftPcts };
    setSimNatPcts({ ...simDraftPcts });

    const PARTS     = 5;
    const totalCnts = SE_COUNTIES.length;
    const allTimes  = seBellCurveTimes(PARTS * totalCnts, simDuration);
    const cntIds    = [...SE_COUNTIES.map(c => c.id)].sort(() => Math.random()-0.5);
    const events: { cId: SeCountyId; cumFrac: number; t: number }[] = [];

    for (let ci = 0; ci < totalCnts; ci++) {
      const cId        = cntIds[ci];
      const cntTimes   = allTimes.slice(ci*PARTS,(ci+1)*PARTS).sort((a,b)=>a-b);
      const cuts       = [0,Math.random(),Math.random(),Math.random(),Math.random(),1].sort((a,b)=>a-b);
      const sizes      = cuts.slice(1).map((c,i)=>c-cuts[i]);
      let cumFrac = 0;
      for (let b=0; b<PARTS; b++) {
        cumFrac = Math.min(1, cumFrac + sizes[b]);
        events.push({ cId, cumFrac, t: cntTimes[b] });
      }
    }
    events.sort((a,b)=>a.t-b.t);

    setSimRunning(true); setSimProgress(0);
    setSimSeats(undefined); setDeclaredCounties(new Set()); setSimCountyFractions({});

    const localFrac: Partial<Record<SeCountyId,number>> = {};
    const localDecl  = new Set<SeCountyId>();
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const ev of events) {
      timers.push(setTimeout(() => {
        localFrac[ev.cId] = ev.cumFrac;
        if (ev.cumFrac >= 0.999) localDecl.add(ev.cId);
        const fracSnap = {...localFrac};
        const declSnap = new Set(localDecl);
        setSimCountyFractions(fracSnap);
        setDeclaredCounties(declSnap);
        setSimProgress(Object.keys(fracSnap).length);
        setSimSeats(calcPartialSeats(simNatPctsRef.current, fracSnap));
        if (Object.values(fracSnap).every(f=>(f??0)>=0.999) && Object.keys(fracSnap).length >= totalCnts) {
          setSimSeats(calcSainteLague(simNatPctsRef.current));
          setSimRunning(false);
        }
      }, ev.t));
    }
    simTimersRef.current = timers;
  }

  const displaySeats = useMemo(() => simSeats ?? calcSainteLague(displayPcts), [simSeats, displayPcts]);

  // ── Derived display state ──────────────────────────────────────────────────
  const showCounty     = !!selectedCounty && rightPanel !== 'sim' && !simRunning;
  const showParli      = leftPanel === 'parli'     || exitLeft === 'parli';
  const showBreakdown  = leftPanel === 'breakdown'  || exitLeft === 'breakdown';
  const showTutorial   = rightPanel === 'tutorial' || exitRight === 'tutorial';
  const showCoalition  = rightPanel === 'coalition'|| exitRight === 'coalition';

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="se">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4">
          <GlobeLogo />
        </button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <img src={`${import.meta.env.BASE_URL}sweden-flag.png`} alt="Sweden" className="h-4 rounded-[2px] shrink-0 opacity-90" />
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">Sweden</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button onClick={loadBaseline}    className={preset==='baseline'   ?btnGold:btnMuted}>2022 Baseline</button>
          <button onClick={loadPolling2026} className={preset==='polling2026'?btnGold:btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset==='blank'      ?btnGold:btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button onClick={() => openRight('sim')}       className={rightPanel==='sim'      ?btnActive:btnMuted}>▶ Simulation</button>
          <button onClick={() => !simRunning && openLeft('parties')} disabled={simRunning} className={`${leftPanel==='parties'?btnActive:btnMuted}${simRunning?' opacity-40 cursor-not-allowed':''}`}>Parties</button>
          <button onClick={() => setScoreboardVisible(v=>!v)} className={scoreboardVisible  ?btnActive:btnMuted}>Scoreboard</button>
          <button onClick={() => openLeft('breakdown')}  className={leftPanel==='breakdown' ?btnActive:btnMuted}>Breakdown</button>
          <button onClick={() => openRight('coalition')} className={rightPanel==='coalition'?btnActive:btnMuted}>Coalition</button>
          <button onClick={() => openLeft('parli')}      className={leftPanel==='parli'     ?btnActive:btnMuted}>Parliament</button>
          <button onClick={() => setBubbleMap(v=>!v)}    className={bubbleMap?`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`:btnMuted}>Bubble Map</button>
          <button onClick={() => openRight('tutorial')}  className={rightPanel==='tutorial' ?btnActive:btnMuted}>Tutorial</button>
        </div>
        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v=>!v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors" title="Toggle dark mode">
            {dark ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── Scoreboard ─────────────────────────────────────────────────────── */}
      {scoreboardVisible && (
        <SeScoreboard
          natPcts={displayPcts}
          simSeats={simSeats}
          isBaseline={preset==='baseline'}
          is2026={preset!=='baseline'}
          dark={dark}
          reportedVoteScale={preset==='blank' ? blankVoteScale : undefined}
        />
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT panels */}
        {leftPanel==='parties' && <SePartiesPanel hiddenParties={hiddenParties} onToggle={id=>setHiddenParties(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})} onClose={()=>openLeft('parties')} dark={dark} />}
        {showParli     && <SeParliamentPanel  seats={displaySeats} onClose={()=>openLeft('parli')}     exiting={exitLeft==='parli'}    dark={dark} />}
        {showBreakdown && <SeBreakdownPanel   seats={displaySeats} natPcts={displayPcts} isBaseline={preset==='baseline'} onClose={()=>openLeft('breakdown')} exiting={exitLeft==='breakdown'} dark={dark} />}

        {/* MAP */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <SeMapView
            natPcts={natPcts}
            selectedCounty={selectedCounty}
            onSelect={c => setSelectedCounty(prev => prev===c ? null : c)}
            dark={dark} bubbleMap={bubbleMap}
            declaredCounties={declaredCounties}
            countyOverrides={countyOverrides}
            blankMode={preset==='blank'}
            projectedCounties={projectedCounties}
            simCountyFractions={simCountyFractions}
            countyDraft={preset==='blank' ? countyDraft : null}
            simNatPcts={simNatPcts}
          />
          {(preset==='blank'||simRunning||simSeats!=null) && (
            <SeReportingWidget
              projectedCounties={projectedCounties}
              countyReportingPct={countyReportingPct}
              simCountyFractions={simCountyFractions}
              isSim={simRunning||(simSeats!=null&&preset!=='blank')}
              dark={dark}
            />
          )}
        </div>

        {/* RIGHT panels */}
        {rightPanel==='sim' && (
          <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Adjust shares · then run</p>
              </div>
              <button onClick={()=>openRight('sim')} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>

            {/* Speed picker */}
            <div className="px-3.5 pt-2.5 pb-2 border-b border-default shrink-0">
              <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Simulation speed</div>
              <div className="flex gap-1.5">
                {([['1 min','60s',60000],['2 min','2m',120000],['5 min','5m',300000],['10 min','10m',600000]] as const).map(([label,sub,ms])=>(
                  <button key={ms} onClick={()=>setSimDuration(ms)}
                    className={`flex-1 py-1 rounded-[4px] border text-[9px] font-mono font-bold transition-colors ${simDuration===ms?'bg-blue-600 text-white border-blue-600':'border-default text-ink-3 hover:bg-hover'}`}>
                    {label}<div className="text-[7px] opacity-70">{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
              {simSortOrder.filter(id=>!hiddenParties.has(id)).map(id => {
                const party    = SE_PARTY_MAP[id];
                const pct      = simDraftPcts[id] ?? 0;
                const isLocked = simDraftLocks.has(id);
                const color    = partyColor(id);
                const rawVotes = Math.round(pct/100*SE_GRAND_TOTAL_VOTES);
                return (
                  <div key={id}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                      <button onClick={()=>setSimDraftLocks(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})}
                        className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`}>
                        {isLocked
                          ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                          : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                      </button>
                      <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>{pct.toFixed(1)}%</span>
                    </div>
                    <input type="range" min={0} max={55} step={0.1} value={pct} disabled={isLocked}
                      onChange={e=>{ setSimDraftPcts(redistributePcts(simDraftPcts,id,parseFloat(e.target.value),simEffLocks)); setSimDraftTouched(true); }}
                      className="br-party-slider w-full"
                      style={{'--party-color':color,'--pct':`${(pct/55)*100}%`} as React.CSSProperties}
                    />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[8px] font-mono" style={{ color: dark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.28)' }}>~{fmtN(rawVotes)}</span>
                      <span className="text-[7.5px] font-mono" style={{ color: pct>=4?'#16a34a':'#f59e0b' }}>{pct>=4?'✓ above 4%':'⚠ below 4%'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button disabled={simRunning} onClick={runSim}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {simRunning ? `${simProgress}/${SE_COUNTIES.length} reporting…` : '▶ Run Simulation'}
              </button>
              {(simSeats||declaredCounties) && (
                <button onClick={()=>{stopSim();setSimSeats(undefined);setDeclaredCounties(undefined);setSimProgress(0);setSimCountyFractions({});setSimNatPcts(null);}}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
                  Reset
                </button>
              )}
            </div>
          </aside>
        )}

        {showCounty && selectedCounty && (
          <SeCountyPanel
            key={selectedCounty}
            countyId={selectedCounty}
            natPcts={natPcts}
            countyOverride={countyOverrides[selectedCounty]}
            onOverride={pcts=>setCountyOverrides(prev=>({...prev,[selectedCounty]:pcts}))}
            onResetOverride={()=>{ setCountyOverrides(prev=>{const n={...prev};delete n[selectedCounty];return n;}); setProjectedCounties(prev=>{const n=new Set(prev);n.delete(selectedCounty);return n;}); setCountyDraft(null); }}
            onClose={()=>{ setSelectedCounty(null); setCountyDraft(null); }}
            isBlankMode={preset==='blank'}
            isProjected={projectedCounties.has(selectedCounty)}
            reportingPct={countyReportingPct[selectedCounty]??100}
            onProject={()=>setProjectedCounties(prev=>new Set([...prev,selectedCounty]))}
            onReportingPctChange={pct=>setCountyReportingPct(prev=>({...prev,[selectedCounty]:pct}))}
            onDraftChange={preset==='blank' ? (pcts,rpt)=>setCountyDraft({countyId:selectedCounty,pcts,rptPct:rpt}) : undefined}
            hiddenParties={hiddenParties}
            dark={dark}
          />
        )}

        {showTutorial  && <SeTutorialPanel  onClose={()=>openRight('tutorial')}  exiting={exitRight==='tutorial'}  dark={dark} />}
        {showCoalition && <SeCoalitionPanel seats={displaySeats} onClose={()=>openRight('coalition')} exiting={exitRight==='coalition'} dark={dark} />}
      </div>
    </div>
  );
}
