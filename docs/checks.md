# 运行检查

先完成依赖安装与编辑器构建。在仓库根目录执行：

```sh
.venv/bin/python -m compileall -q backend
npm run build:writing
npm run check
.venv/bin/python -m backend.check_link_import
.venv/bin/python -m backend.check_collaboration
.venv/bin/python -m backend.check_reader_document
.venv/bin/python -m backend.check_writing_drafts
.venv/bin/python -m backend.check_layout
npx playwright install chromium
PYTHON="$PWD/.venv/bin/python" npm run check:ai-dialog
```

Windows 使用 `.\.venv\Scripts\python.exe`；浏览器检查前设置 `$env:PYTHON`。浏览器已安装在自定义位置时，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 Chromium 可执行文件。

## 本次检查范围

2026-10-13 展示版本在 Python 3.12 与 Node.js 24 环境完成以下检查：

- 编辑器构建、结构化修订、引用编号、对话队列与历史响应边界。
- 本地受控认证服务下的真实 HTTP/SQLite：登录、CSRF、成员邀请、撤销权限、团队模型隔离、共享任务、评论、私人内容、活动与通知。
- 连续原文阅读、跨页与多栏定位、公式后续文字、固定资料版本及图像片段。
- 草稿自动保存、手动存档去重、历史恢复、保存冲突与访问隔离。
- 两种实际 Typst 模板、正文保留、布局计划验证与确认流程。此项需要 Typst CLI 和字体。
- 浮动对话的选区、历史、窗口关闭与导航、草稿、首次发送建会话、引用版本及重复请求处理。

以上自动检查使用独立临时数据与受控外部响应，不调用真实模型，不向真实邮箱发送邮件。展示截图也使用独立演示数据。

另按[评委体验路线](example.md)使用公开论文全文、已配置的真实模型和两个受控测试账号完成：链接导入、带引用的方法对比、引用跳转与原文高亮、组会报告生成及 v2 修订、DOCX 下载、文稿自动保存与 AI 修改提案、接受后存档、DOCX/PDF 打开、任务分配与固定文献关联、选区评论及提醒、回复解决、成员确认的项目知识、私人对话访问拒绝，以及主动发布独立共享笔记。报告 v1 的下载内容在 v2 生成后保持不变。PDF 链接导入中发现的连接关闭错误已修复，并加入真实本地 HTTP 连接关闭的导入回归。

上述结果不等于所有功能或所有平台均已验证。模型回答仍需按引用人工核对；真实邮箱投递、外网检索、远端 GPU 实验与并发容量未在本次路线中重新验收。仓库保留其他功能检查供复现，但本次未全部重跑；带 `--real` 或 `live` 的入口可能访问网络、资料或产生模型费用。
