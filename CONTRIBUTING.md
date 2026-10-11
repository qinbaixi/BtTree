# 贡献指南

感谢你愿意改进 owl-bt！提交 Issue 或 Pull Request 前，请先阅读以下内容。

## 报告问题

- 先搜索已有 Issue，避免重复。
- 描述复现步骤、期望结果与实际结果，附上操作系统、Node.js 版本，以及使用的是网页版还是桌面版。
- 如果和某个项目或树文件有关，尽量附上能复现问题的最小 `owl-bt.json` 和树文件。

## 开发环境

- Node.js >= 22.12，npm >= 10。
- 安装依赖并启动开发服务：

  ```sh
  npm install
  npm run dev
  ```

- 目录说明见 README 的「目录结构」一节。核心逻辑放在 `packages/shared`（不依赖 DOM 和 Node API），服务端放在 `packages/server`，界面放在 `packages/client`，桌面壳放在 `packages/desktop`。

## 提交 Pull Request

1. 从 `main` 新建分支，分支名如 `feat/export-go`、`fix/palette-overflow`。
2. 修改代码并补充测试：测试文件与源文件同目录，命名为 `*.test.ts(x)`。
3. 本地确认以下命令全部通过：

   ```sh
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

4. 用户可见的改动请在 `CHANGELOG.md` 的「未发布」下补一行说明。
5. 提交 Pull Request，说明改动内容和原因；界面改动请附截图。

## 代码约定

- TypeScript 严格模式；代码格式由 Prettier 统一（`npx prettier --write <文件>`），配置见 `.prettierrc`。
- 文件统一使用 LF 换行（`.gitattributes` 已设置）。
- 界面样式使用 CSS Modules 和 `packages/client/src/styles/global.css` 中的主题变量，新增样式需同时适配明亮和深色主题。
- 不要破坏项目文件和树文件的格式兼容：未知字段必须原样保留。
- 提交信息使用英文祈使句，首行不超过 72 个字符，例如 `Add Go export format`。

## 发布流程（维护者）

1. 更新各 `packages/*/package.json` 的版本号，把 `CHANGELOG.md` 中「未发布」的内容移到新版本下。
2. 提交后打标签并推送：

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. GitHub Actions 的 `release` 工作流会运行检查、构建 Windows 安装版和便携版，并上传到对应的 GitHub Release。
