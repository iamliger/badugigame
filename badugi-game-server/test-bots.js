// badugi-game-server/test-bots.js (새 파일)
import { io } from "socket.io-client";
import axios from 'axios';
import 'dotenv/config'; // .env 파일 로드

const SERVER_URL = process.env.VITE_SOCKET_IO_SERVER_URL || 'http://localhost:3000';
const LARAVEL_API_URL = 'http://localhost:8000/api/auth';
const BOT_COUNT = 4; // 총 봇 수 (본인 포함 5명 테스트 시 4개 봇)
const BOT_BASE_EMAIL = 'bot';
const BOT_PASSWORD = 'password'; // 실제 비밀번호로 변경

const createBot = async (botId) => {
    const email = `${BOT_BASE_EMAIL}${botId}@example.com`;
    console.log(`[Bot ${botId}] 로그인 시도: ${email}`);

    let token = '';
    let userId = -1;
    let userName = `Bot${botId}`;
    let userChips = 0;

    try {
        // 라라벨 로그인 (필요시 회원가입 로직도 추가 가능)
        const loginResponse = await axios.post(`${LARAVEL_API_URL}/login`, {
            email: email,
            password: BOT_PASSWORD
        });
        token = loginResponse.data.access_token;
        userId = loginResponse.data.user.id;
        userName = loginResponse.data.user.name;
        userChips = loginResponse.data.user.points;
        console.log(`[Bot ${botId}] 로그인 성공. ID: ${userId}, 칩: ${userChips}`);
    } catch (error) {
        console.error(`[Bot ${botId}] 로그인 실패:`, error.response?.data || error.message);
        // 봇 계정이 없으면 회원가입 후 로그인 시도하는 로직 추가 가능
        return;
    }

    const socket = io(SERVER_URL, {
        auth: { token: token },
        autoConnect: false,
        transports: ['websocket']
    });

    socket.userId = userId;
    socket.userName = userName;
    socket.userChips = userChips;
    socket.currentRoomId = null;
    socket.currentHand = [];
    socket.roomState = null;

    socket.on('connect', () => {
        console.log(`[Bot ${socket.userName}] Socket.IO 연결 성공. ID: ${socket.id}`);
        socket.emit('getRooms'); // 방 목록 요청
    });

    socket.on('disconnect', (reason) => {
        console.log(`[Bot ${socket.userName}] Socket.IO 연결 해제: ${reason}`);
    });

    socket.on('connect_error', (err) => {
        console.error(`[Bot ${socket.userName}] Socket.IO 연결 오류: ${err.message}`);
    });

    socket.on('roomsUpdated', (rooms) => {
        console.log(`[Bot ${socket.userName}] 방 목록 업데이트 수신 (${rooms.length}개)`);
        if (!socket.currentRoomId) { // 아직 방에 입장하지 않았다면
            let availableRoom = rooms.find(r => r.status === 'waiting' && r.players < r.maxPlayers && !r.isPrivate);
            if (availableRoom) {
                socket.emit('joinRoom', { roomId: availableRoom.id, initialChips: socket.userChips }, (response) => {
                    if (response.success) {
                        console.log(`[Bot ${socket.userName}] 방 ${availableRoom.name} (${availableRoom.id}) 입장 성공.`);
                        socket.currentRoomId = availableRoom.id;
                    } else {
                        console.warn(`[Bot ${socket.userName}] 방 ${availableRoom.name} (${availableRoom.id}) 입장 실패: ${response.message}`);
                    }
                });
            } else {
                // 방이 없거나 가득 찼으면 방 만들기 시도
                if (socket.userId === 101) { // 특정 봇만 방 만들도록 제한 (예시)
                    socket.emit('createRoom', { name: `${socket.userName}의 방`, betAmount: 100 }, (response) => {
                        if (response.success) {
                            console.log(`[Bot ${socket.userName}] 방 생성 성공: ${response.room.name} (${response.room.id})`);
                            socket.emit('joinRoom', { roomId: response.room.id, initialChips: socket.userChips }, (joinResponse) => {
                                if (joinResponse.success) {
                                    console.log(`[Bot ${socket.userName}] 생성한 방 ${response.room.name} 입장 성공.`);
                                    socket.currentRoomId = response.room.id;
                                } else {
                                    console.warn(`[Bot ${socket.userName}] 생성한 방 입장 실패: ${joinResponse.message}`);
                                }
                            });
                        } else {
                            console.error(`[Bot ${socket.userName}] 방 생성 실패: ${response.message}`);
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
        }
    });

    socket.on('gameStarted', (data) => {
        socket.currentHand = data.myHand;
        socket.roomState = data.room;
        console.log(`[Bot ${socket.userName}] 게임 시작! 내 패: ${socket.currentHand.map(c => `${c.suit}${c.rank}`).join(', ')}`);
    });

    socket.on('myHandUpdated', (data) => {
        socket.currentHand = data.hand;
        // console.log(`[Bot ${socket.userName}] 내 패 업데이트. 새 패: ${socket.currentHand.map(c => `${c.suit}${c.rank}`).join(', ')}`);
    });

    socket.on('turnChanged', (data) => {
        if (data.currentPlayerId === socket.userId && socket.roomState?.status === 'playing') {
            console.log(`[Bot ${socket.userName}] 내 턴! 남은 시간: ${data.timeLeft}초. 현재 페이즈: ${socket.roomState.currentPhase}`);
            setTimeout(() => {
                takeBotAction(socket);
            }, Math.random() * 2000 + 1000); // 1~3초 랜덤 대기 후 액션
        }
    });

    socket.on('gameEnded', (data) => {
        console.log(`[Bot ${socket.userName}] 게임 종료! 승자: ${data.winnerNames.join(', ')}. 이유: ${data.reason}`);
        socket.currentRoomId = null; // 방에서 나갔다고 가정
        socket.currentHand = [];
        socket.roomState = null;
        // 게임 종료 후 다시 로비로 가서 방 찾기
        setTimeout(() => socket.emit('getRooms'), 5000);
    });

    socket.connect();
};

const takeBotAction = (socket) => {
    const room = socket.roomState;
    if (!room || room.currentTurnPlayerId !== socket.userId) return;

    const myPlayer = room.players.find(p => p.id === socket.userId);
    if (!myPlayer || myPlayer.folded || myPlayer.leaveReserved || myPlayer.chips <= 0) {
        socket.emit('playerAction', { roomId: room.id, action: 'die', amount: 0 }, (res) => {
            if (res.success) console.log(`[Bot ${socket.userName}] 자동 다이!`); else console.warn(`[Bot ${socket.userName}] 자동 다이 실패: ${res.message}`);
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

        // 다이
        actions.push({ action: 'die', prob: 0.1 }); // 10% 확률로 다이

        // 체크
        if (currentHighestBet === 0 && isMyFirstActionInRound) {
            actions.push({ action: 'check', prob: 0.3 }); // 첫 액션이면 체크 확률 높임
        }

        // 콜(0)
        if (currentHighestBet === 0 && !isMyFirstActionInRound && hasOtherPlayersActedInRound) {
            actions.push({ action: 'call', amount: 0, prob: 0.4 }); // 상대가 체크했으면 콜(0)
        }

        // 콜 (금액)
        const chipsToCall = currentHighestBet - myCurrentRoundBet;
        if (currentHighestBet > 0 && chipsToCall > 0) {
            if (chips >= chipsToCall) {
                actions.push({ action: 'call', amount: currentHighestBet, prob: 0.4 });
            } else { // 올인 콜
                actions.push({ action: 'call', amount: currentHighestBet, prob: 0.8 }); // 올인 콜은 높은 확률로
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
            actions.push({ action: 'bet', amount: targetBbingAmount, prob: 0.2 });
        }

        // 레이즈 (하프/풀)
        const pot = room.pot;
        const minRaiseUnit = room.betAmount;
        // 하프
        let halfRaiseTotal = Math.max(currentHighestBet === 0 ? minRaiseUnit : currentHighestBet + minRaiseUnit,
            currentHighestBet + Math.floor(pot / 2));
        let chipsToPayHalf = halfRaiseTotal - myCurrentRoundBet;
        if (chipsToPayHalf > 0 && chips >= chipsToPayHalf) {
            actions.push({ action: 'raise', amount: halfRaiseTotal, prob: 0.1 });
        }
        // 풀
        let fullRaiseTotal = Math.max(currentHighestBet === 0 ? minRaiseUnit : currentHighestBet + minRaiseUnit,
            currentHighestBet + pot);
        let chipsToPayFull = fullRaiseTotal - myCurrentRoundBet;
        if (chipsToPayFull > 0 && chips >= chipsToPayFull) {
            actions.push({ action: 'raise', amount: fullRaiseTotal, prob: 0.05 });
        }

    }
    // 교환 페이즈
    else if (room.currentPhase === 'exchange' && myPlayer.canExchange) {
        // 스테이
        actions.push({ action: 'stay', amount: 0, cardsToExchange: [], prob: 0.4 });

        // 카드 교환 (무작위로 0~2장 교환 시도)
        const numToExchange = Math.floor(Math.random() * 3); // 0, 1, 2장
        if (numToExchange > 0) {
            const cardsToExchange = [...socket.currentHand].sort(() => 0.5 - Math.random()).slice(0, numToExchange).map(c => c.id);
            actions.push({ action: 'exchange', cardsToExchange: cardsToExchange, prob: 0.6 });
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

    console.log(`[Bot ${socket.userName}] 액션 선택: ${chosenAction.action} (금액: ${chosenAction.amount || 'N/A'}, 교환: ${chosenAction.cardsToExchange?.length || 0}장)`);

    socket.emit('playerAction', {
        roomId: room.id,
        action: chosenAction.action,
        amount: chosenAction.amount,
        cardsToExchange: chosenAction.cardsToExchange
    }, (response) => {
        if (response.success) {
            // console.log(`[Bot ${socket.userName}] 액션 ${chosenAction.action} 성공.`);
        } else {
            console.warn(`[Bot ${socket.userName}] 액션 ${chosenAction.action} 실패: ${response.message}`);
        }
    });
};

// 봇 생성 및 연결
for (let i = 1; i <= BOT_COUNT; i++) {
    createBot(100 + i); // 봇 ID 101부터 시작 (사용자 ID와 겹치지 않게)
}