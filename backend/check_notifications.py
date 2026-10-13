"""Notification pagination through real HTTP, including concurrent arrivals."""
from urllib.parse import urlencode


def check(service, request, root, project, users, owner, member, outsider):
    store = service.store
    recipient = users['member@example.com']['id']
    actor = users['owner@example.com']['id']
    task = store.one('SELECT id FROM work_items WHERE project_id=?', (project,))['id']
    base = root + '/notifications'
    created = '2099-01-01T00:00:00+00:00'
    prefix = 'notice-page-check:'
    def insert(ident, kind='task_assigned', target=recipient, timestamp=created):
        store.run('INSERT INTO project_notifications VALUES(?,?,?,?,?,?,?,NULL)',
                  (prefix+ident, project, target, actor, kind, task, timestamp))
    try:
        for number in range(137):
            insert(f'{number:04}')
        first = request(base, cookie=member)[1]
        assert len(first['notifications']) == 30 and first['next_cursor']
        ids = [n['id'] for n in first['notifications']]
        cursor = first['next_cursor']
        insert('new', timestamp='2099-01-02T00:00:00+00:00')
        while cursor:
            status, page, _ = request(base+'?'+urlencode({'cursor':cursor}), cookie=member)
            assert status == 200, page
            ids += [n['id'] for n in page['notifications'] if n['id'].startswith(prefix)]
            cursor = page['next_cursor']
        assert len(ids) == len(set(ids)) == 137, 'arrival shifted older pages'
        assert request(base,cookie=member)[1]['notifications'][0]['id']==prefix+'new'
        insert('foreign', target=actor)
        assert request(base+'?'+urlencode({'cursor':prefix+'foreign'}),cookie=member)[0]==400
        assert request(base,cookie=outsider)[0]==403
        for query in ('limit=0','limit=101','limit=no','cursor=missing'):
            assert request(base+'?'+query,cookie=member)[0]==400
        # A bounded scan must still let users advance past unavailable records.
        for number in range(1001):
            insert(f'hidden-{number:04}', kind='unsupported', timestamp='2099-01-03T00:00:00+00:00')
        hidden = request(base,cookie=member)[1]
        assert hidden['notifications']==[] and hidden['next_cursor']
        following = request(base+'?'+urlencode({'cursor':hidden['next_cursor']}),cookie=member)[1]
        assert following['notifications'][0]['id']==prefix+'new'
        assert len(following['notifications'])==30
        print('PASS: notification keyset pagination, equal timestamps, concurrent arrival, recipient isolation and bounded hidden-record scan')
    finally:
        store.run('DELETE FROM project_notifications WHERE project_id=? AND id LIKE ?', (project,prefix+'%'))
