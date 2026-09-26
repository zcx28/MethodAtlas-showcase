import React, {createContext, useContext} from 'react';
import { createPlateEditor, createPlatePlugin, Plate, PlateContent } from 'platejs/react';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import { diffToSuggestions, acceptSuggestion, rejectSuggestion, getSuggestionKeys } from '@platejs/suggestion';

export const clone = value => JSON.parse(JSON.stringify(value));
export const nodeText = node => node.text ?? node.children.map(nodeText).join('');
const References = createContext({numbers:{}, onCitation:()=>{}});

function Block({ attributes, children, element }) {
  const references = useContext(References);
  const kind = element.type, attrs = { ...attributes, 'data-block-id': element.id };
  if (kind === 'img') return <figure {...attrs}><span contentEditable={false}><img src={element.url} alt={element.alt}/><figcaption>{element.alt}</figcaption></span>{children}</figure>;
  if (kind === 'equation') return <div {...attrs}><span className="writing-equation" contentEditable={false} aria-label="公式">{element.formula}</span>{children}</div>;
  if (kind === 'code') return <pre {...attrs} className="writing-code"><code>{children}</code></pre>;
  if (kind === 'quote') return <blockquote {...attrs} className="writing-quote">{children}</blockquote>;
  if (kind === 'divider') return <hr {...attrs} className="writing-divider"/>;
  if (kind === 'citation') return <span {...attrs} contentEditable={false} className="writing-cite" data-citation-node={element.id}><button type="button" onClick={()=>references.onCitation(element.citation_id)} aria-label={`引用 ${references.numbers[element.citation_id]}`}>[{references.numbers[element.citation_id]}]</button>{children}</span>;
  if (kind === 'task') return <div {...attrs} className="writing-task"><input type="checkbox" contentEditable={false} checked={!!element.checked} onChange={()=>references.onToggleTask?.(element)} aria-label="完成任务"/><span>{children}</span></div>;
  const tag = ['p','h1','h2','h3','ul','ol','li','table','tr','td'].includes(kind) ? kind : 'p';
  return React.createElement(tag, attrs, tag === 'table' ? <tbody>{children}</tbody> : children);
}

export function makeEditor(value) {
  const plugins = ['p','h1','h2','h3','ul','ol','li','task','code','quote','divider','table','tr','td','img','equation','citation'].map(key => createPlatePlugin({ key, node: { isElement: true, isVoid: ['img','equation','citation','divider'].includes(key), isInline: key === 'citation', component: Block } }));
  return createPlateEditor({ plugins: [...plugins, SuggestionPlugin.configure({ options: { currentUserId: 'AI', isSuggesting: false } })], value: clone(value) });
}

function Leaf({ attributes, children, leaf }) {
  const data = getSuggestionKeys(leaf).map(key => leaf[key]);
  const removed = data.some(d => d.type === 'remove'), inserted = data.some(d => d.type === 'insert');
  let result = children;
  if (leaf.bold) result = <strong>{result}</strong>;
  if (leaf.italic) result = <em>{result}</em>;
  if (leaf.underline) result = <u>{result}</u>;
  if (removed) result = <del aria-label="删除">{result}</del>;
  if (inserted) result = <ins aria-label="新增">{result}</ins>;
  return <span {...attributes}>{result}</span>;
}

export function citationNumbers(citations = []) {
  const papers = new Map(), numbers = {};
  for (const citation of citations) {
    const paper = citation.paper_id || citation.paper_version_id || citation.id;
    if (!papers.has(paper)) papers.set(paper, papers.size + 1);
    numbers[citation.id] = papers.get(paper);
  }
  return numbers;
}

