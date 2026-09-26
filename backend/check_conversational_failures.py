"""Real Harness explanation, provider fallback, terminal persistence and fresh requests."""
import json
import tempfile
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from .app import Service
from .agent import ProjectTools
from .errors import AppError


def main():
    calls=[]; mode={'status':200}
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append(body)
            assert not body.get('tools')
            assert 'private_function' not in json.dumps(body)
            if mode['status']!=200:
                self.send_response(mode['status']);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":{"message":"controlled"}}');return
            content=json.dumps({'explanation':'这次内容格式不完整，暂时无法交付。请把分析范围缩小到一个问题，再发送新请求。'},ensure_ascii=False)
            chunk={'id':'explain','object':'chat.completion.chunk','created':0,'model':body['model'],'choices':[{'index':0,'delta':{'role':'assistant','content':content},'finish_reason':None}]}
            done={**chunk,'choices':[{'index':0,'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':20,'total_tokens':30}}
            raw=('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(done)+'\n\ndata: [DONE]\n\n').encode()
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    server=ThreadingHTTPServer(('127.0.0.1',0),Provider);threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with tempfile.TemporaryDirectory() as directory, patch.object(Service,'schedule'):
            service=Service(Path(directory)/'missing',Path(directory));store=service.store
            try:
                service.research.key='controlled';service.research.base_url=f'http://127.0.0.1:{server.server_port}'
                p=store.projects()[0]['id'];c=store.conversations(p)[0]['id']
                def task(name):
                    tid=service.message(p,c,{'text':name,'client_message_id':name})['task_id']
                    store.run("UPDATE tasks SET status='running' WHERE id=?",(tid,));return store.task(tid)
                first=task('生成报告')
                tools=ProjectTools(store,first);tools.set_scope(False)
                partial=tools.call('write_file',{'title':'尚未交付的半成品','kind':'docx','content':'草稿','citation_ids':[]})
                service.research.fail(first,ValueError('JSON private_function malformed'))
                service.research.fail(first,ValueError('duplicate'))
                replies=[m for m in store.messages(c) if m['role']=='assistant' and m['task_id']==first['id']]
                assert len(replies)==1 and '一个问题' in replies[0]['text'] and len(calls)==1
                assert store.task(first['id'])['status']=='failed'
                assert partial['artifact_id'] not in {a['id'] for a in service.project_state(p)['artifacts']}
                assert store.artifact(p,partial['artifact_id']), 'Draft was deleted'
                assert 'private_function' in (Path(directory)/'logs/errors.jsonl').read_text()
                # A later incomplete revision must not replace a delivered version.
                store.run("UPDATE tasks SET status='succeeded' WHERE id=?", (first['id'],))
                revision=task('修改原成果')
                editor=ProjectTools(store,revision);editor.set_scope(False)
                editor.call('read_file', {'artifact_id':partial['artifact_id'], 'version_id':partial['version_id']})
                editor.call('write_file',{'title':'不完整新版','kind':'docx','content':'未交付','citation_ids':[], 'artifact_id':partial['artifact_id'], 'base_version_id':partial['version_id']})
                store.run("UPDATE tasks SET status='failed' WHERE id=?", (revision['id'],))
                assert service.delivered_version(partial['artifact_id'])['id']==partial['version_id']
                assert next(a for a in service.project_state(p)['artifacts'] if a['id']==partial['artifact_id'])['title']=='尚未交付的半成品'

                offline=task('断网请求');service.research.fail(offline,TimeoutError('private timeout'))
                assert len(calls)==1 and '重新发送' in store.messages(c)[-1]['text']
                mode['status']=503
                bad=task('格式异常且解释服务不可用');service.research.fail(bad,ValueError('JSON private_function'))
                assert len(calls)==2,'Explanation must never retry itself'
                assert store.task(bad['id'])['status']=='failed' and store.task(bad['id'])['refs']['failure_reply']
                stopped=task('生成时用户停止')
                def stop(*args,**kwargs):
                    store.run("UPDATE tasks SET status='stopped' WHERE id=?",(stopped['id'],));return {'explanation':'这次内容不完整，请调整后重新发送。'}
                with patch.object(service.research,'complete',side_effect=stop):service.research.fail(stopped,ValueError('JSON'))
                assert not [m for m in store.messages(c) if m['task_id']==stopped['id'] and m['role']=='assistant']
                new=task('调整为一个问题后生成');assert new['id']!=first['id'] and not new['checkpoint']
                old=task('历史任务');store.run("UPDATE tasks SET status='failed',error=? WHERE id=?",('HTTP 402 select_quote',old['id']))
                projected=service.project_state(p)['conversations'][0]['messages']
                old_replies=[m for m in projected if m['task_id']==old['id'] and m['role']=='assistant']
                assert len(old_replies)==1 and '余额' in old_replies[0]['text'] and 'HTTP' not in old_replies[0]['text']
                assert not [m for m in store.messages(c) if m['task_id']==old['id'] and m['role']=='assistant'], 'Historical reads must not mutate data'
                print('PASS: real AI explanation, one-shot fallback, durable reply, no duplicate, hidden drafts, new request, cancellation and legacy projection')
            finally:service.close()
    finally:server.shutdown();server.server_close()


if __name__=='__main__':main()
