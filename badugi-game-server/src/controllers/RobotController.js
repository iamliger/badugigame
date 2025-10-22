// badugi-game-server/src/controllers/RobotController.js

import { io } from "socket.io-client";
import axios from 'axios';
import { logDebug, warnDebug, errorDebug } from '../../logger.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url'; // ESM에서 __dirname을 사용하기 위한 헬퍼

// 🌟 첫 번째 해결책: dotenv.config()에 .env 파일의 정확한 절대 경로 지정 🌟
// 현재 파일(__filename)의 경로를 기준으로, 두 단계 상위 디렉토리(../../)로 이동하여
// badugi-game-server 프로젝트의 루트에 있는 .env 파일을 찾습니다.
const __filename = fileURLToPath(import.meta.url); // 현재 파일의 URL
const __dirname = path.dirname(__filename);      // 현재 파일이 있는 디렉토리 경로
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // 루트 .env 파일을 로드

// 봇이 사용할 라라벨 API URL (로그인 등)
// const LARAVEL_API_URL = process.env.LARAVEL_API_URL || 'http://localhost:8000/api/auth';
const LARAVEL_ROBOT_LOGIN_API_URL = process.env.LARAVEL_ROBOT_LOGIN_API_URL || 'http://localhost:8000/api/robot-auth/login';
const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';

logDebug('[RobotController Init]', `LARAVEL_ROBOT_LOGIN_API_URL: ${LARAVEL_ROBOT_LOGIN_API_URL}`);

if (!process.env.LARAVEL_ROBOT_LOGIN_API_URL) {
    errorDebug('[RobotController Init]', '경고: LARAVEL_ROBOT_LOGIN_API_URL 환경 변수가 .env 파일에 정의되지 않았습니다. 기본값을 사용합니다.');
}

class RobotController {
    constructor(gameService, activeBots) {
        this.gameService = gameService;
        this.activeBots = activeBots;

        this.startRobots = this.startRobots.bind(this);
        this.stopRobots = this.stopRobots.bind(this);
    }

