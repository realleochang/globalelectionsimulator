import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function GlobeLogo({ size = 34 }: { size?: number }) {
  // Latitude bands: [y, rx, ry, color]
  const lats: [number, number, number, string][] = [
    [7.6,  11.2, 2.8, '#12B6CF'],
    [13.2, 13.7, 3.4, '#02A95B'],
    [16.0, 14.0, 3.6, '#E4003B'],
    [18.8, 13.7, 3.4, '#FAA61A'],
    [24.4, 11.2, 2.8, '#0087DC'],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <defs>
        <clipPath id="hp-logo-clip"><circle cx="16" cy="16" r="14" /></clipPath>
        {/* Glassy specular highlight — strong top-left lobe */}
        <radialGradient id="hp-logo-shine" cx="32%" cy="24%" r="52%">
          <stop offset="0%"   stopColor="white" stopOpacity="0.80" />
          <stop offset="45%"  stopColor="white" stopOpacity="0.12" />
          <stop offset="100%" stopColor="white" stopOpacity="0"    />
        </radialGradient>
        {/* Subtle inner depth shadow bottom-right */}
        <radialGradient id="hp-logo-depth" cx="70%" cy="72%" r="55%">
          <stop offset="0%"   stopColor="rgba(20,60,120,0.18)" />
          <stop offset="100%" stopColor="rgba(20,60,120,0)"    />
        </radialGradient>
      </defs>

      {/* Faint glass tint — nearly transparent sphere body */}
      <circle cx="16" cy="16" r="14" fill="rgba(180,215,255,0.09)" clipPath="url(#hp-logo-clip)" />

      {/* ── Back face (seen through glass) ── dashed colored latitude arcs */}
      <g clipPath="url(#hp-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path
            key={`bk-${y}`}
            d={`M${16 - rx} ${y} A${rx} ${ry} 0 0 0 ${16 + rx} ${y}`}
            stroke={color} strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2"
          />
        ))}
      </g>

      {/* Back meridians — dashed, subtle blue-grey */}
      <g clipPath="url(#hp-logo-clip)" fill="none" strokeLinecap="round"
         stroke="rgba(80,140,210,0.22)" strokeWidth="0.6" strokeDasharray="2 2">
        <ellipse cx="16" cy="16" rx="8"  ry="14" />
        <ellipse cx="16" cy="16" rx="4"  ry="14" />
      </g>

      {/* ── Front face ── solid colored latitude arcs */}
      <g clipPath="url(#hp-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path
            key={`ft-${y}`}
            d={`M${16 - rx} ${y} A${rx} ${ry} 0 0 1 ${16 + rx} ${y}`}
            stroke={color} strokeWidth="1.30" strokeOpacity="0.90"
          />
        ))}
      </g>

      {/* Front meridians — solid, subtle blue-grey */}
      <g clipPath="url(#hp-logo-clip)" fill="none" stroke="rgba(80,140,210,0.32)" strokeLinecap="round">
        <line x1="16" y1="2"  x2="16" y2="30" strokeWidth="0.70" />
        <ellipse cx="16" cy="16" rx="8"  ry="14" strokeWidth="0.65" />
        <ellipse cx="16" cy="16" rx="4"  ry="14" strokeWidth="0.55" />
      </g>

      {/* Inner depth gradient */}
      <circle cx="16" cy="16" r="14" fill="url(#hp-logo-depth)" />

      {/* Specular glass highlight */}
      <circle cx="16" cy="16" r="14" fill="url(#hp-logo-shine)" />

      {/* Outer rim — glassy blue-white instead of dark */}
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(140,195,255,0.55)" strokeWidth="1.1" />
      <circle cx="16" cy="16" r="13.4" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.5" />
    </svg>
  );
}




