'use client';
import { useEffect, useRef, useState } from 'react';
import mapboxgl, { type Map as MapboxMap, type GeoJSONSource, type ExpressionSpecification, type FilterSpecification } from 'mapbox-gl';
import { HEAT_COLORS, TIME_COLORS, type Appearance, type Selection } from './track-types';

const SOURCE = 'trace-points', POINTS = 'trace-circles', HEAT = 'trace-density';
const MAP_STYLES = {
  dark: 'mapbox://styles/mapbox/dark-v11', light: 'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12', outdoors: 'mapbox://styles/mapbox/outdoors-v12',
} as const;
type Props = { selection: Selection | null; appearance: Appearance; onReady: (map: MapboxMap) => void; onDataReady: (revision: number) => void; onError: (message: string) => void };

export function FootprintMap({ selection, appearance, onReady, onDataReady, onError }: Props) {
  const root = useRef<HTMLDivElement>(null), mapRef = useRef<MapboxMap | null>(null);
  const [styleRevision, setStyleRevision] = useState(0), [hasSource, setHasSource] = useState(false);
  const styleRef = useRef(MAP_STYLES[appearance.mapStyle]);
  const callbacks = useRef({ onReady, onDataReady, onError });
  callbacks.current = { onReady, onDataReady, onError };

  // Map lifetime is independent of dates, colors and data. Camera/GPU tile buffers survive UI changes.
  useEffect(() => {
    if (!root.current) return;
    setHasSource(false);
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) { callbacks.current.onError('未配置 Mapbox token，请在本地环境配置后重新启动。'); return; }
    let map: MapboxMap;
    try {
      map = new mapboxgl.Map({
        accessToken: token, container: root.current, center: [-71.08, 42.36], zoom: 3.2,
        minZoom: 1, maxZoom: 20, projection: 'globe', attributionControl: false,
        fadeDuration: 0, style: styleRef.current,
      });
    } catch { callbacks.current.onError('地图无法启动，请确认浏览器支持 WebGL。'); return; }
    mapRef.current = map;
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    const styleLoaded = () => {
      map.setFog({ color: 'rgb(7,9,14)', 'high-color': 'rgb(18,24,38)', 'horizon-blend': .08, 'space-color': 'rgb(3,4,8)', 'star-intensity': .16 });
      setHasSource(false);
      setStyleRevision(value => value + 1);
      callbacks.current.onReady(map);
    };
    map.on('style.load', styleLoaded);
    const errorHandler = (event: mapboxgl.ErrorEvent) => {
      const message = event.error?.message || '';
      if (event.error && !/abort|cancel/i.test(message)) callbacks.current.onError('地图资源加载失败。请检查网络或 Mapbox token 的域名权限。');
    };
    map.on('error', errorHandler);
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(root.current);
    return () => { observer.disconnect(); map.off('style.load', styleLoaded); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, next = MAP_STYLES[appearance.mapStyle];
    if (!map || next === styleRef.current) return;
    styleRef.current = next;
    setHasSource(false);
    map.setStyle(next);
  }, [appearance.mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    // styleRevision only changes after style.load, so a second isStyleLoaded check can
    // race with late style bookkeeping and leave runtime layers permanently absent.
    if (!styleRevision || !map || !selection) return;
    // Mapbox's own worker fetches and parses this Blob. No giant JSON object on the UI thread.
    const url = URL.createObjectURL(selection.blob);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      callbacks.current.onDataReady(selection.revision);
    };
    const loaded = (event: mapboxgl.MapSourceDataEvent) => {
      // "content" means the new GeoJSON has reached Mapbox's source worker.
      // isSourceLoaded can remain false while unrelated globe tiles are still loading.
      if (event.sourceId === SOURCE && event.sourceDataType === 'content') finish();
    };
    const idle = () => {
      if (map.getSource(SOURCE) && map.isSourceLoaded(SOURCE)) finish();
    };
    map.on('sourcedata', loaded);
    map.on('idle', idle);
    const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (source) source.setData(url);
    else {
      map.addSource(SOURCE, { type: 'geojson', data: url, cluster: false, tolerance: 0, maxzoom: 18, buffer: 128 });
      const before = map.getStyle()?.layers?.find(layer => layer.type === 'symbol')?.id;
      map.addLayer({ id: HEAT, type: 'heatmap', source: SOURCE, layout: { visibility: 'none' },
        paint: { 'heatmap-weight': 1, 'heatmap-opacity': .88 } }, before);
      map.addLayer({ id: POINTS, type: 'circle', source: SOURCE,
        paint: { 'circle-radius': 1.4, 'circle-color': '#ff5a36', 'circle-opacity': .85,
          'circle-blur': .25, 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'viewport' } }, before);
      setHasSource(true);
    }
    return () => { map.off('sourcedata', loaded); map.off('idle', idle); URL.revokeObjectURL(url); };
  }, [styleRevision, selection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!hasSource || !map || !map.getLayer(POINTS) || !map.getLayer(HEAT)) return;
    const a = appearance;
    const filter: FilterSpecification | null = a.flights === 'show' ? null :
      ['==', ['get', 'kind'], a.flights === 'only' ? 'flight' : 'ground'];
    map.setFilter(POINTS, filter); map.setFilter(HEAT, filter);
    const timeColor: ExpressionSpecification = ['match', ['get', 'bucket'], 0, TIME_COLORS[0], 1, TIME_COLORS[1], 2, TIME_COLORS[2], 3, TIME_COLORS[3], TIME_COLORS[4]];
    map.setPaintProperty(POINTS, 'circle-color', ['case', ['==', ['get', 'kind'], 'flight'], a.flightColor, a.colorMode === 'time' ? timeColor : a.pointColor]);
    map.setPaintProperty(POINTS, 'circle-radius', ['interpolate', ['linear'], ['zoom'], 1, a.radius, 18, a.radius * 1.25]);
    map.setPaintProperty(POINTS, 'circle-opacity', a.opacity);
    map.setLayoutProperty(POINTS, 'visibility', a.mode === 'points' ? 'visible' : 'none');
    map.setLayoutProperty(HEAT, 'visibility', a.mode === 'heat' ? 'visible' : 'none');
    const ramp = HEAT_COLORS[a.heatPalette];
    map.setPaintProperty(HEAT, 'heatmap-color', ['interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(0,0,0,0)', .08, ramp[0], .25, ramp[1], .5, ramp[2], .75, ramp[3], 1, ramp[4]]);
    map.setPaintProperty(HEAT, 'heatmap-radius', a.heatRadius);
    map.setPaintProperty(HEAT, 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'],
      1, .035 * a.heatIntensity, 8, .12 * a.heatIntensity, 13, .5 * a.heatIntensity, 18, a.heatIntensity]);
  }, [appearance, hasSource]);

  return <div ref={root} className="map-host" aria-label="可旋转的 Mapbox 三维足迹地球" />;
}
