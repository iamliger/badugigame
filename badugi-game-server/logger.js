// badugi-game-server/logger.js

import dotenv from 'dotenv';
dotenv.config({ path: '.env' }); // logger 모듈 내에서도 .env를 로드하여 독립성 확보

// DEBUG_MODE는 이 파일 내에서만 필요하므로 export하지 않습니다.
const DEBUG_MODE = process.env.DEBUG === 'true';

/**
 * 디버그 메시지를 콘솔에 출력합니다. DEBUG_MODE가 true일 때만 출력됩니다.
 * @param {...any} args - 출력할 메시지 또는 데이터
 */
export function logDebug(...args) {
    if (DEBUG_MODE) {
        console.log('[SERVER-DEBUG]', ...args);
    }
}

/**
 * 경고 디버그 메시지를 콘솔에 출력합니다. DEBUG_MODE가 true일 때만 출력됩니다.
 * @param {...any} args - 출력할 메시지 또는 데이터
 */
export function warnDebug(...args) {
    if (DEBUG_MODE) {
        console.warn('[SERVER-WARN]', ...args);
    }
}

/**
 * 에러 디버그 메시지를 콘솔에 출력합니다. 항상 출력됩니다.
 * @param {...any} args - 출력할 메시지 또는 데이터
 */
export function errorDebug(...args) {
    console.error('[SERVER-ERROR]', ...args);
}