export default function HomePage() {
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  const navigate = useNavigate();
  const [visitCount, setVisitCount] = useState<number | null>(null);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // Hit the visit counter once on mount
  useEffect(() => {
    fetch('https://api.countapi.xyz/hit/globalelectionsimulator/homepage-visits')
      .then(r => r.json())
      .then((data: { value: number }) => setVisitCount(data.value))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-canvas flex flex-col">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header
        className="h-[52px] sticky top-0 backdrop-blur-xl border-b border-default shrink-0 flex items-center px-4 gap-2.5 z-50"
        style={{ background: dark ? 'rgba(7,13,28,0.94)' : 'rgba(245,244,240,0.92)' }}
      >
        <div className="flex items-center gap-2.5">
          <GlobeLogo />
          <div className="flex flex-col justify-center leading-none">
            <span className="font-display font-black uppercase tracking-[0.04em] text-[14px] text-ink leading-none">
              Global Election Simulator
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <a
            href="https://ko-fi.com/globalelectionsimulator"
            target="_blank"
            rel="noopener noreferrer"
            className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full overflow-hidden font-mono font-black text-[8.5px] uppercase tracking-[0.18em] leading-none text-white"
            style={{ background: 'linear-gradient(90deg, #e05c00, #e8a020, #c8a020, #e05c00)', backgroundSize: '200% 100%', animation: 'donateCycle 2.8s linear infinite' }}
          >
            Donate
          </a>
          <a
            href="https://x.com/realleochang"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-default text-ink-3 hover:border-ink-3 hover:text-ink transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.18em] leading-none">@realleochang</span>
          </a>
          <button
            onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none" />
                <line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="3.6" y1="10.4" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center px-6 py-20">

        {/* Hero */}
        <div className="flex flex-col items-center mb-10">
          <GlobeLogo size={68} />
          <h1 className="mt-6 font-display text-[clamp(26px,4.5vw,52px)] font-black uppercase tracking-[0.04em] text-ink text-center leading-tight">
            Global Election Simulator
          </h1>
          <p className="mt-4 text-[13px] font-mono uppercase tracking-[0.20em] text-ink-2 text-center">
            The <span className="font-black text-ink">ORIGINAL</span> Global Election Simulator
          </p>
          <p className="mt-2 text-[11px] font-mono text-ink-3 tracking-[0.15em] text-center">By the Community, For the Community</p>
          <div className="mt-5 h-px w-16 bg-gold/50" />

          {/* Partnership strip */}
          <div className="mt-6 flex flex-col items-stretch gap-2 w-fit mx-auto">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.22em] text-ink-3 text-center">Partnership</span>
            <a
              href="https://poliwave.com"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border border-default hover:border-ink-3 transition-colors bg-white p-4 flex justify-center"
              title="Poliwave"
            >
              <img
                src={`${import.meta.env.BASE_URL}poliwave.svg`}
                alt="Poliwave"
                className="h-12 w-auto block"
                style={{ imageRendering: 'crisp-edges' }}
              />
            </a>
          </div>

          {/* Supporters strip */}
          <div className="mt-5 flex flex-col items-center gap-3 w-fit mx-auto">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.22em] text-ink-3 text-center">Supporters</span>
            <a
              href="https://x.com/comfoofifoo"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-default hover:border-ink-3 bg-white transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"
            >
              <div className="w-7 h-7 rounded-full bg-ink flex items-center justify-center shrink-0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </div>
              <span className="text-[11px] font-mono font-semibold text-ink group-hover:text-gold transition-colors">@comfoofifoo</span>
            </a>
          </div>

        </div>

        {/* Country grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full max-w-4xl">

          {/* UK */}
          <button
            onClick={() => navigate('/uk')}
            className="country-card group relative rounded-xl overflow-hidden border border-default bg-white text-left transition-all duration-200 hover:-translate-y-1"
          >
            <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1' }}>
              <img src={`${import.meta.env.BASE_URL}uk-flag.webp`} alt="UK flag" className="w-full h-full object-cover block" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
              <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/20">
                <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="text-[7.5px] font-mono font-bold uppercase tracking-wider text-white/90 leading-none">Live</span>
              </div>
            </div>
            <div className="p-4 pb-3">
              <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">United Kingdom</div>
              <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">General Election</div>
              <div className="mt-2 text-[8.5px] font-mono text-ink-3">House of Commons</div>
              <PartyDots parties={[
                { color: '#02A95B', abbr: 'GRN' },
                { color: '#E4003B', abbr: 'LAB' },
                { color: '#FAA61A', abbr: 'LD'  },
                { color: '#0087DC', abbr: 'CON' },
                { color: '#12B6CF', abbr: 'RFM' },
                { color: '#002366', abbr: 'RES' },
              ]} />
            </div>
            <div className="px-4 pb-4 flex items-center gap-2">
              <div className="flex-1 h-px bg-black/8" />
              <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-gold group-hover:text-gold-deep transition-colors">
                Open Simulator
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M2.5 5.5h6M5.5 3L8 5.5 5.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <div
              className="absolute bottom-0 left-0 right-0 h-[2.5px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{ background: 'linear-gradient(90deg, #012169 0%, #C8102E 50%, #012169 100%)' }}
            />
          </button>

          <FranceCard />
          <CanadaCard />
          <USACard />
          <AustraliaCard />

          <GermanyCard />

          <ReleaseImminentCard
            country="Brazil" election="Presidential Election" institution="Palácio do Planalto"
            flagSrc={`${import.meta.env.BASE_URL}brazil-flag.png`}
            accentGradient="linear-gradient(90deg, #009C3B 0%, #FFDF00 50%, #002776 100%)"
            parties={[{ color: '#C0112A', abbr: 'PT' }, { color: '#002F87', abbr: 'PL' }]}
          />
          <ReleaseImminentCard
            country="South Korea" election="Presidential Election" institution="Cheong Wa Dae"
            flagSrc={`${import.meta.env.BASE_URL}south-korea-flag.png`}
            accentGradient="linear-gradient(90deg, #C60C30 0%, #FFFFFF 50%, #003087 100%)"
            parties={[{ color: '#004EA2', abbr: 'DP' }, { color: '#C9151E', abbr: 'PPP' }]}
          />

          <ComingSoonCard country="Netherlands" election="General Election" institution="Tweede Kamer"
            flagSrc={`${import.meta.env.BASE_URL}netherlands-flag.png`}
            bgGradient="linear-gradient(to bottom, #AE1C28 33%, #FFFFFF 33%, #FFFFFF 67%, #21468B 67%)"
            accentGradient="linear-gradient(90deg, #AE1C28 0%, #FFFFFF 50%, #21468B 100%)"
            parties={[{ color: '#003366', abbr: 'PVV' }, { color: '#00A650', abbr: 'GL' }, { color: '#CC0000', abbr: 'PvdA' }, { color: '#005B8E', abbr: 'VVD' }, { color: '#CC0000', abbr: 'SP' }]}
          />
          <ComingSoonCard country="Romania" election="Presidential Election" institution="Cotroceni Palace"
            flagSrc={`${import.meta.env.BASE_URL}romania-flag.png`}
            bgGradient="linear-gradient(to right, #002B7F 33%, #FCD116 33%, #FCD116 67%, #CE1126 67%)"
            accentGradient="linear-gradient(90deg, #002B7F 0%, #FCD116 50%, #CE1126 100%)"
            parties={[{ color: '#B8860B', abbr: 'AUR' }, { color: '#CE0002', abbr: 'PSD' }, { color: '#FFCC00', abbr: 'PNL' }, { color: '#162A56', abbr: 'USR' }]}
          />
          <ComingSoonCard country="Italy" election="General Election" institution="Camera dei Deputati"
            flagSrc={`${import.meta.env.BASE_URL}italy-flag.png`}
            bgGradient="linear-gradient(to right, #009246 33%, #FFFFFF 33%, #FFFFFF 67%, #CE2B37 67%)"
            accentGradient="linear-gradient(90deg, #009246 0%, #FFFFFF 50%, #CE2B37 100%)"
            parties={[{ color: '#1A3A6B', abbr: 'FdI' }, { color: '#009934', abbr: 'LEG' }, { color: '#0047A0', abbr: 'FI' }, { color: '#E2001A', abbr: 'PD' }, { color: '#F0CD00', abbr: 'M5S' }]}
          />
          <ComingSoonCard country="Austria" election="Parliamentary Election" institution="Nationalrat"
            flagSrc={`${import.meta.env.BASE_URL}austria-flag.png`}
            bgGradient="linear-gradient(to bottom, #ED2939 33%, #FFFFFF 33%, #FFFFFF 67%, #ED2939 67%)"
            accentGradient="linear-gradient(90deg, #ED2939 0%, #FFFFFF 50%, #ED2939 100%)"
            parties={[{ color: '#005299', abbr: 'FPÖ' }, { color: '#111111', abbr: 'ÖVP' }, { color: '#DD0000', abbr: 'SPÖ' }, { color: '#88B538', abbr: 'GRÜ' }, { color: '#E84188', abbr: 'NEO' }]}
          />
          <ComingSoonCard country="Poland" election="Parliamentary Election" institution="Sejm"
            flagSrc={`${import.meta.env.BASE_URL}poland-flag.png`}
            bgGradient="linear-gradient(to bottom, #FFFFFF 50%, #DC143C 50%)"
            accentGradient="linear-gradient(90deg, #FFFFFF 0%, #DC143C 100%)"
            parties={[{ color: '#FF7A00', abbr: 'KO' }, { color: '#1A3D7C', abbr: 'PiS' }, { color: '#008000', abbr: 'TD' }, { color: '#2C2C2C', abbr: 'KON' }, { color: '#CC0033', abbr: 'LEW' }]}
          />
          <ComingSoonCard country="Sweden" election="General Election" institution="Riksdag"
            flagSrc={`${import.meta.env.BASE_URL}sweden-flag.png`}
            bgGradient="linear-gradient(to right, #006AA7 35%, #FECC00 35%, #FECC00 47%, #006AA7 47%)"
            accentGradient="linear-gradient(90deg, #006AA7 0%, #FECC00 50%, #006AA7 100%)"
            parties={[{ color: '#E8112D', abbr: 'S' }, { color: '#1B6EC4', abbr: 'M' }, { color: '#0052A5', abbr: 'SD' }, { color: '#009A44', abbr: 'C' }, { color: '#DA291C', abbr: 'V' }, { color: '#231F7A', abbr: 'KD' }]}
          />
          <ComingSoonCard country="Denmark" election="General Election" institution="Folketing"
            flagSrc={`${import.meta.env.BASE_URL}denmark-flag.png`}
            bgGradient="linear-gradient(to right, #C60C30 35%, #FFFFFF 35%, #FFFFFF 45%, #C60C30 45%)"
            accentGradient="linear-gradient(90deg, #C60C30 0%, #FFFFFF 50%, #C60C30 100%)"
            parties={[{ color: '#D90B0B', abbr: 'A' }, { color: '#0066CC', abbr: 'V' }, { color: '#F4A800', abbr: 'DF' }, { color: '#E00048', abbr: 'SF' }, { color: '#7A3B8D', abbr: 'M' }, { color: '#DD0000', abbr: 'EL' }]}
          />
          <ComingSoonCard country="Switzerland" election="Federal Election" institution="Nationalrat"
            flagSrc={`${import.meta.env.BASE_URL}switzerland-flag.png`}
            bgGradient="linear-gradient(to right, #FF0000, #CC0000)"
            accentGradient="linear-gradient(90deg, #FF0000 0%, #FFFFFF 50%, #FF0000 100%)"
            parties={[{ color: '#009835', abbr: 'SVP' }, { color: '#F0554D', abbr: 'SP' }, { color: '#3871C1', abbr: 'FDP' }, { color: '#84B135', abbr: 'GPS' }, { color: '#FF8000', abbr: 'MDT' }]}
          />

          <ComingSoonCard country="Peru" election="Presidential Election" institution="Palacio de Gobierno"
            flagSrc={`${import.meta.env.BASE_URL}peru-flag.png`}
            bgGradient="linear-gradient(to right, #D91023 33%, #FFFFFF 33%, #FFFFFF 67%, #D91023 67%)"
            accentGradient="linear-gradient(90deg, #D91023 0%, #FFFFFF 50%, #D91023 100%)"
            parties={[{ color: '#CC0000', abbr: 'AP' }, { color: '#FF8200', abbr: 'FP' }, { color: '#0A3081', abbr: 'PAP' }, { color: '#228B22', abbr: 'AVP' }]}
          />

          <ComingSoonCard country="South Africa" election="General Election" institution="National Assembly"
            flagSrc={`${import.meta.env.BASE_URL}south-africa-flag.png`}
            bgGradient="linear-gradient(to right, #007A4D 0%, #007A4D 30%, #FFB612 30%, #FFB612 55%, #DE3831 55%)"
            accentGradient="linear-gradient(90deg, #007A4D 0%, #FFB612 50%, #DE3831 100%)"
            parties={[{ color: '#006400', abbr: 'ANC' }, { color: '#0099CC', abbr: 'DA' }, { color: '#111111', abbr: 'MK' }, { color: '#CC0000', abbr: 'EFF' }, { color: '#FFCC00', abbr: 'IFP' }]}
          />

          <ComingSoonCard country="Taiwan" election="Presidential Election" institution="Executive Yuan"
            flagSrc={`${import.meta.env.BASE_URL}taiwan-flag.png`}
            bgGradient="linear-gradient(to right, #003893 40%, #FE0000 40%)"
            accentGradient="linear-gradient(90deg, #003893 0%, #FFFFFF 50%, #FE0000 100%)"
            parties={[{ color: '#1B9431', abbr: 'DPP' }, { color: '#9F1B20', abbr: 'KMT' }, { color: '#28C8C8', abbr: 'TPP' }]}
          />
          <ComingSoonCard country="Israel" election="Legislative Election" institution="Knesset"
            flagSrc={`${import.meta.env.BASE_URL}israel-flag.png`}
            bgGradient="linear-gradient(to bottom, #0038b8 18%, #FFFFFF 18%, #FFFFFF 38%, #0038b8 38%, #0038b8 62%, #FFFFFF 62%, #FFFFFF 82%, #0038b8 82%)"
            accentGradient="linear-gradient(90deg, #0038b8 0%, #FFFFFF 50%, #0038b8 100%)"
            parties={[{ color: '#3A75C4', abbr: 'LKD' }, { color: '#0F81C5', abbr: 'YA' }, { color: '#FF6600', abbr: 'NRP' }, { color: '#E82031', abbr: 'LAB' }, { color: '#292929', abbr: 'OTZ' }]}
          />
          <ComingSoonCard country="India" election="General Election" institution="Lok Sabha"
            flagSrc={`${import.meta.env.BASE_URL}india-flag.png`}
            bgGradient="linear-gradient(to bottom, #FF9933 33%, #FFFFFF 33%, #FFFFFF 67%, #138808 67%)"
            accentGradient="linear-gradient(90deg, #FF9933 0%, #FFFFFF 50%, #138808 100%)"
            parties={[{ color: '#FF6600', abbr: 'BJP' }, { color: '#19AAED', abbr: 'INC' }, { color: '#FF0000', abbr: 'SP' }, { color: '#27AE60', abbr: 'TMC' }, { color: '#0099CC', abbr: 'AAP' }]}
          />
          <ComingSoonCard country="Philippines" election="Presidential Election" institution="Malacañang"
            flagSrc={`${import.meta.env.BASE_URL}philippines-flag.png`}
            bgGradient="linear-gradient(to bottom, #0038A8 50%, #CE1126 50%)"
            accentGradient="linear-gradient(90deg, #0038A8 0%, #FFFFFF 50%, #CE1126 100%)"
            parties={[{ color: '#0038A8', abbr: 'PFP' }, { color: '#CE1126', abbr: 'PMP' }, { color: '#FFCC00', abbr: 'LP' }, { color: '#228B22', abbr: 'NUP' }]}
          />
          <ComingSoonCard country="Japan" election="General Election" institution="National Diet"
            flagSrc={`${import.meta.env.BASE_URL}japan-flag.png`}
            bgGradient="linear-gradient(to right, #FFFFFF, #BC002D)"
            accentGradient="linear-gradient(90deg, #FFFFFF 0%, #BC002D 100%)"
            parties={[{ color: '#009933', abbr: 'LDP' }, { color: '#0066CC', abbr: 'CDP' }, { color: '#FF8200', abbr: 'KOM' }, { color: '#1E90FF', abbr: 'DPF' }, { color: '#28B463', abbr: 'ISH' }]}
          />

          <ComingSoonCard country="New Zealand" election="General Election" institution="Parliament"
            flagSrc={`${import.meta.env.BASE_URL}new-zealand-flag.png`}
            bgGradient="linear-gradient(to right, #00247D, #CC142B)"
            accentGradient="linear-gradient(90deg, #00247D 0%, #FFFFFF 50%, #CC142B 100%)"
            parties={[{ color: '#CC0000', abbr: 'LAB' }, { color: '#003399', abbr: 'NAT' }, { color: '#FFCC00', abbr: 'ACT' }, { color: '#2EB82E', abbr: 'GRN' }, { color: '#111111', abbr: 'NZF' }]}
          />

        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="py-5 px-4 flex flex-wrap items-center justify-center gap-3 border-t border-default">
        <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-ink-3">© 2026 Global Election Simulator</span>
        {visitCount !== null && (
          <>
            <span className="text-ink-3 opacity-30 text-[9px]">·</span>
            <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.14em] text-ink-3">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 14s-6-3.9-6-8a4 4 0 0 1 8 0 4 4 0 0 1 8 0c0 4.1-6 8-6 8z" fill="currentColor" fillOpacity="0.5"/>
              </svg>
              {visitCount.toLocaleString()} visits
            </span>
          </>
        )}
      </footer>

    </div>
  );
}



