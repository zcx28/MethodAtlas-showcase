"""Open Notebook retrieves; existing PDF locations remain the citation authority."""
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.request import Request, urlopen


LEGACY_TOOLS = {'research_paper', 'revise_paper_card', 'list_paper_cards', 'verify_claims'}


def source_text(pages):
    # Surreal command serialization rejects PDF-extracted NUL characters.
    return '\n\n'.join(b['text'] for p in pages for b in p['blocks'] if b['text'].strip()).replace('\x00', '')


def research_system(system):
    lines = [line for line in system.splitlines() if not any(word in line for word in
             ('research_paper', 'revise_paper_card', '卡的gaps'))]
    return '\n'.join(lines).replace('query 使用原文中的关键词（英文论文用英文）',
        'query 使用自然语言问题，由 Open Notebook 本地向量检索；中英文均可') + '''
当前资料检索由 Open Notebook 提供，Harness 是唯一研究执行器。read_material 带 query 时语义检索；按 page 或空 query 回读原文。优先围绕问题检索少量依据，缺口再回读相邻页，不默认遍历全文或调用已停用的研究卡Worker。检索命中不是完整阅读，重要数字须核对条件和例外。'''


def matched_blocks(pages, matches):
    """Map exact whitespace-normalized retrieved spans to immutable PDF blocks."""
    blocks, parts, cursor = [], [], 0
    for page in pages:
        for block in page['blocks']:
            text = re.sub(r'[\s\x00]+', '', block['text'])
            if text:
                blocks.append((cursor, cursor + len(text), page['page'], block['block']))
                parts.append(text)
                cursor += len(text)
    text = ''.join(parts)
    selected = {}
    for rank, match in enumerate(matches):
        needle = re.sub(r'[\s\x00]+', '', match)
        start = text.find(needle) if needle else -1
        if start < 0 or text.find(needle, start + 1) >= 0:
            continue  # Ambiguous or transformed text is not a precise citation.
        end = start + len(needle)
        for lo, hi, page, block in blocks:
            if lo < end and hi > start:
                selected.setdefault((page, block), len(matches) - rank)
    return selected


class OpenNotebook:
    def __init__(self, manifest_path):
        self.manifest = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
        self.base = self.manifest['base'].rstrip('/')

    def search(self, version_id, paper, pages, query):
        if not query.strip() or len(query) > 2000:
            raise ValueError('语义查询须为1–2000字符')
        entry = self.manifest['versions'].get(version_id)
        if not entry or entry['sha256'] != paper['sha256']:
            raise ValueError('该文献版本尚未建立 Open Notebook 索引；可按页回读，不能冒充语义检索')
        raw_text = source_text(pages)
        if hashlib.sha256(raw_text.encode()).hexdigest() != entry['text_sha256']:
            raise ValueError('材料正文与索引版本不一致，请重新建立索引')
        headers = {'Content-Type': 'application/json'}
        if os.getenv('OPEN_NOTEBOOK_PASSWORD'):
            headers['Authorization'] = 'Bearer ' + os.environ['OPEN_NOTEBOOK_PASSWORD']
        # Design limit: top 20 chunks; refine the query or read pages for omitted context.
        payload = {'query': query, 'type': 'vector', 'limit': 20, 'minimum_score': 0.2,
                   'search_sources': True, 'search_notes': False, 'notebook_id': entry['notebook_id']}
        request = Request(self.base + '/api/search', json.dumps(payload).encode(), headers)
        with urlopen(request, timeout=120) as response:
            result = json.load(response)
        matches = []
        for row in result['results']:
            if row['id'] != entry['source_id'] or row['parent_id'] != entry['source_id']:
                raise ValueError('Open Notebook 返回了范围外材料，已拒绝')
            matches.extend(row['matches'])
        positions = matched_blocks(pages, matches)
        if matches and not positions:
            raise ValueError('检索片段无法精确映射原文，请按页回读确认')
        return positions
