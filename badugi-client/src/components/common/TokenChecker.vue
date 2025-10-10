<!-- badugi-client/src/components/common/TokenChecker.vue -->
<script setup>
import { onMounted, onUnmounted, inject, ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { logger } from '../../utils/logger';

const router = useRouter();
// --- START MODIFICATION ---
const socket = inject('socket'); // socket 인스턴스 주입
// --- END MODIFICATION ---

let tokenCheckInterval = null;
const isCheckingToken = ref(false);

const checkTokenPeriodically = async () => {
  const jwtToken = localStorage.getItem('jwt_token');
  const userId = localStorage.getItem('user_id'); // 사용자 ID도 가져옴

  if (!jwtToken) {
    logger.warn('[TokenChecker] 로컬 스토리지에 토큰이 없습니다. 로그인 페이지로 리다이렉트.');
    if (router.currentRoute.value.path !== '/login') {
      router.replace('/login');
    }
    return;
  }

  isCheckingToken.value = true;
  try {
    const response = await axios.get('http://localhost:8000/api/auth/check-token', {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });

    if (response.data.status === 'success') {
      logger.log('[TokenChecker] JWT 토큰 유효함.');
    } else {
      logger.error('[TokenChecker] 서버에서 토큰 유효성 검사 실패:', response.data.message);
      // --- START MODIFICATION ---
      // JWT 만료 시, Node.js 서버에 로그아웃 이벤트 알림
      if (socket.connected && userId) {
          logger.log(`[TokenChecker] JWT 만료로 인해 서버에 userLoggedOut 이벤트 전송 (ID: ${userId})`);
          socket.emit('userLoggedOut', { userId: parseInt(userId) });
      }
      // --- END MODIFICATION ---
      logger.notify('인증 토큰이 만료되었습니다. 다시 로그인해주세요.', 'error');

      localStorage.clear();
      if (router.currentRoute.value.path !== '/login') {
        router.replace('/login');
      }
    }
  } catch (error) {
    logger.error('[TokenChecker] JWT 토큰 유효성 검사 중 API 호출 실패:', error.message);
    if (error.response && error.response.status === 401) {
        // --- START MODIFICATION ---
        // JWT 만료 시, Node.js 서버에 로그아웃 이벤트 알림
        if (socket.connected && userId) {
            logger.log(`[TokenChecker] HTTP 401 응답으로 인해 서버에 userLoggedOut 이벤트 전송 (ID: ${userId})`);
            socket.emit('userLoggedOut', { userId: parseInt(userId) });
        }
        // --- END MODIFICATION ---
        logger.notify('인증 토큰이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.', 'error');
        localStorage.clear();
        if (router.currentRoute.value.path !== '/login') {
            router.replace('/login');
        }
    } else {
        logger.notify('서버와의 통신 오류가 발생했습니다. 네트워크 상태를 확인해주세요.', 'error');
    }
  } finally {
    isCheckingToken.value = false;
  }
};

onMounted(() => {
  checkTokenPeriodically();
  tokenCheckInterval = setInterval(checkTokenPeriodically, 10000);
});

onUnmounted(() => {
  if (tokenCheckInterval) {
    clearInterval(tokenCheckInterval);
  }
});
</script>

<template>
    <div v-if="isCheckingToken" style="display: none;"></div>
</template>