// ── Non-clickable preview card (flag + parties, not yet openable) ─────────────
function USACard() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/usa')}
      className="country-card group relative rounded-xl overflow-hidden border border-default bg-white text-left transition-all duration-200 hover:-translate-y-1"
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1' }}>
        <img src={`${import.meta.env.BASE_URL}usa-flag.png`} alt="US flag" className="absolute inset-0 w-full h-full object-cover block" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/20">
          <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-[7.5px] font-mono font-bold uppercase tracking-wider text-white/90 leading-none">Live</span>
        </div>
      </div>
      <div className="p-4 pb-3">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">United States</div>
        <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">Presidential Election</div>
        <div className="mt-2 text-[8.5px] font-mono text-ink-3">White House</div>
        <PartyDots parties={[
          { color: '#232066', abbr: 'DEM' },
          { color: '#BF0A30', abbr: 'GOP' },
        ]} />
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-black/8" />
        <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-gold group-hover:text-gold-deep transition-colors">
          Open Simulator
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M2.5 5.5h6M5.5 3L8 5.5 5.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-[2.5px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: 'linear-gradient(90deg, #BF0A30 0%, #FFFFFF 50%, #232066 100%)' }}
      />
    </button>
  );
}

function CanadaCard() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/canada')}
      className="country-card group relative rounded-xl overflow-hidden border border-default bg-white text-left transition-all duration-200 hover:-translate-y-1"
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1' }}>
        <img src={`${import.meta.env.BASE_URL}canada-flag.png`} alt="Canada flag" className="absolute inset-0 w-full h-full object-cover block" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/20">
          <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-[7.5px] font-mono font-bold uppercase tracking-wider text-white/90 leading-none">Live</span>
        </div>
      </div>
      <div className="p-4 pb-3">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">Canada</div>
        <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">Federal Election</div>
        <div className="mt-2 text-[8.5px] font-mono text-ink-3">House of Commons</div>
        <PartyDots parties={[
          { color: '#F58220', abbr: 'NDP' },
          { color: '#3D9B35', abbr: 'GRN' },
          { color: '#33B2CC', abbr: 'BQ'  },
          { color: '#D71920', abbr: 'LIB' },
          { color: '#1A4782', abbr: 'CON' },
          { color: '#4E2E84', abbr: 'PPC' },
        ]} />
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-black/8" />
        <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-gold group-hover:text-gold-deep transition-colors">
          Open Simulator
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M2.5 5.5h6M5.5 3L8 5.5 5.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-[2.5px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: 'linear-gradient(90deg, #FF0000 0%, white 50%, #FF0000 100%)' }}
      />
    </button>
  );
}





