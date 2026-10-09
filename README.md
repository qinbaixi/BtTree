# owl-bt

owl-bt 是一个行为树（Behavior Tree）编辑器，灵感来自 Unreal Engine 的行为树。它支持装饰器（Decorator）和服务（Service）这类挂在节点上的子项，使树更小、更易读。

本仓库是 owl-bt 的 TypeScript / React 重写版（原版为 AngularJS + Express 4 的 JavaScript 项目，见 `D:\code\NodeJS\owl-bt`）。

## 功能

- **自动布局**：不需要手动摆放节点，树结构由编辑器自动排版。
- **键盘操作**：几乎所有编辑操作都可以只用键盘完成，`Ctrl+Shift+P` 打开命令面板。
- **项目热重载**：修改 `owl-bt.json` 后，正在编辑的树会实时更新，无需重新打开树。
- **撤销 / 重做**：所有编辑操作都支持撤销和重做。
- **未保存提示**：有未保存修改时，窗口标题显示 `*`，关闭或刷新页面前会询问。
- **JSON 格式**：项目和树都是普通 JSON 文件，方便接入任何游戏引擎。
- **项目插件**：可用 `owl-bt.js` 在加载或保存树时执行自定义逻辑，并可拒绝保存。
- **类型系统**：项目文件可定义节点、装饰器、服务，并支持继承、抽象类型、自定义属性类型。

## 环境要求

- 运行 CLI（全局安装或 `npm run build` 之后）：Node.js **>= 22.12**。这是 `commander@15` 的要求，`@owlbt/server` 的 `engines` 字段也据此声明。
- 开发和测试：Node.js **>= 22.12**（Vitest 5 要求 `^22.12 || ^24 || >=26`，Vite 8 要求 `^20.19 || >=22.12`）。

## 安装与使用

### 开发模式

```sh
npm install
npm run dev
```

- 编辑器前端：http://localhost:5173
- 后端服务：http://localhost:9000。开发模式下后端端口默认为 9000，可用 `OWLBT_DEV_PORT` 修改；但 Vite 的代理目标写死在 `packages/client/vite.config.ts` 中（`/api` 和 `/socket.io`），修改端口时需同步修改该文件。
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
| `owlbt --no-open ...` | | 不打开浏览器，只打印 URL（适合测试和无界面环境） |
| `OWLBT_NO_OPEN=1` | | 与 `--no-open` 相同的环境变量形式 |
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

## 首页（打开树与项目）

首页（`/`）用于找到要编辑的树。顶部有三个入口：

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

## 项目文件（owl-bt.json）

项目文件定义树中可以使用的节点、装饰器、服务及其属性。CLI 会从树文件所在目录开始向上查找最近的 `owl-bt.json`，树文件必须位于项目目录之内。

顶层字段：

- `types`：自定义属性类型（可选）
- `nodes`：节点类型（可选）
- `decorators`：装饰器类型（可选）
- `services`：服务类型（可选）

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

### 属性（property）的字段

- `name`（必填）
- `type`：`"string"`、`"number"`、`"bool"`、`"enum"`，或 `types` 中定义的自定义类型名
- `default`：默认值
- `values`：`enum` 类型必填，允许的取值列表
- `min`、`max`：`number` 类型的取值范围
- `description`：属性说明

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

## 默认模板

`owlbt init` 和首页的 **Initialize project here** 使用 `packages/server/templates/owl-bt.json` 作为 `owl-bt.json`。模板包含可以直接使用的类型，可作为编写自己项目的起点：

- **自定义类型**：`blackboardKey`（以字母或下划线开头的标识符，用于黑板键名）、`probability`（0 到 1 之间的小数）。
- **节点**：`Selector`、`Sequence`、`Parallel`（`Policy`：`RequireOne` / `RequireAll`）、`RandomSelector`（`Weights`），以及继承自抽象基类 `ActionBase`（属性 `Async`）的动作节点：`Wait`、`Log`、`MoveTo`、`SetBlackboardValue`、`Succeed`、`Fail`、`RandomChance`。
- **装饰器**：`Failure`、`Invert`、`Success`、`IsBlackboardValueSet`、`Cooldown`、`Loop`、`TimeLimit`。
- **服务**：`Sample service`、`UpdateTarget`、`LogTick`。

图标全部使用 Font Awesome 6 Free Solid 的图标名。`RandomSelector` 与 `Loop` 设置了自定义颜色，其余类型使用默认颜色。

