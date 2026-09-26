#!/bin/zsh
set -eu
cd -- "${0:A:h}"
set -a
source ./.env.local
set +a
: "${DEEPSEEK_API_KEY:?请先在 .env.local 配置 DEEPSEEK_API_KEY}"
export PAPER_SEARCH_PYTHON="${PAPER_SEARCH_PYTHON:-$PWD/.research-deps/bin/python}"
"$PAPER_SEARCH_PYTHON" -c 'from gpt_researcher import GPTResearcher' || {
  print -u2 '搜索依赖未就绪，请按 README 安装 requirements-discovery.txt。'
  exit 1
}
exec .venv/bin/python -m backend.app --port 8876 "$@"
