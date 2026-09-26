"""Offline regression: duplicate evidence, runaway verification retries, auto reasoning."""
import sqlite3
from contextlib import nullcontext
from types import SimpleNamespace
from .paper_research import verify_claims
from .audit import complete as audit_complete
from .research_context import References, model_view
from .files import render_file
from .settings import effort_for
from .state import json_text, canonical_citation_id


def main():
    failures = []
    config = {'efforts':['off','low','high']}
    assert effort_for(config, {'effort':'auto'}, 'delivery-review') == 'off'
    assert effort_for(config, {'effort':'off'}, 'delivery-review') == 'off'
    for role in ('main','verify','audit-review','vision-read','research-synthesis','research-supplement'):
        if effort_for(config, {'effort':'auto'}, role) != 'off':
            failures.append(role + ': auto unexpectedly enables billed reasoning')
        assert effort_for(config, {'effort':'high'}, role) == 'high'
    citation = {'id':'cite_'+'1'*32,'paper_id':'paper','paper_version_id':'version','page':1,'block':1,'quote':'Unique source. '*1000}
    db = sqlite3.connect(':memory:'); db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE claim_checks(project_id TEXT,cache_key TEXT,result TEXT,PRIMARY KEY(project_id,cache_key))')
    requests = []
    def complete(task, system, context, role, **kwargs):
        requests.append(context)
        return {'verdicts':[{'index':c['index'],'supported':False,'reason':'Not supported'} for c in context['claims']]}
    tools = SimpleNamespace(task={'id':'cost','revision':0},project='p',conversation='c',references=References(),
        store=SimpleNamespace(citation=lambda *a:citation,one=lambda q,a:db.execute(q,a).fetchone(),transaction=lambda:nullcontext(db),assert_active=lambda *a:None),
        read_evidence=lambda ids:{'evidence':[citation for _ in ids]},research=SimpleNamespace(complete=complete))
    claims = [{'text':f'Distinct claim {i}', 'citation_ids':[citation['id']]} for i in range(8)]
    verdicts = verify_claims(tools,claims)['verdicts']
    assert len(verdicts)==8 and not any(v['supported'] for v in verdicts)
    chars = sum(len(json_text(r)) for r in requests)
    if len(requests)!=1 or chars>16000:
        failures.append(f'Repeated evidence: {len(requests)} calls, {chars} characters for one {len(citation['quote'])}-character source')
    before=len(requests); verify_claims(tools,claims)
    assert len(requests)==before,'Cache missed identical checks'
    db.execute('DELETE FROM claim_checks'); requests.clear()
    def exhausted(task, system, context, role, **kwargs):
        requests.append(context)
        if len(context['claims'])>1: raise ValueError('Harness 未正常完成：max-tokens')
        return {'verdicts':[{'index':context['claims'][0]['index'],'supported':False,'reason':'uncertain'}]}
    tools.research.complete=exhausted
    try: verify_claims(tools,claims[:4])
    except ValueError: pass
    if len(requests)!=1: failures.append(f'Output exhaustion retried automatically {len(requests)} times')
    if canonical_citation_id('cite:'+'1'*32)!=citation['id']:
        failures.append('Exact citation prefix typo requires a paid repair')
    retries = []
    def malformed(*args, **kwargs):
        retries.append(1)
        raise ValueError('回答格式不完整，请重新发送；已有内容已保留。')
    try: audit_complete(SimpleNamespace(complete=malformed,store=SimpleNamespace(event=lambda *a:None)),{'id':'test'},'',{},'audit-review',8192)
    except ValueError: pass
    if len(retries)!=1: failures.append('Malformed audit regenerated whole report')
    source={**citation,'title':'Source','quote':'UNNEEDED_FULL_SOURCE'}
    raw,_=render_file('html','Report','<p>Report body</p>',[source])
    view=model_view('read_file',{'id':'v','artifact_id':'a','title':'Report','kind':'html','version_no':1,'body':raw.decode(),'citations':[source]},References())
    if source['quote'] in view['body']: failures.append('Reading report resends its full citation appendix')
    assert source['quote'] in raw.decode(), 'Offline source navigation must retain evidence'
    db.close()
    assert not failures, '\n'.join(failures)
    print(f'PASS: 8 checks share one source ({chars} characters), cache reuse, one attempt on exhaustion, auto off / explicit high retained, exact citation normalization')

if __name__=='__main__': main()
