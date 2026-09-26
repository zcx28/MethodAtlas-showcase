"""Static exports of saved versions. No model calls or artifact-version writes."""
import base64
import hashlib
import html
import json
import math
import os
import re
import tempfile
import threading
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

import pymupdf

from .state import json_text
from .reporting import call_mimir

# Design limit: serialize local exports; use a worker process if export throughput matters.
LOCK = threading.Lock()


class StaticHTML(HTMLParser):
    """Read existing sanitized HTML, retaining semantic structure rather than CSS layout."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = ET.Element('article')
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = ET.SubElement(self.stack[-1], tag, {k: v or '' for k, v in attrs})
        if tag not in ('br', 'hr', 'meta', 'link', 'img', 'input'):
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        node = self.stack[-1]
        if len(node):
            node[-1].tail = (node[-1].tail or '') + data
        else:
            node.text = (node.text or '') + data

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)


def inline(text):
    text = html.escape(text)
    text = re.sub(r'`([^`\n]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*\n]+)\*\*', r'<strong>\1</strong>', text)
    return text


def markdown_html(body):
    """The headings, tables, lists and paragraphs accepted by the existing DOCX writer."""
    lines, parts, index = body.splitlines(), [], 0
    while index < len(lines):
        line = lines[index].strip()
        if line.startswith('```'):
            code = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith('```'):
                code.append(lines[index])
                index += 1
            parts.append('<pre>' + html.escape('\n'.join(code)) + '</pre>')
        elif line.startswith('|') and index + 1 < len(lines) and re.fullmatch(r'\|[\s:|\-]+\|', lines[index + 1].strip()):
            rows = []
            while index < len(lines) and lines[index].strip().startswith('|'):
                row = lines[index].strip()
                if not re.fullmatch(r'\|[\s:|\-]+\|', row):
                    tag = 'th' if not rows else 'td'
                    rows.append('<tr>' + ''.join(f'<{tag}>{inline(cell.strip())}</{tag}>' for cell in row.strip('|').split('|')) + '</tr>')
                index += 1
            parts.append('<table>' + ''.join(rows) + '</table>')
            continue
        elif match := re.match(r'^(#{1,6})\s+(.+)', line):
            parts.append(f'<h{len(match[1])}>{inline(match[2])}</h{len(match[1])}>')
        elif re.match(r'^[-*]\s+', line):
            parts.append('<ul><li>' + inline(line[2:]) + '</li></ul>')
        elif line:
            parts.append('<p>' + inline(line) + '</p>')
        index += 1
    return ''.join(parts)


def static_content(node, numbers):
    """Return Markdown and print HTML together so neither silently loses a diagram/table."""
    tag = node.tag
    if tag in ('head', 'style', 'script', 'title', 'meta', 'link') or 'methodatlas-sources' in node.get('class', '').split() or node.get('data-close-detail') is not None:
        return '', ''
    if tag in ('pre', 'code'):
        text = ''.join(node.itertext())
        fence = '`' * max(3 if tag == 'pre' else 1, 1 + max((len(run) for run in re.findall(r'`+', text)), default=0))
        md = f'\n\n{fence}\n{text}\n{fence}\n\n' if tag == 'pre' else f'{fence} {text} {fence}'
        return md, f'<{tag}>{html.escape(text)}</{tag}>'
    if tag == 'svg':
        # SVG is embedded as a self-contained PNG in both formats; it has no interaction.
        for part in node.iter():
            for key, value in list(part.attrib.items()):
                if key in ('viewbox', 'markerwidth', 'markerheight', 'refx', 'refy', 'preserveaspectratio'):
                    part.set({'viewbox':'viewBox', 'markerwidth':'markerWidth', 'markerheight':'markerHeight', 'refx':'refX', 'refy':'refY', 'preserveaspectratio':'preserveAspectRatio'}[key], value)
                    del part.attrib[key]
        node.set('xmlns', 'http://www.w3.org/2000/svg')
        with tempfile.TemporaryDirectory() as directory:
            raw = call_mimir({'kind':'svg', 'svg':ET.tostring(node, encoding='unicode')}, directory, 'png')
        pix = pymupdf.Pixmap(raw)
        width = min(640, 900 * pix.width / pix.height)
        src = 'data:image/png;base64,' + base64.b64encode(raw).decode()
        labels = ' / '.join(''.join(t.itertext()).strip() for t in node.iter('text'))
        refs = []
        for part in node.iter():
            if citation := part.get('data-citation'):
                if citation not in numbers:
                    raise ValueError('地图引用不在该成果版本的引用清单中')
                refs.append(numbers[citation])
        markers = ' '.join(f'[{i}]' for i in dict.fromkeys(refs))
        links = ' '.join(f'<a href="#reference-{i}">[{i}]</a>' for i in dict.fromkeys(refs))
        return f'\n\n![地图（静态）]({src})\n\n图中标签：{html.escape(labels)} {markers}\n\n', f'<p><img width="{width}" src="{src}"></p><p>图中标签：{html.escape(labels)} {links}</p>'
    markdown, markup = html.escape(node.text or ''), html.escape(node.text or '')
    for child in node:
        md, ht = static_content(child, numbers)
        markdown += md + html.escape(child.tail or '')
        markup += ht + html.escape(child.tail or '')
    if citation := node.get('data-citation'):
        if citation not in numbers:
            raise ValueError('正文引用不在该成果版本的引用清单中')
        number = numbers[citation]
        if tag == 'button' and re.fullmatch(r'\s*(?:原文|\[\d+\])?\s*', ''.join(node.itertext())):
            markdown = markup = ''
        markdown += f' [{number}]'
        markup += f' <a class="citation" href="#reference-{number}">[{number}]</a>'
    if tag == 'table':
        rows = [r for r in node.iter('tr')]
        if any(c.get('colspan', '1') != '1' or c.get('rowspan', '1') != '1' for r in rows for c in r):
            # CommonMark permits HTML tables: retain merged cells instead of flattening them.
            return '\n\n<table>' + markup + '</table>\n\n', '<table>' + markup + '</table>'
        cells = [[static_content(c, numbers)[0].strip().replace('|', '&#124;').replace('\n', '<br>') for c in r] for r in rows]
        if not cells or any(len(row) != len(cells[0]) for row in cells):
            raise ValueError('表格列数不一致，无法完整导出')
        cells.insert(1, ['---'] * len(cells[0]))
        markdown = '\n\n' + '\n'.join('| ' + ' | '.join(row) + ' |' for row in cells) + '\n\n'
    elif re.fullmatch('h[1-6]', tag):
        markdown = '\n\n' + '#' * int(tag[1]) + ' ' + markdown.strip() + '\n\n'
    elif tag in ('p', 'div', 'section', 'article', 'header', 'footer', 'details', 'summary', 'blockquote', 'pre', 'ul', 'ol'):
        markdown = '\n\n' + (f'```\n{markdown}\n```' if tag == 'pre' else markdown.strip()) + '\n\n'
    elif tag == 'li':
        markdown = markdown.strip()
    if tag in ('ul', 'ol'):
        items = []
        for i, child in enumerate(node, 1):
            prefix = f'{i}. ' if tag == 'ol' else '- '
            lines = static_content(child, numbers)[0].strip().splitlines()
            items.append(prefix + ('\n' + ' ' * len(prefix)).join(lines))
        markdown = '\n\n' + '\n'.join(items) + '\n\n'
    if tag in ('strong', 'b', 'em', 'i', 'code'):
        mark = {'strong':'**', 'b':'**', 'em':'*', 'i':'*', 'code':'`'}[tag]
        markdown = mark + markdown + mark
    elif tag in ('br', 'hr'):
        return ('  \n', '<br>') if tag == 'br' else ('\n\n---\n\n', '<hr>')
    if tag in ('table', 'tr', 'td', 'th', 'p', 'pre', 'code', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i') or re.fullmatch('h[1-6]', tag):
        attrs = ''.join(f' {key}="{html.escape(node.get(key), quote=True)}"' for key in ('colspan', 'rowspan') if node.get(key))
        markup = f'<{tag}{attrs}>{markup}</{tag}>'
    elif tag in ('div', 'section', 'article', 'header', 'footer', 'details', 'summary'):
        markup = '<div>' + markup + '</div>'
    return markdown, markup


def documents(version):
    numbers = {c['id']: i for i, c in enumerate(version['citations'], 1)}
    if version['kind'] == 'graph':
        graph = json.loads(version['body'])
        nodes = {n['paper_id']:n for n in graph['nodes']}
        labels = {pid:i+1 for i,pid in enumerate(nodes)}
        parts = ['<p>' + html.escape(graph['focus']) + '</p>']
        def evidence(ids):
            return ' '.join('<button data-citation="' + html.escape(cid, quote=True) + '"></button>' for cid in ids)
        if graph['edges']:
            # Numbered nodes keep arbitrary paper titles readable in the legend below.
            positions = {pid:(240+190*math.cos(2*math.pi*i/len(nodes)),150+105*math.sin(2*math.pi*i/len(nodes))) for i,pid in enumerate(nodes)}
            diagram = ['<svg viewBox="0 0 480 300"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#246bdb"></path></marker></defs>']
            for edge in graph['edges']:
                x1,y1=positions[edge['source']];x2,y2=positions[edge['target']]
                dx,dy=x2-x1,y2-y1;length=math.hypot(dx,dy)
                diagram.append(f'<line x1="{x1+dx*17/length}" y1="{y1+dy*17/length}" x2="{x2-dx*19/length}" y2="{y2-dy*19/length}" stroke="#246bdb" stroke-width="1.5" marker-end="url(#arrow)"></line>')
            for pid,(x,y) in positions.items():
                diagram.append(f'<circle cx="{x}" cy="{y}" r="16" fill="#edf3ff" stroke="#246bdb"></circle><text x="{x}" y="{y+5}" text-anchor="middle" font-size="14" fill="#182230">{labels[pid]}</text>')
            parts.append(''.join(diagram)+'</svg>')
            for edge in graph['edges']:
                parts.append(f'<h2>{labels[edge["source"]]} → {labels[edge["target"]]} · {html.escape(edge["relationship"])}</h2><p>{html.escape(edge["explanation"])} {evidence(edge["citation_ids"])}</p>')
        for pid,node in nodes.items():
            parts.append(f'<h2>{labels[pid]}. {html.escape(node["title"])}</h2>')
            parts.extend(f'<p><strong>{label}：</strong>{html.escape(node[key])}{" " + evidence(node["citation_ids"]) if key == "approach" else ""}</p>' for key,label in [('problem','研究问题'),('approach','核心方法'),('limitations','适用边界')])
        return documents({**version,'kind':'html','body':''.join(parts),'payload':{}})
    if version['kind'] == 'html':
        parser = StaticHTML()
        parser.feed(version['body'])
        # Print each fact once: interactive overviews and the repeated comparison are navigation.
        structured = bool(version.get('payload', {}).get('research'))
        has_details = any('research-detail' in n.get('class', '').split() for n in parser.root.iter())
        if structured:
            nodes = version['payload']['research'].get('nodes', [])
            for detail in parser.root.iter():
                if 'research-detail' not in detail.get('class', '').split():
                    continue
                index = int(detail.get('data-detail', '0'))
                period = nodes[index].get('period') if 0 <= index < len(nodes) else None
                if period and not any('reading-period' in n.get('class', '').split() for n in detail):
                    paragraph = ET.Element('p', {'class':'reading-period'})
                    paragraph.text = period
                    detail.insert(1, paragraph)
        for parent in list(parser.root.iter()):
            for child in list(parent):
                classes = child.get('class', '').split()
                if structured and has_details and any(c in classes for c in ('research-map','research-timeline','reading-comparison','research-table')):
                    parent.remove(child)
        for detail in parser.root.iter():
            if 'research-detail' not in detail.get('class', '').split():
                continue
            children = list(detail)
            for heading, paragraph in zip(children, children[1:]):
                if heading.tag == 'h3' and paragraph.tag == 'p':
                    label = ET.Element('strong')
                    label.text = ''.join(heading.itertext()) + '：'
                    label.tail, paragraph.text = paragraph.text, None
                    paragraph.insert(0, label)
                    detail.remove(heading)
        for parent in parser.root.iter():
            for child in list(parent):
                if set(child.get('class', '').split()) & {'report-eyebrow','report-meta'}:
                    parent.remove(child)
        first_title = next(parser.root.iter('h1'), None)
        if first_title is not None and (structured or ''.join(first_title.itertext()).strip() == version['title'].strip()):
            for parent in parser.root.iter():
                if first_title in list(parent): parent.remove(first_title); break
        styles = '\n'.join(node.text or '' for node in parser.root.iter('style'))
        for svg in parser.root.iter('svg'):
            style = ET.Element('style')
            style.text = styles
            svg.insert(0, style)
        markdown, markup = static_content(parser.root, numbers)
    else:
        markdown = version['body']
        for cid, number in numbers.items():
            markdown = markdown.replace('[cite:' + cid + ']', f'[{number}]')
        if '[cite:' in markdown:
            raise ValueError('正文含有无法匹配的引用')
        print_body = version['body']
        if version['kind'] == 'docx':
            ids = {str(number):cid for cid,number in numbers.items()}
            print_body = re.sub(r'\[(\d+)\]',lambda m:'[cite:'+ids[m[1]]+']' if m[1] in ids else m[0],print_body)
        print_lines = print_body.splitlines()
        if print_lines and re.sub(r'^#\s+', '',print_lines[0]).strip() == version['title'].strip():
            print_lines = print_lines[1:]
        markup = markdown_html('\n'.join(print_lines))
        markup = re.sub(r'\[cite:([^\]]+)\]',lambda m:f'<a class="citation" href="#reference-{numbers[m[1]]}">[{numbers[m[1]]}]</a>',markup)
    title = version['title']
    identity = f'成果版本：v{version["version_no"]} · {version["id"]}'
    appendix = '\n\n## 实际材料与版本\n\n'
    appendix += '\n'.join(f'- {m["title"]} · {m["paper_id"]} · {m["paper_version_id"]}' for m in version['materials']) or '该版本未记录材料。'
    references = []
    reference_groups = {}
    for i, c in enumerate(version['citations'], 1):
        location = f'第 {c.get("page", "未知")} 页'
        text = f'[{i}] {c["title"]} · {location} · {c["paper_version_id"]}'
        quote = c.get('quote', '')
        appendix += f'\n\n### [{i}] {c["title"]}\n\n{location} · {c["paper_version_id"]} · {c["id"]}\n\n' + quote
        reference_groups.setdefault((c['paper_version_id'],c['title']), []).append(f'<span id="reference-{i}" class="reference-location">[{i}] {location}</span>')
    md = f'# {title}\n\n{identity}\n\n' + markdown.strip() + appendix + '\n'
    for (source_version, source_title), entries in reference_groups.items():
        references.append(f'<table class="reference-group"><tr><td><strong>{html.escape(source_title)}</strong><br>{" · ".join(entries)}</td></tr></table>')
    cited_versions = {key[0] for key in reference_groups}
    materials = ''.join(f'<li>{html.escape(m["title"])} · {html.escape(m["paper_version_id"][-8:])}</li>' for m in version['materials'] if m['paper_version_id'] not in cited_versions)
    ht = f'<h1>{html.escape(title)}</h1><p class="report-meta">MethodAtlas · v{version["version_no"]} · {len(version["materials"])} 篇材料</p>' + markup
    ht += '<section class="references"><h2>参考材料与页码</h2>' + ''.join(references) + ('<ul>'+materials+'</ul>' if materials else '') + '</section>'
    return md, ht


def render_pdf(markup):
    css = '''body {font-family: sans-serif; font-size: 10.5pt; line-height: 1.45; color: #182230}
    h1 {font-size: 20pt; line-height: 1.3; margin-bottom: 10pt; page-break-after: avoid}
    h2 {font-size: 14pt; margin-top: 14pt; margin-bottom: 7pt; page-break-after: avoid}
    h3 {font-size: 11pt; margin-top: 12pt; margin-bottom: 5pt; page-break-after: avoid}
    .citation {font-size: 8pt; font-weight: normal; text-decoration: none}
    p {margin-top: 5pt; margin-bottom: 7pt} a {color: #246bdb}
    table {border-collapse: collapse; width: 100%; font-size: 9pt; line-height: 1.45}
    td, th {border-bottom: 0.5pt solid #e4e7ec; padding: 5pt; vertical-align: top; text-align: left}
    th {font-weight: bold} pre {white-space: pre-wrap; font-size: 9pt}
    blockquote {margin: 6pt 0 12pt 12pt; color: #475467; font-size: 9pt}
    .report-meta {font-size: 9pt; color: #667085; margin-bottom: 14pt}
    .references {font-size: 8pt; margin-top: 14pt; page-break-inside: avoid}
    .references table {font-size: 8pt; line-height: 1.3; margin-bottom: 4pt}
    .references td {border: 0; padding: 0}
    .references h3 {font-size: 9pt; margin-top: 10pt; margin-bottom: 4pt} .reference-location {font-size: 8pt; color: #246bdb; margin-bottom: 3pt}'''
    story = pymupdf.Story(html=markup, user_css=css)
    box = pymupdf.paper_rect('a4')
    def rect(page, filled):
        if page >= 500:
            raise ValueError('排版超过 500 页或存在无法分页的内容，请缩短过高的表格单元格或图形')
        return box, box + (42, 42, -42, -42), None
    with story.write_with_links(rect) as pdf:
        if not len(pdf):
            raise ValueError('PDF 排版没有产生页面')
        for i, page in enumerate(pdf, 1):
            if any(block[0] < 40 or block[2] > box.width - 40 for block in page.get_text('blocks')):
                raise ValueError(f'第 {i} 页内容超出可打印宽度，请减少表格列数或拆分过长单词')
            page.insert_text((box.width / 2 - 12, box.height - 22), f'{i} / {len(pdf)}', fontsize=8)
        return pdf.tobytes(garbage=3, deflate=True)


def export_figure(store, project, citation_id):
    from .pdf import extract_pdf_region
    with LOCK:
        citation = store.citation(project, citation_id)
        if not citation or citation.get('kind') != 'figure':
            raise ValueError('请选择已有的图表解读')
        paper = store.paper(project, citation['paper_id'], citation['paper_version_id'])
        from pathlib import Path
        image, _ = extract_pdf_region(Path(paper['source_path']).read_bytes(), paper['sha256'], citation['page'], citation.get('image', {}).get('rect') or citation['rect'])
        source = 'data:image/png;base64,' + base64.b64encode(image).decode()
        parts = ['<h1>图表解读</h1><p class="report-meta">' + html.escape(citation['title']) + f' · 第 {citation["page"]} 页</p><p><img width="480" src="{source}"></p>']
        for basis,label in [('image','图中可见'),('context','正文说明')]:
            items = [o for o in citation.get('observations', []) if o['basis'] == basis]
            if items:
                parts.append('<h2>'+label+'</h2><ul>'+''.join('<li>'+html.escape(o['text'])+'</li>' for o in items)+'</ul>')
        if not citation.get('observations'):
            raise ValueError('未取得可靠图表观察，不能导出空白解读')
        return render_pdf(''.join(parts))


def export_version(store, project, version, format):
    if format not in ('markdown', 'pdf'):
        raise ValueError('导出格式仅支持 markdown 或 pdf')
    if version['kind'] not in ('html', 'docx', 'research', 'graph'):
        raise ValueError('此类成果请使用原格式下载')
    for material in version['materials']:
        if not store.paper(project, material['paper_id'], material['paper_version_id']):
            raise ValueError('成果材料版本不属于当前项目')
    for citation in version['citations']:
        actual = store.citation(project, citation['id'])
        if any(actual.get(k) != citation.get(k) for k in ('paper_id', 'paper_version_id', 'page', 'quote', 'rect')):
            raise ValueError('成果引用与保存的原文版本不一致')
    key = hashlib.sha256(('static-v18:' + json_text(version)).encode()).hexdigest()
    folder = store.root / 'workspaces' / project / 'exports'
    # One CRC-checked archive is promoted atomically; a failure cannot replace an older export.
    destination = folder / f'{key}.{format}.zip'
    with LOCK:
        try:
            if destination.exists():
                with zipfile.ZipFile(destination) as archive:
                    return archive.read('content')
            md, ht = documents(version)
            raw = md.encode('utf-8') if format == 'markdown' else render_pdf(ht)
            folder.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=folder, suffix='.tmp', delete=False) as output:
                temporary = output.name
                try:
                    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                        archive.writestr('content', raw)
                    output.flush()
                    os.fsync(output.fileno())
                except Exception:
                    output.close()
                    os.unlink(temporary)
                    raise
            try:
                os.replace(temporary, destination)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return raw
        except Exception as error:
            raise ValueError(f'导出失败，已有文件保留：{error}') from error
