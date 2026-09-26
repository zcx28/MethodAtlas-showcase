"""Project/confirmation adapter for the actual Mimir server and job module."""
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import threading

from .state import json_text, new_id, now

ROOT = Path(__file__).resolve().parents[1]


def text(value, limit=4000, empty=False):
    if not isinstance(value, str) or len(value) > limit or '\0' in value or not empty and not value.strip():
        raise ValueError('字段为空、类型错误或过长')
    return value


class Remote:
    def __init__(self, store):
        self.store = store
        # Design limit: serialize local bridge writes; use a persistent service if SSH volume grows.
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        store.run('CREATE TABLE IF NOT EXISTS remote_experiments(id TEXT PRIMARY KEY,project_id TEXT,spec TEXT,digest TEXT,status TEXT,job TEXT,created TEXT)')
        columns = {row['name'] for row in store.all('PRAGMA table_info(remote_experiments)')}
        if 'name' not in columns:
            store.run('ALTER TABLE remote_experiments ADD COLUMN name TEXT')
        store.run("CREATE UNIQUE INDEX IF NOT EXISTS remote_retry_parent ON remote_experiments(json_extract(spec,'$.parent_id')) WHERE json_extract(spec,'$.parent_id') IS NOT NULL")
        store.run('CREATE TABLE IF NOT EXISTS remote_project(project_id TEXT PRIMARY KEY,server_id TEXT,directory TEXT)')
        from .experiments import ExperimentGroups
        self.groups = ExperimentGroups(self)
        store.run('CREATE TABLE IF NOT EXISTS remote_results(id TEXT PRIMARY KEY,project_id TEXT,experiment_id TEXT,record TEXT)')

    def bridge(self, action, body=None):
        with self.lock:
            try:
                run = subprocess.run([os.getenv('METHODATLAS_NODE', 'node'), str(ROOT / 'backend/remote.mjs'),
                                      str(self.store.root / 'remote.sqlite3'), str(self.store.root)],
                                     input=json_text({'action': action, 'body': body or {}}), encoding='utf-8',
                                     capture_output=True, timeout=35, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                result = json.loads(run.stdout)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                raise ValueError('MethodAtlas 远程实验模块未返回有效结果；未推断任务执行结果') from None
            if not result.get('ok'):
                raise ValueError(result.get('error', {}).get('message', '远程记录不存在或参数无效'))
            return result['value']

    def servers(self, action='list', body=None):
        if action not in ('list', 'save', 'delete', 'check', 'probes'):
            raise ValueError('未知服务器操作')
        if action == 'delete':
            body = dict(body or {})
            if set(body) != {'id'}:
                raise ValueError('删除服务器只需提供 id')
            text(body['id'], 100)
            return self.bridge(action, body)
        if action == 'save':
            body = dict(body or {})
            if body.keys() - {'id', 'name', 'host', 'port', 'username'}:
                raise ValueError('仅保存服务器名称、主机/SSH别名、端口、用户名；不保存密码和密钥')
            for key in ('name', 'host'):
                text(body.get(key), 200)
            text(body.get('username', ''), 100, empty=True)
            if body.get('port') is None:
                body['port'] = 22 if body['host'] == 'methodatlas-local' else self.bridge('resolve', {**body, 'port': None})['port']
            if type(body.get('port')) is not int:
                raise ValueError('端口必须是整数')
            body.setdefault('username', '')
            if 'id' in body:
                text(body['id'], 100)
        return self.bridge(action, body)

    def project(self, project):
        if not self.store.project(project):
            raise ValueError('项目不存在')

    def preview_import(self, body):
        rows = body.get('servers')
        if not isinstance(rows, list) or len(rows) > 100:
            raise ValueError('导入需要 servers 数组，最多100条；仅导入连接元数据')
        existing = {(s['host'], s['port'], s.get('username', '')) for s in self.servers()['servers']}
        preview = []
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('服务器条目必须是对象')
            safe = {k: row.get(k, '' if k == 'username' else None) for k in ('name', 'host', 'port', 'username')}
            for key in ('name', 'host'):
                text(safe[key], 200)
            text(safe['username'], 100, empty=True)
            if type(safe['port']) is not int or not 1 <= safe['port'] <= 65535:
                raise ValueError('导入端口无效')
            key = (safe['host'], safe['port'], safe['username'])
            preview.append({'server': safe, 'duplicate': key in existing,
                            'ignored_fields': sorted(set(row) - set(safe))})
            existing.add(key)
        return {'preview': preview}

    def list(self, project):
        self.project(project)
        rows = self.store.all('SELECT id FROM remote_experiments WHERE project_id=? ORDER BY created DESC', (project,))
        settings = self.store.one('SELECT server_id,directory FROM remote_project WHERE project_id=?', (project,))
        return {'experiments': [self.get(project, row['id']) for row in rows], 'settings': dict(settings) if settings else None,
                'groups': self.groups.list(project), **self.servers(), 'probes': self.servers('probes')}

    def get(self, project, ident):
        self.project(project)
        row = self.store.one('SELECT * FROM remote_experiments WHERE id=? AND project_id=?', (ident, project))
        if not row:
            raise ValueError('实验不属于此项目')
        value = dict(row)
        value['spec'], value['job'] = json.loads(value['spec']), json.loads(value['job'])
        value['results'] = [json.loads(r['record']) for r in self.store.all('SELECT record FROM remote_results WHERE project_id=? AND experiment_id=?', (project, ident))]
        return value

    def prepare(self, project, body):
        self.project(project)
        if body.keys() - {'server_id', 'directory', 'command', 'resources', 'configuration', 'name'}:
            raise ValueError('实验包含未知字段')
        server = next((s for s in self.servers()['servers'] if s['id'] == body.get('server_id')), None)
        if not server:
            raise ValueError('请选择已登记服务器')
        directory = text(body.get('directory'), 1000)
        path = PurePosixPath(directory)
        if not path.is_absolute() or '..' in path.parts or str(path) != directory or directory == '/':
            raise ValueError('请填写已有的绝对 Linux 实验目录，不得含 .. 或根目录')
        spec = {'project_id': project, 'server': server, 'directory': directory,
                'connection': self.bridge('resolve', server),
                'command': text(body.get('command')), 'resources': text(body.get('resources', ''), 1000, empty=True),
                'configuration': text(body.get('configuration', ''), 10000, empty=True)}
        digest = hashlib.sha256(json_text(spec).encode()).hexdigest()
        ident = new_id('exp')
        name = text(body.get('name', ''), 200, empty=True)
        with self.store.transaction() as db:
            db.execute('INSERT INTO remote_experiments(id,project_id,spec,digest,status,job,created,name) VALUES(?,?,?,?,?,?,?,?)',
                       (ident, project, json_text(spec), digest, 'awaiting_confirmation', '{}', now(), name))
            db.execute('INSERT INTO remote_project VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET server_id=excluded.server_id,directory=excluded.directory',
                       (project, server['id'], directory))
        return self.get(project, ident)

    def rename(self, project, ident, body):
        """Name an experiment. The digest stays untouched: naming is not part of what was authorised."""
        if body.keys() != {'name'}:
            raise ValueError('仅支持修改实验名称')
        self.get(project, ident)
        name = text(body.get('name', ''), 200, empty=True)
        with self.store.transaction() as db:
            db.execute('UPDATE remote_experiments SET name=? WHERE id=? AND project_id=?', (name, ident, project))
        return self.get(project, ident)

    def confirm(self, project, ident, body):
        with self.lock:
            item = self.get(project, ident)
            if item['spec'].get('sandbox'):
                self.groups.active(project,item['spec']['sandbox']['group_id'])
            if set(body) != {'digest'} or body['digest'] != item['digest']:
                raise ValueError('授权内容已变化；请重新预览确认')
            server = next((s for s in self.servers()['servers'] if s['id'] == item['spec']['server']['id']), None)
            if server != item['spec']['server']:
                raise ValueError('服务器配置已变化；请重新预览确认')
            if self.bridge('resolve', server) != item['spec']['connection']:
                raise ValueError('本机 OpenSSH 配置已变化；请重新预览确认')
            if item['status'] not in ('awaiting_confirmation', 'unknown', 'submitting'):
                return item
            self.store.run("UPDATE remote_experiments SET status='submitting' WHERE id=?", (ident,))
            try:
                job = self.bridge('submit', {'jobId': ident, 'spec': item['spec'],
                                           'serverId': server['id'], 'command': item['spec']['command']})['job']
            except ValueError:
                job = {'status': 'unknown', 'exitCode': None, 'observationError': '提交响应未确认，请沿用同一身份重试'}
            self.save_observation(project, ident, job)
            return self.get(project, ident)

    def prepare_repair(self, project, ident, body):
        parent = self.observe(project, ident)
        if parent['spec'].get('sandbox'):
            raise ValueError('实验组修复须使用组工具并遵循三次重试限制')
        if parent['status'] != 'failed':
            raise ValueError('只有已确认失败的实验可修复重试；未知状态须先重连')
        attempt = parent['spec'].get('attempt', 0) + 1
        if attempt > 2:
            raise ValueError('本实验已达到两次修复重试上限；请先重新评估方案')
        if set(body) != {'path', 'content', 'before_sha256', 'reason'}:
            raise ValueError('修复需要脚本路径、原内容哈希、完整新内容和原因')
        path = PurePosixPath(text(body['path'], 1000))
        if path.is_absolute() or '..' in path.parts or '.methodatlas-jobs' in path.parts or path.suffix not in ('.py', '.sh'):
            raise ValueError('只能修复授权目录内的 .py/.sh 运行脚本')
        text(body['content'], 60000)
        if len(body['content'].encode('utf-8')) > 65536:
            raise ValueError('修复脚本最多64 KiB')
        text(body['reason'], 1000)
        if not re.fullmatch('[a-f0-9]{64}', body['before_sha256']):
            raise ValueError('需要读取原脚本的 SHA-256')
        chunk = self.read(project, ident, {'path': str(path)}, result=True)
        raw = base64.b64decode(chunk['data'])
        if chunk['size'] != len(raw) or hashlib.sha256(raw).hexdigest() != body['before_sha256']:
            raise ValueError('原脚本已变化或超过64 KiB；未准备修改')
        spec = {**parent['spec'], 'parent_id': ident, 'attempt': attempt,
                'repair': {**body, 'before': raw.decode('utf-8')}}
        rid = new_id('exp')
        digest = hashlib.sha256(json_text(spec).encode()).hexdigest()
        with self.lock, self.store.transaction() as db:
            existing = db.execute("SELECT id,status,digest FROM remote_experiments WHERE project_id=? AND json_extract(spec,'$.parent_id')=?", (project, ident)).fetchone()
            if existing:
                if existing['digest'] == digest:
                    return self.get(project, existing['id'])
                if existing['status'] != 'awaiting_confirmation':
                    raise ValueError('原失败实验已有重试，请从最新失败记录继续；不得并行重复修复')
                rid = existing['id']
                db.execute('UPDATE remote_experiments SET spec=?,digest=? WHERE id=?', (json_text(spec), digest, rid))
            else:
                db.execute('INSERT INTO remote_experiments(id,project_id,spec,digest,status,job,created) VALUES(?,?,?,?,?,?,?)',
                           (rid, project, json_text(spec), digest, 'awaiting_confirmation', '{}', now()))
        return self.get(project, rid)

    def save_observation(self, project, ident, job):
        with self.store.transaction() as db:
            old = self.get(project, ident)
            db.execute('UPDATE remote_experiments SET status=?,job=? WHERE id=? AND project_id=?',
                       (job['status'], json_text(job), ident, project))
            if old['status'] != job['status'] and hasattr(self.store, 'progress'):
                # Each actual transition is recorded; duplicate synchronization is silent.
                data = {'experiment_id': ident, 'status': job['status'], 'exit_code': job.get('exitCode'),
                        'directory': old['spec']['directory'], 'command': old['spec']['command'],
                        'log_path': job.get('logPath'), 'provenance': job.get('provenance'),
                        'text': f"实验 {ident}：{job['status']}。退出成功不代表科学主张成立；失联未知不代表实验失败。"}
                db.execute('INSERT INTO progress_events VALUES(?,?,?,?,?)', (new_id('remote'), project, 'experiment', now(), json_text(data)))

    def observe(self, project, ident):
        with self.lock:
            item = self.get(project, ident)
            if item['status'] == 'awaiting_confirmation':
                return item
            try:
                job = self.bridge('observe', {'id': ident})['job']
            except ValueError:
                job = {**item['job'], 'status': 'unknown', 'exitCode': None, 'observationError': '暂时无法观察远端'}
            self.save_observation(project, ident, job)
            return self.get(project, ident)

    def read(self, project, ident, body, result=False):
        self.get(project, ident)
        allowed = {'offset', 'path', 'snapshot'} if result else {'offset'}
        if body.keys() - allowed or type(body.get('offset', 0)) is not int or not 0 <= body.get('offset', 0) <= 2**53 - 1:
            raise ValueError('日志或结果读取参数无效')
        snapshot=body.get('snapshot')
        if snapshot is not None and (snapshot not in ('before','after') or 'path' in body):
            raise ValueError('代码快照只能选择 before 或 after，不同时指定结果路径')
        if result and not snapshot:
            path = PurePosixPath(text(body.get('path'), 1000))
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('结果路径必须在授权目录内')
        chunk = self.bridge('snapshot' if snapshot else 'result' if result else 'log', {'id': ident, **body})
        raw = base64.b64decode(chunk['data'], validate=True)
        if len(raw) > 65536 or chunk['offset'] != body.get('offset', 0) or chunk['next_offset'] != chunk['offset'] + len(raw) or chunk['size'] < chunk['next_offset']:
            raise ValueError('远端读取返回了无效字节范围')
        return {**chunk, 'text': raw.decode('utf-8', 'replace')}

    def cancel(self, project, ident, body):
        item = self.get(project, ident)
        if body != {'digest': item['digest'], 'confirm': True}:
            raise ValueError('终止须明确确认当前远端实验身份')
        if item['spec'].get('sandbox'):
            group=self.groups.get(project,item['spec']['sandbox']['group_id'])
            self.groups.control(project,group['id'],'pause',{'digest':group['digest']})
        self.bridge('cancel', {'id': ident})
        return self.observe(project, ident)

    def fetch(self, project, ident, body):
        item = self.get(project, ident)
        if set(body) != {'path'}:
            raise ValueError('请选择一个结果文件')
        offset, parts, signature = 0, [], None
        while True:
            chunk = self.read(project, ident, {'path': body['path'], 'offset': offset}, result=True)
            # Design limit: 2 MiB selected-result snapshot; large logs remain remotely pageable.
            if chunk['size'] > 2 * 1024 * 1024:
                raise ValueError('单次结果取回最多 2 MiB；请选择较小结果文件，大日志使用增量读取')
            if signature is not None and chunk['signature'] != signature:
                raise ValueError('读取期间结果文件变化；未保存不完整版本，请完成后重试')
            signature = chunk['signature']
            raw = base64.b64decode(chunk['data'], validate=True)
            if not raw and offset < chunk['size']:
                raise ValueError('结果读取中断；未保存不完整版本')
            parts.append(raw)
            offset = chunk['next_offset']
            if offset >= chunk['size']:
                break
        raw = b''.join(parts)
        digest = hashlib.sha256(raw).hexdigest()
        rid = hashlib.sha256(json_text([project, ident, body['path'], digest]).encode()).hexdigest()
        with self.lock, self.store.transaction() as db:
            old = db.execute('SELECT record FROM remote_results WHERE id=?', (rid,)).fetchone()
            if old:
                return json.loads(old['record'])
            folder = self.store.root / 'workspaces' / project / 'experiments' / ident
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / rid
            target.write_bytes(raw)
            record = {'id': rid, 'experiment_id': ident, 'remote_path': chunk['path'], 'sha256': digest,
                      'size': len(raw), 'created': now(), 'provenance': item['job'].get('provenance'), 'paper_id': None, 'version_id': None}
            try:
                content = raw.decode('utf-8')
                if content.strip() and len(content) <= 200000 and '\0' not in content:
                    paper = self.store.paste(project, f"实验 {ident} / {body['path']}"[:300], content)
                    record['paper_id'] = paper
                    record['version_id'] = self.store.one('SELECT current_version_id FROM papers WHERE id=?', (paper,))[0]
            except UnicodeDecodeError:
                pass
            db.execute('INSERT INTO remote_results VALUES(?,?,?,?)', (rid, project, ident, json_text(record)))
            if hasattr(self.store, 'progress'):
                db.execute('INSERT INTO progress_events VALUES(?,?,?,?,?)', (f'remote-result:{rid}', project, 'experiment_result', now(), json_text(record)))
            return record

    def result_file(self, project, rid):
        self.project(project)
        row = self.store.one('SELECT experiment_id,record FROM remote_results WHERE id=? AND project_id=?', (rid, project))
        if not row:
            raise ValueError('结果不属于此项目')
        path = self.store.root / 'workspaces' / project / 'experiments' / row['experiment_id'] / rid
        record = json.loads(row['record'])
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != record['sha256']:
            raise ValueError('本地结果与保存版本不一致')
        return raw, PurePosixPath(record['remote_path']).name

    def start(self):
        def watch():
            try:
                self.bridge('recover')
            except ValueError:
                pass  # Existing records stay unknown until an observation succeeds.
            while not self.stop.is_set():
                rows = self.store.all("SELECT id,project_id FROM remote_experiments WHERE status IN ('submitting','queued','running','unknown')")
                for row in rows:
                    if self.stop.is_set():
                        return
                    try:
                        self.observe(row['project_id'], row['id'])
                    except ValueError:
                        pass
                try:
                    self.groups.tick()
                except Exception as error:
                    from .errors import record_error
                    record_error(self.store, error, operation='experiment_continuation')
                self.stop.wait(15)
        self.thread = threading.Thread(target=watch, daemon=True, name='remote-observer')
        self.thread.start()

    def close(self):
        self.stop.set()  # Never sends a remote termination on host shutdown.
        if self.thread:
            self.thread.join(timeout=36)
