# 更新日志

本文件记录所有值得注意的变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

- 导出：新增 Go 格式（`export/go/*.go`），可在菜单、首页批量导出和命令行（`--format go`）中使用；包名可在 `owl-bt.json` 的 `export.go.package` 中配置。

## [0.1.0] - 2026-10-11

首个版本：以 TypeScript 与 React 19 重写 [owl-bt](https://github.com/pruttned/owl-bt)，保持项目文件、树文件和 `owl-bt.js` 插件格式兼容。

### 新增

- 编辑器：自动布局、键盘导航、命令面板、右键菜单、撤销 / 重做、复制粘贴、未保存提示。
- 项目文件热重载；类型继承、抽象类型、自定义属性类型与校验。
- 首页：通过系统文件选择框打开文件夹或树文件，列出项目中的树，初始化项目，新建树。
- 属性面板：未选中节点时显示树概览（统计、问题、类型用量）；可查看类型定义与用法。
- 导出：单个或批量导出为 Erlang、Lua、TypeScript、C# 配置，支持在 `owl-bt.json` 中配置类型映射与输出目录。
- 命令行：`owlbt init / create / open / export`。
- 桌面版：Electron 应用，提供安装版与便携版，`package.bat` / `package.sh` 一键打包。
- 主题：默认明亮主题，可切换为原版风格的深色主题。
- 默认模板包含各类节点、装饰器、服务示例，描述为中文。
- 项目编辑器：图形化编辑 `owl-bt.json`（类型、继承、图标选择、颜色、描述模板、属性、导出设置、自定义类型），带两种主题的实时预览、校验、撤销 / 重做；保存时保留原文件格式，文件被外部修改时提示。
- 项目插件信任：`owl-bt.js` 需在编辑器中确认「Trust and run」后才会运行，内容变化后需重新信任；CLI 可用 `--trust-plugins` 跳过。

### 安全

- 服务端默认只监听 `127.0.0.1`，需要局域网访问时用 `--host` 显式开启。
- 检查请求的 `Host` / `Origin`，拒绝来自其他站点的请求和 WebSocket 连接。
- 树文件和项目文件的保存按文件串行、原子写入，避免并发保存丢失修改。

### 变更（相对原版 owl-bt）

- 图标改用 Font Awesome 6 Free Solid 名称。
- 描述模板只做属性值替换，不再执行表达式。
- 保存请求体上限提高到 50 MB；服务端异常不再导致进程退出。
- 保存树文件时保留原文件的缩进、换行与 BOM；无效 JSON 返回清晰的错误信息。

[未发布]: https://github.com/qinbaixi/BtTree/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/qinbaixi/BtTree/releases/tag/v0.1.0
