<template>
  <div class="login-page-wrapper d-flex justify-content-center align-items-center vh-100 bg-gradient-primary">
    <div class="login-box card card-outline card-primary">
      <div class="card-header text-center">
        <router-link to="/" class="h1"><b>바둑이</b>게임</router-link>
      </div>

      <div class="card-body">
        <p class="login-box-msg">새 계정을 등록하세요</p>

        <form @submit.prevent="handleRegister">
          <div class="input-group mb-3">
            <input
              type="text"
              id="name"
              v-model="name"
              class="form-control"
              placeholder="이름"
              required
            />
            <div class="input-group-append">
              <div class="input-group-text">
                <span class="fas fa-user"></span>
              </div>
            </div>
          </div>

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

          <div class="input-group mb-3">
            <input
              type="password"
              id="password_confirmation"
              v-model="password_confirmation"
              class="form-control"
              placeholder="비밀번호 확인"
              required
            />
            <div class="input-group-append">
              <div class="input-group-text">
                <span class="fas fa-lock"></span>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-12">
              <button type="submit" class="btn btn-primary btn-block">등록</button>
            </div>
          </div>

          <p v-if="registerError" class="text-danger mt-3">{{ registerError }}</p>
        </form>

        <p class="mb-0 mt-3">
          <router-link to="/login" class="text-center">이미 계정이 있습니다.</router-link>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { logger } from '../utils/logger';

const name = ref('');
const email = ref('');
const password = ref('');
const password_confirmation = ref('');
const registerError = ref('');
const router = useRouter();

const handleRegister = async () => {
  registerError.value = '';
  try {
    const response = await axios.post('http://localhost:8000/api/auth/register', {
      name: name.value,
      email: email.value,
      password: password.value,
      password_confirmation: password_confirmation.value,
    });

    logger.notify('회원가입 성공! 로그인해주세요.', 'success');
    logger.log('회원가입 성공:', response.data);
    router.replace('/login');
  } catch (error) {
    logger.error('회원가입 실패:', error);
    if (error.response && error.response.data && error.response.data.message) {
      registerError.value = error.response.data.message;
    } else {
      registerError.value = '회원가입 중 오류가 발생했습니다. 다시 시도해주세요.';
    }
    logger.notify(registerError.value, 'error');
  }
};
</script>

<style scoped>
/* ✅ 로그인과 동일한 스타일로 통일 */

/* 전체 배경 */
.login-page-wrapper {
  background: linear-gradient(to right, #007bff, #0056b3);
  padding: 15px;
  min-height: 100vh;
}

/* 중앙 카드 */
.login-box {
  width: 100%;
  max-width: 420px;
  margin: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-radius: 0.5rem;
}

/* 카드 헤더 (제목 부분) */
.card-header {
  border: none;
  background: transparent;
  padding-top: 1rem;
}
.h1 {
  color: #007bff;
  font-weight: 700;
}

/* 본문 */
.card-body {
  padding: 2rem;
}

/* 문구 */
.login-box-msg {
  text-align: center;
  margin-bottom: 1rem;
  color: #333;
}

/* 버튼 */
.btn-primary {
  background-color: #007bff;
  border-color: #007bff;
  font-weight: 600;
  transition: 0.2s;
}
.btn-primary:hover {
  background-color: #0056b3;
}

/* 링크 */
a {
  color: #0056b3;
  font-weight: 500;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}

/* 반응형 */
@media (max-width: 576px) {
  .login-box {
    max-width: 95%;
  }
  .card-body {
    padding: 1rem;
  }
  .h1 {
    font-size: 1.8rem;
  }
  .login-box-msg {
    font-size: 0.9rem;
  }
}
</style>
