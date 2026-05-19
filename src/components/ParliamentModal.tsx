import { useMemo, useState } from 'react';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';

const TOTAL    = 650;
const MAJORITY = 326;

// ── Hemicycle geometry ──────────────────────────────────────────────────────
const HEMI_ROWS   = [41, 50, 58, 67, 75, 83, 92, 100, 84] as const;
const HEMI_RADII  = HEMI_ROWS.map((_, i) => 80 + i * 16);
const HEMI_CX     = 260;
const HEMI_CY     = 258;
const HEMI_DOT_R  = 2.5;

// Positions sorted by angle descending (θ=π = left → θ=0 = right)
// so seat index 0 = leftmost angular slice → bundt-cake wedge per party
const HEMI_POSITIONS: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number; theta: number }[] = [];
  for (let row = 0; row < HEMI_ROWS.length; row++) {
    const n   = HEMI_ROWS[row];
    const r   = HEMI_RADII[row];
    for (let j = 0; j < n; j++) {
      const theta = Math.PI * (1 - j / (n - 1));
      pts.push({ x: HEMI_CX + r * Math.cos(theta), y: HEMI_CY - r * Math.sin(theta), theta });
    }
  }
  pts.sort((a, b) => b.theta - a.theta);
  return pts.map(({ x, y }) => ({ x, y }));
})();

// Halfway point of the semicircle = 90° straight up
const MAJ_ANGLE = Math.PI / 2;

// ── Westminster geometry constants ─────────────────────────────────────────
// Row count is dynamic (depends on seat totals); only column count is fixed.
const W_COLS  = 13;
const W_SLOT  = 9;
const W_DOT_R = 3.5;
const W_CX    = 260;
const W_GAP   = 24;
const W_TOP_Y = 45;

// ── Political spectrum order (L → R) ───────────────────────────────────────
const POLITICAL_ORDER: PartyId[] = [
  'WPB', 'SF', 'SNP', 'ALB', 'PC', 'GRN', 'SDLP', 'ALL', 'LAB', 'LD',
  'SDP', 'IND', 'YRK', 'OTH', 'YOUR', 'SPK',
  'UUP', 'CON', 'CPA', 'RCL', 'DUP', 'TUV', 'HER', 'UKIP', 'RUK', 'FOR', 'RFM',
];

const EMPTY_COLOR = '#ddd8d0';

// ── Hemicycle seat array (L→R political order) ──────────────────────────────
function buildSeatArray(tally: Partial<Record<PartyId, number>>): (PartyId | null)[] {
  const seats: (PartyId | null)[] = [];
  const seen = new Set<PartyId>();
  for (const p of POLITICAL_ORDER) {
    if (seen.has(p)) continue;
    const n = tally[p] ?? 0;
    if (n > 0) {
      for (let i = 0; i < n; i++) seats.push(p);
      seen.add(p);
    }
  }
  for (const [p, n] of Object.entries(tally) as [PartyId, number][]) {
    if (n > 0 && !seen.has(p)) {
      for (let i = 0; i < n; i++) seats.push(p);
    }
  }
  while (seats.length < TOTAL) seats.push(null);
  return seats.slice(0, TOTAL);
}

// ── Westminster bench arrays ─────────────────────────────────────────────────
// Gov bench: ALL seats of largest party (no cap, bench height grows).
// Opp bench: all other parties sorted by seat count greatest→least. No overflow.
function buildWestminsterArrays(tally: Partial<Record<PartyId, number>>): {
  gov: PartyId[];
  opp: PartyId[];
} {
  const sorted = (Object.entries(tally) as [PartyId, number][])
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);

  if (sorted.length === 0) return { gov: [], opp: [] };

  const [govParty, govTotal] = sorted[0];

  // Government: all seats of largest party
  const gov: PartyId[] = Array(govTotal).fill(govParty);

  // Opposition: remaining parties already sorted desc by seat count
  const opp: PartyId[] = [];
  for (const [p, n] of sorted.slice(1)) {
    for (let i = 0; i < n; i++) opp.push(p);
  }

  return { gov, opp };
}

function seatColor(p: PartyId | null): string {
  if (p === null) return EMPTY_COLOR;
  return PARTIES[p]?.color ?? '#888';
}

