// badugi-game-server/src/controllers/RobotController.js

import { io } from "socket.io-client";
import axios from 'axios';
import { logDebug, warnDebug, errorDebug } from '../../server.js'; // 서버 로거 임포트

// 봇이 사용할 라라벨 API URL (로그인 등)
const LARAVEL_API_URL = process.env.LARAVEL_API_URL || 'http://localhost:8000/api/auth';
const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000'; // 봇이 연결할 게임 서버 URL

class RobotController {
    constructor(gameService, activeBots) {
        this.gameService = gameService;
        this.activeBots = activeBots; // { userId: socketInstance }

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
            // Laravel 인증 API를 호출하여 토큰 획득
            const loginResponse = await axios.post(`${LARAVEL_API_URL}/login`, {
                email: email,
                password: 'password' // Laravel RobotManager에서 Hash::make('password')로 저장했으므로, 실제 비밀번호는 'password'
            });
            token = loginResponse.data.access_token;
            logDebug(`[RobotController] 로봇 ${userName} 로그인 성공. 토큰 획득.`);
        } catch (error) {
            errorDebug(`[RobotController] 로봇 ${userName} 로그인 실패:`, error.response?.data || error.message);
            return null;
        }

        const socket = io(GAME_SERVER_URL, {
            auth: { token: token },
            autoConnect: false,
            transports: ['websocket'],
            query: { isBot: true } // 봇임을 식별하기 위한 쿼리 파라미터 (선택 사항)
        });

        socket.userId = userId;
        socket.userName = userName;
        socket.userChips = points; // 로봇의 초기 칩 설정
        socket.currentRoomId = null;
        socket.currentHand = [];
        socket.roomState = null;

        // --- Socket 이벤트 핸들러 ---
        socket.on('connect', () => {
            logDebug(`[Robot ${socket.userName}] Socket.IO 연결 성공. ID: ${socket.id}`);
            this.activeBots[userId] = socket; // 활성 봇 목록에 추가
            socket.emit('getRooms'); // 방 목록 요청
        });

        socket.on('disconnect', (reason) => {
            logDebug(`[Robot ${socket.userName}] Socket.IO 연결 해제: ${reason}`);
            delete this.activeBots[userId]; // 연결 해제 시 활성 봇 목록에서 제거
        });

        socket.on('connect_error', (err) => {
            errorDebug(`[Robot ${socket.userName}] Socket.IO 연결 오류: ${err.message}`);
        });