    /**
     * 로봇 로그인 및 소켓 연결을 처리합니다.
     * @param {Object} robotData - 라라벨에서 전달받은 로봇 정보 (id, name, email, password 등)
     * @returns {Promise<Socket|null>} 연결된 소켓 인스턴스 또는 null
     */
    async connectBot(robotData) {
        const { id: userId, name: userName, email, password, points } = robotData;

        if (this.activeBots[userId]) {
            warnDebug('[RobotController]', `로봇 ${userName} (ID: ${userId}) 이미 활성화되어 있습니다.`); // ✨ FIX: 태그 추가
            return this.activeBots[userId];
        }

        logDebug('[RobotController]', `로봇 ${userName} (ID: ${userId}) 로그인 시도: ${email}`); // ✨ FIX: 태그 추가

        let token = '';
        try {
            // ✨ 환경 변수가 여기에 도달하는지 다시 확인
            if (!LARAVEL_ROBOT_LOGIN_API_URL) {
                errorDebug('[RobotController]', 'FATAL: LARAVEL_ROBOT_LOGIN_API_URL is UNDEFINED at connectBot execution.'); // ✨ FIX: 태그 추가
                throw new Error('LARAVEL_ROBOT_LOGIN_API_URL is not defined in RobotController.');
            }

            // Laravel 로봇 인증 API를 호출하여 Sanctum 토큰 획득
            const loginResponse = await axios.post(LARAVEL_ROBOT_LOGIN_API_URL, {
                email: email,
                password: 'password'
            });
            token = loginResponse.data.access_token;
            logDebug('[RobotController]', `로봇 ${userName} 로그인 성공. 토큰 획득. 칩: ${points}. 토큰 시작: ${token.substring(0, 20)}...`); // ✨ FIX: 태그 추가
        } catch (error) {
            errorDebug('[RobotController]', `로봇 ${userName} 로그인 실패:`, error.response?.data || error.message || `No response from ${LARAVEL_ROBOT_LOGIN_API_URL}`); // ✨ FIX: 태그 추가
            return null;
        }

        const socket = io(GAME_SERVER_URL, {
            auth: { token: token },
            autoConnect: false,
            transports: ['websocket'],
            query: { isBot: true }
        });

        socket.userId = userId;
        socket.userName = userName;
        socket.userChips = points;
        socket.currentRoomId = null;
        socket.currentHand = [];
        socket.roomState = null;

        // --- Socket 이벤트 핸들러 ---
        socket.on('connect', () => {
            logDebug(`[Robot ${socket.userName}]`, `Socket.IO 연결 성공. ID: ${socket.id}`); // ✨ FIX: 태그 추가
            this.activeBots[userId] = socket;
            socket.emit('getRooms');
        });

        socket.on('disconnect', (reason) => {
            logDebug(`[Robot ${socket.userName}]`, `Socket.IO 연결 해제: ${reason}`); // ✨ FIX: 태그 추가
            delete this.activeBots[userId];
        });

        socket.on('connect_error', (err) => {
            errorDebug(`[Robot ${socket.userName}]`, `Socket.IO 연결 오류: ${err.message}`); // ✨ FIX: 태그 추가
        });

        socket.on('roomsUpdated', (rooms) => {
            // logDebug(`[Robot ${socket.userName}]`, `방 목록 업데이트 수신 (${rooms.length}개)`); // 디버깅용 로그, 필요에 따라 활성화
            if (!socket.currentRoomId) {
                let availableRoom = rooms.find(r => r.status === 'waiting' && r.players < r.maxPlayers && !r.isPrivate);
                if (availableRoom) {
                    socket.emit('joinRoom', { roomId: availableRoom.id, initialChips: socket.userChips }, (response) => {
                        if (response.success) {
                            logDebug(`[Robot ${socket.userName}]`, `방 ${availableRoom.name} (${availableRoom.id}) 입장 성공.`); // ✨ FIX: 태그 추가
                            socket.currentRoomId = availableRoom.id;
                            if (response.room.creatorId === socket.userId && response.room.players.length >= 2) {
                                socket.emit('startGame', availableRoom.id, (startRes) => {
                                    if (startRes.success) {
                                        logDebug(`[Robot ${socket.userName}]`, `게임 시작 명령 성공.`); // ✨ FIX: 태그 추가
                                    } else {
                                        warnDebug(`[Robot ${socket.userName}]`, `게임 시작 명령 실패: ${startRes.message}`); // ✨ FIX: 태그 추가
                                    }
                                });
                            }
                        } else {
                            warnDebug(`[Robot ${socket.userName}]`, `방 ${availableRoom.name} (${availableRoom.id}) 입장 실패: ${response.message}`); // ✨ FIX: 태그 추가
                        }
                    });
                } else {
                    const activeBotIds = Object.keys(this.activeBots).map(Number);
                    if (activeBotIds.length > 0 && userId === Math.min(...activeBotIds)) {
                        socket.emit('createRoom', { name: `${socket.userName}의 방`, betAmount: 100 }, (response) => {
                            if (response.success) {
                                logDebug(`[Robot ${socket.userName}]`, `방 생성 성공: ${response.room.name} (${response.room.id})`); // ✨ FIX: 태그 추가
                                socket.emit('joinRoom', { roomId: response.room.id, initialChips: socket.userChips }, (joinResponse) => {
                                    if (joinResponse.success) {
                                        logDebug(`[Robot ${socket.userName}]`, `생성한 방 ${response.room.name} 입장 성공.`); // ✨ FIX: 태그 추가
                                        socket.currentRoomId = response.room.id;
                                    } else {
                                        warnDebug(`[Robot ${socket.userName}]`, `생성한 방 입장 실패: ${joinResponse.message}`); // ✨ FIX: 태그 추가
                                    }
                                });
                            } else {
                                errorDebug(`[Robot ${socket.userName}]`, `방 생성 실패: ${response.message}`); // ✨ FIX: 태그 추가
                            }
                        });
                    }
                }
            }
        });

        socket.on('roomUpdated', (roomState) => {
            if (roomState.id === socket.currentRoomId) {
                socket.roomState = roomState;
                if (roomState.creatorId === socket.userId && roomState.status === 'waiting' && roomState.players.length >= 2) {
                    socket.emit('startGame', roomState.id, (startRes) => {
                        if (startRes.success) {
                            logDebug(`[Robot ${socket.userName}]`, `(방장) 게임 시작 명령 성공.`); // ✨ FIX: 태그 추가
                        } else {
                            warnDebug(`[Robot ${socket.userName}]`, `(방장) 게임 시작 명령 실패: ${startRes.message}`); // ✨ FIX: 태그 추가
                        }
                    });
                }
            }
        });

        socket.on('gameStarted', (data) => {
            socket.currentHand = data.myHand;
            socket.roomState = data.room;
            logDebug(`[Robot ${socket.userName}]`, `게임 시작! 내 패: ${socket.currentHand.map(c => `${c.suit}${c.rank}`).join(', ')}`); // ✨ FIX: 태그 추가
        });

        socket.on('myHandUpdated', (data) => {
            socket.currentHand = data.hand;
        });

        socket.on('turnChanged', (data) => {
            if (data.currentPlayerId === socket.userId && socket.roomState?.status === 'playing') {
                logDebug(`[Robot ${socket.userName}]`, `내 턴! 남은 시간: ${data.timeLeft}초. 현재 페이즈: ${socket.roomState.currentPhase}`); // ✨ FIX: 태그 추가
                setTimeout(() => {
                    this.takeBotAction(socket);
                }, Math.random() * 2000 + 1000);
            }
        });

        socket.on('gameEnded', (data) => {
            logDebug(`[Robot ${socket.userName}]`, `게임 종료! 승자: ${data.winnerNames.join(', ')}. 이유: ${data.reason}`); // ✨ FIX: 태그 추가
            socket.currentRoomId = null;
            socket.currentHand = [];
            socket.roomState = null;
            setTimeout(() => socket.emit('getRooms'), 5000);
        });
        // --- Socket 이벤트 핸들러 끝 ---

        socket.connect();
        return socket;
    }

