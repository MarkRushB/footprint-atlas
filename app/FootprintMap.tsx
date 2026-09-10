'use client';
import { useEffect, useRef, useState } from 'react';
import { COORDINATE_SYSTEM, type LayersList } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import mapboxgl, { type Map as MapboxMap, type GeoJSONSource, type ExpressionSpecification, type FilterSpecification } from 'mapbox-gl';
import { HEAT_COLORS, TIME_COLORS, type Appearance, type Selection } from './track-types';

const SOURCE = 'trace-points', POINTS = 'trace-circles', HEAT = 'trace-density';
const MAP_STYLES = {
  dark: 'mapbox://styles/mapbox/dark-v11', light: 'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12', outdoors: 'mapbox://styles/mapbox/outdoors-v12',
} as const;
type Props = { selection: Selection | null; appearance: Appearance; onReady: (map: MapboxMap) => void; onDataReady: (renderId: number) => void; onError: (message: string) => void };
type BinaryLayerData = { length: number; attributes: Record<string, { value: Float64Array | Uint8Array; size: number }> };
type DataCache = { renderId: number; ground: BinaryLayerData; groundWithTime: BinaryLayerData; flights: BinaryLayerData };

function parseColor(value: string): [number, number, number, number] {
  const hex = value.replace('#', '');
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), 255];
}

function makeCache(selection: Selection): DataCache {
  const position = (value: Float64Array): BinaryLayerData => ({ length: value.length / 2, attributes: { getPosition: { value, size: 2 } } });
  const ground = position(selection.groundPositions);
  return { renderId: selection.renderId, ground, flights: position(selection.flightPositions),
    groundWithTime: { length: selection.groundCount, attributes: { ...ground.attributes, getFillColor: { value: selection.groundColors, size: 4 } } } };
}

function deckPointLayers(selection: Selection | null, appearance: Appearance, cache: DataCache | null, mobile: boolean): LayersList {
  if (!selection || !cache || appearance.mode !== 'points') return [];
  const radius = appearance.radius;
  const common = { coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getPosition: [0, 0] as [number, number], getRadius: radius,
    radiusUnits: 'pixels' as const, radiusMinPixels: radius, radiusMaxPixels: radius * 1.25, opacity: appearance.opacity,
    stroked: false, filled: true, pickable: false, antialiasing: !mobile,
    parameters: { depthWriteEnabled: false, depthCompare: 'always' as const } };
  return [
    new ScatterplotLayer({ id: 'trace-ground-gpu', data: (appearance.colorMode === 'time' ? cache.groundWithTime : cache.ground) as never,
      ...common, visible: appearance.flights !== 'only', getFillColor: parseColor(appearance.pointColor) }),
    new ScatterplotLayer({ id: 'trace-flight-gpu', data: cache.flights as never, ...common,
      visible: appearance.flights !== 'hide', getFillColor: parseColor(appearance.flightColor) }),
  ];
}

