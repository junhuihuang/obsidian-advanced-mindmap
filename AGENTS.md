# Notes for coding agents

## Lessons

Before changing code, read [LESSONS.md](LESSONS.md): what recent merged
work got wrong and the rule that would have caught it.

## Deployment

本地开发完成（代码改完、`tsc` / `eslint` / `vitest` / `npm run build` 都通过）后，
**必须在本地部署**，不要只留一个 build 产物：

```bash
npm run deploy
```

- 等价于 `npm run build` + 把 `main.js`、`styles.css`、`manifest.json` 拷到
  `$VAULT/.obsidian/plugins/advanced-mindmap/`（默认 vault 为 `~/vault`）。
- 换 vault 时用 `VAULT=/path/to/vault npm run deploy`，或直接指定
  `PLUGIN_DIR=/path/to/.obsidian/plugins/advanced-mindmap`。
- **不要覆盖插件目录里的 `data.json`**（那是用户设置，脚本不会碰它）。
- 部署后告知用户需要重载插件（关闭再开启该插件）才能生效。
