"""Read-only keyword search over saved project content, without model calls."""
import json
import re
import unicodedata
from html.parser import HTMLParser


def normalized(value):
    return unicodedata.normalize('NFKC', str(value or '')).lower()


class VisibleText(HTMLParser):
    def __init__(self, value):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0
        self.feed(value)

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)


def plain(value):
    return ' '.join(' '.join(VisibleText(value or '').parts).split())


def authors(metadata):
    value = metadata.get('authors', [])
    if isinstance(value, str): return value
    return ' '.join(str(item.get('name') or item.get('display_name') or '') if isinstance(item, dict) else str(item) for item in value or [])


def search(service, query, user=None):
    if service.collaboration.online and not user:
        raise PermissionError('搜索需要已验证的操作者')
    q = query.get('q', [''])[0].strip()
    scope = query.get('scope', ['project'])[0]
    project = query.get('project_id', [''])[0]
    kind = query.get('kind', ['all'])[0]
    offset = query.get('offset', ['0'])[0]
    if len(q) > 200 or scope not in ('materials', 'project', 'all') or kind not in ('all', 'paper', 'conversation', 'artifact') or not re.fullmatch(r'\d{1,7}', offset):
        raise ValueError('搜索条件无效，请缩短关键词或重新选择范围')
    if scope != 'all' and not service.store.project(project):
        raise ValueError('请选择要搜索的项目')
    if user and scope != 'all':
        service.collaboration.project(user, project)
    counts = {'paper': 0, 'conversation': 0, 'artifact': 0}
    if not q:
        return {'results': [], 'counts': counts, 'total': 0, 'has_more': False}
    terms = normalized(q).split()
    found = []

    def match(item, content='', extra=''):
        title, text, metadata = normalized(item['title']), normalized(content), normalized(extra)
        if not all(term in title or term in text or term in metadata for term in terms):
            return
        item['score'] = (20 if title == normalized(q) else 0) + sum(8 if term in title else 4 if term in metadata else 1 for term in terms)
        excerpt = content if any(term in text for term in terms) else extra or content or item['title']
        folded = normalized(excerpt)
        positions = [folded.find(term) for term in terms if term in folded]
        start = max(0, min(positions, default=0) - 35)
        item['snippet'] = ('…' if start else '') + excerpt[start:start + 160] + ('…' if len(excerpt) > start + 160 else '')
        return item

    # scan the personal local library; add an incremental index if measured search latency grows.
    projects = (service.collaboration.projects(user) if user else service.store.projects()) if scope == 'all' else [dict(service.store.project(project))]
    for owner in projects:
        project_id = owner['id']
        organization = service.source_organization.get(project_id, user=user)
        labels = {label['id']: label['name'] for label in organization['labels']}
        for paper in service.store.all("SELECT p.*,v.pages FROM papers p LEFT JOIN paper_versions v ON v.id=p.current_version_id WHERE p.project_id=? AND p.status<>'removed'", (project_id,)):
            metadata = json.loads(paper['metadata'])
            category = labels.get(organization['assignments'].get(paper['id']), '未分类')
            extra = ' '.join([authors(metadata), category, str(metadata.get('summary') or metadata.get('abstract') or '')])
            pages = json.loads(paper['pages'] or '[]')
            content = '\n'.join(page.get('text', '') for page in pages)
            item = match({'kind': 'paper', 'id': paper['id'], 'title': paper['title'], 'project_id': project_id,
                          'project_name': owner['name'], 'location': category, 'version_id': paper['current_version_id'],
                          'updated': paper['added_at'], 'page': 1, 'openable': bool(paper['current_version_id'])}, content, extra)
            if item:
                page = next((p for p in pages if any(term in normalized(p.get('text', '')) for term in terms)), None)
                if page: item['page'] = page['page']
                found.append(item)
        if scope == 'materials':
            continue
        for conversation in service.store.conversations(project_id):
            if user and not service.collaboration.visible(user, 'conversation', conversation['id']):
                continue
            base = {'kind': 'conversation', 'id': conversation['id'], 'title': conversation['title'], 'project_id': project_id,
                    'project_name': owner['name'], 'location': 'AI 对话', 'updated': conversation['updated'], 'openable': True}
            candidates = [match({**base, 'message_id': None})]
            for message in service.store.messages(conversation['id']):
                candidates.append(match({**base, 'message_id': message['id']}, plain(message['text'])))
            hits = [item for item in candidates if item]
            if hits: found.append(max(hits, key=lambda item: (item['score'], bool(item['message_id']))))
        rows = service.store.all("""SELECT a.*,v.id AS version_id,v.title AS version_title,v.body,v.kind AS version_kind,d.value AS draft
            FROM artifacts a JOIN artifact_versions v ON v.id=(SELECT av.id FROM artifact_versions av JOIN tasks t ON t.id=av.task_id
            WHERE av.artifact_id=a.id AND t.status='succeeded' ORDER BY av.version_no DESC LIMIT 1)
            LEFT JOIN writing_drafts d ON d.artifact_id=a.id WHERE a.project_id=? AND a.kind NOT IN ('personal_skill','progress')""", (project_id,))
        for row in rows:
            if user and not service.collaboration.visible(user, 'artifact', row['id']):
                continue
            draft = json.loads(row['draft']) if row['draft'] else None
            title, body = (draft['title'], draft['body']) if draft else (row['version_title'], row['body'])
            item = match({'kind': 'artifact', 'id': row['id'], 'title': title, 'project_id': project_id, 'project_name': owner['name'],
                          'location': '成果', 'version_id': 'draft' if draft else row['version_id'], 'updated': row['updated'], 'openable': True}, plain(body))
            if item: found.append(item)
    found.sort(key=lambda item: (item['score'], item['updated'], item['id']), reverse=True)
    for item in found:
        counts[item['kind']] += 1
        item.pop('score')
    filtered = [item for item in found if kind == 'all' or item['kind'] == kind]
    start, limit = int(offset), 30
    return {'results': filtered[start:start + limit], 'counts': counts, 'total': len(filtered), 'has_more': start + limit < len(filtered)}