// ── Main panel ───────────────────────────────────────────────────────────────

type ViewMode = 'hemicycle' | 'westminster';

interface Props {
  tally: Partial<Record<PartyId, number>>;
  onClose: () => void;
}

export function ParliamentPanel({ tally, onClose }: Props) {
  const [view, setView] = useState<ViewMode>('hemicycle');
  const seats = useMemo(() => buildSeatArray(tally), [tally]);

  const totalDeclared = seats.filter(s => s !== null).length;
  const topEntry = (Object.entries(tally) as [PartyId, number][])
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)[0];

  return (
    <aside className="w-[340px] shrink-0 bg-white border-r border-default flex flex-col overflow-hidden panel-slide">

      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-default flex items-start justify-between gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">Parliament</p>
          <h2 className="text-[13px] font-bold text-ink leading-tight">Seat distribution</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5">
            {totalDeclared} / {TOTAL} seats · majority {MAJORITY}
            {topEntry ? ` · ${PARTIES[topEntry[0]]?.name ?? topEntry[0]} ${topEntry[1]}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0 mt-0.5"
        >
          ×
        </button>
      </div>

      {/* View toggle */}
      <div className="px-3 pt-2 pb-0 shrink-0">
        <div className="flex rounded-[4px] border border-default overflow-hidden text-[10px] font-mono w-full">
          {(['hemicycle', 'westminster'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 px-2 py-1 uppercase tracking-wide transition-colors ${
                view === v ? 'bg-gold text-white' : 'text-ink-3 hover:bg-hover hover:text-ink'
              }`}
            >
              {v === 'hemicycle' ? 'Semicircle' : 'Westminster'}
            </button>
          ))}
        </div>
      </div>

      {/* Chart + legend */}
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 thin-scroll">
        {view === 'hemicycle'
          ? <HemicycleView seats={seats} tally={tally} />
          : <WestminsterView tally={tally} />
        }
      </div>
    </aside>
  );
}

// ── Hemicycle view ───────────────────────────────────────────────────────────

function HemicycleView({
  seats,
  tally,
}: {
  seats: (PartyId | null)[];
  tally: Partial<Record<PartyId, number>>;
}) {
  const innerR = HEMI_RADII[0];
  const outerR = HEMI_RADII[HEMI_RADII.length - 1];

  const majX1 = HEMI_CX + (innerR - 6) * Math.cos(MAJ_ANGLE);
  const majY1 = HEMI_CY - (innerR - 6) * Math.sin(MAJ_ANGLE);
  const majX2 = HEMI_CX + (outerR + 8) * Math.cos(MAJ_ANGLE);
  const majY2 = HEMI_CY - (outerR + 8) * Math.sin(MAJ_ANGLE);
  const labelX = HEMI_CX + (outerR + 18) * Math.cos(MAJ_ANGLE);
  const labelY = HEMI_CY - (outerR + 18) * Math.sin(MAJ_ANGLE);

  return (
    <div>
      <svg viewBox="0 0 520 275" className="w-full">
        <line
          x1={HEMI_CX - outerR - 10} y1={HEMI_CY}
          x2={HEMI_CX + outerR + 10} y2={HEMI_CY}
          stroke="#e5e2db" strokeWidth="1"
        />
        <line
          x1={majX1} y1={majY1} x2={majX2} y2={majY2}
          stroke="#888" strokeWidth="1.2" strokeDasharray="3 2"
        />
        <text x={labelX} y={labelY + 3} textAnchor="middle" fontSize="8" fill="#888" fontFamily="monospace">
          326
        </text>
        {HEMI_POSITIONS.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={HEMI_DOT_R} fill={seatColor(seats[i] ?? null)} />
        ))}
      </svg>
      <Legend tally={tally} />
    </div>
  );
}

// ── Westminster view ─────────────────────────────────────────────────────────

