"""Team-owned SSH connections and explicit project/member execution grants."""
import base64
import hashlib
import json
from ipaddress import ip_address
import os
import re
import socket
import subprocess
import tempfile

from .state import json_text, now
from .remote import validate_server_fields


def private_permissions(path, directory=False):
    if os.name != 'nt':
        path.chmod(0o700 if directory else 0o600)
        return
    # Windows chmod does not set an OpenSSH-compatible DACL.
    script = '''$ErrorActionPreference = 'Stop'
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = if ($p.directory) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$inherit = if ($p.directory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')
$acl.AddAccessRule($rule)
if ($p.directory) { [System.IO.Directory]::SetAccessControl($p.path, $acl) } else { [System.IO.File]::SetAccessControl($p.path, $acl) }
'''
    try:
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
                       input=json.dumps({'path': str(path), 'directory': directory}).encode('ascii'),
                       capture_output=True, timeout=15, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        raise ValueError('无法限制 SSH 凭据文件权限，未启用该连接') from None


def public_host(host):
    if not isinstance(host, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:-]{0,199}', host):
        raise ValueError('服务器地址无效')
    try:
        addresses = {ip_address(host)}
    except ValueError:
        try:
            addresses = {ip_address(row[4][0]) for row in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
        except OSError:
            raise ValueError('服务器域名无法解析') from None
    if not addresses or any(not address.is_global or address.is_multicast for address in addresses):
        raise ValueError('在线团队服务器必须使用公网地址，不能使用本机别名或内部网络地址')
    # Pin the resolved address; later DNS changes cannot redirect an authorized run.
    return str(sorted(addresses, key=lambda value: (value.version, int(value)))[0])


def host_key(value):
    if not isinstance(value, str) or len(value) > 16000:
        raise ValueError('请提供服务器的 SSH 公钥')
    parts = value.split()
    if len(parts) < 2 or parts[0] not in ('ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'):
        raise ValueError('SSH 主机公钥格式无效')
    try:
        raw = base64.b64decode(parts[1], validate=True)
        size = int.from_bytes(raw[:4], 'big')
        if not 0 < size < len(raw) - 4 or raw[4:4 + size].decode() != parts[0]:
            raise ValueError()
    except (ValueError, UnicodeError):
        raise ValueError('SSH 主机公钥内容无效') from None
    return ' '.join(parts[:2]), 'SHA256:' + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=')


class ServerResources:
    def __init__(self, remote):
        self.remote, self.store = remote, remote.store
        with self.store.lock, self.store.db:
            self.store.db.executescript('''
                CREATE TABLE IF NOT EXISTS team_servers(server_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,credential_version TEXT NOT NULL,host_fingerprint TEXT NOT NULL,created_by TEXT NOT NULL,updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS project_servers(project_id TEXT NOT NULL,server_id TEXT NOT NULL,PRIMARY KEY(project_id,server_id));
                CREATE TABLE IF NOT EXISTS server_executors(project_id TEXT NOT NULL,server_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(project_id,server_id,user_id));
            ''')

    @property
    def collaboration(self):
        return self.store.collaboration

    def owned(self, workspace, ident):
        row = self.store.one('SELECT * FROM team_servers WHERE workspace_id=? AND server_id=?', (workspace, ident))
        if not row:
            raise PermissionError('服务器不属于当前团队')
        return dict(row)

    def credentials(self, ident):
        row = self.store.one('SELECT credential_version FROM team_servers WHERE server_id=?', (ident,))
        if not row:
            raise PermissionError('服务器尚未配置团队凭据')
        return self.store.root / 'private' / 'server-credentials' / row['credential_version']

    def transport_credentials(self):
        result = {}
        for row in self.store.all('SELECT server_id,credential_version FROM team_servers'):
            folder = self.store.root / 'private' / 'server-credentials' / row['credential_version']
            result[row['server_id']] = {'folder': str(folder), 'target': json.loads((folder / 'target.json').read_text(encoding='utf-8'))}
        return result

    def catalog(self, user, workspace):
        self.collaboration.workspace(user, workspace, owner=True)
        owned = {row['server_id']: dict(row) for row in self.store.all('SELECT * FROM team_servers WHERE workspace_id=?', (workspace,))}
        return {'servers': [{**server, 'host_fingerprint': owned[server['id']]['host_fingerprint'], 'has_key': True,
                             'host_key': (self.credentials(server['id']) / 'known_hosts').read_text(encoding='utf-8').splitlines()[0].split(' ', 1)[1]}
                            for server in self.remote.bridge('list')['servers'] if server['id'] in owned]}

    def project_view(self, user, project):
        scope = self.collaboration.project(user, project)
        grants = {row['server_id'] for row in self.store.all('SELECT server_id FROM project_servers WHERE project_id=?', (project,))}
        executable = {row['server_id'] for row in self.store.all('SELECT server_id FROM server_executors WHERE project_id=? AND user_id=?', (project, user['id']))}
        members = self.store.all('SELECT server_id,user_id FROM server_executors WHERE project_id=?', (project,)) if scope['role'] == 'owner' else []
        return {'servers': [{**server, 'can_execute': server['id'] in executable,
                             **({'executors': [row['user_id'] for row in members if row['server_id'] == server['id']]} if scope['role'] == 'owner' else {})}
                            for server in self.remote.bridge('list')['servers'] if server['id'] in grants]}

    def authorize(self, user, project, ident, execute=False):
        scope = self.collaboration.project(user, project, write=execute)
        self.owned(scope['workspace_id'], ident)
        if not self.store.one('SELECT 1 FROM project_servers WHERE project_id=? AND server_id=?', (project, ident)):
            raise PermissionError('项目未获授权使用此服务器')
        if execute and not self.store.one('SELECT 1 FROM server_executors WHERE project_id=? AND server_id=? AND user_id=?', (project, ident, user['id'])):
            raise PermissionError('你尚未获授权在此服务器执行实验')

    def save(self, user, workspace, body):
        if not isinstance(body, dict) or set(body) - {'id', 'name', 'host', 'port', 'username', 'private_key', 'host_key'}:
            raise ValueError('服务器配置字段无效')
        with self.remote.lock:
            self.collaboration.workspace(user, workspace, owner=True)
            ident = body.get('id')
            old = self.owned(workspace, ident) if ident else None
            server = {key: body.get(key) for key in ('name', 'host', 'port', 'username')}
            validate_server_fields(server)
            if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9._-]{0,99}', server.get('username') or ''):
                raise ValueError('在线服务器必须填写明确的 SSH 用户名')
            server['host'] = public_host(server['host'])
            server['port'] = server['port'] or 22
            if old and not body.get('private_key'):
                key = (self.credentials(ident) / 'identity').read_text(encoding='utf-8')
            else:
                key = body.get('private_key')
            if not isinstance(key, str) or not key.strip() or len(key.encode()) > 65536 or '\0' in key:
                raise ValueError('请提供有效的 SSH 私钥；加密私钥须先在本机解密')
            key = key.replace('\r\n', '\n').strip() + '\n'
            public, fingerprint = host_key(body.get('host_key'))
            target = {field: server[field] for field in ('host', 'port', 'username')}
            version = hashlib.sha256(json_text([target, key, public]).encode()).hexdigest()
            private_root = self.store.root / 'private' / 'server-credentials'
            private_root.mkdir(parents=True, exist_ok=True, mode=0o700)
            private_permissions(private_root, directory=True)
            # Validate before retaining secrets; invalid submissions leave no credential files.
            with tempfile.TemporaryDirectory(dir=private_root) as staging:
                from pathlib import Path
                staging = Path(staging)
                for name, content in (('identity', key), ('host.pub', public + '\n')):
                    fd = os.open(staging / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
                        stream.write(content)
                    private_permissions(staging / name)
                for args in (['-y', '-P', '', '-f', str(staging / 'identity')], ['-l', '-f', str(staging / 'host.pub')]):
                    try:
                        checked = subprocess.run(['ssh-keygen', *args], capture_output=True, timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    except (OSError, subprocess.TimeoutExpired):
                        raise ValueError('无法校验 SSH 密钥，请检查服务端 OpenSSH') from None
                    if checked.returncode:
                        raise ValueError('SSH 私钥或主机公钥无法读取，请检查格式和私钥密码保护')
            folder = private_root / version
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            private_permissions(folder, directory=True)
            # Immutable credential versions preserve the identity used by an authorized plan.
            for name, content in (('identity', key), ('known_hosts', f"[{server['host']}]:{server['port']} {public}\n{server['host']} {public}\n"), ('target.json', json_text(target))):
                target = folder / name
                if target.exists():
                    if target.read_text(encoding='utf-8') != content:
                        raise ValueError('凭据版本内容不一致，未覆盖已有密钥')
                else:
                    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
                        stream.write(content)
                private_permissions(target)
            with self.store.transaction():
                self.collaboration.workspace(user, workspace, owner=True)
                saved = self.remote.bridge('save', {**server, **({'id': ident} if ident else {})})['server']
                self.store.run('INSERT INTO team_servers VALUES(?,?,?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET credential_version=excluded.credential_version,host_fingerprint=excluded.host_fingerprint,updated=excluded.updated', (saved['id'], workspace, version, fingerprint, user['id'], now()))
            return {'server': {**saved, 'host_fingerprint': fingerprint, 'has_key': True}}

    def grant(self, user, workspace, body):
        if not isinstance(body, dict) or set(body) != {'project_id', 'server_id', 'enabled'} or type(body['enabled']) is not bool:
            raise ValueError('服务器授权字段无效')
        project, ident = body['project_id'], body['server_id']
        stopped = []
        with self.remote.lock, self.store.transaction():
            self.collaboration.workspace(user, workspace, owner=True)
            self.owned(workspace, ident)
            scope = self.store.one('SELECT workspace_id FROM project_scopes WHERE project_id=?', (project,))
            if not scope or scope['workspace_id'] != workspace:
                raise PermissionError('项目不属于当前团队')
            if body['enabled']:
                self.store.run('INSERT OR IGNORE INTO project_servers VALUES(?,?)', (project, ident))
            else:
                self.store.run('DELETE FROM project_servers WHERE project_id=? AND server_id=?', (project, ident))
                self.store.run('DELETE FROM server_executors WHERE project_id=? AND server_id=?', (project, ident))
                stopped = self.fence(project, ident)
            self.collaboration.event(project, user['id'], 'server_access_changed', ident, {'enabled': body['enabled']})
        self.cancel(stopped)
        return {'ok': True}

    def delete(self, user, workspace, body):
        if not isinstance(body, dict) or set(body) != {'id'} or not isinstance(body['id'], str):
            raise ValueError('删除服务器只需提供 id')
        stopped = []
        with self.remote.lock, self.store.transaction():
            self.collaboration.workspace(user, workspace, owner=True)
            self.owned(workspace, body['id'])
            for row in self.store.all('SELECT project_id FROM project_servers WHERE server_id=?', (body['id'],)):
                stopped.extend(self.fence(row['project_id'], body['id']))
                self.collaboration.event(row['project_id'], user['id'], 'server_deleted', body['id'])
            self.store.run('DELETE FROM server_executors WHERE server_id=?', (body['id'],))
            self.store.run('DELETE FROM project_servers WHERE server_id=?', (body['id'],))
            self.store.run('DELETE FROM team_servers WHERE server_id=?', (body['id'],))
            # Keep historical job metadata; unowned connections have no transport credentials.
        self.cancel(stopped)
        return {'ok': True}

    def execute_grant(self, user, project, body):
        if not isinstance(body, dict) or set(body) != {'server_id', 'user_id', 'enabled'} or type(body['enabled']) is not bool:
            raise ValueError('成员执行授权字段无效')
        stopped = []
        with self.remote.lock, self.store.transaction():
            scope = self.collaboration.project(user, project, owner=True, write=True)
            self.owned(scope['workspace_id'], body['server_id'])
            if not self.store.one('SELECT 1 FROM project_servers WHERE project_id=? AND server_id=?', (project, body['server_id'])):
                raise PermissionError('项目未获授权使用此服务器')
            if not self.store.one('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', (project, body['user_id'])):
                raise PermissionError('执行权限只能授予当前项目成员')
            if body['enabled']:
                self.store.run('INSERT OR IGNORE INTO server_executors VALUES(?,?,?)', (project, body['server_id'], body['user_id']))
            else:
                self.store.run('DELETE FROM server_executors WHERE project_id=? AND server_id=? AND user_id=?', (project, body['server_id'], body['user_id']))
                stopped = self.fence(project, body['server_id'], body['user_id'])
            self.collaboration.event(project, user['id'], 'server_execution_access_changed', body['server_id'], {'user_id': body['user_id'], 'enabled': body['enabled']})
        self.cancel(stopped)
        return {'ok': True}

    def cancel(self, runs):
        service = self.remote.groups.service
        if service:
            for run in runs:
                service.research.cancel(run['id'], run['revision'])

    def fence(self, project, server=None, user=None):
        """Called inside the membership/grant transaction; never kills a remote process."""
        stopped = []
        self.store.run("UPDATE remote_experiments SET authorization_revoked=1 WHERE project_id=? AND (? IS NULL OR json_extract(spec,'$.server.id')=?) AND (? IS NULL OR COALESCE(executed_by,json_extract(spec,'$.initiated_by'))=?)", (project, server, server, user, user))
        for row in self.store.all('SELECT record FROM experiment_groups WHERE project_id=?', (project,)):
            group = json.loads(row['record'])
            if group.get('mode') == 'external':
                continue
            if server and group['spec']['server']['id'] != server or user and group.get('authorized_by') != user:
                continue
            if group['status'] in ('active', 'awaiting_confirmation'):
                group.update(status='paused', message='服务器执行权限已撤销；已有远程程序未被终止')
                self.remote.groups.save(group)
            runs = self.store.all("SELECT DISTINCT t.id,t.revision FROM tasks t LEFT JOIN tool_calls c ON c.task_id=t.id WHERE t.project_id=? AND t.status IN ('queued','routing','running','waiting') AND (json_extract(t.refs,'$.experiment_group')=? OR (c.name IN ('experiment_workspace','run_experiment_group','record_experiment_result','complete_experiment_step') AND json_extract(c.arguments,'$.group_id')=?))", (project, group['id'], group['id']))
            for run in runs:
                self.store.run("UPDATE tasks SET status='stopped',revision=revision+1,updated=? WHERE id=?", (now(), run['id']))
                self.store.event(run['id'], 'stopped', '服务器执行权限已撤销')
                stopped.append(dict(run))
        return stopped
