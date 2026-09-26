"""Read-only paper checks using the existing Harness, discovery and version store."""
from .errors import failure_message
import hashlib
import html
import json
import re
from pathlib import Path

from .state import json_text, new_id, now

NAMES = {'novelty': '查新', 'citation': '引用核查', 'review': '独立论文审阅'}


def requested_mode(prompt):
    if re.match(r'^\s*(?:请)?\s*(?:解释|介绍|什么是|如何|怎么)', prompt):
        return None
    if re.search(r'(?:请|帮我)\s*(?:(?:根据|按照|按).{0,25}?(?:报告|意见|建议|结果))?\s*(?:修复|修改|修正)', prompt):
        return None
    for mode, pattern in (('review', r'独立.{0,4}(?:审阅|审稿)|independent (?:paper )?review'), ('citation', r'引用(?:核查|审计|核验)|citation audit'), ('novelty', r'查新|novelty check')):
        if re.search(pattern, prompt, re.I):
            return mode
    return None


def complete(research, task, system, context, role, tokens):
    system += '\n只返回一个JSON对象，所有字段放在同一对大括号中。不能连续输出多个JSON对象，也不加解释文字。'
    return research.complete(task, system, context, role, tokens)


def skill(mode):
    from .research_skills import ROOT, research_skills
    if mode not in NAMES:
        raise ValueError('未知论文核查能力')
    return research_skills(['research-paper-audit']) + '\n' + (ROOT/'research-paper-audit'/f'{mode}.md').read_text('utf-8')


def baseline(tools):
    task, store = tools.task, tools.store
    reference = task['refs'].get('reference')
    if reference:
        item = store.artifact(tools.project, reference['artifact_id'])
        version = next((v for v in item['versions'] if v['id'] == reference['version_id']), None) if item else None
        if not version or version['kind'] != 'manuscript':
            raise ValueError('请打开已保存的论文文档，或关闭成果后仅勾选一篇论文')
        citations = [store.citation(tools.project, c['id']) for c in version['citations'] if c['paper_id'] in tools.allowed]
        # Reuse exact saved locations in this conversation; never relax citation ownership.
        translated = {}
        with store.transaction() as db:
            store.assert_active(task['id'], task['revision'])
            for c in citations:
                row = store.one('SELECT location FROM evidence WHERE id=?', (c['id'],))
                cid = 'cite_' + hashlib.sha256((tools.conversation + c['paper_version_id'] + row['location']).encode()).hexdigest()[:32]
                db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?)', (cid, tools.project, tools.conversation, c['paper_id'], c['paper_version_id'], row['location']))
                db.execute('INSERT OR IGNORE INTO reads VALUES(?,?,?,?)', (tools.conversation, c['paper_id'], c['paper_version_id'], now()))
                translated[c['id']] = store.citation(tools.project, cid, tools.conversation)
        def manuscript_text(node):
            if node.get('type') == 'citation':
                c = translated.get(node['citation_id'])
                return '[cite:' + c['id'] + ']' if c else '【引用超出本轮范围】'
            if node.get('type') == 'equation':
                return node['formula']
            return node.get('text', '') if 'text' in node else ''.join(manuscript_text(child) for child in node.get('children', []))
        locations = {node['id']: manuscript_text(node) for node in version['payload']['document']}
        citations = list(translated.values())
        identity = {**reference, 'title': version['title'], 'version_no': version['version_no']}
    else:
        selected = task['selected_paper_ids']
        if len(selected) != 1:
            raise ValueError('请打开一个已保存的论文版本，或仅勾选一篇待核查论文后发送；其他材料仍可作为依据')
        paper = tools.material_version(selected[0])
        locations, citations, offset = {}, [], 0
        while True:
            result = tools.call('read_material', {'paper_id': selected[0], 'version_id': paper['version_id'], 'offset': offset, 'limit': 12})
            for c in result['evidence']:
                locations[f"第{c['page']}页/块{c['block']}"] = c['quote']
                citations.append(c)
            if sum(map(len, locations.values())) > 160000:
                raise ValueError('原稿超过本次16万字符容量，请将待审章节保存为独立论文文档；未截断审阅')
            if result['next_offset'] is None:
                break
            offset = result['next_offset']
        identity = {'paper_id': paper['id'], 'version_id': paper['version_id'], 'title': paper['title']}
    if not any(t.strip() for t in locations.values()):
        raise ValueError('原稿没有可用文字，未执行核查；图像型PDF尚不支持OCR')
    # Design limit: bounded full draft; explicit failure instead of silently omitting chapters.
    if len(json_text(locations)) > 180000:
        raise ValueError('原稿超过本次容量，请缩小为待审章节；未截断审阅')
    identity['sha256'] = hashlib.sha256(json_text(locations).encode()).hexdigest()
    return identity, locations, citations


