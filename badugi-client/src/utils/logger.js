// badugi-client/src/utils/logger.js
const isDebugMode = import.meta.env.VITE_DEBUG === 'true'; // .env에서 설정한 VITE_DEBUG 값 사용

export const logger = {
  log: (...args) => {
    if (isDebugMode) {
      console.log('[DEBUG-LOG]', ...args);
    }
  },
  warn: (...args) => {
    if (isDebugMode) {
      console.warn('[DEBUG-WARN]', ...args);
    }
  },
  error: (...args) => {
    // 에러는 디버그 모드와 상관없이 항상 출력
    console.error('[DEBUG-ERROR]', ...args);
  },
  // alert 대신 사용할 메소드 (콘솔 로그로 대체)
  notify: (message, type = 'info') => {
    if (type === 'error') {
      logger.error('알림:', message);
    } else if (type === 'warn') {
      logger.warn('알림:', message);
    } else {
      logger.log('알림:', message);
    }
    // 향후 여기에 토스트 알림 라이브러리 연동 로직 추가 가능
    // 예: toast.show(message, { type: type });
  }
};