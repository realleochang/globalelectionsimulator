import { useState, useEffect, useRef, useCallback } from 'react';
import { useElectionStore, DATA_2026 } from '../store/useElectionStore';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';

// ── Randomness ───────────────────────────────────────────────────────────────
function randNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Returns N times (ms) distributed on a bell curve over [0, totalMs], sorted ascending
function bellCurveTimes(n: number, totalMs: number): number[] {
  const mean = totalMs / 2;
  const std  = totalMs / 6; // 99.7% within ±3σ, i.e. nearly all inside [0, totalMs]
  return Array.from({ length: n }, () =>
    Math.max(2000, Math.min(totalMs - 500, Math.round(mean + std * randNormal())))
  ).sort((a, b) => a - b);
}

// ── Party groups ─────────────────────────────────────────────────────────────
const GB_MAIN: PartyId[]    = ['LAB', 'CON', 'LD', 'RFM', 'GRN'];
const NI_PARTIES: PartyId[] = ['DUP', 'SF', 'SDLP', 'UUP', 'ALL', 'TUV'];

const parseNum = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : Math.max(0, n); };

// ── Compute 2026 polling baselines ────────────────────────────────────────────
type Constituency = { id: string; country: string; validVotes: number; results2024: Partial<Record<PartyId, number>> };

function computeBaselines(constituencies: Constituency[]) {
  const gbTotals: Partial<Record<PartyId, number>> = {};
  const scotTotals: Partial<Record<PartyId, number>> = {};
  const walesTotals: Partial<Record<PartyId, number>> = {};
  let gbVotesTotal = 0, scotVotesTotal = 0, walesVotesTotal = 0;

  for (const c of constituencies) {
    if (c.country === 'NI') continue;
    const d = DATA_2026[c.id];
    const entries: [PartyId, number][] = d
      ? Object.entries(d).map(([p, frac]) => [p as PartyId, frac * c.validVotes])
      : (Object.entries(c.results2024) as [PartyId, number][]);
    gbVotesTotal += c.validVotes;
    for (const [p, v] of entries) if (v > 0) gbTotals[p] = (gbTotals[p] ?? 0) + v;
    if (c.country === 'Scotland') {
      scotVotesTotal += c.validVotes;
      for (const [p, v] of entries) if (v > 0) scotTotals[p] = (scotTotals[p] ?? 0) + v;
    }
    if (c.country === 'Wales') {
      walesVotesTotal += c.validVotes;
      for (const [p, v] of entries) if (v > 0) walesTotals[p] = (walesTotals[p] ?? 0) + v;
    }
  }

  const toFrac = (totals: Partial<Record<PartyId, number>>, total: number): Partial<Record<PartyId, number>> =>
    Object.fromEntries((Object.entries(totals) as [PartyId, number][]).map(([p, v]) => [p, total > 0 ? v / total : 0]));

  return {
    gbBaselines:    toFrac(gbTotals,    gbVotesTotal),
    scotBaselines:  toFrac(scotTotals,  scotVotesTotal),
    walesBaselines: toFrac(walesTotals, walesVotesTotal),
  };
}