function ReleaseImminentCard({ country, election, institution, flagSrc, accentGradient, parties }: {
  country: string;
  election: string;
  institution: string;
  flagSrc: string;
  accentGradient: string;
  parties: { color: string; abbr: string }[];
}) {
  return (
    <div className="country-card relative rounded-xl overflow-hidden border border-default bg-white text-left select-none cursor-not-allowed">
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1' }}>
        <img src={flagSrc} alt={`${country} flag`} className="absolute inset-0 w-full h-full object-cover block" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/20">
          <span className="w-[5px] h-[5px] rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="text-[7.5px] font-mono font-bold uppercase tracking-wider text-white/90 leading-none">Release Imminent</span>
        </div>
      </div>
      <div className="p-4 pb-3">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">{country}</div>
        <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">{election}</div>
        <div className="mt-2 text-[8.5px] font-mono text-ink-3">{institution}</div>
        <PartyDots parties={parties} />
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-black/8" />
        <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-amber-500">
          <span className="w-[5px] h-[5px] rounded-full bg-amber-400 shrink-0" />
          Release Imminent
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2.5px]" style={{ background: accentGradient }} />
    </div>
  );
}

function GermanyCard() {
  return (
    <div className="country-card relative rounded-xl overflow-hidden border border-default bg-white text-left select-none cursor-not-allowed">
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1' }}>
        <img src={`${import.meta.env.BASE_URL}germany-flag.png`} alt="Germany flag" className="absolute inset-0 w-full h-full object-cover block" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/20">
          <span className="w-[5px] h-[5px] rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="text-[7.5px] font-mono font-bold uppercase tracking-wider text-white/90 leading-none">Release Imminent</span>
        </div>
      </div>
      <div className="p-4 pb-3">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">Germany</div>
        <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">Federal Election</div>
        <div className="mt-2 text-[8.5px] font-mono text-ink-3">Bundestag</div>
        <PartyDots parties={[
          { color: '#BE3075', abbr: 'LNK' },
          { color: '#E3000F', abbr: 'SPD' },
          { color: '#1AA037', abbr: 'GRÜ' },
          { color: '#151518', abbr: 'CDU' },
          { color: '#0066B3', abbr: 'CSU' },
          { color: '#009EE0', abbr: 'AfD' },
        ]} />
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-black/8" />
        <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-amber-500">
          <span className="w-[5px] h-[5px] rounded-full bg-amber-400 shrink-0" />
          Release Imminent
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2.5px]" style={{ background: 'linear-gradient(90deg, #000000 0%, #DD0000 50%, #FFCE00 100%)' }} />
    </div>
  );
}


