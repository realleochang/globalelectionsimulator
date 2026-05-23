import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapView } from './components/MapView';
import { Scoreboard } from './components/Scoreboard';
import { ConstituencyPanel } from './components/ConstituencyPanel';
import { NationalSwingPanel } from './components/NationalSwingPanel';
import { MultiSelectFloat } from './components/MultiSelectFloat';
import { MultiSelectPanel } from './components/MultiSelectPanel';
import { SimulationPanel } from './components/SimulationPanel';
import { LiveBubble } from './components/LiveBubble';
import { BreakdownDrawer } from './components/BreakdownDrawer';
import { PartyManagerPanel } from './components/PartyManagerPanel';
import { ParliamentPanel } from './components/ParliamentModal';
import { useElectionStore } from './store/useElectionStore';
import type { PartyId } from './data/parties';
import type { Constituency } from './types';

export default function App() {
  const navigate = useNavigate();
  // ── Dark mode ─────────────────────────────────────────────────────
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') === 'true');
  const [contributorsOpen, setContributorsOpen] = useState(false);
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
  const simulationRunning     = useElectionStore(s => s.simulationRunning);
  const stopSimulation        = useElectionStore(s => s.stopSimulation);
  const activePreset          = useElectionStore(s => s.activePreset);
  const isBlankMap            = useElectionStore(s => s.isBlankMap);
  const declaredIds           = useElectionStore(s => s.declaredIds);
  const selectedId            = useElectionStore(s => s.selectedId);
  const selectedIds           = useElectionStore(s => s.selectedIds);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}constituencies.json`)
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
  const exitTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = headerScrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

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

  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationKey,  setSimulationKey]  = useState(0);
  const [bubbleMapMode,  setBubbleMapMode]  = useState(false);

  const showConstituencyPanel  = !!selectedId && !nationalSwingOpen && !multiSelectMode && !breakdownOpen && !partyManagerOpen && !simulationOpen;
  const showNationalSwingPanel = nationalSwingOpen;
  const showBreakdownDrawer    = breakdownOpen;
  const showPartyManagerPanel  = partyManagerOpen;

  const [scoreboardVisible, setScoreboardVisible] = useState(true);

  // Auto-open scoreboard when simulation starts; keep it open throughout
  useEffect(() => {
    if (simulationRunning) setScoreboardVisible(true);
  }, [simulationRunning]);

  // Stop simulation if player navigates away from blank map
  useEffect(() => {
    if (activePreset !== 'blank' && simulationRunning) {
      stopSimulation();
      setSimulationOpen(false);
    }
  }, [activePreset]);

  const handleSimulation = useCallback(() => {
    resetAll();
    setNationalSwingOpen(false);
    setBreakdownOpen(false);
    setPartyManagerOpen(false);
    setParliamentOpen(false);
    setSimulationKey(k => k + 1);
    setSimulationOpen(true);
  }, [resetAll, setNationalSwingOpen, setBreakdownOpen, setPartyManagerOpen, setParliamentOpen]);

  const btnBase     = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold     = `${btnBase} bg-gold text-white hover:bg-gold-deep disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnMuted    = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnActive   = `${btnBase} bg-ink/8 border border-default text-ink`;
  const btnInactive = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden">

      {/* ── Topbar ──────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>

        {/* Logo + title — always anchored left, title hidden on small screens */}
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">

        {/* Globe logo */}
        <svg width="34" height="34" viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
          <defs>
            <clipPath id="logo-clip">
              <circle cx="16" cy="16" r="14" />
            </clipPath>
            <radialGradient id="logo-shine" cx="38%" cy="32%" r="62%">
              <stop offset="0%" stopColor="white" stopOpacity="0.38" />
              <stop offset="100%" stopColor="black" stopOpacity="0.22" />
            </radialGradient>
          </defs>
          {/*
            Painter's algorithm — each layer is a spherical cap bounded below
            by the FRONT (bottom) arc of its latitude line, so color bands
            follow the true elliptical curve, not a flat horizontal cut.

            Latitude dividers (cx=16, all clipped to circle r=14):
              L1  y=7.6   rx=11.2 ry=2.8   left=(4.8,7.6)   right=(27.2,7.6)
              L2  y=13.2  rx=13.7 ry=3.4   left=(2.3,13.2)  right=(29.7,13.2)
              L3  y=18.8  rx=13.7 ry=3.4   left=(2.3,18.8)  right=(29.7,18.8)
              L4  y=24.4  rx=11.2 ry=2.8   left=(4.8,24.4)  right=(27.2,24.4)

            Each cap path:
              1. CW along the front (bottom) arc of the latitude ellipse, left→right
              2. CCW circle arc back over the top to the left endpoint
              large-arc=0 when endpoints are above centre (L1,L2),
              large-arc=1 when below centre (L3,L4)
          */}
          <g clipPath="url(#logo-clip)">
            {/* Conservative blue — base fill */}
            <circle cx="16" cy="16" r="14" fill="#0087DC" />
            {/* LibDem amber — cap above L4 */}
            <path d="M4.8 24.4 A11.2 2.8 0 0 1 27.2 24.4 A14 14 0 1 0 4.8 24.4Z" fill="#FAA61A" />
            {/* Labour red — cap above L3 */}
            <path d="M2.3 18.8 A13.7 3.4 0 0 1 29.7 18.8 A14 14 0 1 0 2.3 18.8Z" fill="#E4003B" />
            {/* Green — cap above L2 */}
            <path d="M2.3 13.2 A13.7 3.4 0 0 1 29.7 13.2 A14 14 0 0 0 2.3 13.2Z" fill="#02A95B" />
            {/* Reform teal — cap above L1 */}
            <path d="M4.8 7.6 A11.2 2.8 0 0 1 27.2 7.6 A14 14 0 0 0 4.8 7.6Z" fill="#12B6CF" />
          </g>
          {/* Latitude front arcs — solid (visible face) */}
          <g clipPath="url(#logo-clip)" stroke="white" strokeWidth="0.7" strokeOpacity="0.55" fill="none">
            <path d="M4.8 7.6  A11.2 2.8 0 0 1 27.2 7.6" />
            <path d="M2.3 13.2 A13.7 3.4 0 0 1 29.7 13.2" />
            <path d="M2.3 18.8 A13.7 3.4 0 0 1 29.7 18.8" />
            <path d="M4.8 24.4 A11.2 2.8 0 0 1 27.2 24.4" />
          </g>
          {/* Latitude back arcs — dashed (hidden face) */}
          <g clipPath="url(#logo-clip)" stroke="white" strokeWidth="0.6" strokeOpacity="0.22" strokeDasharray="1.5 1.5" fill="none">
            <path d="M4.8 7.6  A11.2 2.8 0 0 0 27.2 7.6" />
            <path d="M2.3 13.2 A13.7 3.4 0 0 0 29.7 13.2" />
            <path d="M2.3 18.8 A13.7 3.4 0 0 0 29.7 18.8" />
            <path d="M4.8 24.4 A11.2 2.8 0 0 0 27.2 24.4" />
          </g>
          {/* Longitude meridians */}
          <g clipPath="url(#logo-clip)" stroke="white" strokeWidth="0.65" strokeOpacity="0.30" fill="none">
            <line x1="16" y1="2" x2="16" y2="30" />
            <ellipse cx="16" cy="16" rx="8" ry="14" />
            <ellipse cx="16" cy="16" rx="4" ry="14" />
          </g>
          {/* Sphere shading overlay */}
          <circle cx="16" cy="16" r="14" fill="url(#logo-shine)" />
          {/* Outer ring */}
          <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
        </svg>

        {/* Title — hidden on small screens */}
        <div className="hidden sm:flex flex-col justify-center mr-2 leading-none">
          <span className="font-display font-black uppercase tracking-[0.04em] text-[14px] text-ink leading-none">
            Global Election Simulator
          </span>
          <span className="text-[7.5px] font-mono uppercase tracking-[0.13em] text-ink-3 leading-none mt-[3px]">
            Westminster Edition
          </span>
        </div>

        </button>

        {/* Scrollable button strip — wheel down scrolls right */}
        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

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

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          {/* Tools */}
          <button onClick={handleSimulation} className={`${btnBase} flex items-center gap-1.5 ${simulationOpen ? 'bg-ink/8 border border-default text-ink' : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'}`}>
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor" aria-hidden="true">
              <path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/>
            </svg>
            Simulation
          </button>
          <button onClick={toggleMultiSelectMode} className={multiSelectMode ? btnActive : btnInactive}>
            {multiSelectMode ? `⊕ ${selectedIds.size} sel.` : 'Multi-select'}
          </button>
          <button onClick={handlePartyManager} className={partyManagerOpen ? btnActive : btnInactive}>
            Parties
          </button>
          <button onClick={handleNatSwing} className={nationalSwingOpen ? btnActive : btnInactive}>
            Swing
          </button>
          <button onClick={handleBreakdown} className={breakdownOpen ? btnActive : btnInactive}>
            Breakdown
          </button>
          <button
            onClick={() => setParliamentOpen(!parliamentOpen)}
            disabled={!baselineLoaded}
            className={parliamentOpen ? btnActive : btnInactive}
          >
            Parliament
          </button>
          <button
            onClick={() => setBubbleMapMode(v => !v)}
            className={bubbleMapMode ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnInactive}
            title="Toggle bubble margin map"
          >
            Bubble Map
          </button>

        </div>

        {/* Right controls — always anchored right */}
        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          {/* Contributors dropdown */}
          <div className="relative">
            <button
              onClick={() => setContributorsOpen(o => !o)}
              className={`w-7 h-7 flex items-center justify-center rounded-[4px] border transition-colors ${
                contributorsOpen
                  ? 'border-ink-3 text-ink bg-hover'
                  : 'border-default text-ink-3 hover:border-ink-3 hover:text-ink'
              }`}
              title="Contributors"
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm1.5 7.5c.5-.25.5-.75.5-1s-.5-3-3-3.5a2.5 2.5 0 0 1 2.5 4.5z" fillRule="evenodd" clipRule="evenodd"/>
              </svg>
            </button>
            {contributorsOpen && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setContributorsOpen(false)} />
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-[100] w-56 rounded-[10px] bg-white border border-default overflow-hidden"
                  style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.13), 0 0 0 1px rgba(0,0,0,0.06)' }}
                >
                  <div className="px-3.5 pt-3 pb-2 border-b border-default">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-ink leading-none">Contributors</div>
                  </div>
                  <div className="px-3.5 py-2.5 space-y-2">
                    {/* Creator */}
                    <a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3" aria-hidden="true">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      <span className="text-[11px] font-mono font-semibold text-ink">@realleochang</span>
                    </a>
                    {[
                      { handle: 'RealAlbanianPat' },
                      { handle: 'whitehat47' },
                    ].map(c => (
                      <div key={c.handle} className="flex items-center gap-2">
                        <svg width="11" height="9" viewBox="0 0 24 19" fill="currentColor" className="shrink-0" style={{ color: '#5865F2' }} aria-hidden="true">
                          <path d="M20.317 1.492A19.825 19.825 0 0 0 15.71.163a.074.074 0 0 0-.079.038c-.34.6-.719 1.384-.984 2-.184-.028-.366-.054-.548-.078a18.607 18.607 0 0 0-9.795.078 13.51 13.51 0 0 0-.995-2.018.077.077 0 0 0-.079-.038A19.736 19.736 0 0 0 1.624 1.492a.07.07 0 0 0-.032.027C.533 6.093-.32 10.555.099 14.961a.08.08 0 0 0 .031.055 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.026c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.442a.061.061 0 0 0-.031-.028zM8.02 12.278c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                        </svg>
                        <span className="text-[11px] font-mono font-semibold text-ink">{c.handle}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
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

        {/* Collapsible scoreboard */}
        <div className="relative shrink-0">
          <div style={{
            display: 'grid',
            gridTemplateRows: scoreboardVisible ? '1fr' : '0fr',
            transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)',
          }}>
            <div className="overflow-hidden">
              <Scoreboard />
            </div>
          </div>
          {/* Collapse / expand handle — locked open during simulation */}
          <button
            onClick={() => !simulationRunning && setScoreboardVisible(v => !v)}
            title={simulationRunning ? 'Results locked during simulation' : scoreboardVisible ? 'Hide scoreboard' : 'Show scoreboard'}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1"
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true">
              {scoreboardVisible
                ? <path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">
              {scoreboardVisible ? 'Hide' : 'Results'}
            </span>
          </button>
        </div>

        {/* Map + panels row */}
        <div className="flex flex-1 min-h-0 relative">
          {parliamentOpen && (
            <ParliamentPanel
              tally={parliamentTally}
              onClose={() => setParliamentOpen(false)}
            />
          )}
          <div className="flex-1 min-w-0 relative">
            <MapView bubbleMapMode={bubbleMapMode} dark={dark} />
            <MultiSelectFloat />
            <LiveBubble />
          </div>
          {showConstituencyPanel && <ConstituencyPanel />}
          {multiSelectMode && selectedIds.size > 0 && !simulationOpen && <MultiSelectPanel />}
          {simulationOpen && (
            <SimulationPanel
              key={simulationKey}
              onClose={() => setSimulationOpen(false)}
            />
          )}
          {(showNationalSwingPanel || exitPanel === 'natSwing')    && <NationalSwingPanel  exiting={exitPanel === 'natSwing'} />}
          {(showBreakdownDrawer   || exitPanel === 'breakdown')   && <BreakdownDrawer     exiting={exitPanel === 'breakdown'} />}
          {(showPartyManagerPanel || exitPanel === 'partyManager') && <PartyManagerPanel  exiting={exitPanel === 'partyManager'} />}
        </div>

        {/* Branding stamp for PNG capture */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — UK Parliamentary Edition</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
        </div>
      </div>

    </div>
  );
}
