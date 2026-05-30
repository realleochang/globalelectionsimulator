export type ArCandidateId = 'MAS' | 'MIL' | 'BUL' | 'SCH' | 'BRE';

export type ArCandidate = {
  id: ArCandidateId;
  name: string;
  party: string;
  color: string;
  r1Votes: number;
  r1Pct: number;
};

// Official 2023 Argentine general election — presidential first round (22 October 2023).
// Source: Dirección Nacional Electoral, via the en.wikipedia results tables. National totals.
// Ordered left → right by ideology (FIT · UxP · Hacemos · JxC · LLA).
export const AR_CANDIDATES: ArCandidate[] = [
  { id: 'BRE', name: 'Myriam Bregman',   party: 'Frente de Izquierda (FIT-U)', color: '#D32F2F', r1Votes:   722_061, r1Pct:  2.70 },
  { id: 'MAS', name: 'Sergio Massa',     party: 'Unión por la Patria',          color: '#3FA9F5', r1Votes: 9_853_492, r1Pct: 36.78 },
  { id: 'SCH', name: 'Juan Schiaretti',  party: 'Hacemos por Nuestro País',     color: '#1B9E77', r1Votes: 1_802_068, r1Pct:  6.73 },
  { id: 'BUL', name: 'Patricia Bullrich', party: 'Juntos por el Cambio',        color: '#F2C200', r1Votes: 6_379_023, r1Pct: 23.81 },
  { id: 'MIL', name: 'Javier Milei',     party: 'La Libertad Avanza',           color: '#6A2C8E', r1Votes: 8_034_990, r1Pct: 29.99 },
];

export const AR_CANDIDATE_MAP = Object.fromEntries(
  AR_CANDIDATES.map(c => [c.id, c])
) as Record<ArCandidateId, ArCandidate>;

// Total first-round valid votes (for turnout / share calc)
export const AR_R1_TOTAL = AR_CANDIDATES.reduce((s, c) => s + c.r1Votes, 0);

// Wikipedia article titles for profile photo fetching
export const AR_WIKI_TITLES: Record<ArCandidateId, string> = {
  MAS: 'Sergio_Massa',
  MIL: 'Javier_Milei',
  BUL: 'Patricia_Bullrich',
  SCH: 'Juan_Schiaretti',
  BRE: 'Myriam_Bregman',
};
