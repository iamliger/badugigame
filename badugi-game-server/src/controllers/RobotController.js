// badugi-game-server/src/controllers/RobotController.js

import { io } from "socket.io-client";
import axios from 'axios';
import { logDebug, warnDebug, errorDebug } from '../../logger.js';

// ✨ NEW: dotenv를 직접 임포트하여 이 파일에서 환경 변수를 사용하도록 합니다.
import dotenv from 'dotenv';
dotenv.config({ path: './.env' }); // ✨ MODIFIED: RobotController.js에서도 .env 경로 명시

// 봇이 사용할 라라벨 API URL (로그인 등)
const LARAVEL_API_URL = process.env.LARAVEL_API_URL || 'http://localhost:8000/api/auth';
const LARAVEL_ROBOT_LOGIN_API_URL = process.env.LARAVEL_ROBOT_LOGIN_API_URL || 'http://localhost:8000/api/robot-auth/login';
const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';

// ✨ NEW: RobotController 로드 시점의 환경 변수 상태 확인 로그
logDebug(`[RobotController Init] LARAVEL_ROBOT_LOGIN_API_URL: ${LARAVEL_ROBOT_LOGIN_API_URL}`);
logDebug(`[RobotController Init] GAME_SERVER_URL for bot connections: ${GAME_SERVER_URL}`);

if (!process.env.LARAVEL_ROBOT_LOGIN_API_URL) {
    errorDebug('[RobotController] WARN: LARAVEL_ROBOT_LOGIN_API_URL is still not defined after dotenv.config() in RobotController.');
}

