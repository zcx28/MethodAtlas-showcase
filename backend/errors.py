"""One failure vocabulary; diagnostics stay local, public messages are allowlisted."""
import errno
import json
import os
import re
import sys
import traceback
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError


# code: message, next step, recovery action, transient, API status
ERRORS = {
    'fulltext_unavailable': ('来源未提供可公开下载的 PDF，已保留论文信息。', '可打开来源网页查看，或上传已取得的 PDF。', 'upload_pdf', False, 422),
    'fulltext_failed': ('全文获取失败，已保留论文信息。', '可重新获取、打开来源网页查看，或上传 PDF 补充。', 'retry_source', True, 502),
    'billing': ('当前模型账户余额不足，暂时无法生成。', '请补充余额后重新发送请求。', 'new_request', False, 503),
    'authentication': ('当前模型连接尚未通过验证。', '请在设置中检查密钥和权限，调整后重新发送请求。', 'new_request', False, 503),
    'permission': ('当前材料或操作不在可访问范围内。', '请检查项目和材料权限，调整后重新发送请求。', 'new_request', False, 403),
    'configuration': ('当前模型或服务配置不可用。', '请在设置中检查连接，调整后重新发送请求。', 'new_request', False, 503),
    'rate_limit': ('当前服务请求较多，暂时无法生成。', '请稍后重新发送请求。', 'new_request', True, 503),
    'timeout': ('这次没有及时收到模型的完整回复。', '请稍后重新发送，或缩小一次处理的范围。', 'new_request', True, 504),
    'connection': ('暂时连接不上服务，无法取得这次回复。', '请检查网络和后台服务，恢复后重新发送请求。', 'new_request', True, 503),
    'unavailable': ('模型服务暂时不可用。', '请稍后重新发送请求。', 'new_request', True, 503),
    'evidence': ('这次没有生成可交付的内容。', '请补充需要处理的材料或明确希望得到的结果，再发送新请求。', 'new_request', False, 422),
    'model_output': ('这次生成的内容不完整，暂时无法交付。', '请缩小处理范围或明确输出要求，再发送新请求。', 'new_request', False, 502),
    'not_found': ('目前找不到所需的材料或版本。', '请重新选择材料或恢复原文件，再发送新请求。', 'new_request', False, 404),
    'conflict': ('内容或任务状态已经变化。', '请打开最新版本，调整要求后重新发送。', 'new_request', False, 409),
    'storage': ('本机目前无法保存或读取内容。', '请检查磁盘空间和文件权限，保留草稿后重新提交。', 'new_request', False, 500),
    'input': ('目前提供的信息还不足以完成这次处理。', '请检查填写内容和所选材料，调整后重新发送。', 'new_request', False, 400),
    'interrupted': ('本次处理在结束前中断了。', '已保留原有内容，需要时请重新发送请求。', 'new_request', False, 409),
    'internal': ('这次暂时无法生成，具体原因还需要排查。', '请稍后重新发送请求，原有内容仍保留。', 'new_request', False, 500),
}

INPUT_MESSAGES = {
    '候选为未来日期或非论文记录，请重新搜索',
    '表格列数不一致，无法完整导出', 'PDF 超过 40 MB 限制', '文件不是有效 PDF',
    '请提供 1-20 条链接，每行一条', '请选择 1-20 个 PDF', '项目名称无效',
    '消息不能为空，最多 100000 字符', '请求大小无效，批量 PDF 最多 120 MB', '请求大小无效，最多 2 MB',
}


class AppError(ValueError):
    def __init__(self, code, detail, *, status=None):
        super().__init__(detail)
        self.code = code
        self.status = status


