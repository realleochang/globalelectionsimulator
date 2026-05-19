import type { PartyId } from '../data/parties';
import type { Constituency } from '../types';

export type ConstituencyResult = {
  id: string;
  name: string;
  region: string;
  country: string;
  validVotes: number;
  winner: PartyId;
  runnerUp: PartyId | null;
  winnerPct: number;
  marginPct: number;
  results: Partial<Record<PartyId, number>>;
};

export function computeConstituencyResults(
  constituencies: Constituency[],
  currentResults: Record<string, Partial<Record<PartyId, number>>>,
): ConstituencyResult[] {
  return constituencies.map(c => {
    const results = currentResults[c.id] ?? c.results2024;
    const sorted = (Object.entries(results) as [PartyId, number][])
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a);
    const [winner = 'OTH' as PartyId, winnerVotes = 0] = sorted[0] ?? [];
    const [runnerUp = null, runnerUpVotes = 0] = sorted[1] ?? [];
    const winnerPct = (winnerVotes / c.validVotes) * 100;
    const marginPct = winnerPct - (runnerUpVotes / c.validVotes) * 100;
    return { id: c.id, name: c.name, region: c.region || c.country, country: c.country, validVotes: c.validVotes, winner, runnerUp, winnerPct, marginPct, results };
  });
}

export type RegionBreakdown = {
  region: string;
  seats: Partial<Record<PartyId, number>>;
  total: number;
  topParty: PartyId;
};

export function computeRegionBreakdown(results: ConstituencyResult[]): RegionBreakdown[] {
  const map = new Map<string, Partial<Record<PartyId, number>>>();
  for (const c of results) {
    const s = map.get(c.region) ?? {};
    s[c.winner] = (s[c.winner] ?? 0) + 1;
    map.set(c.region, s);
  }
  return Array.from(map.entries())
    .map(([region, seats]) => {
      const topParty = (Object.entries(seats) as [PartyId, number][])
        .sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'OTH' as PartyId;
      return { region, seats, total: Object.values(seats).reduce((a, b) => a + b, 0), topParty };
    })
    .sort((a, b) => a.region.localeCompare(b.region));
}

export type SwingEntry = {
  id: string;
  name: string;
  party: PartyId;
  swingPct: number;
  fromPct: number;
  toPct: number;
};

export function computeBiggestSwings(
  constituencies: Constituency[],
  currentResults: Record<string, Partial<Record<PartyId, number>>>,
  limit = 20,
): SwingEntry[] {
  const swings: SwingEntry[] = [];
  for (const c of constituencies) {
    const current = currentResults[c.id] ?? c.results2024;
    const baseline = c.results2024;
    const parties = new Set([...Object.keys(current), ...Object.keys(baseline)]) as Set<PartyId>;
    for (const party of parties) {
      const fromPct = ((baseline[party] ?? 0) / c.validVotes) * 100;
      const toPct = ((current[party] ?? 0) / c.validVotes) * 100;
      const swingPct = toPct - fromPct;
      if (Math.abs(swingPct) > 0.05) {
        swings.push({ id: c.id, name: c.name, party, swingPct, fromPct, toPct });
      }
    }
  }
  return swings.sort((a, b) => Math.abs(b.swingPct) - Math.abs(a.swingPct)).slice(0, limit);
}

export type FptpRow = {
  party: PartyId;
  seats: number;
  seatShare: number;
  voteShare: number;
};

export function computeFptpDistortion(
  constituencies: Constituency[],
  currentResults: Record<string, Partial<Record<PartyId, number>>>,
): FptpRow[] {
  const seats: Partial<Record<PartyId, number>> = {};
  const votes: Partial<Record<PartyId, number>> = {};
  let totalVotes = 0;
  for (const c of constituencies) {
    const results = currentResults[c.id] ?? c.results2024;
    const sorted = (Object.entries(results) as [PartyId, number][])
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a);
    const winner = sorted[0]?.[0];
    if (winner) seats[winner] = (seats[winner] ?? 0) + 1;
    for (const [p, v] of sorted) { votes[p] = (votes[p] ?? 0) + v; totalVotes += v; }
  }
  const all = new Set([...Object.keys(seats), ...Object.keys(votes)]) as Set<PartyId>;
  return Array.from(all)
    .map(party => ({
      party,
      seats: seats[party] ?? 0,
      seatShare: ((seats[party] ?? 0) / 650) * 100,
      voteShare: totalVotes > 0 ? ((votes[party] ?? 0) / totalVotes) * 100 : 0,
    }))
    .filter(r => r.seats > 0 || r.voteShare > 0.5)
    .sort((a, b) => b.seats - a.seats);
}