// ✨ NEW: GAME_SERVER_URL이 정의되지 않았을 경우 경고/오류 추가
if (!process.env.GAME_SERVER_URL) {
    errorDebug('[RobotController] WARN: GAME_SERVER_URL is NOT defined in RobotController after dotenv.config().');
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
            warnDebug(`[RobotController] 로봇 ${userName} (ID: ${userId}) 이미 활성화되어 있습니다.`);
            return this.activeBots[userId];
        }

        logDebug(`[RobotController] 로봇 ${userName} (ID: ${userId}) 로그인 시도: ${email}`);

        let token = '';
        try {
            // ✨ 환경 변수가 여기에 도달하는지 다시 확인
            if (!LARAVEL_ROBOT_LOGIN_API_URL) {
                errorDebug('[RobotController] FATAL: LARAVEL_ROBOT_LOGIN_API_URL is UNDEFINED at connectBot execution.');
                throw new Error('LARAVEL_ROBOT_LOGIN_API_URL is not defined in RobotController.');
            }

            // Laravel 로봇 인증 API를 호출하여 Sanctum 토큰 획득
            const loginResponse = await axios.post(LARAVEL_ROBOT_LOGIN_API_URL, {
                email: email,
                password: 'password'
            });
            token = loginResponse.data.access_token;
            logDebug(`[RobotController] 로봇 ${userName} 로그인 성공. 토큰 획득. 칩: ${points}. 토큰 시작: ${token.substring(0, 20)}...`);
        } catch (error) {
            errorDebug(`[RobotController] 로봇 ${userName} 로그인 실패:`, error.response?.data || error.message || `No response from ${LARAVEL_ROBOT_LOGIN_API_URL}`);
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
        socket.userChips = points; // Laravel에서 전달받은 초기 칩 사용
        socket.currentRoomId = null;
        socket.currentHand = [];
        socket.roomState = null;

        // --- Socket 이벤트 핸들러 ---
        socket.on('connect', () => {
            logDebug(`[Robot ${socket.userName}] Socket.IO 연결 성공. ID: ${socket.id}`);
            this.activeBots[userId] = socket;
            socket.emit('getRooms');
        });

        socket.on('disconnect', (reason) => {
            logDebug(`[Robot ${socket.userName}] Socket.IO 연결 해제: ${reason}`);
            delete this.activeBots[userId];
        });

        socket.on('connect_error', (err) => {
            errorDebug(`[Robot ${socket.userName}] Socket.IO 연결 오류: ${err.message}`);
        });

        socket.on('roomsUpdated', (rooms) => {
            // ... 기존 로직과 동일 ...
            if (!socket.currentRoomId) {
                let availableRoom = rooms.find(r => r.status === 'waiting' && r.players < r.maxPlayers && !r.isPrivate);
                if (availableRoom) {
                    socket.emit('joinRoom', { roomId: availableRoom.id, initialChips: socket.userChips }, (response) => {
                        if (response.success) {
                            logDebug(`[Robot ${socket.userName}] 방 ${availableRoom.name} (${availableRoom.id}) 입장 성공.`);
                            socket.currentRoomId = availableRoom.id;
                            if (response.room.creatorId === socket.userId && response.room.players.length >= 2) {
                                socket.emit('startGame', availableRoom.id, (startRes) => {
                                    if (startRes.success) {
                                        logDebug(`[Robot ${socket.userName}] 게임 시작 명령 성공.`);
                                    } else {
                                        warnDebug(`[Robot ${socket.userName}] 게임 시작 명령 실패: ${startRes.message}`);
                                    }
                                });
                            }
                        } else {
                            warnDebug(`[Robot ${socket.userName}] 방 ${availableRoom.name} (${availableRoom.id}) 입장 실패: ${response.message}`);
                        }
                    });
                } else {
                    // 방이 없으면 방 만들기 시도 (가장 낮은 ID 봇만 방 만들도록)
                    // 이 로직은 Filament에서 시작된 봇들이 동시에 실행될 때,
                    // 가장 낮은 ID를 가진 봇만 방을 만들도록 하는 것이 좋습니다.
                    const activeBotIds = Object.keys(this.activeBots).map(Number);
                    if (activeBotIds.length > 0 && userId === Math.min(...activeBotIds)) {
                        socket.emit('createRoom', { name: `${socket.userName}의 방`, betAmount: 100 }, (response) => {
                            if (response.success) {
                                logDebug(`[Robot ${socket.userName}] 방 생성 성공: ${response.room.name} (${response.room.id})`);
                                socket.emit('joinRoom', { roomId: response.room.id, initialChips: socket.userChips }, (joinResponse) => {
                                    if (joinResponse.success) {
                                        logDebug(`[Robot ${socket.userName}] 생성한 방 ${response.room.name} 입장 성공.`);
                                        socket.currentRoomId = response.room.id;
                                    } else {
                                        warnDebug(`[Robot ${socket.userName}] 생성한 방 입장 실패: ${joinResponse.message}`);
                                    }
                                });
                            } else {
                                errorDebug(`[Robot ${socket.userName}] 방 생성 실패: ${response.message}`);
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
                            logDebug(`[Robot ${socket.userName}] (방장) 게임 시작 명령 성공.`);
                        } else {
                            warnDebug(`[Robot ${socket.userName}] (방장) 게임 시작 명령 실패: ${startRes.message}`);
                        }
                    });
                }
            }
        });

        socket.on('gameStarted', (data) => {
            socket.currentHand = data.myHand;
            socket.roomState = data.room;
            logDebug(`[Robot ${socket.userName}] 게임 시작! 내 패: ${socket.currentHand.map(c => `${c.suit}${c.rank}`).join(', ')}`);
        });

        socket.on('myHandUpdated', (data) => {
            socket.currentHand = data.hand;
        });

        socket.on('turnChanged', (data) => {
            if (data.currentPlayerId === socket.userId && socket.roomState?.status === 'playing') {
                logDebug(`[Robot ${socket.userName}] 내 턴! 남은 시간: ${data.timeLeft}초. 현재 페이즈: ${socket.roomState.currentPhase}`);
                setTimeout(() => {
                    this.takeBotAction(socket);
                }, Math.random() * 2000 + 1000);
            }
        });

        socket.on('gameEnded', (data) => {
            logDebug(`[Robot ${socket.userName}] 게임 종료! 승자: ${data.winnerNames.join(', ')}. 이유: ${data.reason}`);
            socket.currentRoomId = null;
            socket.currentHand = [];
            socket.roomState = null;
            setTimeout(() => socket.emit('getRooms'), 5000);
        });
        // --- Socket 이벤트 핸들러 끝 ---

        socket.connect();
        return socket;
    }

    // ... (takeBotAction, startRobots, stopRobots 메서드는 변경 없음) ...
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
                if (res.success) logDebug(`[Robot ${socket.userName}] 자동 다이! (칩 부족 또는 폴드/퇴장 예약)`);
                else warnDebug(`[Robot ${socket.userName}] 자동 다이 실패: ${res.message}`);
            });
            return;
        }
        if (myPlayer.chips <= 0 && room.currentPhase === 'betting' && room.currentBet > 0) {
            socket.emit('playerAction', { roomId: room.id, action: 'die', amount: 0 }, (res) => {
                if (res.success) logDebug(`[Robot ${socket.userName}] 칩 부족으로 자동 다이!`);
                else warnDebug(`[Robot ${socket.userName}] 칩 부족 자동 다이 실패: ${res.message}`);
            });
            return;
        }


        const actions = [];
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

        logDebug(`[Robot ${socket.userName}] 액션 선택: ${chosenAction.action} (금액: ${chosenAction.amount || 'N/A'}, 교환: ${chosenAction.cardsToExchange?.length || 0}장)`);

        socket.emit('playerAction', {
            roomId: room.id,
            action: chosenAction.action,
            amount: chosenAction.amount,
            cardsToExchange: chosenAction.cardsToExchange
        }, (response) => {
            if (response.success) {
            } else {
                warnDebug(`[Robot ${socket.userName}] 액션 ${chosenAction.action} 실패: ${response.message}`);
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
                // `robotData.password`는 Filament에서 해싱되지 않은 'password' 문자열로 넘어와야 합니다.
                // Laravel RobotManager에서 'password'로 해싱했으므로, 여기서도 'password'로 사용합니다.
                const botSocket = await this.connectBot({ ...robotData, password: 'password' }); // ✨ FIX: 해싱되지 않은 'password'를 전달
                if (botSocket) {
                    startedRobotIds.push(robotData.id);
                }
            } catch (error) {
                errorDebug(`[RobotController] 로봇 ${robotData.name} 연결 실패: ${error.message}`);
            }
        }
        logDebug(`[RobotController] ${startedRobotIds.length}개의 로봇 시작 명령 처리 완료.`);
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
        logDebug(`[RobotController] ${stoppedRobotIds.length}개의 로봇 정지 명령 처리 완료.`);
        return res.json({ message: `${stoppedRobotIds.length}개의 로봇을 정지했습니다.`, stoppedRobotIds });
    }
}

export default RobotController;