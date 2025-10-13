// badugi-game-server/server.js

// 📦 ESM 방식으로 모듈 임포트
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';

// 🃏 게임 서비스 임포트 (상대 경로로 ESM 방식)
import { GameService } from './src/services/GameService.js'; // .js 확장자 필수!

// 🚀 dotenv 설정 로드
dotenv.config();

const app = express();
const server = createServer(app);

const DEBUG_MODE = process.env.DEBUG === 'true';

// ✍️ 로깅 함수 정의 (서버 전역에서 사용, GameService에서도 import하여 사용)
export function logDebug(...args) {
    if (DEBUG_MODE) {
        console.log('[SERVER-DEBUG]', ...args);
    }
}
export function warnDebug(...args) {
    if (DEBUG_MODE) {
        console.warn('[SERVER-WARN]', ...args);
    }
}
export function errorDebug(...args) {
    console.error('[SERVER-ERROR]', ...args);
}

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://localhost:5173'];
const JWT_SECRET = process.env.JWT_SECRET;
const TURN_TIME_LIMIT = parseInt(process.env.TURN_TIME_LIMIT || '30');

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

const io = new SocketIOServer(server, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// 🔒 Socket.IO JWT 인증 미들웨어
io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
        warnDebug(`[AUTH] Socket ID: ${socket.id} - 토큰이 제공되지 않았습니다.`);
        return next(new Error('Authentication error: Token not provided'), { message: 'Authentication error: Token not provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = {
            id: parseInt(decoded.sub),
            name: decoded.name || `User${decoded.sub}`
        };
        logDebug(`[AUTH] Socket ID: ${socket.id}, 인증 성공 - User ID: ${socket.user.id}, Name: ${socket.user.name}`);
        next();
    } catch (err) {
        errorDebug(`[AUTH] Socket ID: ${socket.id}, 인증 실패 - ${err.message}`);
        if (err.name === 'TokenExpiredError') {
            return next(new Error('Authentication error: Token expired. Please re-login.'), { message: 'Authentication error: Token expired: Please re-login.' });
        }
        return next(new Error('Authentication error: Invalid token'));
    }
});

// --- 🎮 게임 로직 관련 임시 데이터 저장소 ---
const rooms = {};
let roomIdCounter = 1;

// 🎮 GameService 인스턴스 생성 및 초기화 (TURN_TIME_LIMIT 전달)
const gameService = new GameService(io, rooms, TURN_TIME_LIMIT);
// --- 🎮 게임 로직 관련 임시 데이터 저장소 끝 ---

// ✍️ 모든 클라이언트에게 방 목록 업데이트 브로드캐스트
function emitRoomsUpdate() {
    const publicRooms = Object.values(rooms).map(room => ({
        id: room.id,
        name: room.name,
        betAmount: room.betAmount,
        maxPlayers: room.maxPlayers,
        players: room.players.length,
        status: room.status,
        isPrivate: room.isPrivate,
    }));
    io.emit('roomsUpdated', publicRooms);
    logDebug('[LOBBY] 방 목록이 업데이트되어 모든 클라이언트에게 전송되었습니다.');
}

// ✍️ 특정 방의 플레이어들에게 방 정보 업데이트 브로드캐스트 (비밀번호 제외)
function emitRoomUpdate(roomId) {
    const room = rooms[roomId];
    if (room) {
        const sanitizedRoom = { ...room };
        delete sanitizedRoom.password; // 🚨 비밀번호는 클라이언트에 노출하지 않습니다.
        io.to(`room-${roomId}`).emit('roomUpdated', sanitizedRoom); // 방 전체 객체를 전송
        logDebug(`[ROOM] 방 ${room.id} 정보가 업데이트되어 ${room.players.length}명에게 전송되었습니다.`);
        emitRoomsUpdate(); // 로비 목록도 갱신
    }
}

