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
    'reader_translation': ('译文没有完整返回。', '请重试；已保存的译文仍保留。', 'new_request', True, 502),
    'quota': ('项目或团队的本月 AI 额度不足。', '请负责人在设置中调整额度，或缩小请求后重试。', 'new_request', False, 429),
    'billing': ('当前模型账户余额不足，暂时无法生成。', '请补充余额后重新发送请求。', 'new_request', False, 503),
    'authentication': ('当前模型连接尚未通过验证。', '请在设置中检查密钥和权限，调整后重新发送请求。', 'new_request', False, 503),
    'permission': ('当前材料或操作不在可访问范围内。', '请检查项目和材料权限，调整后重新发送请求。', 'new_request', False, 403),
    'configuration': ('当前模型或服务配置不可用。', '请在设置中检查连接，调整后重新发送请求。', 'new_request', False, 503),
    'rate_limit': ('当前服务请求较多，暂时无法完成这次请求。', '请稍后重新发送请求。', 'new_request', True, 503),
    'timeout': ('这次没有及时收到模型的完整回复。', '请稍后重新发送，或缩小一次处理的范围。', 'new_request', True, 504),
    'connection': ('暂时连接不上服务，无法取得这次回复。', '请检查网络和后台服务，恢复后重新发送请求。', 'new_request', True, 503),
    'unavailable': ('请求的服务暂时不可用。', '请稍后重新发送请求。', 'new_request', True, 503),
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
    '表格列数不一致，无法完整导出', 'PDF 超过 40 MB 限制', '文件不是有效 PDF',
    '请提供 1-20 条链接，每行一条', '请选择 1-20 个 PDF', '项目名称无效', '项目名称不能为空且最多 300 字符',
    '消息不能为空，最多 100000 字符', '请求大小无效，批量 PDF 最多 120 MB', '请求大小无效，最多 2 MB',
}

