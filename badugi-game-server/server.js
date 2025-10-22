// badugi-game-server/server.js

// 📦 ESM 방식으로 모듈 임포트
import dotenv from 'dotenv';
// ✨ FIX: .env 파일을 Node.js 프로젝트의 루트에서 정확히 로드하도록 경로를 명시합니다.
// `server.js`가 `badugi-game-server`의 루트에 있으므로 `./.env`가 올바른 경로입니다.
dotenv.config({ path: './.env' });

// ✨ MODIFIED: 로깅 함수를 logger.js에서 임포트
import { logDebug, warnDebug, errorDebug } from './logger.js'; // ✨ FIX: 현재 디렉토리에서 logger.js 임포트

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import axios from 'axios';

// 🃏 게임 서비스 임포트 (상대 경로로 ESM 방식)
import { GameService } from './src/services/GameService.js';
import RobotController from './src/controllers/RobotController.js';

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://localhost:5173'];
const TURN_TIME_LIMIT = parseInt(process.env.TURN_TIME_LIMIT || '30');
const GAME_SERVER_API_SECRET = process.env.GAME_SERVER_API_SECRET;

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

const authenticateGameServerApi = (req, res, next) => {
    const secret = req.header('X-Game-Server-API-Secret');
    if (!GAME_SERVER_API_SECRET || secret === GAME_SERVER_API_SECRET) {
        next();
    } else {
        errorDebug('[API-AUTH]', `잘못된 API Secret 접근 시도: ${req.ip}`);
        return res.status(401).json({ message: 'Unauthorized: Invalid API Secret' });
    }
};

const io = new SocketIOServer(server, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true
    }
});

logDebug('[dotenv]', `JWT_SECRET 로드됨: ${process.env.JWT_SECRET ? 'Yes' : 'No'}`);
logDebug('[dotenv]', `LARAVEL_ROBOT_LOGIN_API_URL 로드됨: ${process.env.LARAVEL_ROBOT_LOGIN_API_URL ? 'Yes' : 'No'}`);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    errorDebug('[SERVER]', '경고: JWT_SECRET이 설정되지 않았습니다. .env 파일을 확인해주세요! (Laravel Tymon/JWTAuth 키 값으로 설정)');
}

const LARAVEL_USER_AUTH_CHECK_TOKEN_URL = process.env.LARAVEL_USER_AUTH_CHECK_TOKEN_URL || 'http://localhost:8000/api/auth/check-token';
const LARAVEL_ROBOT_AUTH_CHECK_TOKEN_URL = process.env.LARAVEL_ROBOT_AUTH_CHECK_TOKEN_URL || 'http://localhost:8000/api/robot-auth/check-token';