def run(research, task):
    from .agent import ProjectTools
    store = research.store
    mode = task['checkpoint']['route']['audit']
    system = skill(mode)
    tools = ProjectTools(store, task)
    tools.research = research
    tools.set_scope(task['checkpoint']['route']['only_selected'])
    identity, locations, original = baseline(tools)
    checkpoint = store.task(task['id'])['checkpoint']
    frozen = checkpoint.get('audit_baseline')
    if frozen and frozen != identity:
        raise ValueError('核查原稿与冻结基线不一致，旧报告保留')
    store.update_active(task['id'], task['revision'], checkpoint={**checkpoint, 'audit_baseline': identity, 'audit_skill': {'mode': mode, 'source': 'MethodAtlas builtin_skills/research-paper-audit · 2026-09', 'prompt_sha256': hashlib.sha256(system.encode()).hexdigest()}})
    store.event(task['id'], 'audit', NAMES[mode] + '：已冻结原稿；独立上下文不读取聊天或作者总结')
    if checkpoint.get('audit_prepared'):
        finish(tools, identity, mode, checkpoint['audit_prepared'])
        return
    context = {'mode': mode, 'request': task['prompt'], 'as_of_utc': now(), 'external_search_allowed': not task['checkpoint']['route']['only_selected'], 'baseline': identity, 'locations': locations, 'material_catalog': tools.list_materials()['materials']}
    plan = checkpoint.get('audit_plan')
    if plan is None:
        plan = complete(research, task, system + '''\n先规划取证，返回 {"searches":[{"direction":"机制/应用/结果/元数据","query":"2至500字符的检索要求"}],"reads":[{"paper_id":"目录ID","query":"原文关键词"}]}。
只规划本次mode所需取证：novelty对机制、应用、结果各给一个研究问题，不混入独立的元数据审计。GPT Researcher本身会拆分查询与多轮追查，不重复规划同义查询。citation逐条参考文献搜索真实记录。review只按原稿漏洞需要检索。external_search_allowed=false时searches为空，仅从目录取证并标明覆盖限制。reads最多12项；不足明确留待核验，不编造材料。''', context, 'audit-plan', 8192)
        searches, reads = plan.get('searches'), plan.get('reads')
        if not isinstance(searches, list) or not isinstance(reads, list) or len(reads) > 12:
            raise ValueError('核查取证计划格式无效')
        if mode == 'novelty' and context['external_search_allowed'] and not {'机制', '应用', '结果'} <= {s.get('direction') for s in searches}:
            raise ValueError('查新计划缺少机制、应用或结果方向，未判通过')
        for search in searches:
            if not isinstance(search.get('query'), str) or not 2 <= len(search['query'].strip()) <= 500 or not isinstance(search.get('direction'), str):
                raise ValueError('核查查询格式无效')
        for read in reads:
            if set(read) != {'paper_id', 'query'} or read['paper_id'] not in tools.allowed or not isinstance(read['query'], str):
                raise ValueError('核查取材超出项目或指定范围')
        checkpoint = store.task(task['id'])['checkpoint']
        store.update_active(task['id'], task['revision'], checkpoint={**checkpoint, 'audit_plan': plan})
    saved_review = checkpoint.get('audit_review_evidence')
    if saved_review is None:
        sources, coverage, gaps = {}, [], []
        for search in plan['searches']:
            store.assert_active(task['id'], task['revision'])
            try:
                result = tools.call('search_papers', {'query': search['query']})
                wait = store.one('SELECT payload FROM task_waits WHERE id=? AND task_id=?', (result['search_id'], task['id']))
                payload = json.loads(wait['payload'])
                row = {**search, 'search_id': result['search_id'], 'sources': payload['sources'], 'warning': payload.get('warning'), 'records': []}
                for candidate in payload['candidates']:
                    sid = 'S' + str(len(sources) + 1)
                    sources[sid] = {'search_id': result['search_id'], 'candidate_id': candidate['id'], **candidate['preferred']}
                    row['records'].append(sid)
                coverage.append(row)
            except (ValueError, OSError, TimeoutError) as exc:
                gaps.append(search["direction"] + "：" + failure_message(store, exc, task_id=task["id"], operation="audit_search"))
        evidence = {c['id']: c for c in original}
        for read in plan['reads']:
            try:
                result = tools.call('read_material', {**read, 'limit': 4})
                evidence.update({c['id']: c for c in result['evidence']})
                if not result['evidence']:
                    gaps.append(read['query'] + '：未命中原文')
            except (ValueError, OSError, TimeoutError) as exc:
                gaps.append(read['query'] + '：' + failure_message(store, exc, task_id=task['id'], operation='audit_read'))
    else:
        evidence = saved_review['evidence']
        sources, coverage, gaps = saved_review['sources'], saved_review['coverage'], saved_review['gaps']
    if gaps:
        with store.transaction():
            refs = store.task(task['id'])['refs']
            store.update_active(task['id'],task['revision'],refs={**refs,'partial_gaps':gaps})
    # The reviewer sees original evidence only, never the planner's reasoning or chat.
    evidence_view = {tools.references.alias(cid): {'citation_id': cid, **{k: c[k] for k in ('quote', 'title', 'paper_version_id', 'page', 'block')}} for cid, c in evidence.items()}
    context.update(evidence=evidence_view, search_records=sources, search_coverage=coverage, gaps=gaps)
    if len(json_text(context)) > 300000:
        raise ValueError('核查依据超过本次容量，请按章节拆分；没有截断后宣称核查完成')
    result = checkpoint.get('audit_result')
    if result is None:
        result = complete(research, task, system + '''\n生成核查报告 JSON：{"summary":"结论及范围（查新须说明三方向差异和最近工作）","limitations":["未核验范围"],"findings":[{"location":"原稿位置表中的键","quote":"该位置逐字原句（非空）","severity":"严重/主要/次要/提示","finding":"具体问题或核查结果","evidence_ids":["E1或S1"],"evidence_quotes":[{"id":"E1","quote":"直接支持本项的连续原句，最多420字符"}],"support":"全文核验/摘要支持/元数据核验/未核验","suggestion":"具体建议"}],"recommendations":[{"source_id":"相关的S编号","reason":"一句中文收录理由"}]}。
    遵循request中的检查重点、字数与范围。引用核查逐项覆盖请求范围内的引用，不只列格式错误；独立审阅优先列影响结论的问题；查新比较最接近工作，不重复其他模式的报告。引用整段原文时必须在evidence_quotes逐字选取直接支持本项的一句或相邻短句，不改写原文。全文核验须有已读取原文E编号；搜索S编号只能支持元数据/摘要层级。仅核对作者、年份、出处时标元数据核验，不能标摘要支持。缺证据标未核验。locations是完整冻结原稿，不假设另有未提供章节；其他论文证据只是实际读取片段。日期判断依据as_of_utc，不凭模型记忆判未来。不得把单篇论文的实验设置宣称为整个领域的最低标准。recommendations只推荐需要进一步阅读全文且相关的候选，可为空。不要输出任何文件或修改后的原稿。''', context, 'audit-review', 16384)
        # Store before rendering/validation; a local failure must not buy another review.
        # Persist aliases too, so a resumed read order cannot rebind E numbers.
        checkpoint = store.task(task['id'])['checkpoint']
        store.update_active(task['id'],task['revision'],checkpoint={**checkpoint,'audit_result':result,'audit_references':dict(tools.references.ids),'audit_review_evidence':{'evidence':evidence,'sources':sources,'coverage':coverage,'gaps':gaps}})
    else:
        tools.references.ids = checkpoint['audit_references']
        tools.references.aliases = {cid:alias for alias,cid in tools.references.ids.items()}
    content, citations = render(result, {**identity,'title':identity['title']+' · '+NAMES[mode]}, locations, evidence, tools.references, sources, coverage, gaps)
    recommendations = result.get('recommendations', [])
    if not isinstance(recommendations, list):
        raise ValueError('核查候选推荐格式无效')
    groups = {}
    for recommendation in recommendations:
        if not isinstance(recommendation, dict) or recommendation.get('source_id') not in sources or not isinstance(recommendation.get('reason'), str):
            raise ValueError('推荐不是本次真实检索候选')
        source = sources[recommendation['source_id']]
        groups.setdefault(source['search_id'], []).append({'candidate_id': source['candidate_id'], 'reason': recommendation['reason']})
    prepared = {'result': result, 'content': content, 'citations': citations, 'coverage': coverage, 'recommendations': groups}
    checkpoint = store.task(task['id'])['checkpoint']
    store.update_active(task['id'], task['revision'], checkpoint={**checkpoint, 'audit_prepared': prepared})
    finish(tools, identity, mode, prepared)


