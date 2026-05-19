import { create } from 'zustand';
import type { PartyId } from '../data/parties';
import { EXTENDED_PARTY_IDS } from '../data/parties';
import type { Constituency } from '../types';
import { constituencyFill, BLANK_COLOR } from '../lib/coloring';
import { redistributeVotes } from '../lib/slider-math';

type ElectionStore = {
  constituencies: Constituency[];
  byId: Map<string, Constituency>;
  baselineLoaded: boolean;
  currentResults: Record<string, Partial<Record<PartyId, number>>>;

  // Which preset was last loaded
  activePreset: 'baseline' | 'polling2026' | 'blank' | null;

  // Blank-map declaration mode
  isBlankMap: boolean;
  declaredIds: Set<string>;

  // Single-select
  selectedId: string | null;

  // Multi-select
  multiSelectMode: boolean;
  selectedIds: Set<string>;

  // Panel open/closed states
  nationalSwingOpen: boolean;
  breakdownOpen: boolean;
  partyManagerOpen: boolean;
  parliamentOpen: boolean;

  // Leader picks (cosmetic)
  leaderPicks: Partial<Record<PartyId, string>>;

  // Party visibility — extended parties start hidden
  hiddenParties: Set<PartyId>;

  setConstituencies: (data: Constituency[]) => void;
  loadBaseline: () => void;
  load2026Polling: () => void;
  resetAll: () => void;
  setConstituencyResults: (id: string, results: Partial<Record<PartyId, number>>) => void;
  resetConstituency: (id: string) => void;
  declareConstituency: (id: string) => void;
  selectConstituency: (id: string | null) => void;

  toggleMultiSelectMode: () => void;
  toggleConstituencySelection: (id: string) => void;
  clearSelection: () => void;

  setNationalSwingOpen: (open: boolean) => void;
  setBreakdownOpen: (open: boolean) => void;
  setPartyManagerOpen: (open: boolean) => void;
  setParliamentOpen: (open: boolean) => void;

  setLeader: (party: PartyId, leader: string) => void;

  // Toggle a party's visibility in the simulation.
  // Activating an extended party seeds it at 0 votes in every constituency.
  togglePartyHidden: (id: PartyId) => void;

  applySwing: (party: PartyId, deltaPct: number, ids?: ReadonlySet<string>) => void;
  compressToTossup: (ids?: ReadonlySet<string>) => void;

  getFill: (gssCode: string) => string;
  getSeatTally: () => Partial<Record<PartyId, number>>;
  getWinner: (gssCode: string) => PartyId | null;
};

