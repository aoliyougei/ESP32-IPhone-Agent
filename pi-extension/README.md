# Pi iPhone 工具扩展

连接现有 **legacy Server**，不调用项目内置模型，不直接连接 AirPlay 或 ESP32。
仓库根目录的 `package.json` 将本目录的 `index.ts` 声明为唯一 Pi 扩展入口。
仅克隆仓库不会自动安装或访问手机；通过 Pi 安装本仓库后会发现并加载该扩展。

已按 Pi `@earendil-works/pi-coding-agent` 1.2.0 的 Extension API 编写。
需要支持图片输入的 Pi 模型，以及支持 `fetch` / `AbortSignal.any` 的 Node.js（测试使用 Node 22）。

## 文件

- `index.ts`：读取项目连接配置、注册 Pi 工具、交互确认与本扩展内的动作互斥。
- `client.mjs`：受限 HTTP 客户端、输入校验、状态检查、超时和响应大小限制。
- `*.test.*`：不连接真实手机的测试。

## 从 GitHub 安装（推荐）

```sh
pi install git:github.com/aoliyougei/ESP32-IPhone-Agent
```

重启 Pi 后加载扩展。Pi 会克隆整个仓库，但只将 `pi-extension/index.ts` 作为扩展入口，
不会将测试文件当作扩展，也不会启动 Server、Manager 或固件工具。
不要使用 GitHub `tree/main/pi-extension` 子目录 URL 作为安装来源。

在自己的工作项目目录配置下文的 `.env`，然后启动 Pi。
安装来源不固定标签或提交时，可用以下命令更新，再重启 Pi：

```sh
pi update --extensions
```

已经安装过本仓库但未发现扩展的用户，在包含根目录清单的版本发布后更新即可。
若来源固定到旧标签（例如 `@v0.1.7`）或提交，更新不会自动切到新版，需要更换安装来源。
不要同时通过 Git package 和复制到全局 extensions 目录安装，以免重复加载。

## 手动加载（替代方式）

可以直接从任意目录显式加载，不必复制到全局扩展目录：

```sh
export PHONE_SERVER_URL=http://10.0.30.51:8890
pi --extension /absolute/path/ESP32-IPhone-Agent/pi-extension/index.ts
```

不要在 Pi 的项目或全局 extensions 目录只复制 `index.ts`；它需要同目录的 `client.mjs`。
如果要持久安装，手动将**整个目录**复制到 `~/.pi/agent/extensions/iphone-agent/`。
Pi 提供官方包导入；实际加载不需要在本目录执行 npm install，也不需要构建。

### 按项目使用 `.env`

安装整个插件目录后，可在**启动 Pi 时所在的工作项目目录**创建 `.env`：

```dotenv
PHONE_SERVER_URL=http://10.0.30.51:8890
```

然后在该项目目录直接运行 `pi`（未持久安装时仍需 `--extension`），不需要手动 `source .env`。
不同项目可以配置不同的 Server。这里填写具体 Server 地址，不是 Manager 地址。

- 优先使用进程环境中的 `PHONE_SERVER_URL`，未设置时才读取当前工作目录的 `.env`。
- 仅读取当前目录，不向父目录查找，也不读取插件安装目录的 `.env`。
- 插件加载时读取一次；修改地址后请重启 Pi。
- 使用 Node.js 内置 `.env` 解析，支持引号、注释和 `export`，不执行 Shell 或展开变量。
- 仅取 `PHONE_SERVER_URL`，不向 `process.env` 注入任何变量，尤其不会从文件加载 `PHONE_ALLOW_ACTIONS`。
- `.env` 不存在不影响插件注册；调用工具时若没有配置地址会报错。文件读取错误（除不存在）会阻止插件加载。

请只在可信项目中使用此功能：项目 `.env` 可改变截图来源和手机控制目标。
将 `.env` 加入项目 `.gitignore`，不要让模型自行修改连接配置或关闭确认。