function WestminsterView({ tally }: { tally: Partial<Record<PartyId, number>> }) {
  const data = useMemo(() => {
    const { gov, opp } = buildWestminsterArrays(tally);

    const govRows = Math.max(1, Math.ceil(gov.length / W_COLS));
    const oppRows = Math.max(1, Math.ceil(opp.length / W_COLS));
    const chamberH = W_TOP_Y + Math.max(govRows, oppRows) * W_SLOT + 36;

    // Government: column-major (innermost first, top→bottom within each col)
    const govPos: { x: number; y: number }[] = gov.map((_, i) => {
      const col = Math.floor(i / govRows);
      const row = i % govRows;
      return { x: W_CX - W_GAP / 2 - col * W_SLOT - W_SLOT / 2, y: W_TOP_Y + row * W_SLOT + W_SLOT / 2 };
    });

    // Opposition: row-major (top row L→R first → horizontal bands per party)
    const oppPos: { x: number; y: number }[] = opp.map((_, i) => {
      const row = Math.floor(i / W_COLS);
      const col = i % W_COLS;
      return { x: W_CX + W_GAP / 2 + col * W_SLOT + W_SLOT / 2, y: W_TOP_Y + row * W_SLOT + W_SLOT / 2 };
    });

    const govLabelY = W_TOP_Y + govRows * W_SLOT + 14;
    const oppLabelY = W_TOP_Y + oppRows * W_SLOT + 14;
    const govMidX   = W_CX - W_GAP / 2 - ((Math.min(W_COLS, Math.ceil(gov.length / govRows)) - 1) / 2) * W_SLOT - W_SLOT / 2;
    const oppMidX   = W_CX + W_GAP / 2 + ((Math.min(W_COLS, Math.ceil(opp.length / oppRows)) - 1) / 2) * W_SLOT + W_SLOT / 2;

    return { gov, opp, govPos, oppPos, govRows, oppRows, chamberH, govLabelY, oppLabelY, govMidX, oppMidX };
  }, [tally]);

  const tableY = W_TOP_Y + W_SLOT * 2;

  return (
    <div>
      <svg viewBox={`0 0 520 ${data.chamberH}`} className="w-full">
        {/* Speaker's chair */}
        <rect x={W_CX - 22} y={4} width={44} height={20} rx={3} fill="#c9a227" opacity={0.9} />
        <text x={W_CX} y={17} textAnchor="middle" fontSize="7" fill="white" fontFamily="monospace" fontWeight="bold">
          SPEAKER
        </text>

        {/* Dispatch boxes */}
        <rect x={W_CX - W_GAP / 2 + 1} y={tableY - 8} width={W_GAP / 2 - 2} height={16}
          rx={2} fill="#f2ece0" stroke="#d4ccb4" strokeWidth="0.5" />
        <rect x={W_CX + 1} y={tableY - 8} width={W_GAP / 2 - 2} height={16}
          rx={2} fill="#f2ece0" stroke="#d4ccb4" strokeWidth="0.5" />

        {/* Government bench dots */}
        {data.gov.map((party, i) => (
          <circle key={`g${i}`} cx={data.govPos[i].x} cy={data.govPos[i].y} r={W_DOT_R} fill={seatColor(party)} />
        ))}

        {/* Opposition bench dots */}
        {data.opp.map((party, i) => (
          <circle key={`o${i}`} cx={data.oppPos[i].x} cy={data.oppPos[i].y} r={W_DOT_R} fill={seatColor(party)} />
        ))}

        {/* Bench labels — positioned below each bench independently */}
        <text x={data.govMidX} y={data.govLabelY} textAnchor="middle" fontSize="7" fill="#aaa" fontFamily="monospace">
          GOVERNMENT
        </text>
        <text x={data.oppMidX} y={data.oppLabelY} textAnchor="middle" fontSize="7" fill="#aaa" fontFamily="monospace">
          OPPOSITION
        </text>
      </svg>
      <Legend tally={tally} />
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend({ tally }: { tally: Partial<Record<PartyId, number>> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-default">
      {(Object.entries(tally) as [PartyId, number][])
        .filter(([, n]) => n > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([p, n]) => (
          <div key={p} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PARTIES[p]?.color ?? '#888' }} />
            <span className="text-[9px] font-mono text-ink-2">{p}</span>
            <span className="text-[9px] font-mono font-bold text-ink">{n}</span>
          </div>
        ))}
    </div>
  );
}
