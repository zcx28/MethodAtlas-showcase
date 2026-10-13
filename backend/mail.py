"""Opt-in project mail, derived from existing notifications and fixed review versions."""
import hashlib
import json
import os
import re
import smtplib
import ssl
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email import policy
from urllib.parse import urlsplit

from .auth import email_address
from .errors import AppError, record_error
from .state import json_text


class SMTPTransport:
    def __init__(self):
        self.host = os.getenv('SMTP_HOST', '')
        self.port = int(os.getenv('SMTP_PORT', '465'))
        self.security = os.getenv('SMTP_SECURITY', 'implicit_tls')
        self.user = os.getenv('SMTP_USER', '')
        self.password = os.getenv('SMTP_PASSWORD', '')
        self.site = os.getenv('METHODATLAS_PUBLIC_URL', '').rstrip('/')
        url = urlsplit(self.site)
        self.available = bool(self.host and self.user and self.password and url.scheme == 'https'
                              and url.hostname and not (url.username or url.password or url.path or url.query or url.fragment)
                              and self.security in ('implicit_tls', 'starttls'))
        if self.available:
            email_address(self.user)

    def prepare(self, recipient):
        if not self.available:
            raise RuntimeError('mail_unconfigured')
        client = None
        try:
            context = ssl.create_default_context()
            if self.security == 'implicit_tls':
                client = smtplib.SMTP_SSL(self.host, self.port, timeout=20, context=context)
            else:
                client = smtplib.SMTP(self.host, self.port, timeout=20)
                client.ehlo()
                client.starttls(context=context)
            client.ehlo()
            client.login(self.user, self.password)
            code, _ = client.mail(self.user)
            if code != 250:
                raise smtplib.SMTPSenderRefused(code, b'rejected', self.user)
            code, _ = client.rcpt(recipient)
            if code not in (250, 251):
                raise smtplib.SMTPResponseException(code, b'rejected')
            return client
        except BaseException:
            if client:
                client.close()
            raise


