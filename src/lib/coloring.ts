import { hsl } from 'd3';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';

export const MARGIN_FLOOR = 0;
export const MARGIN_CEIL = 30;
export const LIGHTNESS_PALE = 82;
export const LIGHTNESS_DEEP = 38;

export const BLANK_COLOR = '#E5E7EB';

function adjustLightness(hexColor: string, lightnessPercent: number): string {
  const c = hsl(hexColor);
  c.l = lightnessPercent / 100;
  return c.formatHex();
}

export function constituencyFill(
  validVotes: number,
  results: Partial<Record<PartyId, number>>,
): string {
  const sorted = (Object.entries(results) as [PartyId, number][])
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  if (sorted.length === 0) return BLANK_COLOR;

  const [winnerId, winnerVotes] = sorted[0];
  const runnerUpVotes = sorted[1]?.[1] ?? 0;

  const winnerShare = (winnerVotes / validVotes) * 100;
  const runnerUpShare = (runnerUpVotes / validVotes) * 100;
  const margin = winnerShare - runnerUpShare;

  const baseColor = PARTIES[winnerId]?.color ?? '#888888';
  const t = Math.min(Math.max((margin - MARGIN_FLOOR) / (MARGIN_CEIL - MARGIN_FLOOR), 0), 1);
  const lightness = LIGHTNESS_PALE - t * (LIGHTNESS_PALE - LIGHTNESS_DEEP);

  return adjustLightness(baseColor, lightness);
}
