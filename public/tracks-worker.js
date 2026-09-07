import { validateData, selectPoints, makeHeatData } from './track-engine.mjs';
let view, meta;
const initial = (async () => {
  const asset = path => new URL(path.replace(/^\/+/, ''), self.location.href);
  const response = await fetch(asset('track-meta-v2.json'), { cache: 'no-cache' });
  if (!response.ok) throw new Error('无法加载数据索引。');
  meta = await response.json();
  const compressed = typeof DecompressionStream !== 'undefined' && meta.compressedBinary;
  const data = await fetch(asset(compressed || meta.binary), { cache: 'force-cache' });
  if (!data.ok) throw new Error('无法加载足迹数据。');
  // Some hosts serve .gz with Content-Encoding, so fetch has already decompressed it.
  // Inspect the bytes to prevent double decompression on Vite and different CDNs.
  const downloaded = await data.arrayBuffer(), signature = new Uint8Array(downloaded, 0, Math.min(2, downloaded.byteLength));
  const buffer = compressed && signature[0] === 0x1f && signature[1] === 0x8b
    ? await new Response(new Blob([downloaded]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : downloaded;
  view = validateData(buffer, meta);
  self.postMessage({ type: 'ready', meta });
})();
initial.catch(error => self.postMessage({ type: 'error', message: error.message || '数据下载或解压失败，请重新加载。' }));
self.onmessage = async ({ data }) => {
  try {
    await initial;
    if (data.type === 'select') {
      const begun = performance.now();
      const result = selectPoints(view, meta, data.options);
      const { ground, flights, colors, ...stats } = result;
      // Blob cloning is cheap: JSON construction and Mapbox parsing stay off the UI thread.
      const blob = new Blob([JSON.stringify(makeHeatData(result))], { type: 'application/json' });
      self.postMessage({ type: 'selection', revision: data.revision, ...stats, blob, milliseconds: performance.now() - begun });
    }
  } catch (error) { self.postMessage({ type: 'error', revision: data.revision, message: error.message }); }
};
