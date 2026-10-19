# 多 Server 手机管理台

独立于现有 legacy Server 和 Pi 扩展的管理入口。共享配置保存在 SQLite，所有访问者看到同一列表。

- 手机形状缩略图，等比显示，不裁剪/旋转源画面。
- 主页面右上角可切换缩略图横向/纵向外框，选择仅保存在当前浏览器，不影响真实手机或控制台布局。
- 左键在当前管理页面内进入 Server 控制台，顶部返回列表，也支持浏览器后退。
- 控制台静态资源、截图和操作 API 经 Manager 的设备专属路径代理，不再跳转到 Server 端口。
- 返回列表会卸载控制台、停止页面轮询，但不会停止已启动的 Agent 任务。
- 右键菜单：连接、编辑、删除；触屏/键盘使用卡片上的 ⋮ 按钮。
- 最后的灰色 ＋ 添加 Server。添加、编辑和删除需要管理员 Token。
- 每 3 秒刷新共享列表与可见卡片；后台标签页暂停，最多同时刷新 4 张卡片。
- 显示 ESP32、投屏、校准、任务状态；单实例故障不影响其他卡片。
- 删除仅移除共享配置，不停止容器、不删除 Server 上的数据。

## Linux Docker Compose

在本目录运行（源码构建，不依赖已发布管理台镜像）：

```sh
cp .env.example .env
# 编辑 .env，填写自己的随机管理员 Token（建议至少 32 字节）。
chmod 600 .env
docker compose up -d --build
docker compose logs -f --tail=100
```

例如宿主机为 10.0.30.51：

```dotenv
MANAGER_ADMIN_TOKEN=填写你自行生成的随机值
```

打开 `http://10.0.30.51:8880`，右上角设置 Token，再点击 ＋。
输入 IP/域名时不带 `http://`、路径或端口；端口在单独字段填写。
第一版仅连接 **HTTP** Server，不支持 HTTPS 后端或子路径。
Token 只保留在当前浏览器页面内存，不存 localStorage，刷新后需要重新输入。
请不要把 Token 写到 URL 或提交到 Git；不要在不可信网络中明文传输。

管理台不需要 host 网络，不接收 AirPlay；通过 HTTP 转发控制请求，不直接连接 ESP32。
现有手机执行实例继续使用各自的 host 网络、端口和数据卷。

地址列表使用独立的命名数据卷；不要用 `docker compose down -v`，除非确认删除共享列表。
容器以 UID 10001 运行，无 privileged、host socket 或 USB 映射。

## 网络与安全

只有管理服务需要能访问填写的地址，浏览器只访问 Manager。
可以填写 Manager 容器内可解析的服务名。Server 使用 host 网络时，在 Manager Compose 中添加
`extra_hosts: ["host.docker.internal:host-gateway"]`，再填写 `host.docker.internal` 及对应端口。
域名在保存和每次代理请求时解析，连接已校验的数字 IP，拒绝重定向。
链路本地/组播/未指定地址始终拒绝。仅代理已保存记录及明确支持的控制台路由，拒绝 `/api/raw` 等任意路径。
控制台使用 `/servers/{id}/`，API 为 `/servers/{id}/api/...`。保留上游业务状态码，不自动重试操作。
控制台请求体限制 64 KiB，响应限制 8 MiB，网络超时 60 秒，不转发浏览器 Cookie 或管理员 Token。
兼容当前 legacy 控制台：定向改写 HTML、app.js 中的根路径；升级 Server 前需复测路径兼容性。
没有地址或端口白名单：管理员可以添加任何其他可达地址和 1–65535 的端口，请勿添加不可信目标。
Compose 默认将 8880 映射到宿主机所有接口；使用宿主机防火墙限制来源，勿暴露公网。

普通访客可查看预览（可能含敏感内容）和连接控制台；管理员 Token 只保护列表修改，
**不保护画面读取或控制台操作代理**。代理的控制台脚本在同源 iframe 中运行，只应添加你信任的 Server。
当前 Server API 没有认证，请仅在可信局域网部署，
需要远程访问时通过 VPN 或认证反向代理保护管理台和每个控制实例，不能只保护一个入口。
预览请求使用 5 秒网络超时及 8 MiB 图片/256 KiB JSON 限制，不保证帧新鲜度。
列表不限制多人同时打开控制台，不提供设备配对、控制锁、任务调度或容器管理。

## 开发检查（仅在执行容器中）

```sh
pip install -e '.[dev]'
pytest -q
ruff check manager tests
# 浏览器检查，需在 Node 环境安装 Chromium 和 playwright-core
npm install --no-save playwright-core
node --test tests/browser.cjs
```

后端测试覆盖共享 CRUD、重启持久化、认证、地址格式/端口合法性、代理错误和禁止跳转。
代理测试覆盖 A/B 路由隔离、资源路径改写、业务错误透传、敏感头过滤、请求体限制和调试接口拒绝。
浏览器测试使用模拟 Server，覆盖卡片、同页控制台、返回/浏览器后退、右键菜单、增删改和手机宽度布局。

Kubernetes 可使用普通 Deployment + Service（容器端口 8880），将 /data 挂载 PVC，
通过 Secret 注入管理员 Token。第一版 SQLite 使用单副本，更新采用
Recreate；不要让多个 Pod 通过共享卷同时运行这份 SQLite。此处未提供或应用集群清单。
