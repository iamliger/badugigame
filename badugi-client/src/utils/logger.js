// badugi-client/src/utils/logger.js

// Vite 환경에서는 process.env 대신 import.meta.env를 사용합니다.
// .env 파일에 VITE_DEBUG=true 와 같이 설정되어 있어야 합니다.
const IS_DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

/**
 * 로그 메시지를 브라우저 콘솔에 기록합니다.
 * @param {string} level - 로그 레벨 (log, info, warn, error)
 * @param {string} tag - 로그를 구분하는 태그 (예: [GameRoom], [Lobby])
 * @param {...any} messages - 기록할 메시지들
 */
function writeConsoleLog(level, tag, ...messages) {
  // 디버그 모드가 아니면 'log' 레벨 메시지는 출력하지 않습니다.
  if (!IS_DEBUG_MODE && level === 'log') {
    return;
  }

  const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 메시지들을 콘솔에서 보기 좋게 배열로 만듭니다.
  // Vue 개발자 도구에서 객체를 펼쳐볼 수 있도록 JSON.stringify 대신 원본 객체 전달
  const consoleMessages = messages.map(msg => {
    if (typeof msg === 'object' && msg !== null) {
      return msg;
    }
    return String(msg);
  });

  // 콘솔 출력 시 태그와 시간을 꾸미기 위해 CSS 스타일을 사용합니다.
  const consoleOutput = [
    `%c[${timestamp}] %c${tag}`,
    'color: gray; font-weight: normal;', // 시간 스타일
    `color: ${getLogTagColor(tag)}; font-weight: bold;`, // 태그 스타일
    ...consoleMessages
  ];

  switch (level) {
    case 'error':
      console.error(...consoleOutput);
      break;
    case 'warn':
      console.warn(...consoleOutput);
      break;
    case 'info':
      console.info(...consoleOutput);
      break;
    default: // 'log' 레벨
      console.log(...consoleOutput);
      break;
  }
}

/**
 * 로그 태그에 따라 콘솔 출력 색상을 반환합니다.
 * @param {string} tag - 로그 태그
 * @returns {string} CSS 색상 문자열
 */
function getLogTagColor(tag) {
  if (tag.includes('[GameRoom]')) return '#007bff'; // 파란색
  if (tag.includes('[Lobby]')) return '#28a745'; // 녹색
  if (tag.includes('[AUTH]')) return '#ffc107'; // 주황색
  if (tag.includes('[Notify]')) return '#6f42c1'; // 보라색 (알림 메시지)
  // 다른 태그에 대한 색상 추가 가능
  return '#6c757d'; // 기본 회색
}

/**
 * 애플리케이션 전역에서 사용할 로거 객체입니다.
 */
export const logger = {
  /**
   * 일반 디버그 로그를 기록합니다. 디버그 모드에서만 출력됩니다.
   * @param {string} tag - 로그 태그
   * @param {...any} messages - 메시지들
   */
  log: (tag, ...messages) => writeConsoleLog('log', tag, ...messages),

  /**
   * 정보성 로그를 기록합니다. 항상 출력됩니다.
   * @param {string} tag - 로그 태그
   * @param {...any} messages - 메시지들
   */
  info: (tag, ...messages) => writeConsoleLog('info', tag, ...messages),

  /**
   * 경고 로그를 기록합니다. 항상 출력됩니다.
   * @param {string} tag - 로그 태그
   * @param {...any} messages - 메시지들
   */
  warn: (tag, ...messages) => writeConsoleLog('warn', tag, ...messages),

  /**
   * 에러 로그를 기록합니다. 항상 출력됩니다.
   * @param {string} tag - 로그 태그
   * @param {...any} messages - 메시지들
   */
  error: (tag, ...messages) => writeConsoleLog('error', tag, ...messages),

  /**
   * 사용자에게 직접적으로 알림 메시지를 띄우는 함수입니다.
   * 현재는 콘솔에 알림 내용을 기록하는 방식으로 동작합니다.
   * 실제 UI 알림 컴포넌트(예: Toast, SweetAlert)와 연동할 수 있습니다.
   * @param {string} message - 사용자에게 보여줄 메시지
   * @param {'info' | 'warn' | 'error' | 'success'} type - 알림 타입
   */
  notify: (message, type = 'info') => {
    // 'alertClass' 변수는 실제 UI 알림 컴포넌트에서 동적으로 클래스를 적용할 때 사용됩니다.
    // 현재는 Vue template에서 직접 구현하지 않으므로 사용되지 않아 제거합니다.

    // 콘솔에 알림 내용을 기록합니다.
    // notify 메시지에도 태그를 붙여 어떤 컴포넌트에서 발생한 알림인지 명확히 합니다.
    writeConsoleLog('info', `[Notify - ${type.toUpperCase()}]`, message);

    // 실제 UI 알림 구현 예시 (필요시 주석 해제 및 구현)
    // 예를 들어, Vue 컴포넌트의 ToastManager 서비스 등을 호출합니다.
    // ToastManager.show(message, type);
  }
};