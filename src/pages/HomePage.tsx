import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

// ── Country data ──────────────────────────────────────────────────────────────
export const COUNTRIES = [
  {
    id: 'uk', path: '/uk', name: 'United Kingdom', flag: '🇬🇧', demonym: 'British', mapColor: '#C8102E',
    flagSrc: 'uk-flag.webp', flagStyle: {} as React.CSSProperties,
    electionType: 'General Election', subtitle: 'House of Commons',
    lat: 54, lng: -2,
    accent: 'linear-gradient(90deg,#012169,#C8102E,#012169)',
    parties: [
      { color: '#02A95B', abbr: 'GRN' }, { color: '#E4003B', abbr: 'LAB' },
      { color: '#FAA61A', abbr: 'LD'  }, { color: '#0087DC', abbr: 'CON' },
      { color: '#12B6CF', abbr: 'RFM' }, { color: '#002366', abbr: 'RES' },
    ],
  },
  {
    id: 'france', path: '/france', name: 'France', flag: '🇫🇷', demonym: 'French', mapColor: '#002395',
    flagSrc: 'france-flag.png',
    flagStyle: { filter: 'brightness(1.12) saturate(0.88)', objectPosition: '50% 0%', transform: 'scale(1.04)', transformOrigin: 'center top' } as React.CSSProperties,
    electionType: 'Presidential Election', subtitle: 'Élysée Palace',
    lat: 46, lng: 2,
    accent: 'linear-gradient(90deg,#002395,white,#ED2939)',
    parties: [
      { color: '#CE1126', abbr: 'PCF' }, { color: '#CC2443', abbr: 'LFI' },
      { color: '#E75480', abbr: 'PS'  }, { color: '#FFD800', abbr: 'PP'  },
      { color: '#FF7900', abbr: 'RE'  }, { color: '#0066CC', abbr: 'LR'  },
      { color: '#003189', abbr: 'RN'  },
    ],
  },
  {
    id: 'canada', path: '/canada', name: 'Canada', flag: '🇨🇦', demonym: 'Canadian', mapColor: '#D52B1E',
    flagSrc: 'canada-flag.png', flagStyle: {} as React.CSSProperties,
    electionType: 'Federal Election', subtitle: 'House of Commons',
    lat: 60, lng: -96,
    accent: 'linear-gradient(90deg,#FF0000,white,#FF0000)',
    parties: [
      { color: '#F58220', abbr: 'NDP' }, { color: '#3D9B35', abbr: 'GRN' },
      { color: '#33B2CC', abbr: 'BQ'  }, { color: '#D71920', abbr: 'LIB' },
      { color: '#1A4782', abbr: 'CON' }, { color: '#4E2E84', abbr: 'PPC' },
    ],
  },
  {
    id: 'usa', path: '/usa', name: 'United States', flag: '🇺🇸', demonym: 'American', mapColor: '#002868',
    flagSrc: 'usa-flag.png', flagStyle: { objectPosition: '0% 50%' } as React.CSSProperties,
    electionType: 'Presidential Election', subtitle: 'White House',
    lat: 38, lng: -100,
    accent: 'linear-gradient(90deg,#BF0A30,white,#232066)',
    parties: [
      { color: '#232066', abbr: 'DEM' }, { color: '#BF0A30', abbr: 'GOP' },
    ],
  },
  {
    id: 'australia', path: '/australia', name: 'Australia', flag: '🇦🇺', demonym: 'Australian', mapColor: '#003893',
    flagSrc: 'australia-flag.png', flagStyle: {} as React.CSSProperties,
    electionType: 'Federal Election', subtitle: 'House of Representatives',
    lat: -25, lng: 134,
    accent: 'linear-gradient(90deg,#003893,white,#003893)',
    parties: [
      { color: '#009E55', abbr: 'GRN' }, { color: '#E21B23', abbr: 'ALP' },
      { color: '#1C4F9C', abbr: 'LIB' }, { color: '#006748', abbr: 'NAT' },
      { color: '#FF5700', abbr: 'ONP' },
    ],
  },
  {
    id: 'germany', path: '/germany', name: 'Germany', flag: '🇩🇪', demonym: 'German', mapColor: '#FFCE00',
    flagSrc: 'germany-flag.png', flagStyle: {} as React.CSSProperties,
    electionType: 'Federal Election', subtitle: 'Bundestag',
    lat: 51, lng: 10,
    accent: 'linear-gradient(90deg,#000,#DD0000,#FFCE00)',
    parties: [
      { color: '#BE3075', abbr: 'LNK' }, { color: '#E3000F', abbr: 'SPD' },
      { color: '#1AA037', abbr: 'GRÜ' }, { color: '#151518', abbr: 'CDU' },
      { color: '#009EE0', abbr: 'AfD' },
    ],
  },
  {
    id: 'brazil', path: '/brazil', name: 'Brazil', flag: '🇧🇷', demonym: 'Brazilian', mapColor: '#009C3B',
    flagSrc: 'brazil-flag.png',
    flagStyle: { filter: 'brightness(1.06) saturate(0.92)', objectPosition: '50% 40%' } as React.CSSProperties,
    electionType: 'Presidential Election', subtitle: 'Palácio do Planalto',
    lat: -10, lng: -55,
    accent: 'linear-gradient(90deg,#009C3B,#FFDF00,#009C3B)',
    parties: [
      { color: '#D40000', abbr: 'PT' }, { color: '#003087', abbr: 'PL' },
    ],
  },
  {
    id: 'netherlands', path: '/netherlands', name: 'Netherlands', flag: '🇳🇱', demonym: 'Dutch', mapColor: '#E17000',
    flagSrc: 'netherlands-flag.png', flagStyle: {} as React.CSSProperties,
    electionType: 'General Election', subtitle: 'Tweede Kamer',
    lat: 52, lng: 5,
    accent: 'linear-gradient(90deg,#AE1C28,white,#21468B)',
    parties: [
      { color: '#CC0000', abbr: 'PvdA' }, { color: '#009E60', abbr: 'D66'  },
      { color: '#007B5F', abbr: 'CDA'  }, { color: '#0065AB', abbr: 'VVD'  },
      { color: '#1B3C78', abbr: 'JA21' }, { color: '#821622', abbr: 'FvD'  },
      { color: '#003082', abbr: 'PVV'  },
    ],
  },
  {
    id: 'romania', path: '/romania', name: 'Romania', flag: '🇷🇴', demonym: 'Romanian', mapColor: '#FCD116',
    flagSrc: 'romania-flag.png', flagStyle: {} as React.CSSProperties,
    electionType: 'Legislative Election', subtitle: 'Camera Deputaților',
    lat: 45, lng: 25,
    accent: 'linear-gradient(90deg,#002B7F,#FCD116,#CE1126)',
    parties: [
      { color: '#CC0000', abbr: 'PSD'  }, { color: '#003DA5', abbr: 'USR'  },
      { color: '#F9A800', abbr: 'PNL'  }, { color: '#C8960C', abbr: 'AUR'  },
    ],
  },
  {
    id: 'south-africa', path: '/south-africa', name: 'South Africa', flag: '🇿🇦', demonym: 'South African', mapColor: '#FFB612',
    flagSrc: 'south-africa-flag.png', flagStyle: {} as React.CSSProperties,
    electionType: 'General Election', subtitle: 'National Assembly',
    lat: -29, lng: 25,
    accent: 'linear-gradient(90deg,#007A4D,#FFB612,#003DA5)',
    parties: [
      { color: '#E53935', abbr: 'EFF' }, { color: '#1B5E20', abbr: 'MK'  },
      { color: '#007A4D', abbr: 'ANC' }, { color: '#1565C0', abbr: 'DA'  },
    ],
  },
  {
    id: 'sweden', path: '/sweden', name: 'Sweden', flag: '🇸🇪', demonym: 'Swedish', mapColor: '#006AA7',
    flagSrc: 'sweden-flag.png', flagStyle: {} as React.CSSProperties,
    electionType: 'General Election', subtitle: 'Riksdag',
    lat: 62, lng: 17,
    accent: 'linear-gradient(90deg,#006AA7,#FECC02,#006AA7)',
    parties: [
      { color: '#C8101E', abbr: 'V'  }, { color: '#ED1B34', abbr: 'S'  },
      { color: '#009A44', abbr: 'C'  }, { color: '#1B4F8A', abbr: 'M'  },
      { color: '#EDB820', abbr: 'SD' },
    ],
  },
];

