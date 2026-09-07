// Runs the real component's source/style effects against a map stub, then validates
// the resulting layers with the installed Mapbox style specification. No browser QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { validate } = require('../node_modules/mapbox-gl/dist/style-spec/index.cjs');
function compile(file, resolver) {
  const output = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX, esModuleInterop:true } }).outputText;
  const module = { exports:{} };
  new Function('require','module','exports',output)(resolver,module,module.exports);
  return module.exports;
}
const constants = compile('app/track-types.ts', require);
let combinations = 0;
for (const mode of ['points','heat']) for (const colorMode of ['time','solid']) for (const flights of ['show','hide','only']) for (const heatPalette of ['aurora','ember','ocean']) {
  const style = { version:8, sources:{}, layers:[] }, effects=[];
  const map = {
    getSource:id=>style.sources[id], addSource:(id,source)=>style.sources[id]=source,
    getStyle:()=>style, getLayer:id=>style.layers.find(layer=>layer.id===id), isStyleLoaded:()=>true,
    addLayer:layer=>style.layers.push(layer), on:()=>{}, off:()=>{},
    setFilter:(id,filter)=>{const layer=style.layers.find(layer=>layer.id===id);if(filter)layer.filter=filter;else delete layer.filter;},
    setPaintProperty:(id,key,value)=>{style.layers.find(layer=>layer.id===id).paint[key]=value;},
    setLayoutProperty:(id,key,value)=>{const layer=style.layers.find(layer=>layer.id===id);layer.layout??={};layer.layout[key]=value;},
  };
  let ref=0;
  const react = { useEffect:effect=>effects.push(effect),useState:()=>[true,()=>{}],useRef:value=>({current:ref++===1?map:value}) };
  const module = compile('app/FootprintMap.tsx',name=>name==='react'?react:name==='mapbox-gl'?{}:name==='./track-types'?constants:require(name));
  module.FootprintMap({selection:{revision:1,blob:new Blob(['{"type":"FeatureCollection","features":[]}'])},appearance:{...constants.DEFAULT_APPEARANCE,mode,colorMode,flights,heatPalette},onReady:()=>{},onDataReady:()=>{},onError:()=>{}});
  effects[1](); const cleanup = effects[2](); effects[3]();
  const errors = validate(style);
  assert.deepEqual(errors.map(error=>error.message),[],JSON.stringify({mode,colorMode,flights,heatPalette}));
  assert.equal(style.sources['trace-points'].cluster,false);
  assert.equal(style.sources['trace-points'].tolerance,0);
  assert.equal(style.layers.find(layer=>layer.type==='circle').layout.visibility,mode==='points'?'visible':'none');
  assert.equal(style.layers.find(layer=>layer.type==='heatmap').layout.visibility,mode==='heat'?'visible':'none');
  cleanup(); combinations++;
}
console.log(JSON.stringify({passed:true,nativeLayerConfigurations:combinations}));
