"""Issue #13 checks at the public task/control boundary; no paid model needed."""
import tempfile
import threading
import time
import os
import uuid
from pathlib import Path
from unittest.mock import patch

from .app import Service
from .agent import ProjectTools, Research
from .files import render_file
from .state import StaleRun


def wait(service, project, task, statuses):
    end = time.monotonic() + 20
    while time.monotonic() < end:
        view = service.task_view(project, task)
        if view['status'] in statuses:
            return view
        time.sleep(.02)
    raise AssertionError(view)


def execution_checks():
    entered, release = threading.Event(), threading.Event()
    writes = []
    read_counts = {}
    original_read = ProjectTools.read_material
    fail_read = [True]

    def read(tools, paper_id, **kwargs):
        read_counts[paper_id] = read_counts.get(paper_id, 0) + 1
        if tools.task['prompt'] == 'partial' and paper_id == papers[0] and fail_read[0]:
            fail_read[0] = False
            raise TimeoutError('controlled source failure')
        return original_read(tools,paper_id,**kwargs)

    def complete(research, task, system, context, role, *args, **kwargs):
        prompt = task['prompt']
        if role == 'rag-plan':
            return {'mode':'rag','intent':'chat' if prompt == 'chat' else 'research','only_selected':False,
                    'reads':[{'paper_id':p,'query':'method'} for p in papers], 'files':[]}
        if prompt == 'slow' and not release.is_set():
            entered.set()
            assert release.wait(15), 'test gate timed out'
        if prompt == 'wait':
            reply = research.store.wait_for(task['id'],task['revision'],'batch-one',{'title':'候选批次','description':'论文 A'})
            assert reply == {'accepted':True}
        writes.append(prompt)
        outputs = [] if prompt in ('partial','wait') else [{'title':prompt,'kind':'docx','content':'A result','citation_ids':[]}]
        if prompt == 'commit':
            outputs.append({'title':'Second deliverable','kind':'docx','content':'Second result','citation_ids':[]})
        return {'answer':'依据可用材料回答。','files':outputs}

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory, patch.dict(os.environ, {'DEEPSEEK_API_KEY':'test-only'}), patch.object(Research,'complete',complete), patch.object(ProjectTools,'read_material',read):
        root = Path(directory)
        service = Service(root / 'missing',root)
        project = service.store.projects()[0]['id']
        conversation = service.store.conversations(project)[0]['id']
        papers = [service.store.paste(project,title,'The method uses point clouds.') for title in ('A','B')]
        # Text deduplication is intentional; make a genuinely different second source.
        papers[1] = service.store.paste(project,'B','The method uses images.')
        def submit(text, cid=None):
            return service.message(project,cid or conversation,{'text':text,'client_message_id':uuid.uuid4().hex})['task_id']

        try:
            slow = submit('slow')
            assert entered.wait(10)
            queued = submit('queued')
            chat = submit('chat')
            assert wait(service,project,chat,{'succeeded','failed'})['status'] == 'succeeded'
            assert not service.task_view(project,chat)['files']
            assert 'queued' not in writes
            other = service.store.create_conversation(project)
            try:
                service.control(project,other,slow,'stop',{})
            except ValueError:
                pass
            else:
                raise AssertionError('cross-conversation stop accepted')
            stopped = service.control(project,conversation,slow,'stop',{})
            assert stopped['status'] == 'stopped'
            release.set()
            assert wait(service,project,queued,{'succeeded','failed'})['status'] == 'succeeded'
            assert service.task_view(project,slow)['status'] == 'stopped'
            assert not service.task_view(project,slow)['files']
            before = dict(read_counts)
            service.control(project,conversation,slow,'resume',{})
            assert wait(service,project,slow,{'succeeded','failed'})['status'] == 'succeeded'
            assert read_counts == before, 'resume reread completed immutable material'
            Research.run(service.research,slow)
            assert len(service.task_view(project,slow)['files']) == 1

            rendering, promote = threading.Event(), threading.Event()
            def blocked_render(kind,title,content,citations,**options):
                if title == 'render-race':
                    rendering.set()
                    assert promote.wait(10)
                return render_file(kind,title,content,citations,**options)
            with patch('backend.agent.render_file',blocked_render):
                racing = submit('render-race')
                assert rendering.wait(10)
                service.control(project,conversation,racing,'stop',{})
                promote.set()
                following = submit('after-race')
                assert wait(service,project,following,{'succeeded','failed'})['status'] == 'succeeded'
                fenced = service.task_view(project,racing)
                assert fenced['status'] == 'stopped' and not fenced['files']
                assert not any(e['status'] == 'committed' for e in fenced['events'])

            entered.clear(); release.clear()
            old_goal = submit('slow')
            assert entered.wait(10)
            fresh_paper = service.store.paste(project,'New source','New material for a different direction.')
            redirect = {'text':'new-direction','client_message_id':uuid.uuid4().hex,'selected_paper_ids':[fresh_paper]}
            changed = service.control(project,conversation,old_goal,'redirect',redirect)
            assert changed['id'] != old_goal and service.task_view(project,old_goal)['status'] == 'stopped'
            assert fresh_paper in [p['id'] for p in changed['snapshot']]
            assert not changed['plan']
            assert service.control(project,conversation,old_goal,'redirect',redirect)['id'] == changed['id']
            release.set()
            assert wait(service,project,changed['id'],{'succeeded','failed'})['status'] == 'succeeded'

            # Crash after atomic file promotion but before caller acknowledges it.
            original_call = ProjectTools.call
            crashed = [False]
            def crash_after_save(tools,name,args):
                result = original_call(tools,name,args)
                if tools.task['prompt'] == 'commit' and name == 'write_file' and not crashed[0]:
                    crashed[0] = True
                    raise RuntimeError('controlled crash after promotion')
                return result
            with patch.object(ProjectTools,'call',crash_after_save):
                committed = submit('commit')
                assert wait(service,project,committed,{'failed'})['files']
            service.close()
            service = Service(root / 'missing',root)
            def regenerated_output(tools,name,args):
                if name == 'write_file':
                    args = {**args,'content':args['content'] + ' Changed by a resumed model.'}
                return original_call(tools,name,args)
            with patch.object(ProjectTools,'call',regenerated_output):
                service.control(project,conversation,committed,'resume',{})
                recovered = wait(service,project,committed,{'succeeded','failed'})
            assert recovered['status'] == 'succeeded' and len(recovered['files']) == 2
            assert len([e for e in recovered['events'] if e['status'] == 'committed']) == 2

            partial = submit('partial')
            failed_read = wait(service,project,partial,{'succeeded','failed'})
            assert failed_read['status'] == 'succeeded' and len(failed_read['failures']) == 1
            assert failed_read['outcome'] == 'partial_success'
            before = dict(read_counts)
            service.control(project,conversation,partial,'retry',{'call_id':failed_read['failures'][0]['call_id']})
            retried = wait(service,project,partial,{'stopped','failed'})
            assert retried['status'] == 'stopped' and not retried['failures']
            assert read_counts[papers[0]] == before[papers[0]] + 1 and read_counts[papers[1]] == before[papers[1]]

            waiting = submit('wait')
            held = wait(service,project,waiting,{'waiting'})
            wid = held['waits'][0]['id']
            service.close()
            service = Service(root / 'missing',root)
            assert service.task_view(project,waiting)['status'] == 'waiting'
            response = {'wait_id':wid,'response':{'accepted':True}}
            service.control(project,conversation,waiting,'confirm',response)
            service.control(project,conversation,waiting,'confirm',response)
            confirmed = wait(service,project,waiting,{'succeeded','failed'})
            assert confirmed['status'] == 'succeeded'
            assert len([e for e in confirmed['events'] if e['status'] == 'confirmed']) == 1
            try:
                service.control(project,conversation,waiting,'confirm',{'wait_id':wid,'response':{'accepted':False}})
            except ValueError:
                pass
            else:
                raise AssertionError('confirmation consumed twice')
        finally:
            release.set()
            service.close()
    print('PASS: queue/chat, isolated control, late completion, resume cache, atomic commit restart, single read retry, durable confirmation')