export type Country = typeof COUNTRIES[0];

const ISO_TO_COLOR: Record<string, string> = {
  'GB': '#C8102E', 'FR': '#002395', 'CA': '#D52B1E', 'US': '#002868',
  'AU': '#003893', 'DE': '#FFCE00', 'BR': '#009C3B', 'NL': '#E17000',
  'ZA': '#FFB612', 'RO': '#FCD116', 'SE': '#006AA7',
};

const ISO_TO_COUNTRY: Record<string, string> = {
  'GB': 'uk', 'FR': 'france', 'CA': 'canada', 'US': 'usa',
  'AU': 'australia', 'DE': 'germany', 'BR': 'brazil', 'NL': 'netherlands',
  'ZA': 'south-africa', 'RO': 'romania', 'SE': 'sweden',
};

// ISO 3166-1 numeric → ISO A2 (for 110m topojson feature IDs)
const NUMERIC_TO_ISO: Record<string, string> = {
  '826': 'GB', '250': 'FR', '124': 'CA', '840': 'US',
  '036': 'AU', '276': 'DE', '076': 'BR', '528': 'NL',
  '710': 'ZA', '642': 'RO', '752': 'SE',
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Shared components ─────────────────────────────────────────────────────────
export function GlobeLogo({ size = 34 }: { size?: number }) {
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
        <radialGradient id="hp-logo-shine" cx="32%" cy="24%" r="52%">
          <stop offset="0%"   stopColor="white" stopOpacity="0.80" />
          <stop offset="45%"  stopColor="white" stopOpacity="0.12" />
          <stop offset="100%" stopColor="white" stopOpacity="0"    />
        </radialGradient>
        <radialGradient id="hp-logo-depth" cx="70%" cy="72%" r="55%">
          <stop offset="0%"   stopColor="rgba(20,60,120,0.18)" />
          <stop offset="100%" stopColor="rgba(20,60,120,0)"    />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="rgba(180,215,255,0.09)" clipPath="url(#hp-logo-clip)" />
      <g clipPath="url(#hp-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`bk-${y}`} d={`M${16-rx} ${y} A${rx} ${ry} 0 0 0 ${16+rx} ${y}`}
            stroke={color} strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
        ))}
      </g>
      <g clipPath="url(#hp-logo-clip)" fill="none" strokeLinecap="round"
         stroke="rgba(80,140,210,0.22)" strokeWidth="0.6" strokeDasharray="2 2">
        <ellipse cx="16" cy="16" rx="8" ry="14" />
        <ellipse cx="16" cy="16" rx="4" ry="14" />
      </g>
      <g clipPath="url(#hp-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`ft-${y}`} d={`M${16-rx} ${y} A${rx} ${ry} 0 0 1 ${16+rx} ${y}`}
            stroke={color} strokeWidth="1.30" strokeOpacity="0.90" />
        ))}
      </g>
      <g clipPath="url(#hp-logo-clip)" fill="none" stroke="rgba(80,140,210,0.32)" strokeLinecap="round">
        <line x1="16" y1="2" x2="16" y2="30" strokeWidth="0.70" />
        <ellipse cx="16" cy="16" rx="8" ry="14" strokeWidth="0.65" />
        <ellipse cx="16" cy="16" rx="4" ry="14" strokeWidth="0.55" />
      </g>
      <circle cx="16" cy="16" r="14" fill="url(#hp-logo-depth)" />
      <circle cx="16" cy="16" r="14" fill="url(#hp-logo-shine)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(140,195,255,0.55)" strokeWidth="1.1" />
      <circle cx="16" cy="16" r="13.4" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.5" />
    </svg>
  );
}

