export type TrCandidateId = 'ERD' | 'KIL' | 'OGA' | 'INC';

export type TrCandidate = {
  id: TrCandidateId;
  name: string;
  party: string;
  color: string;
  r1Votes: number;
  r1Pct: number;
};

// Official 2023 Turkish presidential election — first round (14 May 2023).
// Source: YSK (Supreme Election Council). National totals.
export const TR_CANDIDATES: TrCandidate[] = [
  { id: 'ERD', name: 'Recep Tayyip Erdoğan', party: "People's Alliance (AKP)",   color: '#F37021', r1Votes: 27_133_849, r1Pct: 49.52 },
  { id: 'KIL', name: 'Kemal Kılıçdaroğlu',   party: 'Nation Alliance (CHP)',      color: '#E30A17', r1Votes: 24_595_178, r1Pct: 44.88 },
  { id: 'OGA', name: 'Sinan Oğan',           party: 'ATA Alliance',               color: '#1AA0A0', r1Votes:  2_831_239, r1Pct:  5.17 },
  { id: 'INC', name: 'Muharrem İnce',        party: 'Homeland Party',             color: '#8E44AD', r1Votes:    235_783, r1Pct:  0.43 },
];

export const TR_CANDIDATE_MAP = Object.fromEntries(
  TR_CANDIDATES.map(c => [c.id, c])
) as Record<TrCandidateId, TrCandidate>;

// Total first-round votes (for turnout calc)
export const TR_R1_TOTAL = TR_CANDIDATES.reduce((s, c) => s + c.r1Votes, 0);

// Wikipedia article titles for profile photo fetching
export const TR_WIKI_TITLES: Record<TrCandidateId, string> = {
  ERD: 'Recep_Tayyip_Erdoğan',
  KIL: 'Kemal_Kılıçdaroğlu',
  OGA: 'Sinan_Oğan',
  INC: 'Muharrem_İnce',
};
