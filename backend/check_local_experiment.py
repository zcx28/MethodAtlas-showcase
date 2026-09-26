"""Real local Docker transport → existing Mimir/runner → fixed result check.

Requires METHODATLAS_DOCKER_HOST and METHODATLAS_LOCAL_CONTAINER. No model calls.
"""
import json
import os
import tempfile
import time
from pathlib import Path

from .state import Store
from .remote import Remote
from .agent import ProjectTools
from .state import now


def main():
    with tempfile.TemporaryDirectory() as folder:
        store = Store(Path(folder) / 'methodatlas.sqlite3')
        remote = Remote(store)
        store.remote = remote
        project = store.create_project('Local transport check')
        conversation = store.conversations(project)[0]['id']
        server = remote.servers('save', {'name':'本机 Docker', 'host':'methodatlas-local'})['server']
        assert remote.servers('check', {'id':server['id']})['state'] == 'online'
        socket = os.environ.pop('METHODATLAS_DOCKER_HOST')
        try:
            assert remote.servers('check', {'id':server['id']})['state'] == 'offline'
            assert remote.servers('probes')[server['id']]['state'] == 'offline'
            try:
                remote.bridge('resolve',server)
            except ValueError:
                pass
            else:
                raise AssertionError('local transport enabled without explicit socket')
        finally:
            os.environ['METHODATLAS_DOCKER_HOST'] = socket
        assert remote.servers('check', {'id':server['id']})['ssh'] == 'not_used'
        group = remote.groups.prepare(project, {'conversation_id':conversation, 'server_id':server['id'],
            'directory':'/experiment', 'title':'CPU check', 'plan':'Write and preserve a real metric',
            'steps':['baseline'], 'network':False, 'gpu_devices':[], 'max_seconds':60, 'max_storage_mb':10})
        ident = group['id']
        remote.groups.control(project, ident, 'confirm', {'digest':group['digest']})
        remote.groups.workspace(project, ident, {'operation':'write','path':'check.py','before_sha256':'',
            'content':'import json\nfrom pathlib import Path\nPath("metrics.json").write_text(json.dumps({"score":sum(range(10))}))\n'})
        try:
            remote.groups.workspace(project, ident, {'operation':'read','path':'../authorization.json'})
        except ValueError:
            pass
        else:
            raise AssertionError('workspace escaped')
        body = {'step':0,'command':'python3 check.py','request_id':'check'}
        run = remote.groups.run(project, ident, body)
        assert remote.groups.run(project, ident, body)['id'] == run['id']
        for _ in range(60):
            run = remote.observe(project, run['id'])
            if run['status'] in ('succeeded','failed'):
                break
            time.sleep(.2)
        assert run['status'] == 'succeeded', run
        # The result did not exist when the research task started, but must be
        # citable in the same turn that records it (and after restoring the turn).
        task_id = 'task_local_check'
        store.run("INSERT INTO tasks(id,project_id,conversation_id,message_id,prompt,selected_paper_ids,generate,status,created,updated) VALUES(?,?,?,?,?,'[]',0,'running',?,?)",
                  (task_id,project,conversation,'message_local_check','记录并引用实验结果',now(),now()))
        tools = ProjectTools(store,store.task(task_id))
        tools.set_scope(False)
        result = tools.call('record_experiment_result', {'group_id':ident,'experiment_id':run['id'],
                            'result_path':'metrics.json','summary':'Actual sum'})
        paper_id = result['evidence']['paper_id']
        assert tools.call('read_material', {'paper_id':paper_id})['evidence']
        restored = ProjectTools(store,store.task(task_id))
        restored.set_scope(False)
        assert restored.read_material(paper_id)['version_id'] == result['evidence']['version_id']
        earlier = store.paste(project, 'Earlier metric', '{"score":44}')
        old_version = 'paper_version_earlier'
        store.run('INSERT INTO paper_versions SELECT ?,?,sha256,page_count,pages,created,parser_version,source_path FROM paper_versions WHERE id=?',
                  (old_version,paper_id,store.paper(project,earlier)['version_id']))
        frozen = store.task(task_id)['snapshot']
        frozen[0]['version_id'] = old_version
        store.update_active(task_id,0,snapshot=frozen)
        restored = ProjectTools(store,store.task(task_id))
        restored.set_scope(False)
        restored.call('record_experiment_result', {'group_id':ident,'experiment_id':run['id'],
                      'result_path':'metrics.json','summary':'Already recorded'})
        assert restored.material_version(paper_id)['version_id'] == old_version
        assert store.task(task_id)['snapshot'][0]['version_id'] == old_version
        assert result['record']['metrics']['score'] == 45
        raw, _ = remote.result_file(project,result['evidence']['id'])
        assert json.loads(raw)['score'] == 45
        assert remote.groups.finish_step(project,ident,0,'verified')['status'] == 'completed'
        # A changed container identity must invalidate the existing authorization.
        group = remote.groups.get(project,ident)
        group['spec']['connection']['containerId'] = 'different'
        remote.groups.save(group)
        try:
            remote.groups.connection(group)
        except ValueError:
            pass
        else:
            raise AssertionError('changed execution target accepted')
        print('PASS real local Docker: no SSH, isolated execution, idempotency, fixed metrics, target binding')


if __name__ == '__main__':
    main()
