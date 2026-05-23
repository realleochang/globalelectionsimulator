import { useState, useEffect, useRef } from 'react';
import { useElectionStore } from '../store/useElectionStore';

export function LiveBubble() {
  const simulationRunning  = useElectionStore(s => s.simulationRunning);
  const simulationProgress = useElectionStore(s => s.simulationProgress);

  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (simulationRunning) {
      startRef.current = Date.now();
      setElapsed(0);
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      startRef.current = null;
      setElapsed(0);
    }
  }, [simulationRunning]);

  if (!simulationRunning) return null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const pct  = Math.min((simulationProgress / 650) * 100, 100);

  return (
    <div className="absolute bottom-10 left-4 z-[1001] pointer-events-none select-none">

      {/* Main card */}
      <div
        className="flex items-center gap-4 px-5 py-3 rounded-2xl border border-white/12"
        style={{
          background: 'rgba(10,14,26,0.88)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* LIVE badge */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{
              background: '#ef4444',
              boxShadow: '0 0 0 0 rgba(239,68,68,0.7)',
              animation: 'livePulse 1.4s ease-in-out infinite',
            }}
          />
          <span
            className="font-mono font-black uppercase tracking-[0.22em] leading-none"
            style={{ fontSize: 11, color: '#f87171' }}
          >
            LIVE
          </span>
        </div>

        {/* Divider */}
        <div className="w-px self-stretch bg-white/12" />

        {/* Reporting count */}
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <span
            className="font-black tabular-nums leading-none"
            style={{ fontSize: 26, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}
          >
            {simulationProgress.toLocaleString()}
          </span>
          <span
            className="font-mono uppercase tracking-wider leading-none"
            style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.45)' }}
          >
            of 650 reporting
          </span>
        </div>

        {/* Divider */}
        <div className="w-px self-stretch bg-white/12" />

        {/* Elapsed */}
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <span
            className="font-mono font-bold tabular-nums leading-none"
            style={{ fontSize: 26, color: '#ffffff', letterSpacing: '0.04em' }}
          >
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </span>
          <span
            className="font-mono uppercase tracking-wider leading-none"
            style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.45)' }}
          >
            elapsed
          </span>
        </div>
      </div>

      {/* Thin progress bar below the card */}
      <div className="mt-2 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.10)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #ef4444 0%, #f97316 60%, #eab308 100%)',
            boxShadow: '0 0 6px rgba(239,68,68,0.6)',
          }}
        />
      </div>

    </div>
  );
}