# Only fixed validation messages cross the public boundary; never echo payloads,
# upstream exceptions or local paths. Keep recovery specific to the failed operation.
INPUT_STEPS = {
    '汇报来源需要成果版本，不能填写文献或文献版本': '请使用已读取的成果版本作为汇报来源；论文和 CSV 资料通过正文引用带入。',
    '论文图片需要文献版本，已有数据图请使用图表来源': '请复用已保存的数据图版本，或重新选择真实 PDF 的页码。',
    '分类名称需为 1–80 个字符': '分类名称不能只含空格；请填写 1–80 个字符后重新保存。',
    '请输入 DOI、arXiv 链接、论文网页或 PDF 直链': '每行填写一条 DOI、arXiv 链接，或公开的 HTTP(S) 论文网页、PDF 直链。',
    '链接端口不受支持': '请使用默认端口的公开 HTTP(S) 论文地址，或改用 DOI、arXiv 链接；本机或内网地址无法导入。',
    '链接不能指向本机或内网地址': '请提供公开的论文网页或 PDF 直链，或改用 DOI、arXiv 链接；本机文件请通过上传 PDF 添加。',
    '最多添加20个引用': '移除部分引用后重新发送；问题草稿仍保留。',
    '引用内容总计最多20000字符，请减少引用后重试': '缩小选区或移除部分引用后重新发送；问题草稿仍保留。',
    '最多添加20个引用，总计20000字符，请减少引用后重试': '缩小选区或移除部分引用后重新发送；问题草稿仍保留。',
    '该文献已移出资料，请在论文订阅中恢复后重试': '打开论文订阅，找到原论文并选择恢复到资料。',
    '模型单价须包含输入、缓存和输出三项': '填写模型连接的三项单价后保存。',
    '模型单价必须是有效的非负金额': '填写 0 至 1000000 之间的有效单价，单位为元／百万 Token。',
    'Token 额度须为空或 1 至 1000000000000 的整数': '留空取消限制，或填写有效的正整数额度。',
    '费用额度须为空或有效的正金额': '留空取消限制，或填写至少 0.01 元的有效额度。',
    '确认结论须选择依据并明确确认': '选择至少一条共享研究依据，并勾选人工确认。',
    '研究记录包含未知字段': '重新打开研究记录后保存。',
    '研究依据格式无效': '选择最多 50 条不重复的共享依据。',
    '研究依据标识无效': '重新选择项目中的共享依据。',
    '知识筛选条件无效': '重新选择知识状态或缩短搜索词。',
    '知识分页无效': '重新打开项目知识后查询。',
    '并发运行数必须为 1 至 5 的整数': '填写 1 至 5 的整数；团队与项目限制同时生效。',
    '评论选区无效，请重新选择文字': '回到正文重新选择，评论输入仍保留。',
    '评论引用不能为空且最多 10000 字符': '缩小选区后重新评论。',
    '引用与所选版本不一致，请重新选择文字': '重新选择原文，或改用整项评论。',
    '评论不能为空且最多 10000 字符': '填写或缩短评论后重新提交。',
    '评论提醒成员无效': '选择当前项目成员，并保留正文中的 @邮箱。',
    '此成果请使用整项评论': '清除文字选区后发表整项评论。',
    '任务标题不能为空且最多 300 字符': '填写简短标题后保存。',
    '任务说明最多 20000 字符': '缩短说明后保存，当前输入仍保留。',
    '任务负责人必须是当前项目成员': '重新选择当前项目成员或清空负责人。',
    '研究任务关联格式无效': '重新选择需要关联的项目内容。',
    '研究任务最多关联 100 项内容': '减少关联项后保存。',
    '研究任务状态或优先级无效': '重新选择任务状态和优先级。',
    '截止日期必须是有效的 YYYY-MM-DD 日期': '使用日期输入框选择截止日期。',
    '计划不能为空，同一时间只能有一个进行中的步骤': '保留完整步骤列表，并只将当前步骤标为进行中。',
    '步骤 id 必须唯一且稳定，仅含字母、数字、下划线或短横线': '沿用已保存步骤的 id，为新增步骤选择不同的 id。',
    '步骤标题最多 80 字符，结果总结最多 180 字符': '缩短步骤标题或结果总结后重新更新计划。',
    '已开始步骤的标题应保留，需要调整时新增步骤': '保留已开始步骤的 id 和标题；调整内容请新增步骤。',
    '已开始步骤不能改回待开始，需要调整时保留记录并新增步骤': '保留该步骤的执行状态，调整内容请新增步骤。',
    '完成步骤须先开始执行，并提供实际结果总结': '先将待开始步骤更新为进行中；实际执行后再标完成并填写总结。',
    '已完成步骤及总结应保留，需要继续核对时新增步骤': '原样保留已完成步骤及总结，把后续核对列为新步骤。',
    '已执行步骤不得从记录中删除': '提交完整计划，保留所有已开始和已完成的步骤。',
    '请输入服务器名称（最多 200 字符）': '填写名称后重新保存服务器。',
    '请输入主机名或 SSH 别名（最多 200 字符）': '填写主机名后重新保存服务器。',
    '服务器用户名无效（最多 100 字符）': '检查用户名；留空可沿用 SSH 配置。',
    '端口必须为 1–65535 的整数': '修改端口后重新保存服务器。',
    '表格需要至少一行和一个单元格': '请撤销刚才的表格操作后重新插入表格；草稿仍保留。',
    '表格需要相同列数（最多 12 列）': '请调整表格各行的单元格数量后重新保存。',
    '列表或表格结构无效': '请撤销刚才的列表或表格操作后重新保存；草稿仍保留。',
    '文档结构无效': '请撤销最近的编辑后重新保存，或下载未保存内容。',
    '文档节点嵌套无效': '请撤销最近的块操作后重新保存，或下载未保存内容。',
    '文档节点缺少内容': '请补充或移除空的文档块后重新保存。',
    '公式不能为空': '填写公式后重新保存。',
    '图片需要说明文字': '填写图片说明后重新保存。',
    '请先选择需要翻译的原文': '在页面中选择一段文字后，再点划词菜单里的翻译。',
    '所选内容过长，请分几次翻译': '缩小选区，分几次翻译。',
}
INPUT_MESSAGES.update(INPUT_STEPS)

