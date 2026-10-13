# 更新日志

本文件记录所有值得注意的变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.2.0] - 2026-10-13

新增运行模式：在编辑器中按 tick 模拟执行行为树，可编辑黑板、使用测试场景、设置断点、回放和循环运行；新增 Go 导出格式，并整体优化了性能。

### 新增

- 运行模式：在树编辑器中模拟执行行为树（`F5` 进入，`F8` 播放 / 暂停，`F10` 单步）。按 tick 运行，画布上显示节点的运行 / 成功 / 失败状态以及装饰器、服务的状态；支持速度调节、重置、手动节点（Succeed / Fail）、断点、时间轴回放和可过滤的运行日志；运行中树为只读。
- 运行模式的黑板与场景：可编辑起始黑板、实时修改正在运行的黑板，并把黑板保存为 `owl-bt.json` 中的场景；可为所选节点设置仅限本次运行的属性覆盖值。
- 项目文件新增可选的 `simulate`（类型的模拟规则：`mode`、`duration`、`condition`、`effects`、`composite`、`decorator`、`count`、`ticks`，按字段继承）和 `scenarios`（命名的起始黑板）；旧项目不受影响，未知字段仍原样保留。
- 共享包新增 `runtime`：不使用 `eval` 的表达式解析器和确定性的行为树模拟引擎（Sequence / Selector / Parallel / RandomSelector、条件与 periodic 装饰器、invert / forceSuccess / forceFailure / loop / cooldown / timeLimit、服务、带种子的随机）。
- 项目编辑器：类型表单新增可折叠的「Simulation」区并即时校验表达式，新增「Scenarios」视图；`validateProjectFile` 会报告无效的 simulate 表达式和重复的场景名。
- 运行模式支持循环运行：工具条新增「Loops」输入框（0 = 一直循环，默认 1，会记住上次的值）。每次运行之间保留黑板、tick 计数和冷却，节点状态、loop 装饰器和服务重新开始；工具条显示「Run 2/5」，日志带「Run N」标记、结果标签和分隔线，历史只保留最近 5000 个 tick。
- 运行日志：按 tick 分组折叠，折叠时显示节点编号（与导出的 `node_id` 一致）、名称、类型、带参数的描述和运行状态，展开后按树深度缩进显示进入节点、结果、装饰器、服务和黑板变化；面板高度可拖动调整，支持全部展开 / 折叠和回放到某个 tick。
- 运行模式下节点卡片显示 `#编号` 标签，可在日志顶部关闭。
- 工具条的播放和暂停改为两个独立按钮，Run 菜单同样分开。
- 导出：新增 Go 格式（`export/go/*.go`），可在菜单、首页批量导出和命令行（`--format go`）中使用；包名可在 `owl-bt.json` 的 `export.go.package` 中配置。
- 示例 `samples/simulation`（守卫行为树与三个场景）；默认模板为内置节点和装饰器预置了 simulate 规则。

### 变更

- 性能与内存优化：导出、批量导出、目录扫描、校验、布局、画布选中和树查找更快，大型树导出 Go 时不再崩溃；新增性能基准测试。

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

[未发布]: https://github.com/qinbaixi/BtTree/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/qinbaixi/BtTree/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/qinbaixi/BtTree/releases/tag/v0.1.0
