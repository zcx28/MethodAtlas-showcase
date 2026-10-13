// Run: node prototype/check-reliability.cjs
// Extracts production functions into isolated VMs; no network, browser, model or user data.
// Regression assertions describe repaired behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'prototype', name), 'utf8');
function extract(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Source boundary changed: ${start}`);
  return source.slice(first, last);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

async function fragmentContextChanges() {
  const source = extract(read('writing.jsx'), '  async function addFragment()', '\n  async function propose(');
  const gate = deferred(), entered = deferred(), added = [], requests = [];
  let conversation = 'A';
  const context = {
    pickedRef: {current: {text: 'old text', selection: {anchor: {path: [0, 0], offset: 0}, focus: {path: [0, 0], offset: 8}}, document: '[]'}},
    context: () => ({conversation}), flush: async () => {}, alive: {current: true},
    editorRef: {current: {children: []}},
    api: async (url, body) => { requests.push({url, body}); entered.resolve(); await gate.promise; },
    base: '/api/projects/p/documents/d', historical: false,
    working: {current: {base_version_id: 'draft_A'}}, artifact: 'd', title: 'D', id: () => 'fragment',
    onAddFragment: fragment => added.push({conversation, ...fragment}),
    setPicked: () => {}, setError: message => { throw Error(message); }
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.addFragment = addFragment;', context);
  const running = context.addFragment();
  await entered.promise;
  conversation = 'B';
  context.working.current.base_version_id = 'draft_B';
  gate.resolve();
  await running;
  assert.equal(requests[0].body.version_id, 'draft_A');
  assert.equal(added.length, 0);
  console.log('PASS: fragment cannot cross conversation/version boundary');
}

async function queueRemovedBeforeSnapshotCompletes() {
  const app = read('app.js');
  const source = extract(app, 'function updateQueued(', '\nconst waitingTask') + '\n' + extract(app, 'async function pumpQueue()', '\nfunction shellNav()') + '\n' +
    extract(app, 'async function dispatchMessage(', '\nasync function refreshTask(');
  const storage = new Map([['queue:A', JSON.stringify([{id: 'q1', text: 'queued input', fragments: [], settings: {}}])]]);
  const gate = deferred(), entered = deferred();
  const context = {
    queueDispatch: false, messageQueue: JSON.parse(storage.get('queue:A')),
    conversation: {id: 'A', messages: []}, current: {id: 'p'}, viewGeneration: 1,
    selected: new Set(), artifact: {id: 'd', draft: {id: 'draft_A', kind: 'manuscript'}, versions: []}, versionId: 'draft',
    busyTask: () => false, selectedFragments: () => [], renderChat: () => {}, toast: message => { throw Error(message); },
    saveQueue: () => storage.set('queue:A', JSON.stringify(context.messageQueue)),
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    window: {MethodAtlasProgress: {revise: async () => false, context:()=>null}, MethodAtlasSettings: {request: () => ({})}},
    api: async url => { assert.ok(url.endsWith('/snapshot')); entered.resolve(); await gate.promise; },
    isCurrentView: (generation, project, conversation) => generation === context.viewGeneration && project === context.current.id && conversation === context.conversation.id
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.pumpQueue = pumpQueue;', context);
  const running = context.pumpQueue();
  await entered.promise;
  const persisted = JSON.parse(storage.get('queue:A'));
  assert.equal(persisted[0].id, 'q1');
  assert.equal(persisted[0].text, 'queued input');
  assert.equal(persisted[0].sending, true);
  assert.equal(storage.has('draft:A'), false);
  assert.equal(storage.has('request:A'), false);
  console.log('PASS: pending snapshot retains durable queue input');
  // Complete the VM without sending anything; a real page reload would discard this continuation.
  context.viewGeneration++;
  gate.resolve();
  await running;
}

async function oldFailureRollsBackNewPreferences(failLast=false,cached=false) {
  const settings=read('settings.js'),source=extract(settings, '    const chatPref=event.target.dataset.chatPref;', '\n  });');
  const first = deferred(), entered = deferred(), writes = [];
  const storage=new Map(cached?[['chat-options:c','{"style":"balanced"}']]:[]);
  const context = {
    conversation: {id: 'c', chat_options: {connection_id: 'original', effort: 'auto', style: 'balanced'}},
    current: {id: 'p'}, saving: Promise.resolve(), pendingPreferences: new Map(),
    options: () => context.conversation.chat_options, refreshControls: () => {}, toast: () => {},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    api: async (url, options) => {
      const body = JSON.parse(options.body);
      writes.push(body);
      if (writes.length === 1) { entered.resolve(); await first.promise; }
      if (writes.length === 2 && failLast) throw Error('controlled last failure');
      return body;
    }
  };
  vm.createContext(context);
  vm.runInContext(extract(settings,'  function saveOptions(','\n  function sent(')+'\nfunction change(event) {' + source + '}\nthis.change = change;', context);
  context.change({target: {dataset: {chatPref: 'connection_id'}, value: 'chosen'}});
  context.change({target: {dataset: {chatPref: 'style'}, value: 'detailed'}});
  await entered.promise;
  if(cached)assert.equal(JSON.parse(storage.get('chat-options:c')).style,'detailed','reload cache follows the latest choice while preferences are in flight');
  first.reject(Error('controlled first request failure'));
  await context.saving;
  assert.equal(writes.length, 2);
  assert.equal(writes[1].connection_id, 'chosen');
  assert.equal(writes[1].style, 'detailed');
  assert.equal(context.conversation.chat_options.connection_id, failLast?'original':'chosen');
  assert.equal(context.conversation.chat_options.style, failLast?'balanced':'detailed');
  if(cached)assert.equal(storage.has('chat-options:c'),failLast,'only a confirmed latest save removes the reload cache');
  console.log('PASS: stale failed preference save cannot roll back a newer successful save');
}

async function queueAcknowledgement() {
  const app=read('app.js'), storage=new Map(), gate=deferred(), entered=deferred();
  const context={queueDispatch:false,messageQueue:[{id:'q1',text:'keep'}],conversation:{id:'A'},busyTask:()=>false,renderChat:()=>{},toast:()=>{},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    dispatchMessage:async()=>{entered.resolve();await gate.promise;return true;}};
  vm.createContext(context);
  vm.runInContext(extract(app,'function updateQueued(','\nconst waitingTask')+extract(app,'async function pumpQueue()','\nfunction shellNav()')+'\nthis.pumpQueue=pumpQueue;',context);
  const running=context.pumpQueue();await entered.promise;
  context.conversation={id:'B'};context.messageQueue=[{id:'b',text:'other conversation'}];
  gate.resolve();await running;
  assert.equal(storage.get('queue:A'),'[]');
  assert.equal(context.messageQueue[0].id,'b');
  console.log('PASS: acknowledgement removes only the original conversation queue item');
}

function incrementalHistory() {
  const context={};vm.createContext(context);
  vm.runInContext(extract(read('app.js'),'function mergeProjectUpdate(', '\nasync function refreshTask(')+'\nthis.merge=mergeProjectUpdate;',context);
  const old={conversations:[{id:'A',messages:[{id:'u',created:'1',task_id:'t',task:{id:'t',status:'running'}},{id:'a',created:'2',task_id:'t',text:'old'},{id:'explanation_t',created:'1',task_id:'t'}]}]};
  const update={tasks:[{id:'t',status:'succeeded'}],conversations:[{id:'A',messages:[{id:'a',created:'2',task_id:'t',text:'new'}]}]};
  const result=context.merge(old,update);
  assert.equal(result.conversations[0].messages.length,2);
  assert.equal(result.conversations[0].messages[0].task.status,'succeeded');
  assert.equal(result.conversations[0].messages[1].text,'new');
  assert.equal(context.merge(result,update).conversations[0].messages.length,2);
  console.log('PASS: delta merge preserves history, replaces replies, removes stale explanations and is idempotent');
}

async function frozenRetry() {
  const request={text:'original',client_message_id:'stable-id',selected_paper_ids:['old-paper'],replace_active:true,reference:{artifact_id:'old-doc',version_id:'old-version'}};
  const queued={id:'stable-id',text:'original',request}, storage=new Map(), writes=[];
  const context={conversation:{id:'A',messages:[]},current:{id:'p'},viewGeneration:1,artifact:null,selected:new Set(['changed-paper']),
    pending:false,activeTaskId:null,versionId:null,messageQueue:[queued],draftEdits:new Map(),
    projectPollSequence:0,pollTimer:null,clearTimeout:()=>{},state:{collaboration:false},
    selectedFragments:()=>[],saveSelectedFragments:()=>{},renderChat:()=>{},toast:()=>{},
    document:{getElementById:()=>null},isCurrentView:()=>true,
    localStorage:{getItem:key=>storage.get(key) || null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{MethodAtlasProgress:{revise:()=>{throw Error('Frozen request reinterpreted');},context:()=>null},MethodAtlasSettings:{sent:()=>{}}},
    api:async(url,options)=>{writes.push(JSON.parse(options.body));if(writes.length===1)throw Error('lost acknowledgement');return {task_id:'task'};},
    refreshTask:async()=>{throw Error('accepted, but refresh failed');}};
  vm.createContext(context);
  const source=extract(read('app.js'),'function updateQueued(','\nconst waitingTask')+extract(read('app.js'),'async function dispatchMessage(','\nfunction mergeProjectUpdate(');
  vm.runInContext(source+'\nthis.dispatch=dispatchMessage;',context);
  assert.equal(await context.dispatch('original',[],true,{},queued),false);
  assert.equal(await context.dispatch('original',[],true,{},queued),true);
  assert.deepEqual(writes,[request,request]);
  console.log('PASS: uncertain retry preserves exact request/id; accepted send survives refresh failure');
}

async function historyContextChanges() {
  const first=deferred(),second=deferred(),requests=[];
  const context={current:{id:'p',tasks:[]},conversation:{id:'A',messages:[],has_more:true,before:61},viewGeneration:1,
    renderChat:()=>{},toast:message=>{throw Error(message);},document:{getElementById:()=>null},
    api:async url=>{requests.push(url);return requests.length===1?first.promise:second.promise;},
    isCurrentView:(generation,project,cid)=>generation===context.viewGeneration && cid===context.conversation.id};
  vm.createContext(context);
  vm.runInContext(extract(read('app.js'),'let historyLoading =','\nfunction mergeProjectUpdate(')+'\nthis.load=loadOlderMessages;this.loading=()=>historyLoading;',context);
  const a=context.load();
  context.viewGeneration=2;context.conversation={id:'B',messages:[],has_more:true,before:61};
  const b=context.load();
  first.resolve({messages:[{id:'a',text:'must not enter B'}],before:1,has_more:false});await a;
  assert.equal(context.loading().generation,2);
  assert.equal(context.conversation.messages.length,0);
  second.resolve({messages:[{id:'b',text:'B history',created:'1'}],before:1,has_more:false});await b;
  assert.equal(context.loading(),null);
  assert.equal(context.conversation.messages[0].id,'b');
  console.log('PASS: old history response cannot cross conversations or clear a newer loading state');
}

function formattedAnswers() {
  const source=read('app.js'), context={
    answerTextContext:raw=>({raw,citations:[],numbers:new Map(),unlinked:[]})};
  vm.createContext(context);
  vm.runInContext(source.match(/^const esc =.*$/m)[0]+'\n'+extract(source,'function renderAnswerInline(', '\nfunction chatAnswerText(')+'\nthis.render=renderAnswerText;',context);
  const table=context.render('| Name | Value |\n| --- | ---: |\n| a\\|b | `<img src=x onerror=alert(1)>|c` |');
  assert.match(table,/<th scope="col"/);
  assert.match(table,/<td class="answer-align-left">a\|b<\/td>/);
  assert.match(table,/&lt;img src=x onerror=alert\(1\)&gt;\|c/);
  assert.doesNotMatch(table,/<img/);
  assert.match(context.render('2. Second\n3. Third'),/<ol start="2"><li>Second<\/li><li>Third<\/li><\/ol>/);
  assert.match(context.render('- <script>\n- Safe'),/<ul><li>&lt;script&gt;<\/li><li>Safe<\/li><\/ul>/);
  assert.doesNotMatch(context.render('```\n| A | B |\n| --- | --- |\n- literal\n```'),/<table|<ul/);
  console.log('PASS: answer tables/lists preserve escaped and code-span pipes, escape HTML and keep fenced examples literal');
}

(async () => {
  formattedAnswers();
  await fragmentContextChanges();
  await queueRemovedBeforeSnapshotCompletes();
  await oldFailureRollsBackNewPreferences();
  await oldFailureRollsBackNewPreferences(true);
  await oldFailureRollsBackNewPreferences(false,true);
  await oldFailureRollsBackNewPreferences(true,true);
  await queueAcknowledgement();
  incrementalHistory();
  await frozenRetry();
  await historyContextChanges();
})().catch(error => { console.error(error); process.exitCode = 1; });
