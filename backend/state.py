"""Durable state and atomic promotion fences for the local research agent."""
from __future__ import annotations
from contextlib import contextmanager
import json
import hashlib
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from .pdf import PARSER_VERSION, read_pdf, read_pdf_bytes

class StaleRun(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def canonical_citation_id(value: str) -> str:
    match = re.fullmatch(r'(?:cite:)?(?:cite_)?([0-9a-f]{32})', value)
    return 'cite_' + match[1] if match else value


def json_text(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class Store:
    def __init__(self, path: Path):
        self.root = path.parent.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        existed = path.is_file()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.extraction_locks = {}
        if existed and self.db.execute("PRAGMA user_version").fetchone()[0] < 6:
            backups = self.root / "backups"
            backups.mkdir(exist_ok=True)
            with sqlite3.connect(backups / f"before-tasks-v6-{uuid.uuid4().hex}.sqlite3") as backup:
                self.db.backup(backup)
        if existed and not self.db.execute("SELECT 1 FROM sqlite_master WHERE name='paper_extractions'").fetchone():
            backups = self.root / 'backups'
            backups.mkdir(exist_ok=True)
            with sqlite3.connect(backups / f'before-research-cache-{uuid.uuid4().hex}.sqlite3') as backup:
                self.db.backup(backup)
        self._init()

    def _init(self):
        with self.lock, self.db:
            self.db.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL, current_version_id TEXT, selected INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'available', source_kind TEXT NOT NULL DEFAULT 'local_pdf', external_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', availability TEXT NOT NULL DEFAULT '{}', UNIQUE(project_id, path));
                CREATE TABLE IF NOT EXISTS paper_versions (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, sha256 TEXT NOT NULL, page_count INTEGER NOT NULL, pages TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(paper_id, sha256));
                CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, client_message_id TEXT UNIQUE, role TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL, task_id TEXT);
                CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE, prompt TEXT NOT NULL, selected_paper_ids TEXT NOT NULL, generate INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, artifact_id TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS task_events (task_id TEXT NOT NULL, seq INTEGER NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(task_id, seq));
                CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS artifact_versions (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, task_id TEXT NOT NULL, version_no INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, citations TEXT NOT NULL, materials TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(artifact_id, version_no));
                """
            )

            columns = {row["name"] for row in self.db.execute("PRAGMA table_info(paper_versions)")}
            if "parser_version" not in columns:
                self.db.executescript("""
                    BEGIN;
                    CREATE TABLE paper_versions_v2(id TEXT PRIMARY KEY,paper_id TEXT NOT NULL,sha256 TEXT NOT NULL,page_count INTEGER NOT NULL,pages TEXT NOT NULL,created TEXT NOT NULL,parser_version TEXT NOT NULL DEFAULT 'legacy',source_path TEXT,UNIQUE(paper_id,sha256,parser_version));
                    INSERT INTO paper_versions_v2(id,paper_id,sha256,page_count,pages,created) SELECT id,paper_id,sha256,page_count,pages,created FROM paper_versions;
                    DROP TABLE paper_versions;
                    ALTER TABLE paper_versions_v2 RENAME TO paper_versions;
                    COMMIT;
                """)
            for table, fields in {
                "papers": {"source_kind":"TEXT NOT NULL DEFAULT 'local_pdf'", "external_id":"TEXT", "metadata":"TEXT NOT NULL DEFAULT '{}'", "availability":"TEXT NOT NULL DEFAULT '{}'"},
                "tasks": {"revision":"INTEGER NOT NULL DEFAULT 0", "mode":"TEXT NOT NULL DEFAULT 'auto'", "kind":"TEXT NOT NULL DEFAULT 'research'", "scope_mode":"TEXT NOT NULL DEFAULT 'project'", "snapshot":"TEXT NOT NULL DEFAULT '[]'", "plan":"TEXT NOT NULL DEFAULT '[]'", "checkpoint":"TEXT NOT NULL DEFAULT '{}'", "evidence":"TEXT NOT NULL DEFAULT '[]'", "coverage":"TEXT NOT NULL DEFAULT '{}'", "refs":"TEXT NOT NULL DEFAULT '{}'", "blocked_reason":"TEXT"},
                "artifact_versions": {"kind":"TEXT NOT NULL DEFAULT 'research'", "payload":"TEXT NOT NULL DEFAULT '{}'"},
                "task_events": {"step_id":"TEXT"}
            }.items():
                existing = {row["name"] for row in self.db.execute(f"PRAGMA table_info({table})")}
                for name, definition in fields.items():
                    if name not in existing:
                        self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS paper_extractions(project_id TEXT,version_id TEXT,policy INTEGER,body TEXT,next_offset INTEGER,complete INTEGER,PRIMARY KEY(project_id,version_id,policy));
                CREATE TABLE IF NOT EXISTS claim_checks(project_id TEXT,cache_key TEXT,result TEXT,PRIMARY KEY(project_id,cache_key));
                CREATE TABLE IF NOT EXISTS model_usage(task_id TEXT,call_id TEXT,role TEXT,model TEXT,usage TEXT,PRIMARY KEY(task_id,call_id));
                CREATE TABLE IF NOT EXISTS tool_calls(task_id TEXT NOT NULL,revision INTEGER NOT NULL,call_id TEXT NOT NULL,name TEXT NOT NULL,arguments TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created TEXT NOT NULL,finished TEXT,PRIMARY KEY(task_id,revision,call_id));
            """)
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,conversation_id TEXT NOT NULL,paper_id TEXT NOT NULL,paper_version_id TEXT NOT NULL,location TEXT NOT NULL,UNIQUE(conversation_id,paper_version_id,location));
                CREATE TABLE IF NOT EXISTS reads(conversation_id TEXT NOT NULL,paper_id TEXT NOT NULL,paper_version_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(conversation_id,paper_version_id));
                CREATE TABLE IF NOT EXISTS paper_cards(conversation_id TEXT NOT NULL,paper_version_id TEXT NOT NULL,question TEXT NOT NULL,body TEXT NOT NULL,next_offset INTEGER NOT NULL,complete INTEGER NOT NULL DEFAULT 0,updated TEXT NOT NULL,PRIMARY KEY(conversation_id,paper_version_id,question));
            """)
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS task_waits(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,object_key TEXT NOT NULL,payload TEXT NOT NULL,response TEXT,created TEXT NOT NULL,UNIQUE(task_id,object_key));
                CREATE TABLE IF NOT EXISTS file_commits(task_id TEXT NOT NULL,call_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(task_id,call_id));
            """)
            for row in self.db.execute("SELECT id FROM tasks WHERE status IN ('running','routing')").fetchall():
                self.event(row['id'], 'interrupted', '服务重启，已保存进度；可主动继续')
            self.db.execute("UPDATE tasks SET status='interrupted',revision=revision+1,blocked_reason='服务重启，已保存进度；可主动继续。' WHERE status IN ('running','routing')")
            self.db.execute("UPDATE tool_calls SET status='unknown' WHERE status='running'")
            self.db.execute("PRAGMA user_version=6")


    def one(self, sql: str, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchone()

    def all(self, sql: str, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def run(self, sql: str, args=()):
        with self.transaction() as db:
            return db.execute(sql, args)

    def sync_pdfs(self, directory: Path):
        projects = self.projects()
        project_id = projects[-1]["id"] if projects else self.create_project("本地论文研究")
        for path in sorted(directory.glob("*.pdf")) if directory.is_dir() else []:
            try:
                self.import_pdf(project_id, path)
            except Exception as exc:
                paper = self.one("SELECT id FROM papers WHERE project_id=? AND path=?", (project_id, str(path.resolve())))
                if not paper:
                    self.run("INSERT INTO papers(id,project_id,title,path) VALUES(?,?,?,?)", (new_id("paper"), project_id, path.stem, str(path.resolve())))
                self.run("UPDATE papers SET status=? WHERE project_id=? AND path=?", (f"unavailable: {type(exc).__name__}", project_id, str(path.resolve())))

    def project(self, project_id: str):
        return self.one("SELECT * FROM projects WHERE id=?", (project_id,))

    def projects(self):
        return [dict(row) for row in self.all("SELECT * FROM projects ORDER BY updated DESC")]

    def create_project(self, name: str):
        project_id = new_id("project")
        self.run("INSERT INTO projects VALUES (?, ?, ?, ?)", (project_id, name, now(), now()))
        conversation_id = new_id("conversation")
        self.run("INSERT INTO conversations VALUES (?, ?, ?, ?, ?)", (conversation_id, project_id, "新对话", now(), now()))
        return project_id

    def conversations(self, project_id: str):
        return [dict(row) for row in self.all("SELECT * FROM conversations WHERE project_id=? ORDER BY updated DESC", (project_id,))]

    def create_conversation(self, project_id: str):
        conversation_id = new_id("conversation")
        self.run("INSERT INTO conversations VALUES (?, ?, ?, ?, ?)", (conversation_id, project_id, "新对话", now(), now()))
        return conversation_id

    def papers(self, project_id: str):
        rows = self.all("SELECT p.*, v.sha256, v.page_count FROM papers p LEFT JOIN paper_versions v ON v.id=p.current_version_id WHERE p.project_id=? AND p.status<>'removed' ORDER BY p.title", (project_id,))
        return [dict(row) for row in rows]

    def paper(self, project_id, paper_id, version_id=None):
        row = self.one("SELECT p.*,v.id AS version_id,v.sha256,v.page_count,v.pages,v.parser_version,v.source_path FROM papers p JOIN paper_versions v ON v.id=COALESCE(?,p.current_version_id) AND v.paper_id=p.id WHERE p.project_id=? AND p.id=?", (version_id, project_id, paper_id))
        return dict(row) if row else None

    def messages(self, conversation_id: str):
        return [dict(row) for row in self.all("SELECT * FROM messages WHERE conversation_id=? ORDER BY created", (conversation_id,))]

    def prior_messages(self, task):
        # Include the completed answer to earlier queued work even if it finished after enqueue.
        return [dict(row) for row in self.all('SELECT m.* FROM messages m LEFT JOIN tasks t ON t.id=m.task_id WHERE m.conversation_id=? AND COALESCE(t.created,m.created)<? ORDER BY m.created', (task['conversation_id'],task['created']))]

    def task(self, task_id):
        row = self.one("SELECT * FROM tasks WHERE id=?", (task_id,))
        if not row:
            return None
        task = dict(row)
        for field in ("selected_paper_ids", "snapshot", "plan", "checkpoint", "evidence", "coverage", "refs"):
            task[field] = json.loads(task[field])
        return task

    def event(self, task_id, status, message, step_id=None):
        with self.transaction() as db:
            db.execute("INSERT INTO task_events(task_id,seq,status,message,created,step_id) SELECT ?,COALESCE(MAX(seq),0)+1,?,?,?,? FROM task_events WHERE task_id=?", (task_id, status, message, now(), step_id, task_id))

    def events(self, task_id: str):
        return [dict(row) for row in self.all("SELECT * FROM task_events WHERE task_id=? ORDER BY seq", (task_id,))]

    def artifacts(self, project_id: str):
        return [dict(row) for row in self.all("SELECT * FROM artifacts WHERE project_id=? AND kind<>'personal_skill' ORDER BY updated DESC", (project_id,))]

    def artifact(self, project_id: str, artifact_id: str):
        row = self.one("SELECT * FROM artifacts WHERE project_id=? AND id=?", (project_id, artifact_id))
        if not row:
            return None
        artifact = dict(row)
        versions = self.all("SELECT * FROM artifact_versions WHERE artifact_id=? ORDER BY version_no", (artifact_id,))
        artifact["versions"] = [{**dict(version), "citations": json.loads(version["citations"]), "materials": json.loads(version["materials"]), "payload": json.loads(version["payload"])} for version in versions]
        return artifact

    def close(self):
        with self.lock:
            self.db.close()

    @contextmanager
    def transaction(self):
        # Design limit: one local writer; split connections if measured concurrent throughput requires it.
        with self.lock:
            nested = self.db.in_transaction
            savepoint = 'sp_' + uuid.uuid4().hex
            self.db.execute('SAVEPOINT ' + savepoint if nested else 'BEGIN IMMEDIATE')
            try:
                yield self.db
                self.db.execute('RELEASE ' + savepoint) if nested else self.db.commit()
            except BaseException:
                if nested:
                    self.db.execute('ROLLBACK TO ' + savepoint)
                    self.db.execute('RELEASE ' + savepoint)
                else:
                    self.db.rollback()
                raise

    def _store_pdf(self, project_id, raw, parsed, title, path_key, source_kind="local_pdf", external_id=None, metadata=None, target_paper_id=None):
        fulltext_source = (metadata or {}).get('fulltext_source')
        if not self.project(project_id):
            raise ValueError("项目不存在")
        if hashlib.sha256(raw).hexdigest() != parsed['sha256']:
            raise ValueError('PDF 在读取期间改变，请重新导入')
        source = self.root / "sources" / (parsed["sha256"] + ".pdf")
        source.parent.mkdir(exist_ok=True)
        if not source.exists():
            with source.open('xb') as output:
                output.write(raw)
        conversion = parsed.get("conversion", {})
        status = "available" if conversion.get("status") == "parsed" else "partial" if conversion.get("status") == "partial" else "needs_ocr"
        with self.transaction() as db:
            duplicate = db.execute(
                "SELECT p.* FROM papers p JOIN paper_versions v ON v.paper_id=p.id WHERE p.project_id=? AND v.sha256=? ORDER BY v.created LIMIT 1",
                (project_id, parsed["sha256"]),
            ).fetchone()
            if duplicate and not target_paper_id:
                return duplicate["id"]
            paper = None
            if target_paper_id:
                paper = db.execute("SELECT * FROM papers WHERE project_id=? AND id=?", (project_id, target_paper_id)).fetchone()
                if not paper:
                    raise ValueError("待补充材料不属于当前项目")
            if not paper and external_id:
                paper = db.execute("SELECT * FROM papers WHERE project_id=? AND external_id=?", (project_id, external_id)).fetchone()
            if not paper:
                paper = db.execute("SELECT * FROM papers WHERE project_id=? AND path=?", (project_id, path_key)).fetchone()
            if paper and target_paper_id:
                path_key = paper["path"]
                existing_metadata = json.loads(paper["metadata"] or "{}")
                incoming_metadata = metadata or {}
                metadata = {**incoming_metadata, **existing_metadata}
                if incoming_metadata.get('fulltext_source'):
                    metadata['fulltext_source'] = incoming_metadata['fulltext_source']
                if incoming_metadata.get("filename"):
                    metadata["supplement_filename"] = incoming_metadata["filename"]
                title = paper["title"]
                external_id = external_id or paper["external_id"]
                source_kind = "external_pdf" if external_id else "uploaded_pdf"
            availability = {
                "metadata": "available",
                "abstract": "available" if (metadata or {}).get("summary") else "missing",
                "fulltext": "downloaded",
                "parse": conversion.get("status", "unknown"),
                "conversion": conversion,
            }
            paper_id = paper["id"] if paper else new_id("paper")
            if not paper:
                db.execute(
                    "INSERT INTO papers(id,project_id,title,path,source_kind,external_id,metadata,availability) VALUES(?,?,?,?,?,?,?,?)",
                    (paper_id, project_id, title, path_key, source_kind, external_id, json_text(metadata or {}), json_text(availability)),
                )
            pages = json_text(parsed["pages"])
            parser_version = PARSER_VERSION + ":" + hashlib.sha256(pages.encode()).hexdigest()
            version = db.execute("SELECT id FROM paper_versions WHERE paper_id=? AND sha256=? AND parser_version=?", (paper_id, parsed["sha256"], parser_version)).fetchone()
            version_id = version["id"] if version else new_id("paper_version")
            if fulltext_source:
                metadata['discovery_accepted'] = {**metadata.get('discovery_accepted', {}), version_id: fulltext_source}
            if not version:
                db.execute("INSERT INTO paper_versions VALUES(?,?,?,?,?,?,?,?)", (version_id,paper_id,parsed["sha256"],parsed["page_count"],pages,now(),parser_version,str(source)))
            db.execute("UPDATE paper_versions SET source_path=? WHERE paper_id=? AND sha256=?", (str(source),paper_id,parsed["sha256"]))
            db.execute(
                "UPDATE papers SET title=?,path=?,current_version_id=?,status=CASE WHEN status='removed' THEN status ELSE ? END,source_kind=?,external_id=COALESCE(?,external_id),metadata=?,availability=? WHERE id=?",
                (title, path_key, version_id, status, source_kind, external_id, json_text(metadata or {}), json_text(availability), paper_id),
            )
        return paper_id

    def import_pdf(self, project_id, path, title=None):
        parsed = read_pdf(path)
        raw = path.read_bytes()
        return self._store_pdf(project_id, raw, parsed, title or path.stem, str(path.resolve()))

    def import_pdf_bytes(self, project_id, raw, title, source_kind="uploaded_pdf", external_id=None, metadata=None, target_paper_id=None):
        if not isinstance(title, str) or not title.strip() or len(title) > 300:
            raise ValueError("PDF 标题无效")
        parsed = read_pdf_bytes(raw)
        path_key = f"source:{source_kind}:{external_id or parsed['sha256']}"
        return self._store_pdf(project_id, raw, parsed, title.strip(), path_key, source_kind, external_id, metadata, target_paper_id)

    def paste(self, project_id, title, text):
        if not self.project(project_id) or not isinstance(text, str) or not text.strip() or len(text) > 200000:
            raise ValueError("项目或文字材料无效（最多 200000 字符）")
        if not isinstance(title, str) or not title.strip() or len(title) > 300:
            raise ValueError("请提供材料标题（最多 300 字符）")
        digest = hashlib.sha256(text.encode()).hexdigest()
        duplicate = self.one(
            "SELECT p.id FROM papers p JOIN paper_versions v ON v.paper_id=p.id WHERE p.project_id=? AND v.sha256=? LIMIT 1",
            (project_id, digest),
        )
        if duplicate:
            return duplicate["id"]
        paper_id, version_id = new_id("paper"), new_id("paper_version")
        layout = []
        for chunk in re.split(r"\n\s*\n", text):
            if not chunk:
                continue
            stripped = chunk.strip()
            heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
            if heading:
                layout.append({"kind":"heading", "level":min(len(heading.group(1)), 3), "text":heading.group(2), "rect":None, "source":"paste"})
            elif re.match(r"^(?:[-*•]|\d+[.)])\s+", stripped):
                layout.append({"kind":"list_item", "text":stripped, "rect":None, "source":"paste"})
            else:
                layout.append({"kind":"paragraph", "text":chunk, "rect":None, "source":"paste"})
        pages = [{"page": 1, "text": text, "blocks": [{"block": 0, "start": 0, "end": len(text), "text": text, "rect": None}], "layout":layout, "conversion":{"source":"paste", "reliable":True, "warning":None}}]
        availability = {"metadata":"available", "abstract":"missing", "fulltext":"provided", "parse":"parsed", "conversion":{"status":"parsed", "readable_pages":1, "fallback_pages":[], "ocr_pages":[], "parser":"paste-v2"}}
        with self.transaction() as db:
            db.execute("INSERT INTO papers(id,project_id,title,path,current_version_id,selected,status,source_kind,metadata,availability) VALUES(?,?,?,?,?,0,'available','text',?,?)", (paper_id,project_id,title,"paste:" + paper_id,version_id,json_text({"source":"paste","title":title}),json_text(availability)))
            db.execute("INSERT INTO paper_versions VALUES(?,?,?,?,?,?,?,?)", (version_id,paper_id,digest,1,json_text(pages),now(),"paste-v2",None))
        return paper_id

    def citation(self, project_id, citation_id, conversation_id=None):
        citation_id = canonical_citation_id(citation_id)
        row = self.one("SELECT e.*,p.title FROM evidence e JOIN papers p ON p.id=e.paper_id AND p.project_id=e.project_id JOIN paper_versions v ON v.id=e.paper_version_id AND v.paper_id=p.id WHERE e.project_id=? AND e.id=?", (project_id,citation_id))
        if not row or conversation_id and row["conversation_id"] != conversation_id:
            raise ValueError("引用不属于当前项目或对话")
        citation = dict(row)
        location = json.loads(citation.pop('location'))
        return {**citation, **location}

    def reading_history(self, conversation_id):
        return [dict(row) for row in self.all("SELECT r.*,p.title FROM reads r JOIN papers p ON p.id=r.paper_id WHERE r.conversation_id=? AND p.path NOT LIKE 'paste:%' ORDER BY r.created", (conversation_id,))]

    def task_view(self, task_id):
        task = self.task(task_id)
        if task:
            task.pop("checkpoint")  # Provider protocol/reasoning is not user-facing progress.
            task["events"] = self.events(task_id)
            task["tools"] = [dict(row) for row in self.all("SELECT revision,call_id,name,status,created,finished,substr(result,1,1600) AS result FROM tool_calls WHERE task_id=? ORDER BY created", (task_id,))]
            task['waits'] = [{**dict(row), 'payload':json.loads(row['payload']), 'response':json.loads(row['response']) if row['response'] else None} for row in self.all('SELECT * FROM task_waits WHERE task_id=?', (task_id,))]
            task['failures'] = list(task['refs'].get('failures', {}).values())
        return task

    def wait_for(self, task_id, revision, object_key, payload):
        if not isinstance(object_key, str) or not 1 <= len(object_key) <= 200 or not isinstance(payload, dict) or len(json_text(payload)) > (2_000_000 if payload.get('kind') == 'papers' else 100000):
            raise ValueError('确认对象无效')
        with self.transaction() as db:
            self.assert_active(task_id, revision)
            old = db.execute('SELECT * FROM task_waits WHERE task_id=? AND object_key=?', (task_id, object_key)).fetchone()
            if old and json.loads(old['payload']) != payload:
                raise ValueError('同一确认对象不能改变内容，请使用新对象标识')
            if old and old['response'] is not None:
                return json.loads(old['response'])
            if not old:
                db.execute('INSERT INTO task_waits VALUES(?,?,?,?,NULL,?)', (new_id('wait'), task_id, object_key, json_text(payload), now()))
            db.execute("UPDATE tasks SET status='waiting',revision=revision+1,updated=? WHERE id=?", (now(), task_id))
            self.event(task_id, 'waiting', '等待确认：' + object_key)
        raise StaleRun()

    def assert_active(self, task_id, revision):
        row = self.one("SELECT status,revision FROM tasks WHERE id=?", (task_id,))
        if not row or row["revision"] != revision or row["status"] not in ("running","routing"):
            raise StaleRun()

    def update_active(self, task_id, revision, **fields):
        allowed = {"status","mode","kind","scope_mode","snapshot","plan","checkpoint","evidence","coverage","blocked_reason","error","refs"}
        if not fields.keys() <= allowed:
            raise ValueError("未知任务字段")
        with self.transaction() as db:
            self.assert_active(task_id, revision)
            encoded = [json_text(v) if isinstance(v,(dict,list)) else v for v in fields.values()]
            db.execute("UPDATE tasks SET " + ",".join(f"{k}=?" for k in fields) + ",updated=? WHERE id=?", (*encoded,now(),task_id))
