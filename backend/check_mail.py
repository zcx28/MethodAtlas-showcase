"""Persistent mail checks use real HTTP/SQLite and a controlled SMTP transaction."""
import smtplib
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from unittest.mock import patch
from zoneinfo import ZoneInfo

from .mail import ProjectMail


class Transport:
    available = True
    user = 'sender@example.com'
    site = 'https://example.com'

    def __init__(self):
        self.sent, self.prepared = [], []
        self.prepare_error = self.data_error = self.hook = None

    def prepare(self, recipient):
        self.prepared.append(recipient)
        if self.prepare_error:
            raise self.prepare_error
        if self.hook:
            self.hook()
        return self

    def data(self, content):
        self.sent.append(BytesParser(policy=policy.default).parsebytes(content))
        if self.data_error:
            raise self.data_error
        return 250, b'accepted'

    def close(self):
        pass


def check(service, request, root, project, users, owner, member, outsider):
    store, access = service.store, service.collaboration
    peer, actor = users['member@example.com'], users['owner@example.com']
    original, progress_clock = service.mail, service.progress.clock
    transport = Transport()
    moment = [datetime.now(timezone.utc)]
    mail = ProjectMail(service,transport,lambda:moment[0]); service.mail=mail
    endpoint=root+'/mail-settings'
    def options(**changes):
        value=request(endpoint,cookie=member)[1]
        return {**{key:value[key] for key in ('digest','mentions','assignments','time','revision')},**changes}
    def preference(**changes):
        response=request(endpoint,options(**changes),member)
        assert response[0]==200,response
        return response[1]
    def assign(title):
        return request(root+'/work-items',{'title':title,'assignee':peer['id']},owner)[1]['item']
    def rows():
        return store.all('SELECT * FROM mail_deliveries WHERE project_id=? AND user_id=? ORDER BY rowid',(project,peer['id']))
    try:
        with patch.object(service.progress,'zone',return_value=ZoneInfo('America/New_York')):
            assert mail.next_time(project,'02:30',datetime.fromisoformat('2026-03-08T05:00:00+00:00'))=='2026-03-08T07:30:00+00:00'
            assert mail.next_time(project,'01:30',datetime.fromisoformat('2026-11-01T05:45:00+00:00'))=='2026-11-02T06:30:00+00:00'
        assert request(endpoint,cookie=outsider)[0]==403
        assert not any(request(endpoint,cookie=member)[1][k] for k in ('digest','mentions','assignments'))
        assert request(endpoint,{**options(),'email':'foreign@example.com'},member)[0]==400
        transport.available=False
        assert request(endpoint,options(digest=True),member)[0]==400
        transport.available=True
        preference(digest=True,mentions=True,assignments=True)
        old_zone=service.progress.settings(project)['timezone']
        assert request(root+'/progress/settings',{'timezone':'America/New_York'},owner)[0]==200
        mail.enqueue()
        scheduled=store.one('SELECT * FROM mail_preferences WHERE project_id=? AND user_id=?',(project,peer['id']))
        assert scheduled['timezone']=='America/New_York' and scheduled['next_digest']==mail.next_time(project,scheduled['time'])
        assert request(root+'/progress/settings',{'timezone':old_zone},owner)[0]==200
        mail.enqueue()
        assert request(endpoint,{**options(),'revision':0},member)[0]==409
        assert not request(endpoint,cookie=owner)[1]['digest'],'one member subscribed everyone'
        assign('邮件任务通知')
        mail.enqueue(); mail.enqueue()
        assert len(rows())==1
        preference(time='09:00')
        assert len(rows())==1 and rows()[0]['status']=='pending', 'time change discarded a queued alert'
        mail.tick(); mail.tick()
        assert len(transport.sent)==1 and rows()[0]['status']=='sent'
        message=transport.sent[0]
        assert str(message['To'])==peer['email'] and '邮件任务通知' in message.get_content()
        assert 'SMTP' not in message.get_content()
        assign('修改时间前尚未入队')
        preference(time='10:00'); mail.tick()
        assert rows()[-1]['status']=='sent' and '修改时间前尚未入队' in transport.sent[-1].get_content(), 'setting change skipped an unseen assignment'
        # Definitive pre-DATA failures retry after backoff, without storing server text.
        assign('可重试发送')
        transport.prepare_error=OSError('SECRET_SERVER_CANARY')
        mail.tick(); failed=rows()[-1]
        assert failed['status']=='pending' and failed['attempts']==1
        mail.tick(); assert rows()[-1]['attempts']==1
        assert 'CANARY' not in str(request(endpoint,cookie=member)[1])
        moment[0]+=timedelta(minutes=2); transport.prepare_error=None
        mail.tick(); assert rows()[-1]['status']=='sent'
        # An accepted message with lost acknowledgement is not automatically replayed.
        assign('确认可能丢失')
        transport.data_error=ConnectionError('SMTP_RESPONSE_SECRET')
        mail.tick(); uncertain=rows()[-1]; count=len(transport.sent)
        assert uncertain['status']=='uncertain'
        moment[0]+=timedelta(hours=1); mail.tick(); assert len(transport.sent)==count
        assert request(endpoint+'/retry',{'id':uncertain['id']},member)[0]==400
        assert request(endpoint+'/retry',{'id':uncertain['id'],'confirm_resend':True},owner)[0]==403
        assert request(endpoint+'/retry',{'id':uncertain['id'],'confirm_resend':True},member)[0]==200
        transport.data_error=None; mail.tick()
        assert rows()[-1]['status']=='sent' and len(transport.sent)==count+1
        assert str(transport.sent[-1]['Message-ID'])==str(transport.sent[-2]['Message-ID'])
        # Explicit permanent rejection is not a retry storm.
        assign('地址拒收'); transport.prepare_error=smtplib.SMTPResponseException(550,b'PRIVATE_RESPONSE')
        mail.tick(); assert rows()[-1]['status']=='failed'
        transport.prepare_error=None
        # No body crosses DATA if access is revoked after connection preparation.
        assign('连接期间归档'); mail.enqueue(); count=len(transport.sent)
        transport.hook=lambda:access.manage(actor,project,'archive',{})
        mail.tick(); transport.hook=None
        assert rows()[-1]['status']=='cancelled' and len(transport.sent)==count
        assert request(endpoint,options(digest=False,mentions=False,assignments=False),member)[0]==200, 'archived project prevented opting out'
        access.manage(actor,project,'unarchive',{})
        preference(digest=True,mentions=True,assignments=True)
        # Opt-out invalidates pending deliveries before transmission.
        assign('退订前排队'); mail.enqueue()
        preference(digest=False,mentions=False,assignments=False)
        mail.tick(); assert rows()[-1]['status']=='cancelled' and len(transport.sent)==count
        preference(digest=True,mentions=True,assignments=True)
        # Digest includes latest fixed review versions, not an additional model call.
        service.progress.clock=lambda:moment[0]
        moment[0]+=timedelta(seconds=1)
        published=service.progress.publish(project,'2026-09-25','# 邮件回顾\nDIGEST_SHARED_TEXT','human',None,[],[],user=actor)
        service.progress.publish(project,'2026-09-25','# 邮件回顾\nDIGEST_LATEST_TEXT','human',published['id'],[],[],user=actor)
        pref=store.one('SELECT * FROM mail_preferences WHERE project_id=? AND user_id=?',(project,peer['id']))
        moment[0]=datetime.fromisoformat(pref['next_digest'])+timedelta(seconds=1)
        mail.tick(); digest=rows()[-1]
        assert digest['kind']=='digest' and digest['status']=='sent',dict(digest)
        assert 'DIGEST_LATEST_TEXT' in transport.sent[-1].get_content() and 'DIGEST_SHARED_TEXT' not in transport.sent[-1].get_content()
        count=len(transport.sent); mail.tick(); assert len(transport.sent)==count
        mentioned=request(root+'/artifacts/'+published['artifact_id']+'/comments',{'request_id':'mail-mention','version_id':published['id'],'text':'@member@example.com 请检查回顾','mentions':[peer['id']]},owner)
        assert mentioned[0]==201,mentioned
        mail.tick()
        assert rows()[-1]['kind']=='comment_mentioned' and rows()[-1]['status']=='sent'
        assert '评论中有人提到了你' in str(transport.sent[-1]['Subject'])
        count=len(transport.sent)
        # New private scope before DATA suppresses the whole message.
        moment[0]+=timedelta(seconds=1)
        private=service.progress.publish(project,'2026-09-24','# 私人来源摘要\nPRIVATE_MAIL_CANARY','human',None,[],[],user=actor)
        pref=store.one('SELECT * FROM mail_preferences WHERE project_id=? AND user_id=?',(project,peer['id']))
        moment[0]=datetime.fromisoformat(pref['next_digest'])+timedelta(seconds=1)
        mail.enqueue()
        store.run("INSERT OR REPLACE INTO artifact_scopes VALUES(?,?,'private')",(private['artifact_id'],actor['id']))
        mail.tick()
        # Other review fixtures contain future-dated shared reports; those may still send.
        assert all('PRIVATE_MAIL_CANARY' not in m.get_content() for m in transport.sent)
        with store.transaction() as db:
            mail.add(db,pref,'digest',[private['id']],'private-only-check')
        mail.tick(); assert rows()[-1]['status']=='cancelled',dict(rows()[-1])
        count=len(transport.sent)
        store.run("UPDATE artifact_scopes SET visibility='shared' WHERE artifact_id=?",(private['artifact_id'],))
        # Restart only reclaims preparation; DATA ambiguity remains manual.
        assign('重启前准备'); mail.enqueue(); prepared=rows()[-1]['id']
        assign('重启前正文'); mail.enqueue(); sending=rows()[-1]['id']
        store.run("UPDATE mail_deliveries SET status='preparing' WHERE id=?",(prepared,))
        store.run("UPDATE mail_deliveries SET status='sending' WHERE id=?",(sending,))
        mail=ProjectMail(service,transport,lambda:moment[0]); service.mail=mail
        assert store.one('SELECT status FROM mail_deliveries WHERE id=?',(prepared,))['status']=='pending'
        assert store.one('SELECT status FROM mail_deliveries WHERE id=?',(sending,))['status']=='uncertain'
        # Removing and rejoining cannot resurrect subscriptions or queued notices.
        access.manage(actor,project,'remove-member',{'user_id':peer['id']})
        assert request(endpoint,cookie=member)[0]==403
        mail.tick(); assert len(transport.sent)==count
        access.accept(peer,access.invite(actor,project,{'email':peer['email']}))
        assert not any(request(endpoint,cookie=member)[1][k] for k in ('digest','mentions','assignments'))
        assert all(r['status'] not in ('pending','preparing','sending','uncertain') for r in rows())
        print('PASS: self-only opt-in mail, persistent deduplication, backoff, ambiguous SMTP/manual resend, archive/revocation/opt-out fences, private digest filtering and restart states')
    finally:
        service.mail=original; service.progress.clock=progress_clock
        store.run('DELETE FROM mail_deliveries WHERE project_id=?',(project,))
        store.run('DELETE FROM mail_preferences WHERE project_id=?',(project,))
