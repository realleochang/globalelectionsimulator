// Generate src/data/southKorea2024.ts from validated districts.json + pr.wikitext.
const fs = require('fs');
const path = require('path');

const districts = require('./districts.json');
const romanized = require('./romanized.json'); // SGG_Code -> readable English name

// ── party mapping: ko.wp 정당 name -> KrPartyId ───────────────────────────────
const PARTY_MAP = {
  '더불어민주당': 'DPK',
  '국민의힘': 'PPP',
  '더불어민주연합': 'DEMALL',   // DPK PR satellite
  '국민의미래': 'PFP',          // PPP PR satellite
  '조국혁신당': 'RKP',          // Rebuilding Korea
  '개혁신당': 'REF',            // (New) Reform Party
  '새로운미래': 'NFP',          // New Future
  '진보당2017': 'PROG',         // Progressive
  '녹색정의당': 'GJP',          // Green Justice
  '자유통일당2022': 'LUP',      // Liberty Unification
  '무소속': 'IND',
};
const toPid = (koName) => PARTY_MAP[koName] || 'OTH';

// ── region: ko.wp SIDO abbr -> code + English name ────────────────────────────
const SIDO = {
  '서울': ['11', 'Seoul'], '부산': ['21', 'Busan'], '대구': ['22', 'Daegu'],
  '인천': ['23', 'Incheon'], '광주': ['24', 'Gwangju'], '대전': ['25', 'Daejeon'],
  '울산': ['26', 'Ulsan'], '세종': ['29', 'Sejong'], '경기': ['31', 'Gyeonggi'],
  '강원': ['32', 'Gangwon'], '충북': ['33', 'Chungbuk'], '충남': ['34', 'Chungnam'],
  '전북': ['35', 'Jeonbuk'], '전남': ['36', 'Jeonnam'], '경북': ['37', 'Gyeongbuk'],
  '경남': ['38', 'Gyeongnam'], '제주': ['39', 'Jeju'],
};

// ── build district records (sorted by SGG_Code → stable nr 1..254) ────────────
districts.sort((a, b) => a.code.localeCompare(b.code));
let nr = 0;
const recs = districts.map((d) => {
  nr++;
  const votes = {};
  let winnerName = '', winnerPid = '';
  for (const c of d.candidates) {
    const pid = toPid(c.party);
    votes[pid] = (votes[pid] || 0) + c.votes;
    if (c.won) { winnerName = c.name; winnerPid = pid; }
  }
  const code = d.code;
  const name = romanized[code] || d.sgg; // romanized English district name
  const sidoCode = SIDO[d.sido][0];
  return { nr, code, name, sidoCode, sido: d.sido, electorate: d.electorate, validVotes: d.totalValid, votes, winnerName, winnerPid };
});

// sanity: votes sum ≈ validVotes
let sumWarn = 0;
for (const r of recs) {
  const s = Object.values(r.votes).reduce((a, b) => a + b, 0);
  if (Math.abs(s - r.validVotes) > 2) sumWarn++;
}
console.log('districts:', recs.length, '| vote-sum mismatches:', sumWarn);

// ── PR votes (parse pr.wikitext) ──────────────────────────────────────────────
const prTxtFull = fs.readFileSync(path.join(__dirname, 'pr.wikitext'), 'utf8');
// national-results section only (the page also repeats every party in 지역별/정당별 sections)
const prTxt = prTxtFull.slice(
  prTxtFull.indexOf('== 전국 결과 =='),
  prTxtFull.indexOf('== 지역별 결과 =='),
);
const prVotes = {};
let prGrand = 0;
const prRe = /\{\{(?:당선 )?비례대표 개표결과[^}]*?정당=([^|}]+?)\s*\|[^}]*?득표수=([0-9,]+)/g;
let pm;
while ((pm = prRe.exec(prTxt)) !== null) {
  const pid = toPid(pm[1].trim());
  const v = parseInt(pm[2].replace(/,/g, ''), 10);
  prVotes[pid] = (prVotes[pid] || 0) + v;
  prGrand += v;
}
console.log('PR grand total:', prGrand.toLocaleString(), '| PR parties:', Object.keys(prVotes).join(','));
console.log('PR votes:', JSON.stringify(prVotes));

