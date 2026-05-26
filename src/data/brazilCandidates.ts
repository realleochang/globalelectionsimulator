export type BrCandidateId = 'LUL' | 'BOL' | 'TEB' | 'CIR' | 'SOR' | 'DAV' | 'KEL' | 'PER' | 'SOF' | 'VER' | 'EYM';

export type BrCandidate = {
  id: BrCandidateId;
  name: string;
  party: string;
  color: string;
  r1Votes: number;
  r1Pct: number;
};

export const BR_CANDIDATES: BrCandidate[] = [
  { id: 'LUL', name: 'Luiz Inácio Lula da Silva', party: 'PT — Partido dos Trabalhadores',        color: '#CC0000', r1Votes: 57_259_504, r1Pct: 48.43 },
  { id: 'BOL', name: 'Jair Bolsonaro',             party: 'PL — Partido Liberal',                  color: '#003087', r1Votes: 51_072_345, r1Pct: 43.20 },
  { id: 'TEB', name: 'Simone Tebet',               party: 'MDB — Mov. Democrático Brasileiro',     color: '#009900', r1Votes:  4_915_423, r1Pct:  4.16 },
  { id: 'CIR', name: 'Ciro Gomes',                 party: 'PDT — Partido Democrático Trabalhista', color: '#AA1100', r1Votes:  3_599_287, r1Pct:  3.04 },
  { id: 'SOR', name: 'Soraya Thronicke',            party: 'União Brasil',                          color: '#1E88E5', r1Votes:    600_955, r1Pct:  0.51 },
  { id: 'DAV', name: "Luiz Felipe d'Avila",         party: 'Novo',                                 color: '#F97316', r1Votes:    559_708, r1Pct:  0.47 },
  { id: 'KEL', name: 'Kelmon Souza',                party: 'PTB — Partido Trabalhista Brasileiro',  color: '#15803D', r1Votes:     81_129, r1Pct:  0.07 },
  { id: 'PER', name: 'Leonardo Péricles',           party: 'UP — Unidade Popular',                  color: '#7C3AED', r1Votes:     53_519, r1Pct:  0.05 },
  { id: 'SOF', name: 'Sofia Manzano',               party: 'PCB — Partido Comunista Brasileiro',    color: '#B91C1C', r1Votes:     45_620, r1Pct:  0.04 },
  { id: 'VER', name: 'Vera Lúcia',                  party: 'PSTU — Partido Socialista dos Trab.',   color: '#0891B2', r1Votes:     25_625, r1Pct:  0.02 },
  { id: 'EYM', name: 'José Maria Eymael',           party: 'DC — Democracia Cristã',                color: '#92400E', r1Votes:     16_604, r1Pct:  0.01 },
];

export const BR_CANDIDATE_MAP = Object.fromEntries(
  BR_CANDIDATES.map(c => [c.id, c])
) as Record<BrCandidateId, BrCandidate>;

export const BR_R1_TOTAL = BR_CANDIDATES.reduce((s, c) => s + c.r1Votes, 0);

export const BR_WIKI_TITLES: Record<BrCandidateId, string> = {
  LUL: 'Luiz_Inácio_Lula_da_Silva',
  BOL: 'Jair_Bolsonaro',
  TEB: 'Simone_Tebet',
  CIR: 'Ciro_Gomes',
  SOR: 'Soraya_Thronicke',
  DAV: "Luiz_Felipe_d'Avila",
  KEL: 'Padre_Kelmon',
  PER: 'Leonardo_Péricles',
  SOF: 'Sofia_Manzano',
  VER: 'Vera_Lúcia_Salgado',
  EYM: 'José_Maria_Eymael',
};

// ── 2026 simulation parties ───────────────────────────────────────────────────
export type Br2026PartyId = 'PT' | 'PL' | 'PSD' | 'NOVO' | 'MISSAO' | 'AVANTE';

export type Br2026Party = {
  id: Br2026PartyId;
  name: string;
  color: string;
  candidates: string[];
};

export const BR_2026_PARTIES: Br2026Party[] = [
  { id: 'PT',     name: 'Partido dos Trabalhadores',  color: '#CC0000', candidates: ['Lula da Silva'] },
  { id: 'PL',     name: 'Partido Liberal',            color: '#003087', candidates: ['Flávio Bolsonaro'] },
  { id: 'PSD',    name: 'Partido Social Democrático', color: '#0066CC', candidates: ['Ronaldo Caiado'] },
  { id: 'NOVO',   name: 'Partido Novo',               color: '#E06500', candidates: ['Romeu Zema'] },
  { id: 'MISSAO', name: 'Missão',                     color: '#7C3AED', candidates: ['Renan Santos'] },
  { id: 'AVANTE', name: 'Avante',                     color: '#0D9488', candidates: ['Augusto Cury'] },
];

export const BR_2026_PARTY_MAP = Object.fromEntries(
  BR_2026_PARTIES.map(p => [p.id, p])
) as Record<Br2026PartyId, Br2026Party>;

export const BR_2026_WIKI_TITLES: Record<string, string> = {
  'Lula da Silva':    'Luiz_Inácio_Lula_da_Silva',
  'Flávio Bolsonaro': 'Flávio_Bolsonaro',
  'Ronaldo Caiado':   'Ronaldo_Caiado',
  'Romeu Zema':       'Romeu_Zema',
  'Augusto Cury':     'Augusto_Cury',
};

// Local photo overrides — used when a candidate has no English Wikipedia article.
// Files live in public/leaders/.
export const BR_2026_LOCAL_PHOTOS: Record<string, string> = {
  'Renan Santos': 'leaders/renan-santos.jpg',
};

// Ideology scores: 0 = far-left, 12 = far-right
// Used by the R2 vote-transfer model (brGroup buckets every 2 pts)
export const BR_IDEOLOGY_SCORE: Record<string, number> = {
  // 2022 reference candidates
  LUL: 2, PER: 2, SOF: 1, VER: 1, CIR: 3, TEB: 6, SOR: 8, DAV: 10, KEL: 11, EYM: 8, BOL: 12,
  // 2026 parties
  PT:     2,   // Lula da Silva — center-left
  AVANTE: 4,   // Augusto Cury — center
  MISSAO: 6,   // Renan Santos — center-conservative
  PSD:    9,   // Ronaldo Caiado — conservative
  NOVO:   11,  // Romeu Zema — right / libertarian
  PL:     12,  // Flávio Bolsonaro — far-right
};