CONFLICT_STEPS = {
    '另一个翻译正在进行，请稍后再试': '等待当前翻译完成后再次点击翻译。',
    '批注已有更新，请重新打开；本机草稿已保留': '打开保存版本后继续编辑；冲突前的本机批注会保留为副本。',
    '此订阅正在运行，请完成后重试': '等待当前运行结束后再试。',
    '项目内另一个订阅正在运行，本次未启动': '等待该项目当前订阅结束后，重新点击立即运行。',
    '项目已归档或后台正在关闭，本次订阅未运行': '恢复项目或启动后台后再试。',
    '此订阅今日推荐额度已用尽，本次未运行': '等待下一个研究日再运行，已有推荐仍可查看。',
    '该结论已有撤回记录，请查看最新状态': '保留你的说明，查看原结论及现有撤回理由。',
    '文档已有新版；未保存内容已保留，请回读并合并': '先下载或复制需要保留的本地内容，再回读正式版进行合并。',
    '日报已有新版，未保存内容保留，请回读合并': '先保留本地草稿，查看新版并核对差异后继续编辑。',
    '评论已有新回复或状态，请刷新后重试': '先阅读最新讨论，再确认解决或重新打开。',
    '研究任务已被其他成员修改，请保留输入并查看最新版本': '当前输入仍保留。打开最新版本比较后，再应用需要保留的修改。',
    '同段内容已改变：保留人工内容，请撤销此提案并基于新正文重新处理': '撤销只取消这份提案，不会撤销已保存的人工修改。',
    '新增位置已有人工修改，请基于新正文重新处理': '请先撤销旧提案；已保存的人工修改会保留。',
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
    if text in CONFLICT_STEPS:
        return 'conflict'
    if text.startswith(('此任务此前未能完成', '部分结论尚未通过原文核验')):
        return 'evidence'
    # Also map historical persisted errors, without mutating the original record.
    if text in ('模型服务暂时不可用。', '模型服务暂时不可用。 请稍后重新发送请求。'):
        return 'unavailable'
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
    match = re.search(r'HTTP(?:\s*Error)?[\s:（(]*([45]\d\d)\b', text, re.I)
    if match:
        return http_code(int(match[1]))
    for code, pattern in (
        ('billing', r'余额不足|insufficient[_ ](?:balance|quota)'),
        ('authentication', r'invalid[_ ]api[_ ]key|unauthorized|authentication'),
        ('configuration', r'未配置|模型.*(?:不支持|未通过|不可用|已删除)|Typst|组件尚未构建'),
        ('rate_limit', r'rate.?limit|请求过多|当前服务请求较多|限流'),
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
    return {401:'authentication', 402:'billing', 403:'permission', 404:'not_found', 406:'unavailable', 408:'timeout', 409:'conflict', 429:'rate_limit'}.get(status, 'unavailable' if status >= 500 else 'input')


def http_status(error):
    status = getattr(error, 'status', None) or getattr(getattr(error, 'response', None), 'status_code', None)
    if isinstance(error, HTTPError):
        status = error.code
    return status or (http_status(error.__cause__) if getattr(error, '__cause__', None) else None)


def public_error(error, incident_id=None):
    code = classify(error)
    message, step, action, transient, _ = ERRORS[code]
    if str(error) == '全部材料缺少有效原文依据；提取进度已保存':
        message = '已尝试读取所选材料，但本轮没有取得可用于回答的原文片段。'
        step = '这不代表材料未导入；请在阅读器确认正文，并指定原文关键词或页码后重新提问。'
    if code == 'input':
        message = next((item for item in INPUT_MESSAGES if item in str(error)), message)
        step = INPUT_STEPS.get(message, step)
    if code == 'conflict' and str(error) in CONFLICT_STEPS:
        message, step = str(error), CONFLICT_STEPS[str(error)]
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
            with os.fdopen(os.open(folder / 'errors.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), 'a', encoding='utf-8') as file:
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
        from .state import StaleRun
        try:
            store.assert_active(task['id'], task['revision'])
            return research.explain_failure(task, error)[0]
        except (StaleRun, PermissionError):
            # Revoked/stopped work must not launch another model call to explain itself.
            pass
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
        elif event['status'] in ('tool_start', 'tool_done') and internal_detail(event['message']):
            # A source filename containing underscores is not a failed tool call.
            event['message'] = ' · '.join(part for part in event['message'].split(' · ') if not internal_detail(part)) or ('正在执行研究操作' if event['status'] == 'tool_start' else '已完成研究操作')
        elif internal_detail(event['message']):
            event['message'] = user_message(event['message'])
    saved = len(task.get('files', []))
    gaps = bool(task.get('failures') or task['refs'].get('partial_gaps'))
    task['outcome'] = 'partial_success' if (task['status'] == 'succeeded' and gaps) or (saved and task['status'] in ('failed','interrupted','stopped')) else task['status']
    task['saved_count'] = saved
    return task