// ── UNS vote generation per constituency ─────────────────────────────────────
// gbShares: GB_MAIN = fraction of GB vote; SNP = fraction of Scotland vote; PC = fraction of Wales vote
// NI constituencies always use their 2024 results unchanged.
function generateResultUNS(
  c: Constituency,
  gbShares: Partial<Record<PartyId, number>>,
  baselines: ReturnType<typeof computeBaselines>,
): Partial<Record<PartyId, number>> {
  const { gbBaselines, scotBaselines, walesBaselines } = baselines;

  // NI uses 2024 results unchanged
  if (c.country === 'NI') {
    return { ...c.results2024 };
  }

  // Start from 2026 polling data; fall back to 2024 for any missing constituency
  const d = DATA_2026[c.id];
  const result: Partial<Record<PartyId, number>> = d
    ? Object.fromEntries(Object.entries(d).map(([p, frac]) => [p, Math.round(frac * c.validVotes)]))
    : { ...c.results2024 };

  {
    // Apply GB_MAIN swings (baseline = fraction of all GB/non-NI votes)
    for (const p of GB_MAIN) {
      const swing = (gbShares[p] ?? 0) - (gbBaselines[p] ?? 0);
      result[p] = Math.max(0, (result[p] ?? 0) + swing * c.validVotes);
    }
    if (c.country === 'Scotland') {
      const swing = (gbShares['SNP'] ?? 0) - (scotBaselines['SNP'] ?? 0);
      result['SNP'] = Math.max(0, (result['SNP'] ?? 0) + swing * c.validVotes);
      delete result['PC'];
    } else if (c.country === 'Wales') {
      const swing = (gbShares['PC'] ?? 0) - (walesBaselines['PC'] ?? 0);
      result['PC'] = Math.max(0, (result['PC'] ?? 0) + swing * c.validVotes);
      delete result['SNP'];
    } else {
      delete result['SNP'];
      delete result['PC'];
    }
    // Remove NI parties from GB constituencies
    for (const p of NI_PARTIES) delete result[p];
  }

  // Normalize to validVotes
  const entries = (Object.entries(result) as [PartyId, number][]).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) {
    const winner = (Object.entries(c.results2024) as [PartyId, number][])
      .sort(([, a], [, b]) => b - a)[0]?.[0];
    if (winner) result[winner] = c.validVotes;
    return result;
  }
  const scale = c.validVotes / total;
  let distributed = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    const [p, v] = entries[i];
    result[p] = Math.round(v * scale);
    distributed += result[p] as number;
  }
  const [lastP] = entries[entries.length - 1];
  result[lastP] = Math.max(0, c.validVotes - distributed);
  return result;
}

// ── Main component ───────────────────────────────────────────────────────────
type Props = { onClose: () => void };

