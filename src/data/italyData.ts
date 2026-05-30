// ── Italy 2022 general election (Camera dei Deputati, 400 seats) ───────────────
// Electoral system: Rosatellum bis (parallel / mixed) —
//   147 single-member FPTP collegi (uninominali) + 245 proportional seats
//   (plurinominali, 3% party / 10% coalition threshold) + 8 overseas = 400.
// Source: Ministero dell'Interno (Eligendo) / Wikipedia. Verified to sum to 400.

export type ItPartyId =
  | 'FDI' | 'PD' | 'M5S' | 'LEGA' | 'FI' | 'AZIV' | 'AVS' | 'PIU' | 'NM'
  | 'SVP' | 'IC' | 'ALTRI';

export type ItCoalitionId = 'CDX' | 'CSX' | 'M5S' | 'AZIV' | 'SVP' | 'AUT' | 'SCN' | 'NONE';

export type ItParty = {
  id: ItPartyId;
  name: string;        // short label
  fullName: string;
  color: string;
  leader: string;
  wikiTitle: string;
  ideology: number;    // 0 (left) → 10 (right) — for parliament + scoreboard ordering
  coalition: ItCoalitionId;
  seats2022: number;   // total Camera seats (FPTP + PR + overseas)
  prPct2022: number;   // national party-list (proportional) vote share
  prVotes2022: number; // national party-list raw votes
};

// Ordered left → right by ideology
export const IT_PARTIES: ItParty[] = [
  { id: 'AVS',  name: 'AVS',     fullName: 'Alleanza Verdi e Sinistra', color: '#2E8B57', leader: 'Bonelli–Fratoianni', wikiTitle: 'Angelo_Bonelli', ideology: 1.5, coalition: 'CSX',  seats2022: 12, prPct2022: 3.63, prVotes2022: 1_018_669 },
  { id: 'M5S',  name: 'M5S',     fullName: 'Movimento 5 Stelle',        color: '#F2C200', leader: 'Giuseppe Conte',     wikiTitle: 'Giuseppe_Conte',  ideology: 3.0, coalition: 'M5S',  seats2022: 52, prPct2022: 15.43, prVotes2022: 4_333_972 },
  { id: 'PD',   name: 'PD',      fullName: 'Partito Democratico',       color: '#E63946', leader: 'Elly Schlein',       wikiTitle: 'Elly_Schlein',    ideology: 3.6, coalition: 'CSX',  seats2022: 69, prPct2022: 19.07, prVotes2022: 5_356_180 },
  { id: 'PIU',  name: '+Europa', fullName: '+Europa',                   color: '#C4006B', leader: 'Riccardo Magi',      wikiTitle: 'Riccardo_Magi',   ideology: 4.4, coalition: 'CSX',  seats2022: 2,  prPct2022: 2.83, prVotes2022: 793_961 },
  { id: 'IC',   name: 'IC',      fullName: 'Impegno Civico',            color: '#1A8FB5', leader: 'Luigi Di Maio',      wikiTitle: 'Luigi_Di_Maio',   ideology: 4.2, coalition: 'CSX',  seats2022: 1,  prPct2022: 0.60, prVotes2022: 169_165 },
  { id: 'AZIV', name: 'Az–IV',   fullName: 'Azione – Italia Viva',      color: '#00A3C7', leader: 'Calenda–Renzi',      wikiTitle: 'Carlo_Calenda',   ideology: 5.0, coalition: 'AZIV', seats2022: 21, prPct2022: 7.79, prVotes2022: 2_186_669 },
  { id: 'SVP',  name: 'SVP',     fullName: 'Südtiroler Volkspartei',    color: '#B30000', leader: 'Philipp Achammer',   wikiTitle: 'Philipp_Achammer', ideology: 5.5, coalition: 'SVP', seats2022: 3, prPct2022: 0.42, prVotes2022: 117_010 },
  { id: 'FI',   name: 'FI',      fullName: 'Forza Italia',              color: '#0F73B9', leader: 'Antonio Tajani',     wikiTitle: 'Antonio_Tajani',  ideology: 6.5, coalition: 'CDX',  seats2022: 45, prPct2022: 8.11, prVotes2022: 2_278_217 },
  { id: 'NM',   name: 'NM',      fullName: 'Noi Moderati',              color: '#5B6E8C', leader: 'Maurizio Lupi',      wikiTitle: 'Maurizio_Lupi',   ideology: 6.8, coalition: 'CDX',  seats2022: 7,  prPct2022: 0.91, prVotes2022: 255_505 },
  { id: 'LEGA', name: 'Lega',    fullName: 'Lega',                      color: '#1B9E4B', leader: 'Matteo Salvini',     wikiTitle: 'Matteo_Salvini',  ideology: 7.6, coalition: 'CDX',  seats2022: 66, prPct2022: 8.77, prVotes2022: 2_464_005 },
  { id: 'FDI',  name: 'FdI',     fullName: "Fratelli d'Italia",         color: '#214A7B', leader: 'Giorgia Meloni',     wikiTitle: 'Giorgia_Meloni',  ideology: 8.4, coalition: 'CDX',  seats2022: 119, prPct2022: 26.00, prVotes2022: 7_302_517 },
  // bucket for South-calls-North + Aosta Valley + overseas (MAIE) minor seats
  { id: 'ALTRI', name: 'Altri',  fullName: 'Altri / Minori',            color: '#9AA0A6', leader: '—',                  wikiTitle: '',                ideology: 5.0, coalition: 'NONE', seats2022: 3,  prPct2022: 1.43, prVotes2022: 402_000 },
];

