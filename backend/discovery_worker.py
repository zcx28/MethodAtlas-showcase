"""Isolated GPT Researcher; API abstracts stay unconfirmed candidate content."""
import asyncio
import json
import os
from pathlib import Path
import re
import shlex
import sys
import threading
import time
from datetime import date
from types import SimpleNamespace
from .errors import failure_message


def worker_error(error, destination):
    store = SimpleNamespace(root=destination.parent.parent, lock=threading.RLock())
    return failure_message(store, error, operation="discovery_worker", search_run=destination.parent.name)


def model_config():
    chosen = json.loads(os.getenv('METHODATLAS_MODEL_CONFIG','null') or 'null')
    model = chosen['model'] if chosen else os.getenv('DEEPSEEK_MODEL','deepseek-v4-pro')
    provider = 'openai' if chosen else 'deepseek'
    config = {key:provider+':'+model for key in ('FAST_LLM','SMART_LLM','STRATEGIC_LLM')}
    config['LLM_KWARGS'] = {'timeout':90,'max_retries':1}
    if chosen:
        # GPT Researcher gives environment variables precedence over its JSON file.
        for key in (*config,'LLM_PROVIDER','FAST_LLM_MODEL','SMART_LLM_MODEL','REASONING_EFFORT'):
            os.environ.pop(key,None)
        os.environ.update(OPENAI_API_KEY=chosen['api_key'] or 'local-no-key',OPENAI_BASE_URL=chosen['base_url'])
        config['LLM_KWARGS']['openai_api_base'] = chosen['base_url']
        if chosen['selected_effort'] != 'off':
            os.environ['REASONING_EFFORT'] = chosen['selected_effort']
            config['LLM_KWARGS']['reasoning_effort'] = chosen['selected_effort']
        if chosen['protocol'] == 'deepseek':
            config['LLM_KWARGS']['extra_body'] = {'thinking':{'type':'disabled' if chosen['selected_effort']=='off' else 'enabled'}}
    return config


def arxiv_query(query):
    if re.search(r'\b(?:all|ti|au|abs|cat):',query):
        return query  # Preserve explicit arXiv queries produced by deep research.
    terms = shlex.shlex(query,posix=True)
    terms.whitespace_split, terms.quotes, terms.commenters = True, '"', ''
    return ' AND '.join('all:' + json.dumps(term,ensure_ascii=False) for term in terms)


