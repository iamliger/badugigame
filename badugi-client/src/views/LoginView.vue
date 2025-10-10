<template>
  <div class="login-page">
    <h1>로그인</h1>
    <form @submit.prevent="handleLogin">
      <div>
        <label for="email">이메일:</label>
        <input type="email" id="email" v-model="email" required>
      </div>
      <div>
        <label for="password">비밀번호:</label>
        <input type="password" id="password" v-model="password" required>
      </div>
      <button type="submit">로그인</button>
      <p v-if="loginError" class="error-message">{{ loginError }}</p>
    </form>
    <p>계정이 없으신가요? <router-link to="/register">회원가입</router-link></p>
  </div>
</template>

<script setup>
import { ref, inject } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { logger } from '../utils/logger';

const email = ref('');
const password = ref('');
const loginError = ref('');
const router = useRouter();

const socket = inject('socket');

const handleLogin = async () => {
  loginError.value = '';
  try {
    const response = await axios.post('http://localhost:8000/api/auth/login', {
      email: email.value,
      password: password.value,
    });

    const { access_token, user } = response.data;

    localStorage.setItem('jwt_token', access_token);
    localStorage.setItem('user_name', user.name);
    localStorage.setItem('user_id', user.id);
    localStorage.setItem('user_chips', user.points);

    logger.notify('로그인 성공!', 'info');
    logger.log('토큰 저장됨:', access_token);
    logger.log('로그인 사용자 정보:', user);

    // --- START MODIFICATION ---
    // Socket.IO에 최신 토큰을 주입하고 연결을 재확립합니다.
    // auth 콜백 함수 덕분에 localStorage에서 최신 토큰을 가져올 것입니다.
    if (!socket.connected) {
        socket.connect(); // 연결되어 있지 않을 때 연결 시도
        logger.log('[LoginView] Socket.IO 연결 시도 중... (연결되지 않은 상태)');
    } else {
        socket.disconnect().connect(); // 기존 연결 끊고 새 토큰으로 재인증
        logger.log('[LoginView] Socket.IO 기존 연결 끊고 재인증 시도. (연결된 상태)');
    }
    // --- END MODIFICATION ---

    router.replace('/lobby');

  } catch (error) {
    logger.error('로그인 실패:', error);
    if (error.response && error.response.status === 401) {
      loginError.value = '이메일 또는 비밀번호가 올바르지 않습니다.';
    } else {
      loginError.value = '로그인 중 오류가 발생했습니다. 다시 시도해주세요.';
    }
    logger.notify(loginError.value, 'error');
  }
};
</script>

<style scoped>
.login-page {
  max-width: 400px;
  margin: 50px auto;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  text-align: center;
}
form div {
  margin-bottom: 15px;
}
label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
}
input[type="email"],
input[type="password"] {
  width: calc(100% - 20px);
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
button {
  background-color: #42b983;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}
button:hover {
  background-color: #368a68;
}
.error-message {
  color: red;
  margin-top: 10px;
}
</style>