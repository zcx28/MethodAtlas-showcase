from __future__ import annotations

import hashlib
import json
import re
import statistics
import math
import os
from pathlib import Path

import pymupdf

try:
    import pymupdf4llm
except ImportError:  # The base parser remains a supported recovery path.
    pymupdf4llm = None


LAYOUT_VERSION = getattr(pymupdf4llm, "version", "unavailable") if pymupdf4llm else "unavailable"
# Bumping the trailing revision makes previously parsed papers re-parse on next import, instead of
# silently serving text from the older parser (v4 glued spans together and lost the spaces).
PARSER_VERSION = f"pymupdf-{pymupdf.VersionBind}-layout-{LAYOUT_VERSION}-responsive-v9"
MIN_NATIVE_TEXT = 24
MATH_RE = re.compile(r"[∑∫√≈≠≤≥∞∂∆∇α-ωΑ-Ω]|\b(?:sin|cos|log|exp)\s*\(", re.I)


def _rect(value) -> list[float]:
    return [round(float(number), 3) for number in value]


def _page_rect(page, value) -> list[float]:
    return _rect(pymupdf.Rect(value) * page.rotation_matrix)


def _contains_center(container, value) -> bool:
    if not container:
        return True
    x = (value[0] + value[2]) / 2
    y = (value[1] + value[3]) / 2
    return container[0] <= x <= container[2] and container[1] <= y <= container[3]


def locate_quote_rects(path: str | Path, page_number: int, quote: str, within=None) -> list[list[float]]:
    """Locate an exact citation on the displayed PDF page, one rectangle per line.

    Parsed evidence is block-sized. Precise citations keep exact character offsets, but reusing the
    block rectangle would still highlight an entire paragraph. Search the immutable source PDF and
    return only the lines containing the selected sentence. A word-sequence fallback handles PDF
    line wraps and hyphenation that prevent ``search_for`` from matching the original string.
    """
    if not quote.strip() or page_number < 1:
        return []
    with pymupdf.open(path) as document:
        if page_number > len(document):
            return []
        page = document[page_number - 1]
        hits = [_page_rect(page, hit) for hit in page.search_for(quote.strip())]
        hits = [hit for hit in hits if _contains_center(within, hit)]
        if hits:
            return hits

        def token(value):
            return re.sub(r"[^\w]+", "", value, flags=re.UNICODE).casefold()

        wanted = [token(part) for part in re.findall(r"\S+", quote) if token(part)]
        words = []
        for raw in page.get_text("words", sort=True):
            normalized = token(str(raw[4]))
            displayed = _page_rect(page, raw[:4])
            if normalized and _contains_center(within, displayed):
                words.append((normalized, displayed, int(raw[5]), int(raw[6])))
        if not wanted or len(wanted) > len(words):
            return []
        start = next((index for index in range(len(words) - len(wanted) + 1)
                      if [item[0] for item in words[index:index + len(wanted)]] == wanted), None)
        end = start + len(wanted) if start is not None else None
        if start is None:
            # Some PDF extractors glue every span together. Map the compact character range back to
            # its source words so these citations still receive sentence-level PDF coordinates.
            compact = token(quote)
            stream = "".join(item[0] for item in words)
            position = stream.find(compact)
            if compact and position >= 0:
                cursor = 0
                first = last = None
                for index, item in enumerate(words):
                    following = cursor + len(item[0])
                    if first is None and following > position:
                        first = index
                    if cursor < position + len(compact):
                        last = index + 1
                    cursor = following
                start, end = first, last
        if start is None:
            return []
        grouped = []
        for _, rect, block, line in words[start:end]:
            if grouped and grouped[-1][0] == (block, line):
                current = grouped[-1][1]
                grouped[-1] = ((block, line), [min(current[0], rect[0]), min(current[1], rect[1]),
                                                max(current[2], rect[2]), max(current[3], rect[3])])
            else:
                grouped.append(((block, line), rect))
        return [_rect(rect) for _, rect in grouped]


