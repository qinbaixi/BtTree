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