export function PartyDots({ parties }: { parties: { color: string; abbr: string }[] }) {
  const compact = parties.length > 8;
  return (
    <div className="flex items-center mt-3 overflow-hidden">
      {parties.map((p, i) => (
        <div key={p.abbr}
          className={`${compact ? 'w-3.5 h-3.5' : 'w-6 h-6'} rounded-full flex items-center justify-center shrink-0 ${i > 0 ? (compact ? '-ml-px' : '-ml-1') : ''}`}
          style={{ background: p.color, boxShadow: '0 1px 3px rgba(0,0,0,0.22)' }}>
          {!compact && <span className="text-[5px] font-mono font-black text-white leading-none select-none tracking-tight">{p.abbr}</span>}
        </div>
      ))}
    </div>
  );
}

// ── 2D World Map ──────────────────────────────────────────────────────────────
function WorldMapSection({ dark, geoData }: { dark: boolean; geoData: GeoJSON.FeatureCollection | null }) {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Prevent page from scrolling while cursor is over the map (non-passive)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const geoStyle = useCallback((feat?: GeoJSON.Feature): L.PathOptions => {
    const iso = (feat?.properties?.ISO_A2_EH ?? '') as string;
    if (iso in ISO_TO_COUNTRY) {
      const color = ISO_TO_COLOR[iso] ?? '#888888';
      return { fillColor: color, fillOpacity: 0.32, color, weight: 0.25, smoothFactor: 0, interactive: true } as unknown as L.PathOptions;
    }
    return { fillColor: 'transparent', fillOpacity: 0, color: 'transparent', weight: 0, smoothFactor: 0, interactive: false } as unknown as L.PathOptions;
  }, []);

  const onEachFeature = useCallback((feat: GeoJSON.Feature, layer: L.Layer) => {
    const countryId = ISO_TO_COUNTRY[(feat.properties?.ISO_A2_EH ?? '') as string];
    if (!countryId) return;
    const country = COUNTRIES.find(c => c.id === countryId);
    if (!country) return;

    const path = layer as L.Path;
    const iso = (feat.properties?.ISO_A2_EH ?? '') as string;
    const color = ISO_TO_COLOR[iso] ?? '#888888';
    const tooltipClass = `wm-tooltip ${dark ? 'wm-tooltip-dark' : 'wm-tooltip-light'}`;
    const nameColor = dark ? '#e8eef8' : '#111111';

    path.bindTooltip(
      `<div style="font-size:12px;color:${nameColor}">${country.demonym} ${country.electionType}</div>`,
      { className: tooltipClass, direction: 'top', sticky: true, opacity: 1 }
    );

    const isLocked = (country as { locked?: true }).locked === true;
    path.on({
      mouseover: () => {
        path.setStyle({ fillOpacity: 0.60, fillColor: color, weight: 0.25, color });
        path.bringToFront();
      },
      mouseout: () => {
        path.setStyle({ fillOpacity: 0.32, fillColor: color, weight: 0.25, color });
      },
      click: () => { if (!isLocked) navigate(country.path); },
    });
  }, [navigate, dark]);

  return (
    <div ref={wrapperRef} className="relative overflow-hidden" style={{ height: '100%' }}>
      <MapContainer
        center={[52, 12]} zoom={4} minZoom={2} maxZoom={18}
        maxBounds={[[-85, -360], [85, 360]]} maxBoundsViscosity={1.0}
        style={{ width: '100%', height: '100%' }} zoomControl={false} worldCopyJump
      >
        <TileLayer
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd" maxZoom={19}
        />
        {geoData && (
          <GeoJSON key={dark ? 'dark' : 'light'} data={geoData} style={geoStyle} onEachFeature={onEachFeature} />
        )}
      </MapContainer>
    </div>
  );
}

// ── 3D Globe (D3 canvas, orthographic projection) ─────────────────────────────
type HlFeature = { feat: GeoJSON.Feature; color: string; id: string };