def finish(tools, identity, mode, prepared):
    store, task = tools.store, tools.task
    for search_id, papers in prepared['recommendations'].items():
        try:
            tools.call('present_papers', {'search_id': search_id, 'summary': '核查中发现的相关论文，收录后发送新要求可继续核验。', 'papers': papers})
        except ValueError as exc:
            store.event(task['id'], 'audit_candidates', '候选展示未完成：' + failure_message(store, exc, task_id=task['id'], operation='audit_candidates'))
    # Existing atomic/idempotent file commit; no model receives a writing tool.
    saved = tools.call('write_file', {'title': identity['title'] + ' · ' + NAMES[mode], 'kind': 'html', 'content': prepared['content'], 'citation_ids': prepared['citations'], 'output_key': 'audit-report'})
    with store.transaction() as db:
        store.assert_active(task['id'], task['revision'])
        checkpoint = store.task(task['id'])['checkpoint']
        store.update_active(task['id'], task['revision'], checkpoint={**checkpoint, 'audit_report': prepared['result'], 'audit_coverage': prepared['coverage']}, status='succeeded')
        answer = f"{NAMES[mode]}报告已生成，基线 {identity['version_id']}。原稿未修改。\n\n[打开报告]({saved['url']})\n\n如需修复，请打开原稿，在现有 AI 修改区提交报告中的具体修改要求；查看差异后再采纳。"
        db.execute("INSERT INTO messages(id,conversation_id,role,text,created,task_id) VALUES(?,?,'assistant',?,?,?)", (new_id('message'), task['conversation_id'], answer, now(), task['id']))
        store.event(task['id'], 'completed', '核查报告已保存；未核验项不代表通过')