// 🌐 HTTP 루트 경로
app.get('/', (req, res) => {
    res.send('<h1>바둑이 게임 서버가 실행 중입니다.</h1>');
});

// ⚡️ Socket.IO 연결 이벤트 핸들러
io.on('connection', (socket) => {
    const userId = socket.user.id;
    const userName = socket.user.name;

    logDebug(`[CONNECTION] 새로운 소켓 연결: ${socket.id}, 인증된 사용자: ${userName} (ID: ${userId})`);

    // 📩 클라이언트로부터 'getRooms' 이벤트 받으면 현재 방 목록 전송
    socket.on('getRooms', () => {
        emitRoomsUpdate();
    });

    // 📩 클라이언트로부터 'getRoomInfo' 이벤트 받으면 특정 방 정보 전송 (비밀번호 제외)
    socket.on('getRoomInfo', (roomId, callback) => {
        const room = rooms[roomId];
        if (room) {
            const sanitizedRoom = { ...room };
            delete sanitizedRoom.password; // 🚨 비밀번호는 클라이언트에 노출하지 않습니다.
            callback({ success: true, room: sanitizedRoom });
        } else {
            callback({ success: false, message: '존재하지 않는 방입니다.' });
        }
    });

    // 📩 클라이언트로부터 'createRoom' 이벤트 받으면 방 생성
    socket.on('createRoom', (roomData, callback) => {
        if (!roomData.name || !roomData.betAmount) {
            return callback({ success: false, message: '방 제목과 베팅 금액을 입력해주세요.' });
        }

        const newRoomId = roomIdCounter++;
        const newRoom = {
            id: newRoomId,
            name: roomData.name,
            creatorId: userId,
            betAmount: parseInt(roomData.betAmount),
            maxPlayers: 5,
            password: roomData.password || null,
            isPrivate: !!roomData.password,
            players: [],
            status: 'waiting',
            currentBettingRoundIndex: 0,
            currentExchangeOpportunityIndex: -1,
            pot: 0,
            currentBet: 0,
            activePlayers: [],
            lastBettingPlayer: null,
            lastActionPlayerId: null,
            turnIndex: 0,
            turnIndexAtRoundStart: null,
            dealerIndex: 0,
            dealerId: -1,
            smallBlindId: -1,
            bigBlindId: -1,
            timerProcessingLock: false,
            isBettingStartedThisRound: false, // ✨ NEW: 이 라운드에서 베팅이 시작되었는지 여부 플래그
            hands: {},
            discardPiles: {},
            currentTurnPlayerId: null,
            gameRoundName: '대기 중',
            currentPhase: 'waiting'
        };
        rooms[newRoomId] = newRoom;
        logDebug(`[ROOM] 방 생성됨: ${newRoom.name} (ID: ${newRoom.id}) by User ${userName}, 비밀방: ${newRoom.isPrivate}`);

        const sanitizedNewRoom = { ...newRoom };
        delete sanitizedNewRoom.password; // 클라이언트에 비밀번호 전달 안 함

        callback({ success: true, room: sanitizedNewRoom });
        emitRoomsUpdate();
    });

    // 📩 클라이언트로부터 'joinRoom' 이벤트 받으면 방 입장
    socket.on('joinRoom', (data, callback) => {
        const roomIdToJoin = data.roomId;
        const password = data.password;

        const room = rooms[roomIdToJoin];
        if (!room) {
            return callback({ success: false, message: '존재하지 않는 방입니다.' });
        }
        if (room.status !== 'waiting') {
            return callback({ success: false, message: '이미 게임이 진행 중인 방입니다.' });
        }
        if (room.players.length >= room.maxPlayers) {
            return callback({ success: false, message: '방이 가득 찼습니다.' });
        }
        if (room.isPrivate && room.password !== password) {
            return callback({ success: false, message: '비밀번호가 올바르지 않습니다.' });
        }

        const existingPlayerIndex = room.players.findIndex(p => p.id === userId);

        if (existingPlayerIndex > -1) {
            if (room.players[existingPlayerIndex].socketId !== socket.id) {
                room.players[existingPlayerIndex].socketId = socket.id;
                logDebug(`[ROOM] User ${userName} (ID: ${userId}) 재접속 및 소켓 업데이트됨. 방 ${room.name} (ID: ${room.id}).`);
            } else {
                logDebug(`[ROOM] User ${userName} (ID: ${userId})가 이미 방 ${room.name} (ID: ${room.id})에 입장해 있습니다. - 중복 요청 무시`);
            }
            socket.join(`room-${roomIdToJoin}`);
            emitRoomUpdate(roomIdToJoin);
            const sanitizedRoom = { ...room }; delete sanitizedRoom.password;
            return callback({ success: true, room: sanitizedRoom });
        }

        const player = {
            id: userId,
            name: userName,
            chips: 1000, // TODO: 실제 DB에서 칩 로드 (라라벨 연동)
            socketId: socket.id,
            isCreator: room.creatorId === userId,
            leaveReserved: false,
            currentRoundBet: 0,
            folded: false,
            status: 'waiting',
            bestHand: null,
            canExchange: false,
            hasActedInBettingRound: false,
        };
        room.players.push(player);
        socket.join(`room-${roomIdToJoin}`);
        logDebug(`[ROOM] User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에 입장했습니다.`);

        emitRoomUpdate(roomIdToJoin);
        const sanitizedRoom = { ...room }; delete sanitizedRoom.password;
        callback({ success: true, room: sanitizedRoom });
    });

    // 📩 클라이언트로부터 'leaveRoom' 이벤트 받으면 방 나가기
    socket.on('leaveRoom', (roomIdToLeave, callback) => {
        const room = rooms[roomIdToLeave];
        if (!room) {
            return callback({ success: true, message: '이미 존재하지 않는 방입니다.' });
        }

        const playerIndex = room.players.findIndex(p => p.id === userId);
        if (playerIndex === -1) {
            return callback({ success: false, message: '방에 입장해 있지 않습니다.' });
        }

        const leavingPlayer = room.players[playerIndex];

        if (room.creatorId === userId && room.players.length > 1 && room.status === 'waiting') {
            return callback({ success: false, message: '다른 플레이어가 있는 대기 중인 방장은 나갈 수 없습니다. 방을 삭제하려면 모든 플레이어가 나가야 합니다.' });
        }
        if (room.status === 'playing') {
            leavingPlayer.leaveReserved = true;
            logDebug(`[ROOM] User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 퇴장을 예약했습니다.`);
            emitRoomUpdate(roomIdToLeave);
            return callback({ success: false, message: '게임이 진행 중이므로 종료 후 나갈 수 없습니다.' });
        }

        room.players.splice(playerIndex, 1);
        socket.leave(`room-${roomIdToLeave}`);
        logDebug(`[ROOM] User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 나갔습니다.`);

        if (room.players.length === 0) {
            delete rooms[roomIdToLeave];
            logDebug(`[ROOM] 방 ${room.name} (ID: ${room.id})이(가) 삭제되었습니다.`);
        } else {
            if (room.creatorId === userId) {
                if (room.players.length > 0) {
                    room.creatorId = room.players[0].id;
                    room.players[0].isCreator = true;
                    logDebug(`[ROOM] 방 ${room.id}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})으로 위임되었습니다.`);
                }
            }
        }
        emitRoomUpdate(roomIdToLeave);
        callback({ success: true });
    });

    // 📩 클라이언트로부터 'reserveLeaveRoom' 이벤트 받으면 퇴장 예약
    socket.on('reserveLeaveRoom', (roomIdToReserve, callback) => {
        const room = rooms[roomIdToReserve];
        if (!room) {
            return callback({ success: false, message: '존재하지 않는 방입니다.' });
        }
        const player = room.players.find(p => p.id === userId);
        if (player && room.status === 'playing') {
            player.leaveReserved = true;
            logDebug(`[ROOM] User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 퇴장을 예약했습니다.`);
            emitRoomUpdate(roomIdToReserve);
            callback({ success: true });
        } else {
            callback({ success: false, message: '게임 중인 방에서만 퇴장 예약이 가능합니다.' });
        }
    });

    // 📩 클라이언트로부터 'cancelLeaveRoom' 이벤트 받으면 퇴장 예약 취소
    socket.on('cancelLeaveRoom', (roomIdToCancel, callback) => {
        const room = rooms[roomIdToCancel];
        if (!room) {
            return callback({ success: false, message: '존재하지 않는 방입니다.' });
        }
        const player = room.players.find(p => p.id === userId);
        if (player && room.status === 'playing' && player.leaveReserved) {
            player.leaveReserved = false;
            logDebug(`[ROOM] User ${userName} (ID: ${userId})가 방 ${room.name} (ID: ${room.id})에서 퇴장 예약을 취소했습니다.`);
            emitRoomUpdate(roomIdToCancel);
            callback({ success: true });
        } else {
            callback({ success: false, message: '게임 중인 방에서 예약된 퇴장만 취소할 수 없습니다.' });
        }
    });

    // 📩 클라이언트로부터 'startGame' 이벤트 받으면 게임 시작 처리
    socket.on('startGame', (roomIdToStart, callback) => {
        const room = rooms[roomIdToStart];
        if (!room) {
            return callback({ success: false, message: '존재하지 않는 방입니다.' });
        }
        if (room.creatorId !== userId) {
            return callback({ success: false, message: '방장만 게임을 시작할 수 있습니다.' });
        }
        if (room.players.length < 2) {
            return callback({ success: false, message: '최소 2명 이상의 플레이어가 필요합니다.' });
        }
        if (room.status === 'playing') {
            return callback({ success: false, message: '이미 게임이 진행 중입니다.' });
        }

        // 🎮 GameService를 통해 게임 시작
        const gameStarted = gameService.startGame(roomIdToStart);
        if (gameStarted) {
            logDebug(`[ROOM] 방 ${room.name} (ID: ${room.id}) 게임 시작!`);
            emitRoomUpdate(roomIdToStart); // 게임 시작 후 방 정보 업데이트
            callback({ success: true });
        } else {
            callback({ success: false, message: '게임 시작 중 오류가 발생했습니다.' });
        }
    });

    // 📩 클라이언트로부터 'playerAction' 이벤트 받으면 게임 액션 처리
    socket.on('playerAction', async (data, callback) => {
        const { roomId: actionRoomId, action, amount, cardsToExchange } = data;

        let result = { success: false, message: '알 수 없는 액션' };

        switch (action) {
            case 'check':
            case 'call':
            case 'bet':
            case 'raise':
            case 'die':
            case 'stay':
                result = gameService.handleBettingAction(actionRoomId, userId, action, amount);
                break;
            case 'exchange':
                result = gameService.handleCardExchange(actionRoomId, userId, cardsToExchange);
                break;
            default:
                warnDebug(`[SERVER] 알 수 없는 플레이어 액션: ${action}`);
                result = { success: false, message: `알 수 없는 액션 타입: ${action}` };
        }

        if (typeof callback === 'function') {
            if (result.success) {
                callback({ success: true });
            } else {
                callback({ success: false, message: result.message });
            }
        } else {
            warnDebug(`[SERVER] 클라이언트가 playerAction 이벤트에 콜백 함수를 제공하지 않았습니다.`);
        }
    });

    // 📩 클라이언트에서 JWT 만료 시 보내는 로그아웃 이벤트 처리
    socket.on('userLoggedOut', (data) => {
        const loggedOutUserId = data.userId;
        if (loggedOutUserId === userId) {
            logDebug(`[AUTH] User ${userName} (ID: ${loggedOutUserId})가 JWT 만료로 인해 로그아웃되었습니다. 모든 방에서 제거 및 소켓 연결 강제 해제.`);

            let roomUpdatedOccurred = false;

            for (const roomId in rooms) {
                const room = rooms[roomId];
                const playerIndex = room.players.findIndex(p => p.id === loggedOutUserId);
                if (playerIndex > -1) {
                    room.players.splice(playerIndex, 1);
                    logDebug(`[ROOM] User ${userName} (ID: ${loggedOutUserId})가 방 ${room.name} (ID: ${room.id})에서 제거되었습니다.`);

                    if (room.players.length === 0) {
                        delete rooms[roomId];
                        logDebug(`[ROOM] 방 ${room.name} (ID: ${room.id})이(가) 삭제되었습니다.`);
                    } else {
                        if (room.creatorId === loggedOutUserId) {
                            if (room.players.length > 0) {
                                room.creatorId = room.players[0].id;
                                room.players[0].isCreator = true;
                                logDebug(`[ROOM] 방 ${room.id}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})으로 위임되었습니다.`);
                            }
                        }
                    }
                    emitRoomUpdate(roomId);
                    roomUpdatedOccurred = true;
                }
            }

            if (roomUpdatedOccurred) {
                emitRoomsUpdate();
            }

            socket.disconnect(true);
        } else {
            warnDebug(`[AUTH] userLoggedOut 이벤트의 userId (${loggedOutUserId})가 현재 소켓의 userId (${userId})와 일치하지 않습니다. 요청 무시.`);
        }
    });

    // 📩 클라이언트 연결 해제 시
    socket.on('disconnect', () => {
        logDebug(`[CONNECTION] 소켓 연결 해제: ${socket.id}, 사용자: ${userName} (ID: ${userId})`);

        let roomUpdatedOccurred = false;
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);

            if (playerIndex > -1) {
                const disconnectedPlayer = room.players[playerIndex];

                if (room.status === 'playing' && !disconnectedPlayer.leaveReserved) {
                    disconnectedPlayer.leaveReserved = true;
                    logDebug(`[ROOM] User ${userName} (ID: ${userId}) (소켓 ${socket.id})가 연결 해제로 인해 게임 중 퇴장 예약되었습니다.`);
                    emitRoomUpdate(roomId);
                    roomUpdatedOccurred = true;
                } else {
                    room.players.splice(playerIndex, 1);
                    socket.leave(`room-${roomId}`);
                    logDebug(`[ROOM] User ${userName} (ID: ${userId}) (소켓 ${socket.id})가 방 ${room.name} (ID: ${room.id})에서 나갔습니다.`);

                    if (room.players.length === 0) {
                        delete rooms[roomId];
                        logDebug(`[ROOM] 방 ${room.name} (ID: ${room.id})이(가) 삭제되었습니다.`);
                    } else {
                        if (room.creatorId === userId) {
                            if (room.players.length > 0) {
                                room.creatorId = room.players[0].id;
                                room.players[0].isCreator = true;
                                logDebug(`[ROOM] 방 ${room.id}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})으로 위임되었습니다. (연결 해제 후)`);
                            }
                        }
                    }
                    emitRoomUpdate(roomId);
                    roomUpdatedOccurred = true;
                }
            }
        }
        if (roomUpdatedOccurred) {
            emitRoomsUpdate();
        }
    });
});

// 🌐 서버 시작
server.listen(PORT, () => {
    logDebug(`바둑이 게임 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    logDebug(`CORS 허용 Origin: ${CORS_ORIGIN.join(', ')}`);
    logDebug(`JWT Secret 로드됨: ${JWT_SECRET ? 'Yes' : 'No'}`);
    logDebug(`턴 시간 제한 (TURN_TIME_LIMIT): ${TURN_TIME_LIMIT}초`);
    if (!JWT_SECRET) {
        errorDebug('경고: JWT_SECRET이 설정되지 않았습니다. .env 파일을 확인해주세요!');
    }
});