// ── emit TS ───────────────────────────────────────────────────────────────────
const PVAL = (o) => '{ ' + Object.entries(o).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ') + ' }';

const districtLines = recs.map(r => {
  const wn = r.winnerName.replace(/'/g, "\\'");
  const sn = SIDO[r.sido][1];
  return `mkD(${r.nr}, '${r.code}', '${r.name}', '${r.sidoCode}', '${sn}', ${r.electorate}, ${r.validVotes}, ${PVAL(r.votes)}, '${wn}', '${r.winnerPid}'),`;
}).join('\n');

const prLines = Object.entries(prVotes).filter(([k]) => k !== 'OTH')
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v},`).join('\n');

const header = `// South Korea — 22nd National Assembly election (April 10, 2024)
// 254 constituency seats (FPTP) + 46 proportional seats (준연동형 / quasi-MMP) = 300
// Sources: NEC official results (via ko.wikipedia regional result pages, CC BY-SA);
//          254-district boundary geojson by OhmyNews (2024_22_elec_map).
// PR allocation: semi-linked formula, all 46 seats linked (no 30-seat cap, no parallel tier).
//   Threshold: ≥3% national PR vote OR ≥5 constituency seats.
//   Verified to reproduce the official 18/14/12/2 PR split exactly.

export type KrPartyId =
  | 'DPK' | 'PPP' | 'DEMALL' | 'PFP' | 'RKP' | 'REF'
  | 'NFP' | 'PROG' | 'GJP' | 'LUP' | 'IND' | 'OTH';

export interface KrParty {
  id: KrPartyId;
  name: string;       // short English / abbr
  nameKo: string;     // Korean name
  fullName: string;
  color: string;
  darkColor?: string; // override for dark mode if base is too dark
  order: number;      // ideology left→right (for parliament seating)
  tier: 'const' | 'pr' | 'both';
  parentId?: KrPartyId; // satellite → parent (PR satellites of the two majors)
}

// Ordered left → right by ideology
export const KR_PARTIES: KrParty[] = [
  { id: 'PROG',   name: 'PROG',  nameKo: '진보당',         fullName: 'Progressive Party',            color: '#E5007F', order: 1,  tier: 'const' },
  { id: 'GJP',    name: 'GJP',   nameKo: '녹색정의당',     fullName: 'Green Justice Party',          color: '#00A651', order: 2,  tier: 'both'  },
  { id: 'RKP',    name: 'RKP',   nameKo: '조국혁신당',     fullName: 'Rebuilding Korea Party',       color: '#1B3A8B', darkColor: '#5B8DEF', order: 3,  tier: 'pr' },
  { id: 'DEMALL', name: 'DemAll',nameKo: '더불어민주연합', fullName: 'Democratic Alliance (DPK list)', color: '#0067AC', order: 4,  tier: 'pr', parentId: 'DPK' },
  { id: 'DPK',    name: 'DPK',   nameKo: '더불어민주당',   fullName: 'Democratic Party of Korea',    color: '#004EA2', darkColor: '#3C7DD9', order: 5,  tier: 'const' },
  { id: 'NFP',    name: 'NFP',   nameKo: '새로운미래',     fullName: 'New Future Party',             color: '#00B0B9', order: 6,  tier: 'both' },
  { id: 'REF',    name: 'REF',   nameKo: '개혁신당',       fullName: 'Reform Party',                 color: '#FF7210', order: 7,  tier: 'both' },
  { id: 'PPP',    name: 'PPP',   nameKo: '국민의힘',       fullName: 'People Power Party',           color: '#E61E2B', order: 8,  tier: 'const' },
  { id: 'PFP',    name: 'PFP',   nameKo: '국민의미래',     fullName: 'People Future Party (PPP list)', color: '#C9151E', order: 9, tier: 'pr', parentId: 'PPP' },
  { id: 'LUP',    name: 'LUP',   nameKo: '자유통일당',     fullName: 'Liberty Unification Party',     color: '#2E3192', order: 10, tier: 'both' },
  { id: 'IND',    name: 'IND',   nameKo: '무소속',         fullName: 'Independent',                  color: '#8A8A8A', order: 11, tier: 'const' },
  { id: 'OTH',    name: 'OTH',   nameKo: '기타',           fullName: 'Other parties',                color: '#B6B6B6', order: 12, tier: 'both' },
];