export const useElectionStore = create<ElectionStore>((set, get) => ({
  constituencies: [],
  byId: new Map(),
  baselineLoaded: false,
  currentResults: {},
  isBlankMap: false,
  declaredIds: new Set(),
  selectedId: null,
  multiSelectMode: false,
  selectedIds: new Set(),
  activePreset: null,
  nationalSwingOpen: false,
  breakdownOpen: false,
  partyManagerOpen: false,
  parliamentOpen: false,
  leaderPicks: {},
  hiddenParties: new Set(EXTENDED_PARTY_IDS), // extended parties hidden by default

  setConstituencies(data) {
    set({ constituencies: data, byId: new Map(data.map(c => [c.id, c])) });
  },

  loadBaseline() {
    const { constituencies, hiddenParties } = get();
    const currentResults: Record<string, Partial<Record<PartyId, number>>> = {};
    for (const c of constituencies) {
      currentResults[c.id] = { ...c.results2024 };
      // Seed active extended parties with 0 votes
      for (const extId of EXTENDED_PARTY_IDS) {
        if (!hiddenParties.has(extId)) {
          currentResults[c.id][extId] = currentResults[c.id][extId] ?? 0;
        }
      }
    }
    set({ baselineLoaded: true, currentResults, isBlankMap: false, declaredIds: new Set(), activePreset: 'baseline' });
  },

  load2026Polling() {
    const { constituencies, hiddenParties } = get();

    // May 2026 polling targets (% of GB-wide national vote)
    const POLLING_2026: Partial<Record<PartyId, number>> = {
      RFM: 29, CON: 17, LAB: 17, GRN: 16, LD: 12, RUK: 3, SNP: 3,
    };

    // Calculate 2024 national totals from non-NI constituencies only
    let grandTotal = 0;
    const national2024: Partial<Record<PartyId, number>> = {};
    for (const c of constituencies) {
      if (c.country === 'NI') continue;
      for (const [p, v] of Object.entries(c.results2024) as [PartyId, number][]) {
        if (v > 0) {
          national2024[p] = (national2024[p] ?? 0) + v;
          grandTotal += v;
        }
      }
    }

    // UNS swings needed to reach polling targets
    const swings: Partial<Record<PartyId, number>> = {};
    for (const [p, target] of Object.entries(POLLING_2026) as [PartyId, number][]) {
      const actual = grandTotal > 0 ? ((national2024[p] ?? 0) / grandTotal) * 100 : 0;
      swings[p] = target - actual;
    }

    // Auto-activate RUK so it has a presence on the map
    const nextHidden = new Set(hiddenParties);
    nextHidden.delete('RUK');

    const currentResults: Record<string, Partial<Record<PartyId, number>>> = {};
    for (const c of constituencies) {
      const newR: Partial<Record<PartyId, number>> = { ...c.results2024 };

      if (c.country !== 'NI') {
        for (const [p, swing] of Object.entries(swings) as [PartyId, number][]) {
          if (p === 'SNP' && c.country !== 'Scotland') continue; // SNP only stands in Scotland
          const current = newR[p] ?? 0;
          newR[p] = Math.max(0, current + (swing / 100) * c.validVotes);
        }

        // Normalise to validVotes
        const total = (Object.values(newR) as number[]).reduce((s, v) => s + v, 0);
        if (total > 0) {
          const scale = c.validVotes / total;
          for (const p of Object.keys(newR) as PartyId[]) {
            newR[p] = Math.round((newR[p] ?? 0) * scale);
          }
          // Fix rounding remainder on top party
          const rounded = (Object.values(newR) as number[]).reduce((s, v) => s + v, 0);
          const diff = c.validVotes - rounded;
          if (diff !== 0) {
            const top = (Object.entries(newR) as [PartyId, number][])
              .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)[0]?.[0];
            if (top) newR[top] = (newR[top] ?? 0) + diff;
          }
        }
      }

      // Seed active extended parties (including newly-active RUK)
      for (const extId of EXTENDED_PARTY_IDS) {
        if (!nextHidden.has(extId)) newR[extId] = newR[extId] ?? 0;
      }

      currentResults[c.id] = newR;
    }

    // ── Regional Green adjustments ──────────────────────────────────────
    const highMuslimNames = new Set([
      'Bradford East', 'Bradford West', 'Bradford South',
      'Batley and Spen', 'Dewsbury and Batley',
      'Rochdale', 'Oldham East and Saddleworth', 'Oldham West, Chadderton and Royton',
      'Luton North', 'Luton South and South Bedfordshire',
      'Leicester East', 'Leicester South', 'Leicester West', 'Leicester North West',
      'Slough', 'Blackburn',
      'Birmingham Ladywood', 'Birmingham Hodge Hill and Solihull North',
      'Birmingham Perry Barr', 'Birmingham Yardley', 'Birmingham Erdington',
      'Birmingham Hall Green and Moseley',
      'East Ham', 'West Ham and Beckton', 'Ilford North', 'Ilford South',
      'Poplar and Limehouse', 'Bethnal Green and Stepney', 'Whitechapel',
      'Stratford and Bow',
    ]);

    for (const c of constituencies) {
      if (c.country === 'NI') continue;
      const r = currentResults[c.id];
      const isLondon     = c.region === 'London';
      const isHighMuslim = highMuslimNames.has(c.name);
      let extraGrnPct = 0;

      if (isLondon)     extraGrnPct += 3;
      if (isHighMuslim) extraGrnPct += 4;

      // Deflate Green slightly outside London and high-Muslim areas
      if (!isLondon && !isHighMuslim && c.country === 'England') extraGrnPct -= 1;
      else if (!isLondon && !isHighMuslim && c.country === 'Wales') extraGrnPct -= 0.5;

      if (extraGrnPct !== 0) {
        r['GRN'] = Math.max(0, (r['GRN'] ?? 0) + (extraGrnPct / 100) * c.validVotes);
        const total = (Object.values(r) as number[]).reduce((s, v) => s + v, 0);
        if (total > 0) {
          const scale = c.validVotes / total;
          for (const p of Object.keys(r) as PartyId[]) r[p] = Math.round((r[p] ?? 0) * scale);
          const rounded = (Object.values(r) as number[]).reduce((s, v) => s + v, 0);
          const diff = c.validVotes - rounded;
          if (diff !== 0) {
            const top = (Object.entries(r) as [PartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)[0]?.[0];
            if (top) r[top] = (r[top] ?? 0) + diff;
          }
        }
      }
    }

    // ── Great Yarmouth special case: RUK 35%, RFM 30% ──────────────────
    const gy = constituencies.find(c => c.name === 'Great Yarmouth');
    if (gy) {
      const r = currentResults[gy.id];
      const ruk35 = Math.round(0.35 * gy.validVotes);
      const rfm30 = Math.round(0.30 * gy.validVotes);
      const remaining = gy.validVotes - ruk35 - rfm30;
      const others = (Object.entries(r) as [PartyId, number][]).filter(([p, v]) => p !== 'RUK' && p !== 'RFM' && v > 0);
      const othersTotal = others.reduce((s, [, v]) => s + v, 0);
      const newGY: Partial<Record<PartyId, number>> = {};
      for (const p of Object.keys(r) as PartyId[]) newGY[p] = 0;
      newGY['RUK'] = ruk35;
      newGY['RFM'] = rfm30;
      if (othersTotal > 0 && others.length > 0) {
        let dist = 0;
        for (let i = 0; i < others.length - 1; i++) {
          const [p, v] = others[i];
          newGY[p] = Math.round((v / othersTotal) * remaining);
          dist += newGY[p] as number;
        }
        const [lastP] = others[others.length - 1];
        newGY[lastP] = Math.max(0, remaining - dist);
      }
      currentResults[gy.id] = newGY;
    }

    set({
      baselineLoaded: true,
      currentResults,
      isBlankMap: false,
      declaredIds: new Set(),
      hiddenParties: nextHidden,
      activePreset: 'polling2026',
    });
  },

  resetAll() {
    const { constituencies, hiddenParties } = get();
    const currentResults: Record<string, Partial<Record<PartyId, number>>> = {};
    for (const c of constituencies) {
      const zeroed: Partial<Record<PartyId, number>> = {};
      for (const party of Object.keys(c.results2024) as PartyId[]) zeroed[party] = 0;
      for (const extId of EXTENDED_PARTY_IDS) {
        if (!hiddenParties.has(extId)) zeroed[extId] = 0;
      }
      currentResults[c.id] = zeroed;
    }
    set({
      baselineLoaded: true,
      currentResults,
      isBlankMap: true,
      declaredIds: new Set(),
      selectedId: null,
      selectedIds: new Set(),
      multiSelectMode: false,
      activePreset: 'blank',
    });
  },

  setConstituencyResults(id, results) {
    set(state => ({ currentResults: { ...state.currentResults, [id]: results } }));
  },

  resetConstituency(id) {
    const c = get().byId.get(id);
    if (!c) return;
    const { hiddenParties } = get();
    const reset: Partial<Record<PartyId, number>> = { ...c.results2024 };
    for (const extId of EXTENDED_PARTY_IDS) {
      if (!hiddenParties.has(extId)) reset[extId] = reset[extId] ?? 0;
    }
    set(state => ({ currentResults: { ...state.currentResults, [id]: reset } }));
  },

  declareConstituency(id) {
    set(state => ({ declaredIds: new Set([...state.declaredIds, id]) }));
  },

  selectConstituency(id) {
    set({ selectedId: id, nationalSwingOpen: false });
  },

  toggleMultiSelectMode() {
    const { multiSelectMode } = get();
    if (multiSelectMode) {
      set({ multiSelectMode: false, selectedIds: new Set() });
    } else {
      set({ multiSelectMode: true, selectedId: null, nationalSwingOpen: false });
    }
  },

  toggleConstituencySelection(id) {
    const { selectedIds } = get();
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ selectedIds: next });
  },

  clearSelection() {
    set({ selectedIds: new Set() });
  },

  setNationalSwingOpen(open) {
    set({ nationalSwingOpen: open, selectedId: open ? null : get().selectedId });
  },

  setBreakdownOpen(open) {
    set({ breakdownOpen: open });
  },

  setPartyManagerOpen(open) {
    set({ partyManagerOpen: open });
  },

  setParliamentOpen(open) {
    set({ parliamentOpen: open });
  },

  setLeader(party, leader) {
    set(state => ({ leaderPicks: { ...state.leaderPicks, [party]: leader } }));
  },

  togglePartyHidden(id) {
    const { hiddenParties, baselineLoaded, constituencies, currentResults } = get();

    if (hiddenParties.has(id)) {
      // ── Activating party ───────────────────────────────────────────
      const next = new Set(hiddenParties);
      next.delete(id);

      let updatedResults = currentResults;
      if (baselineLoaded && EXTENDED_PARTY_IDS.has(id)) {
        // Seed new party with 0 votes in every constituency
        const patched: typeof currentResults = {};
        for (const c of constituencies) {
          patched[c.id] = { ...(updatedResults[c.id] ?? {}), [id]: 0 };
        }
        updatedResults = { ...updatedResults, ...patched };
      }

      set({ hiddenParties: next, currentResults: updatedResults });
    } else {
      // ── Hiding party ───────────────────────────────────────────────
      const next = new Set(hiddenParties);
      next.add(id);
      set({ hiddenParties: next });
    }
  },

  applySwing(party, deltaPct, ids) {
    const { constituencies, currentResults, byId, baselineLoaded } = get();
    if (!baselineLoaded) return;

    const targets = ids ? [...ids] : constituencies.map(c => c.id);
    const updated = { ...currentResults };

    for (const id of targets) {
      const c = byId.get(id);
      if (!c) continue;
      const current = updated[id] ?? c.results2024;
      const currentVotes = current[party] ?? 0;
      const newVotes = Math.max(0, Math.min(
        currentVotes + (deltaPct / 100) * c.validVotes,
        c.validVotes,
      ));
      updated[id] = redistributeVotes(current, party, newVotes, new Set(), c.validVotes);
    }

    set({ currentResults: updated });
  },

  compressToTossup(ids) {
    const { constituencies, currentResults, byId, baselineLoaded } = get();
    if (!baselineLoaded) return;

    const targets = ids ? [...ids] : constituencies.map(c => c.id);
    const updated = { ...currentResults };

    for (const id of targets) {
      const c = byId.get(id);
      if (!c) continue;
      const current = updated[id] ?? c.results2024;
      const active = (Object.entries(current) as [PartyId, number][]).filter(([, v]) => v > 0);
      if (active.length < 2) continue;

      const equalShare = c.validVotes / active.length;
      const newR: Partial<Record<PartyId, number>> = { ...current };
      let total = 0;
      for (let i = 0; i < active.length - 1; i++) {
        const [p, v] = active[i];
        newR[p] = Math.max(0, Math.round((v + equalShare) / 2));
        total += newR[p] as number;
      }
      const [lastP] = active[active.length - 1];
      newR[lastP] = Math.max(0, c.validVotes - total);
      updated[id] = newR;
    }

    set({ currentResults: updated });
  },

  getFill(gssCode) {
    const { baselineLoaded, currentResults, byId } = get();
    if (!baselineLoaded) return BLANK_COLOR;
    const c = byId.get(gssCode);
    if (!c) return BLANK_COLOR;
    return constituencyFill(c.validVotes, currentResults[gssCode] ?? c.results2024);
  },

  getSeatTally() {
    const { baselineLoaded, currentResults, constituencies, isBlankMap, declaredIds } = get();
    const tally: Partial<Record<PartyId, number>> = {};
    if (!baselineLoaded) return tally;
    for (const c of constituencies) {
      if (isBlankMap && !declaredIds.has(c.id)) continue;
      const results = currentResults[c.id] ?? c.results2024;
      const winner = (Object.entries(results) as [PartyId, number][])
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)[0]?.[0];
      if (winner) tally[winner] = (tally[winner] ?? 0) + 1;
    }
    return tally;
  },

  getWinner(gssCode) {
    const { baselineLoaded, currentResults, byId } = get();
    if (!baselineLoaded) return null;
    const c = byId.get(gssCode);
    if (!c) return null;
    const results = currentResults[gssCode] ?? c.results2024;
    return (Object.entries(results) as [PartyId, number][])
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
  },
}));
