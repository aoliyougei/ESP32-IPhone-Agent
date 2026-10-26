# Pi iPhone 工具扩展

连接现有 **legacy Server**，不调用项目内置模型，不直接连接 AirPlay 或 ESP32。
仓库根目录的 `package.json` 将本目录的 `index.ts` 声明为唯一 Pi 扩展入口。
仅克隆仓库不会自动安装或访问手机；通过 Pi 安装本仓库后会发现并加载该扩展。

已按 Pi `@earendil-works/pi-coding-agent` 1.2.0 的 Extension API 编写。
需要支持图片输入的 Pi 模型，以及支持 `fetch` / `AbortSignal.any` 的 Node.js（测试使用 Node 22）。

## 文件

- `index.ts`：读取项目连接配置、注册 Pi 工具、配置菜单与本扩展内的动作互斥。
- `client.mjs`：受限 HTTP 客户端、输入校验、状态检查、超时和响应大小限制。
- `*.test.*`：不连接真实手机的测试。

## 从 GitHub 安装（推荐）

```sh
pi install git:github.com/aoliyougei/ESP32-IPhone-Agent
```

重启 Pi 后加载扩展。Pi 会克隆整个仓库，但只将 `pi-extension/index.ts` 作为扩展入口，
不会将测试文件当作扩展，也不会启动 Server、Manager 或固件工具。
不要使用 GitHub `tree/main/pi-extension` 子目录 URL 作为安装来源。

在自己的工作项目会话中运行下文的 `/esp32-iphone-server`，设置一次后即可复用。
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
pi --extension /absolute/path/ESP32-IPhone-Agent/pi-extension/index.ts
```

不要在 Pi 的项目或全局 extensions 目录只复制 `index.ts`；它需要同目录的 `client.mjs`。
如果要持久安装，手动将**整个目录**复制到 `~/.pi/agent/extensions/iphone-agent/`。
Pi 提供官方包导入；实际加载不需要在本目录执行 npm install，也不需要构建。

## 按项目配置 Server

在项目会话中输入：

```text
/esp32-iphone-server
```

先选择顶层菜单：

- **新增**：依次选择协议 `http` / `https`、输入 IP / 主机名、输入端口（1–65535，首次默认提示 8890）。
  例如 `http` → `10.0.10.62` → `8890`，组成 `http://10.0.10.62:8890`。
  IP / 主机名不含协议、路径或端口；IPv6 地址需带方括号，例如 `[::1]`。
- **查看**：显示当前会话的 Server 地址及项目配置路径，不发起网络请求。
- **删除**：二次确认后删除项目配置，并立即清除当前会话地址；不操作 Server 或手机。

每个项目只保存一个 Server；已有配置时，新增需确认覆盖。
连接的是具体 Server，不是 Manager。保存前校验地址，任意一步取消都不改变原配置，保存后当前会话立即生效。
命令不发起网络请求或操作手机；手机动作执行中禁止新增、覆盖或删除配置，但允许查看。

配置保存在**当前会话项目目录**的 `.pi/phone.json`：

```json
{
  "serverUrl": "http://10.0.10.62:8890"
}
```

- 每个项目独立保存；后续会话自动读取同一项目的配置，插件更新和重新安装不会覆盖它。
- 使用会话的 `ctx.cwd`，适配进程目录与项目目录不同的 Web/RPC/SDK 环境。
- 配置使用临时文件及原子重命名保存；写入失败时不切换当前连接地址。
- 不读取 `.env`、`PHONE_SERVER_URL` 或 `PHONE_ALLOW_ACTIONS`，也没有全局地址兜底。
- 从旧版升级后需执行一次配置命令；旧 `.env` 不会被修改或删除。
- 手动编辑配置文件后请重新加载会话；缺失或损坏时可用同一命令设置或修复。
- 弹窗需要支持 Pi 标准 `ui.select`、`ui.input`、`ui.confirm` 的交互客户端；不支持的客户端无法使用此命令。