function GlobeView({ dark }: { dark: boolean }) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth,  setCanvasWidth]  = useState(800);
  const [canvasHeight, setCanvasHeight] = useState(480);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Mutable animation state — never stored in React state to avoid re-renders every frame
  const rotRef   = useRef<[number, number, number]>([0, -20, 0]);
  const scaleRef = useRef(1.0);
  const dragRef      = useRef({ active: false, lastX: 0, lastY: 0 });
  const mouseDownPos = useRef({ x: 0, y: 0 });
  const animRef  = useRef(0);
  const darkRef  = useRef(dark);
  const spinRef  = useRef(true);
  const hovRef   = useRef<string | null>(null);

  // Geography loaded from 50m topojson (756 KB — good detail, browser-cached)
  const [landGeo,     setLandGeo]     = useState<GeoJSON.Feature | null>(null);
  const [hlFeats,     setHlFeats]     = useState<HlFeature[]>([]);
  const [bordersMesh, setBordersMesh] = useState<GeoJSON.MultiLineString | null>(null);

  useEffect(() => { darkRef.current = dark; }, [dark]);

  // Prevent page from scrolling while cursor is over the globe (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  // Resize observer — tracks both width and height for canvas sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setCanvasWidth(width);
    setCanvasHeight(height || 480);
    const ro = new ResizeObserver(e => {
      setCanvasWidth(e[0].contentRect.width);
      setCanvasHeight(e[0].contentRect.height || 480);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load 50m topojson once
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}world-countries-50m.json`)
      .then(r => r.json())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((topo: any) => {
        setLandGeo(topojson.feature(topo, topo.objects.land) as GeoJSON.Feature);
        const all = (topojson.feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection).features;
        setHlFeats(
          all
            .filter(f => f.id != null && String(f.id) in NUMERIC_TO_ISO)
            .map(f => {
              const a2 = NUMERIC_TO_ISO[String(f.id)];
              return { feat: f, color: ISO_TO_COLOR[a2], id: ISO_TO_COUNTRY[a2] };
            })
        );
        // Interior borders between all countries
        setBordersMesh(
          topojson.mesh(topo, topo.objects.countries, (a: unknown, b: unknown) => a !== b) as GeoJSON.MultiLineString
        );
      });
  }, []);

  // Canvas render loop
  useEffect(() => {
    if (!landGeo || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const H = canvasHeight;
    const cx = canvasWidth / 2;
    const cy = H / 2;

    // Spin continuously until user interacts
    spinRef.current = true;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (spinRef.current) rotRef.current[0] += 0.25;

      const isDark = darkRef.current;
      const r = Math.min(canvasWidth, H) * 0.45 * scaleRef.current;
      const proj = d3.geoOrthographic()
        .scale(r).rotate(rotRef.current).translate([cx, cy]).clipAngle(90);
      const path = d3.geoPath(proj, ctx);

      ctx.clearRect(0, 0, canvasWidth, H);

      // d3 supports { type: 'Sphere' } as a special case (not in GeoJSON spec)
      const sphere = { type: 'Sphere' } as unknown as GeoJSON.Feature;

      // Ocean
      ctx.beginPath();
      path(sphere);
      ctx.fillStyle = isDark ? '#1a2035' : '#d8d2c8';
      ctx.fill();

      // All land — single merged shape, one draw call
      ctx.beginPath();
      path(landGeo);
      ctx.fillStyle = isDark ? '#2c3550' : '#c2bdb3';
      ctx.fill();

      // 11 highlighted countries with national colors
      for (const { feat, color, id } of hlFeats) {
        ctx.beginPath();
        path(feat);
        ctx.fillStyle = hexToRgba(color, hovRef.current === id ? 0.68 : 0.32);
        ctx.fill();
      }

      // Country border mesh (all interior borders)
      if (bordersMesh) {
        ctx.beginPath();
        path(bordersMesh as unknown as GeoJSON.MultiLineString);
        ctx.strokeStyle = isDark ? 'rgba(140,165,220,0.28)' : 'rgba(80,70,55,0.22)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Hovered country: bold border in its national color
      if (hovRef.current) {
        const hf = hlFeats.find(f => f.id === hovRef.current);
        if (hf) {
          ctx.beginPath();
          path(hf.feat);
          ctx.strokeStyle = hexToRgba(hf.color, 0.95);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Globe rim
      ctx.beginPath();
      path(sphere);
      ctx.strokeStyle = isDark ? 'rgba(100,140,220,0.20)' : 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animRef.current); };
  }, [landGeo, hlFeats, bordersMesh, canvasWidth, canvasHeight]);

  // Build projection snapshot for hit-testing (not part of the render loop)
  const getProj = useCallback(() =>
    d3.geoOrthographic()
      .scale(Math.min(canvasWidth, canvasHeight) * 0.45 * scaleRef.current)
      .rotate(rotRef.current)
      .translate([canvasWidth / 2, canvasHeight / 2])
      .clipAngle(90),
  [canvasWidth, canvasHeight]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    spinRef.current = false;
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      // Scale sensitivity inversely with zoom — prevents overshooting when zoomed in
      const sens = 0.4 / scaleRef.current;
      rotRef.current[0] += dx * sens;
      rotRef.current[1] = Math.max(-85, Math.min(85, rotRef.current[1] - dy * sens));
      return;
    }
    // Hover detection
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const coords = getProj().invert?.([e.clientX - rect.left, e.clientY - rect.top]);
    let found: string | null = null;
    if (coords) {
      for (const { feat, id } of hlFeats) {
        if (d3.geoContains(feat, coords)) { found = id; break; }
      }
    }
    hovRef.current = found;
    setHoveredId(found);
  }, [getProj, hlFeats]);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    scaleRef.current = Math.max(0.4, Math.min(10, scaleRef.current * (e.deltaY > 0 ? 0.9 : 1.1)));
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const dx = e.clientX - mouseDownPos.current.x;
    const dy = e.clientY - mouseDownPos.current.y;
    if (dx * dx + dy * dy > 16) return; // ignore if mouse moved > 4px (drag)
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const coords = getProj().invert?.([e.clientX - rect.left, e.clientY - rect.top]);
    if (!coords) return;
    for (const { feat, id } of hlFeats) {
      if (d3.geoContains(feat, coords)) {
        const c = COUNTRIES.find(c => c.id === id);
        if ((c as { locked?: true } | undefined)?.locked) return;
        navigate(c?.path ?? '/');
        return;
      }
    }
  }, [getProj, hlFeats, navigate]);

  const hoveredCountry = hoveredId ? COUNTRIES.find(c => c.id === hoveredId) : null;

  return (
    <div
      ref={containerRef}
      className="overflow-hidden select-none relative"
      style={{
        height: '100%',
        background: dark ? '#0f1628' : '#e0dbd2',
        cursor: dragging ? 'grabbing' : hoveredId ? 'pointer' : 'grab',
      }}
    >
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        style={{ display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
      />
      {/* Country name tooltip at bottom */}
      {hoveredCountry && !dragging && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{
            background: dark ? 'rgba(8,16,44,0.97)' : 'rgba(255,255,255,0.98)',
            color: dark ? '#e8eef8' : '#111111',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.11)' : 'rgba(0,0,0,0.10)'}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            borderRadius: 10,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {hoveredCountry.demonym} {hoveredCountry.electionType}
        </div>
      )}
    </div>
  );
}

// ── Map/Globe container with toggle + enlarge ────────────────────────────────
function WorldMapContainer({ dark, enlarged, onEnlargeChange }: {
  dark: boolean;
  enlarged: boolean;
  onEnlargeChange: (v: boolean) => void;
}) {
  const [view,    setView]    = useState<'map' | 'globe'>('globe');
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}world-countries-precise.geojson`)
      .then(r => r.json())
      .then((fc: GeoJSON.FeatureCollection) => setGeoData(fc));
  }, []);

  const wrapperCls = enlarged
    ? 'fixed top-[52px] left-0 right-0 bottom-0 z-[49]'
    : 'relative rounded-2xl overflow-hidden';

  const wrapperStyle = enlarged
    ? {}
    : {
        height: 480,
        boxShadow: dark
          ? '0 8px 40px rgba(0,0,0,0.55), 0 2px 10px rgba(0,0,0,0.35)'
          : '0 8px 40px rgba(0,0,0,0.12), 0 2px 10px rgba(0,0,0,0.06)',
      };

  return (
    <div className={wrapperCls} style={wrapperStyle}>
      {/* Controls row — z-[800] clears Leaflet panes (max z 700) */}
      <div className="absolute top-3 right-3 z-[800] flex items-center gap-2">

        {/* Map / Globe pill */}
        <div
          className="flex rounded-full p-[3px] gap-[2px]"
          style={{
            background: dark ? 'rgba(10,18,38,0.90)' : 'rgba(255,255,255,0.90)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.10)'}`,
            backdropFilter: 'blur(14px)',
          }}
        >
          {(['map', 'globe'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-3 py-[5px] rounded-full text-[8.5px] font-mono font-black uppercase tracking-[0.13em] transition-all duration-200 leading-none"
              style={view === v ? {
                background: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.09)',
                color: dark ? '#e8eef8' : '#111111',
              } : {
                color: dark ? 'rgba(160,185,230,0.55)' : 'rgba(0,0,0,0.38)',
              }}
            >
              {v === 'map' ? 'Map' : 'Globe'}
            </button>
          ))}
        </div>

        {/* Enlarge / collapse button */}
        <button
          onClick={() => onEnlargeChange(!enlarged)}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
          style={{
            background: dark ? 'rgba(10,18,38,0.90)' : 'rgba(255,255,255,0.90)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.10)'}`,
            backdropFilter: 'blur(14px)',
            color: dark ? 'rgba(180,200,240,0.70)' : '#7a7870',
          }}
          title={enlarged ? 'Collapse' : 'Enlarge'}
        >
          {enlarged ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 1v3.5H1M11 4.5H7.5V1M7.5 11V7.5H11M1 7.5h3.5V11"
                stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 4.5V1h3.5M7.5 1H11v3.5M11 7.5V11H7.5M4.5 11H1V7.5"
                stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>

      {view === 'map'
        ? <WorldMapSection dark={dark} geoData={geoData} />
        : <GlobeView dark={dark} />
      }
    </div>
  );
}