export function SimulationPanel({ onClose }: Props) {
  const constituencies         = useElectionStore(s => s.constituencies);
  const batchSetResults        = useElectionStore(s => s.batchSetResults);
  const declareConstituency    = useElectionStore(s => s.declareConstituency);
  const baselineLoaded         = useElectionStore(s => s.baselineLoaded);
  const running                    = useElectionStore(s => s.simulationRunning);
  const progress                   = useElectionStore(s => s.simulationProgress);
  const setRunning                 = useElectionStore(s => s.setSimulationRunning);
  const setProgress                = useElectionStore(s => s.setSimulationProgress);
  const registerSimulationTimers   = useElectionStore(s => s.registerSimulationTimers);
  const stopSimulation             = useElectionStore(s => s.stopSimulation);

  // ── Inputs ───────────────────────────────────────────────────────
  const [gbInputs, setGbInputs] = useState<Partial<Record<PartyId, string>>>(
    Object.fromEntries(GB_MAIN.map(p => [p, '']))
  );
  const [snpInput, setSnpInput] = useState('');
  const [pcInput,  setPcInput]  = useState('');
  const [duration, setDuration] = useState<60 | 120 | 300 | 600>(60);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Nothing to clean up on unmount — store owns the timers and stopSimulation handles cancellation
  useEffect(() => () => { timersRef.current = []; }, []);

  // ── Region fractions (computed from data) ────────────────────────
  const { gbVotes, scotVotes, walesVotes } = (() => {
    let gb = 0, scot = 0, wales = 0;
    for (const c of constituencies) {
      if (c.country !== 'NI') gb += c.validVotes;
      if (c.country === 'Scotland') scot += c.validVotes;
      if (c.country === 'Wales')    wales += c.validVotes;
    }
    return { gbVotes: gb, scotVotes: scot, walesVotes: wales };
  })();
  const scotFrac  = gbVotes > 0 ? scotVotes  / gbVotes : 0.145;
  const walesFrac = gbVotes > 0 ? walesVotes / gbVotes : 0.050;

  // ── Derived summary values ───────────────────────────────────────
  const snpVal      = parseNum(snpInput);
  const pcVal       = parseNum(pcInput);
  const snpConv     = snpVal * scotFrac;
  const pcConv      = pcVal  * walesFrac;
  const mainlandSum = GB_MAIN.reduce((s, p) => s + parseNum(gbInputs[p] ?? ''), 0);
  const gbTotal     = mainlandSum + snpConv + pcConv;
  const gbValid     = gbTotal <= 100.05;
  const canRun      = gbValid && !running && baselineLoaded;

  // ── Handlers ─────────────────────────────────────────────────────
  const stopAll = useCallback(() => { stopSimulation(); }, [stopSimulation]);

  const handleClose = () => { if (!running) stopAll(); onClose(); };

  const handleRun = () => {
    if (running) { stopAll(); return; }

    // Build fractional share maps (0–1)
    const gbShares: Partial<Record<PartyId, number>> = {};
    for (const p of GB_MAIN) gbShares[p] = parseNum(gbInputs[p] ?? '') / 100;
    gbShares['SNP'] = snpVal / 100; // fraction of Scotland vote
    gbShares['PC']  = pcVal  / 100; // fraction of Wales vote

    // Generate all results in one batch using UNS from 2024 baseline (NI uses 2024 data unchanged)
    const baselines = computeBaselines(constituencies);
    const allResults: Record<string, Partial<Record<PartyId, number>>> = {};
    for (const c of constituencies) allResults[c.id] = generateResultUNS(c, gbShares, baselines);
    batchSetResults(allResults);

    // Declaration order — Sunderland Central always first
    const sunderland = constituencies.find(c => c.name === 'Sunderland Central')
      ?? constituencies.find(c => c.name.includes('Sunderland'));
    const rest = [...constituencies]
      .filter(c => c.id !== sunderland?.id)
      .sort(() => Math.random() - 0.5);

    const totalMs = duration * 1000;
    const times   = bellCurveTimes(rest.length, totalMs);

    setRunning(true);
    setProgress(0);
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Use a ref-counter so each timeout can read the latest value without closure issues
    let declared = 0;
    const inc = () => { declared += 1; setProgress(declared); };

    if (sunderland) {
      timers.push(setTimeout(() => { declareConstituency(sunderland.id); inc(); }, 5000));
    }

    rest.forEach((c, i) => {
      timers.push(setTimeout(() => { declareConstituency(c.id); inc(); }, times[i]));
    });

    timers.push(setTimeout(() => setRunning(false), totalMs + 3000));
    timersRef.current = timers;
    registerSimulationTimers(timers);
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">

      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-bold text-ink leading-tight">Election Night</h1>
          <p className="text-[9.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
            Simulation · Blank Map mode
          </p>
        </div>
        <button
          onClick={handleClose}
          className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5"
        >
          ×
        </button>
      </div>

      {/* Scrollable input area */}
      <div className="flex-1 overflow-y-auto thin-scroll">

        {/* Realism warning */}
        <div className="mx-3.5 mt-3 mb-1 rounded-[5px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[9px] font-mono text-amber-800 leading-relaxed">
          <span className="font-bold">Realistic scenarios only.</span> This is a serious election simulator using real constituency data and swing modelling. Absurd inputs (e.g. Reform 99%) will produce meaningless projections — garbage in, garbage out.
        </div>

        {/* GB Mainland */}
        <section className="px-3.5 pt-3 pb-1">
          <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2.5">
            Great Britain — % of GB vote
          </div>
          {GB_MAIN.map(p => (
            <PartyInputRow
              key={p}
              partyId={p}
              value={gbInputs[p] ?? ''}
              onChange={v => setGbInputs(prev => ({ ...prev, [p]: v }))}
              disabled={running}
            />
          ))}
        </section>

        <div className="h-px bg-black/6 mx-3.5 my-1" />

        {/* Regional */}
        <section className="px-3.5 pt-2 pb-1">
          <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2.5">
            Regional — % of region's vote
          </div>
          <PartyInputRow
            partyId="SNP"
            value={snpInput}
            onChange={setSnpInput}
            note={`Scotland only — ≈${snpConv.toFixed(1)}% of GB`}
            disabled={running}
          />
          <PartyInputRow
            partyId="PC"
            value={pcInput}
            onChange={setPcInput}
            note={`Wales only — ≈${pcConv.toFixed(1)}% of GB`}
            disabled={running}
          />
        </section>

        {/* Summary */}
        <div className="mx-3.5 mt-2 mb-3 rounded-[6px] border border-default bg-[#f8f7f4] px-3 py-2.5 text-[10.5px] font-mono space-y-1">
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.12em] text-ink-3 mb-1.5">
            Allocation Summary
          </div>
          <div className="flex justify-between text-ink-3">
            <span>Mainland parties</span>
            <span className="font-semibold text-ink">{mainlandSum.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between text-ink-3">
            <span>SNP (converted to GB)</span>
            <span className="font-semibold text-ink">{snpConv.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-ink-3">
            <span>PC (converted to GB)</span>
            <span className="font-semibold text-ink">{pcConv.toFixed(2)}%</span>
          </div>
          <div className={`flex justify-between border-t pt-1.5 font-bold ${gbValid ? 'text-emerald-600 border-emerald-200' : 'text-red-500 border-red-200'}`}>
            <span>GB Total</span>
            <span>{gbTotal.toFixed(1)}%</span>
          </div>
          {gbTotal < 99.95 && gbValid && (
            <div className="flex justify-between text-ink-3">
              <span>Others / Independents</span>
              <span className="font-semibold text-ink">{(100 - gbTotal).toFixed(1)}%</span>
            </div>
          )}
          <div className="flex justify-between pt-0.5 text-ink-3">
            <span>Northern Ireland</span>
            <span className="font-semibold">2024 baseline</span>
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="px-3.5 py-3 border-t border-default space-y-2.5">

        {/* Duration selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-ink-3 uppercase tracking-wide shrink-0">Duration</span>
          {([60, 120, 300, 600] as const).map(d => (
            <button
              key={d}
              onClick={() => !running && setDuration(d)}
              disabled={running}
              className={`flex-1 h-7 text-[10px] font-mono font-medium rounded-[4px] border transition-colors disabled:opacity-40 ${
                duration === d
                  ? 'bg-ink/8 border-ink/20 text-ink'
                  : 'border-default text-ink-3 hover:bg-hover hover:text-ink'
              }`}
            >
              {d === 60 ? '1m' : d === 120 ? '2m' : d === 300 ? '5m' : '10m'}
            </button>
          ))}
        </div>

        {/* Progress bar */}
        {running && (
          <div>
            <div className="flex justify-between text-[9.5px] font-mono text-ink-3 mb-1">
              <span>{progress} / 650 declared</span>
              <span>{Math.round((progress / 650) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#eae8e3] overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${(progress / 650) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Validation hint */}
        {!canRun && !running && (
          <p className="text-[9.5px] font-mono text-red-500 text-center leading-tight">
            {!baselineLoaded
              ? 'Load a baseline first'
              : `GB total exceeds 100% (now ${gbTotal.toFixed(1)}%)`}
          </p>
        )}

        {/* Run / Stop */}
        <button
          onClick={handleRun}
          disabled={!canRun && !running}
          className={`w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm ${
            running
              ? 'bg-[#B91C1C] text-white hover:bg-[#991B1B]'
              : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          {running ? '⏹  Stop Simulation' : '▶  Run Election Night Simulation'}
        </button>

      </div>
    </aside>
  );
}

// ── Party input row ──────────────────────────────────────────────────────────
function PartyInputRow({
  partyId, value, onChange, note, disabled,
}: {
  partyId:   PartyId;
  value:     string;
  onChange:  (v: string) => void;
  note?:     string;
  disabled?: boolean;
}) {
  const party = PARTIES[partyId];
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: party?.color ?? '#888' }} />
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] font-medium text-ink leading-none truncate">{party?.name ?? partyId}</div>
        {note && <div className="text-[8.5px] font-mono text-ink-3 leading-tight mt-0.5">{note}</div>}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          className="w-14 h-7 text-[11px] font-mono text-right px-2 rounded-[4px] border border-default bg-white focus:outline-none focus:border-ink-3 disabled:opacity-50 tabular-nums"
        />
        <span className="text-[10px] font-mono text-ink-3 w-3">%</span>
      </div>
    </div>
  );
}
