// Browser-message boundary regression without a browser or model dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// The reader guide must not repeat adapter-provided synonyms as new findings.
const graph = fs.readFileSync(__dirname+'/../backend/graph.js','utf8');
const guide = graph.slice(graph.indexOf('readerGuide ='),graph.indexOf('function evidenceButtons'));
const guideContext = vm.createContext({DATA:{meta:{focus:'Focus'}},esc:s=>s});
vm.runInContext(guide,guideContext);
const guideHTML = vm.runInContext(`readerGuide({reader_summary:{'zh-CN':{background:'Focus',problem:'Problem',approach:'Method',key_findings:['Method','Finding'],why_it_matters:'Problem',limitations:['Limit']}}})`,guideContext);
assert.equal((guideHTML.match(/Method/g)||[]).length,1);
assert.equal((guideHTML.match(/Problem/g)||[]).length,1);
assert.ok(guideHTML.includes('Finding') && guideHTML.includes('Limit') && !guideHTML.includes('Focus'));
const listeners = [], requests = [], rendered = [];
const binding = {project_id:'project',artifact_id:'artifact',version_id:'v1',nonce:'preview-1'};
const frame = {contentWindow:{},dataset:{context:JSON.stringify(binding)}};
const paper = {id:'paper',version_id:'pv1'};
let respond = null;
const context = vm.createContext({
  console, setTimeout, clearTimeout, FormData, CSS:{escape:s=>s},
  HTMLSelectElement:class {},
  MutationObserver:class {observe(){}},
  matchMedia:()=>({matches:false,addEventListener(){}}),
  localStorage:{getItem:()=>null},
  document:{querySelector:()=>null,body:{querySelectorAll:()=>[],matches:()=>false},querySelectorAll:()=>[],addEventListener(){},getElementById:id=>id==='html-preview'?frame:null},
  window:{addEventListener:(type,fn)=>{if(type==='message')listeners.push(fn);}},
  fetch:url=>url==='/api/state'?new Promise(()=>{}):new Promise(resolve=>{
    requests.push(url); respond=()=>resolve({ok:true,json:async()=>paper});
  }),
  record:value=>rendered.push(value),
});
vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'), context);
vm.runInContext(`current={id:'project'}; artifact={id:'artifact',versions:[{id:'v1',materials:[{paper_id:'paper',paper_version_id:'pv1'}],citations:[{id:'cite',paper_id:'paper',paper_version_id:'pv1',page:3,quote:'evidence'}]}]};versionId='v1';toast=message=>{throw Error(message)};renderPaperViews=()=>record(detail);switchShellView=()=>{};saveWorkspaceState=()=>{};revealPanel=()=>{};`,context);
const emit = (data, changes={}) => listeners.forEach(fn=>fn({source:frame.contentWindow,origin:'null',data:{...binding,...data},...changes}));
const tick = () => new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const node={type:'methodatlas-graph-paper',paper_id:'paper',paper_version_id:'pv1'};
  for(const invalid of [{nonce:'stale'},{project_id:'other'},{artifact_id:'other'},{version_id:'v0'},{paper_id:'other'},{paper_version_id:'pv0'}])emit({...node,...invalid});
  emit(node,{source:{}});emit(node,{origin:'https://unrelated.invalid'});
  emit({type:'methodatlas-graph-citation',id:'unrelated'});
  emit({type:'methodatlas-citation',id:'cite'});
  assert.equal(requests.length,0,'Unrelated or unbound messages must not drive the reader');
  emit(node);assert.match(requests[0],/papers\/paper\?version_id=pv1$/);respond();await tick();
  assert.equal(rendered.length,1);assert.equal(rendered[0].focus,null);
  emit({type:'methodatlas-graph-citation',id:'cite'});respond();await tick();
  assert.equal(rendered[1].page,3);assert.equal(rendered[1].focus.quote,'evidence');
  emit(node);vm.runInContext("versionId='v2'",context);respond();await tick();
  assert.equal(rendered.length,2,'A late paper response must not open after switching artifact version');
  console.log('PASS graph messages: source, origin, project, artifact/version, nonce, members, evidence and late responses');
})().catch(error=>{console.error(error);process.exitCode=1;});
