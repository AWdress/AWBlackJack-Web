# 本地启动说明

## 1. 安装 Node.js

请先安装 Node.js 20 或更高版本。

安装完成后，在终端确认：

```powershell
node -v
npm -v
```

## 2. 安装依赖

进入项目根目录执行：

```powershell
npm install
```

如果系统里还没有全局 Node，但项目里已有便携版 Node，可先执行：

```powershell
$env:Path = "$(Resolve-Path .\.tools\node);" + $env:Path
```

然后再运行 `npm install`。

## 3. 配置环境变量

复制并编辑：

- `server/.env.example` -> `server/.env`

> **前端配置说明**：
> - 前端会自动使用当前域名访问后端 API
> - 如需指定特定后端地址，可在开发时设置 `VITE_SERVER_URL` 环境变量

## 4. 启动服务端

```powershell
npm run dev:server
```

默认端口：`3001`

## 5. 启动前端

新开终端执行：

```powershell
npm run dev:web
```

默认端口：`5173`

如果需要显式暴露 host，可执行：

```powershell
npm run dev:web:host -- 127.0.0.1
```

## 6. 页面检查

打开前端地址后，确认：

- 页面能打开
- Broker 地址显示正常
- 连接状态会变化
- 收到 MQTT 消息后，消息流会实时刷新

## 当前已知限制

如果系统未安装全局 `node` / `npm`，可先使用项目内的 `.tools/node` 便携版继续运行。
