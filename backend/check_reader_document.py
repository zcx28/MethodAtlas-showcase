"""Public HTTP checks for continuous reading and immutable source anchors."""
import json
import hashlib
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pymupdf

from .app import Handler, Service


def check_formula_continuations():
    from . import reader_document as module

    def item(kind, value, page, rect):
        return {'kind': kind, 'text': value, 'fragments': [{'page': page, 'rects': [rect]}]}

    left = item('paragraph', 'States with', 1, [320, 700, 565, 745])
    right = item('formula', 'perturbations Zq are processed as model inputs. Observations Uq are supplied separately.', 2, [50, 50, 295, 100])
    assert module._continues(left, right), 'English body misclassified as formula must complete an unfinished page-boundary sentence'
    assert module._continues({**left, 'fragments': [{'page': 1, 'rects': [[50, 700, 295, 745]]}]},
        {**right, 'fragments': [{'page': 1, 'rects': [[320, 50, 565, 100]]}]}), 'same-page column continuation is still a physical boundary'
    assert not module._continues({**left, 'text': 'States with a complete result.'}, right)
    assert not module._continues(left, {**right, 'fragments': [{'page': 1, 'rects': [[320, 750, 565, 780]]}]}), 'same column is not a continuation boundary'
    for value in ('x-1', 'α-β', 'alpha + beta + gamma + delta', 'Theorem x = y'):
        assert not module._continues(left, {**right, 'text': value}), 'pure mathematics must not be reinterpreted as prose'
    assert not module._continues(left, {**right, 'text': right['text'].capitalize()}), 'a new upper-case sentence stays separate'

    pages = []
    for number, entries in enumerate(( [('paragraph', 'Independent first argument.'), ('paragraph', left['text'])],
        [('formula', right['text']), ('formula', 'x-\n1'), ('paragraph', 'A separate complete argument.')] ), 1):
        source, blocks, layout = '', [], []
        for index, (kind, value) in enumerate(entries):
            start, rect = len(source), [50, 50 + index * 80, 295, 100 + index * 80]
            source += value + '\n'
            blocks.append({'text': value, 'start': start, 'end': start + len(value), 'rect': rect})
            layout.append({'kind': kind, 'text': value, 'rect': rect})
        pages.append({'page': number, 'width': 612, 'height': 792, 'text': source, 'blocks': blocks, 'layout': layout})
    paper = {'id': 'paper_fixture', 'version_id': 'version_fixture', 'sha256': 'a' * 64,
        'source_path': None, 'pages': json.dumps(pages)}
    fixed_rule = module._continues
    try:
        # Historical fixture: the previous parser always rejected formula continuations.
        module._continues = lambda a, b: b['kind'] != 'formula' and fixed_rule(a, b)
        old = module.reader_document(paper, 'project_fixture')
    finally:
        module._continues = fixed_rule
    current = module.reader_document(paper, 'project_fixture')
    assert len(old['paragraphs']) == 5 and len(current['paragraphs']) == 4
    merged = current['paragraphs'][1]
    assert merged['kind'] == 'paragraph' and merged['text'] == left['text'] + ' ' + right['text']
    assert merged['id'] not in {p['id'] for p in old['paragraphs']}, 'a complete source needs its own identity'
    raw_keys = ('page', 'text', 'start', 'end', 'rects', 'source_path')
    assert [{k: f[k] for k in raw_keys} for f in merged['fragments']] == [
        {k: p['fragments'][0][k] for k in raw_keys} for p in old['paragraphs'][1:3]]
    assert [p for p in current['paragraphs'] if p['id'] in {p['id'] for p in old['paragraphs']}] == [
        old['paragraphs'][0], *old['paragraphs'][3:]], 'unrelated paragraph IDs or fragments changed'
    assert paper['pages'] == json.dumps(pages) and current['source_sha256'] == paper['sha256']
    assert current['paragraphs'][2]['text'] == 'x- 1', 'formula subtraction must survive grouping changes'
    column_source = left['text'] + '\n' + right['text']
    column_layout = [{'kind': p['kind'], 'text': p['text'], 'rect': rect} for p, rect in
        ((left, [50, 700, 295, 745]), (right, [320, 50, 565, 100]))]
    column_blocks = [{**p, 'start': start, 'end': start + len(p['text'])} for p, start in
        zip(column_layout, (0, len(left['text']) + 1))]
    column_pages = [{'page': 1, 'width': 612, 'height': 792, 'text': column_source,
        'blocks': column_blocks, 'layout': column_layout}]
    column_document = module.reader_document({**paper, 'pages': json.dumps(column_pages)}, 'project_fixture')
    assert len(column_document['paragraphs']) == 1 and len(column_document['paragraphs'][0]['fragments']) == 2
    assert column_document['paragraphs'][0]['text'] == merged['text'], 'reading order must join the left/right column prose in the document itself'
    print('PASS: formula-kind English continuation, page/column boundaries, pure-math/complete-sentence exclusions, new identity and immutable raw fragments')