export const KR_PARTY_MAP: Record<KrPartyId, KrParty> =
  Object.fromEntries(KR_PARTIES.map(p => [p.id, p])) as Record<KrPartyId, KrParty>;

export const ASSEMBLY_TOTAL    = 300;
export const CONSTITUENCY_SEATS = 254;
export const PR_SEATS          = 46;
export const PR_THRESHOLD_PCT  = 3.0;   // ≥3% national PR vote …
export const DIRECT_THRESHOLD  = 5;     // … OR ≥5 constituency seats → PR-eligible
export const MAJORITY          = Math.floor(ASSEMBLY_TOTAL / 2) + 1; // 151

export interface KrDistrict {
  nr:         number;                         // 1..254 (stable internal id)
  code:       string;                         // NEC SGG_Code (geojson join key)
  name:       string;                         // Korean constituency name
  state:      string;                         // region code (see SIDO_NAMES)
  stateName:  string;                         // region English name
  electorate: number;                         // registered electors (유권자)
  validVotes: number;                         // total valid votes (합계)
  votes:      Partial<Record<KrPartyId, number>>; // constituency votes by party
  winnerName: string;                         // winning candidate (Korean)
  winnerParty: KrPartyId;
}

function mkD(
  nr: number, code: string, name: string, state: string, stateName: string,
  electorate: number, validVotes: number,
  votes: Partial<Record<KrPartyId, number>>, winnerName: string, winnerParty: KrPartyId,
): KrDistrict {
  return { nr, code, name, state, stateName, electorate, validVotes, votes, winnerName, winnerParty };
}

// ── 254 constituencies — official 2024 results ────────────────────────────────
export const KR_DISTRICTS: KrDistrict[] = [
${districtLines}
];

// geojson SGG_Code → internal nr
export const KR_CODE_TO_NR: Record<string, number> =
  Object.fromEntries(KR_DISTRICTS.map(d => [d.code, d.nr]));

// ── Official 2024 party-list (PR) votes ───────────────────────────────────────
export const PR_VOTES_2024: Partial<Record<KrPartyId, number>> = {
${prLines}
};
export const PR_GRAND_TOTAL_2024 = ${prGrand};

// ── Region names (17 first-level divisions) ───────────────────────────────────
export const SIDO_NAMES: Record<string, string> = {
  '11': 'Seoul', '21': 'Busan', '22': 'Daegu', '23': 'Incheon', '24': 'Gwangju',
  '25': 'Daejeon', '26': 'Ulsan', '29': 'Sejong', '31': 'Gyeonggi', '32': 'Gangwon',
  '33': 'Chungbuk', '34': 'Chungnam', '35': 'Jeonbuk', '36': 'Jeonnam',
  '37': 'Gyeongbuk', '38': 'Gyeongnam', '39': 'Jeju',
};
export const SIDO_NAMES_KO: Record<string, string> = {
  '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주',
  '25': '대전', '26': '울산', '29': '세종', '31': '경기', '32': '강원',
  '33': '충북', '34': '충남', '35': '전북', '36': '전남',
  '37': '경북', '38': '경남', '39': '제주',
};

