import { useState, useCallback, useEffect } from 'react';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES, EXTENDED_PARTY_IDS, partyAllowedIn } from '../data/parties';
import type { PartyId } from '../data/parties';
import { redistributeVotes, getConstituencyParties } from '../lib/slider-math';
import { constituencyFill } from '../lib/coloring';

export function ConstituencyPanel() {
  const selectedId            = useElectionStore(s => s.selectedId);
  const byId                  = useElectionStore(s => s.byId);
  const currentResults        = useElectionStore(s => s.currentResults);
  const setConstituencyResults= useElectionStore(s => s.setConstituencyResults);
  const resetConstituency     = useElectionStore(s => s.resetConstituency);
  const selectConstituency    = useElectionStore(s => s.selectConstituency);
  const baselineLoaded        = useElectionStore(s => s.baselineLoaded);
  const hiddenParties         = useElectionStore(s => s.hiddenParties);

  const isBlankMap          = useElectionStore(s => s.isBlankMap);
  const declaredIds         = useElectionStore(s => s.declaredIds);
  const declareConstituency = useElectionStore(s => s.declareConstituency);

  const [locked, setLocked] = useState<Set<PartyId>>(new Set());
  const [show2024, setShow2024] = useState(false);
  const [editingPct, setEditingPct] = useState<Partial<Record<PartyId, string>>>({});

  // Reset locks and inline edits whenever the user switches constituency
  useEffect(() => { setLocked(new Set()); setEditingPct({}); }, [selectedId]);

  const c = selectedId ? byId.get(selectedId) : null;
  const isDeclared = !isBlankMap || (selectedId ? declaredIds.has(selectedId) : true);

  const toggleLock = useCallback((party: PartyId) => {
    setLocked(prev => { const n = new Set(prev); n.has(party) ? n.delete(party) : n.add(party); return n; });
  }, []);

  const handleClose = useCallback(() => {
    selectConstituency(null);
    setLocked(new Set());
    setShow2024(false);
  }, [selectConstituency]);

  const handleReset = useCallback(() => {
    if (selectedId) { resetConstituency(selectedId); setLocked(new Set()); }
  }, [selectedId, resetConstituency]);

  if (!c) return null;

  const results = currentResults[c.id] ?? c.results2024;

  // Base parties for this constituency (region-aware), minus hidden ones
  const existingParties = (Object.keys(c.results2024) as PartyId[]).filter(p => (c.results2024[p] ?? 0) > 0);
  const basePartyIds = getConstituencyParties(c.country, existingParties)
    .filter(p => !hiddenParties.has(p) && partyAllowedIn(p, c.country));

  // Any active (not-hidden) extended parties allowed in this constituency's nation
  const activeExtended = Array.from(EXTENDED_PARTY_IDS)
    .filter(p => !hiddenParties.has(p) && partyAllowedIn(p, c.country)) as PartyId[];

  // Final deduplicated list: base parties first, then any active extended parties
  const partyIds = [...new Set([...basePartyIds, ...activeExtended])];

  const visibleVoteSum = partyIds.reduce((s, p) => s + (results[p] ?? 0), 0);
  const denominator = visibleVoteSum > 0 ? visibleVoteSum : c.validVotes;

  const sorted = partyIds.map(p => ({ p, v: results[p] ?? 0 })).filter(x => x.v > 0).sort((a,b) => b.v - a.v);
  const winner = sorted[0];
  const runnerUp = sorted[1];
  const winnerPct = winner ? (winner.v / denominator) * 100 : 0;
  const margin = winner && runnerUp ? winnerPct - (runnerUp.v / denominator) * 100 : winnerPct;
  const previewColor = winner ? constituencyFill(c.validVotes, results) : '#e0ddd7';
  const isEdited = partyIds.some(p => (results[p] ?? 0) !== (c.results2024[p] ?? 0));

  const handleSlider = (party: PartyId, pct: number) => {
    const newVotes = Math.round((pct / 100) * c.validVotes);
    // Restrict to visible parties so they always sum to 100%
    const visibleResults: Partial<Record<PartyId, number>> = Object.fromEntries(
      partyIds.map(p => [p, results[p] ?? 0])
    );
    const redistributed = redistributeVotes(visibleResults, party, newVotes, locked, c.validVotes);
    // Zero out hidden parties and apply redistributed values
    const fullUpdate: Partial<Record<PartyId, number>> = {};
    for (const p of Object.keys(results) as PartyId[]) fullUpdate[p] = 0;
    Object.assign(fullUpdate, redistributed);
    setConstituencyResults(c.id, fullUpdate);
  };

  // 2024 baseline results for the comparison popup
  const results2024Sorted = (Object.entries(c.results2024) as [PartyId, number][])
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  const winner2024 = results2024Sorted[0];
  const runnerUp2024 = results2024Sorted[1];
  const winner2024Pct = winner2024 ? (winner2024[1] / c.validVotes) * 100 : 0;
  const margin2024 = winner2024 && runnerUp2024
    ? winner2024Pct - (runnerUp2024[1] / c.validVotes) * 100
    : winner2024Pct;
  const preview2024Color = winner2024 ? constituencyFill(c.validVotes, c.results2024) : '#e0ddd7';

  return (
    <>
      {/* 2024 comparison popup — appears to the left of the main panel */}
      {show2024 && (
        <aside className="w-60 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide shadow-lg">
          <div className="px-3 pt-3 pb-2 border-b border-default flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">2024 actual result</p>
              <h2 className="text-[13px] font-bold text-ink leading-tight truncate">{c.name}</h2>
            </div>
            <button
              onClick={() => setShow2024(false)}
              className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0 mt-0.5"
            >
              ×
            </button>
          </div>

          {/* Winner summary */}
          {winner2024 && (
            <div className="mx-3 mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: preview2024Color }} />
              <span className="text-[12px] font-semibold text-ink flex-1 truncate">
                {PARTIES[winner2024[0]]?.name ?? winner2024[0]}
              </span>
              <span className="font-mono text-[11px] font-semibold text-ink-2">{winner2024Pct.toFixed(1)}%</span>
              <span className="text-[10px] font-mono text-ink-3">+{margin2024.toFixed(1)}</span>
            </div>
          )}

          {/* Full 2024 results list */}
          <div className="flex-1 overflow-y-auto px-3 py-2.5 thin-scroll space-y-2">
            {results2024Sorted.map(([partyId, votes]) => {
              const party = PARTIES[partyId as PartyId];
              const pct = (votes / c.validVotes) * 100;
              return (
                <div key={partyId}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: party?.color ?? '#888' }} />
                    <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">
                      {party?.name ?? partyId}
                    </span>
                    <span className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  {/* Read-only bar */}
                  <div className="w-full h-[5px] rounded-full bg-[#eae8e3] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: party?.color ?? '#888' }}
                    />
                  </div>
                  <div className="text-right text-[9px] font-mono text-ink-3 -mt-0.5">
                    {votes.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main constituency panel */}
      <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">

        {/* Header */}
        <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h1 className="text-[17px] font-bold text-ink leading-tight truncate">{c.name}</h1>
              <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
                {c.region || c.country} · {c.validVotes.toLocaleString()} votes
              </p>
            </div>
            <button
              onClick={handleClose}
              className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink transition-colors shrink-0 text-base leading-none mt-0.5"
            >
              ×
            </button>
          </div>

          {/* Live winner preview */}
          {baselineLoaded && winner && (
            <div className="mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: previewColor }} />
              <span className="text-[12px] font-semibold text-ink flex-1 truncate">{PARTIES[winner.p]?.name ?? winner.p}</span>
              <span className="font-mono text-[11px] font-semibold text-ink-2">{winnerPct.toFixed(1)}%</span>
              <span className="text-[10px] font-mono text-ink-3">+{margin.toFixed(1)}</span>
              {isEdited && (
                <span className="text-[8.5px] font-mono font-bold text-gold-deep bg-[rgba(200,160,32,0.12)] px-1.5 py-0.5 rounded-[3px] uppercase tracking-wide">
                  edited
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sliders */}
        <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-2">
          {partyIds.map(partyId => {
            const party    = PARTIES[partyId];
            const votes    = results[partyId] ?? 0;
            const pct      = denominator > 0 ? (votes / denominator) * 100 : 0;
            const isLocked = locked.has(partyId);

            return (
              <div key={partyId}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: party?.color ?? '#888' }}
                  />
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
                  {editingPct[partyId] !== undefined ? (
                    <input
                      type="text"
                      value={editingPct[partyId]}
                      onChange={e => setEditingPct(prev => ({ ...prev, [partyId]: e.target.value }))}
                      onBlur={() => {
                        const raw = parseFloat(editingPct[partyId] ?? '');
                        if (!isNaN(raw)) handleSlider(partyId, Math.max(0, Math.min(100, raw)));
                        setEditingPct(prev => { const n = { ...prev }; delete n[partyId]; return n; });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingPct(prev => { const n = { ...prev }; delete n[partyId]; return n; });
                      }}
                      className="text-[10px] font-mono font-semibold text-blue-600 tabular-nums w-[38px] text-right leading-none bg-transparent border-b border-blue-400 outline-none"
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                    />
                  ) : (
                    <span
                      className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none cursor-text hover:text-blue-600 hover:underline"
                      title="Click to type a value"
                      onClick={() => {
                        if (!baselineLoaded) return;
                        setEditingPct(prev => ({ ...prev, [partyId]: pct.toFixed(1) }));
                      }}
                    >
                      {pct.toFixed(1)}%
                    </span>
                  )}
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

        {/* Footer */}
        <div className="px-3.5 py-2.5 border-t border-default space-y-2">

          {/* Declaration button — blank map only */}
          {isBlankMap && (
            isDeclared ? (
              <div className="flex items-center justify-center gap-1.5 h-7 text-[10.5px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[4px] tracking-wide uppercase">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <circle cx="5.5" cy="5.5" r="5.5" fill="#059669"/>
                  <path d="M2.5 5.5l2 2L8.5 3.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Result Declared
              </div>
            ) : (
              <button
                onClick={() => { if (selectedId) declareConstituency(selectedId); }}
                className="w-full h-8 text-[11px] font-mono font-bold rounded-[4px] bg-[#B91C1C] text-white hover:bg-[#991B1B] active:bg-[#7F1D1D] transition-colors uppercase tracking-wide shadow-sm"
              >
                Make a Result Declaration
              </button>
            )
          )}

          {/* View 2024 result — blank map only */}
          {isBlankMap && (
            <button
              onClick={() => setShow2024(v => !v)}
              className={`w-full h-7 text-[11px] font-mono font-medium rounded-[4px] border transition-colors uppercase tracking-wide ${
                show2024
                  ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'border-default text-ink-3 hover:bg-hover hover:text-ink'
              }`}
            >
              {show2024 ? '◀ Hide 2024 result' : '▶ View 2024 result'}
            </button>
          )}

          <button
            onClick={handleReset}
            disabled={!baselineLoaded || !isEdited}
            className="w-full h-7 text-[11px] font-mono font-medium rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors uppercase tracking-wide"
          >
            ↻ Reset to 2024
          </button>
        </div>
      </aside>
    </>
  );
}
