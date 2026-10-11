# 更新日志

本文件记录所有值得注意的变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

- 项目编辑器（`/project`）：图形化编辑 `owl-bt.json`，包括类型列表与分组、类型表单（名称、基类、图标选择框、颜色、描述模板）、属性表、导出字段、自定义类型（含正则测试）、导出设置、实时预览（明亮 / 深色主题）、校验问题栏、撤销 / 重做与快捷键。
- 项目编辑器保存：保留缩进、换行与未知字段；磁盘文件被修改时提示重新载入或覆盖，并支持热重载。
- 服务端：`GET /api/project/meta` 返回项目文件的路径、哈希与原始文本；`PUT /api/project` 保存项目（内容不能编译时 400，哈希冲突时 409）。
- 入口：首页工作区的「Edit project types」、树编辑器「File → Edit project types…」、属性面板的「Edit in project」。
- 共享核心：`projectEdit` 提供类型与属性的增删改名、继承与自定义类型操作，以及 `validateProjectFile` 校验。
- 图标列表：`npm run gen:icons -w @owlbt/client` 从 Font Awesome 6 Free 生成实心图标名称列表。
- 项目插件信任：未信任的 `owl-bt.js` 不再运行，编辑器顶部提示可「Trust and run」或「Dismiss」；服务端新增 `GET /api/plugin`、`POST /api/plugin/trust`、`POST /api/plugin/revoke`，`GET /api/tree` 增加 `X-Owlbt-Plugin` 响应头。CLI 新增 `--trust-plugins`（或 `OWLBT_TRUST_PLUGINS=1`）恢复旧行为。
- CLI 与开发服务新增 `--host <host>`（开发服务还支持 `OWLBT_HOST`）。

### 安全

- 服务端默认只监听 `127.0.0.1`。指定其他地址（`--host` / `OWLBT_HOST`）时，终端会警告 API 没有认证。
- 所有请求检查 `Host`，只允许 `localhost`、`127.0.0.1`、`[::1]` 与 `--host` 指定的地址，其他返回 403，防止 DNS 重绑定。`GET` 与 `HEAD` 以外的请求，以及 WebSocket 连接，若带有 `Origin` 也必须来自允许的主机，否则返回 403。
- 项目插件的信任按文件内容的 sha256 记录在 `~/.owlbt/trusted-plugins.json`（可用 `OWLBT_TRUST_FILE` 指定，桌面版位于用户数据目录）。插件内容变化后需要重新信任；信任文件损坏时视为未信任。

### 变更

- 桌面版产物更名为 `owl-bt-setup-<版本>.exe`（安装包）与 `owl-bt-portable-<版本>.exe`（便携版），文件名不含空格。
- 开发模式下 Vite 的代理目标改为 `http://127.0.0.1:9000`。

### 修复

- `PUT /api/project` 与 `POST /api/tree` 按文件串行执行，并以临时文件加重命名的方式原子写入。同一 `baseHash` 的并发保存只有一个成功，另一个返回 409，不再丢失更新。
- 树文件以 UTF-8 BOM 开头时可以正常加载；JSON 无效时 `GET /api/tree` 返回 422 与具体错误，编辑器显示该错误。
- 保存树时保留原文件的缩进（空格或制表符）、CRLF 换行与 BOM；新文件仍使用制表符缩进。
- 类型与属性的名称保存时去除首尾空白（`addType`、`addProperty`、`updateProperty`、`setCustomType`、`renameType`、`renameCustomType`）。
- 类型名 `__proto__`、`constructor`、`prototype` 以及空白名称被拒绝；`validateProjectFile` 将其报告为错误。编译结果的类型表不再使用普通对象，避免这些名称影响对象原型。
- 项目编辑器与树编辑器：撤销或重做回到已保存的内容时不再标记为未保存；撤销记录被截断或保存后又编辑时仍保持未保存。
- 桌面版：应用启动过程中再次启动时，传入的树文件在窗口就绪后打开，不再被丢弃。

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

### 变更（相对原版 owl-bt）

- 图标改用 Font Awesome 6 Free Solid 名称。
- 描述模板只做属性值替换，不再执行表达式。
- 保存请求体上限提高到 50 MB；服务端异常不再导致进程退出。

[未发布]: https://github.com/<owner>/<repo>/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<owner>/<repo>/releases/tag/v0.1.0
