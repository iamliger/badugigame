// badugi-client/src/plugins/socket.js
import { io } from 'socket.io-client';
import { logger } from '../utils/logger';
import { ref, nextTick } from 'vue';
import router from '../router';

const SOCKET_URL = 'http://localhost:3000';

const socket = io(SOCKET_URL, {
  autoConnect: false,
  auth: (cb) => {
    const token = localStorage.getItem('jwt_token');
    logger.log('[SocketPlugin] Auth 콜백 호출됨. 현재 토큰:', token ? '존재함' : '없음');
    cb({ token: token });
  },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

const socketPlugin = {
  install: (app) => {
    const isSocketConnected = ref(socket.connected);

    const forceLogoutAndRedirect = async (message) => {
      logger.notify(message, 'error');
      localStorage.clear();
      socket.disconnect();

      if (router.currentRoute.value.path !== '/login') {
        await nextTick();
        router.replace('/login').catch(err => {
          logger.error('[SocketPlugin] 라우터 리다이렉션 실패:', err);
          window.location.href = '/login';
        });
        logger.log('[SocketPlugin] 로그인 페이지로 강제 리다이렉트되었습니다.');
      } else {
        logger.log('[SocketPlugin] 이미 로그인 페이지에 있습니다. 리다이렉션 건너뜜.');
      }
    };


    socket.on('connect', () => {
      logger.log('[SocketPlugin] Socket.IO 서버에 연결되었습니다!', socket.id);
      isSocketConnected.value = true;
    });

    socket.on('disconnect', (reason) => {
      logger.warn('[SocketPlugin] Socket.IO 서버 연결이 해제되었습니다. 이유:', reason);
      isSocketConnected.value = false;

      if (reason === 'io server disconnect') {
        // forceLogoutAndRedirect('서버로부터의 연결 해제. 다시 로그인해주세요.'); // 필요시 활성화
      } else if (reason === 'transport error') {
        logger.warn('[SocketPlugin] transport error 발생, 재연결 시도 중...');
      } else if (reason === 'ping timeout') {
        logger.warn('[SocketPlugin] ping timeout 발생, 서버 응답 없음. 재연결 시도 중...');
      }
    });

    socket.on('connect_error', (err) => {
      logger.error('[SocketPlugin] Socket.IO 연결 에러:', err.message, 'Err Data:', err.data);
      isSocketConnected.value = false;

      const errorMessage = err.data && err.data.message ? err.data.message : err.message;

      if (errorMessage.includes('Token expired. Please re-login.') || errorMessage.includes('Authentication error: Invalid token') || errorMessage.includes('Authentication error: Token not provided')) {
        forceLogoutAndRedirect('인증 오류가 발생했습니다. 다시 로그인해주세요.');
      } else {
        logger.warn('[SocketPlugin] 일반적인 연결 에러, 재연결 시도 중...');
      }
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      logger.log(`[SocketPlugin] Socket.IO 재연결 시도 중... (${attemptNumber}번째)`);
      isSocketConnected.value = false;
    });

    socket.on('reconnect_error', (error) => {
      logger.error('[SocketPlugin] Socket.IO 재연결 에러:', error.message);
    });

    socket.on('reconnect_failed', () => {
      logger.error('[SocketPlugin] Socket.IO 재연결에 실패했습니다.');
      forceLogoutAndRedirect('Socket.IO 재연결에 실패했습니다. 네트워크 상태를 확인해주세요.');
    });

    app.provide('socket', socket);
    app.provide('isSocketConnected', isSocketConnected);

    socket.on('message', (data) => {
      logger.log('[SocketPlugin] 서버로부터 메시지 수신:', data);
    });
  },
};

export default socketPlugin;