// ── Country Card ──────────────────────────────────────────────────────────────
export function CountryCard({ country }: { country: Country }) {
  const navigate = useNavigate();
  const locked = (country as { locked?: true }).locked === true;
  return (
    <button
      onClick={() => { if (locked) return; navigate(country.path); }}
      className={`hp-card country-card group relative rounded-2xl overflow-hidden border border-[rgba(0,0,0,0.09)] bg-white text-left transition-all duration-200 flex flex-col ${locked ? 'cursor-not-allowed' : 'hover:-translate-y-1'}`}
    >
      <div className="relative overflow-hidden shrink-0" style={{ aspectRatio: '16/9' }}>
        <img
          src={`${import.meta.env.BASE_URL}${country.flagSrc}`}
          alt={`${country.name} flag`}
          className={`absolute inset-0 w-full h-full object-cover${locked ? ' opacity-60 grayscale-[40%]' : ''}`}
          style={country.flagStyle}
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 35%, rgba(0,0,0,0.38) 100%)' }} />
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
          <div className="text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-white/70 leading-none">{country.name}</div>
        </div>
        {locked && (
          <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded-full text-[7.5px] font-mono font-black uppercase tracking-[0.14em] text-white"
            style={{ background: 'rgba(250,166,26,0.92)', boxShadow: '0 2px 8px rgba(0,0,0,0.30)' }}>
            Release Imminent
          </div>
        )}
      </div>
      <div className={`flex flex-col flex-1 px-4 pt-3.5 pb-3 hp-card-body${locked ? ' opacity-55' : ''}`}>
        <div className="font-display text-[16px] font-black uppercase tracking-normal leading-tight hp-card-title">
          {country.electionType}
        </div>
        <div className="mt-1.5 text-[8px] font-mono leading-relaxed hp-card-sub">
          {country.subtitle}
        </div>
        <PartyDots parties={country.parties} />
      </div>
      <div className={`px-4 pb-4 flex items-center gap-2 hp-card-body${locked ? ' opacity-55' : ''}`}>
        <div className="flex-1 h-px hp-card-divider" />
        {locked ? (
          <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em]" style={{ color: '#FAA61A' }}>
            Coming Soon
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-gold group-hover:text-gold-deep transition-colors">
            Open Simulator
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M2.5 5.5h6M5.5 3L8 5.5 5.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
      </div>
      {!locked && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ background: country.accent }} />
      )}
    </button>
  );
}

