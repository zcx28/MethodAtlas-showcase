"""Team SSH storage/transport checks; real OpenSSH config and Mimir, controlled execution peer."""
import json
import os
from pathlib import Path
import subprocess
from unittest.mock import patch

from .check_remote import fixture
from .check_support import temporary_directory
from .collaboration import Collaboration
from .remote import Remote, ROOT
from .server_resources import public_host
from .state import Store, json_text


def denied(call, error=PermissionError):
    try:
        call()
    except error:
        return
    raise AssertionError('unauthorized or invalid operation accepted')


def check_http(service, request, project, users, owner, member, outsider):
    """Run with python -m backend.check_collaboration --servers."""
    from .agent import ProjectTools
    store, remote, access = service.store, service.remote, service.collaboration
    remote.close()  # Only this disposable fixture's observer; no real SSH/model side effects.
    workspace = access.project(users['owner@example.com'], project)['workspace_id']
    base, root = f'/api/workspaces/{workspace}/server-settings', f'/api/projects/{project}'
    with temporary_directory() as temporary, patch.dict(os.environ), patch.object(service, 'schedule'):
        folder = Path(temporary)
        key = folder / 'key'
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True, capture_output=True)
        fixture(folder)
        os.environ.update(REMOTE_FIXTURE_PORT='22', REMOTE_FIXTURE_TEAM='1')
        body = {'name': 'HTTP isolated server', 'host': '8.8.8.8', 'port': 22, 'username': 'researcher', 'private_key': key.read_text(), 'host_key': key.with_suffix('.pub').read_text()}
        assert request(base, cookie=member)[0] == 403
        assert request(base + '/save', body, member)[0] == 403
        status, saved, _ = request(base + '/save', body, owner)
        assert status == 200, saved
        ident = saved['server']['id']
        assert 'PRIVATE KEY' not in json_text(saved)
        grant = {'project_id': project, 'server_id': ident, 'enabled': True}
        assert request(base + '/grant', grant, owner)[0] == 200
        conversation = access.work_context(users['member@example.com'], project)
        spec = {'server_id': ident, 'conversation_id': conversation, 'directory': '/work/shared', 'command': 'baseline'}
        status, draft, _ = request(root + '/remote/prepare', spec, member)
        assert status == 200, draft
        url = root + '/remote/' + draft['id']
        assert request(url + '/confirm', {'digest': draft['digest']}, member)[0] == 403
        assert request(root + '/server-settings/check', {'id': ident}, member)[0] == 403
        execution = {'server_id': ident, 'user_id': users['member@example.com']['id'], 'enabled': True}
        assert request(root + '/server-settings/execute-grant', execution, member)[0] == 403
        assert request(root + '/server-settings/execute-grant', execution, owner)[0] == 200
        assert request(root + '/server-settings', cookie=owner)[1]['servers'][0]['executors'] == [users['member@example.com']['id']]
        assert 'executors' not in request(root + '/server-settings', cookie=member)[1]['servers'][0]
        assert request(url + '/confirm', {'digest': draft['digest']}, outsider)[0] == 403
        assert request(url + '/confirm', {'digest': draft['digest']}, member)[1]['status'] == 'unknown'
        assert request(url + '/confirm', {'digest': draft['digest']}, member)[1]['status'] == 'running'
        status, content, _ = request(url + '/result', {'path': 'result.csv'}, owner)
        assert status == 200 and content['text'] == 'launches,score\n1,0.75\n', content
        assert request(url, cookie=member)[1]['executed_by'] == users['member@example.com']['id']
        private = store.create_conversation(project)
        store.run("INSERT INTO conversation_scopes VALUES(?,?,'private')", (private, users['member@example.com']['id']))
        status, hidden, _ = request(root + '/remote/prepare', {**spec, 'conversation_id': private, 'directory': '/private/source'}, member)
        assert status == 200, hidden
        hidden_url = root + '/remote/' + hidden['id']
        assert request(hidden_url + '/confirm', {'digest': hidden['digest']}, member)[0] == 200
        assert request(hidden_url, cookie=owner)[0] == 403
        assert request(hidden_url + '/observe', {}, owner)[0] == 403
        assert hidden['id'] not in {item['id'] for item in request(root + '/remote', cookie=owner)[1]['experiments']}
        assert request(root + '/remote', cookie=owner)[1]['settings']['directory'] == '/work/shared'
        before = store.one('SELECT COUNT(*) FROM papers WHERE project_id=?', (project,))[0]
        status, result, _ = request(hidden_url + '/fetch', {'path': 'result.csv'}, member)
        assert status == 200 and result['paper_id'] is None, result
        assert store.one('SELECT COUNT(*) FROM papers WHERE project_id=?', (project,))[0] == before
        denied(lambda: remote.result_file(project, result['id'], user=users['owner@example.com']))
        assert not access.shared_metadata(result)
        task = service.writing.task(project, 'shared experiment context', 'running', conversation, user=users['member@example.com'])
        tools = ProjectTools(store, task)
        denied(lambda: tools.read_experiment(hidden['id']))
        assert hidden['id'] not in {item['id'] for item in tools.list_experiments()['experiments']}
        plan = {'server_id': ident, 'conversation_id': conversation, 'directory': '/work/shared', 'title': 'Shared plan', 'plan': 'Run baseline', 'steps': ['baseline']}
        status, group, _ = request(root + '/remote/groups/prepare', plan, member)
        assert status == 200, group
        group_url = root + '/remote/groups/' + group['id']
        assert request(group_url + '/confirm', {'digest': group['digest']}, owner)[0] == 403
        assert request(group_url + '/confirm', {'digest': group['digest']}, member)[0] == 200
        remote.groups.tick()
        queued = remote.groups.get(project, group['id'], user=users['member@example.com'])['last_task']
        assert queued and store.task(queued)['refs']['initiated_by'] == users['member@example.com']['id']
        assert request(root + '/server-settings/execute-grant', {**execution, 'enabled': False}, owner)[0] == 200
        assert store.task(queued)['status'] == 'stopped'
        assert request(group_url, cookie=member)[1]['status'] == 'paused'
        assert request(root + '/server-settings/execute-grant', execution, owner)[0] == 200
        assert request(url + '/confirm', {'digest': draft['digest']}, member)[0] == 403, 'regrant revived old execution'
        denied(lambda: remote.groups.run(project, group['id'], {'step': 0, 'command': 'baseline', 'request_id': 'revoked'}, user=users['member@example.com']), ValueError)
        assert request(root + '/manage/remove-member', {'user_id': users['member@example.com']['id']}, owner)[0] == 200
        (folder / 'complete').touch()
        assert remote._observe_saved(project, draft['id'])['status'] == 'succeeded'
        assert remote._observe_saved(project, hidden['id'])['status'] == 'succeeded'
        assert request(hidden_url, cookie=owner)[0] == 403, 'background observation published private data'
        assert request(url, cookie=member)[0] == 403
        invitation = request(root + '/invite', {'email': users['member@example.com']['email']}, owner)[1]
        assert request('/api/invitations/accept', {'token': invitation['token']}, member)[0] == 200
        assert request(base + '/grant', {**grant, 'enabled': False}, owner)[0] == 200
        denied(lambda: remote._observe_saved(project, draft['id']))
        assert not request(root + '/server-settings', cookie=member)[1]['servers']
        assert request(url, cookie=member)[0] == 200, 'historical evidence disappeared on resource revocation'
        assert request(base + '/delete', {'id': ident}, member)[0] == 403
        assert request(base + '/grant', grant, owner)[0] == 200
        with patch.object(access, 'event', side_effect=RuntimeError('controlled delete failure')):
            assert request(base + '/delete', {'id': ident}, owner)[0] == 500
        assert any(server['id'] == ident for server in request(base, cookie=owner)[1]['servers'])
        assert request(base + '/delete', {'id': ident}, owner)[0] == 200
        assert not request(base, cookie=owner)[1]['servers']
        denied(lambda: remote.bridge('resolve', saved['server']), ValueError)
        store.run("UPDATE tasks SET status='stopped' WHERE id=?", (task['id'],))
        print('PASS authenticated HTTP server grants, executor identity, private experiments/results, trusted background continuation and permanent revocation fences')


