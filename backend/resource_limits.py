"""Shared admission for online model runs, including auxiliary model sessions."""
import json
import os
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING

from .errors import AppError
from .state import new_id, now


def price_rates(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {'input', 'cached', 'output'}:
        raise ValueError('模型单价须包含输入、缓存和输出三项')
    result = {}
    for key, amount in value.items():
        try:
            number = Decimal(str(amount))
        except InvalidOperation:
            raise ValueError('模型单价必须是有效的非负金额') from None
        if not number.is_finite() or not 0 <= number <= 1000000:
            raise ValueError('模型单价必须是有效的非负金额')
        result[key] = str(number)
    return result


def cost_micros(rates, input_tokens, cached_tokens, output_tokens):
    if rates is None:
        return None
    # Yuan per million tokens is micro-yuan per token. Reasoning is part of output.
    return int(((input_tokens - cached_tokens) * Decimal(rates['input'])
                + cached_tokens * Decimal(rates['cached'])
                + output_tokens * Decimal(rates['output'])).to_integral_value(rounding=ROUND_CEILING))


class ResourceLimits:
    def __init__(self, store):
        self.store = store
        self.global_limit = int(os.getenv('METHODATLAS_MAX_PARALLEL_RUNS', '2'))
        if not 1 <= self.global_limit <= 5:
            raise ValueError('全站并发运行数必须为 1 至 5')
        # one service process; use durable leases before running multiple app workers.
        self.changed = threading.Condition(store.lock)
        self.active = {}
        self.closed = False
        store.run('CREATE TABLE IF NOT EXISTS resource_limits(scope TEXT NOT NULL,scope_id TEXT NOT NULL,parallel_runs INTEGER NOT NULL CHECK(parallel_runs BETWEEN 1 AND 5),PRIMARY KEY(scope,scope_id))')
        columns = {row['name'] for row in store.all('PRAGMA table_info(resource_limits)')}
        for name, kind in {'monthly_tokens': 'INTEGER', 'monthly_cost_micros': 'INTEGER', 'token_since': 'TEXT', 'cost_since': 'TEXT'}.items():
            if name not in columns:
                store.run(f'ALTER TABLE resource_limits ADD COLUMN {name} {kind}')
        store.run('''CREATE TABLE IF NOT EXISTS model_requests(
            id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,project_id TEXT,actor_id TEXT NOT NULL,
            created TEXT NOT NULL,status TEXT NOT NULL,reserved_tokens INTEGER NOT NULL,reserved_cost INTEGER,
            used_tokens INTEGER,used_cost INTEGER)''')
        store.run('CREATE INDEX IF NOT EXISTS model_request_workspace_time ON model_requests(workspace_id,created)')
        store.run('CREATE INDEX IF NOT EXISTS model_request_project_time ON model_requests(project_id,created)')
        # An accepted request may have been billed even if shutdown lost its response.
        store.run("UPDATE model_requests SET status='uncertain' WHERE status='reserved'")

    def quota(self, scope, ident):
        row = self.store.one('SELECT * FROM resource_limits WHERE scope=? AND scope_id=?', (scope, ident))
        return dict(row) if row else {'monthly_tokens': None, 'monthly_cost_micros': None, 'token_since': None, 'cost_since': None}

    def spent(self, scope, ident, since):
        month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        since = max(month, since or month)
        row = self.store.one(f'''SELECT COALESCE(SUM(COALESCE(used_tokens,reserved_tokens)),0) AS tokens,
            COALESCE(SUM(COALESCE(used_cost,reserved_cost)),0) AS cost,
            COALESCE(SUM(status='uncertain'),0) AS uncertain
            FROM model_requests WHERE {'workspace_id' if scope == 'workspace' else 'project_id'}=?
            AND created>=? AND status<>'rejected' ''', (ident, since))
        return dict(row)

    def reserve(self, workspace, project, actor, input_bound, output_bound, rates):
        tokens = input_bound + output_bound
        # A request can miss the cache; reserve the more expensive input price.
        maximum = None if rates is None else {**rates, 'input': str(max(Decimal(rates['input']), Decimal(rates['cached'])))}
        cost = cost_micros(maximum, input_bound, 0, output_bound)
        with self.store.transaction() as db:
            if self.closed:
                raise AppError('interrupted', '服务正在关闭')
            for scope, ident in [('workspace', workspace)] + ([('project', project)] if project else []):
                quota = self.quota(scope, ident)
                cap = quota['monthly_tokens']
                if cap is not None and self.spent(scope, ident, quota['token_since'])['tokens'] + tokens > cap:
                    raise AppError('quota', '项目或团队本月 Token 额度不足以预留本次请求')
                cap = quota['monthly_cost_micros']
                if cap is not None:
                    if cost is None:
                        raise AppError('configuration', '费用额度已启用，请先填写模型单价')
                    if self.spent(scope, ident, quota['cost_since'])['cost'] + cost > cap:
                        raise AppError('quota', '项目或团队本月费用额度不足以预留本次请求')
            ident = new_id('modelrequest')
            db.execute('INSERT INTO model_requests VALUES(?,?,?,?,?,\'reserved\',?,?,NULL,NULL)',
                       (ident, workspace, project, actor, now(), tokens, cost))
        return ident

    def settle(self, ident, rates, usage=None, *, rejected=False):
        tokens = cost = None
        if rejected:
            status, tokens, cost = 'rejected', 0, 0
        else:
            status = 'uncertain'
            if isinstance(usage, dict):
                input_tokens, output_tokens = usage.get('prompt_tokens'), usage.get('completion_tokens')
                details = usage.get('prompt_tokens_details')
                cached = usage.get('prompt_cache_hit_tokens', details.get('cached_tokens', 0) if isinstance(details, dict) else 0)
                if all(type(v) is int and v >= 0 for v in (input_tokens, output_tokens, cached)) and cached <= input_tokens:
                    status, tokens = 'settled', input_tokens + output_tokens
                    cost = cost_micros(rates, input_tokens, cached, output_tokens)
        with self.store.lock:
            if not self.closed:
                self.store.run("UPDATE model_requests SET status=?,used_tokens=?,used_cost=? WHERE id=? AND status='reserved'",
                               (status, tokens, cost, ident))

    def limit(self, scope, ident):
        row = self.store.one('SELECT parallel_runs FROM resource_limits WHERE scope=? AND scope_id=?', (scope, ident))
        return row['parallel_runs'] if row else 5

    def workspace(self, project):
        row = self.store.one('SELECT workspace_id FROM project_scopes WHERE project_id=?', (project,))
        if not row:
            raise PermissionError('项目未归属团队')
        return row['workspace_id']

    def available(self, project, tasks):
        """The caller holds store.lock; tasks are active run identities, not sessions."""
        workspace = self.workspace(project)
        return (len(tasks) < self.global_limit
                and sum(t['project_id'] == project for t in tasks) < self.limit('project', project)
                and sum(self.workspace(t['project_id']) == workspace for t in tasks) < self.limit('workspace', workspace))

    def acquire(self, task, deadline=None):
        if not getattr(self.store, 'collaboration', None) or not self.store.collaboration.online:
            return None
        key = (task['id'], task['revision'])
        with self.changed:
            while True:
                self.store.assert_active(*key)
                if self.closed:
                    raise AppError('interrupted', '服务正在关闭')
                if deadline is not None and time.monotonic() >= deadline:
                    raise TimeoutError('等待模型容量超过本轮时间预算')
                # A tool may call a helper model within its parent run. Count that run once.
                if key in self.active:
                    self.active[key]['sessions'] += 1
                    return key
                if self.available(task['project_id'], [v['task'] for v in self.active.values()]):
                    self.active[key] = {'task': task, 'sessions': 1}
                    return key
                # Never release a lock underneath an open SQLite transaction.
                if self.store.db.in_transaction:
                    raise AppError('conflict', '模型排队必须在写入事务外执行')
                self.changed.wait(.2)

    def release(self, key):
        if key is None:
            return
        with self.changed:
            self.active[key]['sessions'] -= 1
            if not self.active[key]['sessions']:
                del self.active[key]
            self.changed.notify_all()

    def close(self):
        with self.changed:
            self.closed = True
            self.changed.notify_all()

    def access(self, user, scope, ident, owner=False):
        if not user or scope not in ('workspace', 'project'):
            raise PermissionError('资源限制缺少已验证的操作者')
        if scope == 'workspace':
            return self.store.collaboration.workspace(user, ident, owner=True)
        return self.store.collaboration.project(user, ident, owner=owner, write=owner)

    def save(self, user, scope, ident, body):
        if not isinstance(body, dict) or set(body) - {'parallel_runs', 'monthly_tokens', 'monthly_yuan'} or type(body.get('parallel_runs')) is not int or not 1 <= body['parallel_runs'] <= 5:
            raise ValueError('并发运行数必须为 1 至 5 的整数')
        if 'monthly_tokens' in body and body['monthly_tokens'] is not None and (type(body['monthly_tokens']) is not int or not 1 <= body['monthly_tokens'] <= 1000000000000):
            raise ValueError('Token 额度须为空或 1 至 1000000000000 的整数')
        money = None
        if body.get('monthly_yuan') is not None:
            try:
                money = Decimal(str(body['monthly_yuan']))
            except InvalidOperation:
                raise ValueError('费用额度须为空或有效的正金额') from None
            if not money.is_finite() or not Decimal('.01') <= money <= 1000000000 or money * 1000000 != (money * 1000000).to_integral_value():
                raise ValueError('费用额度须为空或有效的正金额')
        with self.store.transaction() as db:
            self.access(user, scope, ident, owner=True)
            db.execute('INSERT INTO resource_limits(scope,scope_id,parallel_runs) VALUES(?,?,?) ON CONFLICT(scope,scope_id) DO UPDATE SET parallel_runs=excluded.parallel_runs', (scope, ident, body['parallel_runs']))
            for field, start, amount in [('monthly_tokens', 'token_since', body.get('monthly_tokens')),
                                         ('monthly_cost_micros', 'cost_since', int(money * 1000000) if money is not None else None)]:
                if ('monthly_tokens' if field == 'monthly_tokens' else 'monthly_yuan') not in body:
                    continue
                db.execute(f'UPDATE resource_limits SET {start}=CASE WHEN {field} IS NULL AND ? IS NOT NULL THEN ? ELSE {start} END,{field}=? WHERE scope=? AND scope_id=?',
                           (amount, now(), amount, scope, ident))
            projects = [ident] if scope == 'project' else [r['project_id'] for r in db.execute('SELECT project_id FROM project_scopes WHERE workspace_id=?', (ident,))]
            for project in projects:
                self.store.collaboration.event(project, user['id'], 'resource_limits_changed', ident, {'scope': scope, **body})
        with self.changed:
            self.changed.notify_all()
        return self.view(user, scope, ident)

    def view(self, user, scope, ident):
        with self.store.lock:
            access = self.access(user, scope, ident)
            owner = scope == 'workspace' or access['role'] == 'owner'
            quota = self.quota(scope, ident)
            # Report resource totals only; never expose private run IDs, titles or prompts.
            rows = self.store.all('''SELECT json_extract(t.refs,'$.initiated_by') AS actor,c.email,u.model,u.usage
                FROM model_usage u JOIN tasks t ON t.id=u.task_id JOIN project_scopes s ON s.project_id=t.project_id
                LEFT JOIN collab_users c ON c.id=json_extract(t.refs,'$.initiated_by')
                WHERE (CASE WHEN ?='project' THEN t.project_id ELSE s.workspace_id END)=?
                AND (? OR json_extract(t.refs,'$.initiated_by')=?)''', (scope, ident, owner, user['id']))
            grouped = {}
            for row in rows:
                value = grouped.setdefault((row['actor'], row['model']), {'user_id': row['actor'], 'email': row['email'], 'model': row['model']})
                for key, amount in json.loads(row['usage']).items():
                    if key in ('inputTokens', 'outputTokens', 'cacheReadTokens', 'reasoningTokens', 'calls', 'seconds') and isinstance(amount, (int, float)):
                        value[key] = value.get(key, 0) + amount
            return {'scope': scope, 'scope_id': ident, 'parallel_runs': self.limit(scope, ident), 'global_parallel_runs': self.global_limit,
                    'monthly_tokens': quota['monthly_tokens'],
                    'monthly_yuan': str(Decimal(quota['monthly_cost_micros']) / 1000000) if quota['monthly_cost_micros'] is not None else None,
                    'token_budget_usage': self.spent(scope, ident, quota['token_since']),
                    'cost_budget_usage': self.spent(scope, ident, quota['cost_since']),
                    'quota_timezone': 'UTC', 'token_since': quota['token_since'], 'cost_since': quota['cost_since'],
                    'can_manage': owner, 'usage': list(grouped.values()), 'usage_scope': 'all' if owner else 'self',
                    'usage_period': 'all_time', 'effective_parallel_runs': min(self.global_limit, self.limit(scope, ident), self.limit('workspace', access['workspace_id']) if scope == 'project' else self.global_limit)}
