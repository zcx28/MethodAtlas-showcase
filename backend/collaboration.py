"""Team/project membership and access rules shared by HTTP and research execution."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone

from .auth import email_address
from .state import new_id, now, json_text


def name_text(value, label='名称'):
    if not isinstance(value, str) or not value.strip() or len(value) > 300:
        raise ValueError(label + '不能为空且最多 300 字符')
    return value.strip()


class Collaboration:
    def __init__(self, store, online=False):
        self.store = store
        self.online = online
        with store.lock, store.db:
            store.db.executescript('''
                CREATE TABLE IF NOT EXISTS collab_users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL,created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS workspace_members(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id));
                CREATE TABLE IF NOT EXISTS project_scopes(project_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS project_workspace ON project_scopes(workspace_id);
                CREATE TABLE IF NOT EXISTS project_members(project_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','member')),PRIMARY KEY(project_id,user_id));
                CREATE UNIQUE INDEX IF NOT EXISTS project_single_owner ON project_members(project_id) WHERE role='owner';
                CREATE TABLE IF NOT EXISTS conversation_scopes(conversation_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('shared','private')));
                CREATE TABLE IF NOT EXISTS artifact_scopes(artifact_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('shared','private')));
                CREATE TABLE IF NOT EXISTS project_invitations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL,created TEXT NOT NULL,expires TEXT NOT NULL,accepted_by TEXT,revoked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS activity_events(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,actor_id TEXT,kind TEXT NOT NULL,entity_id TEXT,data TEXT NOT NULL DEFAULT '{}',created TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS activity_project_time ON activity_events(project_id,created,id);
                CREATE TRIGGER IF NOT EXISTS collab_artifact_scope AFTER INSERT ON artifact_versions BEGIN
                    INSERT OR IGNORE INTO artifact_scopes SELECT NEW.artifact_id,c.owner_id,c.visibility FROM tasks t JOIN conversation_scopes c ON c.conversation_id=t.conversation_id WHERE t.id=NEW.task_id;
                END;
            ''')

    def register(self, user):
        with self.store.transaction() as db:
            # The authenticated UUID is authoritative; an email cannot rebind another user's history.
            db.execute('INSERT INTO collab_users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email', (user['id'], user['email'], now()))
            legacy_email = os.getenv('METHODATLAS_LEGACY_OWNER_EMAIL', '').strip().lower()
            if legacy_email and user['email'] == legacy_email:
                old = db.execute('SELECT p.id FROM projects p LEFT JOIN project_scopes s ON s.project_id=p.id WHERE s.project_id IS NULL').fetchall()
                if old:
                    workspace = db.execute('SELECT id FROM workspaces WHERE owner_id=? ORDER BY created LIMIT 1', (user['id'],)).fetchone()
                    wid = workspace['id'] if workspace else self.create_workspace(user, '研究团队')['id']
                    for project in old:
                        db.execute('INSERT INTO project_scopes(project_id,workspace_id) VALUES(?,?)', (project['id'], wid))
                        db.execute('INSERT INTO project_members VALUES(?,?,\'owner\')', (project['id'], user['id']))
                        self.event(project['id'], user['id'], 'project_migrated', project['id'], {'historical_authors': '迁移前记录'})
                db.execute("UPDATE reader_entries SET owner_id=? WHERE owner_id IS NULL AND project_id IN (SELECT project_id FROM project_members WHERE user_id=? AND role='owner')", (user['id'], user['id']))
                db.execute("INSERT OR IGNORE INTO personal_skill_owners SELECT s.id,? FROM personal_skills s JOIN artifacts a ON a.id=s.id JOIN project_members m ON m.project_id=a.project_id WHERE m.user_id=? AND m.role='owner'", (user['id'], user['id']))
                db.execute("INSERT OR IGNORE INTO artifact_scopes SELECT id,owner_id,'private' FROM personal_skill_owners WHERE owner_id=?", (user['id'],))
        return user

    def event(self, project, actor, kind, entity, data=None):
        self.store.run('INSERT INTO activity_events VALUES(?,?,?,?,?,?,?)', (new_id('event'), project, actor, kind, entity, json_text(data or {}), now()))

    def paper_event(self, user, project, paper, version):
        self.project(user, project, write=True)
        # A version is imported once; retries do not invent new contributions.
        title = self.store.one('SELECT title FROM papers WHERE id=? AND project_id=?',(paper,project))['title']
        self.store.run('INSERT OR IGNORE INTO activity_events VALUES(?,?,?,?,?,?,?)',
                       ('paper-version:' + version, project, user['id'], 'paper_uploaded', paper,
                        json_text({'paper_id':paper,'version_id':version,'title':title}), now()))

    def workspaces(self, user):
        return [dict(r) for r in self.store.all('SELECT w.*,CASE WHEN w.owner_id=? THEN \'owner\' ELSE \'member\' END AS role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created', (user['id'], user['id']))]

    def workspace(self, user, ident, owner=False):
        item = self.store.one('SELECT w.* FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?', (ident, user['id']))
        if not item or owner and item['owner_id'] != user['id']:
            raise PermissionError('没有团队访问或管理权限')
        return dict(item)

    def create_workspace(self, user, name):
        name = name_text(name)
        ident = new_id('workspace')
        with self.store.transaction() as db:
            db.execute('INSERT INTO workspaces VALUES(?,?,?,?)', (ident, name, user['id'], now()))
            db.execute('INSERT INTO workspace_members VALUES(?,?)', (ident, user['id']))
        return self.workspace(user, ident)

    def project(self, user, project, owner=False, write=False):
        item = self.store.one('SELECT s.*,m.role FROM project_scopes s JOIN project_members m ON m.project_id=s.project_id WHERE s.project_id=? AND m.user_id=?', (project, user['id']))
        if not item or owner and item['role'] != 'owner':
            raise PermissionError('没有项目访问或管理权限')
        if write and item['archived']:
            raise PermissionError('项目已归档，请先恢复项目')
        return dict(item)

    def projects(self, user):
        return [dict(r) for r in self.store.all('SELECT p.*,s.workspace_id,s.archived,m.role FROM projects p JOIN project_scopes s ON s.project_id=p.id JOIN project_members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.updated DESC', (user['id'],))]

    def create_project(self, user, body):
        name = name_text(body.get('name'), '项目名称')
        with self.store.transaction() as db:
            workspace = body.get('workspace_id')
            if not workspace:
                owned = [w for w in self.workspaces(user) if w['owner_id'] == user['id']]
                workspace = owned[0]['id'] if owned else self.create_workspace(user, '我的团队')['id']
            self.workspace(user, workspace)
            project = self.store.create_project(name)
            db.execute('INSERT INTO project_scopes(project_id,workspace_id) VALUES(?,?)', (project, workspace))
            db.execute('INSERT INTO project_members VALUES(?,?,\'owner\')', (project, user['id']))
            for conversation in self.store.conversations(project):
                db.execute('INSERT INTO conversation_scopes VALUES(?,?,\'shared\')', (conversation['id'], user['id']))
            self.event(project, user['id'], 'project_created', project, {'name': name})
        return {'project_id': project}

    def members(self, user, project):
        self.project(user, project)
        return [dict(r) for r in self.store.all('SELECT m.user_id,m.role,u.email FROM project_members m JOIN collab_users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY m.role DESC,u.email', (project,))]

    def invite(self, user, project, body):
        email = email_address(body.get('email'))
        token, ident = secrets.token_urlsafe(32), new_id('invite')
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        with self.store.transaction() as db:
            self.project(user, project, owner=True, write=True)
            if db.execute('SELECT 1 FROM project_members m JOIN collab_users u ON u.id=m.user_id WHERE m.project_id=? AND u.email=?', (project, email)).fetchone():
                raise ValueError('该成员已在项目中')
            db.execute('UPDATE project_invitations SET revoked=1 WHERE project_id=? AND email=? AND accepted_by IS NULL', (project, email))
            db.execute('INSERT INTO project_invitations VALUES(?,?,?,?,?,?,?,NULL,0)', (ident, project, email, hashlib.sha256(token.encode()).hexdigest(), user['id'], now(), expires))
            self.event(project, user['id'], 'member_invited', ident, {'email': email})
        return {'id': ident, 'token': token, 'email': email, 'expires': expires}

    def accept(self, user, body):
        token = body.get('token')
        if not isinstance(token, str) or not 20 <= len(token) <= 200:
            raise ValueError('邀请无效或已过期')
        with self.store.transaction() as db:
            invite = db.execute('SELECT i.*,s.workspace_id,s.archived FROM project_invitations i JOIN project_scopes s ON s.project_id=i.project_id WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            if not invite or invite['revoked'] or invite['archived'] or invite['expires'] < now() or invite['email'] != user['email'] or invite['accepted_by'] not in (None, user['id']):
                raise PermissionError('邀请无效、已过期或与当前邮箱不匹配')
            if invite['accepted_by']:
                self.project(user, invite['project_id'])
                return {'project_id': invite['project_id']}
            db.execute('INSERT OR IGNORE INTO workspace_members VALUES(?,?)', (invite['workspace_id'], user['id']))
            db.execute('INSERT INTO project_members VALUES(?,?,\'member\')', (invite['project_id'], user['id']))
            db.execute('UPDATE project_invitations SET accepted_by=? WHERE id=?', (user['id'], invite['id']))
            self.event(invite['project_id'], user['id'], 'member_joined', user['id'])
        return {'project_id': invite['project_id']}

    def manage(self, user, project, action, body):
        stopped = []
        remote = getattr(self.store, 'remote', None)
        with remote.lock if remote else nullcontext(), self.store.transaction() as db:
            self.project(user, project, owner=True)
            if action == 'remove-member':
                target = body.get('user_id')
                member = db.execute('SELECT role FROM project_members WHERE project_id=? AND user_id=?', (project, target)).fetchone()
                if not member or member['role'] == 'owner':
                    raise ValueError('不能移除负责人，请先转移所有权')
                db.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?', (project, target))
                if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mail_preferences'").fetchone():
                    db.execute('UPDATE mail_preferences SET digest=0,mentions=0,assignments=0,revision=revision+1 WHERE project_id=? AND user_id=?',(project,target))
                    db.execute("UPDATE mail_deliveries SET status='cancelled',error='access_changed',finished=? WHERE project_id=? AND user_id=? AND status IN ('pending','preparing','failed','uncertain')",(now(),project,target))
                if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='server_executors'").fetchone():
                    db.execute('DELETE FROM server_executors WHERE project_id=? AND user_id=?', (project, target))
                if remote:
                    stopped.extend(remote.resources.fence(project, user=target))
                # Fence pending and in-flight work before releasing the membership transaction.
                pending = db.execute("SELECT id,revision FROM tasks WHERE project_id=? AND json_extract(refs,'$.initiated_by')=? AND status IN ('queued','routing','running','waiting')", (project, target)).fetchall()
                for run in pending:
                    db.execute("UPDATE tasks SET status='stopped',revision=revision+1,updated=? WHERE id=?", (now(), run['id']))
                    self.store.event(run['id'], 'stopped', '发起人已离开项目，后续执行已撤销')
                stopped.extend(pending)
                db.execute('UPDATE project_invitations SET revoked=1 WHERE project_id=? AND (accepted_by=? OR email=(SELECT email FROM collab_users WHERE id=?))', (project, target, target))
                self.event(project, user['id'], 'member_removed', target)
            elif action == 'transfer':
                target = body.get('user_id')
                if target == user['id'] or not db.execute('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', (project, target)).fetchone():
                    raise ValueError('请选择另一位项目成员')
                db.execute('UPDATE project_members SET role=\'member\' WHERE project_id=? AND user_id=?', (project, user['id']))
                db.execute('UPDATE project_members SET role=\'owner\' WHERE project_id=? AND user_id=?', (project, target))
                self.event(project, user['id'], 'ownership_transferred', target)
            elif action == 'revoke-invite':
                db.execute('UPDATE project_invitations SET revoked=1 WHERE id=? AND project_id=?', (body.get('id'), project))
                self.event(project, user['id'], 'invite_revoked', body.get('id'))
            elif action in ('archive', 'unarchive'):
                db.execute('UPDATE project_scopes SET archived=? WHERE project_id=?', (int(action == 'archive'), project))
                self.event(project, user['id'], 'project_' + action, project)
            else:
                raise ValueError('未知项目管理操作')
        return {'ok': True, 'cancelled_runs': [dict(run) for run in stopped]}

    def visible(self, user, kind, ident):
        # Table/column names are an internal allowlist, never client-supplied SQL.
        if kind == 'artifact' and getattr(self.store,'progress',None):
            report = self.store.one("SELECT project_id FROM artifacts WHERE id=? AND kind='progress'",(ident,))
            if report and not self.store.progress.shared_report(report['project_id'],ident):
                return False
        table, column = {'conversation': ('conversation_scopes', 'conversation_id'), 'artifact': ('artifact_scopes', 'artifact_id')}[kind]
        row = self.store.one(f'SELECT * FROM {table} WHERE {column}=?', (ident,))
        return not row or row['visibility'] == 'shared' or row['owner_id'] == user['id']

    def scope(self, kind, ident):
        table, column = {'conversation': ('conversation_scopes', 'conversation_id'), 'artifact': ('artifact_scopes', 'artifact_id')}[kind]
        row = self.store.one(f'SELECT owner_id,visibility FROM {table} WHERE {column}=?', (ident,))
        return dict(row) if row else {'owner_id': None, 'visibility': 'shared'}

    def create_conversation(self, user, project, visibility='shared'):
        if visibility not in ('shared', 'private'):
            raise ValueError('请选择共享或私人对话')
        with self.store.transaction():
            self.project(user, project, write=True)
            ident = self.store.create_conversation(project)
            self.store.run('INSERT INTO conversation_scopes VALUES(?,?,?)', (ident, user['id'], visibility))
            return {'conversation_id': ident, **self.scope('conversation', ident)}

    def conversation(self, user, project, conversation):
        self.project(user, project)
        if not self.store.one('SELECT 1 FROM conversations WHERE id=? AND project_id=?', (conversation, project)) or not self.visible(user, 'conversation', conversation):
            raise PermissionError('对话不可访问')

    def artifact(self, user, project, artifact, write=False):
        self.project(user, project, write=write)
        if not self.store.one('SELECT 1 FROM artifacts WHERE id=? AND project_id=?', (artifact, project)) or not self.visible(user, 'artifact', artifact):
            raise PermissionError('成果不可访问')

    def context_artifact(self, user, project, conversation, artifact, write=False):
        self.conversation(user, project, conversation)
        self.artifact(user, project, artifact)
        chat = self.store.one('SELECT visibility FROM conversation_scopes WHERE conversation_id=?', (conversation,))
        source = self.store.one('SELECT visibility FROM artifact_scopes WHERE artifact_id=?', (artifact,))
        private_chat = bool(chat and chat['visibility'] == 'private')
        private_source = bool(source and source['visibility'] == 'private')
        if private_source and not private_chat:
            raise PermissionError('私人内容须明确发布后才能用于共享对话')
        if write and private_chat and not private_source:
            raise PermissionError('私人运行不能直接修改共享成果，请先发布结果')

    def execution(self, task, artifact=None, write=False):
        if not self.online:
            return None
        actor = task['refs'].get('initiated_by')
        row = self.store.one('SELECT id,email FROM collab_users WHERE id=?', (actor,))
        if not row:
            raise PermissionError('运行缺少已验证的发起人')
        user = dict(row)
        self.project(user, task['project_id'], write=True)
        schedule = task['refs'].get('subscription_schedule')
        if schedule:
            row = self.store.one('SELECT enabled,revision,authorized_by FROM subscriptions WHERE project_id=? AND id=?', (task['project_id'], schedule['id']))
            if not row or not row['enabled'] or row['revision'] != schedule['revision'] or row['authorized_by'] != actor:
                raise PermissionError('论文订阅的定时授权已改变')
        if 'progress_schedule' in task['refs']:
            self.project(user,task['project_id'],owner=True,write=True)
            settings = self.store.progress.settings(task['project_id'])
            if not settings['enabled'] or settings['archived'] or settings['revision'] != task['refs']['progress_schedule'] or settings.get('authorized_by') != actor:
                raise PermissionError('项目自动回顾授权已改变')
        self.conversation(user, task['project_id'], task['conversation_id'])
        if task['refs'].get('model_config') and getattr(self.store, 'model_settings', None):
            self.store.model_settings.authorize_binding(task, task['refs']['model_config'])
        context = task['refs'].get('context_artifact_id')
        if context:
            self.context_artifact(user, task['project_id'], task['conversation_id'], context, write=True)
        refs = task['refs']
        for source in [refs.get('reference'), refs.get('progress_context'), *refs.get('selected_fragments', []), *refs.get('report_sources', []), *refs.get('context_references', [])]:
            if not source:
                continue
            if source.get('artifact_id'):
                self.context_artifact(user, task['project_id'], task['conversation_id'], source['artifact_id'])
            if source.get('kind') == 'remote':
                remote = self.store.remote.groups if source['experiment_id'].startswith('group_') else self.store.remote
                data = remote.get(task['project_id'], source['experiment_id'], user=user)
                origin = data.get('conversation_id') or data.get('spec', {}).get('conversation_id')
                if origin:
                    self.conversation(user, task['project_id'], origin)
                    if not self.shared_metadata({'conversation_id':origin}) and self.scope('conversation', task['conversation_id'])['visibility'] != 'private':
                        raise PermissionError('私人实验不能用于共享对话')
        if artifact:
            self.context_artifact(user, task['project_id'], task['conversation_id'], artifact, write)
        return user

    def work_context(self, user, project, conversation=None, artifact=None):
        """Choose a visible context for an auxiliary operation, never the newest chat blindly."""
        self.project(user, project, write=True)
        if artifact:
            self.artifact(user, project, artifact)
        if not conversation:
            scope = self.store.one('SELECT visibility FROM artifact_scopes WHERE artifact_id=?', (artifact,)) if artifact else None
            visibility = scope['visibility'] if scope else 'shared'
            row = self.store.one("SELECT c.id FROM conversations c LEFT JOIN conversation_scopes s ON s.conversation_id=c.id WHERE c.project_id=? AND COALESCE(s.visibility,'shared')=? AND (?='shared' OR s.owner_id=?) ORDER BY c.created,c.id LIMIT 1", (project, visibility, visibility, user['id']))
            if row:
                conversation = row['id']
            else:
                conversation = self.store.create_conversation(project)
                self.store.run('INSERT INTO conversation_scopes VALUES(?,?,?)', (conversation, user['id'], visibility))
        self.conversation(user, project, conversation)
        if artifact:
            self.context_artifact(user, project, conversation, artifact, write=True)
        return conversation

    def document_evidence(self, user, project, citations, artifact=None, conversation=None):
        if not citations:
            return
        target = self.store.one('SELECT visibility FROM artifact_scopes WHERE artifact_id=?', (artifact,)) if artifact else self.store.one('SELECT visibility FROM conversation_scopes WHERE conversation_id=?', (conversation,))
        private = target and target['visibility'] == 'private'
        for citation in citations:
            self.conversation(user, project, citation['conversation_id'])
            source = self.store.one('SELECT visibility FROM conversation_scopes WHERE conversation_id=?', (citation['conversation_id'],))
            if source and source['visibility'] == 'private' and not private:
                raise PermissionError('私人引用须明确发布后才能进入共享文稿')

    def shared_metadata(self, data):
        """Project-wide consumers must not inherit a private conversation's evidence."""
        if not self.online:
            return True
        if data.get('kind') == 'personal_skill':
            return False
        conversation = data.get('conversation_id')
        if data.get('task_id'):
            task = self.store.task(data['task_id'])
            if not task or task['kind'] == 'skill':
                return False
            conversation = task['conversation_id']
        if conversation:
            scope = self.store.one('SELECT visibility FROM conversation_scopes WHERE conversation_id=?', (conversation,))
            if scope and scope['visibility'] == 'private':
                return False
        if data.get('artifact_id'):
            scope = self.store.one('SELECT visibility FROM artifact_scopes WHERE artifact_id=?', (data['artifact_id'],))
            if scope and scope['visibility'] == 'private':
                return False
            artifact = self.store.one('SELECT kind FROM artifacts WHERE id=?', (data['artifact_id'],))
            if artifact and artifact['kind'] == 'personal_skill':
                return False
        return True

    def authorize_path(self, user, path, mutation=False):
        mail = re.fullmatch(r'/api/projects/([^/]+)/mail-settings(?:/retry)?', path)
        if mail:
            self.project(user,mail[1])
            return
        limits = re.fullmatch(r'/api/(workspaces|projects)/([^/]+)/resource-limits', path)
        if limits:
            if limits[1] == 'workspaces':
                self.workspace(user, limits[2], owner=True)
            else:
                self.project(user, limits[2], owner=mutation, write=mutation)
            return
        workspace = re.fullmatch(r'/api/workspaces/([^/]+)/(?:model-settings|server-settings)(?:/(save|test|default|delete|preferences|grant))?', path)
        if workspace:
            self.workspace(user, workspace[1], owner=True)
            return
        match = re.match(r'^/api/projects/([^/]+)(?:/|$)', path)
        if match:
            project = match[1]
            # Restoration of an archived project must remain possible.
            self.project(user, project, write=mutation and not path.endswith('/manage/unarchive'))
            conversation = re.search(r'/conversations/([^/]+)', path)
            if conversation:
                self.conversation(user, project, conversation[1])
            artifact = re.search(r'/(?:artifacts|documents)/([^/]+)', path)
            if artifact:
                self.artifact(user, project, artifact[1])
            task = re.search(r'/tasks/([^/]+)', path)
            if task:
                row = self.store.task(task[1])
                if not row or row['project_id'] != project:
                    raise PermissionError('运行不可访问')
                if row['kind'] == 'skill' and row['refs'].get('initiated_by') != user['id']:
                    raise PermissionError('个人 Skill 运行不可访问')
                self.conversation(user, project, row['conversation_id'])
                if mutation and row['refs'].get('initiated_by') != user['id']:
                    self.project(user, project, owner=True)
            citation = re.search(r'/citations/([^/]+)', path)
            if citation:
                row = self.store.one('SELECT conversation_id FROM evidence WHERE id=? AND project_id=?', (citation[1].removeprefix('cite:'), project))
                if not row:
                    raise PermissionError('引用不可访问')
                self.conversation(user, project, row['conversation_id'])
            return
        if not mutation and (path in ('/api/skills', '/api/search') or re.fullmatch(r'/api/skills/shared/[A-Za-z0-9_-]+', path)):
            return
        if path in ('/api/state', '/api/projects', '/api/auth/me', '/api/workspaces', '/api/invitations/accept'):
            return
        # Existing global resource endpoints must be scoped before exposing them online.
        if path.startswith('/api/'):
            raise PermissionError('该入口尚未绑定团队权限')
