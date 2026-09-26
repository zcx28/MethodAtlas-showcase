"""Version-bound paper graphs using the pinned academic-research-graph renderer."""
import html
import importlib.util
import json
import re
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

from .reporting import object_fields, text
from .state import json_text, new_id, now

UPSTREAM = Path(__file__).resolve().parents[1] / 'third_party/academic-research-graph/academic-research-graph-skill'
module = importlib.util.spec_from_file_location('academic_graph_validator', UPSTREAM / 'scripts/validate_graph.py')
validator = importlib.util.module_from_spec(module)
module.loader.exec_module(validator)

GUIDANCE = '''论文关系图谱交付用 write_file(kind="graph")，content为JSON字符串：
{"all_papers":false,"focus":"研究问题","unverified":[],"nodes":[{"paper_id":"实际ID","version_id":"实际版本","title":"原文准确原标题","problem":"问题","approach":"方法","limitations":"原文支持的适用边界","citation_ids":["E1"]}],"edges":[{"source":"被继承/比较/批评的paper_id","target":"开展继承/比较/批评工作的paper_id","relationship":"继承或比较或批评","explanation":"有条件的具体关系说明","citation_ids":["E2"]}]}。
节点、边绑定本轮实际引用，write_file.citation_ids包含全部依据。graph 文件由程序生成可下载的离线HTML，read_file返回JSON，不能降级为普通HTML绕过关系校验。模型不提供脚本、资源或绘图布局。修订携带已读artifact_id/base_version_id。
'''


def render_graph(tools, title, content, citations):
    spec = object_fields(json.loads(content), ('focus', 'nodes', 'edges', 'unverified', 'all_papers'))
    text(spec['focus'])
    if type(spec['all_papers']) is not bool or not isinstance(spec['nodes'], list) or not spec['nodes'] or not isinstance(spec['edges'], list):
        raise ValueError('图谱需要可用论文和关系列表')
    if not isinstance(spec['unverified'], list) or len(spec['unverified']) > 100:
        raise ValueError('待核实导读格式无效')
    for item in spec['unverified']:
        text(item)
    tools.list_materials()
    failures = tools.store.task(tools.task['id'])['refs'].get('failures', {}).values()
    failed_ids = {f['paper_id'] for f in failures if f['paper_id'] in tools.allowed}
    missing_ids = failed_ids | {pid for pid, p in tools.allowed.items() if not p.get('version_id')}
    for pid in sorted(missing_ids):
        warning = f"材料缺口：{tools.allowed[pid]['title']} 尚无可用正文或本轮读取失败，相关关系尚待核对。"
        if warning not in spec['unverified']:
            spec['unverified'].append(warning)
    if spec['all_papers'] and not re.search(r'全部|全量|所有|\ball\b', tools.task['prompt'], re.I):
        raise ValueError('全量图谱需要用户明确要求全部；否则精选至多15篇')
    if not spec['all_papers'] and len(spec['nodes']) > 15:
        raise ValueError('默认图谱至多15篇，请精选并在导读说明子集')
    available = {c['id']: c for c in citations}
    nodes, papers, materials = [], {}, []

    def evidence(ref, version):
        ids = ref['citation_ids']
        if not isinstance(ids, list) or not ids or any(not isinstance(cid, str) for cid in ids):
            raise ValueError('图谱节点/关系须有真实原文依据')
        ids = [tools.references.resolve(cid) for cid in ids]
        if any(cid not in available or available[cid]['paper_version_id'] != version or not available[cid]['quote'].strip() for cid in ids):
            raise ValueError('图谱证据须列入 citation_ids，且关系引用必须全部来自 target 论文版本 '+version+'；共享第三方或读者对读不是比较边，没有直接关系时保留节点并使用 edges=[]')
        ref['citation_ids'] = ids
        return ids

    for item in spec['nodes']:
        object_fields(item, ('paper_id', 'version_id', 'title', 'problem', 'approach', 'limitations', 'citation_ids'))
        for key in ('title', 'problem', 'approach', 'limitations'):
            text(item[key])
        paper = tools.material_version(text(item['paper_id'], 100), text(item['version_id'], 100))
        if paper['id'] in papers:
            raise ValueError('图谱论文重复')
        pages = json.loads(paper['pages'])
        if not any(p['text'].strip() for p in pages):
            raise ValueError('论文无可用原文，不能生成图谱节点')
        normalized = lambda value: re.sub(r'\W+', '', value).casefold()
        if normalized(item['title']) not in normalized(' '.join(p['text'] for p in pages)):
            raise ValueError('节点原标题必须可在该版本原文中核对')
        ids = evidence(item, paper['version_id'])
        papers[paper['id']] = paper
        materials.append({'paper_id': paper['id'], 'paper_version_id': paper['version_id'], 'title': paper['title']})
        nodes.append({'id': paper['id'], 'type': 'paper', 'title': item['title'], 'year': None,
                      'summary': item['problem'], 'role': '项目论文', 'version_id': paper['version_id'],
                      'evidence_ids': ids, 'pages': [{'page': p['page'], 'text': p['text']} for p in pages],
                      'is_text': paper['path'].startswith('paste:'),
                      'reader_summary': {'audience': 'field_familiar_unread', 'zh-CN': {
                          'background': spec['focus'], 'problem': item['problem'], 'approach': item['approach'],
                          'key_findings': [item['approach']], 'why_it_matters': item['problem'], 'limitations': [item['limitations']]}}})
    edges = []
    if spec['all_papers']:
        usable = {pid for pid, p in tools.allowed.items() if p.get('version_id') and pid not in failed_ids}
        if not usable <= papers.keys():
            raise ValueError('全量请求不能遗漏范围内有版本的材料；不可用项请先说明并调整范围')
    for index, item in enumerate(spec['edges']):
        object_fields(item, ('source', 'target', 'relationship', 'explanation', 'citation_ids'))
        for key in ('source', 'target', 'relationship'):
            text(item[key], 100)
        if item['source'] not in papers or item['target'] not in papers or item['source'] == item['target'] or item['relationship'] not in ('继承', '比较', '批评'):
            raise ValueError('图谱关系端点或类型无效')
        text(item['explanation'], 1200)
        ids = evidence(item, papers[item['target']]['version_id'])
        edges.append({'id': f'edge-{index}', 'source': item['source'], 'target': item['target'],
                      'relationship': [item['relationship']], 'explanation': item['explanation'],
                      'confidence': 0.5, 'evidence_level': '模型分析', 'evidence_ids': ids,
                      'citation_direction': '被研究论文 → 开展研究论文'})
    data = {'meta': {'title': title, 'focus': spec['focus'], 'generated_at': now(), 'output_language': 'zh-CN',
                     'warnings': spec['unverified'], 'coverage': {'范围': '用户要求全量' if spec['all_papers'] else '精选子集，默认至多15篇'},
                     'figure_policy': {'enabled': False}}, 'nodes': nodes, 'edges': edges,
            'citations': list(available.values())}
    errors, _ = validator.validate(data, UPSTREAM)
    if errors:
        raise ValueError('上游图谱校验失败：' + '; '.join(errors))
    with tempfile.TemporaryDirectory() as directory:
        graph, output = Path(directory) / 'graph.json', Path(directory) / 'index.html'
        graph.write_text(json_text(data), encoding='utf-8')
        subprocess.run([sys.executable, str(UPSTREAM / 'scripts/render_site.py'), str(graph), '-o', str(output)], check=True, capture_output=True, timeout=30)
        rendered = output.read_text('utf-8')
    nonce = secrets.token_hex(16)
    policy = f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
    rendered = rendered.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + html.escape(policy, quote=True) + '">')
    rendered = rendered.replace('<script>', f'<script nonce="{nonce}">')
    adaptation = Path(__file__).with_name('graph.js').read_text('utf-8')
    rendered = rendered.replace('</body>', f'<script nonce="{nonce}">{adaptation}</script></body>')
    return rendered.encode(), json_text(spec), {'graph': spec}, materials


