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

// ── Tutorial panel ─────────────────────────────────────────────────────────────
function UKTutorialPanel({ onClose, exiting }: { onClose: () => void; exiting?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>
  );
  const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>
  );
  const Note = ({ children }: { children: React.ReactNode }) => (
    <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>
  );
  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <div className="flex gap-2 mb-1.5">
      <span className="shrink-0 w-4 h-4 rounded-full bg-gold text-white text-[8px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span className="text-[11px] text-ink leading-relaxed">{children}</span>
    </div>
  );
  const Tag = ({ children, color = 'bg-ink/8 text-ink' }: { children: React.ReactNode; color?: string }) => (
    <span className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono font-semibold ${color} mr-1`}>{children}</span>
  );

  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Westminster Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">

        <H2>The UK Electoral System</H2>
        <P>The UK uses <strong>First Past the Post (FPTP)</strong>. Each of the <strong>650 constituencies</strong> returns one MP — whoever gets the most votes wins, no matter how small the margin.</P>
        <Note>A party can win the popular vote nationally and still lose in seats. In 2024 Labour won 33.7% of the vote but 63% of seats; Reform won 14.3% but just 5 seats.</Note>

        <H2>The 2024 Election</H2>
        <P>Labour won a landslide majority with <strong>412 seats</strong>, the Conservatives collapsed to <strong>121</strong>, and the Liberal Democrats surged to <strong>72</strong> — mostly from former blue-wall seats. Reform UK came fourth in votes but fifth in seats.</P>

        <H2>Map Presets</H2>
        <div className="space-y-2 mb-2">
          <div><Tag>2024 Baseline</Tag><span className="text-[10px] text-ink-2">Actual July 2024 general election results.</span></div>
          <div><Tag>2026 Polling</Tag><span className="text-[10px] text-ink-2">Current polling applied as a uniform national swing across all constituencies.</span></div>
          <div><Tag>Blank Map</Tag><span className="text-[10px] text-ink-2">All constituencies empty — project results manually as on election night.</span></div>
        </div>

        <H2>Editing a Constituency</H2>
        <P>Click any shaded constituency on the map to open its panel on the right.</P>
        <Step n={1}>Drag a party's slider or click the percentage to type a value directly.</Step>
        <Step n={2}>Adjusting one party redistributes the remaining share among unlocked parties.</Step>
        <Step n={3}>Click the <strong>lock icon</strong> to fix a party's share while you adjust others.</Step>
        <Step n={4}>Click <Tag>Reset to 2024</Tag> to restore the official result for that seat.</Step>

        <H2>National Swing</H2>
        <P>Click <Tag>Swing</Tag> to apply a <strong>uniform national swing</strong> across all constituencies at once — enter a ±pp shift per party and it applies everywhere proportionally.</P>

        <H2>Multi-Select</H2>
        <P>Click <Tag>Multi-select</Tag> then click several constituencies on the map. The panel lets you apply a swing to all selected seats simultaneously.</P>

        <H2>Simulation</H2>
        <P>Click <Tag>▶ Simulation</Tag> to enter election-night mode on a blank map. Results are called constituency by constituency in random order, modelled on your target national swing. Watch the seat count update live.</P>

        <H2>Other Tools</H2>
        <div className="space-y-1.5 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div><Tag>Breakdown</Tag> Seats by region — South East, Midlands, Scotland, etc.</div>
          <div><Tag>Parliament</Tag> Parliamentary composition of all 650 seats arranged by party.</div>
          <div><Tag>Bubble Map</Tag> Replace the choropleth with circles sized by raw vote margin.</div>
        </div>

        <H2>Reading the Scoreboard</H2>
        <P>Cards are ordered left-to-right by seat count. Each card shows the leader's name, party abbreviation, seat total, and vote share (%).</P>
        <div className="space-y-1.5 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div className="flex items-start gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-gold mt-1" /><span><strong>Gold border</strong> — this party has the most seats.</span></div>
          <div className="flex items-start gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-1" /><span><strong>Green shimmer + checkmark</strong> — this party has a majority (≥ 326 seats).</span></div>
        </div>
        <Note>Northern Ireland parties (DUP, Sinn Féin, SDLP, UUP, Alliance, TUV) are grouped separately in the scoreboard as they only contest NI constituencies.</Note>

        <div className="h-4" />
      </div>
    </aside>
  );
}

export default function App() {
  const navigate = useNavigate();
  // ── Dark mode ─────────────────────────────────────────────────────
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
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


  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationKey,  setSimulationKey]  = useState(0);
  const [bubbleMapMode,  setBubbleMapMode]  = useState(false);
  const [tutorialOpen,   setTutorialOpen]   = useState(false);
  const [tutorialExiting, setTutorialExiting] = useState(false);

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
            <clipPath id="logo-clip"><circle cx="16" cy="16" r="14" /></clipPath>
            <radialGradient id="logo-shine" cx="32%" cy="24%" r="52%">
              <stop offset="0%"   stopColor="white" stopOpacity="0.80" />
              <stop offset="45%"  stopColor="white" stopOpacity="0.12" />
              <stop offset="100%" stopColor="white" stopOpacity="0"    />
            </radialGradient>
            <radialGradient id="logo-depth" cx="70%" cy="72%" r="55%">
              <stop offset="0%"   stopColor="rgba(20,60,120,0.18)" />
              <stop offset="100%" stopColor="rgba(20,60,120,0)"    />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="rgba(180,215,255,0.09)" clipPath="url(#logo-clip)" />
          {/* Back latitude arcs — dashed, seen through glass */}
          <g clipPath="url(#logo-clip)" fill="none" strokeLinecap="round">
            <path d="M4.8 7.6 A11.2 2.8 0 0 0 27.2 7.6"   stroke="#12B6CF" strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
            <path d="M2.3 13.2 A13.7 3.4 0 0 0 29.7 13.2"  stroke="#02A95B" strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
            <path d="M2 16 A14 3.6 0 0 0 30 16"            stroke="#E4003B" strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
            <path d="M2.3 18.8 A13.7 3.4 0 0 0 29.7 18.8"  stroke="#FAA61A" strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
            <path d="M4.8 24.4 A11.2 2.8 0 0 0 27.2 24.4"  stroke="#0087DC" strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
          </g>
          {/* Back meridians — dashed */}
          <g clipPath="url(#logo-clip)" fill="none" stroke="rgba(80,140,210,0.22)" strokeWidth="0.6" strokeDasharray="2 2" strokeLinecap="round">
            <ellipse cx="16" cy="16" rx="8" ry="14" />
            <ellipse cx="16" cy="16" rx="4" ry="14" />
          </g>
          {/* Front latitude arcs — solid */}
          <g clipPath="url(#logo-clip)" fill="none" strokeLinecap="round">
            <path d="M4.8 7.6 A11.2 2.8 0 0 1 27.2 7.6"   stroke="#12B6CF" strokeWidth="1.30" strokeOpacity="0.90" />
            <path d="M2.3 13.2 A13.7 3.4 0 0 1 29.7 13.2"  stroke="#02A95B" strokeWidth="1.30" strokeOpacity="0.90" />
            <path d="M2 16 A14 3.6 0 0 1 30 16"            stroke="#E4003B" strokeWidth="1.30" strokeOpacity="0.90" />
            <path d="M2.3 18.8 A13.7 3.4 0 0 1 29.7 18.8"  stroke="#FAA61A" strokeWidth="1.30" strokeOpacity="0.90" />
            <path d="M4.8 24.4 A11.2 2.8 0 0 1 27.2 24.4"  stroke="#0087DC" strokeWidth="1.30" strokeOpacity="0.90" />
          </g>
          {/* Front meridians — solid */}
          <g clipPath="url(#logo-clip)" fill="none" stroke="rgba(80,140,210,0.32)" strokeLinecap="round">
            <line x1="16" y1="2" x2="16" y2="30" strokeWidth="0.70" />
            <ellipse cx="16" cy="16" rx="8" ry="14" strokeWidth="0.65" />
            <ellipse cx="16" cy="16" rx="4" ry="14" strokeWidth="0.55" />
          </g>
          <circle cx="16" cy="16" r="14" fill="url(#logo-depth)" />
          <circle cx="16" cy="16" r="14" fill="url(#logo-shine)" />
          <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(140,195,255,0.55)" strokeWidth="1.1" />
          <circle cx="16" cy="16" r="13.4" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.5" />
        </svg>

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
          <button
            onClick={() => {
              if (tutorialOpen) {
                setTutorialExiting(true);
                setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280);
              } else { setTutorialOpen(true); }
            }}
            className={tutorialOpen ? btnActive : btnInactive}
            title="How to play"
          >Tutorial</button>

        </div>

        {/* Right controls — always anchored right */}
        <div className="shrink-0 flex items-center gap-2.5 pr-4">

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
          {(tutorialOpen || tutorialExiting) && (
            <UKTutorialPanel
              onClose={() => { setTutorialExiting(true); setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280); }}
              exiting={tutorialExiting}
            />
          )}
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