function AustraliaCard() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/australia')}
      className="country-card group relative rounded-xl overflow-hidden border border-default bg-white text-left transition-all duration-200 hover:-translate-y-1"
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1' }}>
        <img src={`${import.meta.env.BASE_URL}australia-flag.png`} alt="Australia flag" className="absolute inset-0 w-full h-full object-cover block" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/20">
          <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-[7.5px] font-mono font-bold uppercase tracking-wider text-white/90 leading-none">Live</span>
        </div>
      </div>
      <div className="p-4 pb-3">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">Australia</div>
        <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">Federal Election</div>
        <div className="mt-2 text-[8.5px] font-mono text-ink-3">House of Representatives</div>
        <PartyDots parties={[
          { color: '#009E55', abbr: 'GRN' },
          { color: '#E21B23', abbr: 'ALP' },
          { color: '#1C4F9C', abbr: 'LIB' },
          { color: '#006748', abbr: 'NAT' },
          { color: '#FF5700', abbr: 'ONP' },
        ]} />
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-black/8" />
        <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-gold group-hover:text-gold-deep transition-colors">
          Open Simulator
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M2.5 5.5h6M5.5 3L8 5.5 5.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-[2.5px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: 'linear-gradient(90deg, #003893 0%, #FFFFFF 50%, #003893 100%)' }}
      />
    </button>
  );
}



