"""Continuous presentation derived from an immutable material version."""
import hashlib
import json
import re
from pathlib import Path

from .state import json_text
from .pdf import TABLE_WARNING


def _same_rect(left, right):
    return bool(left and right and len(left) == len(right) == 4 and
                all(abs(a - b) < .1 for a, b in zip(left, right)))


def _fragment(page, block, cursor, source_path):
    source = block.get('text') or '\n'.join('\t'.join(map(str, row)) for row in block.get('rows', []))
    rect = block.get('rect')
    matches = [item for item in page.get('blocks', []) if _same_rect(item.get('rect'), rect)]
    start = end = None
    if len(matches) == 1:
        original = matches[0]
        if not source and block.get('kind') == 'formula':
            source = original['text']
        at = original['text'].find(source) if source else -1
        if at >= 0 and original['text'].find(source, at + 1) < 0:
            start = original['start'] + at
            end = start + len(source)
    if start is None and source:
        at = page['text'].find(source, cursor if not rect else 0)
        if at >= 0 and (not rect or page['text'].find(source, at + 1) < 0):
            start, end = at, at + len(source)
    if start is not None and page['text'][start:end] != source:
        start = end = None
    # Display-only unwrapping; exact source offsets always address `text`, never this copy.
    display = source if block.get('kind') == 'formula' else re.sub(r'(?<=\w)-\r?\n(?=\w)', '', source)
    display = re.sub(r'\s*\r?\n\s*', ' ', display).strip()
    return {'page': page['page'], 'text': source, 'start': start, 'end': end,
            'rects': [rect] if rect else [], 'source_path': source_path,
            'display_text': display, 'separator': ''}, end or cursor


def _continues(previous, following):
    if previous['kind'] not in ('paragraph', 'list_item'):
        return False
    left, right = previous['fragments'][-1], following['fragments'][0]
    boundary = left['page'] != right['page']
    # A lower-case first line can be a body continuation misclassified as a heading by the parser.
    heading_continuation = boundary and following['kind'] == 'heading' and re.match(r'[a-z]', following['text'])
    # Formula labels can contain English body; the physical boundary and unfinished-sentence checks still apply.
    value = following['text']
    formula_continuation = (following['kind'] == 'formula' and len(re.findall(r'\b[A-Za-z]{3,}\b', value)) >= 4 and
        re.search(r'\b(?:the|this|that|which|with|from|into|are|was|were|is)\b', value, re.I) and
        re.search(r'\b[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}\b', value))
    if following['kind'] != 'paragraph' and not heading_continuation and not formula_continuation:
        return False
    if not boundary and left['rects'] and right['rects']:
        a, b = left['rects'][0], right['rects'][0]
        boundary = b[0] > a[0] + 80 and b[1] < a[3]
    # merge only obvious unfinished page/column continuations; uncertain boundaries stay separate.
    continuation = re.match(r'[a-z(]', following['text']) or (
        re.search(r'\b(?:Fig(?:ure)?\.?|Table|Eq(?:uation)?\.?)$', previous['text']) and
        re.match(r'\d', following['text']))
    return boundary and bool(re.search(r'[A-Za-z,;:\-]$', previous['text'])) and bool(continuation)


