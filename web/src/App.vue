<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { io } from 'socket.io-client';
import Login from './Login.vue';

const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
const isAuthenticated = ref(false);
const checkingAuth = ref(true);
const connected = ref(false);
const broker = ref('');
const clientId = ref('');
const lastMessageAt = ref('');
const messageCount = ref(0);
const errors = ref([]);
const tables = ref({});
const events = ref([]);
const errorText = ref('');
const sessionToken = ref(sessionStorage.getItem('awblackjack_session_token') || '');
const isFreshLogin = ref(false);

let socket;

const tableEntries = computed(() => Object.values(tables.value));
const primaryTable = computed(() => tableEntries.value[0] || null);
const teammateEntries = computed(() => primaryTable.value?.teammates || []);
const teammateCount = computed(() => teammateEntries.value.length);
const waitingCount = computed(() => teammateEntries.value.filter((item) => item.waiting).length);
const idleCount = computed(() => teammateEntries.value.filter((item) => !item.waiting).length);
const latestEvent = computed(() => events.value[0] || null);
const dealerPoints = computed(() => formatValue(primaryTable.value?.dealer?.points));
const tableStage = computed(() => primaryTable.value?.stage || '等待牌局开始');
const tableRound = computed(() => formatValue(primaryTable.value?.roundId));
const tableUpdatedAt = computed(() => formatTime(primaryTable.value?.updatedAt));

const formatTime = (value) => value || '暂无';
const formatValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return '暂无';
  }
  return value;
};

const applyState = (state) => {
  connected.value = state.connected;
  broker.value = state.broker || '';
  clientId.value = state.clientId || '';
  lastMessageAt.value = state.lastMessageAt || '';
  messageCount.value = state.messageCount || 0;
  errors.value = state.errors || [];
  tables.value = state.tables || {};
  events.value = state.events || [];
};

const checkAuthStatus = (() => {
  let isChecking = false; // 闭包内的标志，防止并发检查
  
  return async (silent = false) => {
    if (isChecking) return Promise.resolve(null); // 如果已经在检查，跳过
    isChecking = true;
    if (!silent) {
      checkingAuth.value = true;
    }
    try {
      const response = await fetch(`${serverUrl}/api/auth/status`, {
        credentials: 'include'
      });
      const data = await response.json();
      
      if (data.isAuthenticated) {
        isAuthenticated.value = true;
      } else {
        isAuthenticated.value = false;
      }
      return data;
    } catch (error) {
      console.error('检查认证状态失败:', error);
      isAuthenticated.value = false;
      throw error;
    } finally {
      if (!silent) {
        checkingAuth.value = false;
      }
      isChecking = false;
    }
  };
})();

const initSocketConnection = () => {
  if (socket) {
    socket.disconnect();
  }

  // Socket.IO会自动传递cookie，无需手动传token
  const options = {
    withCredentials: true,
    transports: ['websocket', 'polling']
  };
  socket = io(serverUrl, options);

  socket.on('connect_error', (error) => {
    console.error('Socket连接错误:', error);
  });

  socket.on('unauthorized', (data) => {
    console.log('Socket未授权:', data);
    isAuthenticated.value = false;
    checkingAuth.value = false;
    socket.disconnect();
  });

  socket.on('bootstrap', (statePayload) => {
    applyState(statePayload);
  });

  socket.on('status', (status) => {
    connected.value = Boolean(status.connected);
    broker.value = status.broker || broker.value;
    errorText.value = status.error || '';
  });

  socket.on('message', (message) => {
    lastMessageAt.value = message.receivedAt;
    messageCount.value += 1;

    fetch(`${serverUrl}/api/state`, {
      credentials: 'include'
    })
      .then((response) => {
        if (response.status === 401) {
          isAuthenticated.value = false;
          throw new Error('需要登录');
        }
        return response.json();
      })
      .then((statePayload) => {
        applyState(statePayload);
      })
      .catch(() => {
      });
  });
};

const handleLoginSuccess = async (token) => {
  if (token) {
    sessionToken.value = token;
  }
  
  // 标记为刚登录状态
  isFreshLogin.value = true;
  
  // 显示加载状态
  checkingAuth.value = true;
  
  try {
    // 等待认证状态检查完成
    const data = await checkAuthStatus();
    
    if (data && data.isAuthenticated) {
      // 认证成功
      isAuthenticated.value = true;
      checkingAuth.value = false;
      // 立即初始化dashboard
      initDashboard();
    } else {
      // 认证失败，但已经登录了，可能是cookie问题
      console.error('登录后认证检查失败');
      checkingAuth.value = false;
      // 可以显示错误消息，但保持登录界面
      isAuthenticated.value = false;
      isFreshLogin.value = false;
    }
  } catch (error) {
    console.error('登录确认失败:', error);
    checkingAuth.value = false;
    isAuthenticated.value = false;
    isFreshLogin.value = false;
  }
};