function FranceCard() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/france')}
      className="country-card group relative rounded-xl overflow-hidden border border-default bg-white text-left transition-all duration-200 hover:-translate-y-1"
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1' }}>
        <img src={`${import.meta.env.BASE_URL}france-flag.png`} alt="French flag" className="absolute inset-0 w-full h-full object-cover block" style={{ filter: 'brightness(1.15) saturate(0.85)', objectPosition: '50% 0%', transform: 'scale(1.04)', transformOrigin: 'center top' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/20">
          <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-[7.5px] font-mono font-bold uppercase tracking-wider text-white/90 leading-none">Live</span>
        </div>
      </div>
      <div className="p-4 pb-3">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">France</div>
        <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">Presidential Election</div>
        <div className="mt-2 text-[8.5px] font-mono text-ink-3">Élysée Palace</div>
        <PartyDots parties={[
          { color: '#CE1126', abbr: 'PCF' },
          { color: '#CC2443', abbr: 'LFI' },
          { color: '#E75480', abbr: 'PS'  },
          { color: '#FFD800', abbr: 'PP'  },
          { color: '#37A349', abbr: 'LÉ'  },
          { color: '#FF7900', abbr: 'RE'  },
          { color: '#00A6D6', abbr: 'HOR' },
          { color: '#0066CC', abbr: 'LR'  },
          { color: '#003189', abbr: 'RN'  },
        ]} />
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-black/8" />
        <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-gold group-hover:text-gold-deep transition-colors">
          Open Simulator
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M2.5 5.5h6M5.5 3L8 5.5 5.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-[2.5px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: 'linear-gradient(90deg, #002395 0%, #FFFFFF 50%, #ED2939 100%)' }}
      />
    </button>
  );
}

