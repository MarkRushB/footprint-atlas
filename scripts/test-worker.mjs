import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const origin = process.argv[2] || 'http://localhost:3000';
  try { return await nativeFetch(new URL(url, origin), options); }
  catch (error) {
    if (process.argv[2]) throw error;
    return nativeFetch(new URL(url, 'http://[::1]:3000'), options);
  }
};
const started = performance.now();
const result = new Promise((resolve, reject) => {
  globalThis.self = { postMessage: async message => {
    try {
      if (message.type === 'error') throw new Error(message.message);
      if (message.type === 'ready') {
        assert.equal(message.meta.count, 791220);
        self.onmessage({ data: { type:'select', revision:1, options: { start:'',end:'',altitude:2000,speedAssist:true,speed:55 } } });
      }
      if (message.type === 'selection') {
        assert.equal(message.count,791220);
        const data = JSON.parse(await message.blob.text());
        assert.equal(data.features.reduce((sum,feature)=>sum+feature.geometry.coordinates.length,0),791220);
        assert.equal(data.features.filter(feature=>feature.properties.kind==='flight')[0].geometry.coordinates.length,message.flightCount);
        resolve({ passed:true, points:message.count, workerMs:Math.round(message.milliseconds), totalMs:Math.round(performance.now()-started), featureGroups:data.features.length });
      }
    } catch(error) { reject(error); }
  } };
});
await import('../public/tracks-worker.js');
console.log(JSON.stringify(await result));
