# 安装与启动

## 环境

- Python 3.12，使用独立虚拟环境。
- Node.js ≥ 22.18，用于编辑器构建、图表和汇报渲染。
- DeepSeek 或兼容 OpenAI Chat Completions 的模型连接。
- 安装依赖、检索和模型请求需要网络；研究资料及成果保存在本机。

## macOS / Linux

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run build:writing
.venv/bin/python -m backend.app
```

默认地址为 `http://127.0.0.1:8765`；端口已占用时尝试后续端口，以终端输出为准。进入设置添加模型连接，点击“测试能力”后选择可用模型。

### 启用论文检索与订阅

独立搜索环境避免模型 SDK 与检索组件的依赖冲突。安装还需要 Git。

```sh
.venv/bin/python -m venv .research-deps
.research-deps/bin/python -m pip install -r requirements-discovery.txt PyMuPDF==1.28.2
export PAPER_SEARCH_PYTHON="$PWD/.research-deps/bin/python"
.venv/bin/python -m backend.app
```

配置环境变量后重启服务。检索与订阅使用模型连接和 OpenAlex/arXiv 等论文来源。

### 环境默认模型

也可复制 `.env.example` 为 `.env.local`，填写自己的密钥后运行：

```sh
set -a
. ./.env.local
set +a
export PAPER_SEARCH_PYTHON="$PWD/.research-deps/bin/python"
.venv/bin/python -m backend.app
```

macOS 安装好两个 Python 环境、构建编辑器并填好 `.env.local` 后，也可双击 `start-methodatlas.command`。该入口使用 8876 端口，请保持终端打开。

## Windows PowerShell

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
npm run build:writing
.\.venv\Scripts\python.exe -m venv .research-deps
.\.research-deps\Scripts\python.exe -m pip install -r requirements-discovery.txt PyMuPDF==1.28.2
$env:PAPER_SEARCH_PYTHON = (Resolve-Path '.\.research-deps\Scripts\python.exe').Path
.\.venv\Scripts\python.exe -m backend.app
```

进入应用设置添加模型连接。使用环境默认连接时，在启动前设置 `$env:DEEPSEEK_API_KEY` 和 `$env:DEEPSEEK_MODEL`；PowerShell 不会自动加载 `.env.local`。

## 数据与参数

- `--pdf-dir`：启动时扫描的 PDF 目录，默认 `论文/`；目录不存在仍可启动并从页面导入。
- `--data-dir`：数据目录，默认 `.methodatlas-data/`，包含研究项目、文献与成果版本和本机连接配置。
- `--port`：指定本地端口。

备份研究数据前先关闭后端。密钥、数据库、论文原件和日志不应提交到源码仓库。服务面向本地单用户，不应直接作为无访问控制的公网多用户服务。

## 可选组件

| 能力 | 条件 |
| --- | --- |
| 扫描 PDF 的 OCR | 安装 Tesseract 和语言数据，设置 `TESSDATA_PREFIX`。缺少时保留原页入口。 |
| 论文模板排版 | 安装 Typst CLI 并加入 PATH；模板已固定版本提供。 |
| 远程实验 | OpenSSH 连接、远端 Linux/Python；隔离实验组还需要可用的 bubblewrap。 |

## 常见问题

- 编辑器未加载：运行 `npm ci` 和 `npm run build:writing` 后刷新。
- 模型连接失败：核对地址、模型和密钥，再测试能力。
- 检索不可用：检查独立搜索环境、`PAPER_SEARCH_PYTHON` 和论文来源的网络可达性。
- 只有摘要：来源未提供可访问全文时，可上传自己取得的 PDF。
- 订阅何时运行：后端保持运行时执行；休眠或停止后端期间暂停，恢复后补检。