Initialize project 还会写入 `trees/example.json`，它是一棵约 14 个节点的示例树，演示标签、注释、装饰器（含 `periodic` 与 `inverseCheckCondition`）以及带 `timeBetweenTicks` 的服务。模板中的 `templates/tree.json` 是只有一个 `Selector` 根节点的最小树，**New tree** 使用它。

## 树文件（tree）格式

树文件是一个 JSON 对象，表示根节点。子节点放在 `childNodes` 中，装饰器和服务放在 `decorators`、`services` 中。未知字段会被原样保留。

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

## 项目插件（owl-bt.js）

如果项目目录中存在 `owl-bt.js`，服务端会在加载和保存树时调用它。插件必须是 CommonJS 模块，导出包含以下可选钩子的对象：

- `onTreeLoad(ctx)`：加载树时调用。修改 `ctx.tree` 即可改变返回给编辑器的内容。
- `onTreeSave(ctx)`：保存树时调用。修改 `ctx.tree` 会写入文件。返回 `false` 会拒绝保存（HTTP 409），返回字符串会以该字符串作为原因拒绝保存（HTTP 409）。返回其他值（包括 `undefined`）则正常保存。

`ctx` 的字段：`tree`（树内容）、`path`（树文件路径）、`project`（已解析的 `owl-bt.json`）、`projectPath`（`owl-bt.json` 路径）。

插件在每次请求时重新加载，修改后无需重启服务。示例：

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

## 键盘快捷键

`mod` 在 Windows / Linux 上是 `Ctrl`，在 macOS 上是 `Cmd`。

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

## 本地 HTTP API

服务端在 `/api` 下提供以下接口，全部为本机使用的 JSON / 纯文本接口。写入请求的 `Content-Type` 必须是 `application/json`，否则返回 415。错误响应为纯文本（除非另有说明）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查，返回 `{ "ok": true }` |
| `GET` | `/api/project?path=<树文件绝对路径>` | 返回该树所属 `owl-bt.json` 的原始内容。无项目时 404 |
| `GET` | `/api/tree?path=<树文件绝对路径>` | 返回树（经 `onTreeLoad` 处理）。路径不在项目内时 403 |
| `POST` | `/api/tree?path=<树文件绝对路径>` | 保存树。可能被 `onTreeSave` 拒绝（409） |
| `GET` | `/api/workspace?dir=<绝对目录或文件>` | 列出树文件，见下文 |
| `POST` | `/api/project/init` | 初始化项目，见下文 |
| `POST` | `/api/tree/create` | 创建树文件，见下文 |
| `POST` | `/api/dialog/pick` | 打开本机的系统文件 / 文件夹选择框，见下文 |

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

## 与原版 owl-bt 的主要差异

- **技术栈**：TypeScript 单仓库（npm workspaces），前端使用 React 19 + Vite，后端使用 Express 5 + socket.io 4，原版为 AngularJS 1.x、Express 4、socket.io 1.7。
- **图标**：使用 Font Awesome 6 Free Solid（原版 README 描述的是 Font Awesome 旧版的 `fa-` 图标名）。
- **未保存提示**：窗口标题在有未保存修改时显示 `*`，离开页面前会询问。
- **描述模板**：只做属性值替换，不执行表达式。
- **请求体上限**：写入树文件的请求体上限为 50 MB（Express 默认的 JSON 上限为 100 KB）。
- **错误处理**：服务端异常以纯文本响应返回而不会导致进程崩溃；项目文件的热重载错误会以提示显示，且在项目重新解析成功后自动消失。

## 仓库结构

```
packages/
  shared/   共享代码（TypeScript 源码，不单独发布）：项目编译、树模型与操作、校验、模糊搜索
  server/   Express + socket.io 服务端，以及 owlbt CLI（src/cli.ts，tsup 构建到 dist/）
            templates/   owlbt init / create 使用的模板
            scripts/     构建后把前端产物复制到 dist/public
  client/   Vite + React 19 编辑器前端（zustand 状态管理，d3 布局）
samples/
  basic/    示例项目与示例树
```

## 脚本

在仓库根目录执行：

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装所有 workspace 的依赖 |
| `npm run dev` | 同时启动后端（9000）和前端（5173） |
| `npm run build` | 构建前端，再构建服务端并复制前端产物 |
| `npm test` | 运行所有测试（Vitest） |
| `npm run typecheck` | 对所有包执行 TypeScript 类型检查 |
| `npm run lint` | 运行 ESLint |

## 许可

未指定。
