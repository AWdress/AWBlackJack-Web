import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import mqtt from 'mqtt';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { parse as parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import { randomBytes } from 'crypto';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const port = Number(process.env.PORT || 3001);
const mqttUrl = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const mqttUsername = process.env.MQTT_USERNAME || undefined;
const mqttPassword = process.env.MQTT_PASSWORD || undefined;
const mqttTopics = (process.env.MQTT_TOPICS || 'blackjack/help,blackjack/games,blackjack/states')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const mqttClientId = process.env.MQTT_CLIENT_ID || `awbj_web_${Math.random().toString(16).slice(2, 10)}`;
const timeZone = process.env.TIME_ZONE || 'Asia/Shanghai';
const authPassword = process.env.AUTH_PASSWORD || null;
let sessionSecret = process.env.SESSION_SECRET || 'awblackjack-web-secret-change-in-production';
const AUTH_USERS = process.env.AUTH_USERS || ''; // 格式：用户名:密码,用户名:密码

// 验证sessionSecret
if (!sessionSecret || sessionSecret.trim() === '') {
  console.warn('警告: SESSION_SECRET为空或无效，使用默认安全密钥');
  sessionSecret = 'awblackjack-web-secret-change-in-production-' + Date.now();
}

// 输出启动配置
console.log('=== AWBlackJack Web 启动配置 ===');
console.log(`端口: ${port}`);
console.log(`MQTT URL: ${mqttUrl}`);
console.log(`MQTT 主题: ${mqttTopics.join(', ')}`);
console.log(`时区: ${timeZone}`);
console.log(`认证配置: ${authPassword ? '单一密码模式' : AUTH_USERS ? '多用户模式' : '无认证'}`);
console.log(`会话密钥配置: ${sessionSecret.includes('awblackjack-web-secret-change-in-production') ? '使用默认值' : '自定义配置'}`);
console.log('================================');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, '../../web/dist');
const configuredRuntimeStatePath = process.env.RUNTIME_STATE_PATH;
const runtimeStateCandidates = [
  configuredRuntimeStatePath,
  path.resolve('/data/runtime_state.json'),
  path.resolve(__dirname, '../data/runtime_state.json'),
  path.resolve(__dirname, '../../../AWBlackJack/temp_file/runtime_state.json')
].filter(Boolean);

const getTimestamp = () => {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  return `${formatter.format(new Date()).replace(' ', 'T')}+08:00`;
};

// 简单的内存会话存储
const activeSessions = new Map();

const generateSessionToken = () => {
  return randomBytes(32).toString('hex');
};

const createSession = (username) => {
  const token = generateSessionToken();
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24小时
  activeSessions.set(token, { username, expiresAt });
  return token;
};

const validateSession = (token) => {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
};

// 解析用户配置
const parseUsers = () => {
  const users = {};
  if (AUTH_USERS) {
    const userPairs = AUTH_USERS.split(',').map(pair => pair.trim()).filter(Boolean);
    userPairs.forEach(pair => {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) return;
      const username = pair.slice(0, colonIndex).trim();
      const password = pair.slice(colonIndex + 1).trim();
      if (username && password) {
        users[username] = password;
      }
    });
  }
  
  // 向后兼容：如果设置了单一密码，创建一个默认用户
  if (authPassword && Object.keys(users).length === 0) {
    users['admin'] = authPassword;
  }
  
  return users;
};

const validUsers = parseUsers();
const requiresAuth = Object.keys(validUsers).length > 0;

const requireAuth = (req, res, next) => {
  if (!requiresAuth) {
    // 没有设置用户时，直接放行
    return next();
  }
  
  const token = req.signedCookies?.sessionToken || req.cookies?.sessionToken || req.headers['x-session-token'];
  if (validateSession(token)) {
    return next();
  }
  
  res.status(401).json({ error: '需要登录' });
};

const state = {
  broker: mqttUrl,
  username: mqttUsername || '',
  clientId: mqttClientId,
  connected: false,
  lastMessageAt: null,
  topics: mqttTopics,
  messageCount: 0,
  errors: [],
  diagnostics: {
    authConfigured: Boolean(mqttUsername || mqttPassword),
    reconnectPeriod: 300,
    timeZone,
    lastError: null
  },
  tables: {},
  events: [],
  latestByTopic: {},
  messages: []
};

const upsertEvent = (event) => {
  state.events.unshift(event);
  state.events = state.events.slice(0, 50);
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser(sessionSecret));

// 公开的健康检查
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'awblackjack-web-server' });
});

