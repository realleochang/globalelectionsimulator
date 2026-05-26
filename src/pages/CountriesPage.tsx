import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COUNTRIES, CountryCard, GlobeLogo } from './HomePage';

export default function CountriesPage() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  const ink  = dark ? '#e8eef8'                : '#111111';
  const ink2 = dark ? 'rgba(180,200,240,0.52)' : 'rgba(0,0,0,0.46)';
  const bdr  = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';

  return (
    <div className="min-h-screen flex flex-col" data-country="countries">

      {/* Header */}
      <header className="h-[52px] sticky top-0 z-50 flex items-center px-4 gap-2.5 border-b"
        style={{
          background: dark ? 'rgba(10,18,38,0.94)' : 'rgba(248,245,240,0.94)',
          borderColor: bdr,
          backdropFilter: 'blur(20px)',
        }}>
        <div className="flex items-center gap-2.5">
          <GlobeLogo />
          <button
            onClick={() => navigate('/')}
            className="hidden sm:flex items-center gap-1.5 leading-none"
          >
            <span className="font-title font-bold text-[15px] tracking-tight leading-none brand-title">
              Global Election Simulator
            </span>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Back button */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[8.5px] font-mono font-black uppercase tracking-[0.16em] transition-opacity hover:opacity-70"
            style={{ borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)', color: ink2 }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M7 4.5H2M4 2.5L2 4.5 4 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Home
          </button>
          {/* Dark toggle */}
          <button onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border transition-colors"
            style={{ borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)', color: dark ? 'rgba(180,200,240,0.70)' : '#7a7870' }}
            title={dark ? 'Light mode' : 'Dark mode'}>
            {dark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none" />
                {[0,45,90,135,180,225,270,315].map(a => {
                  const rad = (a * Math.PI) / 180;
                  const x1 = 7 + 3.8 * Math.cos(rad); const y1 = 7 + 3.8 * Math.sin(rad);
                  const x2 = 7 + 5.2 * Math.cos(rad); const y2 = 7 + 5.2 * Math.sin(rad);
                  return <line key={a} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />;
                })}
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 pt-10 pb-20">
        <div className="max-w-5xl mx-auto">

          {/* Page heading */}
          <div className="mb-10">
            <div className="text-[8px] font-mono uppercase tracking-[0.28em] mb-3" style={{ color: ink2 }}>
              All simulations
            </div>
            <h1 className="font-display font-black text-[32px] sm:text-[40px] uppercase tracking-wide leading-tight" style={{ color: ink }}>
              Election Simulators
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed max-w-xl" style={{ color: ink2 }}>
              Choose a country to open its election simulator. Explore real electoral systems, model outcomes, and learn how votes become seats.
            </p>
          </div>

          {/* Country grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {COUNTRIES.map(c => <CountryCard key={c.id} country={c} />)}
          </div>
        </div>
      </main>

      <footer className="py-5 px-4 flex flex-wrap items-center justify-center gap-3 border-t"
        style={{ borderColor: bdr }}>
        <span className="text-[9px] font-mono uppercase tracking-[0.14em]"
          style={{ color: dark ? 'rgba(140,165,220,0.45)' : '#7a7870' }}>
          © 2026 Global Election Simulator
        </span>
      </footer>

    </div>
  );
}
