# 运行检查

安装依赖并构建前端后，在仓库根目录运行：

```sh
.venv/bin/python -m compileall -q backend
npm run check:writing
.venv/bin/python -m backend.check
.venv/bin/python -m backend.check_sources
.venv/bin/python -m backend.check_tasks
.venv/bin/python -m backend.check_exports
.venv/bin/python -m backend.check_writing
.venv/bin/python -m backend.check_errors
.venv/bin/python -m backend.check_search_recovery
PYTHON="$PWD/.venv/bin/python" node prototype/check.cjs
```

Windows 将 Python 路径替换为 `.\.venv\Scripts\python.exe`；最后一条先设置 `$env:PYTHON` 再运行 Node。

默认后端检查使用本地受控模型响应，不消耗真实模型额度。未安装 Playwright 时，浏览器检查只验证 API 启动，不代表 UI 交互已验证。带 `--real` 或 `live` 的其他检查需要额外模型、网络或指定资料，可能产生费用，不属于上述基础检查。

## 当前检查限制

`backend.check` 的受控模型局部修正场景，以及 `backend.check_sources` 的宽范围引用断言，当前存在失败；不能把整套检查视为全部通过。两项检查保留以便复现。它们不影响基础安装启动，但涉及的研究修订与引用边界仍需进一步验证。
