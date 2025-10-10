// badugi-game-server/src/services/GameService.js

// 🃏 카드 유틸리티 함수 임포트
import { createDeck, shuffleDeck, evaluateBadugiHand, compareBadugiHands } from '../utils/cards.js';
// ✍️ 서버 로깅 함수 임포트 (server.js에서 내보낸 함수들을 여기서 임포트하여 사용)
import { logDebug, warnDebug, errorDebug } from '../../server.js';

/**
 * 🎮 바둑이 게임의 핵심 로직을 관리하는 서비스 클래스입니다.
 */
class GameService {
    constructor(io, rooms) {
        this.io = io;
        this.rooms = rooms;
        this.decks = {};

        this.roundNames = ['아침', '점심', '저녁']; // 0, 1, 2
        // this.maxExchangeRounds = 3; // 각 라운드마다 교환 기회 한 번 (최대 3번의 교환 라운드)

        this.startGame = this.startGame.bind(this);
        this.drawCard = this.drawCard.bind(this);
        this.advanceTurn = this.advanceTurn.bind(this);
        // this.startNextRound = this.startNextRound.bind(this); // ✨ 더 이상 직접 호출하지 않음
        this.handleBettingAction = this.handleBettingAction.bind(this);
        this.handleCardExchange = this.handleCardExchange.bind(this);
        this.showdown = this.showdown.bind(this);
    }

