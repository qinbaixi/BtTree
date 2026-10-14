# 更新日志

本文件记录所有值得注意的变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

- 树编辑器支持多标签页：画布上方的标签栏可同时打开多棵树（也可来自不同项目），切换时保留各自的选中项、撤销 / 重做历史、未保存状态和画布视图；新增「Open tree…」（`Ctrl+O`）、「Save all」（`Ctrl+Shift+S`）和「Close tab」（`Ctrl+W` / `Ctrl+F4`），`Ctrl+Tab` / `Ctrl+PageDown` 等切换标签页；关闭未保存的标签页时询问 Save / Discard / Cancel；打开的标签页保存在 `localStorage` 中，下次自动恢复。
- 桌面版窗口标题显示当前树的文件名，任一标签页有未保存修改时带 `*`。
- 桌面版左下角显示当前版本，并在启动时检查 GitHub Releases 是否有新版本。安装版点击即可下载新版本，下载完成后点击「Restart to update」立即重启安装，或在下次关闭应用时自动安装；便携版点击后打开下载页面。
- 发布流程额外上传 `latest.yml`，供已安装的应用检查和下载更新。
- 树编辑器支持拖放：拖动节点到其他节点的前面 / 后面或组合节点内部来移动子树，拖动装饰器 / 服务调整顺序或移到其他节点；画布显示放置位置提示，非法位置（根节点、自身或子孙节点、非组合节点）不可放置，一次拖放为一步撤销，运行模式下禁用。
- 树编辑器支持折叠 / 展开子树：卡片底部的折叠按钮、`Space` 快捷键以及「Collapse all」/「Expand all」命令；折叠后显示隐藏的节点数「+N」，状态按树保存在浏览器本地，不写入树文件；选中、导航、搜索或运行进入折叠分支时自动展开。
- 树内搜索（`Ctrl+F`）：按类型、标签、注释和属性值匹配节点、装饰器和服务，显示「当前 / 总数」并在画布上高亮，`Enter` / `Shift+Enter` 逐个跳转，`Esc` 关闭。
- 查找项目范围的用法：树编辑器属性面板查看类型时、项目编辑器的类型表单和黑板视图中新增「Find usages in project」，列出项目所有树中使用该类型（或在 `blackboardKey` 属性中引用该黑板键）的位置，点击即打开对应的树并选中该项；树编辑器地址新增 `select` 参数。
- 批量重命名：在项目编辑器中重命名类型或黑板键并保存后，可一键「Also update N tree files」改写所有树文件（保留缩进、换行和 BOM），在浏览器中打开且有未保存修改的树会被跳过。新增接口 `GET /api/usages` 与 `POST /api/references/rename`。
- 黑板键声明：`owl-bt.json` 新增可选的顶层 `blackboard`（`name`、`type`、`default`、`description`，未知字段原样保留，旧项目不受影响）；项目编辑器新增「Blackboard」视图并校验重复、不合法的键名；类型为 `blackboardKey` 的属性在属性面板中补全已声明的键，值不是已声明的键时给出警告；运行模式没有场景时用声明的键和默认值作为起始黑板，并可「Add declared keys」。默认模板和 `samples/simulation` 已声明示例键。
- 工作区扫描现在也能识别带 UTF-8 BOM 的树文件。
- 子树引用：节点类型可设置 `"subtree": true`（可继承），该类型的节点通过 `Tree` 属性（相对项目目录的路径）引用另一棵树，公共逻辑只写一次。默认模板新增 `SubTree` 节点，示例 `samples/simulation` 新增引用 `guard.json` 的 `sentry.json`；旧项目和旧树文件不受影响。
- 编辑器：子树引用节点卡片有独特外观并显示被引用的树名；属性面板可从项目树文件中选择引用、预览被引用树的第一层；双击、右键菜单、命令面板或 `Ctrl+Enter` 在新标签页中打开被引用的树。缺失文件、项目外路径和循环引用会把节点标为无效并列入树概览的问题列表。项目编辑器的类型表单新增「Subtree reference」开关。
- 运行模式：子树引用节点把被引用的树作为子节点运行，共享黑板，日志显示进入子树；带循环和深度保护，运行前会重新加载被引用的树。
- 导出：`owl-bt.json` 新增 `export.subtrees`：`"reference"`（默认，引用节点导出 `subtree` 字段，值为被引用树的名字）或 `"inline"`（原地展开被引用的树，循环引用时报错），适用于五种格式的单个、批量和命令行导出，可在项目编辑器的「Export settings」中设置。
- 本地 API 新增 `POST /api/subtrees`，递归加载子树引用。
- 运行模式支持后退一步：工具条新增「Back」按钮（`Shift+F10`），撤销最近一个 tick，节点状态、黑板、手动节点、随机数和循环轮数都回到上一个 tick，之后再 Step / Play 会从该状态继续执行。
- 场景测试：新增 `owlbt test [path]` 命令，不启动服务即可用模拟引擎批量运行「树 × 场景」并检查期望，支持 `--json`、`--junit <file>`、`--tree`、`--scenario`；退出码 0 通过、1 失败、2 配置错误，适合 CI。
- 场景新增可选字段 `trees`、`maxTicks`、`seed`、`manual` 和 `expect`（`result`、`ticks`、`blackboard`），由 `validateProjectFile` 校验；旧项目不受影响，未知字段原样保留。`samples/simulation` 的场景已加上期望。
- 项目编辑器的「Scenarios」视图可编辑测试期望（期望结果、tick 数、Max ticks、手动节点结果、适用的树、期望的黑板值），并新增「Run scenario tests」按钮显示测试结果（接口 `POST /api/scenario-tests`）。

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