def main():
    check_formula_continuations()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        service = Service(root / 'papers', root / 'data', background=False)
        server = ThreadingHTTPServer(('127.0.0.1', 0), type('DocumentCheck', (Handler,), {'service': service}))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'

        def request(path, body=None, content_type='application/json', fail=False):
            raw = json.dumps(body).encode() if body is not None and not isinstance(body, bytes) else body
            req = urllib.request.Request(base + path, data=raw, headers={'Content-Type': content_type, 'Origin': base})
            try:
                with urllib.request.urlopen(req) as response:
                    result = json.load(response)
                assert not fail, 'invalid document scope accepted'
                return result
            except urllib.error.HTTPError as error:
                assert fail, error.read().decode()

        def upload(project, raw, target=None):
            boundary = 'reader-document-test'
            data = b'--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="files"; filename="continuous.pdf"\r\nContent-Type: application/pdf\r\n\r\n' + raw + b'\r\n'
            if target:
                data += b'--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="target_paper_id"\r\n\r\n' + target.encode() + b'\r\n'
            data += b'--' + boundary.encode() + b'--\r\n'
            return request(f'/api/projects/{project}/sources/files', data, 'multipart/form-data; boundary=' + boundary)['items'][0]['paper_id']

        try:
            project = request('/api/state')['projects'][0]['id']
            pdf = pymupdf.open()
            first = pdf.new_page()
            first.insert_text((50, 70), '1 Continuous reading', fontsize=17)
            first.insert_text((50, 730), 'We preserve a cross-page sentence that continues', fontsize=11)
            second = pdf.new_page()
            second.insert_text((50, 60), 'across its original page boundary without changing evidence.', fontsize=11)
            second.insert_text((50, 110), 'Repeated original sentence.', fontsize=11)
            second.insert_text((50, 155), 'Repeated original sentence.', fontsize=11)
            raw = pdf.tobytes()
            paper_id = upload(project, raw)
            route = f'/api/projects/{project}/papers/{paper_id}'
            paper = request(route)
            version = paper['version_id']
            document_route = route + '/reader/document?version_id=' + version
            document = request(document_route)
            assert document == paper['reader_document']
            paragraphs = document['paragraphs']
            merged = next(p for p in paragraphs if p['text'] == 'We preserve a cross-page sentence that continues across its original page boundary without changing evidence.')
            assert [f['page'] for f in merged['fragments']] == [1, 2], merged
            repeated = [p for p in paragraphs if p['text'] == 'Repeated original sentence.']
            assert len(repeated) == 2 and repeated[0]['id'] != repeated[1]['id'], repeated
            assert repeated[0]['fragments'][0]['start'] != repeated[1]['fragments'][0]['start']
            for paragraph in paragraphs:
                for fragment in paragraph['fragments']:
                    if fragment['start'] is not None:
                        page = next(p for p in paper['pages'] if p['page'] == fragment['page'])
                        assert page['text'][fragment['start']:fragment['end']] == fragment['text'], fragment
            assert request(document_route) == document, 'repeated reads change stable source identities'
            assert request(route)['pages'] == paper['pages'], 'reading changes original pages'
            other = request('/api/projects', {'name': 'Other document scope'})['project_id']
            request(f'/api/projects/{other}/papers/{paper_id}/reader/document?version_id={version}', fail=True)
            request(route + '/reader/document', fail=True)
            request(route + '/reader/document?version_id=missing', fail=True)
            second.insert_text((50, 220), 'New source version.', fontsize=11)
            upload(project, pdf.tobytes(), paper_id)
            latest = request(route)
            assert latest['version_id'] != version
            assert request(document_route) == document, 'replacement rewrites old document anchors'
            assert {p['id'] for p in latest['reader_document']['paragraphs']}.isdisjoint(p['id'] for p in paragraphs), 'anchors cross document versions'
            assert request(route + '?version_id=' + version)['pages'] == paper['pages']
            pdf.close()
            historical_id = request(f'/api/projects/{project}/sources/text', {
                'title': 'Historical unlocated layout', 'text': 'Available original.'})['paper_id']
            historical_route = f'/api/projects/{project}/papers/{historical_id}'
            historical = request(historical_route)
            pages = historical['pages']
            # Fixture setup represents a legacy parser anomaly; all assertions use public HTTP.
            pages[0]['layout'] = [{'kind': 'paragraph', 'text': 'Unlocated duplicate.'} for _ in range(2)]
            service.store.run('UPDATE paper_versions SET pages=? WHERE id=?',
                              (json.dumps(pages), historical['version_id']))
            historical_document_route = historical_route + '/reader/document?version_id=' + historical['version_id']
            historical_document = request(historical_document_route)
            unlocated = [p for p in historical_document['paragraphs'] if p['text'] == 'Unlocated duplicate.']
            assert len(unlocated) == 2 and unlocated[0]['id'] != unlocated[1]['id'], unlocated
            assert [p['fragments'][0]['source_path'] for p in unlocated] == ['/pages/0/layout/0', '/pages/0/layout/1']
            for paragraph in unlocated:
                fragment = paragraph['fragments'][0]
                assert fragment['start'] is None and fragment['end'] is None and fragment['rects'] == [], fragment
            assert request(historical_document_route) == historical_document
            assert request(historical_route)['pages'] == pages, 'reading rewrites legacy source layout'
            geometry_id = request(f'/api/projects/{project}/sources/text', {
                'title': 'Historical column and heading layout', 'text': 'Geometry fixture.'})['paper_id']
            geometry_route = f'/api/projects/{project}/papers/{geometry_id}'
            geometry = request(geometry_route)

            def source_page(number, layout):
                text, blocks = '', []
                for index, block in enumerate(layout):
                    value = block.get('text', '')
                    if not value:
                        continue
                    start = len(text)
                    text += value + '\n'
                    blocks.append({'block': index, 'text': value, 'start': start, 'end': start + len(value), 'rect': block['rect']})
                return {'page': number, 'width': 612, 'height': 792, 'text': text, 'blocks': blocks, 'layout': layout}

            geometry_pages = [
                source_page(1, [{'kind': 'list_item', 'text': '• Stable training retains distributional', 'rect': [312, 690, 563, 725]}]),
                source_page(2, [{'kind': 'heading', 'level': 3, 'text': 'expressivity.', 'rect': [69, 59, 175, 69]},
                                {'kind': 'paragraph', 'text': 'A new complete paragraph.', 'rect': [49, 80, 300, 110]}]),
                source_page(3, [
                    {'kind': 'image', 'rect': [48, 0, 564, 40]},
                    {'kind': 'paragraph', 'text': 'Fig. 1: Left caption.', 'rect': [49, 45, 300, 65]},
                    {'kind': 'paragraph', 'text': 'Fig. 2: Right caption.', 'rect': [312, 55, 563, 75]},
                    {'kind': 'paragraph', 'text': 'captured original behaviors.', 'rect': [312, 90, 563, 130]},
                    {'kind': 'paragraph', 'text': 'Left original paragraph.', 'rect': [49, 100, 300, 140]},
                    {'kind': 'heading', 'level': 3, 'text': 'I. Next section', 'rect': [312, 175, 444, 184]},
                    {'kind': 'heading', 'level': 3, 'text': 'H. Prior section', 'rect': [49, 150, 200, 159]},
                    {'kind': 'paragraph', 'text': 'Result Analysis. The richness of', 'rect': [49, 170, 300, 190]},
                    {'kind': 'paragraph', 'text': 'Right section body.', 'rect': [312, 200, 563, 240]}])]
            service.store.run('UPDATE paper_versions SET pages=?,page_count=? WHERE id=?',
                              (json.dumps(geometry_pages), len(geometry_pages), geometry['version_id']))
            geometry_document_route = geometry_route + '/reader/document?version_id=' + geometry['version_id']
            geometry_document = request(geometry_document_route)
            items = geometry_document['paragraphs']
            assert items[0]['kind'] == 'list_item' and items[0]['text'] == '• Stable training retains distributional expressivity.', items[0]
            assert [f['page'] for f in items[0]['fragments']] == [1, 2]
            last_page = [p for p in items if any(f['page'] == 3 for f in p['fragments'])]
            assert [p['text'] for p in last_page] == ['', 'Fig. 1: Left caption.', 'Fig. 2: Right caption.',
                'Left original paragraph.', 'H. Prior section', 'Result Analysis. The richness of captured original behaviors.',
                'I. Next section', 'Right section body.'], last_page
            assert last_page[4]['fragments'][0]['source_path'] == '/pages/2/layout/6', 'geometry order becomes identity'
            for paragraph in items:
                for fragment in paragraph['fragments']:
                    if fragment['start'] is not None:
                        source = geometry_pages[fragment['page']-1]['text']
                        assert source[fragment['start']:fragment['end']] == fragment['text']
            assert request(geometry_document_route) == geometry_document
            assert request(geometry_route)['pages'] == geometry_pages, 'presentation rewrites original geometry/order'
            print('PASS: public HTTP continuous source, cross-page/list fragments, repeated text, unlocated historical duplicates, two-column geometry, exact offsets, immutable versions and scope')
            native_pdf = pymupdf.open()
            native_page = native_pdf.new_page()
            for x, y, value in ((50, 70, 'Native legacy coverage'), (50, 100, 'Before original.'),
                (100, 160, 'x = y + 1'), (260, 160, '(2)'),
                (50, 190, 'The training loss is modified from Eq 3 to:'), (50, 230, 'After original.'),
                (80, 300, 'Figure-native label'), (80, 380, 'Table-native cell'), (100, 450, 'z = b + 1')):
                native_page.insert_text((x, y), value, fontsize=11)
            native_raw = native_pdf.tobytes()
            native_id = upload(project, native_raw)
            native_route = f'/api/projects/{project}/papers/{native_id}'
            native_paper = request(native_route)
            source_file = Path(service.store.paper(project, native_id)['source_path'])
            assert source_file.resolve().is_relative_to(root.resolve())
            legacy_text, legacy_blocks, legacy_layout = '', [], []
            for value in ('Native legacy coverage', 'Before original.', 'After original.'):
                rect = list(native_page.search_for(value)[0])
                start = len(legacy_text)
                legacy_text += value + '\n'
                legacy_blocks.append({'text': value, 'start': start, 'end': start + len(value), 'rect': rect})
                legacy_layout.append({'kind': 'paragraph', 'text': value, 'rect': rect})
            legacy_layout += [{'kind': 'image', 'rect': [40, 270, 290, 330]},
                {'kind': 'image', 'rect': [40, 350, 290, 410], 'warning': 'Existing table original image.'},
                {'kind': 'formula', 'rect': [90, 420, 280, 460]}]
            legacy_pages = [{'page': 1, 'width': 612, 'height': 792, 'text': legacy_text,
                'blocks': legacy_blocks, 'layout': legacy_layout, 'conversion': {'reliable': True}}]
            # A legacy version can have incomplete stored text before its original PDF is restored.
            service.store.run('UPDATE paper_versions SET pages=?,source_path=NULL WHERE id=?',
                (json.dumps(legacy_pages), native_paper['version_id']))
            native_document_route = native_route + '/reader/document?version_id=' + native_paper['version_id']
            old_document = request(native_document_route)
            service.store.run('UPDATE paper_versions SET source_path=? WHERE id=?',
                (str(source_file), native_paper['version_id']))
            recovered = request(native_document_route)
            gaps = [p for p in recovered['paragraphs'] if p.get('warning') and p['warning'] != 'Existing table original image.']
            assert len(gaps) == 2, 'native formula and prose gaps must be preserved as original regions, not silently omitted'
            old_ids = [p['id'] for p in old_document['paragraphs']]
            assert [p for p in recovered['paragraphs'] if p['id'] in old_ids] == old_document['paragraphs'], 'recovery rewrites existing IDs or source fragments'
            assert [p['text'] for p in recovered['paragraphs'][:2]] == ['Native legacy coverage', 'Before original.']
            assert recovered['paragraphs'][2:4] == gaps, 'native regions are not inserted at their source reading position'
            assert recovered['paragraphs'][4]['text'] == 'After original.'
            assert request(native_route)['reader_document'] == recovered
            assert request(native_route)['pages'] == legacy_pages
            for gap in gaps:
                fragment = gap['fragments'][0]
                assert gap['kind'] == 'image' and gap['text'] == ''
                assert '图像内文字未翻译' in gap['warning']
                assert fragment['start'] is None and fragment['end'] is None
                assert fragment['source_path'].startswith('/pdf/pages/0/')
                rect = fragment['rects'][0]
                query = '&'.join(f'{key}={value}' for key, value in zip(('x0', 'y0', 'x1', 'y1'), rect))
                with urllib.request.urlopen(base + native_route + '/fragment?version_id=' + native_paper['version_id'] + '&page=1&' + query) as response:
                    assert response.headers['Content-Type'] == 'image/png'
                    image = response.read()
                expected = native_page.get_pixmap(matrix=pymupdf.Matrix(1.8, 1.8), clip=pymupdf.Rect(rect), alpha=False).tobytes('png')
                assert image == expected, 'fallback image is not the verified original PDF region'
            assert hashlib.sha256(source_file.read_bytes()).hexdigest() == native_paper['sha256']
            assert request(native_document_route) == recovered
            request(f'/api/projects/{other}/papers/{native_id}/reader/document?version_id=' + native_paper['version_id'], fail=True)
            source_file.write_bytes(raw)
            request(native_document_route, fail=True)
            request(native_route, fail=True)
            source_file.write_bytes(native_raw)
            native_pdf.close()
            print('PASS: verified original native gaps, cropped PNG bytes, warning/untranslated status, existing IDs/pages/order, covered figure/table/formula exclusion and project/file SHA boundaries')
        finally:
            server.shutdown()
            server.server_close()
            service.close()


if __name__ == '__main__':
    main()
