import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

// Split the packed archive by UTC year without sampling or changing a record.
const directory = process.argv[2] || 'public';
const sourceMeta = JSON.parse(fs.readFileSync(path.join(directory, 'track-meta-v2.json'), 'utf8'));
const source = fs.readFileSync(path.join(directory, sourceMeta.binary.replace(/^\/+/, '')));
if (source.byteLength !== sourceMeta.count * 20) throw new Error('Source binary size does not match its manifest.');

const recordsByYear = new Map();
for (let offset = 0; offset < source.byteLength; offset += 20) {
  const year = new Date(source.readUInt32LE(offset) * 1000).getUTCFullYear();
  let records = recordsByYear.get(year);
  if (!records) recordsByYear.set(year, records = []);
  records.push(source.subarray(offset, offset + 20));
}

const shards = [];
for (const [year, records] of [...recordsByYear].sort(([a], [b]) => a - b)) {
  const data = Buffer.concat(records);
  const filename = `tracks-v3-${sourceMeta.sourceSha256.slice(0, 12)}-${year}.bin`;
  const compressedFilename = `${filename}.gz`;
  const compressed = gzipSync(data, { level: 9 });
  fs.writeFileSync(path.join(directory, filename), data);
  fs.writeFileSync(path.join(directory, compressedFilename), compressed);
  let minTime = Infinity, maxTime = -Infinity;
  for (let offset = 0; offset < data.byteLength; offset += 20) {
    const time = data.readUInt32LE(offset);
    minTime = Math.min(minTime, time); maxTime = Math.max(maxTime, time);
  }
  shards.push({ year, count: records.length, byteLength: data.byteLength, binary: `/${filename}`,
    compressedBinary: `/${compressedFilename}`, compressedByteLength: compressed.byteLength, minTime, maxTime });
}

const count = shards.reduce((sum, shard) => sum + shard.count, 0);
if (count !== sourceMeta.count) throw new Error(`Shard audit failed: ${count} !== ${sourceMeta.count}`);
const meta = { ...sourceMeta, version: 3, binary: undefined, compressedBinary: undefined,
  compressedByteLength: shards.reduce((sum, shard) => sum + shard.compressedByteLength, 0), shards };
fs.writeFileSync(path.join(directory, 'track-meta-v3.json'), JSON.stringify(meta));
console.log(JSON.stringify({ count, years: shards.map(({ year, count, compressedByteLength }) => ({ year, count, compressedByteLength })),
  compressedByteLength: meta.compressedByteLength }, null, 2));