def _reading_order(items, width):
    if not width:
        return items
    middle = width / 2

    def column(item):
        rects = item['fragments'][0]['rects']
        if not rects:
            return -1
        rect = rects[0]
        return 0 if rect[2] <= middle + 1 else 1 if rect[0] >= middle - 1 else -1

    body_columns = {column(item) for item in items if item['text'] and item['fragments'][0]['rects']
                    and item['fragments'][0]['rects'][0][2] - item['fragments'][0]['rects'][0][0] >= width * .25}
    if not {0, 1}.issubset(body_columns):
        return items
    ordered, pending, spanning_media = [], [], None
    caption_label = re.compile(r'^(?:Fig(?:ure)?\.?\s*\d+[a-z]?|Table\s+(?:[IVX]+|\d+))\s*[:.]', re.I)
    media = [item for item in items if column(item) == -1 and item['fragments'][0]['rects']
             and item['kind'] in ('image', 'table', 'page_image')]
    leading_captions, deferred = {}, set()
    for item in items:
        rects = item['fragments'][0]['rects']
        if not rects or column(item) == -1 or not caption_label.match(item['text']):
            continue
        rect = rects[0]
        following = [image for image in media if
                     0 <= image['fragments'][0]['rects'][0][1] - rect[3] <= 80
                     and min(rect[2], image['fragments'][0]['rects'][0][2]) >
                         max(rect[0], image['fragments'][0]['rects'][0][0])]
        if following:
            image = min(following, key=lambda candidate: candidate['fragments'][0]['rects'][0][1] - rect[3])
            gap = image['fragments'][0]['rects'][0][1] - rect[3]
            if any(0 <= rect[1] - previous['fragments'][0]['rects'][0][3] <= gap
                   and min(rect[2], previous['fragments'][0]['rects'][0][2]) >
                       max(rect[0], previous['fragments'][0]['rects'][0][0]) for previous in media):
                continue
            leading_captions.setdefault(id(image), []).append(item)
            deferred.add(id(item))

    def flush():
        ordered.extend(sorted(pending, key=lambda item: (column(item), item['fragments'][0]['rects'][0][1], item['fragments'][0]['rects'][0][0])))
        pending.clear()

    for item in items:
        if id(item) in deferred:
            continue
        rects = item['fragments'][0]['rects']
        if column(item) == -1:
            flush()
            # A narrow caption above a spanning figure belongs after both columns,
            # even when the layout engine reports it before the right-column text.
            ordered.extend(sorted(leading_captions.get(id(item), []),
                                  key=lambda caption: (caption['fragments'][0]['rects'][0][1],
                                                       caption['fragments'][0]['rects'][0][0])))
            ordered.append(item)
            spanning_media = item if rects and item['kind'] in ('image', 'table', 'page_image') else None
        elif spanning_media and caption_label.match(item['text']) and abs(rects[0][1] - spanning_media['fragments'][0]['rects'][0][3]) <= 80:
            # Keep captions with their spanning original image/table, ahead of the column prose.
            ordered.append(item)
        else:
            pending.append(item)
    flush()
    return ordered


