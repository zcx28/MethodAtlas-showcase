"""Run with python -m backend.check_writing_drafts; isolated data, no model calls."""
import copy
from pathlib import Path
from .check_support import temporary_directory
from .state import Store
from .writing import Writing


def main():
    with temporary_directory() as directory:
        path = Path(directory) / 'state.sqlite3'
        store = Store(path)
        project = store.create_project('草稿与存档')
        writing = Writing(store)
        nodes = [{'id': 'p', 'type': 'p', 'children': [{'text': '初稿'}]}]
        first = writing.save(project, None, {'request_id': 'create', 'title': '论文', 'document': nodes})
        aid = first['artifact_id']
        original = writing.export(project, aid, first['version_id'], 'html')[0]
        body = {'request_id': 'edit', 'base_version_id': first['version_id'], 'title': '草稿标题', 'document': copy.deepcopy(nodes)}
        body['document'][0]['children'][0]['text'] = '未存档正文'
        saved = writing.save_draft(project, aid, body)
        assert writing.save_draft(project, aid, body) == saved
        assert len(writing.get(project, aid)['versions']) == 1
        assert len(list((store.root / 'workspaces' / project).glob('*.html'))) == 1
        writing.snapshot(project, aid, {'version_id': saved['version_id']})
        store.close()
        store = Store(path)
        writing = Writing(store)
        assert writing.version(project, aid)['payload']['document'] == body['document']
        assert '未存档正文' in writing.export(project, aid, saved['version_id'], 'html')[0].decode()
        invalid = {**body, 'request_id': 'stale', 'title': '不能覆盖'}
        try:
            writing.save_draft(project, aid, invalid)
            raise AssertionError('stale draft overwrote newer content')
        except ValueError as error:
            from .errors import public_error
            info = public_error(error)
            assert info['code'] == 'conflict' and '未保存内容已保留' in info['message']
        other = store.create_project('其他项目')
        try:
            writing.snapshot(other, aid, {'version_id': saved['version_id']})
            raise AssertionError('cross-project draft access')
        except ValueError:
            pass
        updated = writing.save_draft(project, aid, {**body, 'request_id': 'edit-2', 'base_version_id': saved['version_id'], 'title': '再次编辑'})
        assert writing.version(project, aid, saved['version_id'])['title'] == '草稿标题'
        assert len(store.all('SELECT * FROM writing_drafts')) == 1
        archived_body = {'request_id': 'archive', 'base_version_id': updated['version_id'], 'name': '投稿前'}
        archived = writing.archive(project, aid, archived_body)
        assert writing.archive(project, aid, archived_body) == archived
        assert archived['version_no'] == 2 and writing.get(project, aid)['draft'] is None
        assert writing.version(project, aid)['payload']['summary'] == '投稿前'
        repeated = writing.archive(project, aid, {'request_id': 'archive-again', 'base_version_id': archived['version_id']})
        assert repeated['unchanged'] and len(writing.get(project, aid)['versions']) == 2
        restored = writing.restore(project, aid, {'request_id': 'restore', 'version_id': first['version_id'], 'base_version_id': archived['version_id']})
        assert len(writing.get(project, aid)['versions']) == 2
        assert writing.version(project, aid)['payload']['document'] == nodes
        assert writing.export(project, aid, first['version_id'], 'html')[0] == original
        assert writing.version(project, aid, saved['version_id'])['title'] == '草稿标题'
        changed = {**body, 'request_id': 'invalid', 'base_version_id': restored['version_id'], 'document': []}
        try:
            writing.save_draft(project, aid, changed)
            raise AssertionError('invalid document accepted')
        except ValueError:
            pass
        assert writing.version(project, aid)['id'] == restored['version_id']
        store.close()
    print('PASS: persistent drafts, archive deduplication, immutable snapshots/history, restore, conflict and isolation')


if __name__ == '__main__':
    main()
