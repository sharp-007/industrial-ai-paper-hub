# GitHub Pages 发布目录

本目录为「工业AI文献速递」静态站点根目录，由 GitHub Actions 自动部署。

- `index.html` — 门户首页（展示文献中英文全名与元信息）
- `papers/<文献文件夹名>/page-renders/` — 每篇文献的页面渲染产物

文献文件夹名采用英文全名 kebab-case，与 `workflow/registry.yaml` 中 `folder` 字段一致。
