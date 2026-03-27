# AWBlackJack Web

独立于原项目的 Web 界面，通过 MQTT 订阅牌局数据并展示。

## 当前实现

- 独立项目，不修改原项目文件
- `server` 作为 Node 中间层，连接 MQTT 并通过 Socket.IO 推送给前端
- `web` 作为 Vue 3 页面，展示连接状态、Topic 最新状态和实时消息流
- 当前版本是最小可运行 MVP，适合先验证 MQTT 数据链路

## 项目结构

- `server`：Node 中间层，负责 MQTT 订阅与 WebSocket 推送
- `web`：Vue 3 前端页面
- `docs/mqtt-integration.md`：MQTT 接入与业务映射说明
- `docs/runbook.md`：本地启动说明

## 启动前提

本机需要先安装：

- Node.js 20+
- npm 10+

如果是 Windows，安装完后重新打开终端，再执行下面命令。

## 安装依赖

在项目根目录执行：

```bash
npm install
```

## 配置环境变量

复制以下文件并填写实际 MQTT 信息：

- `server/.env.example` -> `server/.env`
- `web/.env.example` -> `web/.env`

`server/.env` 示例：

```env
PORT=3001
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_TOPICS=blackjack/help,blackjack/games,blackjack/states
MQTT_CLIENT_ID=awblackjack_web_panel
TIME_ZONE=Asia/Shanghai

# 认证配置（可选）
# 如果设置了 AUTH_PASSWORD，访问界面需要密码
# AUTH_PASSWORD=your-secure-password-here

# 会话密钥（可选）
# SESSION_SECRET=awblackjack-web-secret-change-in-production
```

`web/.env` 示例：

```env
VITE_SERVER_URL=http://localhost:3001
```

## 登录保护

### 启用登录保护
要启用登录保护，只需在 `server/.env` 中设置 `AUTH_PASSWORD` 环境变量：

```env
AUTH_PASSWORD=your-secure-password-here
```

### 登录流程
1. 当 `AUTH_PASSWORD` 被设置后，访问界面会显示登录页面
2. 输入正确的密码后进入系统
3. 会话有效期为24小时
4. 点击"退出登录"可立即结束会话

### 无密码访问
如果不设置 `AUTH_PASSWORD`，系统将直接开放访问，无需登录。

### 安全性说明
- 密码通过HTTP cookie存储（httpOnly标志）
- 会话在服务器内存中管理
- 建议在生产环境中设置强密码

## 本地开发

启动服务端：

```bash
npm run dev:server
```

启动前端：

```bash
npm run dev:web
```

打开浏览器访问前端开发地址即可。

## Docker 构建

项目根目录已提供 `Dockerfile`，可直接构建服务端镜像（内含已构建前端静态资源）：

```bash
docker build -t awblackjack-web:local .
docker run --rm -p 3001:3001 --env-file server/.env awblackjack-web:local
```

容器启动后访问：

```text
http://localhost:3001
```

## Docker Compose 使用

项目根目录已提供给最终用户使用的 `docker-compose.yml`，默认直接拉取 Docker Hub 镜像：

- 这是单容器部署方式
- 容器内已包含前端静态资源与服务端
- 对外只需要暴露一个端口：`13001`
- 启动后直接访问：`http://localhost:13001`

```bash
docker compose pull
docker compose up -d
```

首次使用前请先准备配置文件：

- `server/.env.example` -> `server/.env`

如果你需要让页面在 MQTT 还没推送实时消息时也显示历史状态，请额外准备：

- `server/data/runtime_state.json`

`docker-compose.yml` 已默认把它挂载到容器内的 `/data/runtime_state.json`。

当前支持的历史状态文件字段示例：

```json
{
	"my_id": 10001,
	"active_friend_gameids": [
		"G20260327-001"
	],
	"friend_states": {
		"10002": {
			"waiting": true,
			"gameid": "G20260327-001",
			"updated_at": 174300000
		},
		"10003": {
			"waiting": false,
			"gameid": "G20260327-002",
			"updated_at": 17430000050
		}
	}
}
```

停止服务：

```bash
docker compose down
```

## GitHub 自动发布镜像

仓库已提供 GitHub Actions 工作流：

- `.github/workflows/docker-publish.yml`

默认发布到 Docker Hub：

```text
docker.io/awdress/awblackjack-web
```

### 触发规则

- 推送到 `main` 分支：自动构建并推送 `latest`
- 推送版本标签：自动构建并推送对应版本标签，例如 `v1.0.0`

### 版本发布示例

发布 `v1.0.0`：

```bash
git tag v1.0.0
git push origin v1.0.0
```

推送到 `main` 后，工作流还会自动更新：

```text
latest
```

### 镜像标签示例

- `awdress/awblackjack-web:latest`
- `awdress/awblackjack-web:v1.0.0`

### 标签生成规则

- 推送 `main` 分支：只更新 `latest`
- 推送 `v1.0.0`：只生成 `awdress/awblackjack-web:v1.0.0`

### 拉取示例

```bash
docker pull awdress/awblackjack-web:latest
docker pull awdress/awblackjack-web:v1.0.0
```

### GitHub Secrets

请在 GitHub 仓库的 Actions Secrets 中配置：

```text
DOCKER_USERNAME
DOCKER_PASSWORD
```

### Git 仓库地址

目标仓库：

```text
https://github.com/AWdress/AWBlackJack-Web
```

### 本地 Git 配置

如果你要在本机提交并推送，先执行：

```bash
git config user.email "awdress.lt@gmail.com"
git config user.name "AWdress"
git remote add origin https://github.com/AWdress/AWBlackJack-Web.git
```

## 当前页面内容

- MQTT/Broker 连接状态
- 最后消息时间
- 订阅 Topic 数量
- 每个 Topic 的最新消息
- 最近 100 条实时消息流

## 下一步建议

拿到真实 MQTT 消息样例后，继续做以下内容：

- 把原始消息映射成牌局状态模型
- 增加桌台视图、玩家视图、结算视图
- 增加 Topic 过滤、搜索和消息详情
- 增加断线重连提示和连接配置界面

## 当前限制

- 当前运行环境未检测到 `node` / `npm`，所以还没完成本机实际启动验证
- 当前页面直接展示原始 payload，尚未做业务字段转换

## 文档入口

- MQTT 接入说明：见 [docs/mqtt-integration.md](docs/mqtt-integration.md)
- 本地启动说明：见 [docs/runbook.md](docs/runbook.md)
