<template>
  <div class="login-page-wrapper d-flex justify-content-center align-items-center vh-100 bg-gradient-primary">
    <div class="login-box card card-outline card-primary shadow-lg">
      <!-- ✨ 제목 영역 -->
      <div class="card-header text-center bg-white border-0 pb-0">
        <router-link to="/" class="h1 text-primary">
          <b>바둑이</b>게임
        </router-link>
      </div>

      <div class="card-body">
        <!-- ✨ 안내 문구 -->
        <p class="login-box-msg text-muted mb-4">로그인하여 게임을 시작하세요</p>

        <form @submit.prevent="handleLogin">
          <div class="input-group mb-3">
            <input
              type="email"
              id="email"
              v-model="email"
              class="form-control"
              placeholder="이메일"
              required
            />
            <div class="input-group-append">
              <div class="input-group-text">
                <span class="fas fa-envelope"></span>
              </div>
            </div>
          </div>

          <div class="input-group mb-3">
            <input
              type="password"
              id="password"
              v-model="password"
              class="form-control"
              placeholder="비밀번호"
              required
            />
            <div class="input-group-append">
              <div class="input-group-text">
                <span class="fas fa-lock"></span>
              </div>
            </div>
          </div>

          <div class="text-center">
            <button type="submit" class="btn btn-primary w-100">로그인</button>
          </div>

          <p v-if="loginError" class="text-danger mt-3">{{ loginError }}</p>
        </form>

        <!-- <p class="mb-1 mt-4 text-center">
          <a href="#">비밀번호를 잊으셨나요?</a>
        </p>
        <p class="mb-0 text-center">
          <router-link to="/register" class="text-center">새 계정 등록</router-link>
        </p> -->
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { logger } from '../utils/logger'

const email = ref('')
const password = ref('')
const loginError = ref('')
const router = useRouter()
const socket = inject('socket') // ✨ NEW: socket 인스턴스 주입
const isSocketConnected = inject('isSocketConnected') // ✨ NEW: isSocketConnected 상태 주입
const setupSocket = inject('setupSocket'); // ✨ NEW: setupSocket 함수 주입

const handleLogin = async () => {
  loginError.value = ''
  let loginApiSuccess = false; // 로그인 API 호출 성공 여부 플래그

  try {
    const response = await axios.post('http://localhost:8000/api/auth/login', {
      email: email.value,
      password: password.value,
    })

    const { access_token, user } = response.data
    localStorage.setItem('jwt_token', access_token)

    if (user && user.name && user.id && user.points !== undefined) {
        localStorage.setItem('user_name', user.name)
        localStorage.setItem('user_id', user.id)
        localStorage.setItem('user_chips', user.points)
        loginApiSuccess = true;
        logger.notify('로그인 성공!', 'info')
        logger.log('토큰 저장됨:', access_token)
        logger.log('로그인 사용자 정보:', user)
    } else {
        throw new Error("Login API response missing user data (name, id, points).");
    }

    if (loginApiSuccess) {
        // ✨ NEW: 로그인 API 성공 후 setupSocket을 명시적으로 호출하여 Socket.IO 연결을 시작합니다.
        // router.beforeEach 가드에서도 호출되지만, 여기서 한번 더 호출하여 즉각적인 연결을 보장합니다.
        if (setupSocket) {
            const currentSocket = setupSocket(); // `setupSocket`이 새 인스턴스를 반환하거나 기존 인스턴스를 재사용합니다.
            if (currentSocket && !currentSocket.connected) {
                logger.log('[LoginView] 로그인 성공 후 Socket.IO 연결 시작 (setupSocket 호출).');
                currentSocket.connect();
            } else if (!currentSocket) {
                logger.error('[LoginView] setupSocket 호출 후에도 Socket.IO 인스턴스를 얻지 못했습니다.');
                // 이 경우 연결을 기다리는 setInterval도 실패할 것이므로, 여기서 에러 처리 강화
                throw new Error("Failed to initialize Socket.IO instance.");
            }
        } else {
            logger.error('[LoginView] setupSocket 함수가 주입되지 않았습니다. Socket.IO 연결 불가.');
            throw new Error("Socket.IO setup function not available.");
        }


        const MAX_SOCKET_WAIT_TIME = 10000; // 최대 10초 대기 (더 여유롭게)
        let socketWaitStartTime = Date.now();

        const checkSocketConnection = setInterval(() => {
            // ✨ FIX: socket.value가 유효한 인스턴스이고 연결되었는지 확인합니다.
            if (isSocketConnected.value && socket.value && socket.value.connected) {
                clearInterval(checkSocketConnection);
                logger.log('[LoginView] Socket.IO 연결 확인 완료, 로비로 이동.');
                router.replace('/lobby');
            } else if (Date.now() - socketWaitStartTime > MAX_SOCKET_WAIT_TIME) {
                // 타임아웃
                clearInterval(checkSocketConnection);
                loginError.value = '로그인 성공했으나 게임 서버 연결에 실패했습니다. 다시 시도해주세요.';
                logger.notify(loginError.value, 'error');
                logger.error('[LoginView] 게임 서버 연결 실패 또는 타임아웃.');
                localStorage.clear(); // 토큰 삭제 후 다시 로그인하도록 유도
            } else {
                // 여전히 연결 중이거나 인스턴스가 아직 없는 상태
                logger.debug(`[LoginView] Socket.IO 연결 대기 중... isConnected: ${isSocketConnected.value}, instance: ${socket.value ? 'exists' : 'null'}, connected: ${socket.value?.connected || 'N/A'}`);
            }
        }, 300); // 0.3초마다 확인 (로그 빈도 줄임)

    }

  } catch (error) {
    logger.error('로그인 실패:', error)
    if (error.response) {
        if (error.response.status === 401) {
            loginError.value = '이메일 또는 비밀번호가 올바르지 않습니다.'
        } else if (error.response.status === 422) {
            loginError.value = '입력값을 확인해주세요.';
        } else if (error.response.status >= 500) {
            loginError.value = '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
        } else {
            loginError.value = `로그인 중 오류가 발생했습니다 (${error.response.status}). 다시 시도해주세요.`;
        }
    } else if (error.message.includes("Login API response missing user data") || error.message.includes("Socket.IO setup function not available") || error.message.includes("Failed to initialize Socket.IO instance")) {
        // 사용자 데이터 누락 또는 Socket.IO 초기화 오류
        loginError.value = error.message;
    }
    else {
        loginError.value = '네트워크 오류 또는 알 수 없는 오류가 발생했습니다. 다시 시도해주세요.'
    }
    logger.notify(loginError.value, 'error')
    // 로그인 API 호출 실패 시 로컬 스토리지 정리
    localStorage.clear();
  }
}
</script>

<style scoped>
/* 페이지 전체 */
.login-page-wrapper {
  background: linear-gradient(to right, #007bff, #0056b3);
  padding: 15px;
  min-height: 100vh;
}

/* 로그인 카드 */
.login-box {
  width: 100%;
  max-width: 420px;
  margin: auto;
  border-radius: 0.75rem;
  overflow: hidden;
}

/* 제목 영역 수정 */
.card-header {
  background-color: white !important;
  border: none !important;
}

.h1 {
  font-weight: 700;
  text-decoration: none;
}

.login-box-msg {
  font-size: 1rem;
  color: #666;
  text-align: center;
}

/* 반응형 */
@media (max-width: 576px) {
  .login-box {
    max-width: 95%;
  }
  .login-box .card-body {
    padding: 1rem;
  }
  .h1 {
    font-size: 1.75rem;
  }
}
</style>
