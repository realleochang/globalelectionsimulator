import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES } from '../data/parties';
import type { PartyId } from '../data/parties';

type TooltipState = {
  x: number;
  y: number;
  name: string;
  region: string;
  electorate: number;
  validVotes: number;
  parties: { id: PartyId; votes: number; pct: number }[];
} | null;

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const getFill = useElectionStore(s => s.getFill);
  const byId = useElectionStore(s => s.byId);
  const currentResults = useElectionStore(s => s.currentResults);
  const baselineLoaded = useElectionStore(s => s.baselineLoaded);
  const selectConstituency = useElectionStore(s => s.selectConstituency);
  const selectedId = useElectionStore(s => s.selectedId);
  const multiSelectMode = useElectionStore(s => s.multiSelectMode);
  const selectedIds = useElectionStore(s => s.selectedIds);
  const toggleConstituencySelection = useElectionStore(s => s.toggleConstituencySelection);

  // Refs so Leaflet's once-created handlers always see current values
  const multiSelectModeRef = useRef(multiSelectMode);
  const selectRef = useRef(selectConstituency);
  const toggleSelRef = useRef(toggleConstituencySelection);
  const byIdRef = useRef(byId);
  const currentResultsRef = useRef(currentResults);

  useEffect(() => { multiSelectModeRef.current = multiSelectMode; }, [multiSelectMode]);
  useEffect(() => { selectRef.current = selectConstituency; }, [selectConstituency]);
  useEffect(() => { toggleSelRef.current = toggleConstituencySelection; }, [toggleConstituencySelection]);
  useEffect(() => { byIdRef.current = byId; }, [byId]);
  useEffect(() => { currentResultsRef.current = currentResults; }, [currentResults]);

  // Load GeoJSON once
  useEffect(() => {
    fetch('/uk-constituencies.geojson')
      .then(r => r.json())
      .then(setGeoData)
      .catch(err => console.error('Failed to load GeoJSON:', err));
  }, []);

  // Re-style all paths reactively (no layer re-render)
  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.setStyle((feature: any) => featureStyle(feature, getFill, selectedId, selectedIds));
  }, [getFill, currentResults, baselineLoaded, selectedId, selectedIds]);

  // onEachFeature: click + hover — uses refs to avoid stale closures
  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const gss: string = feature.properties?.gssCode ?? '';

    layer.on('click', (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.shiftKey || multiSelectModeRef.current) {
        toggleSelRef.current(gss);
      } else {
        selectRef.current(gss);
      }
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      const c = byIdRef.current.get(gss);
      if (!c) { setTooltip(null); return; }
      const results = currentResultsRef.current[gss] ?? c.results2024;
      const parties = (Object.entries(results) as [PartyId, number][])
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([id, votes]) => ({
          id,
          votes,
          pct: c.validVotes > 0 ? Math.round((votes / c.validVotes) * 1000) / 10 : 0,
        }));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: e.originalEvent.clientX - rect.left,
        y: e.originalEvent.clientY - rect.top,
        name: c.name,
        region: c.region || c.country,
        electorate: c.electorate,
        validVotes: c.validVotes,
        parties,
      });
    });

    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer
        center={[54.5, -3.5]}
        zoom={6}
        style={{ width: '100%', height: '100%' }}
        zoomControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={20}
        />
        {geoData && (
          <GeoJSON
            ref={layerRef as any}
            data={geoData}
            style={(feature: any) => featureStyle(feature, getFill, selectedId, selectedIds)}
            onEachFeature={onEachFeature}
          />
        )}
      </MapContainer>

      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const ch = containerRef.current?.clientHeight ?? 9999;
        const TW = 272;
        const TH_EST = 120 + tooltip.parties.length * 46;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const top  = Math.max(6, Math.min(tooltip.y - 20, ch - TH_EST - 8));
        const turnout = tooltip.electorate > 0
          ? ((tooltip.validVotes / tooltip.electorate) * 100).toFixed(1)
          : '—';
        return (
          <div
            className="absolute pointer-events-none z-[1000] map-tooltip"
            style={{ left, top, width: TW }}
          >
            <div
              className="bg-white rounded-[10px] overflow-hidden map-tooltip-card"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.07)' }}
            >
              {/* ── Header ──────────────────────────────────────────── */}
              <div className="px-4 pt-3.5 pb-2.5">
                <div
                  className="font-bold leading-tight"
                  style={{ fontSize: 15, color: 'var(--tt-ink, #1a1a1a)' }}
                >
                  {tooltip.name}
                </div>
                <div
                  className="font-mono mt-0.5 leading-none"
                  style={{ fontSize: 10.5, color: 'var(--tt-ink3, #7a7870)' }}
                >
                  {tooltip.region}
                </div>
              </div>

              {/* ── Results sub-header ──────────────────────────────── */}
              <div
                className="flex items-center justify-between px-4 py-1.5"
                style={{ borderTop: '1px solid rgba(0,0,0,0.06)', borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'var(--tt-sub-bg, #faf9f7)' }}
              >
                <span
                  className="font-mono font-bold uppercase tracking-widest"
                  style={{ fontSize: 9, color: 'var(--tt-ink3, #7a7870)' }}
                >
                  Results
                </span>
                <span
                  className="font-mono font-bold text-[#c8a020]"
                  style={{ fontSize: 9.5 }}
                >
                  {turnout}% Turnout
                </span>
              </div>

              {/* ── Party rows ──────────────────────────────────────── */}
              <div className="px-3.5 pt-2.5 pb-1">
                {tooltip.parties.length > 0 ? tooltip.parties.map(({ id, votes, pct }, i) => {
                  const color  = PARTIES[id]?.color ?? '#888888';
                  const name   = PARTIES[id]?.name ?? id;
                  const isWinner = i === 0;
                  return (
                    <div key={id} className={i < tooltip.parties.length - 1 ? 'mb-2.5' : 'mb-1.5'}>
                      {/* Name row */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="shrink-0 rounded-[2px]"
                          style={{ width: 8, height: 8, background: color, flexShrink: 0 }}
                        />
                        <span
                          className="flex-1 min-w-0 truncate leading-none"
                          style={{
                            fontSize: 11.5,
                            fontWeight: isWinner ? 600 : 500,
                            color: 'var(--tt-ink, #1a1a1a)',
                          }}
                        >
                          {name}
                          <span
                            style={{ fontSize: 9.5, fontFamily: '"DM Mono",monospace', color: 'var(--tt-ink3, #7a7870)', marginLeft: 3 }}
                          >
                            ({id})
                          </span>
                        </span>
                        <span
                          className="font-mono tabular-nums shrink-0"
                          style={{ fontSize: 10.5, color: 'var(--tt-ink2, #4a4844)', marginRight: 6 }}
                        >
                          {votes.toLocaleString()}
                        </span>
                        <span
                          className="font-mono font-bold tabular-nums shrink-0"
                          style={{ fontSize: 13, color, minWidth: 44, textAlign: 'right' }}
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      {/* Bar */}
                      <div
                        style={{
                          height: 3,
                          background: 'var(--tt-bar, #e8e5e0)',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: color,
                            borderRadius: 2,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  );
                }) : (
                  <p style={{ fontSize: 11, color: 'var(--tt-ink3, #7a7870)', fontStyle: 'italic', margin: '4px 0 8px' }}>
                    No results loaded
                  </p>
                )}
              </div>

              {/* ── Footer ──────────────────────────────────────────── */}
              <div
                className="flex items-center justify-between px-4 py-2"
                style={{ borderTop: '1px solid rgba(0,0,0,0.06)', background: 'var(--tt-sub-bg, #faf9f7)' }}
              >
                <span
                  className="font-mono"
                  style={{ fontSize: 10, color: 'var(--tt-ink3, #7a7870)' }}
                >
                  {tooltip.validVotes.toLocaleString()} votes cast
                </span>
                <span
                  className="font-mono"
                  style={{ fontSize: 10, color: 'var(--tt-ink3, #7a7870)' }}
                >
                  {tooltip.electorate.toLocaleString()} electorate
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="absolute bottom-2 left-2 text-[11px] text-ink-3 select-none z-[1000]">
        {multiSelectMode
          ? `Multi-select on · ${selectedIds.size} selected · Shift+click or click to toggle`
          : 'Scroll to zoom · Drag to pan · Shift+click to multi-select'}
      </div>
    </div>
  );
}

function featureStyle(
  feature: any,
  getFill: (gss: string) => string,
  selectedId: string | null,
  selectedIds: Set<string>,
): L.PathOptions {
  const gss: string = feature?.properties?.gssCode ?? '';
  const isSelected = gss === selectedId;
  const isMulti = selectedIds.has(gss);
  return {
    fillColor: getFill(gss),
    weight: isSelected || isMulti ? 2.5 : 0.7,
    color: isMulti ? '#c8a020' : isSelected ? '#c8a020' : 'rgba(0,0,0,0.22)',
    fillOpacity: 0.65,
    opacity: 1,
  };
}
