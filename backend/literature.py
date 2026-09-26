"""Project-scoped literature search and source import helpers."""
from __future__ import annotations

from .errors import AppError, failure_message
import hashlib
import ipaddress
import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

from .state import json_text, new_id, now


ATOM = "{http://www.w3.org/2005/Atom}"
MAX_RESULTS = 10
MAX_QUERY = 200
MAX_ITEMS = 20
MAX_PDF_BYTES = 40 * 1024 * 1024
USER_AGENT = "MethodAtlas/0.2 local research workbench"
MANAGED_PROXY_NETWORK = ipaddress.ip_network("198.18.0.0/15")
DOI_RE = re.compile(r"(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/[-._;()/:A-Z0-9]+)", re.I)
ARXIV_RE = re.compile(r"(?:https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/)?([a-z-]+(?:\.[A-Z]{2})?/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$", re.I)


def ensure_schema(store) -> None:
    """Keep direct Store users compatible with databases created before schema v4."""
    with store.transaction() as db:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(papers)")}
        for name, definition in {
            "source_kind": "TEXT NOT NULL DEFAULT 'local_pdf'",
            "external_id": "TEXT",
            "metadata": "TEXT NOT NULL DEFAULT '{}'",
            "availability": "TEXT NOT NULL DEFAULT '{}'",
        }.items():
            if name not in columns:
                db.execute(f"ALTER TABLE papers ADD COLUMN {name} {definition}")


def decode_json(value, default):
    if isinstance(value, (dict, list)):
        return value
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def material_row(row: dict) -> dict:
    item = dict(row)
    item["metadata"] = decode_json(item.get("metadata"), {})
    item["availability"] = decode_json(item.get("availability"), {})
    return item


def _availability(metadata="available", abstract="missing", fulltext="unavailable", parse="not_imported", error=None):
    payload = {"metadata": metadata, "abstract": abstract, "fulltext": fulltext, "parse": parse}
    if error:
        payload["error"] = str(error)[:500]
    return payload


def _clean(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _arxiv_id(entry_id: str) -> str:
    return entry_id.rstrip("/").rsplit("/", 1)[-1].removesuffix(".pdf")


def _pdf_url(entry) -> str | None:
    for link in entry.findall(ATOM + "link"):
        href = link.attrib.get("href", "")
        if link.attrib.get("title") == "pdf" or link.attrib.get("type") == "application/pdf" or "/pdf/" in href:
            return href.replace("http://", "https://", 1)
    entry_id = _clean(entry.findtext(ATOM + "id"))
    return entry_id.replace("/abs/", "/pdf/").replace("http://", "https://", 1) if "/abs/" in entry_id else None


def _entry_payload(entry) -> dict:
    entry_id = _clean(entry.findtext(ATOM + "id"))
    external_id = _arxiv_id(entry_id)
    summary = _clean(entry.findtext(ATOM + "summary"))
    return {
        "source": "arxiv",
        "external_id": external_id,
        "title": _clean(entry.findtext(ATOM + "title")) or external_id,
        "authors": [_clean(author.findtext(ATOM + "name")) for author in entry.findall(ATOM + "author") if _clean(author.findtext(ATOM + "name"))][:20],
        "published": _clean(entry.findtext(ATOM + "published"))[:10],
        "updated": _clean(entry.findtext(ATOM + "updated"))[:10],
        "summary": summary,
        "url": entry_id,
        "pdf_url": _pdf_url(entry),
        "metadata_status": "available",
        "abstract_status": "available" if summary else "missing",
        "fulltext_status": "candidate" if _pdf_url(entry) else "unavailable",
        "parse_status": "not_imported",
    }


def _read_url(url: str, headers=None, limit=1_500_000, timeout=20) -> tuple[bytes, str, str]:
    url = _https_url(url)
    _validate_public_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    opener = urllib.request.build_opener(_PublicRedirectHandler())
    with opener.open(request, timeout=timeout) as response:
        final_url = response.geturl()
        _validate_public_url(final_url)
        length = response.headers.get("Content-Length")
        if length and int(length) > limit:
            raise ValueError("远程内容超过大小限制")
        raw = response.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("远程内容超过大小限制")
        return raw, response.headers.get_content_type(), final_url


def _validate_public_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("链接必须是公开的 HTTP 或 HTTPS 地址")
    if parsed.port not in {None, 80, 443}:
        raise ValueError("链接端口不受支持")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)}
    except OSError as exc:
        raise ValueError("无法解析链接域名") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        managed_proxy = (
            os.environ.get("METHODATLAS_ALLOW_MANAGED_PROXY") == "1"
            and parsed.scheme == "https"
            and ip in MANAGED_PROXY_NETWORK
        )
        if not ip.is_global and not managed_proxy:
            raise ValueError("链接不能指向本机或内网地址")