export function FootprintMap({ selection, appearance, onReady, onDataReady, onError }: Props) {
  const root = useRef<HTMLDivElement>(null), mapRef = useRef<MapboxMap | null>(null), overlayRef = useRef<MapboxOverlay | null>(null);
  const mobileRef = useRef(false), detailRef = useRef(false), switchingRef = useRef(false);
  const pendingDeckRef = useRef<number | null>(null), hideNativeAfterDeckRef = useRef(false);
  const cacheRef = useRef<DataCache | null>(null), selectionRef = useRef(selection), appearanceRef = useRef(appearance);
  const [styleRevision, setStyleRevision] = useState(0), [hasSource, setHasSource] = useState(false);
  const styleRef = useRef(MAP_STYLES[appearance.mapStyle]);
  const callbacks = useRef({ onReady, onDataReady, onError });
  callbacks.current = { onReady, onDataReady, onError };
  selectionRef.current = selection; appearanceRef.current = appearance;

  useEffect(() => {
    if (!root.current) return;
    mobileRef.current = matchMedia('(pointer: coarse)').matches || innerWidth <= 760;
    setHasSource(false);
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) { callbacks.current.onError('未配置 Mapbox token，请在本地环境配置后重新启动。'); return; }
    let map: MapboxMap;
    try {
      map = new mapboxgl.Map({ accessToken: token, container: root.current, center: [-71.08, 42.36], zoom: 3.2,
        minZoom: 1, maxZoom: 20, maxPitch: 0, projection: 'globe', attributionControl: false, fadeDuration: 0,
        style: styleRef.current, dragRotate: false, touchPitch: false, crossSourceCollisions: false,
        performanceMetricsCollection: false, precompilePrograms: true });
    } catch { callbacks.current.onError('地图无法启动，请确认浏览器支持 WebGL 2。'); return; }
    mapRef.current = map;
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const setNativeVisibility = (points: boolean, heat: boolean) => {
      if (map.getLayer(POINTS)) map.setLayoutProperty(POINTS, 'visibility', points ? 'visible' : 'none');
      if (map.getLayer(HEAT)) map.setLayoutProperty(HEAT, 'visibility', heat ? 'visible' : 'none');
    };
    const applyDeck = (markReady = false) => {
      const current = selectionRef.current, a = appearanceRef.current;
      if (current && (!cacheRef.current || cacheRef.current.renderId !== current.renderId)) cacheRef.current = makeCache(current);
      const active = detailRef.current && a.mode === 'points';
      if (markReady && active && current) pendingDeckRef.current = current.renderId;
      overlay.setProps({ layers: active ? deckPointLayers(current, a, cacheRef.current, mobileRef.current) : [] });
      map.triggerRepaint();
    };
    const overlay = new MapboxOverlay({ interleaved: true, layers: [], pickingRadius: 0,
      onAfterRender: () => {
        if (hideNativeAfterDeckRef.current && detailRef.current && appearanceRef.current.mode === 'points') {
          hideNativeAfterDeckRef.current = false; setNativeVisibility(false, false);
        }
        const renderId = pendingDeckRef.current;
        if (renderId !== null) { pendingDeckRef.current = null; callbacks.current.onDataReady(renderId); }
      },
      onError: error => { console.error(error); callbacks.current.onError('GPU 足迹图层渲染失败，已保留地图原生图层。'); setNativeVisibility(true, false); } });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as mapboxgl.IControl);

    const syncProjection = (force = false) => {
      const detail = detailRef.current ? map.getZoom() > 4.55 : map.getZoom() >= 4.85;
      if (!force && (detail === detailRef.current || switchingRef.current)) return;
      if (detail) {
        map.setProjection('mercator'); detailRef.current = true;
        const a = appearanceRef.current;
        setNativeVisibility(a.mode === 'points', a.mode === 'heat');
        hideNativeAfterDeckRef.current = a.mode === 'points'; applyDeck();
      } else {
        const a = appearanceRef.current;
        setNativeVisibility(a.mode === 'points', a.mode === 'heat');
        if (force) {
          detailRef.current = false; pendingDeckRef.current = null;
          applyDeck(); map.setProjection('globe');
        } else {
          // Let the native Mapbox layer draw one frame before changing projection.
          // This makes the GPU handoff continuous instead of flashing blank.
          switchingRef.current = true; map.triggerRepaint();
          map.once('render', () => {
            detailRef.current = false; pendingDeckRef.current = null;
            applyDeck(); map.setProjection('globe'); switchingRef.current = false; map.triggerRepaint();
          });
        }
      }
    };
    const stage = root.current.closest('.map-stage');
    const moving = () => { stage?.classList.add('map-moving'); syncProjection(); };
    const zoomed = () => syncProjection();
    const moved = () => { stage?.classList.remove('map-moving'); syncProjection(); };
    const styleLoaded = () => {
      syncProjection(true);
      map.setFog({ color: 'rgb(7,9,14)', 'high-color': 'rgb(18,24,38)', 'horizon-blend': .08, 'space-color': 'rgb(3,4,8)', 'star-intensity': .16 });
      setHasSource(false); setStyleRevision(value => value + 1); applyDeck(true); callbacks.current.onReady(map);
    };
    map.on('style.load', styleLoaded); map.on('movestart', moving); map.on('zoom', zoomed); map.on('moveend', moved);
    if (mobileRef.current) map.touchZoomRotate.disableRotation();
    const errorHandler = (event: mapboxgl.ErrorEvent) => { const message = event.error?.message || '';
      if (event.error && !/abort|cancel/i.test(message)) callbacks.current.onError('地图资源加载失败。请检查网络或 Mapbox token 的域名权限。'); };
    map.on('error', errorHandler);
    const observer = new ResizeObserver(() => map.resize()); observer.observe(root.current);
    return () => { observer.disconnect(); stage?.classList.remove('map-moving'); map.off('style.load', styleLoaded);
      map.off('movestart', moving); map.off('zoom', zoomed); map.off('moveend', moved); map.off('error', errorHandler);
      overlayRef.current = null; map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, next = MAP_STYLES[appearance.mapStyle];
    if (!map || next === styleRef.current) return;
    styleRef.current = next; setHasSource(false); map.setStyle(next);
  }, [appearance.mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!styleRevision || !map || !selection) return;
    const url = URL.createObjectURL(selection.blob);
    let finished = false, applied = false, timer = 0;
    const finish = () => { if (finished) return; finished = true;
      if (!(detailRef.current && appearanceRef.current.mode === 'points')) callbacks.current.onDataReady(selection.renderId); };
    const loaded = (event: mapboxgl.MapSourceDataEvent) => { if (applied && event.sourceId === SOURCE && event.sourceDataType === 'content') finish(); };
    const idle = () => { if (applied && map.getSource(SOURCE) && map.isSourceLoaded(SOURCE)) finish(); };
    map.on('sourcedata', loaded); map.on('idle', idle);
    const apply = () => {
      if (applied || map.isMoving()) return;
      applied = true;
      const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (source) source.setData(url);
      else {
        map.addSource(SOURCE, { type: 'geojson', data: url, cluster: false, tolerance: 0, maxzoom: 18, buffer: 128 });
        const before = map.getStyle()?.layers?.find(layer => layer.type === 'symbol')?.id;
        map.addLayer({ id: HEAT, type: 'heatmap', source: SOURCE, layout: { visibility: 'none' }, paint: { 'heatmap-weight': 1, 'heatmap-opacity': .88 } }, before);
        map.addLayer({ id: POINTS, type: 'circle', source: SOURCE, paint: { 'circle-radius': .7, 'circle-color': '#ff5a36',
          'circle-opacity': .85, 'circle-blur': mobileRef.current ? 0 : .2, 'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport' } }, before);
        setHasSource(true);
      }
    };
    const schedule = () => { if (applied || map.isMoving()) return; clearTimeout(timer); timer = window.setTimeout(apply, mobileRef.current ? 100 : 0); };
    map.on('moveend', schedule); schedule();
    return () => { clearTimeout(timer); map.off('moveend', schedule); map.off('sourcedata', loaded); map.off('idle', idle); URL.revokeObjectURL(url); };
  }, [styleRevision, selection]);

  useEffect(() => {
    const map = mapRef.current, overlay = overlayRef.current;
    if (selection && (!cacheRef.current || cacheRef.current.renderId !== selection.renderId)) cacheRef.current = makeCache(selection);
    if (map && overlay && detailRef.current && appearance.mode === 'points') {
      pendingDeckRef.current = selection?.renderId ?? null;
      overlay.setProps({ layers: deckPointLayers(selection, appearance, cacheRef.current, mobileRef.current) }); map.triggerRepaint();
    } else if (overlay) overlay.setProps({ layers: [] });
    if (!hasSource || !map || !map.getLayer(POINTS) || !map.getLayer(HEAT)) return;
    const filter: FilterSpecification | null = appearance.flights === 'show' ? null : ['==', ['get', 'kind'], appearance.flights === 'only' ? 'flight' : 'ground'];
    map.setFilter(POINTS, filter); map.setFilter(HEAT, filter);
    const timeColor: ExpressionSpecification = ['match', ['get', 'bucket'], 0, TIME_COLORS[0], 1, TIME_COLORS[1], 2, TIME_COLORS[2], 3, TIME_COLORS[3], TIME_COLORS[4]];
    map.setPaintProperty(POINTS, 'circle-color', ['case', ['==', ['get', 'kind'], 'flight'], appearance.flightColor, appearance.colorMode === 'time' ? timeColor : appearance.pointColor]);
    map.setPaintProperty(POINTS, 'circle-radius', ['interpolate', ['linear'], ['zoom'], 1, Math.max(.35, appearance.radius * .5), 4.85, appearance.radius, 18, appearance.radius * 1.25]);
    map.setPaintProperty(POINTS, 'circle-opacity', appearance.opacity);
    map.setLayoutProperty(POINTS, 'visibility', appearance.mode === 'points' && !detailRef.current ? 'visible' : 'none');
    map.setLayoutProperty(HEAT, 'visibility', appearance.mode === 'heat' ? 'visible' : 'none');
    const ramp = HEAT_COLORS[appearance.heatPalette];
    map.setPaintProperty(HEAT, 'heatmap-color', ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', .08, ramp[0], .25, ramp[1], .5, ramp[2], .75, ramp[3], 1, ramp[4]]);
    map.setPaintProperty(HEAT, 'heatmap-radius', appearance.heatRadius);
    map.setPaintProperty(HEAT, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 1, .035 * appearance.heatIntensity, 8, .12 * appearance.heatIntensity, 13, .5 * appearance.heatIntensity, 18, appearance.heatIntensity]);
  }, [appearance, selection, hasSource]);

  return <div ref={root} className="map-host" aria-label="使用 GPU 渲染的可旋转 Mapbox 三维足迹地球" />;
}
