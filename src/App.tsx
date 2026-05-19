import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MapView } from './components/MapView';
import { Scoreboard } from './components/Scoreboard';
import { ConstituencyPanel } from './components/ConstituencyPanel';
import { NationalSwingPanel } from './components/NationalSwingPanel';
import { MultiSelectFloat } from './components/MultiSelectFloat';
import { BreakdownDrawer } from './components/BreakdownDrawer';
import { PartyManagerPanel } from './components/PartyManagerPanel';
import { ParliamentPanel } from './components/ParliamentModal';
import { useElectionStore } from './store/useElectionStore';
import type { PartyId } from './data/parties';
import type { Constituency } from './types';

export default function App() {
  // ── Dark mode ─────────────────────────────────────────────────────
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') === 'true');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);
  const setConstituencies     = useElectionStore(s => s.setConstituencies);
  const loadBaseline          = useElectionStore(s => s.loadBaseline);
  const load2026Polling       = useElectionStore(s => s.load2026Polling);
  const resetAll              = useElectionStore(s => s.resetAll);
  const constituencies        = useElectionStore(s => s.constituencies);
  const currentResults        = useElectionStore(s => s.currentResults);
  const multiSelectMode       = useElectionStore(s => s.multiSelectMode);
  const toggleMultiSelectMode = useElectionStore(s => s.toggleMultiSelectMode);
  const nationalSwingOpen     = useElectionStore(s => s.nationalSwingOpen);
  const setNationalSwingOpen  = useElectionStore(s => s.setNationalSwingOpen);
  const breakdownOpen         = useElectionStore(s => s.breakdownOpen);
  const setBreakdownOpen      = useElectionStore(s => s.setBreakdownOpen);
  const partyManagerOpen      = useElectionStore(s => s.partyManagerOpen);
  const setPartyManagerOpen   = useElectionStore(s => s.setPartyManagerOpen);
  const parliamentOpen        = useElectionStore(s => s.parliamentOpen);
  const setParliamentOpen     = useElectionStore(s => s.setParliamentOpen);
  const baselineLoaded        = useElectionStore(s => s.baselineLoaded);
  const activePreset          = useElectionStore(s => s.activePreset);
  const isBlankMap            = useElectionStore(s => s.isBlankMap);
  const declaredIds           = useElectionStore(s => s.declaredIds);
  const selectedId            = useElectionStore(s => s.selectedId);
  const selectedIds           = useElectionStore(s => s.selectedIds);

  useEffect(() => {
    fetch('/constituencies.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Constituency[]>; })
      .then(data => { setConstituencies(data); load2026Polling(); })
      .catch(console.error);
  }, [setConstituencies, load2026Polling]);

  // Tally for parliament modal — respects blank-map declared-only mode
  const parliamentTally = useMemo(() => {
    const tally: Partial<Record<PartyId, number>> = {};
    if (!baselineLoaded) return tally;
    for (const c of constituencies) {
      if (isBlankMap && !declaredIds.has(c.id)) continue;
      const results = currentResults[c.id] ?? (c as Constituency).results2024;
      const winner = (Object.entries(results) as [PartyId, number][])
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)[0]?.[0];
      if (winner) tally[winner] = (tally[winner] ?? 0) + 1;
    }
    return tally;
  }, [baselineLoaded, constituencies, currentResults, isBlankMap, declaredIds]);

  // Track which right-side panel is animating out
  type PanelKey = 'natSwing' | 'breakdown' | 'partyManager';
  const [exitPanel, setExitPanel] = useState<PanelKey | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerExit = useCallback((panel: PanelKey) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  const handleNatSwing = useCallback(() => {
    if (nationalSwingOpen) { setNationalSwingOpen(false); return; }
    if (breakdownOpen)    { setBreakdownOpen(false);    triggerExit('breakdown'); }
    if (partyManagerOpen) { setPartyManagerOpen(false); triggerExit('partyManager'); }
    setNationalSwingOpen(true);
  }, [nationalSwingOpen, breakdownOpen, partyManagerOpen, setNationalSwingOpen, setBreakdownOpen, setPartyManagerOpen, triggerExit]);

  const handleBreakdown = useCallback(() => {
    if (breakdownOpen) { setBreakdownOpen(false); return; }
    if (nationalSwingOpen) { setNationalSwingOpen(false); triggerExit('natSwing'); }
    if (partyManagerOpen)  { setPartyManagerOpen(false);  triggerExit('partyManager'); }
    setBreakdownOpen(true);
  }, [breakdownOpen, nationalSwingOpen, partyManagerOpen, setNationalSwingOpen, setBreakdownOpen, setPartyManagerOpen, triggerExit]);

  const handlePartyManager = useCallback(() => {
    if (partyManagerOpen) { setPartyManagerOpen(false); return; }
    if (nationalSwingOpen) { setNationalSwingOpen(false); triggerExit('natSwing'); }
    if (breakdownOpen)     { setBreakdownOpen(false);     triggerExit('breakdown'); }
    setPartyManagerOpen(true);
  }, [partyManagerOpen, nationalSwingOpen, breakdownOpen, setNationalSwingOpen, setBreakdownOpen, setPartyManagerOpen, triggerExit]);

  const showConstituencyPanel  = !!selectedId && !nationalSwingOpen && !multiSelectMode && !breakdownOpen && !partyManagerOpen;
  const showNationalSwingPanel = nationalSwingOpen;
  const showBreakdownDrawer    = breakdownOpen;
  const showPartyManagerPanel  = partyManagerOpen;

  const btnBase     = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold     = `${btnBase} bg-gold text-white hover:bg-gold-deep disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnMuted    = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnActive   = `${btnBase} bg-ink/8 border border-default text-ink`;
  const btnInactive = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden">

      {/* ── Topbar ──────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center px-4 gap-2.5 z-50`}>

        {/* Title */}
        <div className="flex flex-col justify-center mr-2 leading-none">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-[14px] font-black uppercase tracking-tight text-ink leading-none">
              Custom Election Simulation
            </span>
            <span className="font-display text-[9px] font-black uppercase tracking-tight text-ink-3 leading-none opacity-60">
              for Nerds
            </span>
          </div>
          <span className="text-[7.5px] font-mono uppercase tracking-[0.13em] text-ink-3 leading-none mt-[3px]">
            UK Parliamentary Election Edition
          </span>
        </div>

        <div className="w-px h-4 bg-black/8 mx-0.5" />

        {/* Baseline / Reset */}
        <button onClick={loadBaseline} disabled={constituencies.length === 0} className={activePreset === 'baseline' ? btnGold : btnMuted}>
          2024 Baseline
        </button>
        <button onClick={load2026Polling} disabled={constituencies.length === 0} className={activePreset === 'polling2026' ? btnGold : btnMuted}>
          2026 Polling
        </button>
        <button onClick={resetAll} disabled={constituencies.length === 0} className={activePreset === 'blank' ? btnGold : btnMuted}>
          Blank Map
        </button>

        <div className="w-px h-4 bg-black/8 mx-0.5" />

        {/* Tools */}
        <div className="flex items-center gap-1.5">
          <button onClick={toggleMultiSelectMode} className={multiSelectMode ? btnActive : btnInactive}>
            {multiSelectMode ? `⊕ ${selectedIds.size} sel.` : 'Multi-select'}
          </button>
          <button onClick={handleNatSwing} className={nationalSwingOpen ? btnActive : btnInactive}>
            Nat. Swing
          </button>
          <button onClick={handleBreakdown} className={breakdownOpen ? btnActive : btnInactive}>
            Breakdown
          </button>
          <button onClick={handlePartyManager} className={partyManagerOpen ? btnActive : btnInactive}>
            Parties
          </button>
          <button
            onClick={() => setParliamentOpen(!parliamentOpen)}
            disabled={!baselineLoaded}
            className={parliamentOpen ? btnActive : btnInactive}
          >
            Parliament
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          {/* X / Twitter credit */}
          <a
            href="https://x.com/realleochang"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-default text-ink-3 hover:border-ink-3 hover:text-ink transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.18em] leading-none">@realleochang</span>
          </a>

          {/* Beta badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gold/50 bg-gold/10">
            <span className="w-[5px] h-[5px] rounded-full bg-gold animate-pulse shrink-0" />
            <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.18em] text-gold leading-none">Beta</span>
          </div>

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                <line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="3.6" y1="10.4" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ── Capture area ─────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        <Scoreboard />

        {/* Map + panels row */}
        <div className="flex flex-1 min-h-0 relative">
          {parliamentOpen && (
            <ParliamentPanel
              tally={parliamentTally}
              onClose={() => setParliamentOpen(false)}
            />
          )}
          <div className="flex-1 min-w-0 relative">
            <MapView />
            <MultiSelectFloat />
          </div>
          {showConstituencyPanel && <ConstituencyPanel />}
          {(showNationalSwingPanel || exitPanel === 'natSwing')    && <NationalSwingPanel  exiting={exitPanel === 'natSwing'} />}
          {(showBreakdownDrawer   || exitPanel === 'breakdown')   && <BreakdownDrawer     exiting={exitPanel === 'breakdown'} />}
          {(showPartyManagerPanel || exitPanel === 'partyManager') && <PartyManagerPanel  exiting={exitPanel === 'partyManager'} />}
        </div>

        {/* Branding stamp for PNG capture */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Custom Election Simulation for Nerds</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
        </div>
      </div>

    </div>
  );
}