async def run(query, destination, bounded=False, quick=None):
    if quick is not None:
        # Load the installed, pinned retrievers without GPT Researcher's ML/agent startup.
        import importlib.util
        import runpy
        package = Path(next(iter(importlib.util.find_spec('gpt_researcher').submodule_search_locations)))
        OpenAlexSearch = runpy.run_path(str(package/'retrievers/openalex/openalex.py'))['OpenAlexSearch']
        ArxivSearch = runpy.run_path(str(package/'retrievers/arxiv/arxiv.py'))['ArxivSearch']
    else:
        from gpt_researcher import GPTResearcher
        import gpt_researcher.agent as agent
        from gpt_researcher.retrievers.openalex.openalex import OpenAlexSearch
        from gpt_researcher.retrievers.arxiv.arxiv import ArxivSearch
        from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
    import arxiv
    import requests
    from .literature import _validate_public_url

    candidates, sources, calls = [], [], []
    started = time.monotonic()
    output = {'warning':'自动调研进行中；中断时仅保留已完成来源和调用。'}
    save_lock = threading.Lock()
    def save():
        with save_lock:
            output.update(candidates=candidates,sources=sources,usage={'calls':calls,'seconds':round(time.monotonic()-started,3)})
            pending = destination.with_suffix('.pending')
            pending.write_text(json.dumps(output,ensure_ascii=False),encoding='utf-8')
            pending.replace(destination)
    original_get = requests.get
    original_results = arxiv.Client.results
    original_chat = GenericLLMProvider.get_chat_response if quick is None else None

    def capture_get(url, **kwargs):
        if url != OpenAlexSearch.BASE_URL:
            return original_get(url, **kwargs)
        record = {'source':'openalex','query':kwargs.get('params', {}).get('search', '')}
        kwargs.setdefault('params', {})['filter'] = 'to_publication_date:' + date.today().isoformat()
        if quick and quick.get('from_date'):
            kwargs['params']['filter'] = f"from_publication_date:{quick['from_date']},to_publication_date:{quick['to_date']}"
            kwargs['params']['per_page'] = quick['max_results']
            # The hard date window already guarantees recency; rank within it by topic relevance.
            kwargs['params']['sort'] = 'relevance_score:desc'
            record.update(from_date=quick['from_date'], to_date=quick['to_date'])
        try:
            _validate_public_url(url)
            response = original_get(url, **kwargs)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data.get('results'),list):
                raise ValueError('OpenAlex 返回格式无效')
            for item in data['results']:
                location = item.get('best_oa_location') or item.get('primary_location') or {}
                candidates.append({'source':'openalex','external_id':item['id'],'title':item.get('title') or '',
                    'doi':item.get('doi') or '', 'publication_type':item.get('type'),
                    'source_version':location.get('version'), 'authors':[a['author']['display_name'] for a in item.get('authorships',[])],
                    'published':item.get('publication_date') or '', 'updated':item.get('updated_date') or '', 'url':item.get('doi') or location.get('landing_page_url') or item['id'],
                    'pdf_url':location.get('pdf_url'),
                    'fulltext_locations':[{'pdf_url':loc['pdf_url'], 'source_version':loc.get('version'),
                        'url':loc.get('landing_page_url'), 'source':'openalex'}
                        for loc in item.get('locations', []) if loc.get('pdf_url')],
                    'aliases':[loc['landing_page_url'] for loc in item.get('locations', []) if loc.get('landing_page_url')],
                    'summary':OpenAlexSearch._reconstruct_abstract(item.get('abstract_inverted_index')) or ''})
            record.update(status='succeeded',count=len(data['results']))
            if quick and quick.get('from_date'):
                record.update(total=data.get('meta',{}).get('count'), truncated=data.get('meta',{}).get('count',0) > len(data['results']))
            return response
        except Exception as error:
            status = getattr(getattr(error,'response',None),'status_code',None)
            record.update(status='failed',error=worker_error(error, destination))
            raise
        finally:
            sources.append(record)
            save()

    def capture_arxiv(client, search, offset=0):
        from functools import partial
        record = {'source':'arxiv','query':next((q for q in quick['queries'] if arxiv_query(q) == search.query),search.query) if quick is not None else search.query,
                  'api_query':search.query}
        if quick and quick.get('from_date'):
            search.query += ' AND submittedDate:[' + quick['from_date'].replace('-','') + '0000 TO ' + quick['to_date'].replace('-','') + '2359]'
            record.update(api_query=search.query, from_date=quick['from_date'], to_date=quick['to_date'])
        client.delay_seconds, client.num_retries, client.page_size = 3, 1, quick.get('max_results',6) if quick else 6
        client._session.get = partial(client._session.get, timeout=20)
        count = 0
        try:
            for result in original_results(client,search,offset):
                count += 1
                candidates.append({'source':'arxiv','external_id':result.get_short_id(),'title':result.title,
                    'authors':[str(a) for a in result.authors], 'published':result.published.isoformat(),
                    'updated':result.updated.isoformat(),'summary':result.summary, 'doi':result.doi or '',
                    'url':result.entry_id.replace('http:','https:'),'pdf_url':result.pdf_url.replace('http:','https:') if result.pdf_url else None})
                yield result
            record.update(status='succeeded',count=count)
            if quick and quick.get('from_date'):
                record['truncated'] = count >= quick['max_results']
        except Exception as error:
            status = getattr(error,'status',None)
            record.update(status='failed',error=worker_error(error, destination))
            raise
        finally:
            sources.append(record)
            save()

    async def tracked_chat(provider, *args, **kwargs):
        began = time.monotonic()
        record = {'model':json.loads(os.getenv('METHODATLAS_MODEL_CONFIG','null') or 'null').get('model') if os.getenv('METHODATLAS_MODEL_CONFIG') else os.getenv('DEEPSEEK_MODEL','deepseek-v4-pro')}
        try:
            answer = await original_chat(provider,*args,**kwargs)
            record.update(status='succeeded',tokens=provider.last_usage_metadata)
            return answer
        except Exception as error:
            record.update(status='failed',error=worker_error(error, destination))
            raise
        finally:
            record['seconds'] = round(time.monotonic()-began,3)
            calls.append(record)
            save()

    class AcademicOpenAlex(OpenAlexSearch):
        requires_scraping = False

        def search(self, max_results=6):
            return [{**r,'raw_content':'Academic API abstract (not full text):\n' + r['title'] + '\n' + r['body']} for r in super().search(max_results)]

    class AcademicArxiv(ArxivSearch):
        requires_scraping = False

        def __init__(self, query, **kwargs):
            super().__init__(arxiv_query(query), **kwargs)

        def search(self, max_results=6):
            return [{**r,'raw_content':'arXiv API abstract (not full text):\n' + r['title'] + '\n' + r['body']} for r in super().search(max_results)]

    requests.get = capture_get
    arxiv.Client.results = capture_arxiv
    if quick is not None:
        output['mode'] = 'quick'
        save()
        async def retrieve(cls, source, sort):
            for phrase in quick['queries']:
                try:
                    await asyncio.to_thread(cls(phrase, sort=sort).search, max_results=quick.get('max_results',6))
                except Exception as error:
                    if not any(s['source'] == source and s.get('query') == phrase for s in sources):
                        sources.append({'source':source,'query':phrase,'status':'failed','error':worker_error(error, destination)})
                        save()
                # Keep same-source requests sequential; respect arXiv's request interval.
                if source == 'arxiv' and phrase != quick['queries'][-1]:
                    await asyncio.sleep(3)
        await asyncio.gather(
            retrieve(AcademicOpenAlex, 'openalex', 'publication_date:desc' if quick['latest'] else 'relevance_score:desc'),
            retrieve(AcademicArxiv, 'arxiv', 'SubmittedDate' if quick['latest'] else 'Relevance'),
            return_exceptions=True)
        output.pop('warning', None)
        save()
        return
    GenericLLMProvider.get_chat_response = tracked_chat
    agent.get_retrievers = lambda *args: [AcademicOpenAlex,AcademicArxiv]
    embedding = os.getenv('PAPER_SEARCH_EMBEDDING','sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
    config = {'RETRIEVER':'openalex,arxiv','EMBEDDING':'huggingface:' + embedding,
              'EMBEDDING_KWARGS':{'model_kwargs':{'device':'cpu'}},
              'MAX_ITERATIONS':1,'MAX_SEARCH_RESULTS_PER_QUERY':6,
              'DEEP_RESEARCH_BREADTH':2,'DEEP_RESEARCH_DEPTH':2,'DEEP_RESEARCH_CONCURRENCY':1,
              **model_config()}
    config_path = destination.with_suffix('.config.json')
    config_path.write_text(json.dumps(config),encoding='utf-8')
    sources.append({'source':'semantic_scholar','status':'skipped','reason':'当前使用 OpenAlex 和 arXiv；未启用 Semantic Scholar 配额与适配。'})
    if bounded:
        # A single query per source, API abstracts only; no deep research or PDF fetch.
        for retriever in (AcademicOpenAlex(query, sort='publication_date:desc'), AcademicArxiv(query, sort='SubmittedDate')):
            try:
                await asyncio.to_thread(retriever.search, max_results=6)
            except Exception:
                pass  # Source adapters retain the actual failure, never a false zero.
        output.pop('warning', None)
        save()
        return
    try:
        researcher = GPTResearcher(query=query,config_path=str(config_path),verbose=False)
        # Native recursive skill; no write_report, secondary workbench or material store.
        from gpt_researcher.skills.deep_research import DeepResearchSkill
        result = await DeepResearchSkill(researcher).deep_research(query, breadth=2, depth=2)
        output.pop('warning',None)
        if not result['learnings']:
            output['warning'] = '多轮调研未形成有效研究结论；候选仅依据来源元数据。'
        output['research'] = {'learnings':result['learnings'],'citations':result['citations'],
                              'source_urls':list(result['visited_urls'])}
    except Exception as error:
        output['warning'] = worker_error(error, destination)
    for source in ('openalex','arxiv'):
        if not any(s['source'] == source for s in sources):
            sources.append({'source':source,'status':'skipped','reason':'调研尚未调用此来源'})
    save()


if __name__ == '__main__':
    destination = Path(sys.argv[2])
    try:
        quick = json.loads(sys.argv[sys.argv.index('--quick') + 1]) if '--quick' in sys.argv else None
        asyncio.run(run(sys.argv[1],destination, '--bounded' in sys.argv[3:], quick))
    except Exception as error:
        destination.write_text(json.dumps({'error':worker_error(error, destination)}),encoding='utf-8')
        raise
