# 依赖与第三方来源

Python 依赖固定在 `requirements.txt`，检索环境固定在 `requirements-discovery.txt`；Node 依赖及解析版本固定在 `package.json`、`package-lock.json`。

| 组件 | 用途 |
| --- | --- |
| DeepSeek Harness SDK | 研究 Agent 和工具调用 |
| PyMuPDF / PyMuPDF4LLM | PDF 阅读、正文解析和导出 |
| GPT Researcher | 深度调研与检索，使用独立环境 |
| Plate / React | 文稿编辑和修订界面 |
| Matplotlib / Resvg / PptxGenJS | 图表、SVG 与 PPTX 渲染 |
| PDF.js / Motion | PDF 阅读与界面动效，许可证保留在 `prototype/vendor/` |

随源码提供的模块和模板：

- [Mimir](../third_party/mimir/README.md)：研究方法、汇报渲染和服务器模块。
- [academic-research-graph](../third_party/academic-research-graph/README.md)：论文关系图渲染。
- [AesthePDF](../third_party/aesthepdf/README.md)：排版决策指导。
- [Typst 模板](../third_party/typst/README.md)：固定版本的论文模板。

第三方许可证与署名保留在对应目录，模型服务和论文访问凭据由使用者自行配置。