function PartyDots({ parties, className = 'mt-3' }: { parties: { color: string; abbr: string }[]; className?: string }) {
  return (
    <div className={`flex items-center ${className}`}>
      {parties.map((p, i) => (
        <div
          key={p.abbr}
          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${i > 0 ? '-ml-1' : ''}`}
          style={{ background: p.color }}
        >
          <span className="text-[5.5px] font-mono font-black text-white leading-none select-none tracking-tight">{p.abbr}</span>
        </div>
      ))}
    </div>
  );
}

function ComingSoonCard({ country, election, institution, flagSrc, bgGradient, accentGradient, parties }: {
  country: string;
  election: string;
  institution: string;
  flagSrc?: string;
  bgGradient: string;
  accentGradient: string;
  parties: { color: string; abbr: string }[];
}) {
  return (
    <div className="country-card relative rounded-xl overflow-hidden border border-default bg-white text-left select-none cursor-default opacity-50">
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '2/1', background: flagSrc ? undefined : bgGradient }}>
        {flagSrc && <img src={flagSrc} alt={`${country} flag`} className="absolute inset-0 w-full h-full object-cover block" />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.22))' }} />
      </div>
      <div className="p-4 pb-3">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-ink-3 mb-1.5">{country}</div>
        <div className="font-display text-[15px] font-black uppercase tracking-normal text-ink leading-tight">{election}</div>
        <div className="mt-2 text-[8.5px] font-mono text-ink-3">{institution}</div>
        <PartyDots parties={parties} />
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-black/8" />
        <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 opacity-50">
          <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true">
            <rect x="1" y="4.5" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
          </svg>
          Coming Soon
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2.5px]" style={{ background: accentGradient }} />
    </div>
  );
}

