import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const nativeFetch = globalThis.fetch;
const origin = process.argv[2] || 'http://localhost:3000';
globalThis.fetch = async (url, options) => {
  try { return await nativeFetch(new URL(url, origin), options); }
  catch (error) {
    if (process.argv[2]) throw error;
    return nativeFetch(new URL(url, 'http://[::1]:3000'), options);
  }
};
const started = performance.now();
const result = new Promise((resolve, reject) => {
  globalThis.self = { location: { href: new URL('tracks-worker.js', origin).href }, postMessage: async message => {
    try {
      if (message.type === 'error') throw new Error(message.message);
      if (message.type === 'ready') {
        assert.equal(message.meta.count, 791220);
        self.onmessage({ data: { type:'select', revision:1, options: { start:'',end:'',altitude:2000,speedAssist:true,speed:55 } } });
      }
      if (message.type === 'selection' && message.complete) {
        assert.equal(message.count,791220);
        assert.equal(message.groundPositions.length,message.groundCount*2);
        assert.equal(message.groundColors.length,message.groundCount*4);
        assert.equal(message.flightPositions.length,message.flightCount*2);
        assert(message.groundColors.some(value=>value>0));
        resolve({ passed:true, points:message.count, workerMs:Math.round(message.milliseconds), totalMs:Math.round(performance.now()-started), binaryMiB:+((message.groundPositions.byteLength+message.groundColors.byteLength+message.flightPositions.byteLength)/1024/1024).toFixed(2) });
      }
    } catch(error) { reject(error); }
  } };
});
await import('../public/tracks-worker.js');
console.log(JSON.stringify(await result));