async function tryAuthenticateRobot(socketId, token) {
    const parts = token.split('|');
    const isSanctumTokenFormat = (parts.length === 2 && !isNaN(parseInt(parts[0])));

    if (!isSanctumTokenFormat) {
        throw new Error('RobotAuth: Token is not in expected Sanctum format (ID|TOKEN).');
    }

    try {
        const robotResponse = await axios.post(LARAVEL_ROBOT_AUTH_CHECK_TOKEN_URL, {}, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (robotResponse.data.status === 'success' && robotResponse.data.robot) {
            const robot = robotResponse.data.robot;
            logDebug('[AUTH]', `Socket ID: ${socketId}, 인증 성공 (로봇 API) - 로봇 ID: ${robot.id}, 이름: ${robot.name}`);
            return {
                id: parseInt(robot.id),
                name: robot.name || `Robot${robot.id}`,
                isRobot: true,
                email: robot.email,
                points: robot.points,
            };
        } else {
            throw new Error(robotResponse.data.error || 'RobotAuth: API verification failed.');
        }
    } catch (robotErr) {
        const status = robotErr.response?.status || 'network error';
        const dataError = robotErr.response?.data?.error || '';
        const message = robotErr.message;
        throw new Error(`RobotAuth: API call failed (Status: ${status}): ${dataError || message}`);
    }
}

async function tryAuthenticateUser(socketId, token) {
    if (!JWT_SECRET) {
        throw new Error('UserAuth: Server configuration error: JWT_SECRET not set.');
    }

    const isJwtAuthTokenFormat = (token.split('.').length === 3);

    if (!isJwtAuthTokenFormat) {
        throw new Error('UserAuth: Token is not in expected JWTAuth format (header.payload.signature).');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userResponse = await axios.post(LARAVEL_USER_AUTH_CHECK_TOKEN_URL, {}, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (userResponse.data.status === 'success' && userResponse.data.user) {
            const user = userResponse.data.user;
            logDebug('[AUTH]', `Socket ID: ${socketId}, 인증 성공 (사용자 API) - 사용자 ID: ${user.id}, 이름: ${user.name}`);
            return {
                id: parseInt(user.id),
                name: user.name || `User${user.id}`,
                isRobot: false,
                email: user.email,
                points: user.points,
            };
        } else {
            throw new Error(userResponse.data.error || 'UserAuth: API verification failed.');
        }
    } catch (userJwtErr) {
        throw new Error(`UserAuth: JWT verification failed: ${userJwtErr.message}`);
    }
}

io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
        warnDebug('[AUTH]', `Socket ID: ${socket.id} - 토큰이 제공되지 않았습니다.`);
        return next(new Error('Authentication error: Token not provided'), { message: 'Authentication error: Token not provided' });
    }

    if (!JWT_SECRET) {
        errorDebug('[AUTH]', `Socket ID: ${socket.id} - JWT_SECRET이 설정되지 않아 JWTAuth 토큰 검증 불가. 이 오류는 수정되어야 합니다.`);
        return next(new Error('Server configuration error: JWT_SECRET not set.'), { message: 'Server configuration error: JWT_SECRET not set.' });
    }

    let authenticatedEntity = null;
    let errorsDuringAttempts = [];

    try {
        authenticatedEntity = await tryAuthenticateRobot(socket.id, token);
        socket.user = authenticatedEntity;
        return next();
    } catch (err) {
        errorsDuringAttempts.push(err.message);
    }

    try {
        authenticatedEntity = await tryAuthenticateUser(socket.id, token);
        socket.user = authenticatedEntity;
        return next();
    } catch (err) {
        errorsDuringAttempts.push(err.message);
    }

    const finalErrorMessage = errorsDuringAttempts.length > 0
        ? errorsDuringAttempts.join('; ')
        : "Unknown authentication failure after all attempts.";

    errorDebug('[AUTH]', `Socket ID: ${socket.id}, 최종 인증 실패 - ${finalErrorMessage}`);
    return next(new Error(`Authentication error: ${finalErrorMessage}`), { message: `Authentication error: ${finalErrorMessage}` });
});

const rooms = {};
let roomIdCounter = 1;

const gameService = new GameService(io, rooms, TURN_TIME_LIMIT);

const activeBots = {};

const robotController = new RobotController(gameService, activeBots);

function emitRoomsUpdate() {
    const publicRooms = Object.values(rooms).map(room => ({
        id: room.id, name: room.name, betAmount: room.betAmount, maxPlayers: room.maxPlayers,
        players: room.players.length, status: room.status, isPrivate: room.isPrivate,
    }));
    io.emit('roomsUpdated', publicRooms);
    logDebug('[LOBBY]', '방 목록이 업데이트되어 모든 클라이언트에게 전송되었습니다.');
}

function emitRoomUpdate(roomId) {
    const room = rooms[roomId];
    if (room) {
        const sanitizedRoom = { ...room };
        delete sanitizedRoom.password;
        io.to(`room-${roomId}`).emit('roomUpdated', sanitizedRoom);
        logDebug('[ROOM]', `방 ${room.id} 정보가 업데이트되어 ${room.players.length}명에게 전송되었습니다.`);
        emitRoomsUpdate();
    }
}

app.get('/', (req, res) => {
    res.send('<h1>바둑이 게임 서버가 실행 중입니다.</h1>');
});

app.post('/api/robot-commands/start', authenticateGameServerApi, (req, res) => robotController.startRobots(req, res));
app.post('/api/robot-commands/stop', authenticateGameServerApi, (req, res) => robotController.stopRobots(req, res));