// 登录API
app.post('/api/login', (req, res) => {
  if (!requiresAuth) {
    return res.json({ 
      success: true, 
      message: '系统未设置认证，直接访问' 
    });
  }
  
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ 
      success: false, 
      message: '需要用户名和密码' 
    });
  }
  
  if (validUsers[username] === password) {
    const token = createSession(username);
    res.cookie('sessionToken', token, { 
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      signed: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24小时
    });
    return res.json({ 
      success: true, 
      message: '登录成功',
      token,
      username
    });
  }
  
  res.status(401).json({ 
    success: false, 
    message: '用户名或密码错误' 
  });
});

// 登出API
app.post('/api/logout', (req, res) => {
  const token = req.signedCookies?.sessionToken || req.cookies?.sessionToken || req.headers['x-session-token'];
  if (token) {
    activeSessions.delete(token);
  }
  res.clearCookie('sessionToken');
  res.json({ success: true, message: '已退出登录' });
});

// 检查登录状态
app.get('/api/auth/status', (req, res) => {
  const token = req.signedCookies?.sessionToken || req.cookies?.sessionToken || req.headers['x-session-token'];
  const isAuthenticated = !requiresAuth || validateSession(token);
  let username = null;
  if (isAuthenticated && token) {
    const session = activeSessions.get(token);
    if (session) {
      username = session.username;
    }
  }
  res.json({ 
    isAuthenticated,
    requiresAuth,
    hasUsers: requiresAuth,
    userCount: Object.keys(validUsers).length,
    username
  });
});

// 保护敏感API
app.get('/api/state', requireAuth, (_req, res) => {
  res.json(state);
});

app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    broker: mqttUrl,
    topics: mqttTopics,
    hasAuth: Boolean(mqttUsername || mqttPassword),
    timeZone,
    reconnectPeriod: state.diagnostics.reconnectPeriod
  });
});

if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
}

const pushError = (message) => {
  state.diagnostics.lastError = message;
  state.errors.unshift({
    message,
    createdAt: getTimestamp()
  });
  state.errors = state.errors.slice(0, 20);
};

const normalizePayload = (topic, payload) => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const eventSummaryMap = {
      friend_help_request: '平局求助',
      friend_helped: '平局完成',
      friend_help_verify_request: '平局验证请求',
      friend_help_verify_result: '平局验证结果',
      friend_started_game: '队友开局',
      friend_joined: '队友加入',
      friend_state: '队友状态'
    };

    return {
      topic,
      summary: eventSummaryMap[payload.type] || payload.status || payload.stage || payload.event || payload.msg || 'object',
      payload
    };
  }

  return {
    topic,
    summary: typeof payload === 'string' ? payload.slice(0, 80) : String(payload),
    payload
  };
};

const inferTableId = (topic, payload) => {
  if (payload && typeof payload === 'object' && payload.tableId) {
    return String(payload.tableId);
  }

  if (payload && typeof payload === 'object' && payload.deskId) {
    return String(payload.deskId);
  }

  const match = topic.match(/table\/([^/]+)/i);
  if (match) {
    return match[1];
  }

  return 'default';
};

const normalizePlayers = (payload) => {
  if (Array.isArray(payload.players)) {
    return payload.players;
  }

  if (Array.isArray(payload.seats)) {
    return payload.seats.map((seat, index) => ({
      seat: seat.seat ?? index + 1,
      name: seat.name || seat.playerName || `Seat ${index + 1}`,
      bet: seat.bet ?? seat.amount ?? '-',
      cards: seat.cards || [],
      points: seat.points ?? seat.point ?? '-',
      status: seat.status || seat.state || '-'
    }));
  }

  return [];
};

