<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <img src="./logo.png" alt="BLACKJACK Logo" class="login-logo" />
        <h1>BlackJack实时协同看板</h1>
        <p>请输入密码访问系统</p>
      </div>
      
      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="username">用户名</label>
          <input
            id="username"
            v-model="username"
            type="text"
            placeholder="请输入用户名"
            :disabled="loading"
            required
          />
        </div>
        <div class="form-group">
          <label for="password">密码</label>
          <input
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入密码"
            :disabled="loading"
            required
          />
        </div>
        
        <div v-if="errorMessage" class="login-error">
          {{ errorMessage }}
        </div>
        
        <button type="submit" :disabled="loading" class="login-button">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>
      
      <div v-if="!requiresAuth" class="login-note">
        <p>系统未设置密码，可以直接访问。</p>
        <button @click="skipLogin" class="skip-button">直接进入</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const emits = defineEmits(['login-success'])

const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const requiresAuth = ref(false)

let isCheckingAuth = false;

const checkAuthStatus = async () => {
  // 防止并发调用
  if (isCheckingAuth) return;
  isCheckingAuth = true;
  
  try {
    console.log('开始检查认证状态...');
    const response = await fetch(`${serverUrl}/api/auth/status`, {
      credentials: 'include'
    })
    // 如果响应失败，抛出错误
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json()
    console.log('认证状态响应:', data);
    requiresAuth.value = data.requiresAuth
    
    // 如果已登录或不需要认证，直接跳转
    if (data.isAuthenticated) {
      console.log('用户已登录，触发登录成功事件');
      emits('login-success')
    }
  } catch (error) {
    console.error('检查认证状态失败:', error)
    // 即使API调用失败，也假设需要认证
    requiresAuth.value = true;
  } finally {
    isCheckingAuth = false;
  }
}

const handleLogin = async () => {
  if (!username.value.trim() || !password.value.trim()) return
  
  loading.value = true
  errorMessage.value = ''
  
  try {
    const response = await fetch(`${serverUrl}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ 
        username: username.value,
        password: password.value 
      })
    })
    
    const data = await response.json()
    
    if (response.ok && data.success) {
      // 存储token到sessionStorage，供Socket连接使用
      if (data.token) {
        sessionStorage.setItem('awblackjack_session_token', data.token);
      }
      emits('login-success', data.token)
    } else {
      errorMessage.value = data.message || '登录失败'
    }
  } catch (error) {
    errorMessage.value = '网络错误，请重试'
    console.error('登录失败:', error)
  } finally {
    loading.value = false
  }
}

const skipLogin = () => {
  emits('login-success')
}

onMounted(() => {
  checkAuthStatus()
})
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.login-container {
  background: linear-gradient(180deg, rgba(11, 32, 25, 0.97) 0%, rgba(9, 24, 20, 0.95) 100%);
  border: 1px solid rgba(212, 175, 55, 0.28);
  border-radius: 24px;
  padding: 48px 40px 40px;
  box-shadow: 0 32px 56px rgba(1, 10, 7, 0.55), inset 0 0 0 1px rgba(255, 233, 169, 0.06);
  backdrop-filter: blur(14px);
  width: 100%;
  max-width: 420px;
  position: relative;
  overflow: hidden;
}

/* 角装饰 */
.login-container::before {
  content: '';
  position: absolute;
  inset: 16px;
  border: 1px solid rgba(212, 175, 55, 0.10);
  border-radius: 16px;
  pointer-events: none;
}

.login-header {
  text-align: center;
  margin-bottom: 36px;
}

.login-logo {
  width: 80px;
  height: 80px;
  object-fit: contain;
  margin-bottom: 16px;
  filter: drop-shadow(0 0 14px rgba(212, 175, 55, 0.35));
}

.login-header h1 {
  margin: 0 0 8px;
  color: #fff3c5;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.login-header p {
  margin: 0;
  color: #8ca89a;
  font-size: 0.9rem;
}

.login-form {
  margin-bottom: 8px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #c8d8cc;
  font-weight: 500;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}

.form-group input {
  width: 100%;
  padding: 13px 16px;
  background: rgba(5, 18, 13, 0.72);
  border: 1px solid rgba(212, 175, 55, 0.22);
  border-radius: 10px;
  font-size: 1rem;
  color: #e8eef7;
  font-family: inherit;
  transition: border-color 0.25s, box-shadow 0.25s;
  box-sizing: border-box;
}

.form-group input::placeholder {
  color: #4a6257;
}

.form-group input:focus {
  outline: none;
  border-color: rgba(212, 175, 55, 0.6);
  box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.1);
}

.form-group input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-error {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(92, 15, 31, 0.55);
  border: 1px solid rgba(255, 99, 132, 0.3);
  color: #ffb3be;
  padding: 12px 14px;
  border-radius: 10px;
  margin-bottom: 16px;
  font-size: 0.9rem;
}

.login-button {
  width: 100%;
  padding: 14px;
  background: linear-gradient(180deg, rgba(212, 175, 55, 0.9) 0%, rgba(170, 133, 22, 0.95) 100%);
  color: #0d1f0f;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: opacity 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 16px rgba(212, 175, 55, 0.25);
}

.login-button:hover:not(:disabled) {
  opacity: 0.9;
  box-shadow: 0 6px 22px rgba(212, 175, 55, 0.38);
}

.login-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.login-note {
  text-align: center;
  padding-top: 20px;
  margin-top: 20px;
  border-top: 1px solid rgba(212, 175, 55, 0.12);
}

.login-note p {
  margin: 0 0 12px;
  color: #8ca89a;
  font-size: 0.88rem;
}

.skip-button {
  padding: 10px 24px;
  background: rgba(212, 175, 55, 0.1);
  color: #d4af37;
  border: 1px solid rgba(212, 175, 55, 0.28);
  border-radius: 8px;
  font-size: 0.9rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.skip-button:hover {
  background: rgba(212, 175, 55, 0.18);
  border-color: rgba(212, 175, 55, 0.5);
}
</style>