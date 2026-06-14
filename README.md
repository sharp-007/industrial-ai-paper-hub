# 工业AI文献速递 · Industrial AI Paper Hub

**工业与制造业数智化转型学习社区 | 精选 Industrial AI 重要文献中文翻译**

面向工业 AI 研究者、工程师与制造业数智化转型从业者，提供工业AI领域重要英文文献的**完整中文翻译与结构化网页阅读**（非链接合集）。中立第三方，持续更新，部署于 [GitHub Pages](https://pages.github.com/)。

## 在线阅读

访问站点首页，选择文献进入阅读：

- [人工智能与机器学习智能制造路线图 2026](site/papers/2026-roadmap-on-artificial-intelligence-and-machine-learning-for-smart-manufacturing/page-renders/index.html) — arXiv:2605.00839

## 定位


| 层级       | 说明                                        |
| -------- | ----------------------------------------- |
| **社区愿景** | 工业与制造业数智化转型学习社区                           |
| **当前入口** | 工业AI文献速递 — Hub 的第一个核心栏目                   |
| **内容原则** | 精选 Industrial AI 重要文献，完整中译 + 分章阅读 + 原文可溯源 |
| **立场**   | 中立第三方，仅供学习参考                              |


## 仓库结构

本仓库分为**公开站点**与**本地构建工作流**两部分：

```
industrial-ai-paper-hub/
├── site/                          # 公开发布（提交到 GitHub，由 Actions 部署）
│   ├── index.html                 # 门户首页
│   ├── papers.json                # 文献元数据（门户用）
│   ├── css/portal.css
│   └── papers/
│       └── <文献英文名-kebab-case>/
│           └── page-renders/      # 单篇文献站点根目录
│               ├── index.html     # 文献首页
│               ├── full-translation.html
│               ├── source/paper.pdf
│               ├── sections/      # 分章 HTML
│               ├── css/style.css
│               └── images/        # 从 PDF 裁切的插图 PNG
│
├── workflow/                      # 本地构建（.gitignore，不提交）
│   ├── build.py
│   ├── registry.yaml
│   ├── requirements.txt
│   ├── paper_translation/
│   ├── templates/
│   └── projects/
│       └── <文献目录名>/
│           ├── project.yaml
│           ├── content/*.md
│           ├── index.html
│           └── source/paper.pdf
│
└── .github/workflows/deploy-pages.yml
```

**要点：**

- 每篇文献独立文件夹，目录名采用文献英文全名的 kebab-case
- 所有页面渲染产物统一输出到 `site/papers/<folder>/page-renders/`
- `workflow/` 含译文、PDF 与构建脚本，仅保留在本地

## 本地维护者：构建与预览

```bash
pip install -r workflow/requirements.txt
python workflow/build.py 2026-roadmap-on-artificial-intelligence-and-machine-learning-for-smart-manufacturing --portal
python -m http.server 8080 -d site
```

**插图裁切（通用，支持所有文献）：**

```bash
python workflow/tools/crop_server.py
```

浏览器打开 `http://127.0.0.1:8765/`，顶部切换文献 → 自动从 PDF 导入默认裁切框 → 拖动微调 → 保存后 `build.py --figures-only`。

详见 `workflow/README.md`。

## GitHub Pages 部署

1. 本地构建后，仅提交 `site/` 目录变更
2. 推送到 GitHub 的 `main` / `master` 分支
3. **Settings → Pages → Build and deployment** 选择 **GitHub Actions**
4. 工作流 `.github/workflows/deploy-pages.yml` 自动发布 `site/` 目录

站点地址：`https://<用户名>.github.io/industrial-ai-paper-hub/`

## 本地预览（只读站点）

```bash
python -m http.server 8080 -d site
```

浏览器打开 `http://localhost:8080`

## 许可与声明

各文献翻译遵循原文 arXiv / 期刊版权要求，本站仅供学习参考。