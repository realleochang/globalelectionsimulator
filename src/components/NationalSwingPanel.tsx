import { useState } from 'react';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';

export function NationalSwingPanel({ exiting = false }: { exiting?: boolean }) {
  const setNationalSwingOpen = useElectionStore(s => s.setNationalSwingOpen);
  const applySwing           = useElectionStore(s => s.applySwing);
  const compressToTossup     = useElectionStore(s => s.compressToTossup);
  const loadBaseline         = useElectionStore(s => s.loadBaseline);
  const baselineLoaded       = useElectionStore(s => s.baselineLoaded);
  const hiddenParties        = useElectionStore(s => s.hiddenParties);

  const swingParties = (Object.keys(PARTIES) as PartyId[]).filter(p => !hiddenParties.has(p) && p !== 'IND' && p !== 'SPK' && p !== 'OTH');

  const [quickInputs, setQuickInputs] = useState<Partial<Record<PartyId, string>>>({});
  const getQuickInput = (p: PartyId) => quickInputs[p] ?? '';

  const handleQuickApply = (p: PartyId) => {
    const val = parseFloat(getQuickInput(p));
    if (!isNaN(val) && val !== 0) {
      applySwing(p, val);
      setQuickInputs(prev => ({ ...prev, [p]: '' }));
    }
  };

  return (
    <aside className={`w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default">
        <h2 className="text-[13px] font-bold text-ink">National swing</h2>
        <button onClick={() => setNationalSwingOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 thin-scroll space-y-4">

        {/* Quick per-party inputs */}
        <section>
          <p className="eyebrow mb-2">Quick party swing</p>
          <div className="space-y-1.5">
            {swingParties.map(p => {
              const party = PARTIES[p];
              const raw = getQuickInput(p);
              const parsed = parseFloat(raw);
              const valid = !isNaN(parsed) && parsed !== 0;
              return (
                <div key={p} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: party?.color ?? '#888' }} />
                  <span className="text-[10px] font-mono text-ink-2 w-8 shrink-0 truncate">{p}</span>
                  <input
                    type="number"
                    value={raw}
                    onChange={e => setQuickInputs(prev => ({ ...prev, [p]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleQuickApply(p)}
                    placeholder="±pp"
                    disabled={!baselineLoaded}
                    className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none focus:border-strong disabled:opacity-40"
                  />
                  <button
                    onClick={() => handleQuickApply(p)}
                    disabled={!baselineLoaded || !valid}
                    className="h-6 px-2 text-[10px] font-mono font-semibold rounded-[4px] border border-default text-ink-2 hover:bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Apply
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Scenarios */}
        <section>
          <p className="eyebrow mb-2">Scenarios</p>
          <button
            onClick={() => compressToTossup()}
            disabled={!baselineLoaded}
            className="w-full px-3 py-2 text-left rounded-[4px] border border-default hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <p className="text-[11px] font-semibold text-ink">Compress to tossup</p>
            <p className="text-[9px] font-mono text-ink-3 mt-0.5">Moves each seat halfway toward equal vote share</p>
          </button>
        </section>

        <section className="pt-2 border-t border-default">
          <button
            onClick={loadBaseline}
            disabled={!baselineLoaded}
            className="w-full h-7 text-[11px] font-mono font-medium rounded-[4px] border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors uppercase tracking-wide"
          >
            Reset all to 2024 baseline
          </button>
        </section>
      </div>
    </aside>
  );
}
