"""Validate explicitly attached context before storing a task snapshot."""
import json
from .agent import exact_substring
from .errors import AppError


def references(service, project, values, user=None, conversation=None):
    if user:
        service.collaboration.project(user, project)
        service.collaboration.conversation(user, project, conversation)
    if not isinstance(values, list) or len(values) > 20:
        raise AppError('input', '最多添加20个引用')
    checked = []
    for value in values:
        if not isinstance(value, dict):
            raise AppError('input', '引用格式无效')
        kind = value.get('kind')
        for field in {'paper':('paper_id','version_id'), 'progress':('artifact_id','version_id'), 'artifact':('artifact_id','version_id'), 'subscription':('subscription_id',), 'remote':('experiment_id',)}.get(kind if isinstance(kind,str) else '', ()):
            if not isinstance(value.get(field), str) or not value[field] or len(value[field]) > 200:
                raise AppError('input', '引用对象标识无效')
        if kind == 'paper':
            if value.keys() - {'kind', 'paper_id', 'version_id', 'page', 'quote', 'rects', 'notes'}:
                raise AppError('input', '原文引用包含未知字段')
            paper = service.reader.paper(project, value.get('paper_id'), value.get('version_id'))
            page, location = service.reader.location(paper, value)
            quote = location['quote']
            if quote and quote not in page['text']:
                _, _, quote = exact_substring(page['text'], quote)
            notes = value.get('notes', [])
            if not isinstance(notes, list) or len(notes) > 20:
                raise AppError('input', '个人批注数量无效')
            comments = []
            for note in notes:
                if not isinstance(note, dict) or not isinstance(note.get('id'),str) or type(note.get('page')) is not int or not isinstance(note.get('comment'), str) or len(note['comment']) > 8000:
                    raise AppError('input', '个人批注格式无效')
                saved = service.store.one("SELECT page,payload,owner_id FROM reader_entries WHERE id=? AND project_id=? AND version_id=? AND kind='note' AND json_extract(payload,'$.deleted')=0", (note.get('id'), project, paper['version_id']))
                if user and saved and saved['owner_id'] != user['id']:
                    raise PermissionError('批注属于其他成员')
                if saved and json.loads(saved['payload'])['comment'] != note['comment']:
                    raise AppError('input', '批注已更新，请重新选择')
                if not saved or saved['page'] != note['page']:
                    raise AppError('input', '批注不属于此文献版本')
                comments.append({'id':note['id'], 'page':note['page'], 'comment':note['comment']})
            item = {**location, 'kind':kind, 'paper_id':paper['id'], 'version_id':paper['version_id'], 'page':page['page'], 'quote':quote,
                    'title':f"{paper['title']} · 第 {page['page']} 页", 'notes':comments, 'text':quote or ('所选个人批注' if comments else '所选图表区域' if location['rects'] else '当前页原文')}
        elif kind in ('progress', 'artifact'):
            if set(value) != {'kind', 'artifact_id', 'version_id'}:
                raise AppError('input', '成果引用须绑定具体版本')
            if user:
                service.collaboration.context_artifact(user, project, conversation, value['artifact_id'])
            if kind == 'artifact' and value['version_id'].startswith('draft_'):
                service.writing.snapshot(project, value['artifact_id'], {'version_id':value['version_id']}, user=user)
            version = service.file_version(project, value['artifact_id'], value['version_id'])
            if kind == 'progress' and version['kind'] != 'progress':
                raise AppError('input', '请选择研究回顾版本')
            body = version.get('body', '')
            item = {**value, 'title':version['title'], 'version_no':version['version_no'], 'text':body[:12000], 'truncated':len(body)>12000}
            if kind == 'progress': item['day'] = version['payload']['day']
        elif kind == 'subscription':
            if set(value) != {'kind', 'subscription_id'} or not isinstance(value['subscription_id'], str):
                raise AppError('input', '订阅引用格式无效')
            subscription = next((s for s in service.subscriptions.get(project)['subscriptions'] if s['id'] == value['subscription_id']), None)
            if not subscription:
                raise AppError('input', '订阅不属于当前项目')
            settings = {k:subscription.get(k) for k in ('id','name','requirements','excluded','time','enabled','next_run')}
            item = {**value, 'title':subscription['name'], 'text':json.dumps(settings, ensure_ascii=False)}
        elif kind == 'remote':
            if value.keys() - {'kind', 'experiment_id', 'path'} or not isinstance(value.get('experiment_id'), str) or not isinstance(value.get('path', ''), str) or len(value.get('path', '')) > 1000:
                raise AppError('input', '实验引用格式无效')
            experiment = service.remote.groups.get(project,value['experiment_id'], user=user) if value['experiment_id'].startswith('group_') else service.remote.get(project,value['experiment_id'], user=user)
            if user and conversation:
                origin = experiment.get('conversation_id') or experiment.get('spec', {}).get('conversation_id')
                if origin and not service.collaboration.shared_metadata({'conversation_id':origin}) and service.collaboration.scope('conversation', conversation)['visibility'] != 'private':
                    raise PermissionError('私人实验不能带入共享对话')
            item = {**value, 'title':experiment.get('name') or '远程实验', 'text':f"实验 {experiment['id']}，状态 {experiment['status']}" + (f"，选定结果 {value['path']}" if value.get('path') else '')}
        else:
            raise AppError('input', '不支持的引用类型')
        checked.append(item)
    if sum(len(item['text']) + sum(len(n['comment']) for n in item.get('notes', [])) for item in checked) > 20000:
        raise AppError('input', '引用内容总计最多20000字符，请减少引用后重试')
    return checked
