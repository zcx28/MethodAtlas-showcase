"""Evidence-bound research views, rendered by the application, never model scripts."""
import html
import json
import re
from pathlib import Path


GUIDANCE = '''
方法研究：普通比较只回答，不保存。明确生成/保存方法比较、方法地图或技术演进成果时，write_file仍用kind="html"，content改为下述JSON字符串，由应用生成连续阅读的文档；不要自行绘制交互HTML。
{"view":"comparison或methods或evolution","summary":"研究范围和可比性说明","nodes":[{"name":"方法或阶段名称","summary":"概要","detail":"详细介绍","conditions":"实验任务、数据、训练和评估条件","metrics":"指标定义与结果；不可比时说明","limitations":"已证实的适用边界","period":"真实年代，未知用null","problem":"仅evolution必填，解决的问题","improvement":"仅evolution必填，有依据的改进，不把先后当因果","evidence":["[cite:E1]"]}],"gaps":["真实缺口，无则空列表"],"opportunities":[{"text":"有局限依据的待验证建议，不保证创新","evidence":["[cite:E1]"]}]}
conditions、metrics、limitations及演进的period、problem、improvement无依据时用null，程序不展示空段。核心name、summary、detail必须有依据。不要输出待核对内容，gaps=[]。evidence 可以为空；使用引用时须同时列入 write_file.citation_ids，不强制每个字段附原句引用。结构化字段必须符合协议，缺信息据实说明。read_file 返回原 JSON，局部修订携带 artifact_id/base_version_id，保留未要求修改的内容与依据。
'''


class ResearchValidationError(ValueError):
    def __init__(self, errors):
        self.errors = errors
        super().__init__(json.dumps(errors, ensure_ascii=False))


def validate_object(data, citations, require_inline=False):
    errors = []
    sources = {c['id'] for c in citations}
    def issue(path, code, message):
        errors.append({'path':path, 'code':code, 'message':message})
    if not isinstance(data, dict):
        raise ResearchValidationError([{'path':'', 'code':'format', 'message':'需要研究对象'}])
    if data.get('view') not in ('methods','comparison','evolution'):
        issue('/view','format','需要 methods、comparison 或 evolution')
    if 'title' in data and (not isinstance(data['title'],str) or not data['title'].strip()):
        issue('/title','format','标题需要非空文字')
    if not isinstance(data.get('summary'),str) or not data['summary'].strip():
        issue('/summary','missing_field','需要研究范围说明')
    for field in ('nodes','opportunities','gaps'):
        value = data.get(field, [] if field != 'nodes' else None)
        if not isinstance(value,list) or field == 'nodes' and not value:
            issue('/'+field,'format','需要列表；nodes 至少包含一项')
            continue
        for i,item in enumerate(value):
            path = f'/{field}/{i}'
            if field == 'gaps':
                if not isinstance(item,str) or not item.strip(): issue(path,'format','缺口需要文字')
                continue
            if not isinstance(item,dict):
                issue(path,'format','需要对象'); continue
            fields = ['text'] if field == 'opportunities' else ['name','summary','detail','conditions','metrics','limitations'] + (['period','problem','improvement'] if data.get('view') == 'evolution' else [])
            for name in fields:
                if field == 'nodes' and name not in ('name','summary','detail') and name in item and item[name] is None:
                    continue
                if not isinstance(item.get(name),str) or not item[name].strip():
                    issue(path+'/'+name,'missing_field','核心介绍需要有依据的非空文字；其他字段无依据用null')
                elif data.get('view') in ('methods','comparison') and name in ('summary','detail','conditions','metrics','limitations'):
                    limit = 140 if name == 'detail' else 80
                    if len(re.sub(r'\[cite:[^\]]+\]', '',item[name])) > limit:
                        issue(path+'/'+name,'too_long',f'压缩至{limit}字内，只保留影响选型的一项事实及就近引用，不拼接完整研究卡')
            evidence = item.get('evidence', [])
            if not isinstance(evidence,list):
                issue(path+'/evidence','format','引用须为列表，可为空')
                continue
            for j,cid in enumerate(evidence):
                if not isinstance(cid,str) or re.sub(r'^\[cite:|\]$', '',cid) not in sources:
                    issue(path+f'/evidence/{j}','unknown_reference','引用必须来自本次提供的依据，格式错误不需重新读论文')
    def inline(value,path=''):
        if isinstance(value,dict):
            for k,v in value.items(): inline(v,path+'/'+k)
        elif isinstance(value,list):
            for i,v in enumerate(value): inline(v,path+'/'+str(i))
        elif isinstance(value,str):
            if any(cid not in sources for cid in re.findall(r'\[cite:([^\]]+)\]',value)):
                issue(path,'unknown_reference','正文引用不属于本次已有依据')
    inline(data)
    if errors:
        raise ResearchValidationError(errors)
    return data