export const IT_PARTY_MAP = Object.fromEntries(IT_PARTIES.map(p => [p.id, p])) as Record<ItPartyId, ItParty>;
export const IT_TOTAL_SEATS = 400;
export const IT_MAJORITY = 201;
export const IT_PR_THRESHOLD = 3.0; // % national party threshold for proportional seats

// PR-vote leading-party id key used in the geojson baked properties → ItPartyId
// (geojson uses FDI/LEGA/FI/NM/PD/AVS/PIU/IC/M5S/AZIV)
export const IT_PR_KEYS: ItPartyId[] = ['FDI','LEGA','FI','NM','PD','AVS','PIU','IC','M5S','AZIV'];

// ── Coalitions ────────────────────────────────────────────────────────────────
export type ItCoalition = { id: ItCoalitionId; name: string; color: string; parties: ItPartyId[] };
export const IT_COALITIONS: ItCoalition[] = [
  { id: 'CSX',  name: 'Centro-sinistra', color: '#E63946', parties: ['PD','AVS','PIU','IC'] },
  { id: 'M5S',  name: 'Movimento 5 Stelle', color: '#F2C200', parties: ['M5S'] },
  { id: 'AZIV', name: 'Terzo Polo (Az–IV)', color: '#00A3C7', parties: ['AZIV'] },
  { id: 'CDX',  name: 'Centro-destra',   color: '#214A7B', parties: ['FDI','LEGA','FI','NM'] },
];

// Colors for the uninominali (FPTP) coalition-winner map
export const IT_COAL_COLOR: Record<string, string> = {
  CDX:  '#214A7B',
  CSX:  '#E63946',
  M5S:  '#F2C200',
  AZIV: '#00A3C7',
  SVP:  '#B30000',
  AUT:  '#8E44AD',
  SCN:  '#FF6F00',
  NONE: '#9AA0A6',
};
export const IT_COAL_NAME: Record<string, string> = {
  CDX:  'Centro-destra',
  CSX:  'Centro-sinistra',
  M5S:  'Movimento 5 Stelle',
  AZIV: 'Azione – Italia Viva',
  SVP:  'SVP',
  AUT:  "Valle d'Aosta (autonomisti)",
  SCN:  'Sud chiama Nord',
  NONE: '—',
};

export function itPartyColor(id: string): string {
  return IT_PARTY_MAP[id as ItPartyId]?.color ?? '#9AA0A6';
}
