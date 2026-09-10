export const PALETTE = [[97,233,255,235],[123,131,255,235],[179,104,255,240],[255,79,180,245],[255,135,200,240]];

export function validateData(buffer, meta) {
  if (![2, 3].includes(meta.version) || meta.stride !== 5 || buffer.byteLength !== meta.count * 20) throw new Error('数据包版本或条数不匹配，请重新加载。');
  return new DataView(buffer);
}

export function isFlight(view, offset, meta, options) {
  const altitude = view.getInt32(offset + 12, true), speed = view.getInt32(offset + 16, true);
  // Recorded altitude is NOT height above ground. This is an explicit heuristic.
  return altitude !== meta.missing && altitude / meta.valueScale >= options.altitude &&
    (!options.speedAssist || (speed !== meta.missing && speed / meta.valueScale >= options.speed));
}

export function selectPoints(view, meta, options) {
  const start = options.start ? Date.parse(`${options.start}T00:00:00Z`) / 1000 : meta.minTime;
  const end = options.end ? Date.parse(`${options.end}T00:00:00Z`) / 1000 + 86400 : meta.maxTime + 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('开始日期不能晚于结束日期。');
  let groundCount = 0, flightCount = 0;
  for (let i = 0; i < meta.count; i++) {
    const offset = i * 20, time = view.getUint32(offset, true);
    if (time < start || time >= end) continue;
    if (isFlight(view, offset, meta, options)) flightCount++; else groundCount++;
  }
  const ground = new Float64Array(groundCount * 2), flights = new Float64Array(flightCount * 2);
  const colors = new Uint8Array(groundCount * 4);
  let g = 0, f = 0, unknownAltitude = 0;
  const bounds = [180, 90, -180, -90], days = new Set();
  const groundDays = new Set(), flightDays = new Set();
  const groundBounds = [180, 90, -180, -90], flightBounds = [180, 90, -180, -90];
  for (let i = 0; i < meta.count; i++) {
    const offset = i * 20, time = view.getUint32(offset, true);
    if (time < start || time >= end) continue;
    const lon = view.getInt32(offset + 4, true) / meta.scale, lat = view.getInt32(offset + 8, true) / meta.scale;
    bounds[0] = Math.min(bounds[0], lon); bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lon); bounds[3] = Math.max(bounds[3], lat);
    days.add(Math.floor(time / 86400));
    if (view.getInt32(offset + 12, true) === meta.missing) unknownAltitude++;
    const flight = isFlight(view, offset, meta, options), groupBounds = flight ? flightBounds : groundBounds;
    (flight ? flightDays : groundDays).add(Math.floor(time / 86400));
    groupBounds[0] = Math.min(groupBounds[0], lon); groupBounds[1] = Math.min(groupBounds[1], lat);
    groupBounds[2] = Math.max(groupBounds[2], lon); groupBounds[3] = Math.max(groupBounds[3], lat);
    if (flight) { flights[f++] = lon; flights[f++] = lat; }
    else {
      const colorIndex = Math.min(4, Math.floor((time - meta.minTime) / Math.max(1, meta.maxTime - meta.minTime) * 5));
      colors.set(PALETTE[colorIndex], g * 2);
      ground[g++] = lon; ground[g++] = lat;
    }
  }
  return { ground, flights, colors, groundCount, flightCount, count: groundCount + flightCount, days: days.size, unknownAltitude,
    groundDays: groundDays.size, flightDays: flightDays.size,
    bounds: groundCount + flightCount ? bounds : null, groundBounds: groundCount ? groundBounds : null, flightBounds: flightCount ? flightBounds : null };
}

export function makeHeatData(result) {
  // Six MultiPoints, not 791k feature/property objects. No clustering or sampling.
  // Both native circles and heatmap consume this same source, including duplicates.
  const groups = Array.from({ length: 6 }, () => []);
  for (let i = 0; i < result.groundCount; i++) {
    const bucket = PALETTE.findIndex(color => color[0] === result.colors[i * 4]);
    groups[bucket].push([result.ground[i * 2], result.ground[i * 2 + 1]]);
  }
  for (let i = 0; i < result.flightCount; i++) groups[5].push([result.flights[i * 2], result.flights[i * 2 + 1]]);
  const features = groups.flatMap((coordinates, bucket) => coordinates.length ? [{ type: 'Feature',
    properties: { kind: bucket === 5 ? 'flight' : 'ground', bucket }, geometry: { type: 'MultiPoint', coordinates } }] : []);
  return { type: 'FeatureCollection', features };
}

export function combineSelections(parts) {
  const sum = key => parts.reduce((total, part) => total + part[key], 0);
  const mergeBounds = key => {
    const values = parts.map(part => part[key]).filter(Boolean);
    return values.length ? [Math.min(...values.map(value => value[0])), Math.min(...values.map(value => value[1])),
      Math.max(...values.map(value => value[2])), Math.max(...values.map(value => value[3]))] : null;
  };
  return { count: sum('count'), groundCount: sum('groundCount'), flightCount: sum('flightCount'), days: sum('days'),
    groundDays: sum('groundDays'), flightDays: sum('flightDays'), unknownAltitude: sum('unknownAltitude'),
    bounds: mergeBounds('bounds'), groundBounds: mergeBounds('groundBounds'), flightBounds: mergeBounds('flightBounds') };
}

export function combineBinarySelections(parts) {
  const groundCount = parts.reduce((total, part) => total + part.groundCount, 0);
  const flightCount = parts.reduce((total, part) => total + part.flightCount, 0);
  const groundPositions = new Float64Array(groundCount * 2);
  const groundColors = new Uint8Array(groundCount * 4);
  const flightPositions = new Float64Array(flightCount * 2);
  let groundOffset = 0, colorOffset = 0, flightOffset = 0;
  for (const part of parts) {
    groundPositions.set(part.ground, groundOffset);
    groundColors.set(part.colors, colorOffset);
    flightPositions.set(part.flights, flightOffset);
    groundOffset += part.ground.length;
    colorOffset += part.colors.length;
    flightOffset += part.flights.length;
  }
  return { groundPositions, groundColors, flightPositions };
}

export function makeCombinedHeatData(parts) {
  const groups = Array.from({ length: 6 }, () => []);
  for (const result of parts) {
    for (let i = 0; i < result.groundCount; i++) {
      const bucket = PALETTE.findIndex(color => color[0] === result.colors[i * 4]);
      groups[bucket].push([result.ground[i * 2], result.ground[i * 2 + 1]]);
    }
    for (let i = 0; i < result.flightCount; i++) groups[5].push([result.flights[i * 2], result.flights[i * 2 + 1]]);
  }
  const features = groups.flatMap((coordinates, bucket) => coordinates.length ? [{ type: 'Feature',
    properties: { kind: bucket === 5 ? 'flight' : 'ground', bucket }, geometry: { type: 'MultiPoint', coordinates } }] : []);
  return { type: 'FeatureCollection', features };
}
