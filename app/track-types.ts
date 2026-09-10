export type TrackMeta = {
  version: number; count: number; byteLength: number; binary: string; sourceSha256: string;
  compressedByteLength: number;
  stride: number; scale: number; valueScale: number; missing: number;
  minTime: number; maxTime: number; minLon: number; minLat: number; maxLon: number; maxLat: number;
  minAltitude: number; maxAltitude: number; missingAltitude: number; missingSpeed: number;
  days: { date: string; count: number }[];
  shards?: { year: number; count: number; byteLength: number; binary: string; compressedBinary: string; compressedByteLength: number; minTime: number; maxTime: number }[];
};
export type Filters = { start: string; end: string; altitude: number; speedAssist: boolean; speed: number };
export type Appearance = {
  mode: 'points' | 'heat'; colorMode: 'time' | 'solid'; pointColor: string; flightColor: string;
  radius: number; opacity: number; heatRadius: number; heatIntensity: number;
  heatPalette: 'aurora' | 'ember' | 'ocean'; flights: 'show' | 'hide' | 'only';
  mapStyle: 'dark' | 'light' | 'satellite' | 'outdoors';
};
export type Selection = {
  revision: number; renderId: number; count: number; groundCount: number; flightCount: number; days: number;
  groundDays: number; flightDays: number;
  unknownAltitude: number; bounds: [number, number, number, number] | null; milliseconds: number; blob: Blob;
  groundPositions: Float64Array; groundColors: Uint8Array; flightPositions: Float64Array;
  groundBounds: [number, number, number, number] | null; flightBounds: [number, number, number, number] | null;
  complete: boolean; loadedShards: number; totalShards: number; loadedPoints: number; totalPoints: number;
};
export const DEFAULT_FILTERS: Filters = { start: '', end: '', altitude: 2000, speedAssist: true, speed: 55 };
export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'points', colorMode: 'time', pointColor: '#ff5a36', flightColor: '#ffd166', radius: 1.4,
  opacity: 0.85, heatRadius: 14, heatIntensity: 1, heatPalette: 'aurora', flights: 'show', mapStyle: 'dark',
};
export const HEAT_COLORS = {
  aurora: ['#2b3a96', '#6646cc', '#d448a0', '#ff715e', '#ffd76a'],
  ember: ['#63235f', '#b73262', '#e95040', '#ff963b', '#ffe28a'],
  ocean: ['#142d6b', '#225fb4', '#29a8cd', '#64dbc5', '#e6ffb0'],
};
export const TIME_COLORS = ['#4465ff', '#725dff', '#a950ed', '#e447ad', '#ff5a36'];