class ProjectMail:
    def __init__(self, service, transport=None, clock=None):
        self.service, self.store, self.access = service, service.store, service.collaboration
        self.transport = transport or SMTPTransport()
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.stop, self.thread, self.running = threading.Event(), None, threading.Lock()
        with self.store.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS mail_preferences(
                    project_id TEXT NOT NULL,user_id TEXT NOT NULL,email TEXT NOT NULL,
                    digest INTEGER NOT NULL,mentions INTEGER NOT NULL,assignments INTEGER NOT NULL,
                    time TEXT NOT NULL,revision INTEGER NOT NULL,notice_cursor INTEGER NOT NULL,
                    digest_since TEXT NOT NULL,next_digest TEXT NOT NULL,
                    PRIMARY KEY(project_id,user_id));
                CREATE TABLE IF NOT EXISTS mail_deliveries(
                    id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id TEXT NOT NULL,email TEXT NOT NULL,
                    preference_revision INTEGER NOT NULL,kind TEXT NOT NULL,sources TEXT NOT NULL,
                    status TEXT NOT NULL,attempts INTEGER NOT NULL,created TEXT NOT NULL,
                    next_attempt TEXT NOT NULL,finished TEXT,error TEXT);
                CREATE INDEX IF NOT EXISTS mail_due ON mail_deliveries(status,next_attempt);
                CREATE INDEX IF NOT EXISTS mail_recipient ON mail_deliveries(project_id,user_id,created);
            ''')
            if 'timezone' not in {r['name'] for r in db.execute('PRAGMA table_info(mail_preferences)')}:
                db.execute("ALTER TABLE mail_preferences ADD COLUMN timezone TEXT NOT NULL DEFAULT ''")
            for name in ('mentions_cursor','assignments_cursor'):
                if name not in {r['name'] for r in db.execute('PRAGMA table_info(mail_preferences)')}:
                    db.execute(f'ALTER TABLE mail_preferences ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0')
                    db.execute(f'UPDATE mail_preferences SET {name}=notice_cursor')
            # Single application process: interrupted preparation has not issued DATA.
            db.execute("UPDATE mail_deliveries SET status='pending' WHERE status='preparing'")
            db.execute("UPDATE mail_deliveries SET status='uncertain',error='delivery_unknown' WHERE status='sending'")

    def stamp(self):
        return self.clock().astimezone(timezone.utc).isoformat()

    def next_time(self, project, value, after=None):
        moment = (after or self.clock()).astimezone(self.service.progress.zone(project))
        hour, minute = map(int, value.split(':'))
        day = moment.date()
        for _ in range(3):
            candidate = datetime.combine(day, datetime.min.time(), moment.tzinfo).replace(hour=hour, minute=minute)
            # Round-trip moves nonexistent DST times to the first corresponding valid instant.
            candidate = candidate.astimezone(timezone.utc).astimezone(moment.tzinfo)
            if candidate.astimezone(timezone.utc) > moment.astimezone(timezone.utc):
                return candidate.astimezone(timezone.utc).isoformat()
            day += timedelta(days=1)
        raise ValueError('无法计算邮件时间')

    def settings(self, user, project, body=None):
        with self.store.transaction() as db:
            self.access.project(user, project)
            row = db.execute('SELECT * FROM mail_preferences WHERE project_id=? AND user_id=?',(project,user['id'])).fetchone()
            current = dict(row) if row else {'digest':0,'mentions':0,'assignments':0,'time':'08:00','revision':0}
            if body is not None:
                if not isinstance(body,dict) or set(body) != {'digest','mentions','assignments','time','revision'}:
                    raise ValueError('邮件订阅设置无效')
                if any(type(body[k]) is not bool for k in ('digest','mentions','assignments')) or not isinstance(body['time'],str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',body['time']):
                    raise ValueError('邮件订阅时间或选项无效')
                if type(body['revision']) is not int or body['revision'] != current['revision']:
                    raise AppError('conflict','邮件订阅已更改，请重新打开后保存')
                if any(body[k] for k in ('digest','mentions','assignments')) and not self.transport.available:
                    raise ValueError('管理员尚未配置项目邮件服务')
                if any(body[k] for k in ('digest','mentions','assignments')):
                    self.access.project(user,project,write=True)
                cursor = db.execute('SELECT COALESCE(MAX(rowid),0) AS n FROM project_notifications').fetchone()['n']
                stamp = self.stamp()
                same_email = row and row['email']==user['email']
                since = row['digest_since'] if same_email and row['digest'] and body['digest'] else stamp
                cursors = [row[key+'_cursor'] if same_email and row[key] and body[key] else cursor for key in ('mentions','assignments')]
                zone = self.service.progress.settings(project)['timezone']
                next_digest = row['next_digest'] if same_email and row['digest'] and body['digest'] and row['time']==body['time'] and row['timezone']==zone else self.next_time(project,body['time'])
                db.execute('INSERT INTO mail_preferences VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET email=excluded.email,digest=excluded.digest,mentions=excluded.mentions,assignments=excluded.assignments,time=excluded.time,revision=excluded.revision,notice_cursor=excluded.notice_cursor,digest_since=excluded.digest_since,next_digest=excluded.next_digest,timezone=excluded.timezone,mentions_cursor=excluded.mentions_cursor,assignments_cursor=excluded.assignments_cursor',
                           (project,user['id'],user['email'],int(body['digest']),int(body['mentions']),int(body['assignments']),body['time'],current['revision']+1,cursor,since,next_digest,zone,*cursors))
                for kind,key in (('digest','digest'),('comment_mentioned','mentions'),('task_assigned','assignments')):
                    args = (project,user['id'],kind)
                    if same_email and body[key]:
                        db.execute("UPDATE mail_deliveries SET preference_revision=? WHERE project_id=? AND user_id=? AND kind=? AND status IN ('pending','preparing','failed','uncertain')",(current['revision']+1,*args))
                    else:
                        db.execute("UPDATE mail_deliveries SET status='cancelled',error='subscription_changed',finished=? WHERE project_id=? AND user_id=? AND kind=? AND status IN ('pending','preparing','failed','uncertain')",(stamp,*args))
                current = {**body,'revision':current['revision']+1}
            history = [dict(r) for r in db.execute('SELECT id,kind,status,attempts,created,finished,error FROM mail_deliveries WHERE project_id=? AND user_id=? ORDER BY created DESC,id DESC LIMIT 30',(project,user['id']))]
            return {**{k:bool(current[k]) for k in ('digest','mentions','assignments')},'time':current['time'],
                    'revision':current['revision'],'available':self.transport.available,'email':user['email'],
                    'timezone':self.service.progress.settings(project)['timezone'],'deliveries':history}

    def authorized(self, db, row):
        pref = db.execute('SELECT * FROM mail_preferences WHERE project_id=? AND user_id=?',(row['project_id'],row['user_id'])).fetchone()
        account = db.execute('SELECT id,email FROM collab_users WHERE id=?',(row['user_id'],)).fetchone()
        if not pref or not account or account['email'] != row['email'] or pref['email'] != row['email'] or pref['revision'] != row['preference_revision']:
            return None
        key = {'digest':'digest','comment_mentioned':'mentions','task_assigned':'assignments'}[row['kind']]
        if not pref[key]:
            return None
        user = dict(account)
        try:
            self.access.project(user,row['project_id'],write=True)
        except PermissionError:
            return None
        return user

    def enqueue(self):
        if not self.access.online:
            return
        with self.store.transaction() as db:
            for pref in db.execute('SELECT * FROM mail_preferences WHERE digest=1 OR mentions=1 OR assignments=1').fetchall():
                pref = dict(pref)
                sample = {**dict(pref),'preference_revision':pref['revision'],'kind':'digest' if pref['digest'] else 'comment_mentioned' if pref['mentions'] else 'task_assigned'}
                user = self.authorized(db,sample)
                if not user:
                    continue
                zone = self.service.progress.settings(pref['project_id'])['timezone']
                if pref['timezone'] != zone:
                    pref['next_digest'] = self.next_time(pref['project_id'],pref['time'])
                    db.execute('UPDATE mail_preferences SET timezone=?,next_digest=? WHERE project_id=? AND user_id=?',(zone,pref['next_digest'],pref['project_id'],pref['user_id']))
                for kind,key in (('comment_mentioned','mentions'),('task_assigned','assignments')):
                    if not pref[key]:
                        continue
                    notices = db.execute('SELECT rowid AS seq,* FROM project_notifications WHERE project_id=? AND recipient=? AND kind=? AND rowid>? ORDER BY rowid LIMIT 100',(pref['project_id'],pref['user_id'],kind,pref[key+'_cursor'])).fetchall()
                    for notice in notices:
                        if self.service.project_work.notification_item(db,user,pref['project_id'],notice):
                            self.add(db,pref,notice['kind'],[notice['id']],notice['id'])
                    if notices:
                        db.execute(f'UPDATE mail_preferences SET {key}_cursor=? WHERE project_id=? AND user_id=?',(notices[-1]['seq'],pref['project_id'],pref['user_id']))
                if pref['digest'] and pref['next_digest'] <= self.stamp():
                    # One catch-up summary, not a burst of one email for every offline day.
                    versions = db.execute("SELECT v.id,v.artifact_id FROM project_notifications n JOIN artifact_versions v ON v.id=n.entity_id WHERE n.project_id=? AND n.recipient=? AND n.kind='review_published' AND n.created>? AND n.created<=? ORDER BY v.version_no DESC,n.created DESC",(pref['project_id'],pref['user_id'],pref['digest_since'],self.stamp())).fetchall()
                    selected, seen = [], set()
                    for version in versions:
                        if version['artifact_id'] not in seen:
                            seen.add(version['artifact_id']); selected.append(version['id'])
                    if selected:
                        self.add(db,pref,'digest',selected,pref['next_digest'])
                    db.execute('UPDATE mail_preferences SET digest_since=?,next_digest=? WHERE project_id=? AND user_id=?',(self.stamp(),self.next_time(pref['project_id'],pref['time']),pref['project_id'],pref['user_id']))

    def add(self, db, pref, kind, sources, key):
        ident = hashlib.sha256(json_text([pref['project_id'],pref['user_id'],pref['revision'],kind,key]).encode()).hexdigest()
        stamp = self.stamp()
        db.execute("INSERT OR IGNORE INTO mail_deliveries VALUES(?,?,?,?,?,?,?,'pending',0,?,?,NULL,NULL)",
                   (ident,pref['project_id'],pref['user_id'],pref['email'],pref['revision'],kind,json_text(sources),stamp,stamp))

    def message(self, db, row, user):
        sections = []
        if row['kind']=='digest':
            for ident in json.loads(row['sources']):
                version = db.execute("SELECT v.*,a.project_id FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id JOIN progress_days d ON d.artifact_id=a.id WHERE v.id=? AND a.project_id=? AND d.deleted=0",(ident,row['project_id'])).fetchone()
                if version and self.access.shared_metadata({'artifact_id':version['artifact_id']}) and self.access.visible(user,'artifact',version['artifact_id']):
                    sections.append(version['title']+'\n'+version['body'][:10000]+('\n（正文较长，全文请在项目中查看。）' if len(version['body'])>10000 else ''))
            title = '项目研究回顾摘要'
        else:
            for ident in json.loads(row['sources']):
                notice = db.execute('SELECT * FROM project_notifications WHERE id=? AND recipient=? AND project_id=?',(ident,user['id'],row['project_id'])).fetchone()
                item = self.service.project_work.notification_item(db,user,row['project_id'],notice) if notice else None
                if item:
                    sections.append(item['title'])
            title = '评论中有人提到了你' if row['kind']=='comment_mentioned' else '你收到了研究任务分配'
        if not sections:
            return None
        project = db.execute('SELECT name FROM projects WHERE id=?',(row['project_id'],)).fetchone()
        body = '\n\n'.join(sections[:20])
        if len(sections)>20:
            body += f'\n\n另有 {len(sections)-20} 篇回顾，请在项目中查看。'
        body = re.sub(r'\[cite:[^\]]+\]', '[依据见项目原文]', body)
        message = EmailMessage()
        message['From'] = self.transport.user
        message['To'] = row['email']
        message['Subject'] = 'MethodAtlas · '+title
        message['Message-ID'] = '<'+row['id']+'@'+urlsplit(self.transport.site).hostname+'>'
        message['Date'] = self.clock()
        message.set_content(f"{project['name']}\n{title}\n\n{body}\n\n打开工作台：{self.transport.site}\n进入项目 → 通知 → 邮件订阅，可调整或关闭此类邮件。\n")
        return message

    def retry(self, user, project, body):
        if not isinstance(body,dict) or set(body)-{'id','confirm_resend'} or not isinstance(body.get('id'),str) or len(body['id'])>100 or ('confirm_resend' in body and type(body['confirm_resend']) is not bool):
            raise ValueError('邮件重试请求无效')
        with self.store.transaction() as db:
            self.access.project(user,project)
            row = db.execute('SELECT * FROM mail_deliveries WHERE id=? AND project_id=? AND user_id=?',(body.get('id'),project,user['id'])).fetchone()
            if not row or not self.authorized(db,row):
                raise PermissionError('这封邮件不可重试')
            if row['status']=='uncertain' and body.get('confirm_resend') is not True:
                raise ValueError('上一封可能已送达；确认可能重复后才可重发')
            if row['status'] in ('failed','uncertain'):
                db.execute("UPDATE mail_deliveries SET status='pending',next_attempt=?,error=NULL,finished=NULL WHERE id=?",(self.stamp(),row['id']))
            return self.settings(user,project)

    def fail(self, ident, error, uncertain=False):
        # Never save SMTP responses: they can contain credentials or message contents.
        code = getattr(error,'smtp_code',None)
        row = self.store.one('SELECT * FROM mail_deliveries WHERE id=?',(ident,))
        permanent = isinstance(code,int) and code>=500
        status = 'uncertain' if uncertain else 'failed' if permanent or row['attempts']>=6 else 'pending'
        reason = 'delivery_unknown' if uncertain else 'mail_rejected' if permanent else 'mail_unavailable'
        retry = self.clock()+timedelta(seconds=min(3600,60*2**min(row['attempts']-1,6)))
        self.store.run('UPDATE mail_deliveries SET status=?,error=?,next_attempt=?,finished=? WHERE id=? AND status IN (\'preparing\',\'sending\')',(status,reason,retry.astimezone(timezone.utc).isoformat(),self.stamp() if status!='pending' else None,ident))

    def deliver(self, ident):
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM mail_deliveries WHERE id=? AND status='pending' AND next_attempt<=?",(ident,self.stamp())).fetchone()
            if not row:
                return
            if not self.authorized(db,row):
                db.execute("UPDATE mail_deliveries SET status='cancelled',finished=?,error='access_changed' WHERE id=?",(self.stamp(),ident)); return
            db.execute("UPDATE mail_deliveries SET status='preparing',attempts=attempts+1 WHERE id=?",(ident,))
        client = None
        try:
            client = self.transport.prepare(row['email'])
        except Exception as error:
            self.fail(ident,error); return
        try:
            # Recheck after TLS/authentication. Serialize the final DATA disclosure with
            # membership/privacy writes; no transaction remains open across the network.
            with self.store.lock:
                fresh = self.store.one('SELECT * FROM mail_deliveries WHERE id=?',(ident,))
                user = self.authorized(self.store.db,fresh)
                message = self.message(self.store.db,fresh,user) if user and fresh['status']=='preparing' else None
                if not message:
                    self.store.run("UPDATE mail_deliveries SET status='cancelled',finished=?,error='access_changed' WHERE id=? AND status='preparing'",(self.stamp(),ident)); return
                self.store.run("UPDATE mail_deliveries SET status='sending' WHERE id=?",(ident,))
                try:
                    code, _ = client.data(message.as_bytes(policy=policy.SMTP))
                    if code != 250:
                        raise smtplib.SMTPDataError(code,b'rejected')
                except smtplib.SMTPResponseException as error:
                    self.fail(ident,error)
                except Exception as error:
                    self.fail(ident,error,uncertain=True)
                else:
                    self.store.run("UPDATE mail_deliveries SET status='sent',finished=?,error=NULL WHERE id=?",(self.stamp(),ident))
        except Exception as error:
            current = self.store.one('SELECT status FROM mail_deliveries WHERE id=?',(ident,))
            if current and current['status'] in ('preparing','sending'):
                self.fail(ident,error,uncertain=current['status']=='sending')
        finally:
            client.close()

    def tick(self):
        if not self.access.online or not self.transport.available or not self.running.acquire(blocking=False):
            return
        try:
            self.enqueue()
            for row in self.store.all("SELECT id FROM mail_deliveries WHERE status='pending' AND next_attempt<=? ORDER BY created,id LIMIT 20",(self.stamp(),)):
                if self.stop.is_set():
                    break
                self.deliver(row['id'])
        finally:
            self.running.release()

    def start(self):
        if not self.access.online or not self.transport.available or self.thread:
            return
        def loop():
            while not self.stop.is_set():
                try:
                    self.tick()
                except Exception as error:
                    # In-flight markers remain conservative; log no provider responses.
                    record_error(self.store,RuntimeError('项目邮件后台运行失败'),operation='project_mail_schedule',error_type=type(error).__name__)
                self.stop.wait(15)
        self.thread=threading.Thread(target=loop,name='project-mail',daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join()
