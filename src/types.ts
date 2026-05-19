import type { PartyId } from './data/parties';

export type Constituency = {
  id: string;
  name: string;
  country: 'England' | 'Scotland' | 'Wales' | 'NI';
  region: string;
  electorate: number;
  validVotes: number;
  results2024: Partial<Record<PartyId, number>>;
  winner2024: PartyId;
};
