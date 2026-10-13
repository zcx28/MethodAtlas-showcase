# 安装与启动

## 环境

- Python 3.12，独立虚拟环境。
- Node.js ≥ 22.18，用于编辑器构建、图表和汇报渲染。
- DeepSeek 或兼容 OpenAI Chat Completions 的模型连接。
- 网络用于安装依赖、访问来源与调用模型。

## macOS / Linux：个人模式

```sh
git clone https://github.com/zcx28/MethodAtlas-showcase.git
cd MethodAtlas-showcase
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run build:writing
.venv/bin/python -m backend.app
```

默认地址 `http://127.0.0.1:8765`，端口占用时尝试后续端口，以终端输出为准。打开设置添加模型连接并测试能力。未配置认证地址时为本地个人模式。

### 论文检索与订阅

独立检索环境避免模型 SDK 与检索组件依赖冲突。安装需要 Git。

```sh
.venv/bin/python -m venv .research-deps
.research-deps/bin/python -m pip install -r requirements-discovery.txt PyMuPDF==1.28.2
export PAPER_SEARCH_PYTHON="$PWD/.research-deps/bin/python"
.venv/bin/python -m backend.app
```

没有独立检索环境仍可导入自己的资料并研究。检索与订阅使用配置的模型及 OpenAlex/arXiv 等来源。

### 使用环境默认连接

将 `.env.example` 复制为 `.env.local`，只填写需要的变量，保留未使用项为空：

```sh
set -a
. ./.env.local
set +a
.venv/bin/python -m backend.app
```

不要将 `.env.local` 提交到仓库。macOS 的 `start-methodatlas.command` 使用 8876 端口，要求先填好环境默认 DeepSeek 密钥、安装独立检索环境并构建编辑器；满足这些条件后可双击启动。

## Windows PowerShell

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
npm run build:writing
.\.venv\Scripts\python.exe -m backend.app
```

进入设置添加模型连接。需要检索时：

```powershell
.\.venv\Scripts\python.exe -m venv .research-deps
.\.research-deps\Scripts\python.exe -m pip install -r requirements-discovery.txt PyMuPDF==1.28.2
$env:PAPER_SEARCH_PYTHON = (Resolve-Path '.\.research-deps\Scripts\python.exe').Path
.\.venv\Scripts\python.exe -m backend.app
```

PowerShell 不自动加载 `.env.local`；环境默认模型需在启动前设置 `$env:DEEPSEEK_API_KEY` 和 `$env:DEEPSEEK_MODEL`。

## 多人模式：认证与邮件

评委可直接体验[在线协作版](https://methodatlas.64-90-4-239.sslip.io/)。自行运行多人模式需要额外部署兼容 Supabase Auth 的认证服务，并配置：

| 变量 | 用途 |
| --- | --- |
| `METHODATLAS_AUTH_URL` | Auth HTTP API 的基址，路径应对应服务的 `/otp`、`/verify`、`/user` 等接口。 |
| `METHODATLAS_AUTH_ANON_KEY` | 认证服务要求的公共 API key，由部署者提供。 |
| `METHODATLAS_PUBLIC_URL` | 面向用户的站点地址；公网必须使用 HTTPS。 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURITY` | 项目通知邮件的发送服务。安全模式使用 `implicit_tls` 或 `starttls`。 |
| `SMTP_USER` / `SMTP_PASSWORD` | 项目通知邮箱与授权码。 |

邮箱验证码的发送由认证服务自身配置；应用 SMTP 用于项目邀请及订阅通知，两处需要分别设置。认证未就绪时不要把免登录个人模式公开到公网。

`backend.app` 仅监听 `127.0.0.1`，正式站点需由 HTTPS 反向代理转发至后端。外部模型连接与服务器授权由团队负责人配置。数据库和连接配置属于运行环境，仓库不附带认证服务、生产配置或账号数据。

有历史个人数据时，先备份，再通过 `METHODATLAS_LEGACY_OWNER_EMAIL` 指定迁移负责人；不配置该变量不会把已有数据交给任意新登录账号。默认全站允许 2 个 AI 运行，超出排队；`METHODATLAS_MAX_PARALLEL_RUNS` 可由部署者调整，实际容量需另行验证。

## 数据与参数

- `--data-dir` / `METHODATLAS_DATA_DIR`：默认 `.methodatlas-data/`，保存研究数据、版本与私密连接配置。
- `--pdf-dir` / `METHODATLAS_PDF_DIR`：默认 `论文/`，目录不存在仍能启动并从界面导入。
- `--port` / `METHODATLAS_PORT`：指定本地端口。

备份前停止后端。数据库、密钥、论文原件和运行日志不应提交到源码仓库。

## 可选组件

| 能力 | 额外条件 |
| --- | --- |
| 扫描 PDF OCR | Tesseract 与语言数据，可设置 `TESSDATA_PREFIX`；缺少时保留原页入口。 |
| 论文模板排版 | Typst CLI 加入 PATH，安装所需字体；中文建议 Noto Serif CJK SC。模板随源码固定版本提供。 |
| 远程实验 | OpenSSH、远端 Linux/Python 与独立资源授权；隔离实验组需要可用 bubblewrap。 |

编辑器未加载时重新执行 `npm ci` 与 `npm run build:writing`。只有摘要时可以补充全文 PDF。模型连接失败时先核对地址、模型、密钥，再测试能力。
