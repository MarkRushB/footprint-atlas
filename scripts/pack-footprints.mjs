import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';

// Derived display data only. Never modifies the source CSV or drops valid rows.
const input = process.argv[2];
const directory = process.argv[3] || 'public';
if (!input) throw new Error('Usage: node scripts/pack-footprints.mjs input.csv [output-directory]');
const hash = createHash('sha256');
for await (const chunk of fs.createReadStream(input)) hash.update(chunk);
const sourceSha256 = hash.digest('hex');
fs.mkdirSync(directory, { recursive: true });
const filename = `tracks-v2-${sourceSha256.slice(0, 12)}.bin`;
const writer = fs.createWriteStream(path.join(directory, filename));
const reader = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
const missing = -2147483648;
let headers, count = 0, missingAltitude = 0, missingSpeed = 0;
let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90, minTime = Infinity, maxTime = -Infinity;
let minAltitude = Infinity, maxAltitude = -Infinity;
const days = new Map();
let buffer = Buffer.allocUnsafe(20 * 8192), offset = 0;
async function flush() {
  if (!offset) return;
  if (!writer.write(buffer.subarray(0, offset))) await once(writer, 'drain');
  buffer = Buffer.allocUnsafe(20 * 8192); offset = 0;
}
function scaled(value, scale, optional = false) {
  if (optional && (value === '' || value === undefined || !Number.isFinite(Number(value)))) return missing;
  const number = Number(value), integer = Math.round(number * scale);
  if (value === '' || !Number.isFinite(number) || Math.abs(integer / scale - number) > 1e-8 || integer <= missing || integer > 2147483647) {
    throw new Error(`Unrepresentable field at CSV row ${count + 2}: ${value}`);
  }
  return integer;
}
for await (const line of reader) {
  if (!headers) {
    headers = line.replace(/^\uFEFF/, '').split(',');
    for (const name of ['timestamp','longitude','latitude','altitude','speed']) if (!headers.includes(name)) throw new Error(`Missing column ${name}`);
    continue;
  }
  if (!line.trim()) continue;
  const fields = line.split(','), get = name => fields[headers.indexOf(name)];
  const time = scaled(get('timestamp'), 1), lon = scaled(get('longitude'), 1e6), lat = scaled(get('latitude'), 1e6);
  if (time < 0 || Math.abs(lon) > 180e6 || Math.abs(lat) > 90e6) throw new Error(`Invalid GPS row ${count + 2}`);
  const altitude = scaled(get('altitude'), 1000, true), speed = scaled(get('speed'), 1000, true);
  buffer.writeUInt32LE(time, offset); buffer.writeInt32LE(lon, offset + 4); buffer.writeInt32LE(lat, offset + 8);
  buffer.writeInt32LE(altitude, offset + 12); buffer.writeInt32LE(speed, offset + 16);
  offset += 20; count++;
  minLon = Math.min(minLon, lon / 1e6); maxLon = Math.max(maxLon, lon / 1e6);
  minLat = Math.min(minLat, lat / 1e6); maxLat = Math.max(maxLat, lat / 1e6);
  minTime = Math.min(minTime, time); maxTime = Math.max(maxTime, time);
  if (altitude === missing) missingAltitude++;
  else { minAltitude = Math.min(minAltitude, altitude / 1000); maxAltitude = Math.max(maxAltitude, altitude / 1000); }
  if (speed === missing || speed < 0) missingSpeed++;
  const day = new Date(time * 1000).toISOString().slice(0, 10);
  days.set(day, (days.get(day) || 0) + 1);
  if (offset === buffer.length) await flush();
}
await flush(); writer.end(); await once(writer, 'finish');
const compressed = gzipSync(fs.readFileSync(path.join(directory, filename)), { level: 9 });
fs.writeFileSync(path.join(directory, filename + '.gz'), compressed);
const meta = { version: 2, count, byteLength: count * 20, binary: `/${filename}`, sourceSha256,
  compressedBinary: `/${filename}.gz`, compressedByteLength: compressed.byteLength,
  stride: 5, scale: 1e6, valueScale: 1000, missing, minLon, maxLon, minLat, maxLat,
  minTime, maxTime, minAltitude, maxAltitude, missingAltitude, missingSpeed,
  timezone: 'UTC', days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })) };
fs.writeFileSync(path.join(directory, 'track-meta-v2.json'), JSON.stringify(meta));
console.log(JSON.stringify({ count, bytes: meta.byteLength, days: days.size, minAltitude, maxAltitude, missingAltitude, missingSpeed, filename }));
