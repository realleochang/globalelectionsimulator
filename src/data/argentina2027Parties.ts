// Parties for the projected next (2027) Argentine presidential election.
// Argentina elects its president by direct national popular vote with a runoff:
// a candidate wins in round one with >45%, or >40% and a 10-point lead; else top-two runoff.
// Each party offers one or more plausible candidates the player can choose from.
// Source: en.wikipedia "2027 Argentine general election" (candidates + 2026 opinion polls).
// Ordered left → right by ideology.
export type Ar2027PartyId =
  | 'FIT' | 'FP' | 'UCR' | 'HNP' | 'PRO' | 'LLA';

export type Ar2027Party = {
  id: Ar2027PartyId;
  name: string;
  color: string;
  candidates: string[];
};

export const AR_2027_PARTIES: Ar2027Party[] = [
  { id: 'FIT', name: 'Frente de Izquierda (FIT-U)',  color: '#D32F2F', candidates: ['Myriam Bregman', 'Nicolás del Caño'] },
  { id: 'FP',  name: 'Fuerza Patria (Peronismo)',     color: '#3FA9F5', candidates: ['Axel Kicillof', 'Juan Grabois', 'Sergio Massa', 'Sergio Uñac'] },
  { id: 'UCR', name: 'Unión Cívica Radical',          color: '#E2231A', candidates: ['Facundo Manes'] },
  { id: 'HNP', name: 'Hacemos por Nuestro País',      color: '#1B9E77', candidates: ['Juan Schiaretti'] },
  { id: 'PRO', name: 'PRO / Juntos por el Cambio',    color: '#F2C200', candidates: ['Mauricio Macri', 'Patricia Bullrich'] },
  { id: 'LLA', name: 'La Libertad Avanza',            color: '#6A2C8E', candidates: ['Javier Milei', 'Victoria Villarruel'] },
];

export const AR_2027_PARTY_MAP = Object.fromEntries(
  AR_2027_PARTIES.map(p => [p.id, p])
) as Record<Ar2027PartyId, Ar2027Party>;

export const AR_2027_WIKI_TITLES: Record<string, string> = {
  'Myriam Bregman':     'Myriam_Bregman',
  'Nicolás del Caño':   'Nicolás_del_Caño',
  'Axel Kicillof':      'Axel_Kicillof',
  'Juan Grabois':       'Juan_Grabois',
  'Sergio Massa':       'Sergio_Massa',
  'Sergio Uñac':        'Sergio_Uñac',
  'Facundo Manes':      'Facundo_Manes',
  'Juan Schiaretti':    'Juan_Schiaretti',
  'Mauricio Macri':     'Mauricio_Macri',
  'Patricia Bullrich':  'Patricia_Bullrich',
  'Javier Milei':       'Javier_Milei',
  'Victoria Villarruel': 'Victoria_Villarruel',
};

// Most recent opinion polling (May 2026) — illustrative seed for the 2027 scenario.
// Source: en.wikipedia "2027 Argentine general election" (Isasi-Burdman, May 2026).
export const AR_2027_POLL_SEED: Record<string, number> = {
  LLA: 39.1,  // Milei
  FP:  23.0,  // Kicillof
  PRO: 11.0,  // Macri
  HNP:  9.0,  // Schiaretti
};