def classify(error):
    if isinstance(error, AppError):
        return error.code
    text = str(error)
    if text.startswith('全文获取失败，已保留链接和摘要。'):
        return 'fulltext_failed'
    if text.startswith(('此任务此前未能完成', '部分结论尚未通过原文核验')):
        return 'evidence'
    # Also map historical persisted errors, without mutating the original record.
    for code, (message, step, *_) in ERRORS.items():
        if text in (message, message + ' ' + step):
            return code
    if any(message in text for message in INPUT_MESSAGES):
        return 'input'
    if isinstance(error, HTTPError):
        return http_code(error.code)
    status = getattr(getattr(error, 'response', None), 'status_code', None) or getattr(error, 'status', None)
    if isinstance(status, int):
        return http_code(status)
    if getattr(error, '__cause__', None):
        cause = classify(error.__cause__)
        if cause not in ('input', 'internal'):
            return cause
    if isinstance(error, PermissionError):
        return 'permission'
    if isinstance(error, (TimeoutError,)):
        return 'timeout'
    if isinstance(error, (ConnectionError, URLError)):
        return 'connection'
    if isinstance(error, FileNotFoundError):
        return 'not_found'
    if isinstance(error, OSError) and error.errno in (errno.ENOSPC, errno.EROFS, errno.EIO):
        return 'storage'
    if isinstance(error, json.JSONDecodeError):
        return 'model_output'
    if type(error).__name__ == 'ResearchValidationError':
        return 'model_output'
    if type(error).__name__ == 'StaleRun':
        return 'interrupted'
    # Legacy messages only inform classification; never copy their text to the UI.
    match = re.search(r'HTTP(?:Error)?[\s:（(]*([45]\d\d)\b', text, re.I)
    if match:
        return http_code(int(match[1]))
    for code, pattern in (
        ('billing', r'余额不足|insufficient[_ ](?:balance|quota)'),
        ('authentication', r'invalid[_ ]api[_ ]key|unauthorized|authentication'),
        ('configuration', r'未配置|模型.*(?:不支持|未通过|不可用|已删除)|Typst|组件尚未构建'),
        ('rate_limit', r'rate.?limit|请求过多|限流'),
        ('timeout', r'time.?out|超时|时间预算'),
        ('connection', r'TRANSPORT|连接.*(?:失败|无法)|无法连接|fetch failed|ECONN'),
        ('evidence', r'select_quote|引用.*(?:过大|无效|范围|不支持)|冻结原稿|原文依据|证据不足|核验|核查|草稿.*(?:交付|保存)|成果连续保存失败'),
        ('conflict', r'版本冲突|已发生变化|已修改|重复请求|当前.*状态|待确认|迟到|output_key'),
        ('not_found', r'不存在|未找到|文件.*缺失|材料.*不可用'),
        ('model_output', r'JSON|格式不完整|返回格式|回答.*(?:格式|为空)|路由.*格式|Harness 未正常完成'),
        ('permission', r'不属于|越权|拒绝跨站|只读|未授权|超出.*(?:材料|研究).*范围'),
        ('storage', r'磁盘|写入失败|保存失败|文件读取失败'),
    ):
        if re.search(pattern, text, re.I):
            return code
    return 'input' if isinstance(error, ValueError) else 'internal'


def http_code(status):
    return {401:'authentication', 402:'billing', 403:'permission', 404:'not_found', 408:'timeout', 409:'conflict', 429:'rate_limit'}.get(status, 'unavailable' if status >= 500 else 'input')


def http_status(error):
    status = getattr(error, 'status', None) or getattr(getattr(error, 'response', None), 'status_code', None)
    if isinstance(error, HTTPError):
        status = error.code
    return status or (http_status(error.__cause__) if getattr(error, '__cause__', None) else None)


def public_error(error, incident_id=None):
    code = classify(error)
    message, step, action, transient, _ = ERRORS[code]
    if code == 'input':
        message = next((item for item in INPUT_MESSAGES if item in str(error)), message)
    return {'code':code, 'message':message, 'next_step':step, 'action':action,
            'retryable':transient, 'incident_id':incident_id}


def user_message(error):
    info = public_error(error)
    return info['message'] + ' ' + info['next_step']