// ── Party leaders (wikiTitle drives Wikipedia photo fetch) ─────────────────────
export const KR_LEADERS: Partial<Record<KrPartyId, { name: string; wikiTitle?: string }>> = {
  DPK:    { name: 'Lee Jae-myung',  wikiTitle: 'Lee_Jae-myung' },
  PPP:    { name: 'Han Dong-hoon',  wikiTitle: 'Han_Dong-hoon' },
  RKP:    { name: 'Cho Kuk',        wikiTitle: 'Cho_Kuk' },
  REF:    { name: 'Lee Jun-seok',   wikiTitle: 'Lee_Jun-seok' },
  NFP:    { name: 'Lee Nak-yon',    wikiTitle: 'Lee_Nak-yon' },
  PROG:   { name: 'Yoon Jong-oh' },
  GJP:    { name: 'Sim Sang-jung',  wikiTitle: 'Sim_Sang-jung' },
  DEMALL: { name: 'Democratic Alliance' },
  PFP:    { name: 'People Future Party' },
  LUP:    { name: 'Liberty Unification' },
  IND:    { name: 'Independents' },
  OTH:    { name: 'Others' },
};
// Current party leaders as of May 2026 (post-2025 realignment: Lee Jae-myung president;
// shown on the 2026-polling, blank-map and simulation scoreboards). Names verified via
// live sources; only Jang Dong-hyuk has a confirmed English-Wikipedia photo.
export const KR_LEADERS_2026: Partial<Record<KrPartyId, { name: string; wikiTitle?: string }>> = {
  DPK:  { name: 'Jung Cheong-rae', wikiTitle: 'Jung_Chung-rae' },              // 정청래 — DPK leader
  PPP:  { name: 'Jang Dong-hyuk',  wikiTitle: 'Jang_Dong-hyuk' },              // 장동혁 — PPP leader
  PROG: { name: 'Kim Jae-yeon',    wikiTitle: 'Kim_Jae-yeon_(politician)' },   // 김재연 — Progressive co-chair
  GJP:  { name: 'Kwon Young-guk',  wikiTitle: 'Kwon_Yeong-guk' },              // 권영국 — Justice Party leader
  // RKP (Cho Kuk), REF (Lee Jun-seok), NFP (Lee Nak-yon) unchanged — fall back to KR_LEADERS.
};

// ── Seat allocation ───────────────────────────────────────────────────────────
// FPTP constituency winners
export function calcConstituencySeats(
  districts: KrDistrict[],
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>,
): Partial<Record<KrPartyId, number>> {
  const tally: Partial<Record<KrPartyId, number>> = {};
  for (const d of districts) {
    const res = currentResults[d.nr] ?? d.votes;
    let winner: KrPartyId | null = null, max = 0;
    for (const [pid, v] of Object.entries(res) as [KrPartyId, number][]) {
      if (v > max) { max = v; winner = pid; }
    }
    if (winner) tally[winner] = (tally[winner] ?? 0) + 1;
  }
  return tally;
}

// largest-remainder allocation of \`seats\` proportional to \`weights\`
function largestRemainder(ids: KrPartyId[], weights: Record<string, number>, seats: number): Partial<Record<KrPartyId, number>> {
  const out: Partial<Record<KrPartyId, number>> = {};
  const wsum = ids.reduce((s, id) => s + (weights[id] ?? 0), 0);
  if (wsum <= 0 || seats <= 0) { for (const id of ids) out[id] = 0; return out; }
  const rema: [KrPartyId, number][] = [];
  let used = 0;
  for (const id of ids) {
    const q = (weights[id] ?? 0) / wsum * seats;
    const f = Math.floor(q);
    out[id] = f; used += f; rema.push([id, q - f]);
  }
  rema.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < seats - used; i++) out[rema[i % rema.length][0]] = (out[rema[i % rema.length][0]] ?? 0) + 1;
  return out;
}