def main():
    with temporary_directory() as temporary, patch.dict(os.environ):
        folder = Path(temporary)
        # Real generated disposable keys, never the user's SSH identity.
        keys = []
        for index in range(2):
            key = folder / f'key{index}'
            subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True, capture_output=True)
            keys.append(key)
        store = Store(folder / 'data' / 'state.sqlite3')
        try:
            collaboration = store.collaboration = Collaboration(store, online=True)
            remote = store.remote = Remote(store)
            owner, member, outsider = [{'id': name, 'email': name + '@example.com'} for name in ('owner', 'member', 'outsider')]
            for user in (owner, member, outsider):
                collaboration.register(user)
            project = collaboration.create_project(owner, {'name': 'Team SSH'})['project_id']
            workspace = collaboration.project(owner, project)['workspace_id']
            other = collaboration.create_project(outsider, {'name': 'Unrelated'})['project_id']
            other_workspace = collaboration.project(outsider, other)['workspace_id']
            collaboration.accept(member, collaboration.invite(owner, project, {'email': member['email']}))
            for host in ('localhost', '127.0.0.1', '::1', '10.0.0.1', '169.254.169.254', '0.0.0.0', '::ffff:127.0.0.1', '224.0.0.1', 'ff02::1', '-oProxyCommand=bad'):
                denied(lambda: public_host(host), ValueError)
            body = {'name': 'Team server', 'host': '8.8.8.8', 'port': 22, 'username': 'researcher',
                    'private_key': keys[0].read_text(), 'host_key': keys[0].with_suffix('.pub').read_text()}
            resources = remote.resources
            denied(lambda: resources.save(member, workspace, body))
            denied(lambda: resources.save(outsider, workspace, body))
            denied(lambda: resources.save(owner, workspace, {**body, 'private_key': 'bad'}), ValueError)
            assert not list((store.root / 'private' / 'server-credentials').iterdir()), 'invalid credential persisted'
            saved = resources.save(owner, workspace, body)['server']
            ident = saved['id']
            assert 'PRIVATE KEY' not in json_text(saved)
            assert not resources.project_view(member, project)['servers']
            assert not resources.catalog(outsider, other_workspace)['servers']
            denied(lambda: resources.save(outsider, other_workspace, {**body, 'id': ident}))
            grant = {'project_id': project, 'server_id': ident, 'enabled': True}
            denied(lambda: resources.grant(member, workspace, grant))
            denied(lambda: resources.grant(owner, workspace, {**grant, 'project_id': other}))
            resources.grant(owner, workspace, grant)
            resources.authorize(member, project, ident)
            denied(lambda: resources.authorize(member, project, ident, execute=True))
            denied(lambda: resources.authorize(owner, project, ident, execute=True))
            execution = {'server_id': ident, 'user_id': member['id'], 'enabled': True}
            denied(lambda: resources.execute_grant(member, project, execution))
            resources.execute_grant(owner, project, execution)
            resources.authorize(member, project, ident, execute=True)
            assert resources.project_view(member, project)['servers'][0]['can_execute']
            # Real ssh -G proves isolation options actually parse (including Windows paths).
            env = {**os.environ, 'METHODATLAS_TEAM_SSH': json_text(resources.transport_credentials())}
            code = "import {sshArgs} from './third_party/mimir/server/transport.mjs'; console.log(JSON.stringify(sshArgs(JSON.parse(process.argv[1]))))"
            args = json.loads(subprocess.run(['node', '--input-type=module', '-e', code, json_text(saved)], cwd=ROOT, env=env, capture_output=True, text=True, check=True).stdout)
            config = subprocess.run(['ssh', '-G', *args], capture_output=True, text=True, check=True).stdout
            fields = dict(line.split(' ', 1) for line in config.splitlines() if ' ' in line)
            for field, expected in {'identityagent': 'none', 'identitiesonly': 'yes', 'passwordauthentication': 'no', 'kbdinteractiveauthentication': 'no', 'forwardagent': 'no'}.items():
                assert fields[field] == expected, (field, fields[field])
            assert fields['hostname'] == body['host'] and fields['user'] == body['username']
            assert sum(line.startswith('identityfile ') for line in config.splitlines()) == 1, 'default identities inherited'
            assert str(resources.credentials(ident) / 'identity').replace('\\', '/') in fields['identityfile'].replace('\\', '/')
            # Keep the production bridge and transport; only the external peer is controlled.
            fixture(folder)
            os.environ.update(REMOTE_FIXTURE_PORT='22', REMOTE_FIXTURE_TEAM='1')
            connection = remote.bridge('resolve', saved)
            for forged in ({**saved, 'id': 'unknown'}, {**saved, 'host': '127.0.0.1'}, {**saved, 'username': 'root'}, {**saved, 'port': 23}):
                denied(lambda: remote.bridge('resolve', forged), ValueError)
            draft = remote.prepare(project, {'server_id': ident, 'directory': '/work/experiment', 'command': 'run baseline'}, user=member)
            assert remote.confirm(project, draft['id'], {'digest': draft['digest']}, user=member)['status'] == 'unknown'
            assert remote.confirm(project, draft['id'], {'digest': draft['digest']}, user=member)['status'] == 'running'
            chunk = remote.read(project, draft['id'], {'path': 'result.csv'}, result=True, user=member)
            assert chunk['text'] == 'launches,score\n1,0.75\n'
            resources.save(owner, workspace, {**body, 'id': ident, 'private_key': keys[1].read_text()})
            rotated = remote.bridge('resolve', saved)
            assert rotated['configDigest'] != connection['configDigest'], 'credential rotation retained plan authorization'
            assert remote.observe(project, draft['id'], user=member)['status'] == 'unknown', 'old job silently used rotated credentials'
            with patch.object(collaboration, 'event', side_effect=RuntimeError('controlled event failure')):
                denied(lambda: resources.grant(owner, workspace, {**grant, 'enabled': False}), RuntimeError)
            resources.authorize(member, project, ident, execute=True)
            resources.grant(owner, workspace, {**grant, 'enabled': False})
            denied(lambda: resources.authorize(member, project, ident, execute=True))
            resources.grant(owner, workspace, grant)
            denied(lambda: resources.authorize(member, project, ident, execute=True))
            resources.execute_grant(owner, project, execution)
            collaboration.manage(owner, project, 'remove-member', {'user_id': member['id']})
            collaboration.accept(member, collaboration.invite(owner, project, {'email': member['email']}))
            denied(lambda: resources.authorize(member, project, ident, execute=True))
            print('PASS team SSH ownership, project/member grants, real OpenSSH isolation, target pinning, credential rotation and controlled Mimir idempotency')
        finally:
            store.db.close()


if __name__ == '__main__':
    main()
