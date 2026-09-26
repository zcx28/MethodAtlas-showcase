"""Small model views; full evidence and immutable files stay in the store."""
import json
import ast
import re
import threading

from .state import canonical_citation_id


class References:
    def __init__(self):
        self.ids = {}
        self.aliases = {}
        self.lock = threading.Lock()

    def alias(self, citation_id):
        with self.lock:
            if citation_id not in self.aliases:
                alias = 'E' + str(len(self.ids) + 1)
                self.ids[alias] = citation_id
                self.aliases[citation_id] = alias
            return self.aliases[citation_id]

    def resolve(self, value):
        if re.fullmatch(r'E\d+', value):
            if value not in self.ids:
                raise ValueError('未知的本轮引用编号')
            return self.ids[value]
        return canonical_citation_id(value)

    def decode(self, text):
        text = re.sub(r'\[citation:([^\]]+)\]', r'[cite:\1]', text)
        structured = False
        def resolve(value):
            try: return self.resolve(value)
            except ValueError:
                if structured: return value  # Preflight reports the exact offending field.
                raise
        if text.lstrip().startswith('{'):
            try: data = json.loads(text)
            except ValueError: data = None
            if isinstance(data,dict) and data.get('view') in ('methods','comparison','evolution'):
                structured = True
                for field in ('nodes','opportunities'):
                    nodes = data.get(field)
                    if not isinstance(nodes,list): continue
                    for node in nodes:
                        if isinstance(node,dict) and isinstance(node.get('evidence'),list):
                            node['evidence'] = ['[cite:'+resolve(re.sub(r'^\[cite:|\]$','',v))+']' if isinstance(v,str) else v for v in node['evidence']]
            if isinstance(data,dict):
                def decode_ids(value):
                    if isinstance(value,dict):
                        for key, child in value.items():
                            if key == 'citation_ids' and isinstance(child,list):
                                value[key] = [resolve(cid) if isinstance(cid,str) else cid for cid in child]
                            else: decode_ids(child)
                    elif isinstance(value,list):
                        for child in value: decode_ids(child)
                decode_ids(data)
                text = json.dumps(data,ensure_ascii=False)
        text = re.sub(r'\[cite:([^\]]+)\]',lambda m:'[cite:'+resolve(m[1])+']',text)
        return re.sub(r'(data-citation\s*=\s*["\'])([^"\']+)',lambda m:m[1]+resolve(m[2]),text)

    def encode(self, text):
        return re.sub(r'cite_[0-9a-f]{32}', lambda m: self.alias(m[0]), text)

    def evidence(self, citation, quote=True):
        result = {'id': self.alias(citation['id']), 'paper_id': citation['paper_id'],
                  'version_id': citation['paper_version_id'], 'page': citation['page'], 'block': citation['block']}
        if citation.get('kind') == 'figure':
            result.update(kind='figure', warning='模型辅助图像观察，不是逐字原文，仍须原图核对', gaps=citation.get('gaps', []))
        if quote:
            result['quote'] = citation['quote']
        return result


def model_view(name, result, refs):
    if name == 'search_papers':
        papers = [{k:v for k,v in p.items() if k in ('id','title','authors','published','source','url','summary','reasons')} for p in result['candidates']]
        for paper in papers:
            abstract = paper.get('summary') or ''
            paper['summary'] = abstract[:2400]
            paper['abstract_truncated'] = len(abstract) > 2400
            paper['authors'] = paper.get('authors', [])[:3]
        return {**result, 'candidates':papers}
    if name in ('read_material', 'locate', 'read_evidence', 'read_figure', 'select_quote'):
        evidence = [refs.evidence(c) for c in result['evidence']]
        if name not in ('read_evidence', 'select_quote'):
            evidence = [{k:v for k,v in c.items() if k not in ('paper_id','version_id')} for c in evidence]
        return {**{k: v for k, v in result.items() if k not in ('evidence', 'coverage')},
                'evidence': evidence}
    if name == 'read_file':
        body = result['body']
        if result['kind'] == 'html':
            appendix = max(body.rfind('<section><h2>原文依据</h2>'), body.rfind('<section class="methodatlas-sources">'))
            if appendix >= 0:
                body = body[:appendix] + '</body></html>'
        return {**{k: result[k] for k in ('id', 'artifact_id', 'title', 'kind', 'version_no')},
                'body': refs.encode(body),
                'citations': [refs.evidence(c, quote=False) for c in result['citations']]}
    if name in ('research_paper', 'revise_paper_card', 'list_paper_cards', 'read_history'):
        return json.loads(refs.encode(json.dumps(result, ensure_ascii=False)))
    return result


def object_text(text):
    """Extract one object; tolerate one missing container closer, never change strings."""
    start=text.find('{')
    if start<0:return text
    stack=[];quote=None;escaped=False;parts=[];repairs=0
    for i,char in enumerate(text[start:],start):
        if quote:
            parts.append(char)
            if escaped:escaped=False
            elif char=='\\':escaped=True
            elif char==quote:quote=None
            continue
        if char in ('"',"'"):quote=char
        elif char in '{[':stack.append(char)
        elif char in '}]':
            expected='{' if char=='}' else '['
            if stack and stack[-1]!=expected and len(stack)>1 and stack[-2]==expected and repairs==0:
                parts.append('}' if stack.pop()=='{' else ']');repairs+=1
            if not stack or stack.pop()!=expected:return text
        parts.append(char)
        if not stack:
            if '{' in text[i+1:]:return text
            return ''.join(parts)
    return text


def parse_object(text):
    text = text.strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    text = object_text(text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        # Some providers emit Python-style quoted dictionaries. Never evaluate code.
        if len(text) > 500000:
            raise
        try:
            value = json.loads(json.dumps(ast.literal_eval(text), allow_nan=False))
        except (ValueError, SyntaxError, TypeError, RecursionError):
            raise error
    if not isinstance(value, dict):
        raise ValueError('模型必须返回 JSON 对象')
    return value