def render(result, identity, locations, evidence, references, sources, coverage, gaps):
    if not isinstance(result.get('summary'), str) or not isinstance(result.get('limitations'), list) or not all(isinstance(s, str) for s in result['limitations']) or not isinstance(result.get('findings'), list):
        raise ValueError('核查报告格式不完整，未保存')
    esc = html.escape
    parts = [f"<article class='research-view'><p class='report-eyebrow'>论文体检</p><h1>{esc(identity['title'])}</h1><p class='report-summary'>{esc(result['summary'])}</p>"]
    citations, cited_sources = [], set()
    priority = {'严重':0, '主要':1, '次要':2, '提示':3}
    for number,finding in enumerate(sorted(result['findings'], key=lambda item: priority.get(item.get('severity'),4)),1):
        if any(not isinstance(finding.get(k), str) or not finding[k].strip() for k in ('location', 'quote', 'severity', 'finding', 'support', 'suggestion')):
            raise ValueError('发现缺少位置、原句、严重性或建议')
        if finding['severity'] not in ('严重', '主要', '次要', '提示') or finding['support'] not in ('全文核验', '摘要支持', '元数据核验', '未核验'):
            raise ValueError('核查严重性或支持层级无效')
        ids = finding.get('evidence_ids')
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ValueError('核查证据编号无效')
        links, fulltext = [], False
        for cid in dict.fromkeys(ids):
            if cid in sources:
                cited_sources.add(cid)
                links.append(esc(cid) + '（检索来源）')
            else:
                actual = references.resolve(cid)
                if actual not in evidence:
                    raise ValueError('核查证据不是本次读取的原文')
                citation = evidence[actual]
                citations.append(actual)
                # Abstract-only sources have no PDF rectangles.
                fulltext |= citation.get('rect') is not None
                links.append(f'<button data-citation="{actual}"></button>')
        quote = re.sub(r'\[cite:[^\]]+\]', '【原稿引用】', finding['quote'])
        location = finding['location']
        parts.append(f'<h2>{esc(finding["severity"])} · 第 {number} 项 · {esc(location)}</h2><blockquote>{esc(quote)}</blockquote><p>{esc(finding["finding"])}</p><p>相关材料：' + '；'.join(links) + f'</p><p>建议：{esc(finding["suggestion"])}</p>')
    if cited_sources:
        parts.append('<h2>补充检索来源</h2>')
        for sid in sorted(cited_sources):
            source = sources[sid]
            parts.append('<p>' + esc(sid + ' · ' + str(source.get('title', '无标题'))) + '<br>' + esc(str(source.get('url') or source.get('doi') or '来源地址缺失')) + '</p>')
    limits = list(dict.fromkeys(result['limitations']))
    if limits:
        parts.append('<h2>核查范围</h2><ul>' + ''.join('<li>' + esc(g) + '</li>' for g in limits) + '</ul>')
    parts.append('</article>')
    return ''.join(parts), list(dict.fromkeys(citations))