// 준연동형 (semi-linked) PR allocation — all 46 seats linked (2024 rules)
export function calcPRSeats(
  prVotes: Partial<Record<KrPartyId, number>>,
  constituencySeats: Partial<Record<KrPartyId, number>>,
): { prSeats: Partial<Record<KrPartyId, number>>; eligible: Set<KrPartyId> } {
  let grand = 0;
  for (const v of Object.values(prVotes)) grand += v ?? 0;

  // eligible: ≥3% PR OR ≥5 constituency seats (Others never seated via PR here)
  const eligible = new Set<KrPartyId>();
  for (const p of KR_PARTIES) {
    if (p.id === 'OTH' || p.id === 'IND') continue;
    const pct = grand > 0 ? ((prVotes[p.id] ?? 0) / grand) * 100 : 0;
    if (pct >= PR_THRESHOLD_PCT || (constituencySeats[p.id] ?? 0) >= DIRECT_THRESHOLD) eligible.add(p.id);
  }

  // X = constituency winners from NON-eligible parties / independents
  let X = 0;
  for (const [pid, n] of Object.entries(constituencySeats) as [KrPartyId, number][]) {
    if (!eligible.has(pid)) X += n;
  }

  // normalized PR share among eligible *list* parties
  const elig = [...eligible];
  const eligVoteSum = elig.reduce((s, id) => s + (prVotes[id] ?? 0), 0);

  const linked: Record<string, number> = {};
  let linkedSum = 0;
  for (const id of elig) {
    const share = eligVoteSum > 0 ? (prVotes[id] ?? 0) / eligVoteSum : 0;
    const raw = ((ASSEMBLY_TOTAL - X) * share - (constituencySeats[id] ?? 0)) / 2;
    const v = Math.max(0, Math.round(raw));
    linked[id] = v; linkedSum += v;
  }

  let prSeats: Partial<Record<KrPartyId, number>>;
  if (linkedSum <= PR_SEATS) {
    // assign linked, then distribute remainder in parallel by PR share
    prSeats = {};
    for (const id of elig) prSeats[id] = linked[id];
    const remain = PR_SEATS - linkedSum;
    if (remain > 0) {
      const shares: Record<string, number> = {};
      for (const id of elig) shares[id] = prVotes[id] ?? 0;
      const extra = largestRemainder(elig, shares, remain);
      for (const id of elig) prSeats[id] = (prSeats[id] ?? 0) + (extra[id] ?? 0);
    }
  } else {
    // scale down: allocate all 46 proportional to linked values (조정의석)
    prSeats = largestRemainder(elig, linked, PR_SEATS);
  }
  return { prSeats, eligible };
}

export interface AssemblyResult {
  constituencySeats: Partial<Record<KrPartyId, number>>;
  prSeats:           Partial<Record<KrPartyId, number>>;
  totalSeats:        Partial<Record<KrPartyId, number>>;
  eligible:          Set<KrPartyId>;
}

export function calcAssembly(
  districts: KrDistrict[],
  currentResults: Record<number, Partial<Record<KrPartyId, number>>>,
  prVotes: Partial<Record<KrPartyId, number>>,
): AssemblyResult {
  const constituencySeats = calcConstituencySeats(districts, currentResults);
  const { prSeats, eligible } = calcPRSeats(prVotes, constituencySeats);
  const totalSeats: Partial<Record<KrPartyId, number>> = {};
  for (const p of KR_PARTIES) {
    const t = (constituencySeats[p.id] ?? 0) + (prSeats[p.id] ?? 0);
    if (t > 0) totalSeats[p.id] = t;
  }
  return { constituencySeats, prSeats, totalSeats, eligible };
}
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'southKorea2024.ts'), header, 'utf8');
console.log('Wrote src/data/southKorea2024.ts');