def main():
    with tempfile.TemporaryDirectory() as directory, patch('backend.app.Service.schedule'):
        service = Service(Path(directory) / 'missing', Path(directory))
        project = service.store.projects()[0]['id']
        conversation = service.store.conversations(project)[0]['id']
        service.research.key = 'test-only'
        body = {'text': '研究材料', 'client_message_id': 'first'}
        task = service.message(project, conversation, body)['task_id']
        stopped = service.control(project, conversation, task, 'stop', {})
        assert stopped['status'] == 'stopped'
        assert service.message(project, conversation, body)['task_id'] == task
        service.close()
        service = Service(Path(directory) / 'missing', Path(directory))
        assert service.task_view(project, task)['status'] == 'stopped'
        resumed = service.control(project, conversation, task, 'resume', {})
        assert resumed['status'] == 'queued'
        assert service.control(project, conversation, task, 'resume', {})['revision'] == resumed['revision']
        service.store.run("UPDATE tasks SET status='running' WHERE id=?", (task,))
        queued = service.message(project,conversation,{'text':'排队的旧要求','client_message_id':'old-queued'})['task_id']
        other = service.store.create_conversation(project)
        untouched = service.message(project,other,{'text':'另一对话','client_message_id':'other'})['task_id']
        service.research.key = 'test-only'
        replacement = {'text':'按这个新要求回答','client_message_id':'new-goal','replace_active':True}
        newer = service.message(project,conversation,replacement)['task_id']
        assert all(service.store.task(t)['status'] == 'stopped' for t in (task,queued))
        assert service.store.task(untouched)['status'] == 'queued'
        try:
            service.store.assert_active(task,resumed['revision'])
        except StaleRun:
            pass
        else:
            raise AssertionError('late old result was allowed to commit')
        after = service.message(project,conversation,{'text':'后续请求','client_message_id':'after'})['task_id']
        assert service.message(project,conversation,replacement)['task_id'] == newer
        assert service.store.task(after)['status'] == 'queued', 'replaying an old send must not stop newer work'
        service.research.key = 'test-only'
        with patch.object(Research,'complete',return_value={'mode':'direct','intent':'chat','only_selected':False,'answer':'你好！'}) as model:
            service.route(newer)
        direct = service.task_view(project,newer)
        assert model.call_count == 1 and direct['status'] == 'succeeded' and not direct['tools'] and not direct['files']
        service.close()
    print('PASS: stop/reopen/resume and duplicate request')


if __name__ == '__main__':
    main()
    execution_checks()
