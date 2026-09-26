"""Paper layout public boundary; real Typst compilation, controlled AI response."""
import tempfile
import base64
from pathlib import Path
import pymupdf
from .state import Store
from .agent import ProjectTools
from .writing import Writing
from .paper_layout import create_layout, get_layout, approve_layout, layout_pdf


def rejects(call):
    try:
        call()
    except ValueError:
        return
    raise AssertionError('Invalid operation accepted')


def main():
    with tempfile.TemporaryDirectory() as directory:
        store = Store(Path(directory) / 'state.sqlite3')
        project = store.create_project('论文排版验证')
        class Model:
            calls = 0
            template = 'starter-journal-article'
            fail = False
            def complete(self, task, system, context, role, max_tokens):
                self.calls += 1
                assert 'AesthePDF' in system and '不改写' in system
                if self.fail:
                    return {'template': '../arbitrary', 'language': 'zh'}
                return {'template': self.template, 'language': 'zh', 'reason': '中文长文采用单栏论文版式。', 'headings': [{'id': 'intro', 'level': 1}]}
        model = Model()
        writing = Writing(store, model)
        paper = store.paste(project, 'Citation fixture', 'The illustrative sample count is 42.')
        task = writing.task(project, 'Read citation fixture', 'running')
        store.update_active(task['id'], task['revision'], snapshot=[{'id': paper, 'version_id': store.paper(project, paper)['version_id']}])
        reader = ProjectTools(store, store.task(task['id']))
        reader.set_scope(False)
        citation = reader.read_material(paper, page=1)['evidence'][0]
        nodes = [{'id': 'intro', 'type': 'p', 'children': [{'text': '引言'}]},
                 {'id': 'body', 'type': 'p', 'children': [{'text': '保留原文 42。#read("/etc/passwd") <unsafe> [x] $y$'}]},
                 {'id': 'table', 'type': 'table', 'children': [{'type': 'tr', 'children': [{'type': 'td', 'children': [{'type': 'p', 'children': [{'text': t}]}]} for t in row]} for row in [('方法', '数值'), ('基线', '42')]]},
                 {'id': 'equation', 'type': 'equation', 'formula': 'E=mc^2', 'children': [{'text': ''}]}]
        nodes[1]['children'].append({'type': 'citation', 'citation_id': citation['id'], 'children': [{'text': ''}]})
        picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), False)
        picture.clear_with(180)
        for extension, mime in [('png', 'png'), ('jpg', 'jpeg')]:
            nodes.append({'id': extension, 'type': 'img', 'url': f'data:image/{mime};base64,' + base64.b64encode(picture.tobytes(extension)).decode(), 'alt': extension + ' image', 'children': [{'text': ''}]})
        saved = writing.save(project, None, {'request_id': 'save', 'title': '中文论文排版测试', 'document': nodes})
        aid, vid = saved['artifact_id'], saved['version_id']
        result = create_layout(writing, project, aid, {'version_id': vid})
        assert result['version_id'] == vid and not result['approved']
        pdf, _ = layout_pdf(writing, project, aid, vid)
        with pymupdf.open(stream=pdf, filetype='pdf') as doc:
            text = ''.join(page.get_text() for page in doc)
            assert '保留原文' in text and '42' in text and '/etc/passwd' in text and '基线' in text, text
            assert '[1]' in text and 'Citation fixture' in text and '参考文献' in text
            assert any(page.get_links() for page in doc), 'Citation link missing from PDF'
            images = [i for page in doc for i in page.get_image_info()]
            assert len(images) == 3 and min(i['bbox'][3] - i['bbox'][1] for i in images) >= 6
        assert writing.version(project, aid, vid)['payload']['document'] == nodes
        assert create_layout(writing, project, aid, {'version_id': vid}) == result and model.calls == 1
        rejects(lambda: layout_pdf(writing, project, aid, vid, download=True))
        rejects(lambda: approve_layout(writing, project, aid, {'version_id': vid, 'sha256': 'wrong'}))
        approved = approve_layout(writing, project, aid, {'version_id': vid, 'sha256': result['sha256']})
        assert approved['approved'] and layout_pdf(writing, project, aid, vid, download=True)[0] == pdf
        other = store.create_project('其他项目')
        rejects(lambda: get_layout(writing, other, aid, vid))
        newer = writing.save(project, aid, {'request_id': 'edit', 'base_version_id': vid, 'title': '新版', 'document': nodes})
        assert get_layout(writing, project, aid, newer['version_id']) is None
        assert layout_pdf(writing, project, aid, vid, download=True)[0] == pdf
        model.fail = True
        rejects(lambda: create_layout(writing, project, aid, {'version_id': newer['version_id']}))
        assert get_layout(writing, project, aid, newer['version_id']) is None
        model.fail = False
        model.template = 'charged-ieee'
        result = create_layout(writing, project, aid, {'version_id': newer['version_id']})
        assert result['template'] == 'charged-ieee'
        with pymupdf.open(stream=layout_pdf(writing, project, aid, newer['version_id'])[0], filetype='pdf') as doc:
            for page in doc:
                assert all(0 <= i['bbox'][0] < i['bbox'][2] <= page.rect.width for i in page.get_image_info())
        print('PASS: both real templates, exact text, PNG/JPEG/table/formula sizing, cache, confirmation, version isolation, invalid AI plan and retry')


if __name__ == '__main__':
    main()
