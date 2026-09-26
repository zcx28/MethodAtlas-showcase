"""Public message/version boundary with real Harness and a controlled model HTTP server."""
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from .app import Service
from .audit import render, requested_mode
from .state import new_id, now


def main():
    assert requested_mode('请对当前论文查新，只生成报告') == 'novelty'
    assert requested_mode('请独立审阅当前论文') == 'review'
    assert requested_mode('请独立审阅当前论文，不要修改') == 'review'
    assert requested_mode('进行引用核查') == 'citation'
    assert requested_mode('请解释什么是查新') is None
    assert requested_mode('请根据核查报告修改论文') is None
    metadata = {'summary': '年份核对', 'limitations': [], 'findings': [{'location': 'ref', 'quote': '2020', 'severity': '主要', 'finding': '来源年份不符', 'support': '元数据核验', 'evidence_ids': ['S1'], 'suggestion': '按来源修正年份'}]}
    args = ({'title': '检查', 'version_id': 'v1', 'sha256': 'check'}, {'ref': '2020'}, {}, None, {'S1': {'title': '受控元数据'}}, [], [])
    assert '相关材料' in render(metadata, *args)[0]
    metadata['findings'][0]['support'] = '全文核验'
    assert '全文核验' not in render(metadata, *args)[0]
    calls, controls = [], {'invalid': False, 'mode': 'review', 'failure': False}
    entered, release = threading.Event(), threading.Event()
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(body)
            assert not body.get('tools'), 'Independent review cannot acquire tools or chat history'
            raw_context = next(m['content'] for m in reversed(body['messages']) if m['role'] == 'user')
            context = json.loads(raw_context)
            assert body.get('thinking') == {'type':'disabled'}, 'Auto thinking must remain disabled'
            if 'user_request' in context:
                # Deliberately omit audit: explicit requests must still reach the restricted path.
                answer = {'intent': 'research', 'mode': 'explore', 'only_selected': False, 'reason': '核查'}
            else:
                assert 'AUTHOR_DEFENSE_SECRET' not in json.dumps(body), 'Author defence leaked into review'
                assert 'recovered_dialogue' not in context
                if controls['mode'] == 'novelty' and 'quotes' not in context and 'candidates' not in context:
                    assert '# 查新模式' in json.dumps(body, ensure_ascii=False)
                if controls['mode'] == 'citation' and 'quotes' not in context and 'candidates' not in context:
                    assert '# 引用核查模式' in json.dumps(body, ensure_ascii=False)
                if 'candidates' in context:
                    answer = {'keep':[c['index'] for c in context['candidates']], 'summary':'缺少支撑，不能判通过。'}
                elif 'quotes' in context:
                    location, quote = next(iter(context['original_locations'].items()))
                    answer = {'summary':'缺少支撑，不能判通过。','limitations':[],'findings':[{'location':'made-up' if controls['invalid'] else location,'quote':'not-original' if controls['invalid'] else quote,'severity':'主要','finding':'创新主张缺少对照。','support':'摘要支持','evidence_ids':[key for key,value in context['quotes'].items() if value['text'] in ('Prior work exists.','Comparison is required.')],'suggestion':'补充对照。'}],'recommendations':[]}
                elif 'evidence' not in context:
                    answer = {'searches': [{'direction': d, 'query': 'controlled '+d} for d in ('机制', '应用', '结果')] if controls['mode'] == 'novelty' else [], 'reads': [{'paper_id': evidence_paper, 'query': ''}]}
                else:
                    if controls.get('hold'):
                        entered.set(); release.wait(15)
                    if controls['failure']:
                        self.send_response(402); self.send_header('Content-Type', 'application/json'); self.end_headers()
                        self.wfile.write(b'{"error":{"message":"controlled failure"}}'); return
                    location, quote = next(iter(context['locations'].items()))
                    answer = {'summary': '缺少支撑，不能判通过。', 'limitations': ['受控检查，不代表真实科学核查'], 'findings': [{'location': 'made-up' if controls['invalid'] else location, 'quote': quote, 'severity': '主要', 'finding': '创新主张缺少对照。', 'support': '未核验', 'evidence_ids': [], 'suggestion': '补充基线对照与引用。'}]}
                    eid = next(iter(context['evidence']))
                    answer['findings'][0].update(support='摘要支持', evidence_ids=[eid], evidence_quotes=[{'id':eid,'quote':'Prior work exists.'},{'id':eid,'quote':'Comparison is required.'}])
            chunk = {'id': 'audit-check', 'object': 'chat.completion.chunk', 'created': 0, 'model': body['model'], 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': json.dumps(answer, ensure_ascii=False)}, 'finish_reason': None}]}
            done = {**chunk, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120}}
            raw = ('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(done)+'\n\ndata: [DONE]\n\n').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Content-Length', str(len(raw))); self.end_headers()
            try:
                self.wfile.write(raw)
            except OSError:
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
        service = Service(Path(folder)/'pdfs', Path(folder))
        service.schedule = lambda: None
        service.research.key, service.research.base_url = 'local-check', f'http://127.0.0.1:{server.server_port}'
        store = service.store
        project = store.create_project('核查检查')
        conversation = store.conversations(project)[0]['id']
        evidence_paper = store.paste(project,'核查依据','Prior work exists. An intervening sentence. Comparison is required.')
        document = [{'id': 'claim', 'type': 'p', 'children': [{'text': 'We are the first and best method.'}]}]
        original = service.writing.save(project, None, {'request_id': 'original', 'title': '待审论文', 'document': document})
        store.run("INSERT INTO messages(id,conversation_id,role,text,created) VALUES(?,?,'assistant',?,?)", (new_id('message'), conversation, 'AUTHOR_DEFENSE_SECRET', now()))
        def submit():
            prompt = {'review': '独立审阅论文', 'citation': '引用核查', 'novelty': '请查新'}[controls['mode']]
            response = service.message(project, conversation, {'text': prompt + '，只给报告', 'client_message_id': new_id('request'), 'reference': {k: original[k] for k in ('artifact_id', 'version_id')}})
            service.route(response['task_id'])
            return response['task_id']
        try:
            task = submit()
            newer = service.writing.save(project, original['artifact_id'], {'request_id': 'newer', 'base_version_id': original['version_id'], 'title': '新版', 'document': [{'id': 'new', 'type': 'p', 'children': [{'text': 'Changed after submission.'}]}]})
            service.research.run(task)
            assert store.task(task)['status'] == 'succeeded', store.task(task)
            review_contexts = [json.loads(next(m['content'] for m in reversed(call['messages']) if m['role']=='user')) for call in calls]
            assert any(c.get('request') == '独立审阅论文，只给报告' and 'evidence' in c for c in review_contexts), 'The reviewer lost the user request'
            assert store.task(task)['checkpoint']['audit_baseline']['version_id'] == original['version_id']
            assert store.task(task)['checkpoint']['audit_report']['findings'][0]['quote'] == 'We are the first and best method.'
            assert len(store.artifact(project, original['artifact_id'])['versions']) == 2
            report_id = store.task(task)['artifact_id']
            report = store.artifact(project, report_id)['versions'][0]
            original_bytes = service.file_path(project, report).read_bytes()
            assert '第 1 项' in report['body'] and '原文核验' not in report['body']
            assert report['citations'] and all('Prior work exists.' in c['quote'] for c in report['citations'])
            other = store.create_project('其他项目')
            try:
                service.message(other, store.conversations(other)[0]['id'], {'text': '核查', 'client_message_id': 'forged', 'reference': {k: original[k] for k in ('artifact_id', 'version_id')}})
                raise AssertionError('Cross-project draft accepted')
            except ValueError:
                pass
            controls['invalid'] = True
            invalid = submit(); service.research.run(invalid)
            assert store.task(invalid)['status'] == 'succeeded' and store.task(invalid)['artifact_id']
            controls.update(invalid=False, failure=True)
            failure = submit(); service.research.run(failure)
            assert store.task(failure)['status'] == 'failed' and not store.task(failure)['artifact_id']
            controls.update(failure=False, hold=True)
            stopped = submit()
            runner = threading.Thread(target=service.research.run, args=(stopped,)); runner.start()
            assert entered.wait(120)
            service.control(project, conversation, stopped, 'stop', {})
            release.set(); runner.join(120)
            assert not runner.is_alive() and store.task(stopped)['status'] == 'stopped' and not store.task(stopped)['artifact_id']
            controls.update(hold=False, mode='novelty')
            novelty = submit()
            with patch('backend.discovery.discover', side_effect=TimeoutError('controlled source timeout')):
                service.research.run(novelty)
            assert store.task(novelty)['status'] == 'succeeded', store.task(novelty)
            assert 'controlled source timeout' not in store.artifact(project, store.task(novelty)['artifact_id'])['versions'][0]['body']
            assert any('超时' in gap for gap in store.task(novelty)['checkpoint']['audit_review_evidence']['gaps'])
            assert 'controlled source timeout' in (store.root / 'logs' / 'errors.jsonl').read_text()
            controls['mode'] = 'citation'
            citation = submit(); service.research.run(citation)
            assert store.task(citation)['status'] == 'succeeded'
            prepared = submit()
            with patch('backend.agent.ProjectTools.write_file', side_effect=OSError('controlled disk failure')):
                service.research.run(prepared)
            assert store.task(prepared)['status'] == 'failed' and store.task(prepared)['checkpoint']['audit_prepared']
            service.control(project, conversation, prepared, 'resume', {})
            with patch.object(service.research, 'complete', side_effect=AssertionError('Prepared report must not rebind evidence or regenerate')):
                service.research.run(prepared)
            assert store.task(prepared)['status'] == 'succeeded'
            assert service.file_path(project, report).read_bytes() == original_bytes
            saved_count = len(store.artifacts(project))
            service.research.run(task)
            assert len(store.artifacts(project)) == saved_count
            service.close()
            service = Service(Path(folder)/'pdfs', Path(folder))
            assert service.store.task(task)['status'] == 'succeeded'
            assert service.file_path(project, report).read_bytes() == original_bytes
            print('PASS: real Harness; first-party Skills; isolated context; frozen versions; project rejection; non-exact locations saved; failure; cancellation; source timeout; read-only; restart; idempotence')
        finally:
            release.set()
            if 'runner' in locals():
                runner.join(120)
            service.close(); server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