def record_error(store, error, **context):
    """Persist the full cause/traceback once at a catching boundary, never credentials."""
    if getattr(error, '_public_error', None):
        return error._public_error
    incident = uuid.uuid4().hex[:12]
    record = {'incident_id':incident, 'time':datetime.now(timezone.utc).isoformat(),
              'code':classify(error), 'type':type(error).__name__, 'detail':str(error),
              'http_status':http_status(error),
              'traceback':''.join(traceback.format_exception(error)), **context}
    raw = json.dumps(record, ensure_ascii=False)
    settings = getattr(store, 'model_settings', None)
    if settings:
        raw = settings.redact(raw)
    for name, secret in os.environ.items():
        if secret and any(part in name for part in ('API_KEY', 'TOKEN', 'PASSWORD', 'SECRET')):
            raw = raw.replace(secret, '[redacted]')
    raw = re.sub(r'sk-[A-Za-z0-9_-]+', '[redacted]', raw)
    raw = re.sub(r'(?i)(Bearer\s+)[^\s"\\]+', r'\1[redacted]', raw)
    try:
        with store.lock:
            folder = store.root / 'logs'
            folder.mkdir(mode=0o700, exist_ok=True)
            with os.fdopen(os.open(folder / 'errors.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), 'a') as file:
                file.write(raw + '\n')
    except OSError:
        # Logging failure must not replace the original failure (e.g. disk full).
        print(raw, file=sys.stderr, flush=True)
    info = public_error(error, incident)
    error._public_error = info
    return info


def public_payload(value):
    """Safety net for old error fields and non-task endpoints. Leave user content alone."""
    if isinstance(value, list):
        return [public_payload(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key:public_payload(item) for key,item in value.items()}
    for key in ('error', 'blocked_reason'):
        if isinstance(value.get(key), str) and value[key]:
            result[key] = user_message(value[key])
    for key in ('warning', 'file_warning', 'warnings'):
        item = value.get(key)
        if isinstance(item, str) and internal_detail(item):
            result[key] = user_message(item)
        elif isinstance(item, list):
            result[key] = [user_message(text) if isinstance(text,str) and internal_detail(text) else text for text in item]
    if value.get('ok') is False and isinstance(value.get('message'), str):
        result['message'] = user_message(value['message'])
    return result


def internal_detail(text):
    return re.search(r'HTTP\s*\d{3}|Traceback|\b[A-Za-z]+(?:_[A-Za-z]+)+\b|\b\w+Error\b|/Users/|/tmp/', text)


def failure_message(store, error, *, research=None, task=None, **context):
    if task and research and hasattr(research, 'explain_failure'):
        return research.explain_failure(task, error)[0]
    info = record_error(store, error, **context)
    return info['message'] + ' ' + info['next_step']


def task_presentation(task):
    """Add a delivery outcome without changing the scheduler's terminal states."""
    task = public_payload(task)
    info = task['refs'].get('error_info') if task.get('error') else None
    if task.get('error'):
        info = public_error(AppError(info['code'], task['error']), info.get('incident_id')) if info else public_error(task['error'])
        task['error'] = info['message']
    task['error_info'] = info
    if task['status'] in ('failed','interrupted','stopped'):
        fallback = info or public_error(AppError('interrupted', 'task stopped'))
        task['failure_reply'] = task['refs'].get('failure_reply') or fallback['message'] + ' ' + fallback['next_step']
    for event in task.get('events', []):
        if event['status'] == 'failed':
            event['message'] = user_message(event['message'])
        elif event['status'] == 'output_repair':
            event['message'] = '正在修正未通过检查的内容。'
        elif event['status'] == 'harness':
            event['message'] = '正在启动研究助手。'
        elif event['status'] == 'skill_loaded':
            event['message'] = '已加载本次研究方法。'
        elif internal_detail(event['message']):
            event['message'] = user_message(event['message'])
    saved = len(task.get('files', []))
    gaps = bool(task.get('failures') or task['refs'].get('partial_gaps'))
    task['outcome'] = 'partial_success' if (task['status'] == 'succeeded' and gaps) or (saved and task['status'] in ('failed','interrupted','stopped')) else task['status']
    task['saved_count'] = saved
    return task