        socket.on('roomsUpdated', (rooms) => {
            // console.log(`[Robot ${socket.userName}] 방 목록 업데이트 수신 (${rooms.length}개)`);
            if (!socket.currentRoomId) { // 아직 방에 입장하지 않았다면
                let availableRoom = rooms.find(r => r.status === 'waiting' && r.players < r.maxPlayers && !r.isPrivate);
                if (availableRoom) {
                    socket.emit('joinRoom', { roomId: availableRoom.id, initialChips: socket.userChips }, (response) => {
                        if (response.success) {
                            logDebug(`[Robot ${socket.userName}] 방 ${availableRoom.name} (${availableRoom.id}) 입장 성공.`);
                            socket.currentRoomId = availableRoom.id;
                            // 방장 로봇인 경우 게임 시작 시도
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
                    if (userId === Math.min(...Object.keys(this.activeBots).map(Number))) { // 가장 낮은 ID를 가진 활성 봇만 방 생성
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
                // console.log(`[Bot ${socket.userName}] 방 ${roomState.name} 상태 업데이트. 턴: ${roomState.currentTurnPlayerId}`);
                // 방장이 된 로봇이 게임 시작 조건 충족 시 자동 시작
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
            // console.log(`[Bot ${socket.userName}] 내 패 업데이트. 새 패: ${socket.currentHand.map(c => `${c.suit}${c.rank}`).join(', ')}`);
        });

        socket.on('turnChanged', (data) => {
            if (data.currentPlayerId === socket.userId && socket.roomState?.status === 'playing') {
                logDebug(`[Robot ${socket.userName}] 내 턴! 남은 시간: ${data.timeLeft}초. 현재 페이즈: ${socket.roomState.currentPhase}`);
                setTimeout(() => {
                    this.takeBotAction(socket); // `this` 컨텍스트 유지
                }, Math.random() * 2000 + 1000); // 1~3초 랜덤 대기 후 액션
            }
        });

        socket.on('gameEnded', (data) => {
            logDebug(`[Robot ${socket.userName}] 게임 종료! 승자: ${data.winnerNames.join(', ')}. 이유: ${data.reason}`);
            socket.currentRoomId = null; // 방에서 나갔다고 가정
            socket.currentHand = [];
            socket.roomState = null;
            // 게임 종료 후 다시 로비로 가서 방 찾기
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
                if (res.success) logDebug(`[Robot ${socket.userName}] 자동 다이! (칩 부족 또는 폴드/퇴장 예약)`);
                else warnDebug(`[Robot ${socket.userName}] 자동 다이 실패: ${res.message}`);
            });
            return;
        }
        if (myPlayer.chips <= 0 && room.currentPhase === 'betting' && room.currentBet > 0) { // 베팅 페이즈이고 칩이 없는데 베팅이 필요한 경우
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

            // 다이 (항상 가능하지만, 전략적으로)
            actions.push({ action: 'die', prob: 0.05 }); // 5% 확률로 다이

            // 체크
            if (currentHighestBet === 0 && isMyFirstActionInRound) {
                actions.push({ action: 'check', prob: 0.4 }); // 첫 액션이면 체크 확률 높임
            }

            // 콜(0)
            if (currentHighestBet === 0 && !isMyFirstActionInRound && hasOtherPlayersActedInRound) {
                actions.push({ action: 'call', amount: 0, prob: 0.4 }); // 상대가 체크했으면 콜(0)
            }

            // 콜 (금액) 또는 올인 콜
            const chipsToCall = currentHighestBet - myCurrentRoundBet;
            if (currentHighestBet > 0 && chipsToCall > 0) {
                if (chips >= chipsToCall) {
                    actions.push({ action: 'call', amount: currentHighestBet, prob: 0.3 }); // 일반 콜
                } else { // 올인 콜
                    actions.push({ action: 'call', amount: currentHighestBet, prob: 0.7 }); // 올인 콜은 높은 확률로
                }
            }

            // 삥 (bet)
            let targetBbingAmount = 0;
            if (currentHighestBet === 0) {
                targetBbingAmount = betAmount;
            } else {
                targetBbingAmount = currentHighestBet + betAmount;
            }
            const chipsToPayForBbing = targetBbingAmount - myCurrentRoundBet;
            if (chipsToPayForBbing > 0 && chips >= chipsToPayForBbing) {
                actions.push({ action: 'bet', amount: targetBbingAmount, prob: 0.1 }); // 삥
            }

            // 레이즈 (하프/풀)
            const pot = room.pot;
            const minRaiseUnit = room.betAmount;

            // 하프 레이즈
            let halfRaiseTotal = Math.max(currentHighestBet === 0 ? minRaiseUnit : currentHighestBet + minRaiseUnit,
                currentHighestBet + Math.floor(pot / 2));
            let chipsToPayHalf = halfRaiseTotal - myCurrentRoundBet;
            if (chipsToPayHalf > 0 && chips >= chipsToPayHalf && halfRaiseTotal > currentHighestBet) {
                actions.push({ action: 'raise', amount: halfRaiseTotal, prob: 0.05 });
            }
            // 풀 레이즈
            let fullRaiseTotal = Math.max(currentHighestBet === 0 ? minRaiseUnit : currentHighestBet + minRaiseUnit,
                currentHighestBet + pot);
            let chipsToPayFull = fullRaiseTotal - myCurrentRoundBet;
            if (chipsToPayFull > 0 && chips >= chipsToPayFull && fullRaiseTotal > currentHighestBet) {
                actions.push({ action: 'raise', amount: fullRaiseTotal, prob: 0.02 });
            }

        }
        // 교환 페이즈
        else if (room.currentPhase === 'exchange' && myPlayer.canExchange) {
            // 스테이
            actions.push({ action: 'stay', cardsToExchange: [], prob: 0.5 }); // 50% 확률로 스테이

            // 카드 교환 (무작위로 0~3장 교환 시도)
            const numToExchange = Math.floor(Math.random() * 4); // 0, 1, 2, 3장
            if (numToExchange > 0 && socket.currentHand.length >= numToExchange) {
                const cardsToExchange = [...socket.currentHand].sort(() => 0.5 - Math.random()).slice(0, numToExchange).map(c => c.id);
                actions.push({ action: 'exchange', cardsToExchange: cardsToExchange, prob: 0.5 });
            }
        }

        // 확률 기반으로 액션 선택
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

        if (!chosenAction) { // 기본 액션 ( fallback: 다이 또는 스테이)
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
                // console.log(`[Bot ${socket.userName}] 액션 ${chosenAction.action} 성공.`);
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
        const { robots } = req.body; // 라라벨에서 전달받은 로봇 정보 배열

        if (!robots || robots.length === 0) {
            return res.status(400).json({ message: '시작할 로봇 정보가 없습니다.' });
        }

        const startedRobotIds = [];
        for (const robotData of robots) {
            try {
                const botSocket = await this.connectBot(robotData);
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
        const { robotIds } = req.body; // 라라벨에서 전달받은 정지할 로봇 ID 목록 (없으면 전체 정지)

        let stoppedRobotIds = [];
        if (!robotIds || robotIds.length === 0) { // 모든 로봇 정지
            for (const userId in this.activeBots) {
                this.activeBots[userId].disconnect();
                stoppedRobotIds.push(parseInt(userId));
            }
            this.activeBots = {}; // 맵 초기화
        } else { // 특정 로봇 정지
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