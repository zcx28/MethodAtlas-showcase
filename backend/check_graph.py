"""Public file/HTTP graph regression; controlled verifier is not a real-model acceptance."""
import copy
import json
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace
from urllib.request import Request, urlopen

from .agent import ProjectTools
from .app import Handler, Service, ThreadingHTTPServer


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        service = Service(Path(directory) / 'missing', Path(directory))
        store = service.store
        project = store.projects()[0]['id']
        conversation = store.conversations(project)[0]['id']
        ids = [store.paste(project, title, body) for title, body in [
            ('Alpha', 'Alpha introduces method A.'),
            ('Beta', 'Beta extends Alpha method A using a new encoder. Only tested indoors.'),
            ('Isolated', 'Isolated studies a different problem.')]]
        task = service.message(project, conversation, {'text': '生成论文关系图谱', 'client_message_id': 'graph-check'}, schedule=False)['task_id']
        store.run("UPDATE tasks SET status='running' WHERE id=?", (task,))
        tools = ProjectTools(store, store.task(task))
        tools.set_scope(False)
        readings = [tools.read_material(pid) for pid in ids]
        citations = [r['evidence'][0]['id'] for r in readings]
        nodes = [{'paper_id': pid, 'version_id': store.paper(project, pid)['version_id'], 'title': title,
                  'problem': '问题待进一步研究', 'approach': '原文方法', 'limitations': '仅在给定条件下验证', 'citation_ids': [cid]}
                 for pid, title, cid in zip(ids, ['Alpha', 'Beta', 'Isolated'], citations)]
        spec = {'focus': '方法继承', 'all_papers': False, 'unverified': ['主题相似不构成继承'], 'nodes': nodes,
                'edges': [{'source': ids[0], 'target': ids[1], 'relationship': '继承', 'explanation': 'Beta 用新编码器扩展 Alpha，测试限室内', 'citation_ids': [citations[1]]}]}
        accepted = True
        def no_verifier(*args, **kwargs):
            raise AssertionError('Saving a graph must not call a verifier')
        tools.research = SimpleNamespace(complete=no_verifier)
        first = tools.write_file('论文关系图谱', 'graph', json.dumps(spec), citations)
        version = service.file_version(project, first['artifact_id'], first['version_id'])
        raw = service.file_path(project, version).read_bytes()
        from .exports import documents
        import re
        _, printed_html = documents(version)
        assert all('class="citation"' not in heading for heading in re.findall(r'<h2>(.*?)</h2>',printed_html))
        assert '待核对' not in printed_html and 'class="citation"' in printed_html
        assert b'function startSimulation()' in raw and b'Content-Security-Policy' in raw
        assert b'Isolated studies a different problem.' in raw and b'Beta extends Alpha' in raw
        assert len(version['materials']) == 3 and json.loads(version['body'])['edges'][0]['target'] == ids[1]
        try: tools.write_file('bypass', 'html', '<svg></svg>', citations)
        except ValueError: pass
        else: raise AssertionError('Graph validation bypassed through HTML')
        for field, value in [('citation_ids', []), ('citation_ids', [citations[0]]), ('relationship', '主题相似'), ('target', 'foreign')]:
            bad = copy.deepcopy(spec); bad['edges'][0][field] = value
            try: tools.write_file('invalid', 'graph', json.dumps(bad), citations)
            except ValueError: pass
            else: raise AssertionError('Invalid graph accepted')
        bad = copy.deepcopy(spec); bad['nodes'] = nodes * 6
        try: tools.write_file('too many', 'graph', json.dumps(bad), citations)
        except ValueError: pass
        else: raise AssertionError('Default graph exceeded 15')
        foreign = store.create_project('Unrelated project')
        foreign_paper = store.paste(foreign, 'Foreign', 'Foreign paper is not part of this project.')
        bad = copy.deepcopy(spec); bad['nodes'][0]['paper_id'] = foreign_paper
        try: tools.write_file('foreign', 'graph', json.dumps(bad), citations)
        except ValueError: pass
        else: raise AssertionError('Cross-project paper accepted')
        accepted = False
        rejected_spec = copy.deepcopy(spec)
        rejected_spec['edges'][0]['explanation'] += '，并声称在室外有效'  # A new claim must bypass the accepted-claim cache.
        tools.write_file('模型分析', 'graph', json.dumps(rejected_spec), citations)
        accepted = True
        tools.read_file(first['artifact_id'], first['version_id'])
        spec['unverified'].append('新增待核实项')
        second = tools.write_file('修订图谱', 'graph', json.dumps(spec), citations, first['artifact_id'], first['version_id'])
        assert second['version_no'] == 2 and service.file_path(project, version).read_bytes() == raw
        server = ThreadingHTTPServer(('127.0.0.1', 0), type('GraphCheckHandler', (Handler,), {'service': service}))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}/api/projects/{project}/artifacts/{first["artifact_id"]}'
        try:
            body = json.dumps({'version_id': first['version_id'], 'base_version_id': second['version_id']}).encode()
            def restore():
                return json.load(urlopen(Request(base + '/restore', data=body, headers={'Content-Type': 'application/json'})))
            restored = restore()
            assert restore() == restored, 'Repeated restore created a duplicate version'
            assert len(store.artifact(project, first['artifact_id'])['versions']) == 3
            assert service.file_version(project, first['artifact_id'], restored['version_id'])['task_id'] != task
            assert urlopen(base + '/versions/' + restored['version_id'] + '/download').read() == raw
            import pymupdf
            printed = urlopen(base + '/versions/' + restored['version_id'] + '/export?format=pdf').read()
            with pymupdf.open(stream=printed,filetype='pdf') as pdf:
                text = ''.join(page.get_text() for page in pdf)
                assert all(name in text for name in ('Alpha','Beta','Isolated')) and '测试限室内' in text
                assert any(page.get_images() for page in pdf) and any(page.get_links() for page in pdf)
            preview = json.load(urlopen(base + '/versions/' + restored['version_id'] + '/preview'))['content']
            assert 'const HOST = null;' in preview and 'graph-tools' not in preview
            from .graph import preview_graph
            old_adapter = '<script nonce="frozen">// Host-only adapter.\nconst oldControls = true;</script>'
            refreshed = preview_graph(old_adapter)
            assert 'nonce="frozen"' in refreshed and 'oldControls' not in refreshed and 'new ResizeObserver' in refreshed
            assert preview_graph(refreshed) == refreshed
            data_marker = '<script nonce="data">const DATA={text:"// Host-only adapter."};</script>'
            assert preview_graph(data_marker + old_adapter).startswith(data_marker)
            extra = [store.paste(project, f'Paper {i}', f'Paper {i} has no established relationship.') for i in range(13)]
            all_task = service.message(project, conversation, {'text': '仅这些，生成全部论文关系图谱', 'selected_paper_ids': ids + extra, 'client_message_id': 'all-graph-check'}, schedule=False)['task_id']
            store.run("UPDATE tasks SET status='running' WHERE id=?", (all_task,))
            all_tools = ProjectTools(store, store.task(all_task)); all_tools.set_scope(True)
            all_nodes, all_citations = [], []
            for pid in ids + extra:
                paper = store.paper(project, pid)
                cid = all_tools.read_material(pid)['evidence'][0]['id']; all_citations.append(cid)
                all_nodes.append({**nodes[0], 'paper_id': pid, 'version_id': paper['version_id'], 'title': paper['title'], 'citation_ids': [cid]})
            full = {**spec, 'all_papers': True, 'nodes': all_nodes, 'edges': []}
            all_saved = all_tools.write_file('全量孤立论文', 'graph', json.dumps(full), all_citations)
            assert len(service.file_version(project, all_saved['artifact_id'], all_saved['version_id'])['materials']) == 16
            assert len(json.loads(all_tools.read_file(all_saved['artifact_id'], all_saved['version_id'])['body'])['nodes']) == 16
        finally:
            server.shutdown(); server.server_close(); service.close()
    print('PASS graph renderer, reference ownership, no verifier, isolation, 15-node default, immutable revision, HTTP restore and offline bytes')


if __name__ == '__main__':
    main()
