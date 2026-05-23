import { useMemo, useState, useRef, useEffect, useLayoutEffect, forwardRef } from 'react';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES, LEADER_WIKI_TITLES, BASELINE_2024_LEADERS } from '../data/parties';
import type { PartyId } from '../data/parties';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
const MAJORITY = 326;

// Sorting tiers: 0 mainland → 1 NI → 2 IND → 3 OTH → 4 SPK (always last)
const NI_PARTIES = new Set<PartyId>(['DUP','SF','SDLP','UUP','ALL','TUV']);
function partyGroup(id: PartyId): 0 | 1 | 2 | 3 | 4 {
  if (id === 'SPK') return 4;
  if (id === 'OTH') return 3;
  if (id === 'IND') return 2;
  if (NI_PARTIES.has(id)) return 1;
  return 0;
}

function fmtVotes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return n.toString();
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(128,128,128,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

interface CandTileProps {
  partyId:  PartyId;
  seats:    number;
  votes:    number;
  votePct:  number;
  isLeader: boolean;
  isWinner: boolean;
}

// ── Floating leader dropdown (replaces native <select>) ──────────────────
function LeaderDropdown({ options, value, color, onChange }: {
  options: string[];
  value: string;
  color: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const lastName = value.trim().split(/\s+/).pop() ?? value;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button ref={btnRef} onClick={handleToggle} className="cand-leader-wrap" style={{ background: 'none', border: 'none', padding: 0 }}>
        <span className="cand-leader-name">{lastName}</span>
        <svg className="leader-chevron" width="7" height="4" viewBox="0 0 7 4" fill="none" aria-hidden="true">
          <path d="M0.5 0.5L3.5 3.5L6.5 0.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-[1999]" onClick={() => setOpen(false)} />
          <div className="fixed z-[2000] bg-white border border-default rounded-lg shadow-xl py-1"
            style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)', minWidth: 190 }}>
            {options.map(opt => (
              <button key={opt} onClick={e => { e.stopPropagation(); onChange(opt); setOpen(false); }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-left transition-colors ${opt === value ? 'bg-[#f8f7f4]' : 'hover:bg-hover'}`}>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] font-mono text-ink leading-none flex-1">{opt}</span>
                {opt === value && (
                  <svg className="shrink-0 ml-1" width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4L3.2 5.8L6.5 2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ── Candidate tile ────────────────────────────────────────────────────────
const CandTile = forwardRef<HTMLDivElement, CandTileProps>(
  function CandTile({ partyId, seats, votes, votePct, isLeader, isWinner }, ref) {
    const leaderPicks  = useElectionStore(s => s.leaderPicks);
    const setLeader    = useElectionStore(s => s.setLeader);
    const activePreset = useElectionStore(s => s.activePreset);
    const party = PARTIES[partyId];

    const isBaseline = activePreset === 'baseline';
    const leader   = isBaseline
      ? (BASELINE_2024_LEADERS[partyId] ?? party?.defaultLeader ?? partyId)
      : (leaderPicks[partyId] ?? party?.defaultLeader ?? partyId);
    const isDash   = leader === '—';
    const initials = isDash
      ? partyId.slice(0, 2).toUpperCase()
      : leader.trim().split(/\s+/).filter(Boolean).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2);

    const color      = party?.color ?? '#888888';
    const colorAlpha = hexToRgba(color, 0.13);
    // Suppress dropdown in 2024 baseline — leaders are fixed to election-day names.
    const hasAlt     = !isBaseline && !isDash && (party?.alternativeLeaders.length ?? 0) > 0;
    const options    = hasAlt ? [party!.defaultLeader, ...party!.alternativeLeaders] : [leader];
    const barPct     = Math.min(Math.max(votePct, 0), 100);

    const stateClasses = `${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`;

    // ── Percentage delta animation ─────────────────────────────────────
    const prevPctRef    = useRef(votePct);
    const deltaKeyRef   = useRef(0);
    const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [pctDelta, setPctDelta] = useState<{ value: number; key: number } | null>(null);

    useEffect(() => {
      const diff = votePct - prevPctRef.current;
      prevPctRef.current = votePct;
      if (Math.abs(diff) >= 0.05) {
        if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current);
        deltaKeyRef.current += 1;
        setPctDelta({ value: diff, key: deltaKeyRef.current });
        deltaTimerRef.current = setTimeout(() => setPctDelta(null), 2800);
      }
    }, [votePct]);

    useEffect(() => () => { if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current); }, []);

    // ── Wikipedia profile photo ────────────────────────────────────────
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    useEffect(() => {
      const wikiTitle = LEADER_WIKI_TITLES[leader];
      if (!wikiTitle || isDash) { setPhotoUrl(null); return; }
      let cancelled = false;
      fetchWikiPhoto(wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
      return () => { cancelled = true; };
    }, [leader, isDash]);

    const deltaEl = pctDelta ? (
      <span key={pctDelta.key} className="pct-delta" style={{ color }}>
        {pctDelta.value > 0 ? '+' : ''}{pctDelta.value.toFixed(1)}%
      </span>
    ) : null;

    return (
      <div
        ref={ref}
        className={`cand-col${stateClasses}`}
        style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha } as React.CSSProperties}
        draggable
      >
        {/* 1. Avatar bubble */}
        <div id={`cand-photo-${partyId}`}>
          <div className="cand-circle-frame">
            {photoUrl
              ? <img src={photoUrl} alt={leader} onError={() => setPhotoUrl(null)} />
              : <span className="cand-initials">{initials}</span>
            }
          </div>
          {isWinner && (
            <span className="called-tick">
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
                <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          )}
        </div>

        {/* 2. Party abbreviation */}
        <span className="cand-party-abbrev">{partyId}</span>

        {/* 3. Leader name or dropdown */}
        {hasAlt ? (
          <LeaderDropdown options={options} value={leader} color={color} onChange={v => setLeader(partyId, v)} />
        ) : (
          <span className="cand-leader-name" title={leader}>{isDash ? '' : leader}</span>
        )}

        {/* 4. Seat count */}
        <div className="cand-seats">{seats}</div>

        {/* 5. Party full name */}
        <div className="cand-party-name" title={party?.name}>{party?.name ?? partyId}</div>

        {/* 6. Vote percentage + delta */}
        <div className="cand-pct">
          <span className="pct-number">{votePct.toFixed(1)}%</span>
          {deltaEl}
        </div>

        {/* 7. Raw votes */}
        <div className="cand-votes">
          <span className="cand-votes-full">{votes.toLocaleString()} votes</span>
          <span className="cand-votes-compact">{fmtVotes(votes)} votes</span>
        </div>

        {/* 8. Progress bar */}
        <div className="cand-bar-track">
          <div id={`cand-bar-${partyId}`} className="cand-bar-fill" style={{ width: `${barPct}%` }} />
        </div>
      </div>
    );
  }
);

// ── Scoreboard strip ──────────────────────────────────────────────────────
export function Scoreboard() {
  const baselineLoaded = useElectionStore(s => s.baselineLoaded);
  const constituencies = useElectionStore(s => s.constituencies);
  const currentResults = useElectionStore(s => s.currentResults);
  const hiddenParties  = useElectionStore(s => s.hiddenParties);
  const isBlankMap     = useElectionStore(s => s.isBlankMap);
  const declaredIds    = useElectionStore(s => s.declaredIds);

  // ── Wheel → horizontal scroll ──────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // already horizontal
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // ── FLIP reorder animation ─────────────────────────────────────────
  const tileRefs      = useRef<Map<PartyId, HTMLDivElement>>(new Map());
  const positionCache = useRef<Map<PartyId, number>>(new Map());

  const { tally, popularVote, grandTotal } = useMemo(() => {
    const tally:       Partial<Record<PartyId, number>> = {};
    const popularVote: Partial<Record<PartyId, number>> = {};
    let grandTotal = 0;

    for (const c of constituencies) {
      if (isBlankMap && !declaredIds.has(c.id)) continue;

      const results = currentResults[c.id] ?? c.results2024;
      if (!results) continue;

      const winner = (Object.entries(results) as [PartyId, number][])
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)[0]?.[0];
      if (winner) tally[winner] = (tally[winner] ?? 0) + 1;

      for (const [party, votes] of Object.entries(results) as [PartyId, number][]) {
        if (votes > 0) {
          popularVote[party] = (popularVote[party] ?? 0) + votes;
          grandTotal += votes;
        }
      }
    }
    return { tally, popularVote, grandTotal };
  }, [constituencies, currentResults, isBlankMap, declaredIds]);

  const sortedPartyIds = useMemo(() => {
    return (Object.keys(PARTIES) as PartyId[])
      .filter(id => !hiddenParties.has(id) && (popularVote[id] ?? 0) > 0)
      .sort((a, b) => {
        const ga = partyGroup(a);
        const gb = partyGroup(b);
        if (ga !== gb) return ga - gb;
        const sa = tally[a] ?? 0;
        const sb = tally[b] ?? 0;
        if (sa !== sb) return sb - sa;
        return (popularVote[b] ?? 0) - (popularVote[a] ?? 0);
      });
  }, [tally, popularVote, hiddenParties]);

  const topSeatPartyId = sortedPartyIds.find(id => (tally[id] ?? 0) > 0);

  // FLIP animation
  useLayoutEffect(() => {
    const refs = tileRefs.current;
    if (refs.size === 0) return;

    for (const [, el] of refs) {
      el.style.transition = 'none';
      el.style.transform  = '';
    }
    void [...refs.values()][0].offsetWidth;

    const newPositions = new Map<PartyId, number>();
    const moves: Array<{ el: HTMLDivElement; dx: number }> = [];

    for (const [id, el] of refs) {
      const next = el.getBoundingClientRect().left;
      newPositions.set(id, next);

      const prev = positionCache.current.get(id);
      if (prev !== undefined && Math.abs(prev - next) > 2) {
        moves.push({ el, dx: prev - next });
      }
    }

    if (moves.length > 0) {
      for (const { el, dx } of moves) el.style.transform = `translateX(${dx}px)`;
      void moves[0].el.offsetWidth;
      for (const { el } of moves) {
        el.style.transition = 'transform 420ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        el.style.transform  = 'translateX(0)';
        el.addEventListener('transitionend', () => {
          el.style.transform  = '';
          el.style.transition = '';
        }, { once: true });
      }
    }

    positionCache.current = newPositions;
  });

  return (
    <div className="relative bg-white border-b border-default shrink-0 select-none z-[45]">

      {/* Party tile row */}
      <div ref={scrollRef} className="flex gap-1.5 px-3 overflow-x-auto items-stretch pt-2 pb-1.5 scroll-none">

        {!baselineLoaded && (
          <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wide py-3 self-center">
            Load 2024 baseline to see results
          </span>
        )}

        {baselineLoaded && (() => {
          const renderTile = (partyId: PartyId) => {
            const seats    = tally[partyId] ?? 0;
            const votes    = popularVote[partyId] ?? 0;
            const votePct  = grandTotal > 0 ? (votes / grandTotal) * 100 : 0;
            const isLeader = partyId === topSeatPartyId;
            const isWinner = isLeader && seats >= MAJORITY;
            return (
              <CandTile
                key={partyId}
                ref={el => {
                  if (el) tileRefs.current.set(partyId, el);
                  else    tileRefs.current.delete(partyId);
                }}
                partyId={partyId}
                seats={seats}
                votes={votes}
                votePct={votePct}
                isLeader={isLeader}
                isWinner={isWinner}
              />
            );
          };

          const mainlandIds = sortedPartyIds.filter(id => partyGroup(id) === 0);
          const niIds       = sortedPartyIds.filter(id => partyGroup(id) === 1);
          const indIds      = sortedPartyIds.filter(id => partyGroup(id) === 2);
          const othIds      = sortedPartyIds.filter(id => partyGroup(id) === 3);
          const spkIds      = sortedPartyIds.filter(id => partyGroup(id) === 4);

          return (
            <>
              {mainlandIds.map(renderTile)}

              {niIds.length > 0 && (
                <div className="ni-group">
                  <span className="ni-group-label">Northern Ireland</span>
                  <div className="ni-group-tiles">{niIds.map(renderTile)}</div>
                </div>
              )}

              {indIds.map(renderTile)}
              {othIds.map(renderTile)}
              {spkIds.map(renderTile)}
            </>
          );
        })()}
      </div>

    </div>
  );
}
