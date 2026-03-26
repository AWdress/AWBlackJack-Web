# MQTT 接入说明

## 当前接入方式

当前采用：原项目 -> MQTT Broker -> `server` -> Socket.IO -> `web`

- 原项目继续照常发布 MQTT
- `server` 订阅配置的 topics
- `server` 将消息缓存为：
  - 最新 Topic 状态
  - 最近 100 条消息
  - 最近 20 条错误
- `web` 通过 HTTP 获取初始状态，再通过 Socket.IO 接收实时增量

## 当前消息模型

服务端会把每条 MQTT 消息整理成：

```json
{
  "topic": "awblackjack/table/1/state",
  "summary": "betting",
  "payload": {},
  "receivedAt": "2026-03-26T12:00:00.000Z"
}
```

说明：

- `topic`：MQTT topic
- `summary`：从 `status` / `stage` / `event` 字段优先提取的摘要
- `payload`：原始 JSON 或原始字符串
- `receivedAt`：服务端接收时间

## 建议你的业务 Topic 规划

如果原项目 topic 还没完全固定，建议统一成以下风格：

- `awblackjack/table/{tableId}/state`
- `awblackjack/table/{tableId}/players`
- `awblackjack/table/{tableId}/dealer`
- `awblackjack/table/{tableId}/result`
- `awblackjack/system/status`

## 建议 Payload 字段

### state

```json
{
  "tableId": "A01",
  "roundId": "20260326-001",
  "stage": "betting",
  "boot": 3,
  "hand": 12,
  "updatedAt": "2026-03-26T12:00:00.000Z"
}
```

### players

```json
{
  "tableId": "A01",
  "players": [
    {
      "seat": 1,
      "name": "player-1",
      "bet": 100,
      "cards": ["10H", "8S"],
      "points": 18,
      "status": "stand"
    }
  ]
}
```

### dealer

```json
{
  "tableId": "A01",
  "cards": ["9D", "7C"],
  "points": 16,
  "status": "drawing"
}
```

### result

```json
{
  "tableId": "A01",
  "roundId": "20260326-001",
  "result": "dealer_win",
  "settlements": [
    {
      "seat": 1,
      "win": -100
    }
  ]
}
```

## 你后续要改的地方

拿到真实 MQTT 样例后，优先改以下位置：

- `server/src/index.js`
  - 把 `normalizePayload()` 换成真正的业务映射
  - 按 `tableId` 聚合状态
  - 重点修改 `updateTableState()`，把真实 topic 映射到桌台 / 庄家 / 玩家 / 结算
- `web/src/App.vue`
  - 当前已包含桌台状态视图
  - 后续只需要根据真实字段微调显示内容

## 当前桌台视图支持的字段

只要 MQTT payload 中出现以下字段，就会自动进入聚合视图：

- `tableId`
- `roundId`
- `stage` 或 `status`
- `boot`
- `hand`
- `players`
- `dealer`
- `result`

如果 topic 名中包含以下片段，也会辅助识别：

- `/table/{tableId}/...`
- `/dealer`
- `/result`

## 当前聚合规则

- 优先从 payload 的 `tableId` 取桌号
- 如果没有 `tableId`，尝试从 topic 中解析 `/table/{tableId}`
- `players` 数组会直接显示为玩家区
- `dealer` 对象或 `/dealer` topic 会显示为庄家区
- `/result` topic 或 payload 中存在 `result` 时会进入结算区

## 建议你提供给我的真实样例

为了把页面改成真正贴合你项目的数据结构，最好给我：

- 3～5 个实际 topic 名
- 每个 topic 对应的真实 JSON payload
- 哪些 topic 是牌局状态、哪些是玩家、哪些是结算

## 如果 Broker 支持 WebSocket

可选做法是让前端直连 MQTT over WebSocket；但当前实现保留了 Node 中间层，更适合：

- 隐藏 MQTT 认证信息
- 统一数据结构
- 做历史缓存与权限控制