def preview_graph(content):
    # Refresh only our presentation adapter, preserving saved data, CSP nonce and download bytes.
    return re.sub(r'(<script nonce="[^"]+">)\s*// Host-only adapter\.[\s\S]*?</script>', lambda match: match[1] + Path(__file__).with_name('graph.js').read_text('utf-8') + '</script>', content, count=1)


def restore_graph(service, project, artifact_id, request):
    object_fields(request, ('version_id', 'base_version_id'))
    store = service.store
    with store.transaction() as db:
        artifact = store.artifact(project, artifact_id)
        if not artifact or artifact['kind'] != 'graph':
            raise ValueError('图谱不属于当前项目')
        source = next((v for v in artifact['versions'] if v['id'] == request['version_id']), None)
        latest = artifact['versions'][-1]
        if not source:
            raise ValueError('恢复版本不属于该成果')
        if latest['payload'].get('restored_from') == source['id'] and latest['payload'].get('base_version_id') == request['base_version_id']:
            return {'version_id': latest['id']}
        if latest['id'] != request['base_version_id']:
            raise ValueError('成果已有新版，请刷新后恢复')
        service.file_path(project, source)  # Verify saved file and checksum before promotion.
        version_id = new_id('artifact_version')
        task = service.writing.task(project, '恢复论文关系图谱 v' + str(source['version_no']),
                                    conversation=store.task(source['task_id'])['conversation_id'])
        payload = {**source['payload'], 'base_version_id': latest['id'], 'restored_from': source['id']}
        db.execute('INSERT INTO artifact_versions(id,artifact_id,task_id,version_no,title,body,citations,materials,created,kind,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (version_id, artifact_id, task['id'], latest['version_no'] + 1, source['title'], source['body'],
                    json_text(source['citations']), json_text(source['materials']), now(), 'graph', json_text(payload)))
        db.execute('UPDATE artifacts SET title=?,updated=? WHERE id=?', (source['title'], now(), artifact_id))
        db.execute('UPDATE tasks SET artifact_id=? WHERE id=?', (artifact_id, task['id']))
        return {'version_id': version_id}
