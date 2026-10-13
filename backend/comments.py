"""Version-pinned shared discussions with conservative, verifiable text anchors."""
import copy
import hashlib
import json
import re
from html.parser import HTMLParser

from .errors import AppError
from .state import json_text, new_id, now
from .writing import selection_text


class ReportText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip, self.parts = [], []

    def handle_starttag(self, tag, attrs):
        if tag in ('head', 'script', 'style', 'template'):
            self.skip.append(tag)

    def handle_endtag(self, tag):
        if self.skip and self.skip[-1] == tag:
            self.skip.pop()

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class Comments:
    def __init__(self, service):
        self.service, self.store, self.access = service, service.store, service.collaboration
        with self.store.lock, self.store.db:
            self.store.db.executescript('''
                CREATE TABLE IF NOT EXISTS comment_threads(
                    id TEXT PRIMARY KEY,project_id TEXT NOT NULL,artifact_id TEXT NOT NULL,
                    version_id TEXT NOT NULL,anchor TEXT NOT NULL,created_by TEXT NOT NULL,
                    resolved INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,
                    created TEXT NOT NULL,updated TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS comments_artifact ON comment_threads(project_id,artifact_id,created);
                CREATE TABLE IF NOT EXISTS comment_messages(
                    id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,actor_id TEXT NOT NULL,
                    body TEXT NOT NULL,mentions TEXT NOT NULL,created TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS comments_thread ON comment_messages(thread_id,created);
                CREATE TABLE IF NOT EXISTS comment_requests(
                    actor_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
                    thread_id TEXT NOT NULL,PRIMARY KEY(actor_id,request_id));
            ''')
            if 'target_kind' not in {r['name'] for r in self.store.all('PRAGMA table_info(comment_threads)')}:
                self.store.db.execute("ALTER TABLE comment_threads ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'artifact'")

    def artifact(self, user, project, artifact, write=False, target_kind='artifact'):
        self.access.project(user, project, write=write)
        if target_kind == 'paper':
            paper = self.store.paper(project, artifact)
            if not paper or paper['status'] == 'removed':
                raise PermissionError('文献不可访问')
            return paper
        self.access.artifact(user, project, artifact)
        scope = self.store.one('SELECT visibility FROM artifact_scopes WHERE artifact_id=?', (artifact,))
        if scope and scope['visibility'] != 'shared':
            raise PermissionError('共享评论需要先发布成果')
        return self.store.artifact(project, artifact)

    def version(self, project, artifact, version=None, target_kind='artifact'):
        if target_kind == 'paper':
            paper = self.store.paper(project, artifact, version)
            if not paper:
                raise PermissionError('文献版本不可访问')
            return {**paper, 'id': paper['version_id'], 'kind': 'paper'}
        item = self.store.artifact(project, artifact)
        if item['kind'] == 'manuscript':
            return self.service.writing.version(project, artifact, None if version == 'draft' else version)
        return self.service.file_version(project, artifact, version or item['versions'][-1]['id'])

    def anchor(self, version, body):
        supplied = body.get('anchor')
        if version['kind'] == 'paper':
            if supplied is None:
                return {'kind': 'paper', 'version_id': version['id']}
            if not isinstance(supplied, dict) or supplied.get('kind') != 'paper':
                raise ValueError('评论选区无效，请重新选择文字')
            if supplied.get('fragments'):
                fragments = supplied['fragments']
                if not isinstance(fragments, list) or not 1 <= len(fragments) <= 100:
                    raise ValueError('评论原文片段无效')
                checked = [self.anchor(version, {'anchor':{**f, 'kind':'paper'}}) for f in fragments if isinstance(f, dict) and 'fragments' not in f]
                if len(checked) != len(fragments) or sum(len(f.get('quote', '')) for f in checked) > 10000:
                    raise ValueError('评论原文片段无效或过长')
                if supplied.get('page') != checked[0]['page'] or supplied.get('quote') != checked[0]['quote']:
                    raise ValueError('评论原文首页不一致')
                return {**checked[0], 'fragments':checked, 'quote':'\n'.join(f['quote'] for f in checked)}
            page, location = self.service.reader.location(version, supplied)
            quote = location['quote']
            start, end = supplied.get('start'), supplied.get('end')
            if quote:
                if start is None and end is None and page['text'].count(quote) == 1:
                    start = page['text'].index(quote)
                    end = start + len(quote)
                if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(page['text']) or page['text'][start:end] != quote:
                    raise ValueError('引用与所选版本不一致，请重新选择文字')
            elif not location['rects']:
                raise ValueError('评论引用不能为空且最多 10000 字符')
            return {**location, 'kind': 'paper', 'version_id': version['id'], 'page': page['page'], 'start': start, 'end': end}
        if supplied is None:
            return {'kind': 'artifact'}
        if not isinstance(supplied, dict) or supplied.get('kind') not in ('document', 'preview'):
            raise ValueError('评论选区无效，请重新选择文字')
        quote = supplied.get('quote')
        if not isinstance(quote, str) or not quote.strip() or len(quote) > 10000:
            raise ValueError('评论引用不能为空且最多 10000 字符')
        if supplied['kind'] == 'document':
            if version['kind'] != 'manuscript':
                raise ValueError('评论选区无效，请重新选择文字')
            nodes, selection = version['payload']['document'], supplied.get('selection')
            if selection_text(nodes, selection) != quote:
                raise ValueError('引用与所选版本不一致，请重新选择文字')
            low, high = sorted(p['path'][0] for p in selection.values())
            blocks = [{'id': n['id'], 'digest': digest(n)} for n in nodes[low:high + 1]]
            return {'kind': 'document', 'quote': quote, 'selection': selection, 'blocks': blocks, 'start': low}
        if version['kind'] not in ('html', 'docx', 'research', 'graph'):
            raise ValueError('此成果请使用整项评论')
        # Preview layout can renumber citations and headings. The immutable source
        # must still contain the chosen text; location is rechecked by the preview.
        parser = ReportText()
        parser.feed(version['body'] if version['kind'] in ('html', 'graph') else '')
        source = ''.join(parser.parts) if version['kind'] in ('html', 'graph') else version['body']
        if version['kind'] in ('docx', 'research'):
            source = re.sub(r'\*\*|__|`', '', source)
        compact = lambda text: re.sub(r'\s+', '', text)
        if compact(quote) not in compact(source):
            raise ValueError('引用与所选版本不一致，请重新选择文字')
        locator = supplied.get('locator')
        if not isinstance(locator, dict) or set(locator) != {'start', 'end', 'text', 'path'} or not isinstance(locator['text'], str) or len(locator['text']) > 40000:
            raise ValueError('评论选区无效，请重新选择文字')
        if not isinstance(locator['path'], list) or len(locator['path']) > 30 or any(type(i) is not int or i < 0 for i in locator['path']):
            raise ValueError('评论选区无效，请重新选择文字')
        if any(type(locator[k]) is not int for k in ('start', 'end')) or not 0 <= locator['start'] < locator['end']:
            raise ValueError('评论选区无效，请重新选择文字')
        try:
            picked = locator['text'].encode('utf-16-le')[locator['start'] * 2:locator['end'] * 2].decode('utf-16-le')
        except UnicodeError:
            raise ValueError('评论选区无效，请重新选择文字') from None
        if picked != quote:
            raise ValueError('评论选区无效，请重新选择文字')
        return {'kind': 'preview', 'quote': quote, 'locator': locator, 'body_digest': digest(version['body'])}

    def locate(self, anchor, version):
        if anchor['kind'] == 'paper':
            return {**anchor, 'status': 'attached' if anchor['version_id'] == version['id'] else 'changed'}
        if anchor['kind'] == 'artifact':
            return {'status': 'artifact'}
        if anchor['kind'] == 'preview':
            return {'status': 'attached', 'locator': anchor['locator']} if digest(version['body']) == anchor['body_digest'] else {'status': 'changed'}
        nodes = version.get('payload', {}).get('document', [])
        indices = []
        for block in anchor['blocks']:
            found = [i for i, n in enumerate(nodes) if n.get('id') == block['id'] and digest(n) == block['digest']]
            if len(found) != 1:
                return {'status': 'changed'}
            indices.append(found[0])
        if indices != list(range(indices[0], indices[0] + len(indices))):
            return {'status': 'changed'}
        selection = copy.deepcopy(anchor['selection'])
        for point in selection.values():
            point['path'][0] += indices[0] - anchor['start']
        try:
            if selection_text(nodes, selection) != anchor['quote']:
                return {'status': 'changed'}
        except ValueError:
            return {'status': 'changed'}
        return {'status': 'attached', 'selection': selection}

    def list(self, user, project, artifact, version=None, target_kind='artifact'):
        with self.store.transaction():
            self.artifact(user, project, artifact, target_kind=target_kind)
            viewed = self.version(project, artifact, version, target_kind=target_kind)
            result = []
            for row in self.store.all('SELECT * FROM comment_threads WHERE project_id=? AND artifact_id=? AND target_kind=? ORDER BY created,id', (project, artifact, target_kind)):
                thread = dict(row)
                anchor = json.loads(thread.pop('anchor'))
                thread.update(quote=anchor.get('quote', ''), location=self.locate(anchor, viewed))
                thread['messages'] = [{**dict(m), 'mentions': json.loads(m['mentions'])} for m in self.store.all('SELECT m.*,u.email FROM comment_messages m JOIN collab_users u ON u.id=m.actor_id WHERE m.thread_id=? ORDER BY m.created,m.rowid', (row['id'],))]
                result.append(thread)
            return {'version_id': viewed['id'], 'threads': result}

    def change(self, user, project, artifact, thread_id, action, body, target_kind='artifact'):
        request = body.get('request_id')
        if not isinstance(request, str) or not 1 <= len(request) <= 100:
            raise ValueError('评论需要稳定请求标识')
        fingerprint = digest([project, artifact, thread_id, action, body] + ([target_kind] if target_kind != 'artifact' else []))
        with self.store.transaction() as db:
            self.artifact(user, project, artifact, write=True, target_kind=target_kind)
            prior = db.execute('SELECT * FROM comment_requests WHERE actor_id=? AND request_id=?', (user['id'], request)).fetchone()
            if prior:
                if prior['fingerprint'] != fingerprint:
                    raise AppError('conflict', '评论请求标识已用于其他内容')
                return {'thread_id': prior['thread_id'], 'duplicate': True}
            thread = db.execute('SELECT * FROM comment_threads WHERE id=? AND project_id=? AND artifact_id=? AND target_kind=?', (thread_id, project, artifact, target_kind)).fetchone() if thread_id else None
            if thread_id and not thread:
                raise PermissionError('评论不属于此成果')
            if action in ('create', 'reply'):
                text, mentions = body.get('text'), body.get('mentions', [])
                if not isinstance(text, str) or not text.strip() or len(text) > 10000:
                    raise ValueError('评论不能为空且最多 10000 字符')
                if not isinstance(mentions, list) or len(mentions) > 20 or any(not isinstance(m, str) for m in mentions):
                    raise ValueError('评论提醒成员无效')
                # Typing an @email has the same meaning as using the member picker.
                typed = [r['id'] for r in db.execute('SELECT u.id,u.email FROM project_members m JOIN collab_users u ON u.id=m.user_id WHERE m.project_id=?', (project,))
                         if re.search(r'(?<![\w@])@' + re.escape(r['email']) + r'(?![\w@.+-])', text)]
                mentions = sorted(set(mentions + typed))
                if len(mentions) > 20:
                    raise ValueError('评论提醒成员无效')
                for member in set(mentions):
                    row = db.execute('SELECT u.email FROM project_members m JOIN collab_users u ON u.id=m.user_id WHERE m.project_id=? AND m.user_id=?', (project, member)).fetchone()
                    if not row or '@' + row['email'] not in text:
                        raise ValueError('评论提醒成员无效')
                if action == 'create':
                    if not isinstance(body.get('version_id'), str) or not body['version_id'] or body['version_id'] == 'draft':
                        raise ValueError('评论必须绑定实际内容版本')
                    version = self.version(project, artifact, body['version_id'], target_kind=target_kind)
                    anchor = self.anchor(version, body)
                    if version['kind'] == 'manuscript':
                        self.service.writing.snapshot(project, artifact, {'version_id': version['id']})
                    thread_id = new_id('comment')
                    db.execute('INSERT INTO comment_threads(id,project_id,artifact_id,version_id,anchor,created_by,resolved,revision,created,updated,target_kind) VALUES(?,?,?,?,?,?,0,1,?,?,?)', (thread_id, project, artifact, version['id'], json_text(anchor), user['id'], now(), now(), target_kind))
                elif not thread:
                    raise ValueError('请选择需要回复的评论')
                db.execute('INSERT INTO comment_messages VALUES(?,?,?,?,?,?)', (new_id('reply'), thread_id, user['id'], text.strip(), json_text(sorted(set(mentions))), now()))
                if action == 'reply':
                    db.execute('UPDATE comment_threads SET revision=revision+1,updated=? WHERE id=?', (now(), thread_id))
                for member in set(mentions) - {user['id']}:
                    db.execute('INSERT INTO project_notifications VALUES(?,?,?,?,?,?,?,NULL)', (new_id('notification'), project, member, user['id'], 'comment_mentioned', thread_id, now()))
                event = 'comment_created' if action == 'create' else 'comment_replied'
            elif action in ('resolve', 'reopen') and thread:
                if type(body.get('revision')) is not int or thread['revision'] != body['revision']:
                    raise AppError('conflict', '评论已有新回复或状态，请刷新后重试')
                db.execute('UPDATE comment_threads SET resolved=?,revision=revision+1,updated=? WHERE id=?', (int(action == 'resolve'), now(), thread_id))
                event = 'comment_resolved' if action == 'resolve' else 'comment_reopened'
            else:
                raise ValueError('评论操作无效')
            self.access.event(project, user['id'], event, thread_id, {('paper_id' if target_kind == 'paper' else 'artifact_id'): artifact})
            db.execute('INSERT INTO comment_requests VALUES(?,?,?,?)', (user['id'], request, fingerprint, thread_id))
            return {'thread_id': thread_id, 'duplicate': False}
