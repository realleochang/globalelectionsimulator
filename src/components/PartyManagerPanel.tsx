import { useElectionStore } from '../store/useElectionStore';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';

// Display order within each section
const ORIGINAL_ORDER: PartyId[] = [
  'LAB','CON','LD','RFM','GRN','SNP','PC',
  'DUP','SF','SDLP','UUP','ALL','TUV',
  'IND','SPK','OTH',
];
const EXTENDED_ORDER: PartyId[] = [
  'WPB','ALB','SDP','RCL','UKIP','HER','FOR','YRK','CPA','RES','YOUR',
];

function PartyRow({ partyId, inElection }: { partyId: PartyId; inElection: boolean }) {
  const togglePartyHidden = useElectionStore(s => s.togglePartyHidden);
  const party = PARTIES[partyId];

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#f8f7f4] transition-colors">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: party.color }}
      />
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-ink leading-none block truncate">
          {party.name}
        </span>
        {party.defaultLeader !== '—' && (
          <span className="text-[9px] font-mono text-ink-3 leading-none mt-0.5 block truncate">
            {party.defaultLeader}
          </span>
        )}
      </div>
      <button
        onClick={() => togglePartyHidden(partyId)}
        className={`h-6 px-2.5 text-[9px] font-mono font-bold rounded-[3px] uppercase tracking-widest transition-colors shrink-0 border ${
          inElection
            ? 'border-default text-ink-3 hover:border-red-300 hover:text-red-600 hover:bg-red-50'
            : 'border-default text-ink-3 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50'
        }`}
      >
        {inElection ? 'Hide' : 'Add'}
      </button>
    </div>
  );
}

export function PartyManagerPanel({ exiting = false }: { exiting?: boolean }) {
  const setPartyManagerOpen = useElectionStore(s => s.setPartyManagerOpen);
  const hiddenParties       = useElectionStore(s => s.hiddenParties);

  // Split into two lists based on hidden state
  const inElection    = ORIGINAL_ORDER.filter(id => !hiddenParties.has(id));
  const hiddenOrig    = ORIGINAL_ORDER.filter(id => hiddenParties.has(id));
  const activeExt     = EXTENDED_ORDER.filter(id => !hiddenParties.has(id));
  const inactiveExt   = EXTENDED_ORDER.filter(id => hiddenParties.has(id));

  const notInElection = [...hiddenOrig, ...inactiveExt];
  const allInElection = [...inElection, ...activeExt];

  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>

      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Party Manager</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5 leading-none uppercase tracking-wide">
            Add or remove parties from the election
          </p>
        </div>
        <button
          onClick={() => setPartyManagerOpen(false)}
          className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none transition-colors shrink-0"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">

        {/* ── In Election ─────────────────────────────────────────── */}
        <div className="px-3.5 pt-3 pb-1 flex items-center justify-between sticky top-0 bg-white z-10 border-b border-default">
          <span className="eyebrow">In Election</span>
          <span className="text-[9px] font-mono text-ink-3">{allInElection.length} parties</span>
        </div>

        {allInElection.length === 0 && (
          <p className="px-3.5 py-3 text-[11px] text-ink-3 italic">All parties hidden</p>
        )}

        {allInElection.map(id => (
          <PartyRow key={id} partyId={id} inElection />
        ))}

        {/* ── Not in Election ─────────────────────────────────────── */}
        <div className="px-3.5 pt-3 pb-1 flex items-center justify-between sticky top-0 bg-white z-10 border-b border-default border-t mt-1">
          <span className="eyebrow">Not in Election</span>
          <span className="text-[9px] font-mono text-ink-3">{notInElection.length} parties</span>
        </div>

        {notInElection.length === 0 && (
          <p className="px-3.5 py-3 text-[11px] text-ink-3 italic">All parties active</p>
        )}

        {notInElection.map(id => (
          <PartyRow key={id} partyId={id} inElection={false} />
        ))}

        <div className="h-4" />
      </div>

      {/* Footer note */}
      <div className="px-3.5 py-2.5 border-t border-default shrink-0">
        <p className="text-[9px] font-mono text-ink-3 leading-tight">
          Hiding a party removes it from sliders and the scoreboard.
          Adding a new party seeds it at 0% in every constituency.
        </p>
      </div>
    </aside>
  );
}
