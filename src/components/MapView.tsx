import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useElectionStore } from '../store/useElectionStore';
import { PARTIES, } from '../data/parties';
import type { PartyId } from '../data/parties';
import { darkModeFill } from '../lib/coloring';

type TooltipState = {
  x: number;
  y: number;
  name: string;
  region: string;
  electorate: number;
  validVotes: number;
  parties: { id: PartyId; votes: number; pct: number }[];
} | null;

function computeCentroid(geometry: any): [number, number] {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const visit = (c: any) => {
    if (typeof c[0] === 'number') {
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0];
    } else { for (const ch of c) visit(ch); }
  };
  visit(geometry.coordinates);
  if (!isFinite(minLat)) return [0, 0];
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

export function MapView({ bubbleMapMode = false, dark = false }: { bubbleMapMode?: boolean; dark?: boolean }) {
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
  const simulationRunning = useElectionStore(s => s.simulationRunning);
  const declaredIds = useElectionStore(s => s.declaredIds);

  // Refs so Leaflet's once-created handlers always see current values
  const multiSelectModeRef    = useRef(multiSelectMode);
  const selectRef             = useRef(selectConstituency);
  const toggleSelRef          = useRef(toggleConstituencySelection);
  const byIdRef               = useRef(byId);
  const currentResultsRef     = useRef(currentResults);
  const simulationRunningRef  = useRef(simulationRunning);
  const declaredIdsRef        = useRef(declaredIds);
  const bubbleModeRef         = useRef(bubbleMapMode);

  useEffect(() => { multiSelectModeRef.current   = multiSelectMode;   }, [multiSelectMode]);
  useEffect(() => { selectRef.current             = selectConstituency; }, [selectConstituency]);
  useEffect(() => { toggleSelRef.current          = toggleConstituencySelection; }, [toggleConstituencySelection]);
  useEffect(() => { byIdRef.current               = byId; }, [byId]);
  useEffect(() => { currentResultsRef.current     = currentResults; }, [currentResults]);
  useEffect(() => { simulationRunningRef.current  = simulationRunning; }, [simulationRunning]);
  useEffect(() => { declaredIdsRef.current        = declaredIds; }, [declaredIds]);
  useEffect(() => { bubbleModeRef.current         = bubbleMapMode; }, [bubbleMapMode]);

  // Load GeoJSON once
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}uk-constituencies.geojson`)
      .then(r => r.json())
      .then(setGeoData)
      .catch(err => console.error('Failed to load GeoJSON:', err));
  }, []);

  // Enforce smoothFactor: 0 on every child layer once GeoJSON is mounted
  useEffect(() => {
    if (!layerRef.current) return;
    enforceNoSmooth(layerRef.current);
  }, [geoData]);

  // Re-style all paths reactively (no layer re-render)
  useEffect(() => {
    if (!layerRef.current) return;
    if (bubbleMapMode) {
      layerRef.current.setStyle(() => ({ fillOpacity: 0, weight: 0.4, color: dark ? '#666' : '#bbb', opacity: 0.6 }));
    } else {
      layerRef.current.setStyle((feature: any) => featureStyle(feature, getFill, selectedId, selectedIds, dark));
    }
  }, [bubbleMapMode, getFill, currentResults, baselineLoaded, selectedId, selectedIds, dark]);

  const bubbleData = useMemo(() => {
    if (!bubbleMapMode || !geoData) return [];
    let maxMargin = 1;
    const items: { gss: string; center: [number,number]; margin: number; color: string }[] = [];
    for (const feature of geoData.features) {
      const gss: string = feature.properties?.gssCode ?? '';
      const c = byId.get(gss);
      if (!c) continue;
      const res = currentResults[gss] ?? c.results2024;
      const sorted = (Object.values(res) as number[]).filter(v => v > 0).sort((a, b) => b - a);
      if (sorted.length === 0) continue;
      const margin = sorted.length >= 2 ? sorted[0] - sorted[1] : sorted[0];
      if (margin > maxMargin) maxMargin = margin;
      items.push({ gss, center: computeCentroid(feature.geometry), margin, color: getFill(gss) });
    }
    return items.map(it => ({ ...it, radius: 1.5 + Math.sqrt(it.margin / maxMargin) * 10.5 }));
  }, [bubbleMapMode, geoData, currentResults, byId, getFill]);

  // onEachFeature: click + hover — uses refs to avoid stale closures
  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const gss: string = feature.properties?.gssCode ?? '';

    layer.on('click', (e: L.LeafletMouseEvent) => {
      if (simulationRunningRef.current) return;
      if (e.originalEvent.shiftKey || multiSelectModeRef.current) {
        toggleSelRef.current(gss);
      } else {
        selectRef.current(gss);
      }
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleModeRef.current) { setTooltip(null); return; }
      if (multiSelectModeRef.current) { setTooltip(null); return; }
      if (simulationRunningRef.current && !declaredIdsRef.current.has(gss)) { setTooltip(null); return; }
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
          key={dark ? 'dark' : 'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
          }
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          updateWhenZooming={false}
          updateWhenIdle={true}
          maxZoom={20}
        />
        <MapController layerRef={layerRef} />
        {geoData && (
          <GeoJSON
            ref={layerRef as any}
            data={geoData}
            style={(feature: any) => bubbleMapMode
              ? { fillOpacity: 0, weight: 0.4, color: dark ? '#666' : '#bbb', opacity: 0.6 }
              : featureStyle(feature, getFill, selectedId, selectedIds, dark)
            }
            onEachFeature={onEachFeature}
            {...({ smoothFactor: 0 } as any)}
          />
        )}
        {bubbleData.map(b => (
          <CircleMarker
            key={b.gss}
            center={b.center}
            radius={b.radius}
            pathOptions={{ fillColor: b.color, fillOpacity: 0.85, color: 'rgba(255,255,255,0.7)', weight: 0.6, opacity: 0.9 }}
            eventHandlers={{
              click: () => {
                if (simulationRunningRef.current) return;
                if (multiSelectModeRef.current) {
                  toggleSelRef.current(b.gss);
                } else {
                  selectRef.current(b.gss);
                }
              },
              mousemove: (e) => {
                const c = byIdRef.current.get(b.gss);
                if (!c) return;
                const results = currentResultsRef.current[b.gss] ?? c.results2024;
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
                  x: (e as L.LeafletMouseEvent).originalEvent.clientX - rect.left,
                  y: (e as L.LeafletMouseEvent).originalEvent.clientY - rect.top,
                  name: c.name,
                  region: c.region || c.country,
                  electorate: c.electorate,
                  validVotes: c.validVotes,
                  parties,
                });
              },
              mouseout: () => setTooltip(null),
            }}
          />
        ))}
      </MapContainer>

      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const ch = containerRef.current?.clientHeight ?? 9999;
        const TW = 272;
        const TH_EST = 120 + tooltip.parties.length * 46;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const top  = Math.max(6, Math.min(tooltip.y - 20, ch - TH_EST - 8));
        const tt = {
          bg:     dark ? 'rgba(18,24,44,0.96)'       : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.09)'    : 'rgba(0,0,0,0.08)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
          title:  dark ? 'rgba(255,255,255,0.92)'    : 'rgba(0,0,0,0.85)',
          sub:    dark ? 'rgba(255,255,255,0.42)'    : 'rgba(0,0,0,0.42)',
          body:   dark ? 'rgba(255,255,255,0.85)'    : 'rgba(0,0,0,0.78)',
          muted:  dark ? 'rgba(255,255,255,0.38)'    : 'rgba(0,0,0,0.40)',
          dim:    dark ? 'rgba(255,255,255,0.28)'    : 'rgba(0,0,0,0.35)',
          divider:dark ? 'rgba(255,255,255,0.06)'    : 'rgba(0,0,0,0.07)',
        };
        return (
          <div
            className="absolute pointer-events-none z-[1000]"
            style={{ left, top, width: TW }}
          >
            <div style={{
              background: tt.bg,
              borderRadius: 10,
              border: `1px solid ${tt.border}`,
              boxShadow: tt.shadow,
              backdropFilter: 'blur(10px)',
              overflow: 'hidden',
            }}>
              {/* Header */}
              <div style={{ padding: '12px 16px 10px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>
                  {tooltip.name}
                </div>
                <div style={{ fontSize: 10.5, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 3 }}>
                  {tooltip.region}
                </div>
              </div>

              {/* Party rows */}
              <div style={{ padding: '0 14px 12px' }}>
                {tooltip.parties.length > 0 ? tooltip.parties.map(({ id, votes, pct }, i) => {
                  const color  = PARTIES[id]?.color ?? '#888888';
                  const name   = PARTIES[id]?.name ?? id;
                  const isWinner = i === 0;
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < tooltip.parties.length - 1 ? 7 : 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: isWinner ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      <span style={{ fontSize: 10.5, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, marginRight: 6 }}>
                        {votes.toLocaleString()}
                      </span>
                      <span style={{ fontSize: 13, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color, minWidth: 44, textAlign: 'right' }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                }) : (
                  <p style={{ fontSize: 11, color: tt.dim, fontStyle: 'italic', margin: '4px 0 4px' }}>
                    No results loaded
                  </p>
                )}
              </div>

              {/* Footer */}
              <div style={{ borderTop: `1px solid ${tt.divider}`, padding: '7px 16px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.dim }}>
                  {tooltip.validVotes.toLocaleString()} votes cast
                </span>
                <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.dim }}>
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

function enforceNoSmooth(geoLayer: L.GeoJSON) {
  geoLayer.eachLayer((layer: L.Layer) => {
    const p = layer as any;
    if (p.options) p.options.smoothFactor = 0;
  });
}

function MapController({ layerRef }: { layerRef: { current: L.GeoJSON | null } }) {
  const map = useMap();
  useEffect(() => {
    const onZoomEnd = () => {
      if (!layerRef.current) return;
      enforceNoSmooth(layerRef.current);
    };
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map, layerRef]);
  return null;
}

function featureStyle(
  feature: any,
  getFill: (gss: string) => string,
  selectedId: string | null,
  selectedIds: Set<string>,
  dark = false,
): L.PathOptions {
  const gss: string = feature?.properties?.gssCode ?? '';
  const isSelected = gss === selectedId;
  const isMulti = selectedIds.has(gss);
  const baseColor = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)';
  const rawFill = getFill(gss);
  return {
    fillColor: dark ? darkModeFill(rawFill) : rawFill,
    weight: isSelected || isMulti ? 2 : 0.5,
    color: isMulti ? '#c8a020' : isSelected ? '#c8a020' : baseColor,
    fillOpacity: 0.72,
    opacity: 1,
  };
}
