export type FrCandidateId =
  | 'MAC' | 'LEP' | 'MEL' | 'ZEM' | 'PEC' | 'JAD'
  | 'LAS' | 'ROU' | 'DUP' | 'HIL' | 'POU' | 'ART';

export type FrCandidate = {
  id: FrCandidateId;
  name: string;
  party: string;
  color: string;
  r1Votes: number;
  r1Pct: number;
};

export const FR_CANDIDATES: FrCandidate[] = [
  { id: 'MAC', name: 'Emmanuel Macron',        party: 'La République En Marche!',      color: '#FF7900', r1Votes: 9_783_058, r1Pct: 27.85 },
  { id: 'LEP', name: 'Marine Le Pen',           party: 'National Rally',                color: '#003189', r1Votes: 8_133_828, r1Pct: 23.15 },
  { id: 'MEL', name: 'Jean-Luc Mélenchon',      party: 'La France Insoumise',           color: '#CC2443', r1Votes: 7_712_520, r1Pct: 21.95 },
  { id: 'ZEM', name: 'Éric Zemmour',            party: 'Reconquête',                    color: '#0A0A6E', r1Votes: 2_485_226, r1Pct:  7.07 },
  { id: 'PEC', name: 'Valérie Pécresse',        party: 'The Republicans',               color: '#0066CC', r1Votes: 1_679_001, r1Pct:  4.78 },
  { id: 'JAD', name: 'Yannick Jadot',           party: 'Europe Ecology – The Greens',   color: '#37A349', r1Votes: 1_627_853, r1Pct:  4.63 },
  { id: 'LAS', name: 'Jean Lassalle',           party: 'Résistons!',                    color: '#E87722', r1Votes: 1_101_387, r1Pct:  3.13 },
  { id: 'ROU', name: 'Fabien Roussel',          party: 'French Communist Party',        color: '#C41E3A', r1Votes:   802_422, r1Pct:  2.28 },
  { id: 'DUP', name: 'Nicolas Dupont-Aignan',   party: 'Debout la France',              color: '#2355A0', r1Votes:   725_176, r1Pct:  2.06 },
  { id: 'HIL', name: 'Anne Hidalgo',            party: 'Socialist Party',               color: '#E75480', r1Votes:   616_478, r1Pct:  1.75 },
  { id: 'POU', name: 'Philippe Poutou',         party: 'New Anticapitalist Party',      color: '#8B0000', r1Votes:   268_904, r1Pct:  0.77 },
  { id: 'ART', name: 'Nathalie Arthaud',        party: 'Lutte Ouvrière',                color: '#DD2222', r1Votes:   197_094, r1Pct:  0.56 },
];

export const FR_CANDIDATE_MAP = Object.fromEntries(
  FR_CANDIDATES.map(c => [c.id, c])
) as Record<FrCandidateId, FrCandidate>;

// Total first-round votes (for turnout calc)
export const FR_R1_TOTAL = FR_CANDIDATES.reduce((s, c) => s + c.r1Votes, 0);

// Wikipedia article titles for profile photo fetching
export const FR_WIKI_TITLES: Record<FrCandidateId, string> = {
  MAC: 'Emmanuel_Macron',
  LEP: 'Marine_Le_Pen',
  MEL: 'Jean-Luc_Mélenchon',
  ZEM: 'Éric_Zemmour',
  PEC: 'Valérie_Pécresse',
  JAD: 'Yannick_Jadot',
  LAS: 'Jean_Lassalle',
  ROU: 'Fabien_Roussel',
  DUP: 'Nicolas_Dupont-Aignan',
  HIL: 'Anne_Hidalgo',
  POU: 'Philippe_Poutou',
  ART: 'Nathalie_Arthaud',
};