const buildCollaborationEvent = (topic, payload, receivedAt) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const type = payload.type || '';
  const friendName = payload.friend_name || payload.friendName || (payload.sender_id ? `队友${payload.sender_id}` : '队友');

  if (topic === 'blackjack/help' && type === 'friend_help_request') {
    return {
      topic,
      type,
      title: '平局求助',
      actor: friendName,
      detail: `牌局编号：${payload.gameid || '-'} · 下注金额：${payload.amount ?? '-'} · 当前点数：${payload.point ?? '-'}`,
      receivedAt,
      payload
    };
  }

  if (topic === 'blackjack/games' && type === 'friend_helped') {
    return {
      topic,
      type,
      title: '平局完成',
      actor: friendName,
      detail: `目标牌局：${payload.target_gameid || payload.gameid || '-'} · 当前点数：${payload.point ?? '-'}`,
      receivedAt,
      payload
    };
  }

  if (topic === 'blackjack/games' && type === 'friend_help_verify_request') {
    return {
      topic,
      type,
      title: '平局验证请求',
      actor: friendName,
      detail: `目标牌局：${payload.target_gameid || '-'} · 验证点数：${payload.point ?? '-'} · 尝试次数：${payload.attempt ?? '-'}`,
      receivedAt,
      payload
    };
  }

  if (topic === 'blackjack/games' && type === 'friend_help_verify_result') {
    return {
      topic,
      type,
      title: '平局验证结果',
      actor: friendName,
      detail: `目标牌局：${payload.target_gameid || '-'} · 牌局仍存在：${payload.target_still_exists ? '是' : '否'} · 当前点数：${payload.point ?? '-'}`,
      receivedAt,
      payload
    };
  }

  if (topic === 'blackjack/games' && type === 'friend_started_game') {
    return {
      topic,
      type,
      title: '队友开局',
      actor: friendName,
      detail: `牌局编号：${payload.gameid || '-'} · 下注金额：${payload.amount ?? '-'} · 当前点数：${payload.point ?? '-'}`,
      receivedAt,
      payload
    };
  }

  if (topic === 'blackjack/games' && type === 'friend_joined') {
    return {
      topic,
      type,
      title: '队友加入',
      actor: friendName,
      detail: `牌局编号：${payload.gameid || '-'}，已加入目标牌局`,
      receivedAt,
      payload
    };
  }

  if (topic === 'blackjack/states' && type === 'friend_state') {
    // 没有有效牌局号的纯等待状态无意义，不产生动态条目
    if (payload.gameid == null || payload.gameid === '' || payload.gameid === 0) {
      return null;
    }
    const statusText = payload.waiting ? '等待中' : '空闲';
    return {
      topic,
      type,
      title: '队友状态',
      actor: friendName,
      detail: `${statusText} · 牌局：${payload.gameid}${payload.source ? ` · 来源：${payload.source}` : ''}`,
      receivedAt,
      payload
    };
  }

  return null;
};

const ensureTableState = (tableId) => {
  if (!state.tables[tableId]) {
    state.tables[tableId] = {
      tableId,
      roundId: '-',
      stage: '-',
      boot: '-',
      hand: '-',
      updatedAt: null,
      dealer: {
        cards: [],
        points: '-',
        status: '-'
      },
      players: [],
      teammates: [],
      result: null,
      lastTopic: '-'
    };
  }

  return state.tables[tableId];
};

const getRuntimeStatePath = () => runtimeStateCandidates.find((candidatePath) => fs.existsSync(candidatePath));

const hydrateFromRuntimeState = () => {
  try {
    const runtimeStatePath = getRuntimeStatePath();

    if (!runtimeStatePath) {
      return;
    }

    const raw = fs.readFileSync(runtimeStatePath, 'utf-8');
    const runtimeState = JSON.parse(raw);
    const fallbackUpdatedAt = getTimestamp();
    const persistedFriendStates = runtimeState.friend_states || {};
    const teammates = Object.entries(persistedFriendStates)
      .filter(([senderId]) => String(senderId) !== String(runtimeState.my_id))
      .map(([senderId, friendState]) => ({
        senderId,
        name: `队友${senderId}`,
        status: friendState.waiting ? '等待中' : '空闲',
        waiting: Boolean(friendState.waiting),
        gameId: friendState.gameid || '-',
        amount: '-',
        point: '-',
        source: '本地历史状态',
        updatedAt: friendState.updated_at
          ? new Date(Number(friendState.updated_at) * 1000).toISOString()
          : fallbackUpdatedAt
      }));

    if (!teammates.length) {
      return;
    }

    const table = ensureTableState('default');
    table.teammates = teammates;
    table.stage = '已载入历史状态';
    table.updatedAt = teammates[0].updatedAt || fallbackUpdatedAt;
    table.roundId = teammates.find((item) => item.gameId && item.gameId !== '-')?.gameId || table.roundId;
    table.result = {
      friendName: teammates[0].name,
      status: teammates[0].status,
      gameId: teammates[0].gameId,
      amount: '-',
      point: '-',
      source: '本地历史状态',
      updatedAt: table.updatedAt
    };

    const activeGameIds = Array.isArray(runtimeState.active_friend_gameids) ? runtimeState.active_friend_gameids : [];
    upsertEvent({
      topic: 'runtime_state',
      type: 'runtime_state_bootstrap',
      title: '已载入历史状态',
      actor: '本地缓存',
      detail: activeGameIds.length
        ? `活跃牌局 ${activeGameIds.length} 局 · 最近局号 ${activeGameIds[activeGameIds.length - 1]}`
        : `已恢复 ${teammates.length} 名队友状态`,
      receivedAt: table.updatedAt,
      payload: runtimeState
    });

    state.lastMessageAt = table.updatedAt;
    state.latestByTopic.runtime_state = {
      topic: 'runtime_state',
      summary: '本地历史状态',
      payload: runtimeState,
      receivedAt: table.updatedAt
    };
    state.diagnostics.runtimeStatePath = runtimeStatePath;
  } catch (error) {
    pushError(`载入历史状态失败：${error.message}`);
  }
};

