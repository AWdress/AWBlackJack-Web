<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { io } from 'socket.io-client';
import logoUrl from './logo.png';

const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
const connected = ref(false);
const broker = ref('');
const clientId = ref('');
const lastMessageAt = ref('');
const messageCount = ref(0);
const errors = ref([]);
const tables = ref({});
const events = ref([]);
const errorText = ref('');

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

onMounted(async () => {
  const response = await fetch(`${serverUrl}/api/state`);
  const state = await response.json();
  applyState(state);

  socket = io(serverUrl);

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

    fetch(`${serverUrl}/api/state`)
      .then((response) => response.json())
      .then((statePayload) => {
        applyState(statePayload);
      })
      .catch(() => {
      });
  });
});

onUnmounted(() => {
  if (socket) {
    socket.disconnect();
  }
});
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="hero-brand">
        <img :src="logoUrl" alt="BLACKJACK Logo" class="hero-logo" />
        <div>
        <h1>BlackJack实时协同看板</h1>
        <p>用牌桌视图展示当前协同进展，不显示原始代码和调试信息</p>
        </div>
      </div>
      <div class="status" :class="connected ? 'online' : 'offline'">
        {{ connected ? '消息通道已连接' : '消息通道未连接' }}
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