    /**
     * 봇의 게임 액션을 처리합니다.
     * @param {Socket} socket - 봇의 소켓 인스턴스
     */
    takeBotAction(socket) {
        const room = socket.roomState;
        if (!room || room.currentTurnPlayerId !== socket.userId) return;

        const myPlayer = room.players.find(p => p.id === socket.userId);
        if (!myPlayer || myPlayer.folded || myPlayer.leaveReserved) {
            socket.emit('playerAction', { roomId: room.id, action: 'die', amount: 0 }, (res) => {
                if (res.success) logDebug(`[Robot ${socket.userName}]`, `자동 다이! (칩 부족 또는 폴드/퇴장 예약)`); // ✨ FIX: 태그 추가
                else warnDebug(`[Robot ${socket.userName}]`, `자동 다이 실패: ${res.message}`); // ✨ FIX: 태그 추가
            });
            return;
        }
        if (myPlayer.chips <= 0 && room.currentPhase === 'betting' && room.currentBet > 0) {
            socket.emit('playerAction', { roomId: room.id, action: 'die', amount: 0 }, (res) => {
                if (res.success) logDebug(`[Robot ${socket.userName}]`, `칩 부족으로 자동 다이!`); // ✨ FIX: 태그 추가
                else warnDebug(`[Robot ${socket.userName}]`, `칩 부족 자동 다이 실패: ${res.message}`); // ✨ FIX: 태그 추가
            });
            return;
        }


        const actions = [];
        // ... (takeBotAction 로직은 기존과 동일) ...
        // 베팅 페이즈
        if (room.currentPhase === 'betting') {
            const myCurrentRoundBet = myPlayer.currentRoundBet;
            const currentHighestBet = room.currentBet;
            const chips = myPlayer.chips;
            const betAmount = room.betAmount;

            const isMyFirstActionInRound = !room.players.some(p => p.hasActedInBettingRound);
            const hasOtherPlayersActedInRound = room.players.some(p => p.id !== socket.userId && p.hasActedInBettingRound);

            actions.push({ action: 'die', prob: 0.05 });

            if (currentHighestBet === 0 && isMyFirstActionInRound) {
                actions.push({ action: 'check', prob: 0.4 });
            }

            if (currentHighestBet === 0 && !isMyFirstActionInRound && hasOtherPlayersActedInRound) {
                actions.push({ action: 'call', amount: 0, prob: 0.4 });
            }

            const chipsToCall = currentHighestBet - myCurrentRoundBet;
            if (currentHighestBet > 0 && chipsToCall > 0) {
                if (chips >= chipsToCall) {
                    actions.push({ action: 'call', amount: currentHighestBet, prob: 0.3 });
                } else {
                    actions.push({ action: 'call', amount: currentHighestBet, prob: 0.7 });
                }
            }

            let targetBbingAmount = 0;
            if (currentHighestBet === 0) {
                targetBbingAmount = betAmount;
            } else {
                targetBbingAmount = currentHighestBet + betAmount;
            }
            const chipsToPayForBbing = targetBbingAmount - myCurrentRoundBet;
            if (chipsToPayForBbing > 0 && chips >= chipsToPayForBbing) {
                actions.push({ action: 'bet', amount: targetBbingAmount, prob: 0.1 });
            }

            const pot = room.pot;
            const minRaiseUnit = room.betAmount;

            let halfRaiseTotal = Math.max(currentHighestBet === 0 ? minRaiseUnit : currentHighestBet + minRaiseUnit,
                currentHighestBet + Math.floor(pot / 2));
            let chipsToPayHalf = halfRaiseTotal - myCurrentRoundBet;
            if (chipsToPayHalf > 0 && chips >= chipsToPayHalf && halfRaiseTotal > currentHighestBet) {
                actions.push({ action: 'raise', amount: halfRaiseTotal, prob: 0.05 });
            }

            let fullRaiseTotal = Math.max(currentHighestBet === 0 ? minRaiseUnit : currentHighestBet + minRaiseUnit,
                currentHighestBet + pot);
            let chipsToPayFull = fullRaiseTotal - myCurrentRoundBet;
            if (chipsToPayFull > 0 && chips >= chipsToPayFull && fullRaiseTotal > currentHighestBet) {
                actions.push({ action: 'raise', amount: fullRaiseTotal, prob: 0.02 });
            }

        }
        else if (room.currentPhase === 'exchange' && myPlayer.canExchange) {
            actions.push({ action: 'stay', cardsToExchange: [], prob: 0.5 });

            const numToExchange = Math.floor(Math.random() * 4);
            if (numToExchange > 0 && socket.currentHand.length >= numToExchange) {
                const cardsToExchange = [...socket.currentHand].sort(() => 0.5 - Math.random()).slice(0, numToExchange).map(c => c.id);
                actions.push({ action: 'exchange', cardsToExchange: cardsToExchange, prob: 0.5 });
            }
        }

        const totalProb = actions.reduce((sum, a) => sum + (a.prob || 0), 0);
        let randomNum = Math.random() * totalProb;
        let chosenAction = null;

        for (const actionInfo of actions) {
            randomNum -= (actionInfo.prob || 0);
            if (randomNum <= 0) {
                chosenAction = actionInfo;
                break;
            }
        }

        if (!chosenAction) {
            chosenAction = { action: (room.currentPhase === 'betting' ? 'die' : 'stay'), amount: 0, cardsToExchange: [] };
        }

        logDebug(`[Robot ${socket.userName}]`, `액션 선택: ${chosenAction.action} (금액: ${chosenAction.amount || 'N/A'}, 교환: ${chosenAction.cardsToExchange?.length || 0}장)`); // ✨ FIX: 태그 추가

        socket.emit('playerAction', {
            roomId: room.id,
            action: chosenAction.action,
            amount: chosenAction.amount,
            cardsToExchange: chosenAction.cardsToExchange
        }, (response) => {
            if (response.success) {
                // console.log(`[Bot ${socket.userName}] 액션 ${chosenAction.action} 성공.`); // 디버깅용 로그, 파일 로깅으로 대체
            } else {
                warnDebug(`[Robot ${socket.userName}]`, `액션 ${chosenAction.action} 실패: ${response.message}`); // ✨ FIX: 태그 추가
            }
        });
    }