def _join_spans(line: dict) -> str:
    """Join a line's spans, restoring the spaces that the PDF expressed as a horizontal gap.

    Spans are split by font/style, so a gap between two spans usually means the source had a space
    there even though neither span's text contains one. Without this, headings such as
    "Ashish Vaswani∗Noam Shazeer∗" and running text like "decoder.The best" lose their separators.
    """
    parts, previous_right = [], None
    for span in line.get("spans", []):
        text = span.get("text", "")
        if not text:
            continue
        box = span.get("bbox")
        size = float(span.get("size", 0) or 0) or 10.0
        if parts and box and previous_right is not None:
            gap = float(box[0]) - previous_right
            if gap > size * 0.2 and not parts[-1].endswith(" ") and not text.startswith(" "):
                parts.append(" ")
        parts.append(text)
        if box:
            previous_right = float(box[2])
    return "".join(parts)


def _text_blocks(page, page_dict: dict, source: str) -> tuple[list[dict], list[dict], list[float]]:
    evidence, layout, sizes = [], [], []
    offset = 0
    for raw_block in page_dict.get("blocks", []):
        if raw_block.get("type") != 0:
            if raw_block.get("type") == 1 and raw_block.get("bbox"):
                layout.append({"kind": "image", "rect": _page_rect(page, raw_block["bbox"]), "source": "original"})
            continue
        block_text, spans = [], []
        for line in raw_block.get("lines", []):
            line_text = _join_spans(line)
            if line_text:
                block_text.append(line_text)
            for span in line.get("spans", []):
                text = span.get("text", "")
                if text.strip():
                    size = float(span.get("size", 0) or 0)
                    sizes.append(size)
                    spans.append({
                        "text": text,
                        "size": size,
                        "font": span.get("font", ""),
                        "rect": _page_rect(page, span.get("bbox", raw_block["bbox"])),
                    })
        text = "\n".join(block_text).strip()
        if not text:
            continue
        rect = _page_rect(page, raw_block["bbox"])
        evidence.append({"block": len(evidence), "start": offset, "end": offset + len(text), "text": text, "rect": rect})
        offset += len(text) + 1
        layout.append({"kind": "paragraph", "text": text, "rect": rect, "source": source, "spans": spans})
    return evidence, layout, sizes


TABLE_WARNING = '表格的行列或数值未能可靠转换，请查看原表图像；不要从转换文本推断数值。'


def _uncertain_table(rows) -> bool:
    # conservative extraction guard, not a table recognizer. Keep ambiguous
    # multiline numeric cells as source pixels until a geometry-aware extractor is available.
    return any(re.search(r'(?:^|\s)\.(?:\s|$)', cell)
               or sum(bool(re.search(r'\d', line)) for line in cell.splitlines()) > 1
               for row in rows for cell in row)


def _table_layout(page) -> tuple[list[dict], list[list[float]]]:
    output, rectangles = [], []
    try:
        tables = page.find_tables().tables
    except Exception:
        return output, rectangles
    for table in tables:
        try:
            rows = [[str(cell or "").strip() for cell in row] for row in table.extract()]
        except Exception:
            continue
        if not rows or not any(any(cell for cell in row) for row in rows):
            continue
        rect = _page_rect(page, table.bbox)
        rectangles.append(rect)
        output.append({"kind": "image", "rect": rect, "source": "original", "warning": TABLE_WARNING}
                      if _uncertain_table(rows) else
                      {"kind": "table", "rows": rows, "rect": rect, "source": "native"})
    return output, rectangles


def _inside(rect: list[float], containers: list[list[float]]) -> bool:
    x = (rect[0] + rect[2]) / 2
    y = (rect[1] + rect[3]) / 2
    return any(box[0] <= x <= box[2] and box[1] <= y <= box[3] for box in containers)


