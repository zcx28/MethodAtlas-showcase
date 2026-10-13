"""Shared human research work; the existing tasks table remains Agent execution."""
import json
import hashlib
import re
from datetime import date

from .collaboration import name_text
from .errors import AppError
from .state import json_text, new_id, now


class ProjectWork:
    def __init__(self, collaboration):
        self.access, self.store = collaboration, collaboration.store
        with self.store.lock, self.store.db:
            self.store.db.executescript('''
                CREATE TABLE IF NOT EXISTS work_items(
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                    description TEXT NOT NULL, assignee TEXT, creator TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('todo','doing','blocked','done','cancelled')),
                    priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
                    due_date TEXT, links TEXT NOT NULL, revision INTEGER NOT NULL,
                    created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS work_items_project ON work_items(project_id,updated,id);
                CREATE TABLE IF NOT EXISTS work_item_history(
                    item_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
                    record TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(item_id,revision));
                CREATE TABLE IF NOT EXISTS project_notifications(
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, recipient TEXT NOT NULL,
                    actor_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL,
                    created TEXT NOT NULL, read_at TEXT);
                CREATE INDEX IF NOT EXISTS notifications_recipient ON project_notifications(recipient,project_id,created);
                CREATE INDEX IF NOT EXISTS notifications_page ON project_notifications(recipient,project_id,created,id);
            ''')

    def shared_link(self, user, project, link):
        if not isinstance(link, dict) or set(link) - {'kind', 'id', 'version_id'}:
            raise ValueError('研究任务关联格式无效')
        kind, ident, version = link.get('kind'), link.get('id'), link.get('version_id')
        if kind not in ('paper', 'artifact', 'run', 'experiment') or not isinstance(ident, str) or len(ident) > 100:
            raise ValueError('研究任务关联格式无效')
        if version is not None and (kind not in ('paper', 'artifact') or not isinstance(version, str) or len(version) > 100):
            raise ValueError('研究任务关联格式无效')
        table = {'paper': 'papers', 'artifact': 'artifacts', 'run': 'tasks', 'experiment': 'experiment_groups'}[kind]
        row = self.store.one(f'SELECT * FROM {table} WHERE id=? AND project_id=?', (ident, project))
        if not row:
            raise PermissionError('关联内容不可访问')
        if kind == 'run' and row['kind'] == 'skill':
            raise PermissionError('个人 Skill 运行不能关联共享任务')
        if kind == 'artifact':
            scope = self.store.one('SELECT visibility FROM artifact_scopes WHERE artifact_id=?', (ident,))
            if scope and scope['visibility'] != 'shared':
                raise PermissionError('私人成果须先发布，才能关联共享任务')
        conversation = row['conversation_id'] if kind == 'run' else json.loads(row['record']).get('conversation_id') if kind == 'experiment' else None
        if conversation:
            scope = self.store.one('SELECT visibility FROM conversation_scopes WHERE conversation_id=?', (conversation,))
            if scope and scope['visibility'] != 'shared':
                raise PermissionError('私人研究须先发布，才能关联共享任务')
        if version:
            vtable, column = ('paper_versions', 'paper_id') if kind == 'paper' else ('artifact_versions', 'artifact_id')
            selected = self.store.one(f'SELECT * FROM {vtable} WHERE id=? AND {column}=?', (version, ident))
            if not selected:
                raise PermissionError('关联版本不可访问')
        title = row['prompt'][:200] if kind == 'run' else json.loads(row['record']).get('spec', {}).get('title', '实验') if kind == 'experiment' else row['title']
        if version and kind == 'artifact':
            title = selected['title']
        return {'kind': kind, 'id': ident, **({'version_id': version} if version else {}), 'title': title}

    def present(self, user, row):
        item = dict(row)
        item['links'] = json.loads(item['links']) if isinstance(item['links'], str) else item['links']
        resolved = []
        for link in item['links']:
            try:
                resolved.append(self.shared_link(user, item['project_id'], link))
            except PermissionError:
                # A later deletion or visibility change must not reveal private metadata.
                resolved.append({'unavailable': True})
        item['links'] = resolved
        return item

    def list(self, user, project, link=None):
        with self.store.transaction():
            self.access.project(user, project)
            where, values = 'project_id=?', [project]
            if link is not None:
                self.shared_link(user, project, link)
                where += " AND EXISTS(SELECT 1 FROM json_each(work_items.links) l WHERE json_extract(l.value,'$.kind')=? AND json_extract(l.value,'$.id')=?"
                values.extend((link['kind'], link['id']))
                if link.get('version_id'):
                    where += " AND (json_extract(l.value,'$.version_id') IS NULL OR json_extract(l.value,'$.version_id')=?)"
                    values.append(link['version_id'])
                where += ')'
            return [self.present(user, row) for row in self.store.all('SELECT * FROM work_items WHERE ' + where + ' ORDER BY updated DESC,id', values)]

    def get(self, user, project, ident):
        self.access.project(user, project)
        row = self.store.one('SELECT * FROM work_items WHERE id=? AND project_id=?', (ident, project))
        if not row:
            raise AppError('not_found', '研究任务不存在')
        return row

    def search(self, user, project, query='', status='all', assignee='', offset=0, limit=20):
        if not isinstance(query, str) or len(query) > 200 or status not in ('all', 'open', 'todo', 'doing', 'blocked', 'done', 'cancelled') or not isinstance(assignee, str) or len(assignee) > 100:
            raise ValueError('研究任务筛选条件无效')
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 50:
            raise ValueError('研究任务分页无效')
        with self.store.transaction():
            self.access.project(user, project)
            clauses, values = ['project_id=?'], [project]
            if query:
                clauses.append("instr(lower(title||' '||description),lower(?))>0")
                values.append(query)
            if status == 'open':
                clauses.append("status IN ('todo','doing','blocked')")
            elif status != 'all':
                clauses.append('status=?')
                values.append(status)
            if assignee:
                clauses.append('assignee=?')
                values.append(user['id'] if assignee == 'me' else assignee)
            where = ' AND '.join(clauses)
            rows = self.store.all('SELECT * FROM work_items WHERE ' + where + ' ORDER BY created,id LIMIT ? OFFSET ?', (*values, limit + 1, offset))
            items = []
            for row in rows[:limit]:
                item = self.present(user, row)
                item['description_truncated'] = len(item['description']) > 800
                item['description'] = item['description'][:800]
                items.append(item)
            return {'items': items, 'next_offset': offset + limit if len(rows) > limit else None,
                    'total': self.store.one('SELECT COUNT(*) AS n FROM work_items WHERE ' + where, values)['n'],
                    'project_status_counts': {r['status']: r['n'] for r in self.store.all('SELECT status,COUNT(*) AS n FROM work_items WHERE project_id=? GROUP BY status', (project,))},
                    'members': self.access.members(user, project), 'as_of': now()}

    def agent_save(self, task, request_id, changes, item_id=None, revision=None):
        if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 200 or not isinstance(changes, dict) or not changes:
            raise ValueError('研究任务操作需要稳定请求标识及修改内容')
        if changes.get('status') == 'done':
            raise PermissionError('AI 只能建议完成，须由任务负责人或项目负责人确认')
        body = dict(changes)
        for field in ('assignee', 'due_date'):
            if body.get(field) == '':
                body[field] = None
        if item_id:
            body['revision'] = revision
        fingerprint = hashlib.sha256(json.dumps([item_id, revision, body], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        # Reuse the atomic operation ledger, in a namespace separate from file deliveries.
        key = 'project-work:' + task['id']
        with self.store.transaction() as db:
            self.store.assert_active(task['id'], task['revision'])
            user = self.access.execution(task)
            if not user:
                raise PermissionError('共享研究任务需要在线身份')
            scope = self.store.one('SELECT visibility FROM conversation_scopes WHERE conversation_id=?', (task['conversation_id'],))
            if scope and scope['visibility'] == 'private':
                raise PermissionError('私人探索须先明确发布，不能直接修改共享任务')
            saved = db.execute('SELECT result FROM file_commits WHERE task_id=? AND call_id=?', (key, request_id)).fetchone()
            if saved:
                receipt = json.loads(saved['result'])
                if receipt['fingerprint'] != fingerprint:
                    raise AppError('conflict', '相同任务操作标识不能用于不同修改')
                latest = self.get(user, task['project_id'], receipt['item_id'])
                record = db.execute('SELECT record FROM work_item_history WHERE item_id=? AND revision=?', (receipt['item_id'], receipt['revision'])).fetchone()
                return {'item': self.present(user, json.loads(record['record'])), 'current_revision': latest['revision'], 'duplicate': True}
            item = self.save(user, task['project_id'], item_id, body, run=task)
            receipt = {'fingerprint': fingerprint, 'item_id': item['id'], 'revision': item['revision']}
            db.execute('INSERT INTO file_commits VALUES(?,?,?)', (key, request_id, json_text(receipt)))
            return {'item': item, 'current_revision': item['revision'], 'duplicate': False}

    def history(self, user, project, ident):
        with self.store.transaction():
            self.get(user, project, ident)
            return [{'actor_id': r['actor_id'], 'created': r['created'], 'item': self.present(user, json.loads(r['record']))}
                    for r in self.store.all('SELECT * FROM work_item_history WHERE item_id=? ORDER BY revision DESC', (ident,))]

    def candidates(self, user, project):
        with self.store.transaction():
            self.access.project(user, project)
            result = []
            for kind, table in (('paper', 'papers'), ('artifact', 'artifacts'), ('run', 'tasks'), ('experiment', 'experiment_groups')):
                for row in self.store.all(f'SELECT id FROM {table} WHERE project_id=? ORDER BY rowid DESC LIMIT 200', (project,)):
                    try:
                        result.append(self.shared_link(user, project, {'kind': kind, 'id': row['id']}))
                    except PermissionError:
                        pass
            return result

    def save(self, user, project, ident, body, *, run=None):
        allowed = {'title', 'description', 'assignee', 'status', 'priority', 'due_date', 'links', 'revision'}
        if set(body) - allowed:
            raise ValueError('研究任务包含未知字段')
        with self.store.transaction() as db:
            access = self.access.project(user, project, write=True)
            old = dict(self.get(user, project, ident)) if ident else None
            if old and (type(body.get('revision')) is not int or body['revision'] != old['revision']):
                raise AppError('conflict', '研究任务已被其他成员修改，请保留输入并查看最新版本')
            item = dict(old) if old else {'id': new_id('work'), 'project_id': project, 'title': '', 'description': '', 'assignee': None,
                                         'creator': user['id'], 'status': 'todo', 'priority': 'normal', 'due_date': None,
                                         'links': [], 'revision': 0, 'created': now()}
            item.update({k: v for k, v in body.items() if k != 'revision'})
            item['title'] = name_text(item['title'], '任务标题')
            if not isinstance(item['description'], str) or len(item['description']) > 20000:
                raise ValueError('任务说明最多 20000 字符')
            if item['status'] not in ('todo', 'doing', 'blocked', 'done', 'cancelled') or item['priority'] not in ('low', 'normal', 'high', 'urgent'):
                raise ValueError('研究任务状态或优先级无效')
            assignee = item['assignee']
            if assignee is not None and (not isinstance(assignee, str) or not db.execute('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', (project, assignee)).fetchone()):
                # A removed historical assignee may remain until someone explicitly reassigns.
                if not old or 'assignee' in body or assignee != old['assignee']:
                    raise ValueError('任务负责人必须是当前项目成员')
            if item['status'] == 'done' and (not old or old['status'] != 'done'):
                completion_assignee = old['assignee'] if old else assignee
                if access['role'] != 'owner' and (completion_assignee != user['id'] or assignee != user['id']):
                    raise PermissionError('只有任务负责人或项目负责人可以确认完成')
            due = item['due_date']
            if due is not None:
                if not isinstance(due, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', due):
                    raise ValueError('截止日期必须是有效的 YYYY-MM-DD 日期')
                date.fromisoformat(due)
            links = item['links'] if isinstance(item['links'], list) else json.loads(item['links']) if old and 'links' not in body else None
            if not isinstance(links, list) or len(links) > 100:
                raise ValueError('研究任务最多关联 100 项内容')
            clean = []
            for link in links:
                # Existing unavailable links can be retained without exposing their content.
                if old and 'links' not in body:
                    clean.append(link)
                    continue
                resolved = self.shared_link(user, project, link)
                resolved.pop('title')
                if resolved not in clean:
                    clean.append(resolved)
            if run:
                origin = {'kind': 'run', 'id': run['id']}
                self.shared_link(user, project, origin)
                if origin not in clean:
                    if len(clean) >= 100:
                        raise ValueError('研究任务最多关联 100 项内容')
                    clean.append(origin)
            item.update(links=json_text(clean), revision=item['revision'] + 1, updated=now())
            columns = tuple(item)
            db.execute(f'INSERT INTO work_items({",".join(columns)}) VALUES({",".join("?" for _ in columns)}) '
                       'ON CONFLICT(id) DO UPDATE SET ' + ','.join(f'{c}=excluded.{c}' for c in columns if c != 'id'), tuple(item.values()))
            db.execute('INSERT INTO work_item_history VALUES(?,?,?,?,?)', (item['id'], item['revision'], user['id'], json_text(item), item['updated']))
            kind = 'task_created' if not old else 'task_completed' if item['status'] == 'done' and old['status'] != 'done' else 'task_updated'
            self.access.event(project, user['id'], kind, item['id'], {'revision': item['revision'], **({'task_id': run['id']} if run else {})})
            if assignee and assignee != user['id'] and (not old or old['assignee'] != assignee):
                db.execute('INSERT INTO project_notifications VALUES(?,?,?,?,?,?,?,NULL)',
                           (new_id('notification'), project, assignee, user['id'], 'task_assigned', item['id'], now()))
            return self.present(user, item)

    def notifications(self, user, project, body=None):
        with self.store.transaction() as db:
            self.access.project(user, project)
            if body is not None:
                ids = body.get('ids')
                if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(i, str) or len(i) > 100 for i in ids):
                    raise ValueError('通知标识无效')
                for ident in ids:
                    db.execute('UPDATE project_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient=? AND project_id=?', (now(), ident, user['id'], project))
                    report = db.execute("SELECT d.day,v.id FROM project_notifications n JOIN artifact_versions v ON v.id=n.entity_id JOIN progress_days d ON d.artifact_id=v.artifact_id AND d.project_id=n.project_id WHERE n.id=? AND n.recipient=? AND n.project_id=? AND n.kind='review_published' AND d.deleted=0 AND v.version_no=(SELECT MAX(v2.version_no) FROM artifact_versions v2 WHERE v2.artifact_id=v.artifact_id)",(ident,user['id'],project)).fetchone()
                    if report:
                        db.execute('INSERT INTO progress_reads VALUES(?,?,?,?) ON CONFLICT(project_id,day,user_id) DO UPDATE SET version_id=excluded.version_id',(project,report['day'],user['id'],report['id']))
            return self.notification_page(user, project, limit=100)['notifications']

    def notification_page(self, user, project, cursor=None, limit=30):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError('通知分页数量无效')
        if cursor is not None and (not isinstance(cursor, str) or len(cursor) > 100):
            raise ValueError('通知分页位置无效')
        with self.store.transaction() as db:
            self.access.project(user, project)
            before = None
            if cursor:
                before = db.execute('SELECT created,id FROM project_notifications WHERE id=? AND recipient=? AND project_id=?', (cursor,user['id'],project)).fetchone()
                if not before:
                    raise ValueError('通知分页位置无效')
            result, scanned, next_cursor = [], 0, None
            # Bound work even when many old notifications have become inaccessible.
            while scanned < 1000:
                condition, args = (' AND (created,id)<(?,?)', tuple(before)) if before else ('', ())
                rows = db.execute('SELECT * FROM project_notifications WHERE recipient=? AND project_id=?'+condition+' ORDER BY created DESC,id DESC LIMIT 100', (user['id'],project,*args)).fetchall()
                if not rows:
                    next_cursor = None
                    break
                for row in rows:
                    before = (row['created'],row['id'])
                    next_cursor = row['id']
                    scanned += 1
                    item = self.notification_item(db,user,project,row)
                    if item:
                        result.append(item)
                    if len(result) == limit or scanned == 1000:
                        break
                if len(result) == limit or scanned == 1000:
                    if not db.execute('SELECT 1 FROM project_notifications WHERE recipient=? AND project_id=? AND (created,id)<(?,?) LIMIT 1',(user['id'],project,*before)).fetchone():
                        next_cursor = None
                    break
            return {'notifications':result,'next_cursor':next_cursor}

    def notification_item(self, db, user, project, row):
        item = dict(row)
        if item['kind'] == 'comment_mentioned':
            paper_comment = db.execute("SELECT p.id AS paper_id,p.title,c.version_id FROM comment_threads c JOIN papers p ON p.id=c.artifact_id AND p.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND c.target_kind='paper' AND p.status<>'removed'", (item['entity_id'], project)).fetchone()
            if paper_comment:
                item.update(dict(paper_comment), target_kind='paper')
            else:
                comment = db.execute('SELECT c.artifact_id,a.title FROM comment_threads c JOIN artifacts a ON a.id=c.artifact_id LEFT JOIN artifact_scopes s ON s.artifact_id=a.id WHERE c.id=? AND c.project_id=? AND (s.visibility IS NULL OR s.visibility=\'shared\')', (item['entity_id'], project)).fetchone()
                if not comment or not self.access.shared_metadata({'artifact_id':comment['artifact_id']}) or not self.access.visible(user,'artifact',comment['artifact_id']):
                    return None
                item.update(dict(comment))
        elif item['kind'] == 'task_assigned':
            task = db.execute('SELECT title FROM work_items WHERE id=? AND project_id=?', (item['entity_id'], project)).fetchone()
            if not task:
                return None
            item.update(dict(task))
        elif item['kind'] == 'review_published':
            version = db.execute("SELECT v.id AS version_id,v.artifact_id,v.title,v.payload FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id JOIN progress_days d ON d.artifact_id=a.id WHERE v.id=? AND a.project_id=? AND v.kind='progress' AND d.deleted=0",(item['entity_id'],project)).fetchone()
            if not version or not self.access.shared_metadata({'artifact_id':version['artifact_id']}) or not self.access.visible(user,'artifact',version['artifact_id']):
                return None
            item.update({key:version[key] for key in ('version_id','artifact_id','title')})
            item['day'] = json.loads(version['payload'])['day']
        else:
            return None
        return item