export function Editor({ editor, citations = [], readOnly = false, onChange, onSelection, onKeyDown, onCitation = ()=>{} }) {
  const numbers = citationNumbers(citations);
  function visit(nodes) {for(const node of nodes){if(node.type==='citation' && !numbers[node.citation_id])numbers[node.citation_id]=Math.max(0,...Object.values(numbers))+1;if(node.children)visit(node.children);}}
  visit(editor.children);
  // 点击待办方块切换 checked；只读态（历史版本 / 确认中 / 预览）一律不动文档。
  const toggleTask = element => {
    if (readOnly) return;
    const index = editor.children.findIndex(node => node.id === element.id);
    if (index < 0) return;
    editor.tf.setNodes({checked: !element.checked}, {at: [index]});
  };
  return <References.Provider value={{numbers,onCitation,onToggleTask:toggleTask}}><Plate editor={editor} onValueChange={({value}) => onChange?.(value)} onSelectionChange={({selection}) => onSelection?.(selection)}><PlateContent className="writing-content" aria-label={readOnly ? '修改差异预览' : '论文正文'} readOnly={readOnly} onKeyDown={onKeyDown} renderLeaf={Leaf}/></Plate></References.Provider>;
}

export function proposalEditor(before, after) {
  const editor = makeEditor(before);
  editor.tf.setValue(diffToSuggestions(editor, clone(before), clone(after)));
  return editor;
}

// Use the upstream accept/reject transforms for the entire instruction. The
// server separately merges the reviewed proposal against immutable baselines.
export function resolveProposal(editor, accept) {
  const descriptions = new Map();
  for (const [node] of editor.api.nodes({at: [], match: n => !!n.suggestion})) {
    for (const key of getSuggestionKeys(node)) descriptions.set(key, {keyId: key, suggestionId: node[key].id});
    if (typeof node.suggestion === 'object') descriptions.set(node.suggestion.id, {keyId: 'suggestion_' + node.suggestion.id, suggestionId: node.suggestion.id});
  }
  for (const description of descriptions.values()) (accept ? acceptSuggestion : rejectSuggestion)(editor, description);
  return clone(editor.children);
}

export function normalizedDocument(value) {
  const editor = makeEditor(value);
  editor.tf.normalize({force:true});
  // Plate assigns ephemeral ids to nested list items and citations during diffing.
  // Only top-level ids are the server's conflict boundary; citation_id stays intact.
  const canonical = (value, top = false) => Array.isArray(value) ? value.map(v=>canonical(v)) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => key !== 'id' || top).sort().map(key=>[key,canonical(value[key])])) : value;
  return JSON.stringify(editor.children.map(node=>canonical(node,true)));
}

export function selectionSnapshot(nodes, range) {
  if (!range || JSON.stringify(range.anchor) === JSON.stringify(range.focus)) return null;
  const compare = (a,b) => {for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i];return a.length-b.length;};
  const [start,end] = [range.anchor,range.focus].sort((a,b)=>compare(a.path,b.path)||a.offset-b.offset);
  if (start.path.length===1 && end.path.length===1 && start.path[0]===end.path[0] && nodes[start.path[0]]?.type==='equation') return {selection:clone(range),text:nodes[start.path[0]].formula.slice(start.offset,end.offset),editable:false};
  const parts = [];
  let editable = true;
  function visit(items, parent = [], kinds = []) {
    items.forEach((node,index)=>{
      const path = [...parent,index];
      if (!('text' in node)) {
        if (['citation','equation','img'].includes(node.type)) {
          if(compare(start.path,[...path,0])<=0 && compare([...path,0],end.path)<=0){
            parts.push({path:[...path,0],end:0,text:node.formula ?? node.alt ?? '[引用]'});
            if(node.type !== 'citation') editable=false;
          }
        } else visit(node.children,path,[...kinds,node.type]);
        return;
      }
      if(compare(start.path,path)>0||compare(path,end.path)>0)return;
      const low=compare(path,start.path)===0 ? start.offset : 0, high=compare(path,end.path)===0 ? end.offset : node.text.length;
      if(high<=low)return;
      if(kinds.includes('table')||!['p','h1','h2','h3','li'].includes(kinds.at(-1)))editable=false;
      const text=node.text.slice(low,high), last=parts.at(-1);
      if(last && compare(last.path.slice(0,-1),parent)===0 && last.end===index-1){last.text+=text;last.end=index;}
      else parts.push({path,end:index,text});
    });
  }
  visit(nodes);
  return parts.length ? {selection:clone(range),text:parts.map(p=>p.text).join('\n'),editable} : null;
}
