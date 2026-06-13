# 工业AI文献速递

精选工业人工智能领域重要文献的中文翻译，持续更新，部署于 [GitHub Pages](https://pages.github.com/)。

## 在线阅读

访问站点首页，选择文献进入阅读：

- [人工智能与机器学习智能制造路线图 2026](site/papers/2026-roadmap-on-artificial-intelligence-and-machine-learning-for-smart-manufacturing/page-renders/index.html) — arXiv:2605.00839

## 站点结构

```
site/
  index.html                       # 门户首页
  papers.json
  papers/
    <文献英文名-kebab-case>/       # 以文献全名命名的文件夹
      page-renders/                # 页面渲染产物
        index.html
        source/paper.pdf
        sections/
        css/
        images/
        full-translation.html
```

每篇文献在 `site/papers/<文献文件夹名>/` 下拥有独立目录，文件夹名采用文献英文全名的 kebab-case 形式。

## GitHub Pages 部署

1. 将本仓库推送到 GitHub
2. 进入 **Settings → Pages → Build and deployment**
3. 选择 **GitHub Actions** 作为 Source
4. 推送 `site/` 目录变更后自动部署

站点地址：`https://<用户名>.github.io/<仓库名>/`

## 本地预览

```bash
python -m http.server 8080 -d site
```

浏览器打开 `http://localhost:8080`

## 许可与声明

各文献翻译遵循原文 arXiv / 期刊版权要求，本站仅供学习参考。