const updateTableState = (topic, payload, receivedAt) => {
  const tableId = inferTableId(topic, payload);
  const table = ensureTableState(tableId);

  table.updatedAt = receivedAt;
  table.lastTopic = topic;

  if (payload && typeof payload === 'object') {
    table.roundId = payload.roundId || payload.gameId || payload.issue || table.roundId;
    table.stage = payload.stage || payload.status || payload.state || table.stage;
    table.boot = payload.boot ?? table.boot;
    table.hand = payload.hand ?? payload.round ?? table.hand;

    if (['friend_state', 'friend_help_request', 'friend_helped', 'friend_help_verify_request', 'friend_help_verify_result', 'friend_started_game', 'friend_joined'].includes(payload.type)) {
      const senderId = payload.sender_id ?? payload.senderId ?? payload.sender ?? payload.sender_id ?? '-';
      const friendName = payload.friend_name || payload.friendName || `队友${senderId}`;
      const waiting = payload.waiting ?? payload.is_waiting ?? payload.isWaiting;
      const statusText = payload.type === 'friend_help_request'
        ? '请求平局'
        : payload.type === 'friend_helped'
          ? '平局完成'
          : payload.type === 'friend_help_verify_request'
            ? '等待验证'
            : payload.type === 'friend_help_verify_result'
              ? (payload.target_still_exists ? '验证通过' : '验证失败')
          : payload.type === 'friend_started_game'
            ? '已开局'
            : payload.type === 'friend_joined'
              ? '已加入'
              : waiting === true
                ? '等待中'
                : waiting === false
                  ? '空闲'
                  : '状态同步';

      // 查找当前已有的队友数据，用于保留有意义的旧字段值
      const currentTeammates = Array.isArray(table.teammates) ? table.teammates : [];
      const existingTeammate = currentTeammates.find(item => String(item.senderId) === String(senderId));

      // 仅当新值有意义时才覆盖旧值（null/undefined/'-' 时保留旧值）
      const keepBest = (newVal, oldVal) => {
        if (newVal === null || newVal === undefined || newVal === '-' || newVal === '') {
          return (oldVal !== null && oldVal !== undefined && oldVal !== '-' && oldVal !== '') ? oldVal : '-';
        }
        return newVal;
      };

      const rawGameId = payload.gameid ?? payload.helper_gameid ?? payload.target_gameid ?? payload.gameId;
      const rawAmount = payload.amount ?? payload.bet ?? payload.wager;
      const rawPoint  = payload.point ?? payload.current_point ?? payload.currentPoint;

      const teammate = {
        senderId,
        name: friendName,
        status: statusText,
        waiting: waiting === true,
        gameId: keepBest(rawGameId, existingTeammate?.gameId),
        amount: keepBest(rawAmount, existingTeammate?.amount),
        point:  keepBest(rawPoint,  existingTeammate?.point),
        source: payload.source || existingTeammate?.source || '-',
        updatedAt: receivedAt
      };

      let nextTeammates = currentTeammates.filter((item) => String(item.senderId) !== String(senderId));
      // 按 senderId 排序插入（字符串比较）
      const insertIndex = nextTeammates.findIndex((item) => String(item.senderId).localeCompare(String(senderId)) > 0);
      if (insertIndex === -1) {
        nextTeammates.push(teammate);
      } else {
        nextTeammates.splice(insertIndex, 0, teammate);
      }
      table.teammates = nextTeammates.slice(0, 12);

      // friend_state 是心跳包保消息，不覆盖活动事件产生的底层状态
      const isMeaningfulEvent = payload.type !== 'friend_state';
      if (isMeaningfulEvent) {
        table.stage = statusText;
        const validGameId = teammate.gameId && teammate.gameId !== '-' ? teammate.gameId : null;
        table.roundId = validGameId || table.roundId;
        table.result = {
          friendName,
          status: statusText,
          gameId: teammate.gameId,
          amount: teammate.amount,
          point: teammate.point,
          source: teammate.source,
          updatedAt: teammate.updatedAt
        };
      }
    }

    const normalizedPlayers = normalizePlayers(payload);
    if (normalizedPlayers.length) {
      table.players = normalizedPlayers;
    }

    if (payload.dealer && typeof payload.dealer === 'object') {
      table.dealer = {
        cards: payload.dealer.cards || [],
        points: payload.dealer.points ?? '-',
        status: payload.dealer.status || '-'
      };
    }

    if (topic === 'blackjack/states') {
      table.dealer = {
        cards: payload.bankerCards || payload.dealerCards || table.dealer.cards,
        points: payload.bankerPoints ?? payload.dealerPoints ?? table.dealer.points,
        status: payload.bankerStatus || payload.dealerStatus || table.dealer.status
      };
    }

    if (Array.isArray(payload.cards) || payload.points || payload.result) {
      if (topic.includes('/dealer')) {
        table.dealer = {
          cards: payload.cards || table.dealer.cards,
          points: payload.points ?? table.dealer.points,
          status: payload.status || table.dealer.status
        };
      }

      if (topic.includes('/result')) {
        table.result = payload;
      }
    }
  }
};

