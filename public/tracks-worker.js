import { validateData, selectPoints, combineSelections, makeCombinedHeatData } from './track-engine.mjs';

let meta, activeRevision = 0;
const cache = new Map();
const asset = path => new URL(path.replace(/^\/+/, ''), self.location.href);

async function fetchBuffer(shard) {
  if (cache.has(shard.year)) return cache.get(shard.year);
  const promise = (async () => {
    const compressed = typeof DecompressionStream !== 'undefined' && shard.compressedBinary;
    const response = await fetch(asset(compressed || shard.binary), { cache: 'force-cache' });
    if (!response.ok) throw new Error(`无法加载 ${shard.year} 年足迹数据。`);
    const downloaded = await response.arrayBuffer();
    const signature = new Uint8Array(downloaded, 0, Math.min(2, downloaded.byteLength));
    const buffer = compressed && signature[0] === 0x1f && signature[1] === 0x8b
      ? await new Response(new Blob([downloaded]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      : downloaded;
    return validateData(buffer, { ...meta, count: shard.count });
  })();
  cache.set(shard.year, promise);
  try { return await promise; } catch (error) { cache.delete(shard.year); throw error; }
}

const initial = (async () => {
  const response = await fetch(asset('track-meta-v3.json'), { cache: 'no-cache' });
  if (!response.ok) throw new Error('无法加载数据索引。');
  meta = await response.json();
  if (meta.version !== 3 || !Array.isArray(meta.shards) || !meta.shards.length ||
      meta.shards.reduce((sum, shard) => sum + shard.count, 0) !== meta.count) throw new Error('年度数据索引不完整。');
  self.postMessage({ type: 'ready', meta });
})();
initial.catch(error => self.postMessage({ type: 'error', message: error.message || '数据下载失败，请重新加载。' }));

function relevantShards(options) {
  const start = options.start ? Date.parse(`${options.start}T00:00:00Z`) / 1000 : meta.minTime;
  const end = options.end ? Date.parse(`${options.end}T00:00:00Z`) / 1000 + 86400 : meta.maxTime + 1;
  return meta.shards.filter(shard => shard.maxTime >= start && shard.minTime < end).sort((a, b) => b.year - a.year);
}

function postSelection(revision, options, parts, shards, targetCount, complete, begun) {
  const stats = combineSelections(parts);
  const blob = new Blob([JSON.stringify(makeCombinedHeatData(parts))], { type: 'application/json' });
  self.postMessage({ type: 'selection', revision, renderId: revision * 2 + (complete ? 1 : 0), ...stats, blob,
    complete, loadedShards: shards.length, totalShards: targetCount,
    loadedPoints: shards.reduce((sum, shard) => sum + shard.count, 0),
    totalPoints: relevantShards(options).reduce((sum, shard) => sum + shard.count, 0),
    milliseconds: performance.now() - begun });
}

self.onmessage = async ({ data }) => {
  try {
    await initial;
    if (data.type !== 'select') return;
    activeRevision = data.revision;
    const begun = performance.now(), targets = relevantShards(data.options);
    if (!targets.length) {
      postSelection(data.revision, data.options, [], [], 0, true, begun);
      return;
    }
    const first = targets[0], firstView = await fetchBuffer(first);
    if (activeRevision !== data.revision) return;
    const firstPart = selectPoints(firstView, { ...meta, count: first.count }, data.options);
    if (targets.length === 1) postSelection(data.revision, data.options, [firstPart], [first], 1, true, begun);
    else {
      postSelection(data.revision, data.options, [firstPart], [first], targets.length, false, begun);
      const restViews = await Promise.all(targets.slice(1).map(fetchBuffer));
      if (activeRevision !== data.revision) return;
      const parts = [firstPart, ...restViews.map((view, index) => selectPoints(view, { ...meta, count: targets[index + 1].count }, data.options))];
      postSelection(data.revision, data.options, parts, targets, targets.length, true, begun);
    }
  } catch (error) {
    if (activeRevision === data.revision) self.postMessage({ type: 'error', revision: data.revision, message: error.message || '足迹加载失败。' });
  }
};