// ── Welcome section ───────────────────────────────────────────────────────────
function WelcomeSection({ dark, onOpenAbout }: { dark: boolean; onOpenAbout: () => void }) {
  const navigate = useNavigate();
  const [name,    setName]    = useState(() => localStorage.getItem('playerName') || '');
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (v: string) => {
    setName(v);
    localStorage.setItem('playerName', v);
  };

  const startEdit = () => {
    setEditing(true);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  };

  const stopEdit = () => setEditing(false);

  const displayName = name.trim() || 'Explorer';
  const ink  = dark ? '#e8eef8'                : '#111111';
  const ink2 = dark ? 'rgba(180,200,240,0.52)' : 'rgba(0,0,0,0.46)';
  const bdr  = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';

  return (
    <div className="mb-8">
      <div className="text-[8px] font-mono uppercase tracking-[0.28em] mb-3" style={{ color: ink2 }}>
        Your global election journey
      </div>

      {/* Greeting */}
      <div className="flex flex-wrap items-baseline gap-x-3 mb-7">
        <span className="font-title font-bold leading-[1.05]"
          style={{ color: ink, fontSize: 'clamp(30px, 4.5vw, 50px)' }}>
          Welcome,
        </span>

        {editing ? (
          <input
            ref={inputRef}
            value={name}
            onChange={e => handleChange(e.target.value)}
            onBlur={stopEdit}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
            placeholder="your name"
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            className="font-title font-bold bg-transparent outline-none leading-[1.05]"
            style={{
              color: ink,
              fontSize: 'clamp(30px, 4.5vw, 50px)',
              borderBottom: '2.5px solid #FAA61A',
              width: `${Math.max((name || 'your name').length + 2, 7)}ch`,
              minWidth: '5ch',
            }}
          />
        ) : (
          <button
            onClick={startEdit}
            className="font-title font-bold leading-[1.05]"
            style={{ fontSize: 'clamp(30px, 4.5vw, 50px)' }}
            title="Click to set your name"
          >
            <span className="brand-title">{displayName}</span>
          </button>
        )}

        <span className="font-title font-bold leading-[1.05]"
          style={{ color: ink, fontSize: 'clamp(30px, 4.5vw, 50px)' }}>!</span>
      </div>

      {/* Action buttons row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Mission Statement */}
        <button
          onClick={onOpenAbout}
          className="group inline-flex items-center gap-4 px-5 py-3.5 rounded-2xl border transition-all duration-200 hover:border-[rgba(250,166,26,0.40)] hover:shadow-md"
          style={{
            background: dark
              ? 'linear-gradient(135deg, rgba(228,0,59,0.05) 0%, rgba(0,135,220,0.05) 50%, rgba(92,45,145,0.05) 100%)'
              : 'linear-gradient(135deg, rgba(228,0,59,0.03) 0%, rgba(0,135,220,0.03) 50%, rgba(92,45,145,0.03) 100%)',
            borderColor: bdr,
            boxShadow: dark ? '0 2px 14px rgba(0,0,0,0.22)' : '0 2px 10px rgba(0,0,0,0.06)',
          }}
        >
          <GlobeLogo size={22} />
          <div className="flex flex-col items-start leading-none">
            <span className="text-[7px] font-mono uppercase tracking-[0.26em] mb-1.5" style={{ color: ink2 }}>
              Explore our
            </span>
            <span className="text-[13px] font-title font-bold tracking-[-0.01em]" style={{ color: ink }}>
              Mission Statement
            </span>
          </div>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            className="ml-1 transition-transform duration-200 group-hover:translate-x-0.5 shrink-0"
            style={{ color: ink2 }}>
            <path d="M2 6h8M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Browse All Simulations */}
        <button
          onClick={() => navigate('/countries')}
          className="group inline-flex items-center gap-4 px-5 py-3.5 rounded-2xl border transition-all duration-200 hover:border-[rgba(250,166,26,0.40)] hover:shadow-md"
          style={{
            background: dark
              ? 'linear-gradient(135deg, rgba(0,156,59,0.06) 0%, rgba(0,135,220,0.06) 50%, rgba(0,156,59,0.06) 100%)'
              : 'linear-gradient(135deg, rgba(0,156,59,0.04) 0%, rgba(0,135,220,0.04) 50%, rgba(0,156,59,0.04) 100%)',
            borderColor: bdr,
            boxShadow: dark ? '0 2px 14px rgba(0,0,0,0.22)' : '0 2px 10px rgba(0,0,0,0.06)',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="shrink-0" aria-hidden="true">
            <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" style={{ color: ink2 }} />
            <rect x="13" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" style={{ color: ink2 }} />
            <rect x="2" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" style={{ color: ink2 }} />
            <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" style={{ color: ink2 }} />
          </svg>
          <div className="flex flex-col items-start leading-none">
            <span className="text-[7px] font-mono uppercase tracking-[0.26em] mb-1.5" style={{ color: ink2 }}>
              Full country list
            </span>
            <span className="text-[13px] font-title font-bold tracking-[-0.01em]" style={{ color: ink }}>
              Browse Simulations
            </span>
          </div>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            className="ml-1 transition-transform duration-200 group-hover:translate-x-0.5 shrink-0"
            style={{ color: ink2 }}>
            <path d="M2 6h8M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── About overlay ─────────────────────────────────────────────────────────────
function AboutOverlay({ dark, onClose }: { dark: boolean; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const bg      = dark ? '#0a1226'                    : '#f8f5f0';
  const ink     = dark ? '#e8eef8'                    : '#111111';
  const ink2    = dark ? 'rgba(180,200,240,0.60)'     : 'rgba(0,0,0,0.50)';
  const card    = dark ? 'rgba(255,255,255,0.045)'    : 'rgba(0,0,0,0.035)';
  const bdr     = dark ? 'rgba(255,255,255,0.08)'     : 'rgba(0,0,0,0.09)';
  const warnBg  = dark ? 'rgba(250,166,26,0.07)'      : 'rgba(250,166,26,0.07)';
  const warnBdr = dark ? 'rgba(250,166,26,0.22)'      : 'rgba(250,166,26,0.28)';

  const SOURCES = [
    'UK Electoral Commission', 'Federal Election Commission (USA)',
    'Elections Canada', 'Bundeswahlleiter (Germany)',
    "Ministère de l'Intérieur (France)", 'Tribunal Superior Electoral (Brazil)',
    'Australian Electoral Commission', 'Kiesraad (Netherlands)',
    'Electoral Commission of South Africa',
    'Autoritatea Electorală Permanentă (Romania)',
    'Wikipedia — Historical Elections', 'OECD Electoral Statistics',
    'BBC News', 'Reuters', 'Associated Press',
  ];

  return (
    <div className="fixed top-[52px] left-0 right-0 bottom-0 z-[49] overflow-y-auto" style={{ background: bg }}>

      {/* Sticky close row */}
      <div className="sticky top-0 z-10 flex justify-end px-6 pt-5 pb-3" style={{ background: bg }}>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[9px] font-mono font-black uppercase tracking-[0.16em] transition-opacity hover:opacity-70"
          style={{ borderColor: bdr, color: ink2, background: card }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Close
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-6 pb-28">

        {/* ── Hero ── */}
        <div className="text-center mb-16 pt-4">
          <div className="text-[8px] font-mono font-black uppercase tracking-[0.28em] mb-5" style={{ color: ink2 }}>
            About this project
          </div>
          <h1 className="font-display font-black text-[38px] sm:text-[50px] leading-[1.08] mb-7" style={{ color: ink }}>
            Built for the community.<br />Free, forever.
          </h1>
          <p className="text-[14px] leading-[1.80] max-w-xl mx-auto" style={{ color: ink2 }}>
            Global Election Simulator is a nonprofit-spirited public resource dedicated to making
            democracy understandable, explorable, and approachable — for everyone,
            regardless of age, background, or political experience.
          </p>
        </div>

        {/* ── Three quick facts ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-14">
          {[
            {
              label: 'Free & Open',
              body: 'No accounts. No paywalls. No barriers. Every simulation, every country, every time — completely free.',
            },
            {
              label: '12 Countries',
              body: 'From Westminster first-past-the-post to German proportional representation — explore real electoral systems.',
            },
            {
              label: 'Education First',
              body: 'Designed for clarity over complexity. We simplify where needed and always explain the why, not just the what.',
            },
          ].map(({ label, body }) => (
            <div key={label} className="rounded-2xl p-5 border" style={{ background: card, borderColor: bdr }}>
              <div className="text-[8px] font-mono font-black uppercase tracking-[0.20em] mb-3 text-gold">{label}</div>
              <p className="text-[12.5px] leading-relaxed" style={{ color: ink2 }}>{body}</p>
            </div>
          ))}
        </div>

        {/* ── Who it's for ── */}
        <div className="mb-14">
          <div className="text-[8px] font-mono font-black uppercase tracking-[0.22em] mb-2" style={{ color: ink2 }}>Who this is for</div>
          <h2 className="font-display font-black text-[24px] uppercase tracking-wide mb-6" style={{ color: ink }}>
            A Space for Everyone
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                title: 'Election Enthusiasts',
                desc: 'Model real-world scenarios, stress-test electoral systems, and explore hypothetical outcomes using data-backed tools.',
              },
              {
                title: 'Students & Teens',
                desc: 'Discover how governments form, what proportional representation means, and why coalitions matter — all interactively.',
              },
              {
                title: 'Curious Citizens',
                desc: "You don't need a political science degree to care about democracy. Explore at your own pace, in your own time.",
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-2xl p-5 border" style={{ background: card, borderColor: bdr }}>
                <div className="font-display font-black text-[13px] uppercase tracking-wide mb-2.5" style={{ color: ink }}>{title}</div>
                <p className="text-[12px] leading-relaxed" style={{ color: ink2 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Accuracy disclaimer ── */}
        <div className="mb-14 rounded-2xl p-6 border" style={{ background: warnBg, borderColor: warnBdr }}>
          <div className="text-[8px] font-mono font-black uppercase tracking-[0.24em] mb-3" style={{ color: '#FAA61A' }}>
            Accuracy &amp; Limitations
          </div>
          <p className="text-[13.5px] leading-[1.78] mb-4" style={{ color: ink }}>
            Global Election Simulator is designed for educational exploration and is{' '}
            <strong>not a substitute</strong> for official electoral results or professional polling services.
            While we source our data from government authorities and reputable organisations,
            approximations and simplifications are intentional — our goal is accessible clarity, not granular prediction.
          </p>
          <p className="text-[12.5px] leading-[1.72]" style={{ color: ink2 }}>
            Errors may exist. Methodologies vary by country. Party seat allocations are modelled using
            publicly documented electoral formulas but may not capture every nuance of real outcomes.
            We are transparent about these limitations and encourage cross-referencing with official sources
            for any serious research or analysis.
          </p>
        </div>

        {/* ── Data sources ── */}
        <div className="mb-14">
          <div className="text-[8px] font-mono font-black uppercase tracking-[0.22em] mb-2" style={{ color: ink2 }}>Where our data comes from</div>
          <h2 className="font-display font-black text-[24px] uppercase tracking-wide mb-3" style={{ color: ink }}>
            Data Sources
          </h2>
          <p className="text-[13px] leading-relaxed mb-5" style={{ color: ink2 }}>
            Electoral data, party vote shares, and regional breakdowns draw from the following official and reputable sources:
          </p>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map(s => (
              <span
                key={s}
                className="text-[9.5px] font-mono font-bold px-3 py-1.5 rounded-full border"
                style={{ background: card, borderColor: bdr, color: ink2 }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* ── The Original ── */}
        <div className="mb-14">
          <div className="text-[8px] font-mono font-black uppercase tracking-[0.22em] mb-2" style={{ color: ink2 }}>Our story</div>
          <h2 className="font-display font-black text-[26px] sm:text-[32px] uppercase tracking-wide leading-tight mb-6" style={{ color: ink }}>
            The Original Global<br />Election Simulator
          </h2>
          <p className="text-[13.5px] leading-[1.78] mb-4 max-w-2xl" style={{ color: ink2 }}>
            Global Election Simulator was among the{' '}
            <strong style={{ color: ink }}>first platforms in the world</strong>{' '}
            to offer free, browser-based, multi-country election simulation in a single accessible experience.
            While many similar tools have emerged since our founding, our core principles have never wavered —
            and neither has our commitment to the community that this project exists to serve.
          </p>
          <p className="text-[13.5px] leading-[1.78] mb-8 max-w-2xl" style={{ color: ink2 }}>
            We deliberately prioritise approachability over extreme granularity. Precise data and academic
            models have their rightful place — but barriers to understanding democracy should not exist.
            We lower those barriers.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                word: 'Simplicity',
                desc: 'No steep learning curve. No academic jargon. Open the page and start exploring in seconds — zero friction.',
              },
              {
                word: 'Transparency',
                desc: "We're honest about what we know, what we model, and where our data and methodologies fall short.",
              },
              {
                word: 'Comfortability',
                desc: 'A welcoming, judgment-free space for beginners and seasoned political analysts alike. Everyone belongs here.',
              },
            ].map(({ word, desc }) => (
              <div key={word} className="rounded-2xl p-5 border" style={{ background: card, borderColor: bdr }}>
                <div className="font-display font-black text-[22px] uppercase brand-title mb-2">{word}</div>
                <p className="text-[12px] leading-relaxed" style={{ color: ink2 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer note ── */}
        <div className="text-center border-t pt-10" style={{ borderColor: bdr }}>
          <p className="text-[12px] leading-[1.78] max-w-xl mx-auto mb-5" style={{ color: ink2 }}>
            Global Election Simulator is an independent, community-driven project. It is not affiliated
            with any political party, government body, or commercial polling organisation.
            All simulation results are illustrative and should not be interpreted as electoral advice or forecasting.
          </p>
          <div className="text-[8px] font-mono uppercase tracking-[0.18em]"
            style={{ color: dark ? 'rgba(140,165,220,0.35)' : 'rgba(0,0,0,0.25)' }}>
            © 2026 Global Election Simulator · Independent &amp; Nonprofit-Spirited
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [dark,        setDark]        = useState(() => localStorage.getItem('darkMode') !== 'false');
  const [mapEnlarged, setMapEnlarged] = useState(false);
  const [aboutOpen,   setAboutOpen]   = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // Lock body scroll while map is fullscreen or about is open
  useEffect(() => {
    document.body.style.overflow = (mapEnlarged || aboutOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mapEnlarged, aboutOpen]);

  return (
    <div className="min-h-screen flex flex-col" data-country="home">

      <header className="h-[52px] sticky top-0 z-50 flex items-center px-4 gap-2.5 border-b"
        style={{
          background: dark ? 'rgba(10,18,38,0.94)' : 'rgba(248,245,240,0.94)',
          borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
          backdropFilter: 'blur(20px)',
        }}>
        <div className="flex items-center gap-2.5">
          <GlobeLogo />
          <button
            onClick={() => setAboutOpen(o => !o)}
            className="hidden sm:flex items-center gap-1.5 group leading-none"
            title="About this project"
          >
            <span className="font-title font-bold text-[15px] tracking-tight leading-none brand-title">
              Global Election Simulator
            </span>
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className="shrink-0 transition-transform duration-200"
              style={{
                color: dark ? 'rgba(180,200,240,0.40)' : 'rgba(0,0,0,0.28)',
                transform: aboutOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            >
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a href="https://ko-fi.com/globalelectionsimulator" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-white font-mono font-black text-[8px] uppercase tracking-[0.18em] leading-none"
            style={{ background: 'linear-gradient(90deg,#e05c00,#e8a020,#c8a020,#e05c00)', backgroundSize: '200% 100%', animation: 'donateCycle 2.8s linear infinite' }}>
            Donate
          </a>
          <a href="https://discord.gg/MzQ4fXnY3K" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors"
            style={{ borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)', color: dark ? 'rgba(180,200,240,0.70)' : '#7a7870' }}>
            <svg width="11" height="8" viewBox="0 0 24 18" fill="currentColor" aria-hidden="true">
              <path d="M20.317 1.492a19.823 19.823 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 1.492a.07.07 0 0 0-.032.027C.533 6.046-.32 10.58.099 15.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.1.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 12.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.18em] leading-none">Discord</span>
          </a>
          <a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors"
            style={{ borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)', color: dark ? 'rgba(180,200,240,0.70)' : '#7a7870' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.18em] leading-none">@realleochang</span>
          </a>
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

      <main id="simulations" className="flex-1 px-4 sm:px-6 pt-8 pb-8">
        <div className="max-w-5xl mx-auto">
          <WelcomeSection dark={dark} onOpenAbout={() => setAboutOpen(true)} />
          <div className={`relative${mapEnlarged ? '' : ' z-0 isolate'}`}>
            <WorldMapContainer dark={dark} enlarged={mapEnlarged} onEnlargeChange={setMapEnlarged} />
          </div>
        </div>
      </main>

      {aboutOpen && <AboutOverlay dark={dark} onClose={() => setAboutOpen(false)} />}

      <footer className="py-5 px-4 flex flex-wrap items-center justify-center gap-3 border-t"
        style={{ borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)' }}>
        <span className="text-[9px] font-mono uppercase tracking-[0.14em]"
          style={{ color: dark ? 'rgba(140,165,220,0.45)' : '#7a7870' }}>
          © 2026 Global Election Simulator
        </span>
      </footer>

    </div>
  );
}