    startGame(roomId) {
        const room = this.rooms[roomId];

        if (!room) { errorDebug(`[GameService] 게임 시작 실패: 방 ${roomId}를 찾을 수 없습니다.`); return false; }
        if (room.status !== 'waiting') { warnDebug(`[GameService] 게임 시작 실패: 방 ${roomId}는 이미 ${room.status} 상태입니다.`); return false; }
        if (room.players.length < 2) { warnDebug(`[GameService] 게임 시작 실패: 방 ${roomId}에 최소 2명 이상의 플레이어가 필요합니다.`); return false; }

        room.status = 'playing';
        room.maxRounds = this.roundNames.length; // 아침, 점심, 저녁 (3 라운드: 0, 1, 2)
        room.currentRound = 0; // 0: 아침, 1: 점심, 2: 저녁
        room.gameRoundName = this.roundNames[room.currentRound];
        room.pot = 0;
        room.currentBet = room.betAmount; // 초기 베팅액은 방 설정 베팅액 (안테로 간주)
        room.activePlayers = room.players.filter(p => !p.leaveReserved).map(p => p.id); // 게임 시작 시점의 활성 플레이어
        room.lastBettingPlayer = null;
        room.hands = {};
        room.discardPiles = {};
        room.currentTurnPlayerId = null;
        room.currentPhase = 'betting'; // 게임 시작 시 초기 페이즈는 'betting'

        // 칩 부족 플레이어 확인 및 처리
        const playersWithInsufficientChips = room.players.filter(player => player.chips < room.betAmount); // 안테 금액 확인
        if (playersWithInsufficientChips.length > 0) {
            errorDebug(`[GameService] 방 ${roomId} 칩 부족으로 게임 시작 불가. 다음 플레이어들: ${playersWithInsufficientChips.map(p => p.name).join(', ')} (필요 칩: ${room.betAmount})`);
            room.status = 'waiting'; // 게임 시작 실패 처리
            this.io.to(`room-${roomId}`).emit('gameError', { message: '일부 플레이어의 칩이 부족하여 게임을 시작할 수 없습니다.' });
            return false;
        }

        room.players.forEach(player => {
            player.chips -= room.betAmount;     // 칩 차감
            room.pot += room.betAmount;         // 팟에 추가
            player.currentRoundBet = room.betAmount; // 현재 라운드 베팅액에 기본금 포함
            player.folded = false;
            player.status = 'playing';
            player.bestHand = null;
            player.canExchange = true;
            player.hasActedInBettingRound = false;
            player.leaveReserved = false; // 게임 시작 시 퇴장 예약 초기화
        });
        logDebug(`[GameService] 방 ${roomId} 모든 플레이어 기본금 ${room.betAmount} 칩 지불 완료. 현재 팟: ${room.pot}`);

        // 방장부터 첫 턴 시작
        const creatorPlayerIndex = room.players.findIndex(p => p.id === room.creatorId);
        if (creatorPlayerIndex === -1) {
            errorDebug(`[GameService] 방 ${roomId}에서 방장(ID: ${room.creatorId})을 찾을 수 없습니다.`);
            room.status = 'waiting';
            return false;
        }

        room.turnIndex = creatorPlayerIndex;
        room.currentTurnPlayerId = room.creatorId;
        // 딜러는 첫 턴 플레이어의 오른쪽에 위치 (포커/바둑이 룰에 따라)
        // 예를 들어, 딜러 좌측부터 액션 시작 시, 방장이 첫 액션이면 딜러는 방장 오른쪽
        room.dealerIndex = (creatorPlayerIndex - 1 + room.players.length) % room.players.length;

        logDebug(`[GameService] 방 ${roomId} 게임 시작. 첫 턴: User ${room.players[room.turnIndex].name} (ID: ${room.currentTurnPlayerId}), 딜러: ${room.players[room.dealerIndex].name}`);

        const newDeck = shuffleDeck(createDeck());
        this.decks[roomId] = newDeck;
        logDebug(`[GameService] 방 ${roomId} 덱 생성 및 셔플 완료. 덱 크기: ${newDeck.length}`);

        // 초기 패 분배
        room.players.forEach(player => {
            const hand = [];
            for (let i = 0; i < 4; i++) {
                hand.push(this.drawCard(roomId));
            }
            room.hands[player.id] = hand;
            logDebug(`[GameService] User ${player.name} (ID: ${player.id})에게 초기 패 분배 완료: ${hand.map(c => `${c.suit}${c.rank}`).join(', ')}`);
        });

        // 초기 패 족보 평가
        room.players.forEach(player => {
            player.bestHand = evaluateBadugiHand(room.hands[player.id]);
            logDebug(`[GameService] User ${player.name} (ID: ${player.id}) 초기 패 족보: ${player.bestHand.rank}, 값: ${player.bestHand.value}`);
        });

        // 게임 시작 및 턴 정보 클라이언트에 전송
        room.players.forEach(player => {
            // 다른 플레이어에게는 패 정보 숨김
            const roomForClient = { ...room, hands: {} };
            // 자신에게는 자신의 패 정보 포함
            this.io.to(player.socketId).emit('gameStarted', {
                room: roomForClient,
                myHand: room.hands[player.id],
                currentPlayerId: room.currentTurnPlayerId,
                gameRoundName: room.gameRoundName,
                currentRound: room.currentRound,
                currentPhase: room.currentPhase,
            });
        });

        this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: 30 });

        return true;
    }

    /**
     * 🃏 현재 방 덱에서 카드 한 장을 드로우합니다.
     * @param {number} roomId - 카드를 드로우할 방의 ID
     * @returns {Object|null} 드로우된 카드 객체 또는 덱이 비었으면 null
     */
    drawCard(roomId) {
        const deck = this.decks[roomId];
        if (!deck || deck.length === 0) {
            errorDebug(`[GameService] 방 ${roomId} 덱이 비어있습니다. 카드 드로우 실패.`);
            return null;
        }
        return deck.pop();
    }

    /**
     * ➡️ 다음 턴 플레이어를 설정하고 클라이언트에게 알립니다.
     * 라운드 종료 조건도 확인합니다.
     * @param {number} roomId - 턴을 진행할 방의 ID
     * @returns {boolean} 턴 진행 성공 여부 (true: 다음 턴 플레이어 있음, false: 라운드 종료)
     */
    advanceTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room) {
            errorDebug(`[GameService] advanceTurn 실패: 방 ${roomId}를 찾을 수 없습니다.`);
            return false;
        }

        let nextTurnIndex = room.turnIndex;
        const originalTurnPlayerId = room.currentTurnPlayerId;
        const activePlayersInRound = room.players.filter(p => !p.folded && !p.leaveReserved);

        // 1. 활성 플레이어가 1명 이하이면 게임 즉시 종료 (강제 승리)
        if (activePlayersInRound.length <= 1) {
            logDebug(`[GameService] 방 ${roomId} 활성 플레이어 1명 이하. 게임 즉시 종료.`);
            this.showdown(roomId, true);
            return false;
        }

        let phaseCompleted = false;

        // 2. 현재 페이즈 종료 조건 확인
        if (room.currentPhase === 'betting') {
            const allPlayersCalledOrChecked = activePlayersInRound.every(p => p.currentRoundBet === room.currentBet || p.folded);
            const turnReturnedToLastBetter = room.lastBettingPlayer === null || originalTurnPlayerId === room.lastBettingPlayer;

            if (allPlayersCalledOrChecked && turnReturnedToLastBetter) {
                phaseCompleted = true;
                logDebug(`[GameService] 방 ${roomId} 베팅 페이즈 완료.`);
            }
        } else if (room.currentPhase === 'exchange') {
            const allPlayersExchangedOrStayed = activePlayersInRound.every(p => !p.canExchange);
            if (allPlayersExchangedOrStayed) {
                phaseCompleted = true;
                logDebug(`[GameService] 방 ${roomId} 교환 페이즈 완료.`);
            }
        }

        if (phaseCompleted) {
            if (room.currentPhase === 'betting') {
                // 현재 베팅 페이즈 완료 -> 다음 단계 결정
                logDebug(`[GameService] 방 ${roomId} 현재 라운드 ${room.currentRound}의 베팅 페이즈 종료.`);

                // 모든 플레이어가 안테를 다시 내도록 처리 (새 라운드 시작 시)
                activePlayersInRound.forEach(player => {
                    if (player.chips < room.betAmount) { // 칩 부족 시 처리 (게임 종료 또는 강제 퇴장)
                        warnDebug(`[GameService] User ${player.name} (ID: ${player.id}) 다음 라운드 안테 부족. 게임 종료 또는 퇴장 처리 필요.`);
                        player.folded = true; // 임시로 폴드 처리하여 게임 종료 유도
                        player.status = 'folded';
                    } else {
                        player.chips -= room.betAmount; // 새 라운드 안테 지불
                        room.pot += room.betAmount;     // 팟에 추가
                        player.currentRoundBet = room.betAmount; // 현재 라운드 베팅액에 안테 포함
                    }
                });
                room.currentBet = room.betAmount; // 다음 페이즈/라운드 시작 시 기준 베팅액은 안테
                room.lastBettingPlayer = null; // 마지막 베팅 플레이어 리셋
                room.players.forEach(p => p.hasActedInBettingRound = false); // 액션 여부 리셋

                if (room.currentRound < room.maxRounds - 1) { // 아직 카드 교환 기회가 남은 라운드 (아침(0), 점심(1))
                    room.currentRound++; // 다음 메이저 라운드로 전환 (예: 아침(0) -> 점심(1))
                    room.gameRoundName = this.roundNames[room.currentRound]; // '점심' 또는 '저녁'
                    room.currentPhase = 'exchange'; // 다음 라운드는 교환 페이즈로 시작

                    room.players.forEach(p => p.canExchange = true); // 모든 플레이어 교환 기회 부여

                    logDebug(`[GameService] 방 ${roomId} 다음 라운드 ${room.gameRoundName}의 교환 페이즈 시작.`);
                    this.io.to(`room-${roomId}`).emit('roundStarted', { // 'roundStarted' 이벤트로 새로운 라운드 정보 전달
                        currentRound: room.currentRound,
                        gameRoundName: room.gameRoundName,
                        canExchangeCards: true, // 점심/저녁 라운드는 카드 교환 가능
                        currentPhase: room.currentPhase,
                        pot: room.pot, // 업데이트된 팟 정보
                        currentBet: room.currentBet // 업데이트된 currentBet 정보
                    });

                    // 턴 순서는 다시 딜러 다음 플레이어부터
                    room.turnIndex = (room.dealerIndex + 1) % room.players.length;
                    room.currentTurnPlayerId = room.players[room.turnIndex].id;
                    this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: 30, message: '카드 교환 차례입니다!' });
                    this.io.to(`room-${roomId}`).emit('roomUpdated', room);
                    return true; // 턴 진행은 계속해야 함 (교환 페이즈의 첫 턴으로)

                } else { // 최종 베팅 라운드 (저녁 라운드)의 베팅 페이즈 완료
                    logDebug(`[GameService] 방 ${roomId} 최종 베팅 라운드 (${room.gameRoundName}) 완료. 쇼다운으로 이동.`);
                    this.showdown(roomId, false);
                    return false; // 게임 종료
                }
            } else if (room.currentPhase === 'exchange') {
                // 교환 페이즈 완료 -> 현재 라운드의 베팅 페이즈로 전환
                logDebug(`[GameService] 방 ${roomId} 현재 라운드 ${room.currentRound}의 교환 페이즈 종료.`);

                room.currentPhase = 'betting'; // 다시 베팅 페이즈로
                room.currentBet = room.betAmount; // 베팅 기준 금액 초기화 (안테)
                room.players.forEach(p => p.currentRoundBet = room.betAmount); // 안테 지불 금액으로 초기화
                room.lastBettingPlayer = null; // 마지막 베팅 플레이어 리셋
                room.players.forEach(p => p.hasActedInBettingRound = false); // 액션 여부 리셋

                logDebug(`[GameService] 방 ${roomId} ${room.gameRoundName} 라운드의 베팅 페이즈 재시작.`);
                this.io.to(`room-${roomId}`).emit('phaseChanged', { // 'phaseChanged' 이벤트로 페이즈 변경 알림
                    currentPhase: room.currentPhase,
                    message: `${room.gameRoundName} 라운드 베팅 시작!`,
                    pot: room.pot, // 업데이트된 팟 정보
                    currentBet: room.currentBet // 업데이트된 currentBet 정보
                });

                // 턴 순서는 다시 딜러 다음 플레이어부터
                room.turnIndex = (room.dealerIndex + 1) % room.players.length;
                room.currentTurnPlayerId = room.players[room.turnIndex].id;
                this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: 30 });
                this.io.to(`room-${roomId}`).emit('roomUpdated', room);
                return true; // 턴 진행 계속
            }
        }

        // 3. 페이즈가 끝나지 않았다면 다음 플레이어 찾기
        do {
            nextTurnIndex = (nextTurnIndex + 1) % room.players.length;
            const nextPlayer = room.players[nextTurnIndex];

            // 활성 플레이어이고, 폴드하지 않았으며, 퇴장 예약도 하지 않은 플레이어 찾기
            if (!nextPlayer.folded && !nextPlayer.leaveReserved) {
                room.turnIndex = nextTurnIndex;
                room.currentTurnPlayerId = nextPlayer.id;
                logDebug(`[GameService] 방 ${roomId} 다음 턴: User ${nextPlayer.name} (ID: ${nextPlayer.id})`);
                this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: 30 });
                this.io.to(`room-${roomId}`).emit('roomUpdated', room);
                return true; // 다음 턴 플레이어 찾음
            }

            // 모든 플레이어를 한 바퀴 돌았는데도 다음 플레이어를 찾지 못했다면 (모두 폴드/퇴장 예약 등)
            if (nextPlayer.id === originalTurnPlayerId) {
                warnDebug(`[GameService] 방 ${roomId} 다음 턴 플레이어를 찾을 수 없습니다. (모두 폴드/퇴장 예약?)`);
                this.showdown(roomId, true); // 강제 승리 처리
                return false;
            }

        } while (true);
    }

    // ✨ startNextRound 함수는 더 이상 GameService 클래스 내에서 직접적으로 사용되지 않습니다.
    // ✨ advanceTurn에서 라운드 및 페이즈 전환 로직을 통합 관리합니다.
    // ✨ 클라이언트에서 'roundStarted' 이벤트를 받으면 업데이트합니다.

    /**
     * 💰 플레이어의 베팅 액션(폴드, 체크, 콜, 레이즈, 삥, 다이)을 처리합니다.
     * @param {number} roomId - 액션이 발생한 방의 ID
     * @param {number} playerId - 액션을 수행한 플레이어의 ID
     * @param {string} actionType - 액션 타입 ('fold', 'check', 'call', 'raise', 'bet' (삥), 'die')
     * @param {number} [amount=0] - 베팅 금액 (레이즈 시의 총액 또는 삥 금액)
     * @returns {{success: boolean, message?: string}} 액션 처리 결과
     */
    handleBettingAction(roomId, playerId, actionType, amount = 0) {
        const room = this.rooms[roomId];

        if (!room) { return { success: false, message: '방 정보를 찾을 수 없습니다.' }; }
        if (room.currentTurnPlayerId !== playerId) {
            warnDebug(`[GameService] 잘못된 턴 액션 요청: Player ${playerId}, Room ${roomId}. 현재 턴: ${room.currentTurnPlayerId}`);
            return { success: false, message: '지금은 당신의 턴이 아닙니다.' };
        }

        const player = room.players.find(p => p.id === playerId);
        if (!player) { return { success: false, message: '플레이어를 찾을 수 없습니다.' }; }
        if (player.folded) {
            warnDebug(`[GameService] 폴드된 플레이어의 액션 요청: Player ${playerId}, Room ${roomId}`);
            return { success: false, message: '이미 폴드된 플레이어입니다.' };
        }
        if (player.leaveReserved) {
            warnDebug(`[GameService] 퇴장 예약된 플레이어의 액션 요청: Player ${playerId}, Room ${roomId}`);
            return { success: false, message: '퇴장이 예약되어 있어 액션할 수 없습니다.' };
        }
        if (room.currentPhase !== 'betting') {
            return { success: false, message: '현재는 베팅 페이즈가 아닙니다. 카드 교환 또는 스테이를 선택하세요.' };
        }


        logDebug(`[GameService] Player ${player.name} (ID: ${playerId}) 액션: ${actionType}, 금액: ${amount}, 현재 팟: ${room.pot}, 현재 베팅: ${room.currentBet}, 내 베팅: ${player.currentRoundBet}`);

        player.hasActedInBettingRound = true; // 이번 베팅 라운드에서 액션을 했음을 표시

        switch (actionType) {
            case 'check':
                if (room.currentBet > player.currentRoundBet) {
                    return { success: false, message: '체크할 수 없습니다. 베팅 금액을 맞춰야 합니다.' };
                }
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'check', message: `${player.name}이(가) 체크했습니다.` });
                break;

            case 'bet': // '삥' (방의 기본 베팅액)
                // '삥'은 클라이언트에서 보낸 `amount`가 `room.betAmount`여야 합니다.
                if (amount !== room.betAmount) {
                    return { success: false, message: `'삥' 액션은 ${room.betAmount} 칩으로만 가능합니다.` };
                }

                // 현재 베팅액에 비해 플레이어가 추가로 지불해야 할 금액
                const chipsToPayForBbing = room.currentBet - player.currentRoundBet;

                if (chipsToPayForBbing <= 0) { // 플레이어가 이미 currentBet을 맞췄거나 초과한 경우
                    // 이 경우 '삥'은 콜/체크의 의미가 아닌 '레이즈'로 해석
                    // '삥' 액션은 '베팅'을 시작하거나 '최소 레이즈'를 하는 것으로 해석
                    const newTotalBet = room.currentBet + room.betAmount; // 현재 베팅액 + 방의 최소 베팅액
                    const chipsForRaise = newTotalBet - player.currentRoundBet;

                    if (chipsForRaise <= 0) {
                        return { success: false, message: '삥을 걸 필요가 없습니다. 체크하거나 레이즈하세요.' };
                    }
                    if (chipsForRaise > player.chips) {
                        return { success: false, message: '칩이 부족하여 삥을 걸 수 없습니다.' };
                    }

                    player.chips -= chipsForRaise;
                    room.pot += chipsForRaise;
                    room.currentBet = newTotalBet;
                    player.currentRoundBet = newTotalBet;
                    room.lastBettingPlayer = playerId;
                    this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'bet', amount: newTotalBet, message: `${player.name}이(가) ${newTotalBet} 칩으로 삥을 걸었습니다.` });

                } else { // 플레이어가 currentBet을 맞춰야 하는 경우
                    // '삥'은 '콜'로 해석
                    if (chipsToPayForBbing > player.chips) {
                        return { success: false, message: '칩이 부족하여 삥(콜)을 할 수 없습니다.' };
                    }
                    player.chips -= chipsToPayForBbing;
                    room.pot += chipsToPayForBbing;
                    player.currentRoundBet = room.currentBet;
                    room.lastBettingPlayer = playerId;
                    this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'bet', amount: room.currentBet, message: `${player.name}이(가) ${room.currentBet} 칩으로 삥(콜)했습니다.` });
                }
                break;

            case 'call':
                const amountToCall = room.currentBet - player.currentRoundBet;
                if (amountToCall <= 0) { // 콜할 필요 없음 (베팅 금액이 같거나 내가 더 많이 베팅한 경우)
                    return { success: false, message: '콜할 필요가 없습니다. 체크하거나 레이즈하세요.' };
                }
                if (amountToCall > player.chips) {
                    return { success: false, message: '칩이 부족하여 콜할 수 없습니다.' };
                }
                player.chips -= amountToCall;
                room.pot += amountToCall;
                player.currentRoundBet = room.currentBet;
                room.lastBettingPlayer = playerId; // 콜도 베팅 액션의 일부로 간주
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'call', amount: amountToCall, message: `${player.name}이(가) ${amountToCall} 칩으로 콜했습니다.` });
                break;

            case 'raise':
                // amount는 플레이어가 총 베팅하고자 하는 금액 (내 currentRoundBet 포함)
                const minRaiseTotalAmount = room.currentBet + room.betAmount; // 최소 레이즈 총액
                if (amount < minRaiseTotalAmount) {
                    return { success: false, message: `유효하지 않은 레이즈 금액입니다. 총 ${minRaiseTotalAmount} 칩 이상을 베팅해야 합니다.` };
                }
                const amountToRaise = amount - player.currentRoundBet; // 실제로 칩에서 차감할 금액
                if (amountToRaise <= 0) {
                    return { success: false, message: '레이즈 금액이 유효하지 않습니다. 현재 베팅액보다 높아야 합니다.' };
                }
                if (amountToRaise > player.chips) {
                    return { success: false, message: '칩이 부족하여 레이즈할 수 없습니다.' };
                }

                player.chips -= amountToRaise;
                room.pot += amountToRaise;
                room.currentBet = amount; // 룸의 현재 베팅액을 레이즈된 금액으로 업데이트
                player.currentRoundBet = amount;
                room.lastBettingPlayer = playerId; // 레이즈한 플레이어가 마지막 베팅 플레이어
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'raise', amount: amount, message: `${player.name}이(가) ${amount} 칩으로 레이즈했습니다.` });
                break;

            case 'die': // '다이' (폴드와 동일)
            case 'fold':
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'die', message: `${player.name}이(가) 다이를 선언했습니다.` });
                player.folded = true;
                player.status = 'folded';
                // room.activePlayers는 advanceTurn에서 필터링
                break;

            default:
                warnDebug(`[GameService] 알 수 없는 액션 타입: ${actionType}`);
                return { success: false, message: '알 수 없는 액션입니다.' };
        }

        // 액션 처리 후 다음 턴으로 진행
        this.advanceTurn(roomId);
        this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 방 정보 업데이트
        return { success: true };
    }

    /**
     * 🃏 플레이어의 카드 교환 액션을 처리합니다.
     * @param {number} roomId - 액션이 발생한 방의 ID
     * @param {number} playerId - 액션을 수행한 플레이어의 ID
     * @param {Array<string>} cardsToExchange - 교환할 카드들의 ID 목록
     * @returns {{success: boolean, message?: string}} 액션 처리 결과
     */
    handleCardExchange(roomId, playerId, cardsToExchange) {
        const room = this.rooms[roomId];

        if (!room) { return { success: false, message: '방 정보를 찾을 수 없습니다.' }; }
        if (room.currentTurnPlayerId !== playerId) {
            warnDebug(`[GameService] 잘못된 턴 카드 교환 요청: Player ${playerId}, Room ${roomId}`);
            return { success: false, message: '지금은 당신의 턴이 아닙니다.' };
        }
        if (room.currentPhase !== 'exchange') {
            return { success: false, message: '지금은 카드 교환 페이즈가 아닙니다.' };
        }
        // 아침(0) 라운드에는 교환 불가 (currentRound는 1: 점심부터 교환 가능)
        if (room.currentRound === 0) {
            return { success: false, message: '아침 라운드에는 카드를 교환할 수 없습니다. 베팅만 가능합니다.' };
        }
        if (room.currentRound >= room.maxRounds) { // 모든 라운드가 끝났거나 마지막 라운드 저녁(2) 이후
            return { success: false, message: '더 이상 카드를 교환할 수 없습니다. 게임이 곧 종료됩니다.' };
        }
        const player = room.players.find(p => p.id === playerId);
        if (!player) { return { success: false, message: '플레이어를 찾을 수 없습니다.' }; }
        if (!player.canExchange) { // 이번 라운드에 이미 교환했거나 스테이한 경우
            return { success: false, message: '이번 라운드에 카드를 교환할 수 없습니다.' };
        }
        if (player.folded) {
            return { success: false, message: '폴드된 플레이어는 카드를 교환할 수 없습니다.' };
        }

        if (!Array.isArray(cardsToExchange) || cardsToExchange.length < 0 || cardsToExchange.length > 4) {
            return { success: false, message: '교환할 카드는 0~4장만 선택할 수 있습니다.' };
        }

        if (cardsToExchange.length === 0) { // 0장 교환은 '스테이' 액션과 동일
            player.canExchange = false; // 이번 라운드 카드 교환 기회 사용
            this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'stay', message: `${player.name}이(가) 스테이했습니다.` });
            this.advanceTurn(roomId);
            this.io.to(`room-${roomId}`).emit('roomUpdated', room);
            return { success: true };
        }

        const playerHand = room.hands[playerId];
        if (!playerHand) { return { success: false, message: '플레이어의 패를 찾을 수 없습니다.' }; }

        const idsToExchangeSet = new Set(cardsToExchange);
        // 플레이어 패에 실제로 교환하려는 카드가 있는지 확인
        const actualCardsToExchange = playerHand.filter(card => idsToExchangeSet.has(card.id));
        if (actualCardsToExchange.length !== cardsToExchange.length) {
            return { success: false, message: '교환하려는 카드 중 일부가 패에 존재하지 않습니다.' };
        }

        const newHand = playerHand.filter(card => !idsToExchangeSet.has(card.id)); // 교환할 카드 제외

        const cardsDrawn = [];
        for (let i = 0; i < cardsToExchange.length; i++) {
            const newCard = this.drawCard(roomId);
            if (newCard) {
                newHand.push(newCard);
                cardsDrawn.push(newCard);
            } else {
                errorDebug(`[GameService] 방 ${roomId} 덱이 비어 카드 드로우 실패. 카드 교환 중단.`);
                return { success: false, message: '덱이 비어 카드를 교환할 수 없습니다.' };
            }
        }

        if (newHand.length !== 4) {
            errorDebug(`[GameService] 카드 교환 후 패의 길이가 4장이 아닙니다! 현재 길이: ${newHand.length}, playerId: ${playerId}, roomId: ${roomId}`);
            return { success: false, message: '카드 교환 후 패가 올바르지 않습니다.' };
        }

        room.hands[playerId] = newHand;
        player.canExchange = false; // 이번 라운드 카드 교환 기회 사용

        player.bestHand = evaluateBadugiHand(newHand);
        logDebug(`[GameService] User ${player.name} (ID: ${playerId}) 카드 교환 완료. 새로운 패: ${newHand.map(c => `${c.suit}${c.rank}`).join(', ')}`);

        this.io.to(`room-${roomId}`).emit('playerAction', {
            playerId,
            actionType: 'exchange',
            count: cardsToExchange.length,
            message: `${player.name}이(가) ${cardsToExchange.length}장 교환했습니다.`,
        });
        this.io.to(player.socketId).emit('myHandUpdated', { hand: newHand, bestHand: player.bestHand });

        this.advanceTurn(roomId); // 교환 후 다음 턴으로 진행
        this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 방 정보 업데이트
        return { success: true };
    }

    /**
     * 🏆 게임 종료 및 승패 판정을 처리합니다.
     * @param {number} roomId - 게임을 종료할 방의 ID
     * @param {boolean} [forceWinner=false] - 한 명만 남아서 강제로 승자를 결정하는 경우
     */
    showdown(roomId, forceWinner = false) {
        const room = this.rooms[roomId];
        if (!room) {
            errorDebug(`[GameService] showdown 실패: 방 ${roomId}를 찾을 수 없습니다.`);
            return;
        }

        room.status = 'showdown';
        logDebug(`[GameService] 방 ${roomId} 쇼다운 시작!`);

        let eligiblePlayers = room.players.filter(p => !p.folded && !p.leaveReserved); // 폴드하지 않고 퇴장 예약 없는 플레이어

        if (forceWinner && eligiblePlayers.length === 1) {
            const winner = eligiblePlayers[0];
            winner.chips += room.pot;
            room.pot = 0;
            room.status = 'ended';
            logDebug(`[GameService] 방 ${roomId} 강제 종료. 승자: User ${winner.name} (ID: ${winner.id})`);
            this.io.to(`room-${roomId}`).emit('gameEnded', {
                roomStatus: room.status,
                winnerIds: [winner.id],
                winnerNames: [winner.name],
                reason: '모든 상대방이 다이하거나 퇴장하여 승리',
                finalHands: room.hands,
                finalPlayers: room.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, bestHand: p.bestHand, isCreator: p.isCreator, folded: p.folded, status: p.status }))
            });
            // 게임 종료 후 모든 플레이어의 상태를 'waiting'으로 변경하고, 퇴장 예약 플레이어는 방에서 제거
            this.cleanupRoomAfterGame(roomId);
            return;
        }

        if (eligiblePlayers.length > 1) {
            const playerHandsToCompare = eligiblePlayers.map(p => ({
                playerId: p.id,
                hand: room.hands[p.id],
                bestHand: p.bestHand // evaluateBadugiHand로 이미 평가된 족보 객체
            }));

            const winners = compareBadugiHands(playerHandsToCompare);

            if (winners.length > 0) {
                let winnerIds = winners.map(w => w.playerId);
                let winnerNames = winners.map(w => room.players.find(p => p.id === w.playerId).name);
                let prizePerWinner = Math.floor(room.pot / winners.length);

                winners.forEach(winner => {
                    const player = room.players.find(p => p.id === winner.playerId);
                    player.chips += prizePerWinner;
                });
                room.pot = 0;
                room.status = 'ended';

                logDebug(`[GameService] 방 ${roomId} 쇼다운 승자: ${winnerNames.join(', ')} (ID: ${winnerIds.join(', ')})`);

                const finalHandsToShow = {};
                room.players.forEach(p => {
                    // 폴드하지 않았거나, 승자인 경우 패 공개 (기본)
                    if (!p.folded || winners.some(w => w.playerId === p.id)) {
                        finalHandsToShow[p.id] = room.hands[p.id];
                    }
                });

                this.io.to(`room-${roomId}`).emit('gameEnded', {
                    roomStatus: room.status,
                    winnerIds: winnerIds,
                    winnerNames: winnerNames,
                    winningHands: winners.map(w => ({ playerId: w.playerId, hand: w.hand, bestHand: w.bestHand })),
                    finalHands: finalHandsToShow, // 최종 패 공개
                    finalPlayers: room.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, bestHand: p.bestHand, isCreator: p.isCreator, folded: p.folded, status: p.status }))
                });
            } else {
                errorDebug(`[GameService] 방 ${roomId} 쇼다운에서 승자를 찾을 수 없습니다. (오류)`);
                room.status = 'ended';
                this.io.to(`room-${roomId}`).emit('gameEnded', { roomStatus: room.status, reason: '승자를 찾을 수 없습니다. (오류)' });
            }
        } else {
            // 활성 플레이어가 0명인 경우 (모두 폴드 또는 퇴장)
            room.status = 'ended';
            this.io.to(`room-${roomId}`).emit('gameEnded', { roomStatus: room.status, reason: '모든 플레이어가 게임에서 퇴장했습니다.' });
        }
        // 게임 종료 후 정리
        this.cleanupRoomAfterGame(roomId);
        this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 최종 방 정보 업데이트
    }

    /**
     * 🧹 게임 종료 후 방 상태를 정리합니다.
     * 모든 플레이어 상태를 'waiting'으로 변경하고, 퇴장 예약된 플레이어를 방에서 제거합니다.
     * @param {number} roomId
     */
    cleanupRoomAfterGame(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;

        room.status = 'waiting';
        room.currentRound = 0;
        room.gameRoundName = '대기 중';
        room.pot = 0;
        room.currentBet = 0;
        room.lastBettingPlayer = null;
        room.currentPhase = 'waiting'; // 페이즈도 초기화

        // 퇴장 예약된 플레이어 제거
        room.players = room.players.filter(player => {
            if (player.leaveReserved) {
                logDebug(`[GameService] 게임 종료 후 퇴장 예약된 User ${player.name} (ID: ${player.id}) 방 ${roomId}에서 제거.`);
                this.io.to(player.socketId).emit('forceLeaveRoom', { roomId: roomId, message: '게임이 종료되어 방에서 나갑니다.' }); // 클라이언트에 알림
                return false; // 방에서 제거
            }
            // 그 외 플레이어는 상태 초기화
            player.currentRoundBet = 0;
            player.folded = false;
            player.status = 'waiting';
            player.bestHand = null;
            player.canExchange = true;
            player.hasActedInBettingRound = false;
            return true; // 방에 남김
        });

        // 만약 방장이 나가고 남은 플레이어가 없다면 방 삭제
        if (room.players.length === 0) {
            delete this.rooms[roomId];
            logDebug(`[GameService] 게임 종료 후 빈 방 ${roomId} 삭제.`);
        } else {
            // 방장이 퇴장하여 방장이 없는 경우, 남은 플레이어 중 첫 번째를 방장으로 위임
            if (!room.players.some(p => p.id === room.creatorId)) {
                if (room.players.length > 0) {
                    room.creatorId = room.players[0].id;
                    room.players[0].isCreator = true;
                    logDebug(`[GameService] 게임 종료 후 방장 위임: 방 ${roomId}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})`);
                } else { // 그래도 없으면 방 삭제 (이 경우 위에 걸려서 실행될 일은 거의 없음)
                    delete this.rooms[roomId];
                    logDebug(`[GameService] 게임 종료 후 방장 없는 빈 방 ${roomId} 삭제.`);
                }
            }
        }
        logDebug(`[GameService] 방 ${roomId} 게임 종료 후 정리 완료.`);
    }
}

export { GameService };