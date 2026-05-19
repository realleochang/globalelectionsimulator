import type { PartyId } from '../data/parties';

/**
 * Redistribute votes when one party's share is changed.
 * - `changedParty` gets exactly `newVotes`
 * - Locked parties are untouched
 * - Remaining unlocked parties absorb the difference proportionally
 * - Sum of all parties always equals `validVotes` (±1 vote due to rounding)
 */
export function redistributeVotes(
  current: Partial<Record<PartyId, number>>,
  changedParty: PartyId,
  newVotes: number,
  locked: ReadonlySet<PartyId>,
  validVotes: number,
): Partial<Record<PartyId, number>> {
  const parties = Object.keys(current) as PartyId[];

  // Sum of locked parties (excluding changedParty if it's locked — shouldn't happen, but safe)
  const lockedSum = parties
    .filter(p => p !== changedParty && locked.has(p))
    .reduce((s, p) => s + (current[p] ?? 0), 0);

  // Cap newVotes so we can't exceed what's available after locked parties
  const available = validVotes - lockedSum;
  newVotes = Math.max(0, Math.min(Math.round(newVotes), available));

  const remainder = available - newVotes;

  // Unlocked parties other than changedParty absorb the remainder
  const others = parties.filter(p => p !== changedParty && !locked.has(p));
  const othersSum = others.reduce((s, p) => s + (current[p] ?? 0), 0);

  const result: Partial<Record<PartyId, number>> = { ...current };
  result[changedParty] = newVotes;

  if (others.length === 0) return result;

  if (othersSum === 0) {
    // Distribute evenly
    const base = Math.floor(remainder / others.length);
    let leftover = remainder - base * others.length;
    for (const p of others) {
      result[p] = base + (leftover-- > 0 ? 1 : 0);
    }
  } else {
    // Distribute proportionally, last party absorbs rounding residue
    let distributed = 0;
    for (let i = 0; i < others.length - 1; i++) {
      const share = Math.round(((current[others[i]] ?? 0) / othersSum) * remainder);
      result[others[i]] = Math.max(0, share);
      distributed += result[others[i]] as number;
    }
    result[others[others.length - 1]] = Math.max(0, remainder - distributed);
  }

  return result;
}

/** Parties shown in the panel for each country type */
export function getConstituencyParties(
  country: 'England' | 'Scotland' | 'Wales' | 'NI',
  resultParties: PartyId[],
): PartyId[] {
  if (country === 'NI') {
    const base: PartyId[] = ['DUP', 'SF', 'SDLP', 'UUP', 'ALL', 'TUV'];
    return [...new Set([...base, ...resultParties])];
  }

  const base: PartyId[] = ['LAB', 'CON', 'LD', 'RFM', 'GRN'];
  if (country === 'Scotland') base.push('SNP');
  if (country === 'Wales') base.push('PC');

  // Include any party from 2024 results not already in the list
  const extra = resultParties.filter(p => !base.includes(p));
  return [...base, ...extra];
}
