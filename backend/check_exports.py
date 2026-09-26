"""Version export checks through the real HTTP/download boundary; no model calls."""
import base64
import json
import re
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import urlopen

import pymupdf

from .agent import ProjectTools
from .exports import documents, render_pdf
from .app import Handler, Service, ThreadingHTTPServer


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        root = Path(directory)
        service = Service(root / 'missing', root)
        project = service.store.projects()[0]['id']
        conversation = service.store.conversations(project)[0]['id']
        paper = service.store.paste(project, '版本材料', '方法只在室内验证。')
        task = service.message(project, conversation, {'text': '生成成果', 'client_message_id': 'export-check'}, schedule=False)['task_id']
        service.store.run("UPDATE tasks SET status='running' WHERE id=?", (task,))
        tools = ProjectTools(service.store, service.store.task(task))
        tools.set_scope(False)
        cite = tools.read_material(paper)['evidence'][0]['id']
        content = f'# 方法比较\n\n仅在室内验证。[cite:{cite}]\n\n| 方法 | 条件 |\n| --- | --- |\n| 甲 | 室内 |\n\n## 技术演进\n\n阶段一：方法甲。'
        saved = tools.write_file('历史研究', 'docx', content, [cite])
        server = ThreadingHTTPServer(('127.0.0.1', 0), type('ExportHandler', (Handler,), {'service': service}))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}/api/projects/{project}/artifacts/{saved["artifact_id"]}'
        try:
            url = base + f'/versions/{saved["version_id"]}/export?format='
            markdown = urlopen(url + 'markdown').read().decode('utf-8')
            assert '| 甲 | 室内 |' in markdown and '技术演进' in markdown
            assert tools.read_file(saved['artifact_id'], saved['version_id'])['materials'][0]['paper_version_id'] in markdown
            raw = urlopen(url + 'pdf').read()
            with pymupdf.open(stream=raw, filetype='pdf') as pdf:
                assert '历史研究' in ''.join(p.get_text() for p in pdf)
            _, doc_html = documents(service.file_version(project,saved['artifact_id'],saved['version_id']))
            assert 'class="citation"' in doc_html
            before = json.loads(urlopen(base).read())
            assert urlopen(url + 'pdf').read() == raw
            with pymupdf.open() as fixture:
                fixture.new_page().insert_text((60,80),'Figure 1: 42')
                image_paper = service.store.import_pdf_bytes(project,fixture.tobytes(),'图表原文')
            from .vision import read_figure
            figure_task = service.message(project,conversation,{'text':'解读图表','client_message_id':'figure-export-check'},schedule=False)['task_id']
            service.store.run("UPDATE tasks SET status='running' WHERE id=?",(figure_task,))
            figure_tools = ProjectTools(service.store,service.store.task(figure_task))
            figure_tools.set_scope(False)
            figure_tools.research = SimpleNamespace(settings=SimpleNamespace(for_task=lambda task:({'model':'controlled-test'},{})),complete=lambda *args,**kwargs: (
                {'keep':[0],'gaps':['待核对的内部提示']} if args[3]=='vision-check' else
                {'readable':True,'observations':[{'text':'图中数值为42','basis':'image','visible':'42'}],'gaps':[]}))
            figure = read_figure(figure_tools,image_paper,1,'数值是多少？',rect=[50,50,220,100])['evidence'][0]
            service.store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(figure_task,))
            figure_url = f'http://127.0.0.1:{server.server_port}/api/projects/{project}/citations/{figure["id"]}/export'
            with pymupdf.open(stream=urlopen(figure_url).read(),filetype='pdf') as pdf:
                figure_text=''.join(page.get_text() for page in pdf)
                assert '图中数值为42' in figure_text and '待核对' not in figure_text and any(page.get_images() for page in pdf)
            assert json.loads(urlopen(base).read()) == before
            tools.read_file(saved['artifact_id'], saved['version_id'])
            revised = tools.write_file('修订研究', 'docx', content + '\n\n修订说明：增加室外验证计划（待验证）。', [cite], saved['artifact_id'], saved['version_id'])
            new_url = base + f'/versions/{revised["version_id"]}/export?format='
            assert '室外验证计划' in urlopen(new_url + 'markdown').read().decode()
            assert urlopen(url + 'markdown').read().decode() == markdown
            assert urlopen(url + 'pdf').read() == raw
            # Stored HTML contains actual methods, a directed map, table and ordered stages.
            svg = '<svg viewBox="0 0 400 120"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="black"></path></marker></defs><text x="10" y="50" font-size="20">方法甲</text><path d="M100,45 L260,45" stroke="black" marker-end="url(#arrow)"></path><text x="280" y="50" font-size="20">方法乙</text></svg>'
            svg = svg.replace('stroke="black" marker-end', 'class="edge" marker-end')
            rows = ''.join(f'<tr><td>比较行{i}</td><td>中文跨页条件与限制</td></tr>' for i in range(100))
            source = f'<style>.edge{{stroke:black;fill:none}}</style><h1>方法与演进</h1><p data-citation="{cite}">仅在室内验证</p>{svg}<table><tr><th>方法</th><th>条件</th></tr>{rows}</table><h2>技术演进</h2><ol><li>阶段甲<ul><li>子阶段</li></ul></li><li>阶段乙</li></ol><pre><code>a &amp; b &lt; c</code></pre><details><summary>方法说明</summary><p>最终说明结束</p></details>'
            mapped = tools.write_file('方法与演进', 'html', source, [cite])
            mapped_url = base.replace(saved['artifact_id'], mapped['artifact_id']) + f'/versions/{mapped["version_id"]}/export?format='
            md = urlopen(mapped_url + 'markdown').read().decode()
            assert '| 比较行99 |' in md and '阶段乙' in md and 'data:image/png;base64,' in md
            assert '```\na & b < c\n```' in md and '   - 子阶段' in md
            diagram = pymupdf.Pixmap(base64.b64decode(re.search(r'data:image/png;base64,([^)]*)', md)[1]))
            assert diagram.pixel(720, 180) == (0, 0, 0, 255), 'CSS-defined relationship edge disappeared'
            with ThreadPoolExecutor(2) as pool:
                pdfs = list(pool.map(lambda _: urlopen(mapped_url + 'pdf').read(), range(2)))
            assert pdfs[0] == pdfs[1]
            with pymupdf.open(stream=pdfs[0], filetype='pdf') as pdf:
                text = ''.join(p.get_text() for p in pdf)
                assert len(pdf) > 2 and '比较行99' in text and '最终说明结束' in text
                assert sum(len(p.get_images()) for p in pdf) > 0
                assert any(p.get_links() for p in pdf)
            # Unified presentation must not drop years, detail, or uncited material versions.
            from .files import render_file
            from .methods import render
            old = service.file_version(project, saved['artifact_id'], saved['version_id'])
            node = dict(name='历史方法',summary='概要',detail='唯一的详细介绍',conditions='室内',metrics='未记录数值',limitations='室外未验证',period='1981–1989',problem='控制问题',improvement='改进待核对',evidence=[f'[cite:{cite}]'])
            research = dict(view='evolution',title='年代保留检查',summary='研究定位',nodes=[node],gaps=[],opportunities=[])
            markup, _ = render(json.dumps(research), old['citations'])
            _, body = render_file('html',research['title'],markup,old['citations'])
            version = {**old,'kind':'html','title':research['title'],'body':body,'payload':{'research':research},'materials':old['materials']+[{'title':'未引用但已读取的材料','paper_id':'uncited','paper_version_id':'paper_version_abcdef12'}]}
            md, ht = documents(version)
            _, retitled = documents({**version,'title':'另一种成果名称'})
            assert retitled.count('<h1>') == 1 and '<h1>另一种成果名称</h1>' in retitled
            assert '1981–1989' in md and '1981–1989' in ht
            assert ht.count('唯一的详细介绍') == 1 and '关闭详情' not in ht
            assert '原文 [' not in ht
            _, cited = documents({**version,'body':f'<p>正文<button data-citation="{cite}">[1]</button></p>'})
            assert 'class="citation"' in cited and '[1]</a>' in cited
            _, button_claim = documents({**version,'body':f'<button data-citation="{cite}">Accuracy is 80% indoors only.</button>'})
            assert 'Accuracy is 80% indoors only.' in button_claim and '[1]</a>' in button_claim
            assert '未引用但已读取的材料' in ht and 'abcdef12' in ht
            assert '1981–1989' in ''.join(page.get_text() for page in pymupdf.open(stream=render_pdf(ht), filetype='pdf'))
            legacy_body = '<div class="research-timeline"><button data-method="0">历史方法 · 1981–1989</button></div><section class="research-detail" data-detail="0" hidden><button data-close-detail="0">关闭详情</button><h2>历史方法</h2><p>旧版正文</p></section>'
            old_md, old_ht = documents({**version,'body':legacy_body})
            assert '1981–1989' in old_md and old_ht.count('1981–1989') == 1 and '旧版正文' in old_ht
            _, titled = render_file('html','统一标题','<p>没有自带标题的内容</p>',[])
            assert '<h1>统一标题</h1>' in titled
            assert 'body.reading-view' in urlopen(f'http://127.0.0.1:{server.server_port}/report.css').read().decode()
            # Conversion fails after a valid old version exists, without damaging its files.
            tools.read_file(mapped['artifact_id'], mapped['version_id'])
            broken = tools.write_file('表格有误', 'html', '<table><tr><td>甲</td></tr><tr><td>乙</td><td>丙</td></tr></table>', [], mapped['artifact_id'], mapped['version_id'])
            other_project = service.store.create_project('另一个项目')
            invalid_urls = [
                mapped_url.replace(mapped['version_id'], broken['version_id']) + 'pdf',
                url + 'docx', url.replace(project, other_project) + 'pdf',
                url.replace(saved['version_id'], mapped['version_id']) + 'pdf',
                figure_url.replace(project,other_project),
            ]
            for invalid in invalid_urls:
                try:
                    urlopen(invalid)
                except HTTPError as error:
                    assert error.code == 400
                    if broken['version_id'] in invalid:
                        assert '表格列数不一致' in json.loads(error.read())['error']
                else:
                    raise AssertionError('Invalid export accepted')
            assert urlopen(mapped_url + 'pdf').read() == pdfs[0]
            original = service.file_path(project, service.file_version(project, saved['artifact_id'], saved['version_id'])).read_bytes()
            # Restart and later material edits cannot retarget the saved citation snapshot.
            service.store.run("UPDATE tasks SET status='succeeded' WHERE id=?", (task,))
            service.close()
            service = Service(root / 'missing', root)
            server.RequestHandlerClass.service = service
            assert urlopen(url + 'pdf').read() == raw
            assert service.file_path(project, service.file_version(project, saved['artifact_id'], saved['version_id'])).read_bytes() == original
            service.store.run('UPDATE papers SET title=? WHERE id=?', ('改名后的当前材料', paper))
            assert urlopen(url + 'markdown').read().decode() == markdown
        finally:
            server.shutdown()
            server.server_close()
            service.close()
    print('PASS historical Markdown/PDF download, provenance and repeatability')


if __name__ == '__main__':
    main()