class _PublicRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        newurl = _https_url(newurl)
        _validate_public_url(newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def _https_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme == 'http' and parsed.port in (None, 80):
        return urllib.parse.urlunsplit(parsed._replace(scheme='https', netloc=parsed.netloc.removesuffix(':80')))
    return url


def _arxiv_feed(query: str) -> ET.Element:
    raw, _, _ = _read_url("https://export.arxiv.org/api/query?" + query)
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError("arXiv 返回格式无效") from exc


def _existing_by_external(store, project_id: str):
    rows = store.all("SELECT id,external_id FROM papers WHERE project_id=? AND external_id IS NOT NULL", (project_id,))
    return {row["external_id"]: row["id"] for row in rows}


def search_literature(store, project_id: str, body: dict) -> dict:
    ensure_schema(store)
    if not store.project(project_id):
        raise ValueError("项目不存在")
    query = _clean(body.get("query"))
    limit = body.get("limit", 6)
    if not 2 <= len(query) <= MAX_QUERY:
        raise ValueError("检索词长度需为 2-200 字符")
    if type(limit) is not int or not 1 <= limit <= MAX_RESULTS:
        raise ValueError("检索数量需为 1-10")
    if body.get("source", "arxiv") != "arxiv":
        raise ValueError("当前只接入 arXiv 开放检索")
    params = urllib.parse.urlencode({"search_query": "all:" + query, "start": 0, "max_results": limit, "sortBy": "relevance", "sortOrder": "descending"})
    try:
        root = _arxiv_feed(params)
    except (OSError, urllib.error.URLError) as exc:
        raise ValueError("开放检索失败：" + str(exc)) from exc
    imported = _existing_by_external(store, project_id)
    results = []
    for entry in root.findall(ATOM + "entry"):
        result = _entry_payload(entry)
        result.update({"imported": result["external_id"] in imported, "paper_id": imported.get(result["external_id"])})
        results.append(result)
    return {"source": "arxiv", "query": query, "results": results}


def _download_pdf(url: str) -> bytes:
    import pymupdf
    raw, content_type, _ = _read_url(url, headers={"Accept": "application/pdf"}, limit=MAX_PDF_BYTES, timeout=30)
    if not raw.startswith(b"%PDF") and content_type != "application/pdf":
        raise ValueError("全文链接返回的不是 PDF")
    if not raw.startswith(b"%PDF"):
        raise ValueError("服务器声称是 PDF，但文件内容无效")
    with pymupdf.open(stream=raw, filetype='pdf') as document:
        if not len(document) or document.needs_pass:
            raise ValueError('PDF 没有可读取的页面')
    return raw


def _download_fulltext(metadata):
    """Try recorded versions before resolving publisher landing pages."""
    sources = [{k: v for k, v in source.items() if k not in {'discovery_sources', 'discovery_accepted', 'discovery_versions', 'fulltext_source'}}
               for source in [metadata, *metadata.get('discovery_sources', [])]]
    for source in list(sources):
        sources.extend(source.get('fulltext_locations', []))
        for alias in [source.get('url'), *source.get('aliases', [])]:
            if alias and 'arxiv.org/' in alias and ARXIV_RE.fullmatch(alias):
                pdf_url = alias.replace('/abs/', '/pdf/')
                sources.append({'source': 'arxiv', 'external_id': _arxiv_id(alias), 'url': alias, 'pdf_url': pdf_url})
    if metadata.get('doi') and metadata.get('title') and not any(s.get('pdf_url') for s in sources):
        from .discovery import same_paper
        try:
            query = urllib.parse.urlencode({'search': metadata['title'], 'per-page': 5})
            raw, _, _ = _read_url('https://api.openalex.org/works?' + query)
            for work in json.loads(raw).get('results', []):
                identity = {'title': work.get('title'), 'authors': [a['author']['display_name'] for a in work.get('authorships', [])]}
                if not same_paper({'title': metadata['title'], 'authors': metadata.get('authors', [])}, identity):
                    continue
                for location in work.get('locations', []):
                    if location.get('pdf_url'):
                        sources.append({**identity, 'source': 'openalex', 'external_id': work['id'],
                            'url': location.get('landing_page_url'), 'pdf_url': location['pdf_url'],
                            'source_version': location.get('version')})
        except Exception:
            pass  # DOI resolution below remains available when the index is unreachable.
    attempted, errors = set(), []
    for source in sources:
        url = source.get('pdf_url')
        if not url or url in attempted:
            continue
        attempted.add(url)
        try:
            return _download_pdf(url), {**source, 'pdf_url': _https_url(url)}
        except Exception as exc:
            errors.append(exc)
    attempted_dois = set()
    for source in sources:
        doi = source.get('doi')
        canonical = re.sub(r'^https?://(?:dx\.)?doi\.org/', '', doi or '', flags=re.I).lower()
        if not doi or canonical in attempted_dois:
            continue
        attempted_dois.add(canonical)
        try:
            resolved = _doi_metadata(doi)
            url = resolved.get('pdf_url')
            if not url or url in attempted:
                continue
            attempted.add(url)
            return _download_pdf(url), {**source, 'pdf_url': _https_url(url)}
        except Exception as exc:
            errors.append(exc)
    if errors:
        raise AppError('fulltext_failed', '；'.join(str(error) for error in errors)[-400:]) from errors[-1]
    raise AppError('fulltext_unavailable', '来源未提供可公开下载的 PDF')


class _CitationMeta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values: dict[str, list[str]] = {}
        self.links: list[str] = []
        self.labeled_links: list[tuple[str, str]] = []
        self.fields: dict[str, str] = {}
        self.text: list[str] = []
        self._link_href: str | None = None
        self._link_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        data = {key.lower(): value for key, value in attrs if key and value}
        if tag == "a" and data.get("href"):
            self.links.append(data["href"])
            self._link_href = data["href"]
            self._link_text = []
        if tag == "input":
            key = (data.get("id") or data.get("name") or "").lower()
            if key and data.get("value"):
                self.fields[key] = data["value"]
        if tag != "meta":
            return
        name = (data.get("name") or data.get("property") or "").lower()
        if name and data.get("content"):
            self.values.setdefault(name, []).append(data["content"])

    def handle_data(self, data):
        if _clean(data):
            self.text.append(data)
            if self._link_href is not None:
                self._link_text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._link_href is not None:
            self.labeled_links.append((self._link_href, _clean(" ".join(self._link_text))))
            self._link_href = None
            self._link_text = []


def _resolver_field(text: str, label: str) -> str:
    labels = "题名|作者|来源|出版机构|出版年|DOI码|注册时间"
    match = re.search(rf"(?:^|\s){label}\s*[：:]\s*(.*?)(?=\s*(?:{labels})\s*[：:]|$)", text)
    return _clean(match.group(1)) if match else ""


def _cnki_metadata(url: str) -> dict:
    raw, content_type, page_url = _read_url(url, {"Accept":"text/html,application/pdf;q=0.9"}, limit=4_000_000)
    if raw.startswith(b"%PDF") or content_type == "application/pdf":
        return {"url":page_url, "pdf_url":page_url}
    parser = _CitationMeta()
    parser.feed(raw.decode("utf-8", "replace"))
    summary = _clean(parser.fields.get("abstract_text"))
    if not summary:
        summary = _clean((parser.values.get("citation_abstract") or parser.values.get("description") or [""])[0])
    labeled = [(urllib.parse.urljoin(page_url, href), label) for href, label in parser.labeled_links]
    download_url = next((href for href, label in labeled if "PDF下载" in label), None)
    reader_url = next((href for href, label in labeled if "原版阅读" in label), None)
    if not reader_url:
        reader_url = next((href for href, label in labeled if "CNKI AI阅读" in label), None)
    return {"url":url, "resolved_url":page_url, "summary":summary, "download_url":download_url, "reader_url":reader_url}


def _doi_metadata(doi: str) -> dict:
    doi = re.sub(r'^https?://(?:dx\.)?doi\.org/', '', doi, flags=re.I)
    url = "https://doi.org/" + urllib.parse.quote(doi, safe="/()")
    title, authors, summary, pdf_url, landing = doi, [], "", None, url
    extra = {}
    resolved = False
    errors = []
    try:
        raw, _, landing = _read_url(url, {"Accept": "application/vnd.citationstyles.csl+json"})
        csl = json.loads(raw)
        title = _clean(csl.get("title")) or doi
        authors = [_clean(" ".join(filter(None, [person.get("given"), person.get("family")]))) for person in csl.get("author", []) if isinstance(person, dict)]
        summary = _clean(csl.get("abstract"))
        resolved = title != doi or bool(authors or summary)
    except Exception as exc:
        errors.append(exc)
    try:
        raw, content_type, landing = _read_url(url, {"Accept": "text/html,application/pdf;q=0.9"}, limit=MAX_PDF_BYTES)
        if raw.startswith(b"%PDF") or content_type == "application/pdf":
            pdf_url = landing
            resolved = True
        else:
            parser = _CitationMeta()
            page_url = landing
            parser.feed(raw.decode("utf-8", "replace"))
            title = _clean((parser.values.get("citation_title") or [title])[0]) or title
            authors = parser.values.get("citation_author") or authors
            summary = _clean((parser.values.get("description") or parser.values.get("dc.description") or [summary])[0])
            candidate = (parser.values.get("citation_pdf_url") or [None])[0]
            links = [urllib.parse.urljoin(page_url, link) for link in parser.links]
            if not candidate:
                candidate = next((link for link in links if urllib.parse.urlparse(link).path.lower().endswith(".pdf")), None)
            pdf_url = urllib.parse.urljoin(page_url, candidate) if candidate else None
            visible_text = _clean(" ".join(parser.text))
            title = _resolver_field(visible_text, "题名") or title
            resolver_authors = _resolver_field(visible_text, "作者")
            if resolver_authors:
                authors = [_clean(name) for name in re.split(r"[;；]", resolver_authors) if _clean(name)]
            landing = next((link for link in links if "link.cnki.net/doi/" in link), None) or next((link for link in links if link.startswith(("http://", "https://"))), page_url)
            if "link.cnki.net/doi/" in landing:
                try:
                    cnki = _cnki_metadata(landing)
                    summary = cnki.get("summary") or summary
                    pdf_url = cnki.get("pdf_url") or pdf_url
                    extra = {key:value for key,value in cnki.items() if key not in {"url","pdf_url"} and value}
                except Exception:
                    pass
            resolved = resolved or title != doi or bool(authors or summary or pdf_url)
    except Exception as exc:
        errors.append(exc)
    if not resolved:
        missing = any(isinstance(error, urllib.error.HTTPError) and error.code == 404 for error in errors)
        if missing:
            raise ValueError("DOI 不存在或拼写错误，请核对后重新输入")
        if landing != url:
            raise ValueError("这个 DOI 没有单篇论文信息，可能是期刊整期 DOI；请输入具体文章的 DOI")
        raise ValueError("无法解析 DOI，请检查 DOI 是否完整或稍后重试")
    return {"source":"doi", "external_id":"doi:" + doi.lower(), "title":title, "authors":authors, "summary":summary, "url":landing, "pdf_url":pdf_url, "doi":doi, **extra}


def _arxiv_metadata(identifier: str) -> dict:
    root = _arxiv_feed(urllib.parse.urlencode({"id_list": identifier, "max_results": 1}))
    entry = root.find(ATOM + "entry")
    if entry is None:
        raise ValueError("arXiv 中没有找到这篇论文")
    return _entry_payload(entry)


def _link_metadata(value: str) -> dict:
    value = value.strip().rstrip(",;")
    doi = DOI_RE.fullmatch(value)
    if doi:
        return _doi_metadata(doi.group(1))
    arxiv = ARXIV_RE.fullmatch(value)
    if arxiv:
        return _arxiv_metadata(arxiv.group(1))
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("只支持 PDF 直链、arXiv 论文页或 DOI")
    _validate_public_url(value)
    title = Path(urllib.parse.unquote(parsed.path)).name.removesuffix(".pdf") or parsed.hostname
    return {"source":"pdf_url", "external_id":"url:" + hashlib.sha256(value.encode()).hexdigest(), "title":title, "authors":[], "summary":"", "url":value, "pdf_url":value}


def _import_abstract(store, project_id: str, title: str, summary: str, metadata: dict, availability: dict, target=None) -> str:
    existing = store.one("SELECT id,current_version_id FROM papers WHERE project_id=? AND " + ('id=?' if target else 'external_id=?'), (project_id, target or metadata["external_id"]))
    if target and not existing:
        raise ValueError('待更新文献不属于当前项目')
    paper_id, version_id = new_id("paper"), new_id("paper_version")
    authors = ", ".join(metadata.get("authors") or [])
    parts = [title]
    if authors:
        parts.append("Authors: " + authors)
    if metadata.get("published"):
        parts.append("Published: " + metadata["published"])
    if summary:
        parts.append("Abstract: " + summary)
    text = "\n\n".join(parts)
    digest = hashlib.sha256(text.encode()).hexdigest()
    parser_version = 'external-metadata-v2'
    if target:
        # Identical abstract text can belong to distinct, explicitly accepted editions.
        identity = {k: metadata.get(k) for k in ('external_id', 'source', 'source_version', 'updated', 'doi', 'pdf_url')}
        parser_version += ':' + hashlib.sha256(json_text(identity).encode()).hexdigest()
    layout = [{"kind":"heading", "level":1, "text":title, "rect":None, "source":"metadata"}]
    layout.extend({"kind":"paragraph", "text":part, "rect":None, "source":"metadata"} for part in parts[1:])
    pages = [{"page":1, "text":text, "blocks":[{"block":0,"start":0,"end":len(text),"text":text,"rect":None}], "layout":layout, "conversion":{"source":"metadata", "reliable":bool(summary), "warning":availability.get("error")}}]
    status = "abstract_only" if summary else "metadata_only"
    with store.transaction() as db:
        if existing:
            current = db.execute("SELECT sha256,parser_version FROM paper_versions WHERE id=?", (existing["current_version_id"],)).fetchone()
            current_version_id = existing["current_version_id"]
            if not current or current["sha256"] != digest or target and current['parser_version'] != parser_version:
                saved = db.execute("SELECT id FROM paper_versions WHERE paper_id=? AND sha256=? AND parser_version=?", (existing["id"],digest,parser_version)).fetchone()
                if not saved:
                    db.execute("INSERT INTO paper_versions VALUES(?,?,?,?,?,?,?,?)", (version_id,existing["id"],digest,1,json_text(pages),now(),parser_version,None))
                current_version_id = saved["id"] if saved else version_id
            db.execute("UPDATE papers SET title=?,path=?,current_version_id=?,status=CASE WHEN status='removed' THEN status ELSE ? END,source_kind='external_abstract',metadata=?,availability=?,external_id=? WHERE id=?", (title,f"external:{metadata['source']}:{metadata['external_id']}",current_version_id,status,json_text(metadata),json_text(availability),metadata['external_id'],existing["id"]))
            return existing["id"]
        db.execute("INSERT INTO papers(id,project_id,title,path,current_version_id,selected,status,source_kind,external_id,metadata,availability) VALUES(?,?,?,?,?,0,?,?,?,?,?)", (paper_id,project_id,title,f"external:{metadata['source']}:{metadata['external_id']}",version_id,status,"external_abstract",metadata["external_id"],json_text(metadata),json_text(availability)))
        db.execute("INSERT INTO paper_versions VALUES(?,?,?,?,?,?,?,?)", (version_id,paper_id,digest,1,json_text(pages),now(),"external-metadata-v2",None))
    return paper_id


def _import_candidate(store, project_id: str, metadata: dict) -> dict:
    external_id, title = _clean(metadata.get("external_id")), _clean(metadata.get("title"))
    summary = _clean(metadata.get("summary"))
    if not external_id or not title:
        raise ValueError("来源缺少稳定标识或标题")
    existing = store.one("SELECT id,status,current_version_id FROM papers WHERE project_id=? AND external_id=?", (project_id, external_id))
    if existing and existing["status"] in {"available", "partial", "needs_ocr"}:
        return {"paper_id":existing["id"], "version_id":existing["current_version_id"], "status":existing["status"], "duplicate":True, "imported_as":"pdf"}
    pdf_error = None
    if metadata.get("pdf_url") or metadata.get('discovery_sources') or metadata.get('doi'):
        try:
            raw, source = _download_fulltext(metadata)
            metadata = {**metadata, 'fulltext_source': source}
            before = {row["id"] for row in store.papers(project_id)}
            paper_id = store.import_pdf_bytes(project_id, raw, title, "external_pdf", external_id, metadata, existing["id"] if existing else None)
            paper = store.one("SELECT status,current_version_id FROM papers WHERE id=?", (paper_id,))
            return {"paper_id":paper_id, "version_id":paper["current_version_id"], "status":paper["status"], "duplicate":paper_id in before and not existing, "imported_as":"pdf"}
        except Exception as exc:
            pdf_error = failure_message(store, exc, project_id=project_id, operation='import_fulltext')
    if metadata.get("source") == "pdf_url":
        raise ValueError(str(pdf_error or "PDF 直链不可用"))
    if metadata.get("download_url"):
        missing_pdf = "已导入知网摘要；PDF 下载需要知网登录或机构权限。请进入知网获取全文后上传 PDF"
        fulltext = "restricted"
    else:
        missing_pdf = "已获取论文信息，但来源网站未提供可公开下载的 PDF；请打开来源网页下载，或上传 PDF 补充"
        fulltext = "failed" if metadata.get("pdf_url") else "unavailable"
    availability = _availability(abstract="available" if summary else "missing", fulltext=fulltext, parse="abstract" if summary else "metadata_only", error=pdf_error or missing_pdf)
    paper_id = _import_abstract(store, project_id, title, summary, metadata, availability)
    paper = store.one("SELECT status,current_version_id FROM papers WHERE id=?", (paper_id,))
    return {"paper_id":paper_id, "version_id":paper["current_version_id"], "status":paper["status"], "duplicate":bool(existing), "imported_as":"abstract" if summary else "metadata"}


def import_literature(store, project_id: str, body: dict) -> dict:
    ensure_schema(store)
    if not store.project(project_id):
        raise ValueError("项目不存在")
    metadata = {key: body.get(key) for key in ("source","external_id","title","authors","published","updated","summary","url","pdf_url")}
    if metadata.get("source") != "arxiv":
        raise ValueError("该兼容入口只接收 arXiv 检索结果")
    return _import_candidate(store, project_id, metadata)


def import_links(store, project_id: str, body: dict) -> dict:
    ensure_schema(store)
    if not store.project(project_id):
        raise ValueError("项目不存在")
    values = body.get("links")
    if isinstance(values, str):
        values = [line.strip() for line in values.splitlines() if line.strip()]
    if not isinstance(values, list) or not values or len(values) > MAX_ITEMS or not all(isinstance(value, str) for value in values):
        raise ValueError("请提供 1-20 条链接，每行一条")
    results = []
    for value in values:
        try:
            metadata = _link_metadata(value)
            results.append({"input":value, "result":"ok", **_import_candidate(store, project_id, metadata)})
        except Exception as exc:
            results.append({"input":value, "result":"failed", "error":failure_message(store, exc, operation="import_source", project_id=project_id)})
    return {"items":results, "succeeded":sum(item["result"] == "ok" for item in results), "failed":sum(item["result"] == "failed" for item in results)}


def import_pdf_files(store, project_id: str, files: list[tuple[str, bytes]], target_paper_id=None) -> dict:
    ensure_schema(store)
    if not store.project(project_id):
        raise ValueError("项目不存在")
    if not files or len(files) > MAX_ITEMS:
        raise ValueError("请选择 1-20 个 PDF")
    if target_paper_id and len(files) != 1:
        raise ValueError("补充现有材料时一次只能上传一个 PDF")
    results = []
    for filename, raw in files:
        try:
            if len(raw) > MAX_PDF_BYTES:
                raise ValueError("PDF 超过 40 MB 限制")
            if not raw.startswith(b"%PDF"):
                raise ValueError("文件不是有效 PDF")
            before = {row["id"] for row in store.papers(project_id)}
            title = Path(filename).stem[:300] or "未命名论文"
            paper_id = store.import_pdf_bytes(project_id, raw, title, "uploaded_pdf", metadata={"source":"upload","filename":Path(filename).name}, target_paper_id=target_paper_id)
            paper = store.one("SELECT status,current_version_id FROM papers WHERE id=?", (paper_id,))
            results.append({"input":Path(filename).name, "result":"ok", "paper_id":paper_id, "version_id":paper["current_version_id"], "status":paper["status"], "duplicate":paper_id in before})
        except Exception as exc:
            results.append({"input":Path(filename).name, "result":"failed", "error":failure_message(store, exc, operation="import_source", project_id=project_id)})
    return {"items":results, "succeeded":sum(item["result"] == "ok" for item in results), "failed":sum(item["result"] == "failed" for item in results)}


def retry_literature(store, project_id: str, paper_id: str) -> dict:
    paper = store.one("SELECT * FROM papers WHERE project_id=? AND id=?", (project_id, paper_id))
    if not paper:
        raise ValueError("材料不存在")
    metadata = decode_json(paper["metadata"], {})
    if metadata.get('source') == 'doi' and metadata.get('doi'):
        return _import_candidate(store, project_id, {**metadata, **_doi_metadata(metadata['doi'])})
    if metadata.get('source') == 'arxiv' and metadata.get('external_id') and not metadata.get('pdf_url'):
        metadata = {**metadata, **_arxiv_metadata(metadata['external_id'])}
    raw, source = _download_fulltext(metadata)
    metadata = {**metadata, 'fulltext_source': source}
    imported = store.import_pdf_bytes(project_id, raw, paper["title"], "external_pdf", paper["external_id"], metadata, paper_id)
    updated = store.one("SELECT status,current_version_id FROM papers WHERE id=?", (imported,))
    return {"paper_id":imported, "version_id":updated["current_version_id"], "status":updated["status"], "duplicate":False, "imported_as":"pdf"}