io.on('connection', (socket) => {
    const userId = socket.user.id;
    const userName = socket.user.name;

    logDebug('[CONNECTION]', `새로운 소켓 연결: ${socket.id}, 인증된 사용자: ${userName} (ID: ${userId})`);

    socket.on('getRooms', () => { emitRoomsUpdate(); });

    socket.on('getRoomInfo', (roomId, callback) => {
        const room = rooms[roomId];
        if (room) {
            const sanitizedRoom = { ...room };
            delete sanitizedRoom.password;
            callback({ success: true, room: sanitizedRoom });
        } else {
            callback({ success: false, message: '존재하지 않는 방입니다.' });
        }
    });

    socket.on('createRoom', (roomData, callback) => {
        if (!roomData.name || !roomData.betAmount) {
            return callback({ success: false, message: '방 제목과 베팅 금액을 입력해주세요.' });
        }

        const newRoomId = roomIdCounter++;
        const newRoom = {
            id: newRoomId, name: roomData.name, creatorId: userId, betAmount: parseInt(roomData.betAmount),
            maxPlayers: 5, password: roomData.password || null, isPrivate: !!roomData.password,
            players: [], status: 'waiting', currentBettingRoundIndex: 0, currentExchangeOpportunityIndex: -1,
            pot: 0, currentBet: 0, activePlayers: [], lastBettingPlayer: null, lastActionPlayerId: null,
            turnIndex: 0, turnIndexAtRoundStart: null, dealerIndex: 0, dealerId: -1, smallBlindId: -1,
            bigBlindId: -1, timerProcessingLock: false, isBettingStartedThisRound: false, hands: {},
            discardPiles: {}, currentTurnPlayerId: null, gameRoundName: '대기 중', currentPhase: 'waiting'
        };
        rooms[newRoomId] = newRoom;
        logDebug('[ROOM]', `방 생성됨: ${newRoom.name} (ID: ${newRoom.id}) by User ${userName}, 비밀방: ${newRoom.isPrivate}`);

        const sanitizedNewRoom = { ...newRoom };
        delete sanitizedNewRoom.password;

        callback({ success: true, room: sanitizedNewRoom });
        emitRoomsUpdate();
    });

    socket.on('joinRoom', (data, callback) => {
        const roomIdToJoin = data.roomId;
        const password = data.password;

        const room = rooms[roomIdToJoin];
        if (!room) { return callback({ success: false, message: '존재하지 않는 방입니다.' }); }
        if (room.status !== 'waiting') { return callback({ success: false, message: '이미 게임이 진행 중인 방입니다.' }); }
        if (room.players.length >= room.maxPlayers) { return callback({ success: false, message: '방이 가득 찼습니다.' }); }
        if (room.isPrivate && room.password !== password) { return callback({ success: false, message: '비밀번호가 올바르지 않습니다.' }); }

        const existingPlayerIndex = room.players.findIndex(p => p.id === userId);

        if (existingPlayerIndex > -1) {
            if (room.players[existingPlayerIndex].socketId !== socket.id) {
                room.players[existingPlayerIndex].socketId = socket.id;
                logDebug('[ROOM]', `User ${userName} (ID: ${userId}) 재접속 및 소켓 업데이트됨. 방 ${room.name} (ID: ${room.id}).`);
            } else {
                logDebug('[ROOM]', `User ${userName} (ID: ${userId})가 이미 방 ${room.name} (ID: ${room.id})에 입장해 있습니다. - 중복 요청 무시`);
            }
            socket.join(`room-${roomIdToJoin}`);
            emitRoomUpdate(roomIdToJoin);
            const sanitizedRoom = { ...room }; delete sanitizedRoom.password;
            return callback({ success: true, room: sanitizedRoom });
        }

        const playerInitialChips = data.initialChips || 100000;

        const player = {
            id: userId, name: userName, chips: playerInitialChips, socketId: socket.id,
            isCreator: room.creatorId === userId, leaveReserved: false, currentRoundBet: 0,
            folded: false, status: 'waiting', bestHand: null, canExchange: false,
            hasActedInBettingRound: false,
        };
        room.players.push(player);
        socket.join(`room-${roomIdToJoin}`);
        logDebug('[ROOM]', `User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에 입장했습니다.`);

        emitRoomUpdate(roomIdToJoin);
        const sanitizedRoom = { ...room }; delete sanitizedRoom.password;
        callback({ success: true, room: sanitizedRoom });
    });

    socket.on('leaveRoom', (roomIdToLeave, callback) => {
        const room = rooms[roomIdToLeave];
        if (!room) { return callback({ success: true, message: '이미 존재하지 않는 방입니다.' }); }

        const playerIndex = room.players.findIndex(p => p.id === userId);
        if (playerIndex === -1) { return callback({ success: false, message: '방에 입장해 있지 않습니다.' }); }

        const leavingPlayer = room.players[playerIndex];

        if (room.creatorId === userId && room.players.length > 1 && room.status === 'waiting') {
            return callback({ success: false, message: '다른 플레이어가 있는 대기 중인 방장은 나갈 수 없습니다. 방을 삭제하려면 모든 플레이어가 나가야 합니다.' });
        }
        if (room.status === 'playing') {
            leavingPlayer.leaveReserved = true;
            logDebug('[ROOM]', `User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 퇴장을 예약했습니다.`);
            emitRoomUpdate(roomIdToLeave);
            return callback({ success: false, message: '게임이 진행 중이므로 종료 후 나갈 수 없습니다.' });
        }

        room.players.splice(playerIndex, 1);
        socket.leave(`room-${roomIdToLeave}`);
        logDebug('[ROOM]', `User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 나갔습니다.`);

        if (room.players.length === 0) {
            delete rooms[roomIdToLeave];
            logDebug('[ROOM]', `방 ${room.name} (ID: ${room.id})이(가) 삭제되었습니다.`);
        } else {
            if (room.creatorId === userId) {
                if (room.players.length > 0) {
                    room.creatorId = room.players[0].id;
                    room.players[0].isCreator = true;
                    logDebug('[ROOM]', `방 ${room.id}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})으로 위임되었습니다.`);
                }
            }
        }
        emitRoomUpdate(roomIdToLeave);
        callback({ success: true });
    });

    socket.on('reserveLeaveRoom', (roomIdToReserve, callback) => {
        const room = rooms[roomIdToReserve];
        if (!room) { return callback({ success: false, message: '존재하지 않는 방입니다.' }); }
        const player = room.players.find(p => p.id === userId);
        if (player && room.status === 'playing') {
            player.leaveReserved = true;
            logDebug('[ROOM]', `User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 퇴장을 예약했습니다.`);
            emitRoomUpdate(roomIdToReserve);
            callback({ success: true });
        } else {
            callback({ success: false, message: '게임 중인 방에서만 퇴장 예약이 가능합니다.' });
        }
    });

    socket.on('cancelLeaveRoom', (roomIdToCancel, callback) => {
        const room = rooms[roomIdToCancel];
        if (!room) { return callback({ success: false, message: '존재하지 않는 방입니다.' }); }
        const player = room.players.find(p => p.id === userId);
        if (player && room.status === 'playing' && player.leaveReserved) {
            player.leaveReserved = false;
            logDebug('[ROOM]', `User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 퇴장 예약을 취소했습니다.`);
            emitRoomUpdate(roomIdToCancel);
            callback({ success: true });
        } else {
            callback({ success: false, message: '게임 중인 방에서 예약된 퇴장만 취소할 수 없습니다.' });
        }
    });

    socket.on('startGame', (roomIdToStart, callback) => {
        const room = rooms[roomIdToStart];
        if (!room) { return callback({ success: false, message: '존재하지 않는 방입니다.' }); }
        if (room.creatorId !== userId) { return callback({ success: false, message: '방장만 게임을 시작할 수 있습니다.' }); }
        if (room.players.length < 2) { return callback({ success: false, message: '최소 2명 이상의 플레이어가 필요합니다.' }); }
        if (room.status === 'playing') { return callback({ success: false, message: '이미 게임이 진행 중입니다.' }); }

        const gameStarted = gameService.startGame(roomIdToStart);
        if (gameStarted) {
            logDebug('[ROOM]', `방 ${room.name} (ID: ${room.id}) 게임 시작!`);
            emitRoomUpdate(roomIdToStart);
            callback({ success: true });
        } else {
            callback({ success: false, message: '게임 시작 중 오류가 발생했습니다.' });
        }
    });

    socket.on('playerAction', async (data, callback) => {
        const { roomId: actionRoomId, action, amount, cardsToExchange } = data;

        let result = { success: false, message: '알 수 없는 액션' };

        switch (action) {
            case 'check': case 'call': case 'bet': case 'raise': case 'die':
                result = gameService.handleBettingAction(actionRoomId, userId, action, amount); break;
            case 'exchange': case 'stay':
                result = gameService.handleCardExchange(actionRoomId, userId, cardsToExchange); break;
            default:
                warnDebug('[SERVER]', `알 수 없는 플레이어 액션: ${action}`);
                result = { success: false, message: `알 수 없는 액션 타입: ${action}` };
        }

        if (typeof callback === 'function') {
            if (result.success) { callback({ success: true }); }
            else { callback({ success: false, message: result.message }); }
        } else {
            warnDebug('[SERVER]', `클라이언트가 playerAction 이벤트에 콜백 함수를 제공하지 않았습니다.`);
        }
    });

    socket.on('userLoggedOut', (data) => {
        const loggedOutUserId = data.userId;
        if (loggedOutUserId === userId) {
            logDebug('[AUTH]', `User ${userName} (ID: ${loggedOutUserId})가 JWT 만료로 인해 로그아웃되었습니다. 모든 방에서 제거 및 소켓 연결 강제 해제.`);

            let roomUpdatedOccurred = false;

            for (const roomId in rooms) {
                const room = rooms[roomId];
                const playerIndex = room.players.findIndex(p => p.id === loggedOutUserId);
                if (playerIndex > -1) {
                    room.players.splice(playerIndex, 1);
                    logDebug('[ROOM]', `User ${userName} (ID: ${loggedOutUserId})가 방 ${room.name} (ID: ${room.id})에서 제거되었습니다.`);

                    if (room.players.length === 0) {
                        delete rooms[roomId];
                        logDebug('[ROOM]', `방 ${room.name} (ID: ${room.id})이(가) 삭제되었습니다.`);
                    } else {
                        if (room.creatorId === loggedOutUserId) {
                            if (room.players.length > 0) {
                                room.creatorId = room.players[0].id;
                                room.players[0].isCreator = true;
                                logDebug('[ROOM]', `방 ${room.id}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})으로 위임되었습니다.`);
                            }
                        }
                    }
                    emitRoomUpdate(roomId);
                    roomUpdatedOccurred = true;
                }
            }

            if (roomUpdatedOccurred) { emitRoomsUpdate(); }

            socket.disconnect(true);
        } else {
            warnDebug('[AUTH]', `userLoggedOut 이벤트의 userId (${loggedOutUserId})가 현재 소켓의 userId (${userId})와 일치하지 않습니다. 요청 무시.`);
        }
    });

    socket.on('disconnect', () => {
        logDebug('[CONNECTION]', `소켓 연결 해제: ${socket.id}, 사용자: ${userName} (ID: ${userId})`);

        let roomUpdatedOccurred = false;
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);

            if (playerIndex > -1) {
                const disconnectedPlayer = room.players[playerIndex];

                if (room.status === 'playing' && !disconnectedPlayer.leaveReserved) {
                    disconnectedPlayer.leaveReserved = true;
                    logDebug('[ROOM]', `User ${userName} (ID: ${userId}) (소켓 ${socket.id})가 연결 해제로 인해 게임 중 퇴장 예약되었습니다.`);
                    emitRoomUpdate(roomId);
                    roomUpdatedOccurred = true;
                } else {
                    room.players.splice(playerIndex, 1);
                    socket.leave(`room-${roomId}`);
                    logDebug('[ROOM]', `User ${userName} (ID: ${userId}) (소켓 ${socket.id})가 방 ${room.name} (ID: ${room.id})에서 나갔습니다.`);

                    if (room.players.length === 0) {
                        delete rooms[roomId];
                        logDebug('[ROOM]', `방 ${room.name} (ID: ${room.id})이(가) 삭제되었습니다.`);
                    } else {
                        if (room.creatorId === userId) {
                            if (room.players.length > 0) {
                                room.creatorId = room.players[0].id;
                                room.players[0].isCreator = true;
                                logDebug('[ROOM]', `방 ${room.id}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})으로 위임되었습니다. (연결 해제 후)`);
                            }
                        }
                    }
                    emitRoomUpdate(roomId);
                    roomUpdatedOccurred = true;
                }
            }
        }
        if (roomUpdatedOccurred) { emitRoomsUpdate(); }
    });
});

