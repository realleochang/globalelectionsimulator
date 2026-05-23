import { useState, useEffect, useCallback } from 'react';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES, EXTENDED_PARTY_IDS, partyAllowedIn } from '../data/parties';
import type { PartyId } from '../data/parties';
import { redistributeVotes, getConstituencyParties } from '../lib/slider-math';

export function MultiSelectPanel() {
  const selectedIds            = useElectionStore(s => s.selectedIds);
  const multiSelectMode        = useElectionStore(s => s.multiSelectMode);
  const byId                   = useElectionStore(s => s.byId);
  const currentResults         = useElectionStore(s => s.currentResults);
  const setConstituencyResults = useElectionStore(s => s.setConstituencyResults);
  const hiddenParties          = useElectionStore(s => s.hiddenParties);
  const baselineLoaded         = useElectionStore(s => s.baselineLoaded);

  const [locked, setLocked] = useState<Set<PartyId>>(new Set());

  // Reset locks whenever the selection changes
  useEffect(() => { setLocked(new Set()); }, [selectedIds]);

  if (!multiSelectMode || selectedIds.size === 0) return null;

  const selected = [...selectedIds].map(id => byId.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof byId.get>>[];

  const totalValidVotes = selected.reduce((s, c) => s + c.validVotes, 0);

  // Aggregate visible votes across all selected constituencies
  const aggregateVotes: Partial<Record<PartyId, number>> = {};
  for (const c of selected) {
    const results = currentResults[c.id] ?? c.results2024;
    for (const [p, v] of Object.entries(results) as [PartyId, number][]) {
      if (v > 0 && !hiddenParties.has(p)) {
        aggregateVotes[p] = (aggregateVotes[p] ?? 0) + v;
      }
    }
  }

  const partyIds = (Object.keys(aggregateVotes) as PartyId[])
    .filter(p => (aggregateVotes[p] ?? 0) > 0)
    .sort((a, b) => (aggregateVotes[b] ?? 0) - (aggregateVotes[a] ?? 0));

  const sorted = partyIds.map(p => ({ p, v: aggregateVotes[p] ?? 0 }));
  const winner   = sorted[0];
  const runnerUp = sorted[1];

  const toggleLock = useCallback((party: PartyId) => {
    setLocked(prev => { const n = new Set(prev); n.has(party) ? n.delete(party) : n.add(party); return n; });
  }, []);

  const handleSlider = (party: PartyId, newPct: number) => {
    const currentPct = totalValidVotes > 0
      ? ((aggregateVotes[party] ?? 0) / totalValidVotes) * 100
      : 0;
    const deltaPct = newPct - currentPct;

    for (const c of selected) {
      if (!partyAllowedIn(party, c.country)) continue;
      const results = currentResults[c.id] ?? c.results2024;

      // Build the visible party set for this specific constituency
      const existingParties = (Object.keys(c.results2024) as PartyId[]).filter(p => (c.results2024[p] ?? 0) > 0);
      const basePartyIds = getConstituencyParties(c.country, existingParties)
        .filter(p => !hiddenParties.has(p) && partyAllowedIn(p, c.country));
      const activeExtended = Array.from(EXTENDED_PARTY_IDS)
        .filter(p => !hiddenParties.has(p) && partyAllowedIn(p, c.country)) as PartyId[];
      const visibleParties = [...new Set([...basePartyIds, ...activeExtended])];

      const visibleResults: Partial<Record<PartyId, number>> = Object.fromEntries(
        visibleParties.map(p => [p, results[p] ?? 0])
      );

      const currentVotes = results[party] ?? 0;
      const newVotes = Math.max(0, Math.min(currentVotes + (deltaPct / 100) * c.validVotes, c.validVotes));

      const redistributed = redistributeVotes(visibleResults, party, newVotes, locked, c.validVotes);

      const fullUpdate: Partial<Record<PartyId, number>> = {};
      for (const p of Object.keys(results) as PartyId[]) fullUpdate[p] = 0;
      Object.assign(fullUpdate, redistributed);

      setConstituencyResults(c.id, fullUpdate);
    }
  };

  const countries = [...new Set(selected.map(c => c.country))];
  const regionLabel = countries.length === 1 ? countries[0] : 'Mixed regions';

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">

      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight">
              {selectedIds.size} Constituencies
            </h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {regionLabel} · {totalValidVotes.toLocaleString()} combined votes
            </p>
          </div>
        </div>

        {/* Aggregate leader */}
        {baselineLoaded && winner && (
          <div className="mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: PARTIES[winner.p]?.color ?? '#888' }} />
            <span className="text-[12px] font-semibold text-ink flex-1 truncate">
              {PARTIES[winner.p]?.name ?? winner.p}
            </span>
            <span className="font-mono text-[11px] font-semibold text-ink-2">
              {totalValidVotes > 0 ? ((winner.v / totalValidVotes) * 100).toFixed(1) : '0.0'}%
            </span>
            {runnerUp && (
              <span className="text-[10px] font-mono text-ink-3">
                +{totalValidVotes > 0
                  ? (((winner.v - runnerUp.v) / totalValidVotes) * 100).toFixed(1)
                  : '0.0'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sliders */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-2">
        {partyIds.map(partyId => {
          const party   = PARTIES[partyId];
          const votes   = aggregateVotes[partyId] ?? 0;
          const pct     = totalValidVotes > 0 ? (votes / totalValidVotes) * 100 : 0;
          const isLocked = locked.has(partyId);

          return (
            <div key={partyId}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: party?.color ?? '#888' }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">
                  {party?.name ?? partyId}
                </span>
                <button
                  onClick={() => toggleLock(partyId)}
                  disabled={!baselineLoaded}
                  title={isLocked ? 'Unlock' : 'Lock'}
                  className={`w-4 h-4 flex items-center justify-center transition-colors disabled:opacity-30 shrink-0 ${
                    isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {isLocked ? (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true">
                      <rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/>
                      <path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                    </svg>
                  ) : (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true">
                      <rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      <path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                    </svg>
                  )}
                </button>
                <span className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none">
                  {pct.toFixed(1)}%
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={pct}
                disabled={!baselineLoaded || isLocked}
                onChange={e => handleSlider(partyId, parseFloat(e.target.value))}
                className="party-slider w-full"
                style={{
                  '--party-color': party?.color ?? '#7a7870',
                  '--pct': `${pct}%`,
                } as React.CSSProperties}
              />

              <div className="text-right text-[9px] font-mono text-ink-3 -mt-0.5">
                {votes.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

    </aside>
  );
}
