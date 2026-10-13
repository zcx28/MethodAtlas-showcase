"""Real local Docker transport → existing Mimir/runner → fixed result check.

Requires METHODATLAS_DOCKER_HOST and METHODATLAS_LOCAL_CONTAINER. No model calls.
"""
import json
import math
import os
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path

from .state import Store
from .remote import Remote
from .agent import ProjectTools
from .state import now


def main():
    if not os.environ.get('METHODATLAS_DOCKER_HOST') or not os.environ.get('METHODATLAS_LOCAL_CONTAINER'):
        raise SystemExit('BLOCKED: configure a running local Docker engine and dedicated container; no experiment was executed')
    with tempfile.TemporaryDirectory() as folder, ExitStack() as cleanup:
        store = Store(Path(folder) / 'methodatlas.sqlite3')
        cleanup.callback(store.close)
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
            'directory':'/experiment', 'title':'GD 与 Heavy-ball CPU 实验',
            'plan':'f(x,y)=0.5*(x*x+10*y*y)，初值(1,1)，50次迭代；固定实际结果并以独立闭式解核验。',
            'steps':['GD baseline','Heavy-ball 对照'], 'network':False, 'gpu_devices':[], 'max_seconds':180, 'max_storage_mb':10})
        ident = group['id']
        remote.groups.control(project, ident, 'confirm', {'digest':group['digest']})
        remote.groups.workspace(project, ident, {'operation':'write','path':'check.py','before_sha256':'',
            'content':'''import json, math, sys
from pathlib import Path
method = sys.argv[1]
alpha = 0.1 if method == 'gd' else 4 / (math.sqrt(10) + 1)**2
beta = 0 if method == 'gd' else ((math.sqrt(10) - 1) / (math.sqrt(10) + 1))**2
x, previous = [1.0, 1.0], [1.0, 1.0]
for _ in range(50):
    following = [v - alpha * curvature * v + beta * (v - old)
                 for v, old, curvature in zip(x, previous, (1, 10))]
    previous, x = x, following
metrics = {'score': (x[0]**2 + 10*x[1]**2)/2, 'method': method, 'iterations': 50}
print(json.dumps(metrics), flush=True)
Path('metrics.json').write_text(json.dumps(metrics))
'''})
        try:
            remote.groups.workspace(project, ident, {'operation':'read','path':'../authorization.json'})
        except ValueError:
            pass
        else:
            raise AssertionError('workspace escaped')
        body = {'step':0,'command':'python3 check.py gd','request_id':'check'}
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
                            'result_path':'metrics.json','summary':'GD 实际结果'})
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
        expected_gd = 0.5 * 0.9**100
        assert math.isclose(result['record']['metrics']['score'], expected_gd, rel_tol=1e-12)
        raw, _ = remote.result_file(project,result['evidence']['id'])
        assert math.isclose(json.loads(raw)['score'], expected_gd, rel_tol=1e-12)
        assert remote.groups.finish_step(project,ident,0,'GD 与闭式解一致')['status'] == 'active'
        contrast = remote.groups.run(project, ident, {'step':1,'command':'python3 check.py hb','request_id':'contrast'})
        for _ in range(60):
            contrast = remote.observe(project, contrast['id'])
            if contrast['status'] in ('succeeded','failed'):
                break
            time.sleep(.2)
        assert contrast['status'] == 'succeeded', contrast
        recorded = remote.groups.record(project, ident, contrast['id'], 'metrics.json', 'Heavy-ball 实际结果；参数与 GD 不同，不单独归因于动量')
        # Independent repeated-root closed form, not a second copy of the iteration.
        root = (math.sqrt(10)-1)/(math.sqrt(10)+1)
        alpha = 4/(math.sqrt(10)+1)**2
        expected_hb = sum(curvature*((1+50*((1-alpha*curvature)/r-1))*r**50)**2
                          for curvature,r in ((1,root),(10,-root)))/2
        assert math.isclose(recorded['record']['metrics']['score'], expected_hb, rel_tol=1e-9)
        # Reusing metrics.json must not overwrite the earlier fixed evidence.
        original, _ = remote.result_file(project,result['evidence']['id'])
        assert original == raw
        assert remote.groups.finish_step(project,ident,1,'Heavy-ball 与闭式解一致；仅验证此二次函数')['status'] == 'completed'
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
        print('PASS real local Docker: GD vs Heavy-ball, independent closed forms, isolation, idempotency, immutable evidence, target binding')


if __name__ == '__main__':
    main()