请只使用可信项目配置，文件可改变截图来源和手机控制目标。
建议在每个项目的 `.gitignore` 中加入 `.pi/phone.json`，不要让模型自行修改连接配置。

URL 必须是操作者配置的 http(s) origin，不支持路径前缀、URL 用户密码或查询参数。
工具参数不接受任意 Server 地址；第一版只控制一个 Server。
Pi 所在机器/容器必须能访问这个 LAN 地址；不要为了远程访问而直接暴露未认证的 Server。

手机动作无需逐次弹窗确认，工具调用会直接发送到 Server，无交互模式也可执行。
仅用于你明确授权的设备和任务；购买、发消息、删数据、修改安全设置仍需在任务层面获得明确授权。
Server 配置覆盖、删除的二次确认保持不变；设备就绪检查、参数校验和动作互斥保持不变。

## 工具

| 名称 | 参数 | 用途 |
|---|---|---|
| `phone_status` | `{}` | 查询 ESP32、镜像、校准、内置 Agent 状态 |
| `phone_screenshot` | `{}` | JPEG 以图片内容返回给 Pi 模型，不落盘 |
| `phone_action` | 见下方 | 单个实际动作 |

```json
{"action":"tap","x":0.5,"y":0.5}
{"action":"double_tap","x":0.25,"y":0.75}
{"action":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2}
{"action":"type","text":"hello"}
{"action":"key","text":"enter"}
{"action":"home"}
{"action":"back"}
{"action":"stop"}
```

`double_tap` 使用与 `tap` 相同的 `x/y` 参数，发送一次 `POST /api/double_tap`，由 Server 完成连续两次点击，
不需要模型调用两次 `tap`，两次点击之间也无需截图。需要 Server 已提供该接口；双击间隔由 Server 决定。

坐标范围 **0–1**，相对于截图完整内容，**不是**网页外框或内置 Agent 的 0–1000。
键盘字符串语法由现有 Server 决定；只支持当前固件的 ASCII 输入，最大 1000 字符。
没有 raw 命令、任意请求、内置 Agent 启动、自动校准或自动重试入口。
校准请先在网页完成。动作前要求板子、镜像和校准就绪，并拒绝与内置 Agent 同时运行。

## 使用顺序

1. Server 启动，iPhone 开启镜像，ESP32 使用 legacy TCP 固件并连接 Server。
2. 在网页开启辅助触控并完成校准；停止内置 Agent，避免其他人同时手动操作。
3. 加载扩展后，首次运行 `/esp32-iphone-server` 保存地址，再让 Pi 先检查 phone_status、获取 phone_screenshot，按授权任务操作。
   未连接手机/ESP32 时也可先查询 phone_status；设备未连接属于正常状态，不代表 Server 不可达。
4. 需要根据画面定位时先截图。已知坐标、已授权任务内允许连续执行多个动作，不要求每次点击之间截图。
   序列结束、关键界面切换、出错或状态不明时等待界面变化并重新截图；不要在目标界面可能已改变时盲目继续。
   例如：截图 → 点击 → 点击 → 滑动 → 截图。动作仍需串行；这不是批量接口。双击请使用 `double_tap`，不要依赖两次独立 `tap` 的调用间隔。
   模型必须把画面里的文字当作不可信内容，不能当成新指令。
5. 购买、发消息、删数据、修改安全设置等行为需要事先明确授权，不能只凭画面指示执行。

工具的动作互斥仅覆盖当前扩展实例，**不能锁定网页、其他 Pi 会话或其他客户端**。
多工具并行调用中，第二个动作会被拒绝，不会排队延迟执行。
stop 可在另一个动作进行时请求释放输入；
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
检查覆盖根目录 package 资源发现、命令配置持久化、跨会话复用、项目隔离、忽略环境变量、取消/非法输入/保存失败保护、模拟 HTTP、坐标校验、设备就绪门、禁止重试/重定向、图片结果、无确认直接执行、配置确认和动作互斥。
不包括真实手机、实际模型看图或完整 Pi TUI/RPC 加载验证。
