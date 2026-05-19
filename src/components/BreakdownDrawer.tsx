import { useState, useMemo } from 'react';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';
import {
  computeConstituencyResults,
  computeRegionBreakdown,
  computeBiggestSwings,
  computeFptpDistortion,
} from '../lib/seat-tally';

type Tab = 'region' | 'swings' | 'closest' | 'distortion';

export function BreakdownDrawer({ exiting = false }: { exiting?: boolean }) {
  const setBreakdownOpen = useElectionStore(s => s.setBreakdownOpen);
  const constituencies = useElectionStore(s => s.constituencies);
  const currentResults = useElectionStore(s => s.currentResults);
  const baselineLoaded = useElectionStore(s => s.baselineLoaded);

  const [tab, setTab] = useState<Tab>('region');

  const cResults = useMemo(
    () => computeConstituencyResults(constituencies, currentResults),
    [constituencies, currentResults],
  );

  const regionData = useMemo(() => computeRegionBreakdown(cResults), [cResults]);

  const swings = useMemo(
    () => computeBiggestSwings(constituencies, currentResults),
    [constituencies, currentResults],
  );

  const closestSeats = useMemo(
    () => [...cResults].sort((a, b) => a.marginPct - b.marginPct).slice(0, 20),
    [cResults],
  );

  const distortion = useMemo(
    () => computeFptpDistortion(constituencies, currentResults),
    [constituencies, currentResults],
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'region', label: 'By region' },
    { id: 'swings', label: 'Biggest swings' },
    { id: 'closest', label: 'Closest seats' },
    { id: 'distortion', label: 'Votes vs seats' },
  ];

  return (
    <aside className={`w-96 shrink-0 bg-card border-l border-subtle flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-subtle">
        <h2 className="text-[16px] font-semibold text-ink">Race breakdown</h2>
        <button
          onClick={() => setBreakdownOpen(false)}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg"
        >
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-subtle shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 text-[11px] py-2.5 font-medium transition-colors ${
              tab === t.id
                ? 'text-gold-deep border-b-2 border-gold'
                : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!baselineLoaded && (
        <div className="flex-1 flex items-center justify-center text-[13px] text-ink-3 italic">
          Load the 2024 baseline to see breakdown
        </div>
      )}

      {baselineLoaded && (
        <div className="flex-1 overflow-y-auto thin-scroll">
          {tab === 'region' && <RegionTab data={regionData} />}
          {tab === 'swings' && <SwingsTab data={swings} />}
          {tab === 'closest' && <ClosestTab data={closestSeats} />}
          {tab === 'distortion' && <DistortionTab data={distortion} />}
        </div>
      )}
    </aside>
  );
}

function PartyDot({ partyId }: { partyId: PartyId }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
      style={{ background: PARTIES[partyId]?.color ?? '#888' }}
    />
  );
}

function RegionTab({ data }: { data: ReturnType<typeof computeRegionBreakdown> }) {
  return (
    <div className="p-4 space-y-4">
      {data.map(r => (
        <div key={r.region}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-semibold text-ink">{r.region}</span>
            <span className="text-[11px] text-ink-3 font-mono">{r.total} seats</span>
          </div>
          {/* Proportional mini-bar */}
          <div className="flex h-3 rounded overflow-hidden mb-1.5">
            {(Object.entries(r.seats) as [PartyId, number][])
              .sort(([, a], [, b]) => b - a)
              .map(([p, n]) => (
                <div
                  key={p}
                  className="h-full"
                  style={{ width: `${(n / r.total) * 100}%`, background: PARTIES[p]?.color ?? '#888' }}
                  title={`${PARTIES[p]?.name ?? p}: ${n}`}
                />
              ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {(Object.entries(r.seats) as [PartyId, number][])
              .sort(([, a], [, b]) => b - a)
              .map(([p, n]) => (
                <span key={p} className="flex items-center gap-1 text-[10px] text-ink-2">
                  <PartyDot partyId={p} />
                  <span className="font-mono">{n}</span>
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SwingsTab({ data }: { data: ReturnType<typeof computeBiggestSwings> }) {
  const maxSwing = Math.max(...data.map(s => Math.abs(s.swingPct)), 1);
  return (
    <div className="divide-y divide-subtle">
      {data.map((s, i) => (
        <div key={`${s.id}-${s.party}`} className="px-4 py-2.5 flex items-center gap-3">
          <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i + 1}</span>
          <PartyDot partyId={s.party} />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-ink truncate">{s.name}</div>
            <div className="flex items-center gap-1 mt-0.5">
              {/* Bar */}
              <div className="flex-1 h-1.5 bg-active rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(Math.abs(s.swingPct) / maxSwing) * 100}%`,
                    background: PARTIES[s.party]?.color ?? '#888',
                    opacity: s.swingPct > 0 ? 1 : 0.5,
                  }}
                />
              </div>
            </div>
          </div>
          <span
            className={`text-[12px] font-mono shrink-0 ${s.swingPct > 0 ? 'text-emerald-600' : 'text-red-500'}`}
          >
            {s.swingPct > 0 ? '+' : ''}{s.swingPct.toFixed(1)}pp
          </span>
        </div>
      ))}
    </div>
  );
}

function ClosestTab({ data }: { data: ReturnType<typeof computeConstituencyResults> }) {
  return (
    <div className="divide-y divide-subtle">
      {data.map((c, i) => (
        <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
          <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <PartyDot partyId={c.winner} />
              {c.runnerUp && <PartyDot partyId={c.runnerUp} />}
              <span className="text-[12px] text-ink truncate">{c.name}</span>
            </div>
            <span className="text-[10px] text-ink-3">{c.region}</span>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[12px] font-mono text-ink">{c.winnerPct.toFixed(1)}%</div>
            <div className="text-[10px] font-mono text-gold-deep">+{c.marginPct.toFixed(1)}pp</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DistortionTab({ data }: { data: ReturnType<typeof computeFptpDistortion> }) {
  const maxShare = Math.max(...data.flatMap(r => [r.voteShare, r.seatShare]), 1);
  return (
    <div className="p-4 space-y-4">
      <p className="eyebrow mb-3">
        Vote share vs seat share
      </p>
      {data.map(r => (
        <div key={r.party}>
          <div className="flex items-center gap-2 mb-1.5">
            <PartyDot partyId={r.party} />
            <span className="text-[12px] text-ink flex-1">{PARTIES[r.party]?.name ?? r.party}</span>
            <span className="text-[11px] text-ink-3 font-mono">{r.seats} seats</span>
          </div>
          {/* Vote share bar */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] text-ink-3 w-10 text-right">Votes</span>
            <div className="flex-1 h-2 bg-active rounded overflow-hidden">
              <div
                className="h-full rounded opacity-60"
                style={{ width: `${(r.voteShare / maxShare) * 100}%`, background: PARTIES[r.party]?.color ?? '#888' }}
              />
            </div>
            <span className="text-[10px] font-mono text-ink-2 w-8">{r.voteShare.toFixed(1)}%</span>
          </div>
          {/* Seat share bar */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-ink-3 w-10 text-right">Seats</span>
            <div className="flex-1 h-2 bg-active rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${(r.seatShare / maxShare) * 100}%`, background: PARTIES[r.party]?.color ?? '#888' }}
              />
            </div>
            <span className="text-[10px] font-mono text-ink-2 w-8">{r.seatShare.toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}