def _native_gaps(paper, pages):
    """Recover verified original pixels, without inventing stored text or offsets."""
    if not paper.get('source_path') or not Path(paper['source_path']).is_file():
        return []
    raw = Path(paper['source_path']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != paper['sha256']:
        raise ValueError('原 PDF 缺失或内容校验失败')
    import pymupdf
    from .pdf import _page_rect
    result = []
    with pymupdf.open(stream=raw, filetype='pdf') as pdf:
        for stored in pages:
            page = pdf[stored['page'] - 1]
            existing = stored.get('layout', []) + stored.get('blocks', [])
            boxes = [item['rect'] for item in existing if item.get('rect')]
            unlocated = re.sub(r'\s+', '', '\n'.join(item.get('text', '') for item in existing if not item.get('rect')))
            missing = []
            for block in page.get_text('dict', flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)['blocks']:
                for line in block.get('lines', []):
                    value = ''.join(span['text'] for span in line.get('spans', [])).strip()
                    if not value:
                        continue
                    rect = _page_rect(page, line['bbox'])
                    x, y = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
                    if (any(a - 1 <= x <= c + 1 and b - 1 <= y <= d + 1 for a, b, c, d in boxes) or
                        re.sub(r'\s+', '', value) in unlocated):
                        continue
                    missing.append(rect)
            middle = page.rect.width / 2
            column = lambda rect: 0 if rect[2] <= middle + 1 else 1 if rect[0] >= middle - 1 else -1
            regions = []
            for rect in sorted(missing, key=lambda r: (column(r), r[1], r[0])):
                if regions and column(rect) == column(regions[-1]) and rect[1] <= regions[-1][3] + 4:
                    old = regions[-1]
                    regions[-1] = [min(old[0], rect[0]), min(old[1], rect[1]), max(old[2], rect[2]), max(old[3], rect[3])]
                else:
                    regions.append(rect)
            for index, rect in enumerate(regions):
                rect = [max(0, rect[0] - 2), max(0, rect[1] - 2),
                    min(page.rect.width, rect[2] + 2), min(page.rect.height, rect[3] + 2)]
                result.append({'kind': 'image', 'text': '',
                    'warning': '该区域文字未能完整转换，已保留原论文图像；图像内文字未翻译，请结合原图阅读。',
                    'fragments': [{'page': stored['page'], 'text': '', 'start': None, 'end': None,
                        'rects': [rect], 'source_path': f'/pdf/pages/{stored["page"] - 1}/native-regions/{index}',
                        'display_text': '', 'separator': ''}]})
    return result


def reader_document(paper, project):
    pages = json.loads(paper['pages'])
    paragraphs = []
    for page_index, page in enumerate(pages):
        source_field = 'layout' if page.get('layout') else 'blocks'
        layout = page.get('layout') or [{'kind': 'paragraph', **block} for block in page.get('blocks', [])]
        if not layout and page.get('text'):
            layout = [{'kind': 'paragraph', 'text': page['text']}]
            source_field = 'text'
        cursor, page_items = 0, []
        for source_index, block in enumerate(layout):
            source_path = f'/pages/{page_index}/{source_field}'
            if source_field != 'text':
                source_path += f'/{source_index}'
            fragment, cursor = _fragment(page, block, cursor, source_path)
            item = {key: block[key] for key in ('level', 'rows', 'warning') if key in block}
            item.update(kind=block.get('kind', 'paragraph'), text=fragment['display_text'], fragments=[fragment])
            page_items.append(item)
        covered = set()
        for item in page_items:
            fragment = item['fragments'][0]
            if fragment['start'] is not None:
                covered.update(range(fragment['start'], fragment['end']))
        for block_index, block in enumerate(page.get('blocks', [])):
            if block['text'] == TABLE_WARNING:
                continue
            missing = [at for at in range(block['start'], block['end']) if at not in covered]
            groups = []
            for at in missing:
                if groups and groups[-1][1] == at:
                    groups[-1][1] += 1
                else:
                    groups.append([at, at + 1])
            for start, end in groups:
                source = page['text'][start:end]
                if not source.strip():
                    continue
                fragment = {'page': page['page'], 'text': source, 'start': start, 'end': end,
                            'rects': [block['rect']] if block.get('rect') else [],
                            'source_path': f'/pages/{page_index}/blocks/{block_index}',
                            'display_text': re.sub(r'\s*\r?\n\s*', ' ', source).strip(), 'separator': ''}
                item = {'kind': 'paragraph', 'text': fragment['display_text'], 'fragments': [fragment],
                        'warning': '版面转换未覆盖这段文字，已保留原页文字供核对。'}
                before = next((i for i, existing in enumerate(page_items)
                               if existing['fragments'][0]['start'] is not None and existing['fragments'][0]['start'] >= end), len(page_items))
                page_items.insert(before, item)
        for item in _reading_order(page_items, page.get('width')):
            fragment = item['fragments'][0]
            if paragraphs and _continues(paragraphs[-1], item):
                previous = paragraphs[-1]
                tail = previous['fragments'][-1]
                hyphen = bool(re.search(r'[A-Za-z]-$', tail['display_text']) and re.match(r'[a-z]', fragment['display_text']))
                if hyphen:
                    tail['display_text'] = tail['display_text'][:-1]
                fragment['separator'] = '' if hyphen else ' '
                previous['fragments'].append(fragment)
                previous['text'] = ''.join(f['separator'] + f['display_text'] for f in previous['fragments'])
            else:
                paragraphs.append(item)
    recovered = _native_gaps(paper, pages)
    for item in paragraphs + recovered:
        original = []
        for fragment in item['fragments']:
            origin = {key: fragment[key] for key in ('page', 'text', 'start', 'end', 'rects')}
            if fragment['start'] is None and not fragment['rects']:
                # The address belongs to immutable source JSON, never the rendered paragraph list.
                origin['source_path'] = fragment['source_path']
            original.append(origin)
        identity = json_text([paper['version_id'], item['kind'], original])
        item['id'] = 'paragraph_' + hashlib.sha256(identity.encode()).hexdigest()
    # Insert after existing grouping/identity; a new image cannot split an old paragraph.
    for page in pages:
        additions = [p for p in recovered if p['fragments'][0]['page'] == page['page']]
        if not additions:
            continue
        originals = [p for p in paragraphs if p['fragments'][0]['page'] == page['page']]
        def position(item):
            rects = item['fragments'][0]['rects']
            return (rects[0][1], rects[0][0]) if rects else (float('inf'), float('inf'))
        ordered = _reading_order(sorted(originals + additions, key=position), page.get('width'))
        for index, item in enumerate(ordered):
            if item not in additions:
                continue
            following = next((p for p in ordered[index + 1:] if p in originals), None)
            at = paragraphs.index(following) if following else next((i for i, p in enumerate(paragraphs)
                if p['fragments'][0]['page'] > page['page']), len(paragraphs))
            paragraphs.insert(at, item)
    return {'schema_version': 1, 'project_id': project, 'paper_id': paper['id'],
            'version_id': paper['version_id'], 'source_sha256': paper['sha256'], 'paragraphs': paragraphs}