    /**
     * 라라벨로부터 로봇 시작 명령을 수신합니다.
     * @param {Request} req
     * @param {Response} res
     */
    async startRobots(req, res) {
        const { robots } = req.body;

        if (!robots || robots.length === 0) {
            return res.status(400).json({ message: '시작할 로봇 정보가 없습니다.' });
        }

        const startedRobotIds = [];
        for (const robotData of robots) {
            try {
                const botSocket = await this.connectBot({ ...robotData, password: 'password' });
                if (botSocket) {
                    startedRobotIds.push(robotData.id);
                }
            } catch (error) {
                errorDebug('[RobotController]', `로봇 ${robotData.name} 연결 실패: ${error.message}`); // ✨ FIX: 태그 추가
            }
        }
        logDebug('[RobotController]', `${startedRobotIds.length}개의 로봇 시작 명령 처리 완료.`); // ✨ FIX: 태그 추가
        return res.json({ message: `${startedRobotIds.length}개의 로봇을 시작했습니다.`, startedRobotIds });
    }

    /**
     * 라라벨로부터 로봇 정지 명령을 수신합니다.
     * @param {Request} req
     * @param {Response} res
     */
    stopRobots(req, res) {
        const { robotIds } = req.body;

        let stoppedRobotIds = [];
        if (!robotIds || robotIds.length === 0) {
            for (const userId in this.activeBots) {
                this.activeBots[userId].disconnect();
                stoppedRobotIds.push(parseInt(userId));
            }
            this.activeBots = {};
        } else {
            for (const id of robotIds) {
                if (this.activeBots[id]) {
                    this.activeBots[id].disconnect();
                    delete this.activeBots[id];
                    stoppedRobotIds.push(id);
                }
            }
        }
        logDebug('[RobotController]', `${stoppedRobotIds.length}개의 로봇 정지 명령 처리 완료.`); // ✨ FIX: 태그 추가
        return res.json({ message: `${stoppedRobotIds.length}개의 로봇을 정지했습니다.`, stoppedRobotIds });
    }
}

export default RobotController;