hydrateFromRuntimeState();

const client = mqtt.connect(mqttUrl, {
  clientId: mqttClientId,
  username: mqttUsername,
  password: mqttPassword,
  reconnectPeriod: 3000
});

client.on('connect', () => {
  state.connected = true;
  mqttTopics.forEach((topic) => {
    client.subscribe(topic);
  });
  state.topics = mqttTopics;
  io.emit('status', {
    connected: true,
    broker: mqttUrl,
    topics: mqttTopics
  });
});

client.on('reconnect', () => {
  state.connected = false;
  io.emit('status', {
    connected: false,
    broker: mqttUrl,
    topics: mqttTopics,
    reconnecting: true
  });
});

client.on('close', () => {
  state.connected = false;
  io.emit('status', {
    connected: false,
    broker: mqttUrl,
    topics: mqttTopics
  });
});

client.on('message', (topic, payloadBuffer) => {
  const payloadText = payloadBuffer.toString();
  let payload = payloadText;

  try {
    payload = JSON.parse(payloadText);
  } catch {
  }

  console.log(`[MQTT] Received on ${topic}: ${payloadText.substring(0, 200)}${payloadText.length > 200 ? '...' : ''}`);

  const normalized = normalizePayload(topic, payload);

  const message = {
    topic,
    summary: normalized.summary,
    payload: normalized.payload,
    receivedAt: getTimestamp()
  };

  const collaborationEvent = buildCollaborationEvent(topic, normalized.payload, message.receivedAt);

  state.lastMessageAt = message.receivedAt;
  state.messageCount += 1;
  updateTableState(topic, normalized.payload, message.receivedAt);
  if (collaborationEvent) {
    upsertEvent(collaborationEvent);
  }
  state.latestByTopic[topic] = message;
  state.messages.unshift(message);
  state.messages = state.messages.slice(0, 100);

  // friend_state 无有效局号时不推送到前端（避免高频刺激前端拉取状态）
  const isFriendStateNoGame = (
    normalized.payload?.type === 'friend_state' &&
    (normalized.payload?.gameid == null || normalized.payload?.gameid === '' || normalized.payload?.gameid === 0)
  );
  if (!isFriendStateNoGame) {
    io.emit('message', message);
  }
});

client.on('error', (error) => {
  state.connected = false;
  pushError(error.message);
  io.emit('status', {
    connected: false,
    broker: mqttUrl,
    topics: mqttTopics,
    error: error.message
  });
});

io.on('connection', (socket) => {
  // 检查认证
  const handshake = socket.handshake;
  let cookieToken = handshake.auth?.token || handshake.query?.token;

  if (handshake.headers.cookie) {
    try {
      const cookies = parseCookie(handshake.headers.cookie);
      const val = cookies.sessionToken;
      if (val) {
        if (val.startsWith('s:')) {
          // 签名 cookie：验证签名并提取原始 token
          const unsigned = unsign(val.slice(2), sessionSecret);
          if (unsigned !== false) {
            cookieToken = unsigned;
          }
        } else {
          cookieToken = val;
        }
      }
    } catch (error) {
      console.error('解析cookie失败:', error);
    }
  }
  
  if (requiresAuth && !validateSession(cookieToken)) {
    socket.emit('unauthorized', { message: '需要登录' });
    socket.disconnect();
    return;
  }
  
  socket.emit('bootstrap', state);
});

if (fs.existsSync(webDistPath)) {
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error.message);
  console.error('错误堆栈:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});

// 服务器错误处理
server.on('error', (error) => {
  console.error('服务器错误:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用，请检查是否有其他服务正在运行`);
  }
});

server.listen(port, () => {
  console.log(`AWBlackJack web server listening on ${port}`);
});
