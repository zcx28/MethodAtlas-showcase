"""Comment checks called by the real HTTP collaboration fixture."""
import copy

from .state import json_text, new_id, now


def check_comments(service, request, root, project, users, owner, member, outsider):
    store, writing = service.store, service.writing
    nodes = [{'id': 'intro', 'type': 'p', 'children': [{'text': '研究 😀 原文，需要核验。'}]},
             {'id': 'tail', 'type': 'p', 'children': [{'text': '另一个段落。'}]}]
    made = writing.save(project, None, {'request_id': 'comment-check', 'title': '协作评论文稿', 'document': nodes})
    aid = made['artifact_id']; base = root + '/artifacts/' + aid + '/comments'
    draft_nodes = copy.deepcopy(nodes)
    draft_nodes[1]['children'][0]['text'] = '评论前的自动保存草稿。'
    draft = writing.save_draft(project, aid, {'request_id': 'comment-draft', 'base_version_id': made['version_id'], 'title': '协作评论文稿', 'document': draft_nodes})
    source = draft['version_id']
    body = {'request_id': 'comment-create', 'version_id': source, 'text': '@member@example.com 请核验这段依据。',
            'mentions': [users['member@example.com']['id']], 'anchor': {'kind': 'document', 'quote': '😀 原文',
            'selection': {'anchor': {'path': [0, 0], 'offset': 3}, 'focus': {'path': [0, 0], 'offset': 8}}}}
    status, first, _ = request(base, body, owner)
    assert status == 201, first
    thread = first['thread_id']
    assert request(base, body, owner)[1]['duplicate']
    assert len(request(base, cookie=member)[1]['threads']) == 1
    assert request(base, {**body, 'text': 'reuse altered payload'}, owner)[0] == 409
    assert request(base, cookie=outsider)[0] == 403
    assert request(base, {**body, 'request_id': 'forged', 'anchor': {**body['anchor'], 'quote': '伪造原文'}}, owner)[0] == 400
    assert request(base, {**body, 'request_id': 'half-emoji', 'anchor': {**body['anchor'], 'selection': {'anchor': {'path': [0, 0], 'offset': 4}, 'focus': {'path': [0, 0], 'offset': 8}}}}, owner)[0] == 400
    assert request(base, {**body, 'request_id': 'bad-member', 'mentions': [users['outsider@example.com']['id']]}, owner)[0] == 400
    assert len([n for n in request(root + '/notifications', cookie=member)[1]['notifications'] if n['entity_id'] == thread]) == 1
    typed = request(base, {'request_id': 'typed-mention', 'version_id': source, 'text': '@member@example.com 自动识别邮箱提醒。'}, owner)
    assert typed[0] == 201
    typed_notice = next(n for n in request(root + '/notifications', cookie=member)[1]['notifications'] if n['entity_id'] == typed[1]['thread_id'])
    assert typed_notice['artifact_id'] == aid and typed_notice['title'] == '协作评论文稿'
    assert store.one('SELECT 1 FROM writing_snapshots WHERE id=?', (source,))
    assert len(store.artifact(project, aid)['versions']) == 1, 'comments accidentally created manual archives'

    reply = {'request_id': 'reply-create', 'text': '已核对，建议补充实验条件。'}
    assert request(base + '/' + thread + '/reply', reply, member)[0] == 200
    assert request(base + '/' + thread + '/reply', reply, member)[1]['duplicate']
    assert request(base + '/' + thread + '/resolve', {'request_id': 'stale-resolve', 'revision': 1}, owner)[0] == 409
    assert request(base + '/' + thread + '/resolve', {'request_id': 'resolve', 'revision': 2}, owner)[0] == 200
    resolved = next(t for t in request(base, cookie=member)[1]['threads'] if t['id'] == thread)
    assert resolved['resolved'] and len(resolved['messages']) == 2
    assert request(base + '/' + thread + '/reopen', {'request_id': 'reopen', 'revision': 3}, member)[0] == 200

    moved = [draft_nodes[1], draft_nodes[0]]
    next_draft = writing.save_draft(project, aid, {'request_id': 'comment-move', 'base_version_id': source, 'title': '协作评论文稿', 'document': moved})
    relocated = next(t for t in request(base, cookie=member)[1]['threads'] if t['id'] == thread)
    assert relocated['location']['status'] == 'attached'
    assert relocated['location']['selection']['anchor']['path'][0] == 1
    changed = copy.deepcopy(moved); changed[1]['children'][0]['text'] = '原段落已重写。'
    # Same quote elsewhere must never be mistaken for the original anchor.
    changed.append({'id': 'unrelated', 'type': 'p', 'children': [{'text': '研究 😀 原文，需要核验。'}]})
    writing.save_draft(project, aid, {'request_id': 'comment-change', 'base_version_id': next_draft['version_id'], 'title': '协作评论文稿', 'document': changed})
    lost = next(t for t in request(base, cookie=member)[1]['threads'] if t['id'] == thread)
    assert lost['location']['status'] == 'changed' and lost['quote'] == '😀 原文'
    original = next(t for t in request(base + '?version_id=' + source, cookie=member)[1]['threads'] if t['id'] == thread)
    assert original['location']['status'] == 'attached'
    preview = request(root + '/documents/' + aid + '?version_id=' + source, cookie=member)[1]
    assert preview['viewed_snapshot']['payload']['document'] == draft_nodes
    assert len(preview['versions']) == 1
    store.run("INSERT OR REPLACE INTO artifact_scopes VALUES(?,?,'private')", (aid, users['owner@example.com']['id']))
    assert request(base, cookie=member)[0] == 403
    assert request(base, cookie=owner)[0] == 403, 'private discussions leaked into shared comments'
    assert not any(n['entity_id'] in (thread, typed[1]['thread_id']) for n in request(root + '/notifications', cookie=member)[1]['notifications'])
    store.run("UPDATE artifact_scopes SET visibility='shared' WHERE artifact_id=?", (aid,))

    # Reports use fixed preview text/offsets and never migrate a path to changed bytes.
    html_id, version = new_id('artifact'), new_id('artifact_version')
    task = writing.task(project, '报告评论检查')
    store.run('INSERT INTO artifacts VALUES(?,?,?,?,?,?)', (html_id, project, '报告评论检查', 'html', now(), now()))
    store.run("INSERT INTO artifact_versions(id,artifact_id,task_id,version_no,title,body,citations,materials,created,kind,payload) VALUES(?,?,?,1,?,?,'[]','[]',?,'html','{}')",
              (version, html_id, task['id'], '报告评论检查', '<html><body><p>实验结果 <b>显著改善</b>，有待复验。</p><script>不是正文</script></body></html>', now()))
    report_base = root + '/artifacts/' + html_id + '/comments'
    report = {'request_id': 'report-comment', 'version_id': version, 'text': '请解释指标。', 'anchor': {'kind': 'preview', 'quote': '显著改善', 'locator': {'start': 5, 'end': 9, 'text': '实验结果 显著改善，有待复验。', 'path': [0]}}}
    assert request(report_base, report, member)[0] == 201
    assert request(report_base, {**report, 'request_id': 'report-false', 'version_id': source}, member)[0] == 400
    assert request(report_base, {**report, 'request_id': 'script-not-text', 'anchor': {'kind': 'preview', 'quote': '不是正文', 'locator': {'start': 0, 'end': 4, 'text': '不是正文', 'path': [1]}}}, member)[0] == 400
    report_list = request(report_base, cookie=owner)[1]['threads']
    assert report_list[0]['location']['status'] == 'attached'
    whole = request(report_base, {'request_id': 'whole-report', 'version_id': version, 'text': '整项评论'}, owner)
    assert whole[0] == 201
    assert request(base + '/' + whole[1]['thread_id'] + '/reply', {'request_id': 'wrong-thread', 'text': 'wrong'}, owner)[0] == 403
    print('PASS: comment anchors, fixed draft snapshots, moved/changed text, report quotes, replies/mentions, idempotency, resolve/reopen and isolation')
