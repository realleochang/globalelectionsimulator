import { useState } from 'react';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';

const SWING_PARTIES: PartyId[] = ['LAB','CON','LD','RFM','GRN','SNP','PC','DUP','SF','SDLP','UUP','ALL','TUV'];

export function MultiSelectFloat() {
  const selectedIds      = useElectionStore(s => s.selectedIds);
  const clearSelection   = useElectionStore(s => s.clearSelection);
  const applySwing       = useElectionStore(s => s.applySwing);
  const compressToTossup = useElectionStore(s => s.compressToTossup);
  const baselineLoaded   = useElectionStore(s => s.baselineLoaded);

  const [party, setParty] = useState<PartyId>('LAB');
  const [delta, setDelta] = useState('');

  const n = selectedIds.size;
  if (n === 0) return null;

  const handleApply = () => {
    const d = parseFloat(delta);
    if (!isNaN(d) && d !== 0) { applySwing(party, d, selectedIds); setDelta(''); }
  };

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 bg-ink/95 text-white rounded-xl shadow-tooltip border border-white/10 px-4 py-2.5 flex items-center gap-3 text-[13px] whitespace-nowrap backdrop-blur-sm">
      <span className="font-semibold text-gold">{n} selected</span>
      <span className="text-white/20">|</span>

      <select
        value={party}
        onChange={e => setParty(e.target.value as PartyId)}
        className="bg-white/8 text-white text-[12px] rounded-lg px-2 py-1 border border-white/15 focus:outline-none"
      >
        {SWING_PARTIES.map(p => <option key={p} value={p} className="bg-gray-900">{PARTIES[p]?.name ?? p}</option>)}
      </select>

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={delta}
          onChange={e => setDelta(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleApply()}
          placeholder="±pp"
          className="w-14 bg-white/8 text-white text-[12px] rounded-lg px-2 py-1 border border-white/15 focus:outline-none text-center"
        />
        <button
          onClick={handleApply}
          disabled={!baselineLoaded || !delta || isNaN(parseFloat(delta))}
          className="h-7 px-2.5 text-[12px] font-medium rounded-lg bg-gold text-white hover:bg-gold-deep disabled:opacity-40 transition-colors"
        >
          Apply swing
        </button>
      </div>

      <button
        onClick={() => compressToTossup(selectedIds)}
        disabled={!baselineLoaded}
        className="h-7 px-2.5 text-[12px] font-medium rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 transition-colors"
      >
        Compress
      </button>

      <span className="text-white/20">|</span>
      <button onClick={clearSelection} className="text-[12px] text-white/40 hover:text-white transition-colors">Clear ×</button>
    </div>
  );
}
