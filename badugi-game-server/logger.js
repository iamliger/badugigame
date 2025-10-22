// badugi-game-server/logger.js
import fs from 'fs';          // 파일 시스템 모듈
import path from 'path';      // 경로 모듈
import { fileURLToPath } from 'url'; // ESM에서 __dirname 대용

// .env 파일 로드 (server.js에서도 로드하지만, 독립성 유지를 위해 이곳에서도 로드)
// `import.meta.url`을 기준으로 `.env` 파일의 상대 경로를 찾습니다.
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 로그 디렉토리 및 파일 경로 정의
const LOG_DIR = path.resolve(__dirname, '../logs'); // badugi-game-server/logs 폴더
const LOG_FILE = path.join(LOG_DIR, 'game-server.log');
const DEBUG_MODE = process.env.APP_DEBUG === 'true'; // .env에서 디버그 모드 가져오기

// 로그 디렉토리가 없으면 생성 (동기 방식으로 처리하여 로그 쓰기 전 디렉토리 존재 보장)
if (!fs.existsSync(LOG_DIR)) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        console.log(`[LOGGER INIT] 로그 디렉토리 생성됨: ${LOG_DIR}`);
    } catch (err) {
        console.error(`[LOGGER INIT] 로그 디렉토리 생성 오류: ${err.message}`);
    }
} else {
    // console.log(`[LOGGER INIT] 로그 디렉토리 존재: ${LOG_DIR}`); // 필요시 활성화
}

/**
 * 로그 메시지를 콘솔과 파일에 기록하는 내부 헬퍼 함수입니다.
 * @param {'DEBUG'|'WARN'|'ERROR'|'INFO'} level - 로그 레벨
 * @param {string} tag - 로그를 구분하는 태그 (예: [AUTH], [ROOM])
 * @param {...any} messages - 기록할 메시지들
 */
function writeLog(level, tag, ...messages) {
    // 디버그 모드가 아니면 DEBUG 레벨은 출력하지 않습니다.
    if (level === 'DEBUG' && !DEBUG_MODE) {
        return;
    }

    const timestamp = new Date().toISOString(); // ISO 8601 형식 (YYYY-MM-DDTHH:mm:ss.sssZ)

    // 메시지들을 문자열로 변환 (객체는 JSON.stringify)
    const formattedMessage = messages.map(msg => {
        if (typeof msg === 'object' && msg !== null) {
            try {
                return JSON.stringify(msg, null, 2); // 보기 좋게 2칸 들여쓰기
            } catch (e) {
                return '[Circular Object]'; // 순환 참조 오류 방지
            }
        }
        return String(msg);
    }).join(' '); // 메시지들을 공백으로 연결

    const logEntry = `${timestamp} [${level}] ${tag} ${formattedMessage}\n`;

    // 1. 콘솔 출력
    switch (level) {
        case 'DEBUG':
            console.log(`\x1b[36m${logEntry.trim()}\x1b[0m`); // 시안색 (청록)
            break;
        case 'WARN':
            console.warn(`\x1b[33m${logEntry.trim()}\x1b[0m`); // 노란색
            break;
        case 'ERROR':
            console.error(`\x1b[31m${logEntry.trim()}\x1b[0m`); // 빨간색
            break;
        case 'INFO':
        default:
            console.log(logEntry.trim()); // 기본 색상
            break;
    }

    // 2. 파일에 기록 (비동기)
    fs.appendFile(LOG_FILE, logEntry, (err) => {
        if (err) {
            // 파일 쓰기 오류 발생 시 콘솔에만 출력 (순환 오류 방지)
            console.error(`\x1b[31m[LOGGER FILE ERROR] 파일 '${LOG_FILE}' 쓰기 오류: ${err.message}\x1b[0m`);
        }
    });
}

/**
 * 디버그 정보를 기록합니다. DEBUG_MODE가 true일 때만 콘솔에 출력되고 파일에 기록됩니다.
 * @param {string} tag - 로그 태그 (예: [GameService])
 * @param {...any} messages - 기록할 메시지들
 */
export function logDebug(tag, ...messages) {
    writeLog('DEBUG', tag, ...messages);
}

/**
 * 경고 메시지를 기록합니다. 항상 콘솔에 노란색으로 출력되고 파일에 기록됩니다.
 * @param {string} tag - 로그 태그 (예: [AUTH])
 * @param {...any} messages - 기록할 메시지들
 */
export function warnDebug(tag, ...messages) {
    writeLog('WARN', tag, ...messages);
}

/**
 * 에러 메시지를 기록합니다. 항상 콘솔에 빨간색으로 출력되고 파일에 기록됩니다.
 * @param {string} tag - 로그 태그 (예: [SERVER])
 * @param {...any} messages - 기록할 메시지들
 */
export function errorDebug(tag, ...messages) {
    writeLog('ERROR', tag, ...messages);
}

// 정보성 로그도 필요하다면 추가할 수 있습니다.
export function logInfo(tag, ...messages) {
    writeLog('INFO', tag, ...messages);
}