def _model_layout(page, model_page: dict, tables: list[dict], table_rects: list[list[float]]) -> tuple[list[dict], list[dict], list[float]]:
    layout, evidence, sizes = [], [], []
    offset = 0
    table_by_rect = {tuple(item["rect"]): item for item in tables}
    for order, box in enumerate(model_page.get("boxes", [])):
        raw_rect = box.get("bbox") or [box.get("x0"), box.get("y0"), box.get("x1"), box.get("y1")]
        if any(value is None for value in raw_rect):
            continue
        rect = _page_rect(page, raw_rect)
        boxclass = str(box.get("boxclass") or "text").lower()
        if _inside(rect, table_rects) and "table" not in boxclass:
            continue
        table = next((item for key, item in table_by_rect.items() if _inside(rect, [list(key)]) or _inside(list(key), [rect])), None)
        if "table" in boxclass:
            table = table or {"kind":"image", "rect":rect, "source":"original", "warning":TABLE_WARNING}
            layout.append({**table, "_order": order})
            text = table.get('warning') or "\n".join("\t".join(row) for row in table["rows"])
        elif any(name in boxclass for name in ("picture", "image", "figure", "chart")):
            layout.append({"kind":"image", "rect":rect, "source":"original", "_order":order})
            text = ""
        else:
            lines, spans = [], []
            for line in box.get("textlines") or []:
                line_spans = line.get("spans") or []
                # pymupdf4llm groups columns that share a baseline into one line, so joining the spans
                # blindly would glue "Ashish Vaswani" onto "Noam Shazeer". Restore the gaps instead.
                line_text = _join_spans({"spans": line_spans})
                if line_text:
                    lines.append(line_text)
                spans.extend(line_spans)
            text = "\n".join(lines).strip()
            if not text:
                continue
            sizes.extend(float(span.get("size") or 0) for span in spans if span.get("size"))
            kind = "formula" if any(name in boxclass for name in ("formula", "equation")) else "list_item" if "list" in boxclass else "heading" if any(name in boxclass for name in ("title", "heading", "section-header")) else "paragraph"
            item = {"kind":kind, "text":text, "rect":rect, "source":"layout", "_order":order}
            if kind == "heading":
                item["level"] = max(1, min(3, int(box.get("header_level") or 2)))
            layout.append(item)
        if text:
            evidence.append({"block":len(evidence), "start":offset, "end":offset + len(text), "text":text, "rect":rect})
            offset += len(text) + 1
    return evidence, layout, sizes


def _classify_layout(layout: list[dict], median_size: float, table_rects: list[list[float]]) -> list[dict]:
    result = []
    for item in layout:
        if item["kind"] != "paragraph":
            result.append(item)
            continue
        if _inside(item["rect"], table_rects):
            continue
        text = item["text"].strip()
        spans = item.pop("spans", [])
        sizes = [span["size"] for span in spans if span["size"]]
        largest = max(sizes, default=median_size)
        fonts = " ".join(span.get("font", "") for span in spans)
        if MATH_RE.search(text) or "math" in fonts.lower() or "symbol" in fonts.lower():
            result.append({**item, "kind": "formula"})
        elif re.match(r"^(?:[-•●▪◦]|\d+[.)])\s+", text):
            result.append({**item, "kind": "list_item"})
        elif len(text) <= 180 and largest >= median_size * 1.22:
            level = 1 if largest >= median_size * 1.7 else 2 if largest >= median_size * 1.4 else 3
            result.append({**item, "kind": "heading", "level": level})
        else:
            result.append(item)
    ordered = any("_order" in item for item in result)
    result.sort(key=(lambda item: item.get("_order", 10**9)) if ordered else (lambda item: (round(item["rect"][1], 1), round(item["rect"][0], 1))))
    for item in result:
        item.pop("_order", None)
    return result