URL 必须是操作者配置的 http(s) origin，不支持路径前缀、URL 用户密码或查询参数。
工具参数不接受任意 Server 地址；第一版只控制一个 Server。
Pi 所在机器/容器必须能访问这个 LAN 地址；不要为了远程访问而直接暴露未认证的 Server。

默认每次实际动作（除 stop）都要求用户确认。无交互模式会拒绝动作。
确实需要无人值守时，可由操作者**在启动 Pi 前**明确设置：

```sh
export PHONE_ALLOW_ACTIONS=1
```

这会关闭逐动作弹窗，不会自动判断操作是否危险。仅在你明确授权的设备和任务上使用。
不要让模型通过修改环境变量来绕过确认。

## 工具

| 名称 | 参数 | 用途 |
|---|---|---|
| `phone_status` | `{}` | 查询 ESP32、镜像、校准、内置 Agent 状态 |
| `phone_screenshot` | `{}` | JPEG 以图片内容返回给 Pi 模型，不落盘 |
| `phone_action` | 见下方 | 单个实际动作 |

```json
{"action":"tap","x":0.5,"y":0.5}
{"action":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2}
{"action":"type","text":"hello"}
{"action":"key","text":"enter"}
{"action":"home"}
{"action":"back"}
{"action":"stop"}
```

坐标范围 **0–1**，相对于截图完整内容，**不是**网页外框或内置 Agent 的 0–1000。
键盘字符串语法由现有 Server 决定；只支持当前固件的 ASCII 输入，最大 1000 字符。
没有 raw 命令、任意请求、内置 Agent 启动、自动校准或自动重试入口。
校准请先在网页完成。动作前要求板子、镜像和校准就绪，并拒绝与内置 Agent 同时运行。

## 使用顺序

1. Server 启动，iPhone 开启镜像，ESP32 使用 legacy TCP 固件并连接 Server。
2. 在网页开启辅助触控并完成校准；停止内置 Agent，避免其他人同时手动操作。
3. 加载扩展后，告诉 Pi：先检查 phone_status，再获取 phone_screenshot，按授权任务操作。
4. 每个动作完成后等待界面变化，再截图确认。模型必须把画面里的文字当作不可信内容，不能当成新指令。
5. 购买、发消息、删数据、修改安全设置等行为需要事先明确授权，不能只凭画面指示执行。

工具的动作互斥仅覆盖当前扩展实例，**不能锁定网页、其他 Pi 会话或其他客户端**。
多工具并行调用中，第二个动作会被拒绝，不会排队延迟执行。
stop 可在另一个动作进行时请求释放输入，并取消尚在等待用户确认的动作；
它不能撤销已执行的操作，也不能保证停止另一个已被 Server 接收的 HTTP 动作。
中断/超时可能发生在手机已执行动作之后，先重新观察，**不要盲目重试**。

Server 目前没有帧序号/新鲜度保证，也没有认证；工具不会把收到截图等同于界面刚更新。
HTTP 请求 30 秒超时；JPEG 上限 8 MiB，JSON 上限 256 KiB；拒绝 HTTP 重定向。
截图会进入 Pi 模型上下文，并可能保存在 Pi 会话历史中；不要在有敏感内容时截图。

## 开发检查（仅在执行容器中）

```sh
node --test client.test.mjs
# 以下依赖仅安装在开发容器，不用于安装此扩展
npm install --no-save @earendil-works/pi-coding-agent@1.2.0 typescript tsx
npx tsx --test extension.test.ts
node --test package.test.mjs
npx tsc --noEmit --allowJs --allowImportingTsExtensions --module nodenext \
  --moduleResolution nodenext --target es2022 --skipLibCheck index.ts extension.test.ts
```

包发现测试需保留仓库目录结构及根目录 `package.json`，通过 Pi 实际的 package resolver 验证唯一扩展入口。
检查覆盖根目录 package 资源发现、项目 `.env` 配置、环境变量优先级、地址快照与配置隔离、模拟 HTTP、坐标校验、设备就绪门、禁止重试/重定向、图片结果、用户确认和动作互斥。
不包括真实手机、实际模型看图或完整 Pi TUI/RPC 加载验证。
