// badugi-client/src/plugins/socket.js
import { io } from 'socket.io-client';
import { ref } from 'vue';
import router from '../router';
import { logger } from '../utils/logger';

const SERVER_URL = import.meta.env.VITE_SOCKET_IO_SERVER_URL || 'http://localhost:3000';

const isSocketConnected = ref(false);
const socketInstance = ref(null); // socket 인스턴스를 ref로 관리

const socketPlugin = {
  install: (app) => {
    // `setupSocket` 함수를 플러그인 레벨에서 정의하여 `socketInstance.value`를 관리합니다.
    const setupSocket = () => {
      const token = localStorage.getItem('jwt_token');

      if (!token && router.currentRoute.path !== '/login') {
        logger.warn('[SocketPlugin] JWT 토큰 없음. Socket.IO 연결 시도 안 함. 로그인 페이지로 리다이렉트.');
        isSocketConnected.value = false;
        router.replace('/login');
        return null;
      }

      // 이미 유효한 소켓이 연결되어 있다면 재사용
      if (socketInstance.value && socketInstance.value.connected && socketInstance.value.auth.token === token) {
        logger.log('[SocketPlugin] 이미 유효한 Socket.IO가 연결되어 있습니다. 재사용.');
        isSocketConnected.value = true;
        return socketInstance.value;
      }

      // 기존 소켓이 있지만 연결되지 않았거나 토큰이 다르다면 끊고 새로 생성
      if (socketInstance.value && (!socketInstance.value.connected || socketInstance.value.auth.token !== token)) {
        logger.log('[SocketPlugin] 기존 소켓이 연결되지 않았거나 토큰이 다름. 강제 해제 후 새로 생성.');
        socketInstance.value.disconnect();
        socketInstance.value = null; // 인스턴스 초기화
      }

      logger.log('[SocketPlugin] Socket.IO 인스턴스 생성 및 연결 시도...');
      const newSocket = io(SERVER_URL, {
        auth: { token: token },
        autoConnect: false,
        transports: ['websocket'],
      });

      newSocket.on('connect', () => {
        logger.log('[SocketPlugin] Socket.IO: 연결 성공! (ID: ' + newSocket.id + ')');
        isSocketConnected.value = true;
      });

      newSocket.on('disconnect', (reason) => {
        logger.warn('[SocketPlugin] Socket.IO: 연결 해제됨 (' + reason + ')');
        isSocketConnected.value = false;
        if (localStorage.getItem('jwt_token') && reason !== 'io client disconnect' && reason !== 'transport close') { // 'transport close'는 자동 재연결 시도 중 발생할 수 있음
          logger.info('[SocketPlugin] 토큰 존재, Socket.IO 재연결 시도 중...');
          setTimeout(() => newSocket.connect(), 3000);
        } else if (!localStorage.getItem('jwt_token')) {
          logger.warn('[SocketPlugin] 토큰 없음, Socket.IO 재연결 시도 안 함. 로그인 페이지로 리다이렉트.');
          if (router.currentRoute.path !== '/login') {
            router.replace('/login');
          }
        }
      });

      newSocket.on('connect_error', (err) => {
        logger.error('[SocketPlugin] Socket.IO: 연결 오류 발생 - ' + err.message);
        isSocketConnected.value = false;
        // connect_error 발생 시 명시적인 재연결 시도를 추가할 수 있습니다.
        // 예를 들어, 일정 시간 후 다시 connect()를 시도하는 setTimeout
      });

      newSocket.on('reconnect_attempt', (attemptNumber) => {
        logger.info(`[SocketPlugin] Socket.IO: 재연결 시도 중... (${attemptNumber}번째)`);
      });

      newSocket.on('reconnect', (attemptNumber) => {
        logger.log(`[SocketPlugin] Socket.IO: 재연결 성공 (${attemptNumber}번째)`);
        isSocketConnected.value = true;
      });

      newSocket.on('reconnect_failed', () => {
        logger.error('[SocketPlugin] Socket.IO: 재연결 실패. 로그인 페이지로 리다이렉트.');
        isSocketConnected.value = false;
        localStorage.clear();
        if (router.currentRoute.path !== '/login') {
          router.replace('/login');
        }
      });

      socketInstance.value = newSocket; // 인스턴스 저장
      return newSocket;
    };

    app.provide('isSocketConnected', isSocketConnected);
    app.provide('socket', socketInstance);
    // ✨ NEW: setupSocket 함수도 주입하여 LoginView에서 명시적으로 호출할 수 있도록 합니다.
    app.provide('setupSocket', setupSocket);


    router.beforeEach(async (to, from, next) => {
      const token = localStorage.getItem('jwt_token');

      if (to.meta.requiresAuth && !token) {
        logger.warn('[SocketPlugin] 인증 필요 경로 진입 시 토큰 없음. 로그인 페이지로 리다이렉트.');
        if (socketInstance.value) {
          socketInstance.value.disconnect();
          isSocketConnected.value = false;
        }
        next('/login');
      } else if (!to.meta.requiresAuth && token && to.path === '/login') {
        logger.log('[SocketPlugin] 토큰 존재하지만 로그인 페이지로 이동 시도. 로비로 리다이렉트.');
        next('/lobby');
      }
      else {
        if (token) {
          // 토큰이 있고, 아직 소켓 인스턴스가 없거나 연결되지 않았다면 연결 시도
          if (!socketInstance.value || !socketInstance.value.connected) {
            const socket = setupSocket(); // `setupSocket` 호출
            if (socket && !socket.connected) {
              logger.log('[SocketPlugin] Socket.IO 연결 시작 (Router beforeEach).');
              socket.connect();
            }
          } else {
            isSocketConnected.value = true; // 이미 연결되어 있다면 상태를 true로 유지
          }
        } else {
          // 토큰이 없는데 소켓이 연결되어 있다면 (예: 로그아웃 후) 연결 끊기
          if (socketInstance.value && socketInstance.value.connected) {
            logger.log('[SocketPlugin] 토큰 없음, Socket.IO 연결 끊기 (Router beforeEach).');
            socketInstance.value.disconnect();
            isSocketConnected.value = false;
          }
        }
        next();
      }
    });
  }
};

export default socketPlugin;