def _parse_pdf(raw: bytes) -> dict:
    pages, all_sizes, pending = [], [], []
    with pymupdf.open(stream=raw, filetype="pdf") as reader:
        if reader.needs_pass and not reader.authenticate(""):
            raise ValueError("PDF 加密，无法读取正文")
        if not len(reader):
            raise ValueError("PDF 没有页面")
        model_pages = []
        if pymupdf4llm:
            try:
                model_pages = json.loads(pymupdf4llm.to_json(reader, force_text=True, use_ocr=False)).get("pages", [])
            except Exception:
                model_pages = []
        for number, page in enumerate(reader, 1):
            native = page.get_text("text", sort=True).strip()
            source, warning, ocr_layout = "native", None, None
            if len(native) < MIN_NATIVE_TEXT:
                try:
                    local = Path(os.getenv("LOCALAPPDATA", str(Path.home() / ".local/share"))) / "MethodAtlas/tessdata"
                    tessdata = Path(pymupdf.get_tessdata(os.getenv("TESSDATA_PREFIX") or (str(local) if local.is_dir() else None)))
                    languages = [lang for lang in ("eng", "chi_sim", "chi_tra") if (tessdata / (lang + ".traineddata")).is_file()]
                    if not languages:
                        raise RuntimeError("No supported OCR language data")
                    ocr_pdf = page.get_pixmap(dpi=150).pdfocr_tobytes(language="+".join(languages), tessdata=str(tessdata))
                    with pymupdf.open(stream=ocr_pdf, filetype="pdf") as recognized:
                        ocr_dict = recognized[0].get_text("dict", sort=True)
                        if pymupdf4llm:
                            try:
                                ocr_model = json.loads(pymupdf4llm.to_json(recognized, force_text=True, use_ocr=False))["pages"][0]
                                ocr_layout = _model_layout(recognized[0], ocr_model, [], [])
                            except Exception:
                                pass
                        if not ocr_layout or not ocr_layout[0]:
                            ocr_layout = _text_blocks(recognized[0], ocr_dict, "ocr")
                            warning = "OCR 文字已识别，但阅读顺序未能解析；请核对原 PDF 中的分栏和数值归属。"
                    source = "ocr"
                    # flag coarse full-page scans; confidence scoring needs an OCR engine that exposes it.
                    for image in page.get_image_info():
                        rect = pymupdf.Rect(image["bbox"])
                        if rect.width > 0 and rect.height > 0 and rect.get_area() >= page.rect.get_area() * .5 and min(image["width"] / rect.width, image["height"] / rect.height) * 72 < 100:
                            warning = "扫描页清晰度较低，OCR 可能误识别文字或混合分栏；请对照原 PDF 核对数值与归属，或上传更清晰的版本。"
                            break
                    if "chi_sim" not in languages and "chi_tra" not in languages:
                        warning = "当前 OCR 仅支持英语，中文扫描页可能识别为乱码；请核对原 PDF，安装中文 OCR 语言包后重新解析。"
                except Exception:
                    warning = "该页没有可靠文本，OCR 不可用；阅读器保留原页图像。"
            tables, table_rects = _table_layout(page) if source == "native" else ([], [])
            if source == "ocr":
                evidence, layout, sizes = ocr_layout
            elif source == "native" and number <= len(model_pages):
                evidence, layout, sizes = _model_layout(page, model_pages[number - 1], tables, table_rects)
            else:
                page_dict = page.get_text("dict", sort=True)
                evidence, layout, sizes = _text_blocks(page, page_dict, source)
                layout.extend(tables)
            if source == "native" and not evidence:
                page_dict = page.get_text("dict", sort=True)
                evidence, layout, sizes = _text_blocks(page, page_dict, source)
                layout.extend(tables)
            # Native fallback and model output share the same safety boundary. Never
            # retain corrupted table digits in the evidence stream while hiding them in UI.
            uncertain = [item for item in layout + tables if item.get('warning') == TABLE_WARNING]
            if uncertain:
                warning = TABLE_WARNING
                regions = [item['rect'] for item in uncertain]
                evidence = [block for block in evidence if not _inside(block['rect'], regions)]
                layout = [item for item in layout if item.get('warning') or not _inside(item['rect'], regions)]
                for item in uncertain:
                    if not any(block['rect'] == item['rect'] for block in evidence):
                        evidence.append({'text': TABLE_WARNING, 'rect': item['rect']})
                    if not any(block['rect'] == item['rect'] and block.get('warning') for block in layout):
                        layout.append(item)
                offset = 0
                for index, block in enumerate(evidence):
                    block.update(block=index, start=offset, end=offset + len(block['text']))
                    offset = block['end'] + 1
            readable = any(block["text"].strip() for block in evidence)
            if not readable:
                layout = [{"kind": "page_image", "rect": [0.0, 0.0, float(page.rect.width), float(page.rect.height)], "source": "original"}]
                warning = warning or "该页没有识别出正文；已保留原页图像。"
            pending.append((layout, table_rects))
            all_sizes.extend(sizes)
            pages.append({
                "page": number,
                "text": "\n".join(block["text"] for block in evidence),
                "width": page.rect.width,
                "height": page.rect.height,
                "blocks": evidence,
                "conversion": {"source": source if readable else "image_fallback", "reliable": readable and not warning, "warning": warning},
            })
    median_size = statistics.median(all_sizes) if all_sizes else 11.0
    for page, (layout, table_rects) in zip(pages, pending):
        page["layout"] = _classify_layout(layout, median_size, table_rects)
    readable_pages = sum(bool(page["text"].strip()) for page in pages)
    return {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "page_count": len(pages),
        "pages": pages,
        "conversion": {
            "status": "parsed" if all(page['conversion']['reliable'] for page in pages) else "partial" if readable_pages else "image_only",
            "readable_pages": readable_pages,
            "fallback_pages": [page["page"] for page in pages if not page["conversion"]["reliable"]],
            "ocr_pages": [page["page"] for page in pages if page["conversion"]["source"] == "ocr"],
                "parser": PARSER_VERSION,
                "layout_engine": "pymupdf4llm" if model_pages else "pymupdf",
        },
    }