const handleLogout = async () => {
  try {
    await fetch(`${serverUrl}/api/logout`, {
      method: 'POST',
      credentials: 'include'
    });
  } catch (error) {
    console.error('登出失败:', error);
  }
  
  isAuthenticated.value = false;
  sessionToken.value = '';
  sessionStorage.removeItem('awblackjack_session_token');
  isFreshLogin.value = false;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

const initDashboard = () => {
  // 保存当前是否为新鲜登录状态，然后重置标志
  const wasFreshLogin = isFreshLogin.value;
  isFreshLogin.value = false;
  
  fetch(`${serverUrl}/api/state`, {
    credentials: 'include'
  })
    .then((response) => {
      if (response.status === 401) {
        // 状态API认证失败
        if (wasFreshLogin) {
          console.warn('刚登录后状态API返回401，可能是cookie同步延迟');
        } else {
          console.warn('状态API返回401，会话可能已过期');
        }
        // 仍然检查认证状态以更新UI
        checkAuthStatus();
        // 返回null，不获取状态数据
        return null;
      }
      return response.json();
    })
    .then((state) => {
      // 无论是否获取到状态数据，都尝试初始化Socket连接
      if (state) {
        applyState(state);
      }
      // 始终尝试连接Socket，它有自己的认证检查
      initSocketConnection();
    })
    .catch((error) => {
      console.error('初始化失败:', error);
    });
};



onMounted(() => {
  // 如果sessionStorage中有token，先设置为已认证，避免UI闪烁
  const storedToken = sessionStorage.getItem('awblackjack_session_token');
  if (storedToken) {
    sessionToken.value = storedToken;
    isAuthenticated.value = true;
    checkingAuth.value = false;
    // 立即初始化 Dashboard（建立 Socket 连接，接收 bootstrap 数据）
    initDashboard();
    // 静默核验会话有效性，失效时会自动跳回登录页
    checkAuthStatus(true);
  } else {
    // 没有token，正常检查认证状态
    checkAuthStatus();
  }
});

onUnmounted(() => {
  if (socket) {
    socket.disconnect();
  }
});
</script>

<template>
  <div v-if="checkingAuth" class="loading-container">
    <div class="loading-spinner"></div>
    <p>检查认证状态...</p>
  </div>
  
  <Login 
    v-else-if="!isAuthenticated" 
    @login-success="handleLoginSuccess" 
  />
  
  <div v-else class="page">
    <header class="hero">
      <div class="hero-brand">
        <img src="./logo.png" alt="BLACKJACK Logo" class="hero-logo" />
        <div>
          <h1>BlackJack实时协同看板</h1>
          <p>用牌桌视图展示当前协同进展，不显示原始代码和调试信息</p>
        </div>
      </div>
      <div class="hero-controls">
        <div class="status" :class="connected ? 'online' : 'offline'">
          {{ connected ? '消息通道已连接' : '消息通道未连接' }}
        </div>
        <button @click="handleLogout" class="logout-button">
          退出登录
        </button>
      </div>
    </header>

    <section class="table-hero panel-wide">
      <div class="table-surface">
        <div class="table-center">
          <span class="table-mark">BLACKJACK</span>
          <h2>协同牌局总览</h2>
          <p>当前状态：{{ tableStage }}</p>
        </div>

        <div class="dealer-ring">
          <div class="dealer-badge">庄家点数</div>
          <div class="dealer-points">{{ dealerPoints }}</div>
          <div class="dealer-meta">局号 {{ tableRound }} · {{ tableUpdatedAt }}</div>
        </div>
      </div>
    </section>

    <section class="summary-grid chips-grid">
      <article class="summary-card accent chip-card">
        <span class="summary-label">在线状态</span>
        <strong>{{ connected ? '连接正常' : '连接异常' }}</strong>
        <small>最后更新时间：{{ formatTime(lastMessageAt) }}</small>
      </article>

      <article class="summary-card chip-card">
        <span class="summary-label">队友人数</span>
        <strong>{{ teammateCount }}</strong>
        <small>等待中 {{ waitingCount }} 人，空闲 {{ idleCount }} 人</small>
      </article>

      <article class="summary-card chip-card">
        <span class="summary-label">同步消息</span>
        <strong>{{ messageCount }}</strong>
        <small>连接标识：{{ clientId || '暂无' }}</small>
      </article>

      <article class="summary-card chip-card">
        <span class="summary-label">通道地址</span>
        <strong>{{ broker || '暂无' }}</strong>
        <small>最近动态：{{ latestEvent?.title || '暂无' }}</small>
      </article>
    </section>

    <section v-if="errorText" class="error-box">
      {{ errorText }}
    </section>

    <main class="layout business-layout">
      <section class="panel panel-wide">
        <div class="panel-header">
          <div>
            <h2>队友状态总览</h2>
            <p>以 21 点牌桌信息卡方式展示昵称、状态、局号、下注、点数</p>
          </div>
          <span class="panel-tag">{{ teammateCount }} 人</span>
        </div>

        <div v-if="teammateEntries.length" class="teammate-grid">
          <article v-for="item in teammateEntries" :key="`${item.senderId}-${item.updatedAt}`" class="teammate-card">
            <div class="teammate-head">
              <div>
                <h3>{{ item.name || `队友${item.senderId}` }}</h3>
                <p>队友编号：{{ formatValue(item.senderId) }}</p>
              </div>
              <span class="status-pill" :class="item.waiting ? 'waiting' : 'idle'">
                {{ item.status || '暂无状态' }}
              </span>
            </div>

            <div class="hand-strip">
              <span class="mini-card">A</span>
              <span class="mini-card">10</span>
              <span class="hand-text">当前点数 {{ formatValue(item.point) }}</span>
            </div>

            <div class="info-grid">
              <div class="info-item">
                <span>当前局号</span>
                <strong>{{ formatValue(item.gameId) }}</strong>
              </div>
              <div class="info-item">
                <span>下注金额</span>
                <strong>{{ formatValue(item.amount) }}</strong>
              </div>
              <div class="info-item">
                <span>当前点数</span>
                <strong>{{ formatValue(item.point) }}</strong>
              </div>
              <div class="info-item">
                <span>等待状态</span>
                <strong>{{ item.waiting ? '等待中' : '空闲' }}</strong>
              </div>
            </div>

            <div class="teammate-footer">
              <span>最近更新：{{ formatTime(item.updatedAt) }}</span>
              <span>状态来源：{{ formatValue(item.source) }}</span>
            </div>
          </article>
        </div>
        <div v-else class="empty-box">暂无队友实时状态</div>
      </section>

      <div class="side-column">
        <section class="panel side-panel side-panel-main">
          <div class="panel-header">
            <div>
              <h2>最新动态</h2>
              <p>固定窗口展示业务动态摘要，可下拉查看更多</p>
            </div>
          </div>

          <div v-if="events.length" class="timeline-window">
            <div class="timeline">
              <article v-for="item in events" :key="`${item.type}-${item.receivedAt}-${item.detail}`" class="timeline-item">
                <div class="timeline-head">
                  <strong>{{ item.title }}</strong>
                  <span>{{ formatTime(item.receivedAt) }}</span>
                </div>
                <div class="timeline-body">
                  <p>{{ item.actor }}</p>
                  <p>{{ item.detail }}</p>
                </div>
              </article>
            </div>
          </div>
          <div v-else class="empty-box">暂无最新动态</div>
        </section>

        <section class="panel side-panel">
          <div class="panel-header">
            <div>
              <h2>当前牌局</h2>
              <p>桌心信息采用 21 点桌面摘要样式</p>
            </div>
          </div>

          <div v-if="primaryTable" class="round-card">
            <div class="round-row">
              <span>当前状态</span>
              <strong>{{ primaryTable.stage || '暂无' }}</strong>
            </div>
            <div class="round-row">
              <span>当前局号</span>
              <strong>{{ formatValue(primaryTable.roundId) }}</strong>
            </div>
            <div class="round-row">
              <span>最近更新时间</span>
              <strong>{{ formatTime(primaryTable.updatedAt) }}</strong>
            </div>
            <div class="round-row">
              <span>庄家点数</span>
              <strong>{{ formatValue(primaryTable.dealer?.points) }}</strong>
            </div>
          </div>
          <div v-else class="empty-box">暂无牌局信息</div>
        </section>
      </div>

      <section class="panel panel-wide">
        <div class="panel-header">
          <div>
            <h2>异常提醒</h2>
            <p>只保留必要异常说明</p>
          </div>
        </div>

        <div v-if="errors.length" class="warning-list">
          <article v-for="item in errors" :key="`${item.message}-${item.createdAt}`" class="warning-item">
            <strong>连接异常</strong>
            <p>{{ item.message }}</p>
            <span>{{ formatTime(item.createdAt) }}</span>
          </article>
        </div>
        <div v-else class="empty-box success-box">当前没有异常</div>
      </section>
    </main>
  </div>
</template>