def render(content, citations):
    data = json.loads(content)
    validate_object(data, citations)
    if not isinstance(data, dict) or data.get('view') not in ('comparison', 'methods', 'evolution'):
        raise ValueError('研究视图必须是 comparison、methods 或 evolution')
    sources = {c['id']: c for c in citations}
    numbers = {c['id']: i for i,c in enumerate(citations,1)}

    def text(value, linked=True):
        if not isinstance(value, str) or not value.strip():
            raise ValueError('研究视图缺少必要的文字说明')
        escaped = html.escape(value)
        def link(match):
            if match[1] not in sources:
                raise ValueError('研究视图引用未列入实际依据')
            return f'<button data-citation="{match[1]}">[{numbers[match[1]]}]</button>' if linked else ''
        return re.sub(r'\[cite:([^\]]+)\]', link, escaped)

    def evidence(item):
        values = item.get('evidence', [])
        if not isinstance(values, list):
            raise ValueError('引用须为列表，可为空')
        refs = []
        for value in values:
            match = re.fullmatch(r'\[cite:(cite_[0-9a-f]{32})\]', value) if isinstance(value, str) else None
            if not match or match[1] not in sources:
                raise ValueError('研究视图含未读取或不属于成果的引用')
            refs.append(sources[match[1]])
        return refs

    nodes, opportunities, gaps = data.get('nodes'), data.get('opportunities', []), data.get('gaps', [])
    if not isinstance(nodes, list) or not nodes or not all(isinstance(n, dict) for n in nodes):
        raise ValueError('研究视图需要有依据的方法或阶段')
    if not isinstance(opportunities, list) or not all(isinstance(n, dict) for n in opportunities) or not isinstance(gaps, list):
        raise ValueError('研究机会和缺口必须是列表')
    refs = [evidence(node) for node in nodes]
    def paper_links(group):
        unique = {c['id']: c for c in group}
        return ' '.join(f'<button data-citation="{c["id"]}">[{numbers[c["id"]]}]</button>' for c in unique.values())

    sections, rows = [], []
    evolution = data['view'] == 'evolution'
    tabular = not evolution and len(nodes) > 1
    for node, group in zip(nodes, refs):
        name = text(node['name'], linked=False)
        fields = ''.join(f'<p><strong>{label}：</strong>{text(node[key])}</p>' for key,label in ([('limitations','局限')] if evolution else [('conditions','适用条件'),('metrics','指标与结果'),('limitations','局限')]) if node.get(key))
        # A fact has one place: comparable fields live in the table, explanatory prose below it.
        prose = ''.join(f'<p>{text(value)}</p>' for value in dict.fromkeys([node['detail']] if evolution else [node['summary'],node['detail']]))
        extra = ''
        if evolution:
            extra = f'<p class="reading-period">研究时间：{text(node["period"], linked=False)}</p>' if node.get('period') else ''
            extra += ''.join(f'<p><strong>{label}：</strong>{text(node[key])}</p>' for key,label in [('problem','解决的问题'),('improvement','主要改进')] if node.get(key))
        sections.append(f'<section class="research-section"><h2>{name}</h2>{extra}{prose}{"" if tabular else fields}</section>')
        rows.append(f'<tr><th scope="row">{name}</th>' + ''.join(f'<td data-label="{label}">{text(node[key]) if node.get(key) else "—"}</td>' for key,label in [('conditions','适用条件'),('metrics','指标与结果'),('limitations','局限')]) + '</tr>')
    table = '<div class="research-table"><table><caption>条件、指标与局限对照</caption><thead><tr><th>方法</th><th>适用条件</th><th>指标与结果</th><th>局限</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table></div>' if tabular else ''
    proposals = ''.join(f'<li><strong>待验证</strong>：{text(n["text"])} {paper_links(evidence(n))}</li>' for n in opportunities)
    label = '研究脉络' if evolution else '方法对比'
    missing = '<section class="research-gaps"><h2>待核对</h2><ul>' + ''.join('<li>' + text(gap) + '</li>' for gap in dict.fromkeys(gaps)) + '</ul></section>' if gaps else ''
    markup = f'<article class="research-view"><h1>{text(data.get("title", label))}</h1><p class="report-summary">{text(data["summary"])}</p>{table}{"".join(sections)}{missing}{"<section><h2>下一步验证</h2><ul>" + proposals + "</ul></section>" if proposals else ""}</article>'

    return markup, data


STYLE = (Path(__file__).resolve().parents[1] / 'prototype/report.css').read_text('utf-8')
