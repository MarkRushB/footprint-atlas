import assert from 'node:assert/strict';
import fs from 'node:fs';
import readline from 'node:readline';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { validateData, selectPoints, makeHeatData, isFlight } from '../public/track-engine.mjs';

const meta = JSON.parse(fs.readFileSync('public/track-meta-v2.json','utf8'));
const buffer = fs.readFileSync('public' + meta.binary);
const view = validateData(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength), meta);
assert.equal(meta.count,791220);
assert.equal(meta.days.reduce((total,day)=>total+day.count,0),meta.count);
assert.deepEqual(gunzipSync(fs.readFileSync('public'+meta.compressedBinary)), buffer);
assert.throws(()=>validateData(new ArrayBuffer(8), meta));
const options = {start:'',end:'',altitude:2000,speedAssist:true,speed:55};
const started = performance.now();
const all = selectPoints(view, meta, options);
const elapsed = performance.now()-started;
assert.equal(all.count, meta.count);
assert.equal(all.groundCount+all.flightCount,meta.count);
const geojson = makeHeatData(all);
assert.equal(geojson.features.reduce((total,feature)=>total+feature.geometry.coordinates.length,0),meta.count);
assert(geojson.features.every(feature=>feature.geometry.type==='MultiPoint'));
const altitudeOnly = selectPoints(view,meta,{...options,speedAssist:false});
assert(altitudeOnly.flightCount>=all.flightCount);
const higher = selectPoints(view,meta,{...options,altitude:10000});
assert(higher.flightCount<=all.flightCount);
const first = meta.days[0], last = meta.days.at(-1), middle = meta.days[Math.floor(meta.days.length/2)];
for (const item of [first,middle,last]) {
  assert.equal(selectPoints(view,meta,{...options,start:item.date,end:item.date}).count,item.count);
}
assert.equal(selectPoints(view,meta,{...options,start:'2000-01-01',end:'2000-01-01'}).count,0);
assert.throws(()=>selectPoints(view,meta,{...options,start:last.date,end:first.date}));
// Exact midnight boundary and unknown altitude/speed: unknown points must stay in ground.
const fixture = new ArrayBuffer(60), sample = new DataView(fixture);
const midnight=Date.parse('2024-01-02T00:00:00Z')/1000;
for(let i=0;i<3;i++) {sample.setUint32(i*20,midnight+i-1,true);sample.setInt32(i*20+12,3000000,true);sample.setInt32(i*20+16,100000,true);}
const sampleMeta={...meta,count:3,minTime:midnight-1,maxTime:midnight+1};
assert.equal(selectPoints(sample,sampleMeta,{...options,start:'2024-01-01',end:'2024-01-01'}).count,1);
assert.equal(selectPoints(sample,sampleMeta,{...options,start:'2024-01-02',end:'2024-01-02'}).count,2);
sample.setInt32(12,meta.missing,true);
assert.equal(isFlight(sample,0,sampleMeta,options),false);
sample.setInt32(12,3000000,true);sample.setInt32(16,-1000,true);
assert.equal(isFlight(sample,0,sampleMeta,options),false);
assert.equal(isFlight(sample,0,sampleMeta,{...options,speedAssist:false}),true);

// Optional full source audit verifies each row, including repeated coordinates and ordering.
if(process.argv[2]) {
  const input=readline.createInterface({input:fs.createReadStream(process.argv[2]),crlfDelay:Infinity});
  let headers, index=0;
  for await(const line of input) {
    if(!headers){headers=line.replace(/^\uFEFF/,'').split(',');continue;}
    if(!line.trim())continue;
    const values=line.split(',');
    for(const [name,offset,scale] of [['timestamp',0,1],['longitude',4,1e6],['latitude',8,1e6],['altitude',12,1000],['speed',16,1000]]) {
      const value=values[headers.indexOf(name)];
      const expected=value===''||!Number.isFinite(Number(value))?meta.missing:Math.round(Number(value)*scale);
      assert.equal(view.getInt32(index*20+offset,true),expected,`row ${index+2} ${name}`);
    }
    index++;
  }
  assert.equal(index,meta.count);
}
console.log(JSON.stringify({passed:true,points:all.count,recordedDays:all.days,flightCandidates:all.flightCount,altitudeOnly:altitudeOnly.flightCount,selectionMs:Math.round(elapsed),downloadMiB:+(meta.compressedByteLength/1024/1024).toFixed(2),sourceAudit:!!process.argv[2]}));