server.listen(PORT, () => {
    logDebug('[SERVER]', `바둑이 게임 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    logDebug('[SERVER]', `CORS 허용 Origin: ${CORS_ORIGIN.join(', ')}`);
    logDebug('[SERVER]', `JWT Secret 로드됨: ${JWT_SECRET ? 'Yes' : 'No'}`);
    logDebug('[SERVER]', `턴 시간 제한 (TURN_TIME_LIMIT): ${TURN_TIME_LIMIT}초`);
    logDebug('[SERVER]', `게임 서버 API Secret 로드됨: ${GAME_SERVER_API_SECRET ? 'Yes' : 'No'}`);
    logDebug('[SERVER]', `Laravel 일반 사용자 토큰 검증 URL: ${LARAVEL_USER_AUTH_CHECK_TOKEN_URL}`);
    logDebug('[SERVER]', `Laravel 로봇 토큰 검증 URL: ${LARAVEL_ROBOT_AUTH_CHECK_TOKEN_URL}`);
    logDebug('[SERVER]', `Laravel 로봇 로그인 API URL (from server.js startup): ${process.env.LARAVEL_ROBOT_LOGIN_API_URL ? 'Yes' : 'No'}`);
    if (!JWT_SECRET) { errorDebug('[SERVER]', '경고: JWT_SECRET이 설정되지 않았습니다. .env 파일을 확인해주세요!'); }
    if (!GAME_SERVER_API_SECRET) { errorDebug('[SERVER]', '경고: GAME_SERVER_API_SECRET이 설정되지 않았습니다. .env 파일을 확인해주세요!'); }
});