def extract_pdf_region(raw: bytes, sha256: str, page: int, rect=None):
    """Render a verified PDF page/region; callers must authorize its material version.

    rect uses the displayed page's point coordinates, including page rotation.
    This copies source pixels; it does not identify or interpret paper figures.
    """
    if hashlib.sha256(raw).hexdigest() != sha256:
        raise ValueError('PDF 内容与指定材料版本不一致')
    if type(page) is not int or page < 1:
        raise ValueError('PDF 页码必须为正整数')
    with pymupdf.open(stream=raw, filetype='pdf') as reader:
        if reader.needs_pass and not reader.authenticate(''):
            raise ValueError('PDF 加密，无法提取图片')
        if page > len(reader):
            raise ValueError('页码不属于该 PDF')
        source = reader[page - 1]
        if rect is not None and (not isinstance(rect, (list, tuple)) or len(rect) != 4
                                or any(type(n) not in (int, float) or not math.isfinite(n) for n in rect)):
            raise ValueError('裁剪区域须包含四个有限坐标')
        clip = pymupdf.Rect(rect) if rect is not None else source.rect
        if clip.is_empty or clip.is_infinite or not source.rect.contains(clip):
            raise ValueError('裁剪区域必须完整位于显示页内')
        # Bound decoded image memory, including unusually large PDF page sizes.
        scale = min(2, 4096 / max(clip.width, clip.height))
        pixels = source.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
        image = pixels.tobytes('png')
        return image, {'source_sha256': sha256, 'page': page, 'rect': list(clip),
                       'page_rotation': source.rotation, 'scale': scale,
                       'sha256': hashlib.sha256(image).hexdigest(),
                       'extraction': f'pymupdf-{pymupdf.VersionBind}-page-region',
                       'kind': 'page_crop' if rect is not None else 'page_image'}


def read_pdf(path: Path) -> dict:
    return _parse_pdf(path.read_bytes())


def read_pdf_bytes(raw: bytes) -> dict:
    if not isinstance(raw, bytes) or not raw.startswith(b"%PDF"):
        raise ValueError("文件不是有效 PDF")
    return _parse_pdf(raw)
