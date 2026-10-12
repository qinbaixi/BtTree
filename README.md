<div align="center">

# owl-bt

**基于 TypeScript 与 React 19 的行为树（Behavior Tree）编辑器**

[![Release](https://img.shields.io/github/v/release/qinbaixi/BtTree)](https://github.com/qinbaixi/BtTree/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.12-339933)

</div>

owl-bt 是一个行为树编辑器，灵感来自 Unreal Engine 的行为树。它支持装饰器（Decorator）和服务（Service）这类挂在节点上的子项，使树更小、更易读。项目和树都保存为普通 JSON，并可导出为 Erlang / Lua / TypeScript / C# / Go 配置，方便接入游戏服务端或客户端。

本仓库是 [owl-bt](https://github.com/pruttned/owl-bt)（AngularJS + Express 4）的 TypeScript / React 重写版，保持文件格式兼容。

## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [安装与使用](#安装与使用)
- [项目文件（owl-bt.json）](#项目文件owl-btjson)
- [项目编辑器（图形化编辑 owl-bt.json）](#项目编辑器图形化编辑-owl-btjson)
- [树文件（tree）格式](#树文件tree格式)
- [导出 Erlang / Lua / TypeScript / C# / Go](#导出-erlang--lua--typescript--c--go)
- [桌面版（Electron）](#桌面版electron)
- [键盘快捷键](#键盘快捷键)
- [本地 HTTP API](#本地-http-api)
- [开发](#开发)
- [贡献](#贡献)
- [许可](#许可)

## 功能

- **自动布局**：不需要手动摆放节点，树结构由编辑器自动排版。
- **键盘操作**：几乎所有编辑操作都可以只用键盘完成，`Ctrl+Shift+P` 打开命令面板。
- **项目热重载**：修改 `owl-bt.json` 后，正在编辑的树会实时更新，无需重新打开树。
- **撤销 / 重做**：所有编辑操作都支持撤销和重做。
- **未保存提示**：有未保存修改时，窗口标题显示 `*`，关闭或刷新页面前会询问。
- **JSON 格式**：项目和树都是普通 JSON 文件，方便接入任何游戏引擎。
- **项目插件**：可用 `owl-bt.js` 在加载或保存树时执行自定义逻辑，并可拒绝保存。
- **类型系统**：项目文件可定义节点、装饰器、服务，并支持继承、抽象类型、自定义属性类型。
- **多格式导出**：单个或批量导出为 Erlang / Lua / TypeScript / C# / Go 配置。
- **桌面版**：可一键打包为 Electron 应用（安装版和便携版），使用者无需安装 Node.js。
- **主题**：默认明亮主题，可切换为原版风格的深色主题。

## 快速开始

```sh
git clone https://github.com/qinbaixi/BtTree.git
cd BtTree
npm install
npm run dev          # 打开 http://localhost:5173
```

在首页点「Open folder…」选择 `samples/basic`，再点击 `trees/demo.json` 即可体验。只想要桌面程序：Windows 上双击 `package.bat`，在 `release/` 中取安装包。

## 目录结构

<details>
<summary>查看完整目录树</summary>

```text
.
├── .github/
│   └── workflows/
│       └── release.yml           # 推送 v* 标签时构建 Windows 安装包并发布到 GitHub Releases
├── scripts/
│   └── release-notes.mjs         # 从 CHANGELOG.md 提取指定版本的发布说明
├── packages/                     # npm workspaces
│   ├── shared/                   # @owlbt/shared：前后端共用的纯 TypeScript 核心（以源码形式被引用）
│   │   └── src/
│   │       ├── types.ts          # 项目文件、树文件、运行时模型的类型定义
│   │       ├── compileProject.ts # 项目编译：继承、抽象类型、自定义属性类型、默认颜色
│   │       ├── treeModel.ts      # 树 JSON 与运行时模型互转（保留未知字段）
│   │       ├── treeOps.ts        # 树的增删移动等操作（可在 immer draft 中使用）
│   │       ├── navigation.ts     # 键盘导航
│   │       ├── validation.ts     # 属性校验、缺失类型检查
│   │       ├── describe.ts       # 描述模板 {{Prop}} 替换
│       ├── projectEdit.ts     # 项目文件编辑（增删改名、继承、属性、自定义类型）与校验
│   │       ├── fuzzy.ts          # 模糊搜索与匹配高亮
│   │       └── export/           # 导出：节点编号、导出模型、Erlang / Lua / TS / C# / Go 生成器
│   ├── server/                   # @owlbt/server：Express 5 + socket.io 4 服务端与 owlbt CLI
│   │   ├── src/
│   │   │   ├── cli.ts            # owlbt 命令（init / create / open / export）
│   │   │   ├── run.ts            # 启动 HTTP + socket.io 服务
│   │   │   ├── app.ts            # Express 应用与静态资源
│   │   │   ├── routes.ts         # /api/* 路由（含 owl-bt.json 的读取与保存）
│   │   ├── projectFile.ts    # owl-bt.json 写入：sha256、缩进与换行保持
│   │   │   ├── project.ts        # 查找 owl-bt.json、加载 owl-bt.js 插件
│   │   │   ├── workspace.ts      # 目录扫描、初始化项目、新建树
│   │   │   ├── export.ts         # 单个 / 批量导出并写文件
│   │   │   ├── picker.ts         # 系统原生文件选择框（Windows / macOS / Linux）
│   │   │   ├── fileWatcher.ts    # 项目文件监视（500ms 防抖）
│   │   │   └── socket.ts         # /prj-watch 热重载推送
│   │   ├── templates/            # 新项目与新树的模板
│   │   └── scripts/              # 构建后把前端产物复制到 dist/public
│   ├── client/                   # @owlbt/client：Vite + React 19 编辑器前端
│   │   ├── scripts/              # gen-icons.mjs：生成 src/lib/faIcons.generated.ts（Font Awesome 实心图标名）
│   │   └── src/
│   │       ├── views/            # 首页（Home）、树编辑器（Editor）与项目编辑器（ProjectEditor）
│   │       ├── components/       # 画布、属性面板、类型面板、对话框、菜单等；ProjectEditor/ 为项目编辑器的各面板
│   │       ├── commands/         # 命令注册、快捷键、导出命令
│   │       ├── store/            # zustand 状态（树、项目、项目编辑器、提示、对话框、类型查看）
│   │       ├── lib/              # API 封装、剪贴板、最近打开、主题、页面跳转、图标列表等
│   │       └── styles/           # 全局样式与主题变量
│   └── desktop/                  # @owlbt/desktop：Electron 桌面版
│       ├── src/                  # 主进程：内嵌服务端、原生对话框、窗口管理
│       ├── scripts/              # 主进程打包（esbuild）、图标生成
│       ├── build/                # 应用图标
│       └── electron-builder.yml  # 安装包 / 便携版配置
├── samples/
│   └── basic/                    # 示例项目：owl-bt.json、owl-bt.js 插件、trees/demo.json
├── package.bat                   # Windows 一键打包桌面版
├── package.sh                    # macOS / Linux 一键打包桌面版
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

构建产物（均已加入 `.gitignore`）：`packages/*/dist/`、桌面版安装包 `release/`。

</details>

## 环境要求

- 运行 CLI（全局安装或 `npm run build` 之后）：Node.js **>= 22.12**。这是 `commander@15` 的要求，`@owlbt/server` 的 `engines` 字段也据此声明。
- 开发和测试：Node.js **>= 22.12**（Vitest 5 要求 `^22.12 || ^24 || >=26`，Vite 8 要求 `^20.19 || >=22.12`）。

## 安装与使用

<details>
<summary>开发模式、生产构建、全局安装、CLI 命令、端口与网络安全</summary>

### 开发模式

```sh
npm install
npm run dev
```

- 编辑器前端：http://localhost:5173
- 后端服务：http://127.0.0.1:9000。开发模式下后端端口默认为 9000，可用 `OWLBT_DEV_PORT` 修改；但 Vite 的代理目标写死在 `packages/client/vite.config.ts` 中（`/api` 和 `/socket.io`，目标为 `http://127.0.0.1:9000`），修改端口时需同步修改该文件。开发服务默认只监听 `127.0.0.1`，可用 `npm run dev -w @owlbt/server -- --host <host>` 或 `OWLBT_HOST` 改变（同样需要允许对应的 Host，见「网络与安全」）。
- 打开一个树：访问 `/tree?path=<树文件的绝对路径>`，例如 `http://localhost:5173/tree?path=D:\code\NodeJS\BtTree\samples\basic\trees\demo.json`。

### 生产模式（从源码构建）

```sh
npm run build
node packages/server/dist/cli.js open <树文件路径>
```

`npm run build` 会先构建前端（`packages/client/dist`），再用 tsup 构建 CLI 和服务端，最后把前端产物复制到 `packages/server/dist/public`。之后服务端即可独立提供页面，无需 Vite。

### 全局安装（npm pack）

```sh
npm run build
npm pack -w @owlbt/server          # 生成 owlbt-server-0.1.0.tgz
npm install -g ./owlbt-server-0.1.0.tgz
owlbt open <树文件路径>
```

`@owlbt/shared` 已由 tsup 打包进产物，安装包只依赖 `commander`、`express`、`open`、`socket.io` 等运行时依赖。

### CLI 命令

| 命令 | 别名 | 说明 |
| --- | --- | --- |
| `owlbt` | | 启动服务并打开首页 |
| `owlbt init [path]` | `i` | 在目录中创建 `owl-bt.json`（文件已存在时失败） |
| `owlbt create <path>` | `c` | 创建树文件（自动创建父目录）并打开；路径必须位于某个项目内 |
| `owlbt open <path>` | `o` | 打开已有的树文件 |
| `owlbt export <path>` | | 导出为 Erlang / Lua / TypeScript / C# / Go，见下文「导出 Erlang / Lua / TypeScript / C# / Go」；不启动服务 |
| `owlbt --no-open ...` | | 不打开浏览器，只打印 URL（适合测试和无界面环境） |
| `OWLBT_NO_OPEN=1` | | 与 `--no-open` 相同的环境变量形式 |
| `owlbt --host <host>` | | 监听指定的网卡地址（默认 `127.0.0.1`）。指定其他地址会暴露无认证的 API，见「网络与安全」 |
| `owlbt --trust-plugins` | | 不经过插件信任检查直接运行 `owl-bt.js`，见「项目插件」 |
| `OWLBT_TRUST_PLUGINS=1` | | 与 `--trust-plugins` 相同的环境变量形式 |
| `owlbt -V` / `owlbt -h` | | 版本号 / 帮助 |

如果服务已在目标端口运行，CLI 会打印 `owl-bt server already running on port <port>` 并以退出码 0 结束，不会重复启动服务。

示例：

```sh
owlbt init ./my-project
owlbt create ./my-project/trees/patrol.json --no-open
```

### 端口配置

生产模式（CLI）的端口按以下顺序确定：

1. 环境变量 `PORT`
2. 用户目录下的 `~/.owlbtrc`
3. 默认 `8955`

`~/.owlbtrc` 为 JSON 文件：

```json
{
  "port": 1234
}
```

无效的端口（非整数、超出 1–65535）会被忽略。

### 网络与安全

服务端的 API 没有登录认证，因此默认只接受本机的连接：

- **监听地址**：默认监听 `127.0.0.1`，同一台电脑上的其他用户或其他机器无法连接。`owlbt --host <host>` 可改为其他网卡地址（开发模式下还可用环境变量 `OWLBT_HOST`）。监听非回环地址时，服务端会在终端打印警告：API 没有认证，任何能连上它的人都可以读取和修改它提供的文件。
- **Host 检查**：所有请求（包括页面文件）的 `Host` 头的主机名必须是 `localhost`、`127.0.0.1`、`[::1]`，或由 `--host` 指定的地址；端口不检查。其他主机名返回 403（`Forbidden host`）。这可以防止 DNS 重绑定攻击，即恶意网页把自己的域名解析到 `127.0.0.1` 后读取本机的文件。
- **Origin 检查**：`GET` 与 `HEAD` 以外的请求，若带有 `Origin` 头，其主机名也必须是上述允许的主机，否则返回 403（`Forbidden origin`）。不带 `Origin` 的请求（如 `curl`）照常处理。WebSocket（`/socket.io`）连接同样检查。
- **使用 `--host` 时**：`--host` 指定的地址会被加入允许列表，浏览器应使用同一地址访问。`0.0.0.0` 与 `::` 这类通配地址不会加入允许列表，请使用本机的实际地址（如 `--host 192.168.1.5`）。

</details>

## 首页（打开树与项目）

首页（`/`）用于找到要编辑的树：输入路径、用系统对话框打开文件夹或树文件，或直接编辑项目类型。

<details>
<summary>打开文件夹 / 树文件、初始化项目、新建树、编辑项目类型</summary>

顶部有三个入口：

- **路径输入框**：输入树文件的完整路径（以 `.json` 结尾）会直接打开编辑器；输入文件夹路径则列出该文件夹中的树。
- **Open folder…**：调用本机的系统文件夹选择框，选中后列出该文件夹中的树。
- **Open tree file…**：调用本机的系统文件选择框（过滤为 `*.json`），选中后直接打开编辑器。

选择框在运行服务的机器上弹出，因此只适用于本地使用。若当前系统没有可用的选择框（例如 Linux 上未安装 `zenity` 或 `kdialog`），页面会显示提示，此时请直接在输入框中输入路径。选择框打开期间按钮会被禁用，并显示 `Waiting for the file dialog…`。

选择文件夹后，页面下方会出现工作区面板：

- **项目**：显示该文件夹所属的 `owl-bt.json`。若文件夹不在任何项目中，会显示提示，并可点击 **Initialize project here**，在该文件夹中写入 `owl-bt.json`（使用[默认模板](#默认模板)）和示例树 `trees/example.json`。
- **树列表**：列出该项目（或文件夹）中的所有树，点击即可打开编辑器。列表最多显示 500 个。
- **New tree**：输入相对于所选文件夹的文件名（例如 `trees/my-tree.json`，省略 `.json` 时会自动补上），点击 **Create** 会创建一棵由模板生成的树并打开。
- **Refresh**：重新扫描文件夹。**Close folder**：关闭工作区面板并忘记该文件夹。

所选文件夹会记在浏览器的 `localStorage`（键名 `owlbt.lastDir`）中，下次打开首页时自动恢复。

下方的 **Recent** 列表显示最近打开过的树。若没有最近记录，也没有打开的文件夹，首页中央会显示两个大按钮。

命令行同样可以创建项目和树：

```sh
owlbt init ./my-project                    # 只写入 owl-bt.json
owlbt create ./my-project/trees/patrol.json --no-open
```

</details>

## 项目文件（owl-bt.json）

项目文件定义树中可以使用的节点、装饰器、服务及其属性。CLI 会从树文件所在目录开始向上查找最近的 `owl-bt.json`，树文件必须位于项目目录之内。

<details>
<summary>类型字段、属性字段、自定义类型与完整示例</summary>

顶层字段：

- `types`：自定义属性类型（可选）
- `nodes`：节点类型（可选）
- `decorators`：装饰器类型（可选）
- `services`：服务类型（可选）
- `export`：导出设置（可选），见下文「导出 Erlang / Lua / TypeScript / C# / Go」

### 类型（items）的字段

节点、装饰器、服务共用以下字段（`isComposite` 只对节点有效）：

- `name`（必填）：类型名称
- `base`：继承的基类型，字符串或字符串数组（多重继承）。基类型必须存在，且不能循环继承
- `isAbstract`：为 `true` 时该类型只用于继承，不会出现在编辑器中
- `icon`：图标名，使用 Font Awesome 6 Free Solid 的图标名，不带 `fa-` 前缀，例如 `"arrow-right"`、`"person-walking"`
- `color`：颜色，CSS 写法（如 `"#bada55"`、`"green"`）。未设置时使用默认色：复合节点 `#d08038`、动作节点 `#955cc6`、服务 `#5cc690`、装饰器 `#5c90c6`
- `description`：描述模板，可用 `{{PropertyName}}` 引用属性值
- `isComposite`：仅节点，是否可以包含子节点
- `properties`：属性列表
- `export`：导出设置 `{ type?, subType?, fields? }`，继承规则与其他字段相同，见下文

### 属性（property）的字段

- `name`（必填）
- `type`：`"string"`、`"number"`、`"bool"`、`"enum"`，或 `types` 中定义的自定义类型名
- `default`：默认值
- `values`：`enum` 类型必填，允许的取值列表
- `min`、`max`：`number` 类型的取值范围
- `description`：属性说明
- `exportName`：导出时使用的名字，默认为属性名
- `exportTo`：`"properties"`（默认，写入节点的 `properties` 表）或 `"node"`（写到节点的顶层，如 `abort_mode`、`finish_once`）

### 自定义类型（types）

- `type`（必填）：`"string"` 或 `"number"`
- `pattern`：正则表达式，用于校验字符串值。校验时整体匹配（自动加上 `^(?:...)$`）

### 示例

```json
{
  "types": {
    "identifier": { "type": "string", "pattern": "[A-Za-z_][A-Za-z0-9_]*" }
  },
  "nodes": [
    {
      "name": "Sequence",
      "icon": "arrow-right",
      "isComposite": true,
      "description": "Runs children in order until one fails"
    },
    {
      "name": "MoveTo",
      "icon": "person-walking",
      "description": "Move to {{Target}} at speed {{Speed}}",
      "properties": [
        { "name": "Target", "type": "identifier", "default": "Enemy" },
        { "name": "Speed", "type": "number", "min": 0, "max": 600, "default": 200 },
        { "name": "Mode", "type": "enum", "values": ["Walk", "Run"], "default": "Walk" }
      ]
    }
  ],
  "decorators": [
    {
      "name": "Cooldown",
      "icon": "hourglass",
      "description": "Cooldown {{Seconds}}s",
      "properties": [{ "name": "Seconds", "type": "number", "min": 0, "default": 1 }]
    }
  ],
  "services": [
    {
      "name": "Sample service",
      "icon": "gear",
      "properties": [{ "name": "BlackboardKey", "type": "string", "default": "Target" }]
    }
  ]
}
```

描述模板只做属性值替换：`{{Name}}` 会被替换为该属性的当前值（未设置时使用默认值），不执行任何表达式。引用不存在的属性时，占位符会被替换为空字符串。

属性值不合法时（例如超出 `min` / `max`、不在 `values` 中、不匹配 `pattern`），树中对应的节点会显示为无效。类型不存在于项目文件中时，属性面板会显示 `Missing descriptor in project file` 错误。

</details>

## 默认模板

`owlbt init` 和首页的 **Initialize project here** 使用 `packages/server/templates/owl-bt.json` 作为 `owl-bt.json`。模板包含可以直接使用的类型，可作为编写自己项目的起点。

<details>
<summary>查看模板包含的类型</summary>

- **自定义类型**：`blackboardKey`（以字母或下划线开头的标识符，用于黑板键名）、`probability`（0 到 1 之间的小数）。
- **节点**：`Selector`、`Sequence`、`Parallel`（`Policy`：`RequireOne` / `RequireAll`）、`RandomSelector`（`Weights`），以及继承自抽象基类 `ActionBase`（属性 `Async`）的动作节点：`Wait`、`Log`、`MoveTo`、`SetBlackboardValue`、`Succeed`、`Fail`、`RandomChance`。
- **装饰器**：`Failure`、`Invert`、`Success`、`IsBlackboardValueSet`、`Cooldown`、`Loop`、`TimeLimit`。
- **服务**：`Sample service`、`UpdateTarget`、`LogTick`。

图标全部使用 Font Awesome 6 Free Solid 的图标名。`RandomSelector` 与 `Loop` 设置了自定义颜色，其余类型使用默认颜色。

Initialize project 还会写入 `trees/example.json`，它是一棵约 14 个节点的示例树，演示标签、注释、装饰器（含 `periodic` 与 `inverseCheckCondition`）以及带 `timeBetweenTicks` 的服务。模板中的 `templates/tree.json` 是只有一个 `Selector` 根节点的最小树，**New tree** 使用它。

</details>

## 项目编辑器（图形化编辑 owl-bt.json）

除了直接编辑 `owl-bt.json`，也可以在项目编辑器中图形化地管理节点、装饰器、服务的类型定义、自定义属性类型与导出设置。编辑器地址为 `/project?path=<owl-bt.json 或项目内任一树的绝对路径>`。

<details>
<summary>入口、功能、预览与保存规则</summary>

**入口**

- 首页工作区面板的「Edit project types」（项目存在时显示）。
- 树编辑器的「File → Edit project types…」。有未保存的树修改时会先询问是否保存；取消则不跳转。
- 属性面板中某个类型的「Edit in project」，打开后直接选中该类型。从树进入时，左上角会出现「← Back to tree」。

**页面布局**

- 左侧：类型列表，按「组合节点 / 行为节点 / 装饰器 / 服务」分组并显示数量。可搜索（`Ctrl+F`），抽象类型斜体并标注 abstract，显示「← 基类」提示。每行悬停可上移、下移、复制、删除；删除被其他类型继承的类型前会列出这些引用。有校验错误的类型显示红点，警告显示黄点。底部的「+ Node / + Decorator / + Service」新建类型。另有「Custom types」（自定义类型）与「Export settings」（导出设置）两个入口。
- 中间：所选类型的表单。名称（修改时同步更新其他类型的基类引用）、组合 / 抽象开关、基类（多选，禁止自身与循环继承）、图标（可输入名称，或「Choose…」打开图标选择框：Font Awesome 6 Free 实心图标，输入关键字过滤，方向键移动，Enter 选择，Esc 关闭）、颜色（取色器、十六进制输入、「Default」恢复默认、10 个预设色）、描述模板（点击属性名即可插入 `{{Name}}`，引用不存在的属性会给出警告）、属性表、导出字段与未知字段（只读显示，原样保留）。
- 属性表：自有属性可编辑（名称、类型、默认值、min/max、枚举值增删排序、自定义类型的正则只读显示、描述、导出名与导出位置）；从基类继承的属性以灰色只读显示并标注「from 基类名」。
- 右侧：实时预览。使用与树编辑器相同的节点卡片，同时显示明亮与深色两种主题；带装饰器与服务的示例节点（项目中没有组合节点时使用示例节点），可切换「With label」「Invalid」，并可在「Sample values」中填写属性值（只影响预览）。预览下方可展开查看编译后的类型 JSON。
- 自定义类型：表格编辑名称、基础类型（string / number）、正则，并可在「Test」中实时测试是否匹配；重命名会同时更新属性的类型。
- 导出设置：Erlang / Lua / TypeScript / C# / Go 的输出目录、文件名模板、C# 命名空间与 Go 包名，空白时使用默认值。
- 底部「Problems」栏列出校验问题（错误与警告），点击即可跳到对应的类型或自定义类型。

**保存与冲突**

- `Ctrl+S` 保存（也可用工具栏按钮）。`Ctrl+Z` / `Ctrl+Y` 撤销与重做（输入框内保留文本框自身的撤销）。连续在同一字段输入会合并为一步撤销。
- 写入前会检查内容能否编译（如缺失基类、循环继承）；不能编译时不保存，并在底部栏显示原因。仅有警告时可以保存。
- 保存时保留文件原有的缩进（Tab 或空格）、换行方式（LF / CRLF）与末尾换行，并保留所有未知字段。
- 文件在磁盘上被其他程序修改后，若没有未保存的修改，编辑器会自动重新载入并保留当前选中项；若有未保存的修改，顶部显示「项目文件已在磁盘上改变」，可选择「Reload」（放弃修改，使用磁盘内容）或「Keep mine」（保留修改，之后保存时会再次询问）。
- 保存时若文件已被修改，会弹出对话框：「Reload from disk」（放弃修改，重新载入）、「Overwrite」（用当前修改覆盖文件）或「Cancel」。
- 离开页面时若有未保存的修改，浏览器会提示确认。

</details>

## 树文件（tree）格式

树文件是一个 JSON 对象，表示根节点。子节点放在 `childNodes` 中，装饰器和服务放在 `decorators`、`services` 中。未知字段会被原样保留。

<details>
<summary>查看树文件结构与保存规则</summary>

```json
{
  "type": "Sequence",
  "name": "rootNode",
  "label": "Patrol",
  "comment": "Walk the route while points remain",
  "decorators": [
    {
      "type": "IsBlackboardValueSet",
      "properties": [{ "name": "Field", "value": "PatrolPoints" }]
    }
  ],
  "childNodes": [
    {
      "type": "MoveTo",
      "label": "Go to waypoint",
      "properties": [
        { "name": "Target", "value": "Waypoint" },
        { "name": "Speed", "value": 250 },
        { "name": "Mode", "value": "Run" }
      ],
      "decorators": [
        {
          "type": "Cooldown",
          "properties": [{ "name": "Seconds", "value": 2 }],
          "periodic": true
        }
      ]
    }
  ]
}
```

- 节点字段：`type`（必填）、`label`、`comment`、`properties`（`{name, value}` 数组）、`decorators`、`services`、`childNodes`
- 装饰器字段：`type`（必填）、`label`、`comment`、`properties`、`periodic`（每次 tick 重新评估）、`inverseCheckCondition`
- 服务字段：`type`（必填）、`label`、`comment`、`properties`、`timeBetweenTicks`、`firstTickTime`

示例树见 `samples/basic/trees/demo.json`，示例项目见 `samples/basic/owl-bt.json`。

</details>

## 导出 Erlang / Lua / TypeScript / C# / Go

树可以导出为 Erlang 模块（`get_node/1`、`get_root_node/0`）、Lua 模块（返回 `{ root, nodes, get_node }`）、TypeScript 模块（`nodes`、`getNode()`）、C# 静态类（`Nodes`、`GetNode()`）或 Go 源文件（`<前缀>Nodes`、`<前缀>GetNode()`）。Erlang 的输出格式与 `bt_mon_1000.erl` 这类手写配置保持一致。五种格式使用同一份导出模型：条目的编号、键的顺序和值完全相同，只有语法不同。

<details>
<summary>配置、节点编号、导出内容、各语言输出示例、命令行与编辑器用法</summary>

### 项目配置

项目文件顶层的 `export` 决定输出位置和文件名（均可省略）：

```json
"export": {
  "erlang": { "outDir": "export/erlang", "fileName": "{name}" },
  "lua": { "outDir": "export/lua", "fileName": "{name}" },
  "ts": { "outDir": "export/ts", "fileName": "{name}" },
  "cs": { "outDir": "export/cs", "fileName": "{name}", "namespace": "BehaviorTrees" },
  "go": { "outDir": "export/go", "fileName": "{name}", "package": "behaviortrees" }
}
```

- `outDir`：相对于项目目录。默认 `export/erlang`、`export/lua`、`export/ts`、`export/cs`、`export/go`
- `fileName`：文件名模板，`{name}` 为树文件名（不含 `.json`）。扩展名 `.erl` / `.lua` / `.ts` / `.cs` / `.go` 会自动补上，模板中已带扩展名时不重复
- Erlang 模块名取文件名（不含扩展名）：转为小写，`[a-z0-9_]` 以外的字符替换为 `_`，不以字母开头时加 `m_` 前缀。例如 `bt-mon 1000.json` 生成模块 `bt_mon_1000`
- `namespace`（仅 C#）：生成类所在的命名空间，由点分隔的 C# 标识符组成，例如 `Game.Ai`，默认 `BehaviorTrees`。不合法的值（如 `1Game`、含空格或 C# 关键字）回退为默认值，并作为警告返回
- C# 类名取文件名：按非字母数字字符分词，每个词首字母大写，例如 `bt_mon_1000` 生成类 `BtMon1000`；以数字开头时加 `_` 前缀，与 C# 关键字同名时加 `@` 前缀
- `package`（仅 Go）：生成文件的包名，必须是 Go 标识符，默认 `behaviortrees`。不合法的值（如 `1ai`、`game.ai`、Go 关键字）回退为默认值，并作为警告返回
- Go 标识符前缀取文件名：按字母和数字以外的字符分词，每个词首字母大写，例如 `bt_mon_1000` 生成 `BtMon1000RootID`、`BtMon1000Nodes`、`BtMon1000GetNode`。中文等非 ASCII 字母会保留（Go 标识符允许），不以大写字母开头时加 `Bt` 前缀，例如 `巡逻.json` 生成 `Bt巡逻RootID`。同一目录下的多个树因此可以放在同一个包里，但文件名只差标点或大小写的两棵树（如 `bt-mon` 与 `bt_mon`）会得到相同的前缀

类型的 `export` 设置（节点、装饰器、服务都可以用，继承时与其他字段一样被子类型覆盖）：

```json
{ "name": "Patrol", "export": { "subType": 27, "fields": { "finish_once": true } } }
```

- `type`：导出的 `type`。默认：复合节点 `composite`，动作节点 `task`，装饰器 `decorator`，服务 `service`
- `subType`：导出的 `sub_type`。默认为类型名的 snake_case（`RandomSelector` → `random_selector`）。数字保持数字；字符串在 Erlang 中为原子，在 Lua、TypeScript、C# 与 Go 中为字符串
- `fields`：常量字段，原样写到导出项的顶层（如 `"finish_once": true`）

属性的导出设置：

- `exportName`：导出时的名字，默认为属性名
- `exportTo`：`"properties"`（默认）写入该节点的 `properties` 表；`"node"` 写到节点顶层，适用于 `abort_mode`、`ignore_check`、`finish_once` 这类字段

### 编号

每个节点、装饰器和服务都获得 1 到 N 的整数编号，顺序为深度优先：根节点固定为 1，随后是根节点的装饰器和服务；其余每个节点先编号它的装饰器，再编号它的服务，然后是节点本身，最后递归编号子节点。

例如：根选择器 1；第一个子节点的装饰器 2、节点 3；第二个子节点的装饰器 4、节点 5；第三个子节点的服务 6、节点 7；节点 7 的子节点为序列 8（子节点 9、10）和任务 11。

### 导出内容

每个条目的键按以下顺序输出：

- 所有项：`node_id`、`type`、`sub_type`
- 装饰器：`inverse_check_condition`（始终输出），`periodic => true`（仅当为 true 时）
- 服务：`time_between_ticks`、`first_tick_time`（仅当设置时）
- 类型的 `fields` 常量
- `exportTo: "node"` 的属性（按声明顺序）
- 节点（复合与动作）：`decorators => [ids]`、`services => [ids]`
- `properties => #{...}`：`exportTo: "properties"` 的属性。动作节点、装饰器、服务总是输出；复合节点仅当类型声明了此类属性时输出
- 复合节点最后输出 `children => [ids]`

属性值为有效值：显式设置的值，否则为类型的默认值。两者都没有的属性不输出。

值的编码：

| 值 | Erlang | Lua | TypeScript | C# | Go |
| --- | --- | --- | --- | --- | --- |
| 整数 / 小数 | 原样（整数不带小数点） | 原样 | 原样 | `int`；超出 int32 的整数为 `123L`；小数为 `0.5`、`1.5E+21` | `int`；超出 int32 的整数为 `int64(123)`；小数为 `0.5`、`1.5e+21` |
| 布尔 | `true` / `false` | `true` / `false` | `true` / `false` | `true` / `false` | `true` / `false` |
| 字符串 | `<<"text"/utf8>>` | `"text"` | `'text'` | `"text"` | `"text"` |
| 枚举值 | 原子，如 `'Like This'` | 字符串 | 字符串 | 字符串 | 字符串 |
| null | `undefined` | `nil` | `null` | `null` | `nil` |
| 数组 | 列表 `[1,2]` | 表 `{1, 2}` | 数组 `[1, 2]` | `decorators` / `services` / `children` 为 `new int[] { 1, 2 }`，其他为 `new object[] { ... }` | `decorators` / `services` / `children` 为 `[]int{1, 2}`，其他为 `[]any{...}` |
| 对象 | map `#{k => v}` | 表 `{ k = v }` | 对象 `{ k: v }` | `new Dictionary<string, object> { ["k"] = v, }` | `map[string]any{"k": v}` |

Erlang 的 map 没有顺序，因此装饰器中 `inverse_check_condition` 固定排在 `abort_mode` / `ignore_check` 之前。

### TypeScript、C# 与 Go 输出

TypeScript 输出为一个模块：`BtNode` 接口、`rootId`、以编号为键的 `nodes`，以及 `getNode(id)`。开头大致如下：

```ts
// Generated by owl-bt from trees/bt_mon_1000.json. Do not edit.
export interface BtNode {
  node_id: number;
  type: string;
  sub_type: string | number;
  [key: string]: unknown;
}

export const rootId = 1;

export const nodes: Readonly<Record<number, BtNode>> = {
  // Selector - Root
  1: {
    node_id: 1,
    type: 'composite',
    sub_type: 'selector',
    decorators: [],
    services: [],
    children: [3, 5, 7],
  },
  ...
};

export function getNode(id: number): BtNode | undefined {
  return nodes[id];
}
```

C# 输出为一个静态类（命名空间与类名见上文）：`RootId` 为根编号，`Nodes` 为 `Dictionary<int, Dictionary<string, object>>`，`GetNode(int id)` 在编号不存在时返回 `null`。开头大致如下：

```csharp
// <auto-generated>
// Generated by owl-bt from trees/bt_mon_1000.json. Do not edit.
// </auto-generated>
using System.Collections.Generic;

namespace BehaviorTrees
{
    public static class BtMon1000
    {
        public const int RootId = 1;

        public static readonly Dictionary<int, Dictionary<string, object>> Nodes = new Dictionary<int, Dictionary<string, object>>
        {
            // Selector - Root
            [1] = new Dictionary<string, object>
            {
                ["node_id"] = 1,
                ["type"] = "composite",
                ["sub_type"] = "selector",
                ["decorators"] = new int[] { },
                ["services"] = new int[] { },
                ["children"] = new int[] { 3, 5, 7 },
            },
            ...
        };

        public static Dictionary<string, object> GetNode(int id)
        {
            Dictionary<string, object> node;
            return Nodes.TryGetValue(id, out node) ? node : null;
        }
    }
}
```

Go 输出为一个源文件（包名与标识符前缀见上文）：`<前缀>RootID` 为根编号，`<前缀>Nodes` 为 `map[int]map[string]any`，`<前缀>GetNode(id int)` 在编号不存在时返回 `nil`。开头大致如下：

```go
// Code generated by owl-bt from trees/bt_mon_1000.json. DO NOT EDIT.

package behaviortrees

// BtMon1000RootID is the id of the root node.
const BtMon1000RootID = 1

// BtMon1000Nodes holds every node, decorator and service by id.
var BtMon1000Nodes = map[int]map[string]any{
	// Selector - Root
	1: {
		"node_id":    1,
		"type":       "composite",
		"sub_type":   "selector",
		"decorators": []int{},
		"services":   []int{},
		"children":   []int{3, 5, 7},
	},
	...
}

// BtMon1000GetNode returns the item with the given id, or nil when there is none.
func BtMon1000GetNode(id int) map[string]any {
	return BtMon1000Nodes[id]
}
```

- TypeScript 与 C# 以 `Generated by owl-bt from <树文件>. Do not edit.` 开头，Go 以 Go 约定的 `Code generated by owl-bt from <树文件>. DO NOT EDIT.` 开头；每个条目之前是 `// <Type> - <label>` 注释，注释中的换行替换为空格
- TypeScript 使用 2 个空格缩进、单引号字符串和尾随逗号；不是合法标识符的键加引号
- C# 使用 4 个空格缩进，代码兼容 C# 7.3（Unity 使用的版本）：不使用 record、文件范围命名空间、target-typed new 或可空标注
- Go 输出已按 gofmt 格式化，需要 Go 1.18 及以上（使用 `any`）；只有出现 NaN 或无穷大时才导入 `math`。注意 Go 会按文件名后缀做构建约束，树文件名以 `_test`、`_linux`、`_windows` 等结尾时，可用 `fileName` 改名。键名重复时（如类型的 `export.fields` 与生成的字段同名）保留最后一个值，与 C# / Lua 的结果一致；`decorators` / `services` / `children` 不全是整数时写为 `[]any`

### 错误与警告

- 树中使用了项目中不存在的类型：导出失败，错误信息给出类型名和位置，例如 `Missing node type 'Nope' at root.childNodes[0]`，不写入任何文件
- 属性值不符合类型定义（如数字类型给了字符串）：仍然导出，并作为警告返回

### 命令行

```sh
owlbt export ./my-project/trees/patrol.json --format erlang,lua
owlbt export ./my-project --format lua --out ./build/bt
owlbt export ./my-project --format ts,cs
owlbt export ./my-project --format go
```

- 路径可以是树文件，也可以是目录（导出该目录所属项目中的全部树）
- `--format` 可选 `erlang`、`lua`、`ts`、`cs`、`go`，默认 `erlang,lua`；`--out` 覆盖所有格式的输出目录
- 每个写入的文件都会打印路径，警告输出到标准错误；只要有一个树导出失败，退出码为 1。命令不启动服务

### 编辑器

- 菜单 File 中的「Export: Erlang」「Export: Lua」「Export: TypeScript」「Export: C#」「Export: Go」，以及导出全部五种格式的「Export: All formats」，命令面板中也有同名命令。树有未保存的修改时先询问是否保存，保存失败或取消则不导出
- 首页打开文件夹后，「导出」区域可以一次导出整个项目。可勾选 Erlang、Lua、TypeScript、C#、Go，未保存过选择时默认勾选 Erlang 与 Lua。勾选的格式保存在浏览器中（`owlbt.exportFormats`），结果列表按树显示写入的文件、警告或错误

### 示例

导出项目中的 `trees/bt_mon_1000.json`（使用默认的输出设置）会生成 `export/erlang/bt_mon_1000.erl` 和 `export/lua/bt_mon_1000.lua`。Erlang 文件的开头大致如下：

```erlang
%% -*- coding: utf-8 -*-
%%------------------------------------------------------------------------------
%% @File   : bt_mon_1000
%% @Generated by owl-bt from trees/bt_mon_1000.json. Do not edit.
%%------------------------------------------------------------------------------
-module(bt_mon_1000).
-export([
    get_node/1,
    get_root_node/0
]).

%% Selector - Root
get_node(1) ->
    #{
        node_id => 1,
        type => composite,
        sub_type => selector,
        decorators => [],
        services => [],
        children => [3,5,7]
    };
```

</details>

## 项目插件（owl-bt.js）

如果项目目录中存在 `owl-bt.js`，服务端会在加载和保存树时调用它；插件需要在编辑器中确认信任后才会运行。

<details>
<summary>插件接口与信任机制</summary>

插件必须是 CommonJS 模块，导出包含以下可选钩子的对象：

- `onTreeLoad(ctx)`：加载树时调用。修改 `ctx.tree` 即可改变返回给编辑器的内容。
- `onTreeSave(ctx)`：保存树时调用。修改 `ctx.tree` 会写入文件。返回 `false` 会拒绝保存（HTTP 409），返回字符串会以该字符串作为原因拒绝保存（HTTP 409）。返回其他值（包括 `undefined`）则正常保存。

`ctx` 的字段：`tree`（树内容）、`path`（树文件路径）、`project`（已解析的 `owl-bt.json`）、`projectPath`（`owl-bt.json` 路径）。

### 插件信任

`owl-bt.js` 会在你的电脑上执行代码，因此只有在你信任它之后才会运行。信任按文件内容的 sha256 记录：

- 编辑器打开的树所属项目中若有未信任的 `owl-bt.js`，编辑器顶部会显示提示，插件不会运行，树照常加载和保存。点击 **Trust and run** 信任当前内容并重新加载树，点击 **Dismiss** 只隐藏提示。
- 信任之后修改 `owl-bt.js`，插件会再次变为未信任（提示中会说明插件“changed since you trusted it”），需要重新信任。
- 信任记录保存在信任文件中。默认位置为 `~/.owlbt/trusted-plugins.json`（Windows 为 `%USERPROFILE%\.owlbt\trusted-plugins.json`）；可用环境变量 `OWLBT_TRUST_FILE` 指定其他文件。桌面版使用用户数据目录下的 `trusted-plugins.json`。信任文件损坏或缺失时，所有插件都视为未信任。
- 撤销信任：删除信任文件中对应的条目，或调用 `POST /api/plugin/revoke`。
- `owlbt --trust-plugins`（或 `OWLBT_TRUST_PLUGINS=1`）跳过检查，直接运行所有项目的插件。只在你完全信任所打开的项目时使用。

相关接口见「本地 HTTP API」中的 `/api/plugin`。

插件在每次请求时重新加载，修改后无需重启服务（修改后需重新信任才会运行）。示例：

```js
'use strict';

module.exports = {
  onTreeLoad() {},

  onTreeSave(ctx) {
    if (ctx.tree.label === 'forbidden') {
      return 'Root label must not be "forbidden"';
    }
    return undefined;
  },
};
```

</details>

## 键盘快捷键

`mod` 在 Windows / Linux 上是 `Ctrl`，在 macOS 上是 `Cmd`。

<details>
<summary>查看全部快捷键</summary>

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Shift+P` | 打开命令面板 |
| `Ctrl+S` | 保存 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |
| `Ctrl+C` | 复制 |
| `Ctrl+V` | 粘贴 |
| `Ins` | 添加（节点的子节点，或装饰器 / 服务） |
| `Del` | 删除 |
| `↑` / `↓` | 选择上一项 / 下一项（装饰器、服务、子节点之间移动） |
| `←` / `→` | 选择左侧 / 右侧节点 |
| `Shift+←` / `Shift+→` | 左移 / 右移节点 |
| `Shift+↑` / `Shift+↓` | 上移 / 下移装饰器或服务 |

「聚焦选中节点」和「设置节点类型」没有默认快捷键，可在命令面板（`Ctrl+Shift+P`）中执行。

</details>

## 本地 HTTP API

服务端在 `/api` 下提供以下接口，全部为本机使用的 JSON / 纯文本接口。写入请求的 `Content-Type` 必须是 `application/json`，否则返回 415。错误响应为纯文本（除非另有说明）。

<details>
<summary>查看接口列表</summary>

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查，返回 `{ "ok": true }` |
| `GET` | `/api/project?path=<树文件绝对路径>` | 返回该树所属 `owl-bt.json` 的原始内容。无项目时 404 |
| `GET` | `/api/project/meta?path=<树文件或 owl-bt.json 绝对路径>` | 返回 `{ path, hash, content }`：项目文件的绝对路径、内容哈希（sha256）与原始文本，供项目编辑器使用 |
| `PUT` | `/api/project?path=<树文件或 owl-bt.json 绝对路径>` | 保存项目。请求体 `{ content, baseHash, force? }`：内容不能编译时 400；文件哈希与 `baseHash` 不一致且未 `force` 时 409（`{ message, currentHash }`）；成功返回 `{ hash }`。保留缩进、换行与未知字段 |
| `GET` | `/api/tree?path=<树文件绝对路径>` | 返回树（经 `onTreeLoad` 处理）。路径不在项目内时 403；文件不是合法 JSON 时 422，响应 `{ message: "Invalid JSON in tree file: ..." }`。文件开头的 UTF-8 BOM 会被忽略。项目有插件时响应头 `X-Owlbt-Plugin` 为 `trusted`、`changed` 或 `untrusted` |
| `POST` | `/api/tree?path=<树文件绝对路径>` | 保存树。可能被 `onTreeSave` 拒绝（409）。保留原文件的缩进、换行与 BOM；新文件使用制表符缩进 |
| `GET` | `/api/plugin?path=<树文件或 owl-bt.json 绝对路径>` | 项目插件的信任状态：`{ pluginPath, trusted, changed }`；项目没有 `owl-bt.js` 时 `{ pluginPath: null }` |
| `POST` | `/api/plugin/trust` | 请求体 `{ path }`（项目内的路径）。信任项目当前的 `owl-bt.js`，返回状态。项目没有插件时 404 |
| `POST` | `/api/plugin/revoke` | 请求体 `{ path }`。撤销对项目插件的信任，返回状态。项目没有插件时 404 |
| `GET` | `/api/workspace?dir=<绝对目录或文件>` | 列出树文件，见下文 |
| `POST` | `/api/project/init` | 初始化项目，见下文 |
| `POST` | `/api/tree/create` | 创建树文件，见下文 |
| `POST` | `/api/dialog/pick` | 打开本机的系统文件 / 文件夹选择框，见下文 |
| `POST` | `/api/export` | 导出单个树为 Erlang / Lua / TypeScript / C# / Go，见「导出 Erlang / Lua / TypeScript / C# / Go」 |
| `POST` | `/api/export/batch` | 导出项目中的全部树，见「导出 Erlang / Lua / TypeScript / C# / Go」 |

**`GET /api/workspace?dir=...`**

- `dir` 必须是绝对路径；若是文件，则使用它所在的文件夹。文件夹不存在时 404，`dir` 不是绝对路径时 400。
- 若能从 `dir` 向上找到 `owl-bt.json`，返回 `projectPath` 与 `projectDir`，并以项目目录为扫描根目录；否则以 `dir` 为根。
- 递归扫描至多 6 层子目录，跳过 `node_modules`、以 `.` 开头的目录，以及 `owl-bt.json`、`package.json`、`package-lock.json`、`tsconfig*.json`。只有顶层为对象且含字符串 `type` 字段的 JSON 才算树；超过 5 MB 或无法解析的文件忽略。
- 响应：`{ "dir", "projectPath?", "projectDir?", "trees": [{ "path", "relPath" }], "truncated" }`。`trees` 按 `relPath` 排序，最多 500 项，超出时 `truncated` 为 `true`。

**`POST /api/project/init`**，请求体 `{ "dir": "<绝对目录>" }`

- 在已存在的目录中写入 `owl-bt.json`（使用默认模板）和 `trees/example.json`（已存在则保留）。
- 目录不存在返回 404；目录已在项目中，或已存在 `owl-bt.json`，返回 409。
- 成功时返回该目录的工作区信息（同 `GET /api/workspace`）。

**`POST /api/tree/create`**，请求体 `{ "path": "<绝对路径>" }`

- 路径不以 `.json` 结尾时自动补上。路径必须位于某个项目内（否则 403 `Path must be in project`），文件已存在返回 409。
- 自动创建父目录，内容为 `templates/tree.json`。成功时返回 `{ "path": "<实际写入的路径>" }`。

**`POST /api/dialog/pick`**，请求体 `{ "kind": "folder" | "file", "initialDir?": "<绝对路径>" }`

- 在运行服务的机器上打开系统选择框。用户取消时返回 `{ "cancelled": true }`，否则返回 `{ "path": "<所选路径>" }`。
- `initialDir` 为起始文件夹；若是文件则取其所在文件夹，不存在时忽略。
- Windows 使用 PowerShell 的 WinForms 对话框，macOS 使用 `osascript`，Linux 依次尝试 `zenity` 与 `kdialog`。
- 没有可用的选择框时返回 `501 { "message": "..." }`；已有选择框打开时返回 409；超过 10 分钟视为取消。

</details>

## 桌面版（Electron）

`packages/desktop` 把编辑器打包成 Windows 桌面应用。服务端在应用进程内启动，只监听 `127.0.0.1`，界面在独立窗口中显示，不需要单独启动浏览器或命令行。

<details>
<summary>一键打包、产物、用户数据与说明</summary>

### 一键打包

在仓库根目录（或资源管理器中）运行：

| 平台 | 命令 | 说明 |
| --- | --- | --- |
| Windows | 双击 `package.bat`，或 `cmd /c package.bat` | 没有 `node_modules` 时先执行 `npm ci`，完成后打开 `release` 文件夹；失败时暂停并显示错误 |
| macOS / Linux | `bash package.sh` | 为当前系统构建（dmg / AppImage） |
| 任意平台 | `npm run package` | Windows 的安装包与便携版，等同于 `package.bat` 的构建部分 |

其他命令：`npm run package:dir` 只生成未打包的 `release/win-unpacked/`（更快，用于本地检查）；`npm run desktop` 构建后直接以桌面窗口运行（开发调试）。`package.bat` 设置 `OWLBT_NONINTERACTIVE=1` 时不打开资源管理器，也不暂停。

首次构建需要联网下载 Electron 二进制和 electron-builder 的 NSIS 工具。

### 产物

产物位于仓库根目录的 `release/`（已加入 `.gitignore`）：

- 安装包：`release/owl-bt-setup-x.y.z.exe`（NSIS，可选择安装目录，创建桌面和开始菜单快捷方式）
- 便携版：`release/owl-bt-portable-x.y.z.exe`（无需安装，直接运行）
- 未打包目录：`release/win-unpacked/owl-bt.exe`

### 用户数据

窗口位置和大小保存在 `%APPDATA%\owl-bt\window-state.json`。浏览器的本地存储（如界面偏好）保存在同一目录下。

### 说明

- 插件信任记录保存在用户数据目录的 `trusted-plugins.json`（可用 `OWLBT_TRUST_FILE` 覆盖），见「项目插件」中的「插件信任」。
- 服务端固定使用端口 `18955`（只监听本机）；该端口被占用时依次尝试 `18956` 到 `18975`。端口会影响浏览器本地存储的隔离，所以尽量保持 `18955`。
- 应用是单实例的：再次启动时会激活已有窗口，并打开传入的 `.json` 树文件。
- 首页的“打开文件 / 打开文件夹”使用系统原生对话框。
- 服务端的模板目录通过环境变量 `OWLBT_TEMPLATES_DIR` 指定，打包版自动设置。
- 开发调试：`Ctrl+Shift+I` 打开开发者工具（打包版需设置 `OWLBT_DEVTOOLS=1`）。

</details>

## 与原版 owl-bt 的主要差异

<details>
<summary>查看差异列表</summary>

- **技术栈**：TypeScript 单仓库（npm workspaces），前端使用 React 19 + Vite，后端使用 Express 5 + socket.io 4，原版为 AngularJS 1.x、Express 4、socket.io 1.7。
- **图标**：使用 Font Awesome 6 Free Solid（原版 README 描述的是 Font Awesome 旧版的 `fa-` 图标名）。
- **未保存提示**：窗口标题在有未保存修改时显示 `*`，离开页面前会询问。
- **描述模板**：只做属性值替换，不执行表达式。
- **请求体上限**：写入树文件的请求体上限为 50 MB（Express 默认的 JSON 上限为 100 KB）。
- **错误处理**：服务端异常以纯文本响应返回而不会导致进程崩溃；项目文件的热重载错误会以提示显示，且在项目重新解析成功后自动消失。

</details>

## 开发

在仓库根目录执行：

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装所有 workspace 的依赖 |
| `npm run dev` | 同时启动后端（9000）和前端（5173） |
| `npm run build` | 构建前端，再构建服务端并复制前端产物 |
| `npm test` | 运行所有测试（Vitest） |
| `npm run typecheck` | 对所有包执行 TypeScript 类型检查 |
| `npm run lint` | 运行 ESLint |
| `npm run desktop` | 构建后以桌面窗口运行 |
| `npm run package` | 打包 Windows 安装版与便携版到 `release/` |
| `npm run package:dir` | 只生成 `release/win-unpacked/`，用于快速检查 |

提交前请确保 `npm run typecheck`、`npm run lint`、`npm test` 全部通过；发布工作流在打包前也会运行这些检查。

## 贡献

欢迎提交 Issue 和 Pull Request，流程和代码约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 致谢

本项目基于 Peter Ruttkay-Nedecký 的 [owl-bt](https://github.com/pruttned/owl-bt)，沿用了其文件格式、交互设计与部分测试用例。

## 许可

[MIT](LICENSE)
