# 运行检查

先完成依赖安装与编辑器构建。在仓库根目录执行：

```sh
.venv/bin/python -m compileall -q backend
npm run build:writing
npm run check
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

检查使用独立临时数据与受控外部响应，不调用真实模型，不向真实邮箱发送邮件。展示截图也使用独立演示数据。

上述结果不等于所有功能或所有平台均已验证。真实模型回答、外网检索、邮件投递、远端 GPU 实验与并发容量需在对应环境单独验收。仓库保留其他功能检查供复现，但本次未全部重跑；带 `--real` 或 `live` 的入口可能访问网络、资料或产生模型费用。
