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
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { logger } from '../utils/logger'

const email = ref('')
const password = ref('')
const loginError = ref('')
const router = useRouter()


const handleLogin = async () => {
  loginError.value = ''
  try {
    const response = await axios.post('http://localhost:8000/api/auth/login', {
      email: email.value,
      password: password.value,
    })

    const { access_token, user } = response.data
    localStorage.setItem('jwt_token', access_token)
    localStorage.setItem('user_name', user.name)
    localStorage.setItem('user_id', user.id)
    localStorage.setItem('user_chips', user.points)

    logger.notify('로그인 성공!', 'info')
    logger.log('토큰 저장됨:', access_token)
    logger.log('로그인 사용자 정보:', user)

    router.replace('/lobby')
  } catch (error) {
    logger.error('로그인 실패:', error)
    if (error.response && error.response.status === 401) {
      loginError.value = '이메일 또는 비밀번호가 올바르지 않습니다.'
    } else {
      loginError.value = '로그인 중 오류가 발생했습니다. 다시 시도해주세요.'
    }
    logger.notify(loginError.value, 'error')
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
