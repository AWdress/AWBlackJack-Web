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
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  padding: 20px;
}

.login-container {
  background: white;
  border-radius: 12px;
  padding: 40px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}

.login-header {
  text-align: center;
  margin-bottom: 30px;
}

.login-logo {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
}

.login-header h1 {
  margin: 0 8px 0;
  color: #333;
  font-size: 1.5rem;
}

.login-header p {
  margin: 0;
  color: #666;
  font-size: 0.9rem;
}

.login-form {
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #555;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.form-group input:focus {
  outline: none;
  border-color: #4a6cf7;
  box-shadow: 0 3px rgba(74, 108, 247, 0.1);
}

.login-error {
  background: #fee;
  color: #c33;
  padding: 10px;
  border-radius: 6px;
  margin-bottom: 15px;
  font-size: 0.9rem;
}

.login-button {
  width: 100%;
  padding: 14px;
  background: #4a6cf7;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.3s;
}

.login-button:hover:not(:disabled) {
  background: #3a5ce5;
}

.login-button:disabled {
  background: #aaa;
  cursor: not-allowed;
}

.login-note {
  text-align: center;
  padding: 20px;
  border-top: 1px solid #eee;
  margin-top: 20px;
}

.login-note p {
  margin: 0 15px 0;
  color: #666;
  font-size: 0.9rem;
}

.skip-button {
  padding: 10px 20px;
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.3s;
}

.skip-button:hover {
  background: #5a6268;
}
</style>