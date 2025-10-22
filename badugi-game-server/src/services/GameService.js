// badugi-game-server/src/services/GameService.js

// 🃏 카드 유틸리티 함수 임포트
import { createDeck, shuffleDeck, evaluateBadugiHand, compareBadugiHands } from '../utils/cards.js';
// ✍️ 서버 로깅 함수 임포트 (server.js에서 내보낸 함수들을 여기서 임포트하여 사용)
import { logDebug, warnDebug, errorDebug } from '../../logger.js'; // ✨ FIX: 상위 디렉토리의 logger.js 임포트

/**
 * 🎮 바둑이 게임의 핵심 로직을 관리하는 서비스 클래스입니다.
 */
class GameService {
    constructor(io, rooms, turnTimeLimit) {
        this.io = io;
        this.rooms = rooms;

        this.bettingRoundNames = ['아침', '점심', '저녁', '최종'];
        this.maxBettingRounds = this.bettingRoundNames.length;
        this.maxExchangeOpportunities = this.maxBettingRounds - 1;

        this.decks = {};
        this.turnTimers = {};
        this.turnTimeLimit = turnTimeLimit || 30;

        // ✨ 메서드를 constructor에서 바인딩하여 'this' 컨텍스트를 유지
        this.startGame = this.startGame.bind(this);
        this.drawCard = this.drawCard.bind(this);
        this.advanceTurn = this.advanceTurn.bind(this);
        this.handleBettingAction = this.handleBettingAction.bind(this);
        this.handleCardExchange = this.handleCardExchange.bind(this);
        this.showdown = this.showdown.bind(this);
        this.handlePhaseTransitionAfterBetting = this.handlePhaseTransitionAfterBetting.bind(this);
        this.handlePhaseTransitionAfterExchange = this.handlePhaseTransitionAfterExchange.bind(this);
        this.cleanupRoomAfterGame = this.cleanupRoomAfterGame.bind(this);
        this.startTurnTimer = this.startTurnTimer.bind(this);
        this.clearTurnTimer = this.clearTurnTimer.bind(this);
        this.handleTimerTimeout = this.handleTimerTimeout.bind(this);
    }

    startGame(roomId) {
        const room = this.rooms[roomId];
        if (!room) { errorDebug('[GameService]', `게임 시작 실패: 방 ${roomId}를 찾을 수 없습니다.`); return false; } // ✨ FIX: 태그 추가
        if (room.status !== 'waiting') { warnDebug('[GameService]', `게임 시작 실패: 방 ${roomId}는 이미 ${room.status} 상태입니다.`); return false; } // ✨ FIX: 태그 추가
        if (room.players.length < 2) { warnDebug('[GameService]', `게임 시작 실패: 방 ${roomId}에 최소 2명 이상의 플레이어가 필요합니다.`); return false; } // ✨ FIX: 태그 추가

        room.status = 'playing';
        room.currentBettingRoundIndex = 0;
        room.currentExchangeOpportunityIndex = -1;
        room.gameRoundName = this.bettingRoundNames[room.currentBettingRoundIndex];
        room.pot = 0;
        room.currentBet = 0;
        room.activePlayers = room.players.filter(p => !p.leaveReserved).map(p => p.id);

        room.lastBettingPlayer = null;
        room.hands = {};
        room.discardPiles = {};
        room.currentTurnPlayerId = null;
        room.currentPhase = 'betting';
        room.lastActionPlayerId = null;
        room.timerProcessingLock = false;
        room.turnIndexAtRoundStart = null;

        const playersWithInsufficientChips = room.players.filter(player => player.chips < room.betAmount);
        if (playersWithInsufficientChips.length > 0) {
            errorDebug('[GameService]', `방 ${roomId} 칩 부족으로 게임 시작 불가. 다음 플레이어들: ${playersWithInsufficientChips.map(p => p.name).join(', ')} (필요 칩: ${room.betAmount})`); // ✨ FIX: 태그 추가
            room.status = 'waiting';
            this.io.to(`room-${roomId}`).emit('gameError', { message: '일부 플레이어의 칩이 부족하여 게임을 시작할 수 없습니다.' });
            return false;
        }

        room.players.forEach(player => {
            player.chips -= room.betAmount;
            room.pot += room.betAmount;
            player.currentRoundBet = 0;
            player.folded = false;
            player.status = 'playing';
            player.bestHand = null;
            player.canExchange = false;
            player.hasActedInBettingRound = false;
            player.leaveReserved = false;
        });
        logDebug('[GameService]', `방 ${roomId} 모든 플레이어 기본금 ${room.betAmount} 칩 지불 완료. 현재 팟: ${room.pot}`); // ✨ FIX: 태그 추가

        const currentCreatorIndex = room.players.findIndex(p => p.id === room.creatorId);
        if (currentCreatorIndex === -1) {
            errorDebug('[GameService]', `방 ${roomId}에서 방장(ID: ${room.creatorId})을 찾을 수 없습니다. 게임 시작 불가.`); // ✨ FIX: 태그 추가
            room.status = 'waiting';
            return false;
        }

        if (room.dealerIndex === undefined || room.dealerIndex === -1) {
            room.dealerIndex = (currentCreatorIndex + 1) % room.players.length;
        } else {
            room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
        }
        room.dealerId = room.players[room.dealerIndex].id;

        const smallBlindIndex = (room.dealerIndex + 1) % room.players.length;
        room.smallBlindId = room.players[smallBlindIndex].id;

        const bigBlindIndex = (smallBlindIndex + 1) % room.players.length;
        room.bigBlindId = room.players[bigBlindIndex].id;

        let initialTurnPlayerIndex = (room.dealerIndex + 1) % room.players.length;
        let loopCount = 0;
        const numPlayers = room.players.length;
        while ((room.players[initialTurnPlayerIndex].folded || room.players[initialTurnPlayerIndex].leaveReserved) && loopCount < numPlayers) {
            initialTurnPlayerIndex = (initialTurnPlayerIndex + 1) % numPlayers;
            loopCount++;
        }
        if (loopCount === numPlayers) {
            errorDebug('[GameService]', `방 ${roomId} 첫 턴 플레이어를 찾을 수 없어 게임 시작 불가. (모든 플레이어 비활성)`); // ✨ FIX: 태그 추가
            room.status = 'waiting';
            return false;
        }

        room.turnIndex = initialTurnPlayerIndex;
        room.currentTurnPlayerId = room.players[room.turnIndex].id;
        room.lastActionPlayerId = room.currentTurnPlayerId;
        room.turnIndexAtRoundStart = room.turnIndex;

        logDebug('[GameService]', `방 ${roomId} 게임 시작. 딜러: ${room.players[room.dealerIndex].name}, SB: ${room.players[smallBlindIndex].name}, BB: ${room.players[bigBlindIndex].name}. 첫 턴: User ${room.players[room.turnIndex].name} (ID: ${room.currentTurnPlayerId})`); // ✨ FIX: 태그 추가

        const newDeck = shuffleDeck(createDeck());
        this.decks[roomId] = newDeck;
        room.players.forEach(player => {
            const hand = []; for (let i = 0; i < 4; i++) hand.push(this.drawCard(roomId));
            room.hands[player.id] = hand;
            player.bestHand = evaluateBadugiHand(room.hands[player.id]);
            logDebug('[GameService]', `User ${player.name} (ID: ${player.id}) 초기 패 분배 완료: ${hand.map(c => `${c.suit}${c.rank}`).join(', ')}, 족보: ${player.bestHand.rank}`); // ✨ FIX: 태그 추가
        });

        room.players.forEach(player => {
            const roomForClient = { ...room, hands: {} };
            this.io.to(player.socketId).emit('gameStarted', {
                room: roomForClient,
                myHand: room.hands[player.id],
                currentPlayerId: room.currentTurnPlayerId,
                gameRoundName: room.gameRoundName,
                currentBettingRoundIndex: room.currentBettingRoundIndex,
                currentExchangeOpportunityIndex: room.currentExchangeOpportunityIndex,
                currentPhase: room.currentPhase,
                maxBettingRounds: this.maxBettingRounds,
                maxExchangeOpportunities: this.maxExchangeOpportunities,
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });
        });

        this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
        this.startTurnTimer(roomId, room.currentTurnPlayerId);
        return true;
    }

    drawCard(roomId) {
        const deck = this.decks[roomId];
        if (!deck || deck.length === 0) {
            errorDebug('[GameService]', `방 ${roomId} 덱이 비어있습니다. 카드 드로우 실패.`); // ✨ FIX: 태그 추가
            return null;
        }
        return deck.pop();
    }

    advanceTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room) { errorDebug('[GameService]', `advanceTurn 실패: 방 ${roomId}를 찾을 수 없습니다.`); return false; } // ✨ FIX: 태그 추가

        this.clearTurnTimer(roomId);

        let currentTurnIndex = room.turnIndex;
        const activePlayersInRound = room.players.filter(p => !p.folded && !p.leaveReserved);

        if (activePlayersInRound.length <= 1) {
            logDebug('[GameService]', `방 ${roomId} 활성 플레이어 1명 이하. 게임 즉시 종료.`); // ✨ FIX: 태그 추가
            this.showdown(roomId, true);
            return false;
        }

        let phaseCompleted = false;
        if (room.currentPhase === 'betting') {
            const activePlayersInRound = room.players.filter(p => !p.folded && !p.leaveReserved);

            const allPlayersCalledOrChecked = activePlayersInRound.every(p =>
                p.currentRoundBet === room.currentBet || (p.chips === 0 && p.currentRoundBet < room.currentBet)
            );

            if (room.currentBet > 0) {
                if (allPlayersCalledOrChecked &&
                    room.currentTurnPlayerId === room.lastBettingPlayer &&
                    room.lastBettingPlayer !== null) {
                    phaseCompleted = true;
                }
            } else {
                const allPlayersActedOnce = activePlayersInRound.every(p => p.hasActedInBettingRound);
                if (allPlayersActedOnce) {
                    phaseCompleted = true;
                }
            }

            if (phaseCompleted) {
                logDebug('[GameService]', `방 ${roomId} 베팅 페이즈 완료 (베팅 라운드 ${room.currentBettingRoundIndex}).`); // ✨ FIX: 태그 추가
                return this.handlePhaseTransitionAfterBetting(roomId);
            }
        } else if (room.currentPhase === 'exchange') {
            const allPlayersFinishedExchange = activePlayersInRound.every(p => !p.canExchange);
            if (allPlayersFinishedExchange) {
                logDebug('[GameService]', `방 ${roomId} 모든 활성 플레이어가 교환 또는 스테이를 완료했습니다.`); // ✨ FIX: 태그 추가
                phaseCompleted = true;
            }

            if (phaseCompleted) {
                logDebug('[GameService]', `방 ${roomId} 교환 페이즈 완료 (기회 ${room.currentExchangeOpportunityIndex}).`); // ✨ FIX: 태그 추가
                return this.handlePhaseTransitionAfterExchange(roomId);
            }
        }

        let nextTurnPlayerFound = false;
        let loopCount = 0;
        const numPlayers = room.players.length;
        const initialTurnPlayerId = room.currentTurnPlayerId;

        do {
            currentTurnIndex = (currentTurnIndex + 1) % numPlayers;
            const nextPlayer = room.players[currentTurnIndex];

            if (nextPlayer.id === initialTurnPlayerId && loopCount > 0) {
                warnDebug('[GameService]', `방 ${roomId} 턴 진행 중 다음 액션 플레이어를 찾지 못하고 한 바퀴 돌았습니다. (모두 액션했거나 폴드/퇴장 예상) - 강제 쇼다운`); // ✨ FIX: 태그 추가
                this.showdown(roomId, true);
                return false;
            }

            if (!nextPlayer.folded && !nextPlayer.leaveReserved) {
                if (room.currentPhase === 'exchange' && !nextPlayer.canExchange) {
                    logDebug('[GameService]', `Player ${nextPlayer.name} (ID: ${nextPlayer.id})는 이미 교환 완료. 턴 스킵.`); // ✨ FIX: 태그 추가
                } else {
                    room.turnIndex = currentTurnIndex;
                    room.currentTurnPlayerId = nextPlayer.id;
                    nextTurnPlayerFound = true;
                    logDebug('[GameService]', `방 ${roomId} 다음 턴: User ${nextPlayer.name} (ID: ${nextPlayer.id})`); // ✨ FIX: 태그 추가
                    this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
                    this.io.to(`room-${roomId}`).emit('roomUpdated', room);
                    this.startTurnTimer(roomId, room.currentTurnPlayerId);
                    return true;
                }
            }
            loopCount++;
        } while (!nextTurnPlayerFound && loopCount < numPlayers + 1);

        errorDebug('[GameService]', `방 ${roomId} 모든 플레이어 턴 순회 후 다음 액션 플레이어를 찾을 수 없습니다. (예상치 못한 정지) - 강제 쇼다운`); // ✨ FIX: 태그 추가
        this.showdown(roomId, true);
        return false;
    }

    handlePhaseTransitionAfterBetting(roomId) {
        const room = this.rooms[roomId];

        if (room.currentExchangeOpportunityIndex + 1 < this.maxExchangeOpportunities) {
            room.currentPhase = 'exchange';
            room.currentExchangeOpportunityIndex++;

            room.players.forEach(p => {
                if (!p.folded && !p.leaveReserved) {
                    p.canExchange = true;
                }
            });

            room.lastBettingPlayer = null;
            room.players.forEach(p => p.hasActedInBettingRound = false);
            room.players.forEach(p => p.currentRoundBet = 0);
            room.currentBet = 0;

            logDebug('[GameService]', `방 ${roomId} ${this.bettingRoundNames[room.currentBettingRoundIndex]} 라운드의 ${room.currentExchangeOpportunityIndex + 1}번째 교환 페이즈 시작.`); // ✨ FIX: 태그 추가
            this.io.to(`room-${roomId}`).emit('phaseChanged', {
                currentBettingRoundIndex: room.currentBettingRoundIndex,
                currentExchangeOpportunityIndex: room.currentExchangeOpportunityIndex,
                gameRoundName: this.bettingRoundNames[room.currentBettingRoundIndex],
                currentPhase: room.currentPhase,
                pot: room.pot,
                currentBet: room.currentBet,
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });

            let startIndex = room.players.findIndex(p => p.id === room.lastActionPlayerId);
            if (startIndex === -1) startIndex = room.dealerIndex;

            let nextTurnPlayerIndex = -1;
            let loopCount = 0;
            const numPlayers = room.players.length;

            do {
                startIndex = (startIndex + 1) % numPlayers;
                const potentialPlayer = room.players[startIndex];
                if (!potentialPlayer.folded && !potentialPlayer.leaveReserved) {
                    nextTurnPlayerIndex = startIndex;
                    break;
                }
                loopCount++;
            } while (loopCount < numPlayers);

            if (nextTurnPlayerIndex === -1) {
                errorDebug('[GameService]', `방 ${roomId} 다음 교환 페이즈의 첫 턴 플레이어를 찾을 수 없습니다. 강제 쇼다운.`); // ✨ FIX: 태그 추가
                this.showdown(roomId, true);
                return false;
            }
            room.turnIndex = nextTurnPlayerIndex;
            room.currentTurnPlayerId = room.players[room.turnIndex].id;
            room.turnIndexAtRoundStart = room.turnIndex;

            this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
            this.io.to(`room-${roomId}`).emit('roomUpdated', room);
            this.startTurnTimer(roomId, room.currentTurnPlayerId);
            return true;
        } else {
            logDebug('[GameService]', `방 ${roomId} 모든 교환 기회 종료. 쇼다운으로 이동.`); // ✨ FIX: 태그 추가
            this.showdown(roomId, false);
            return false;
        }
    }

    handlePhaseTransitionAfterExchange(roomId) {
        const room = this.rooms[roomId];
        room.currentBettingRoundIndex++;

        if (room.currentBettingRoundIndex < this.maxBettingRounds) {
            room.gameRoundName = this.bettingRoundNames[room.currentBettingRoundIndex];
            room.currentPhase = 'betting';

            room.currentBet = 0;
            room.lastBettingPlayer = null;
            room.players.forEach(p => {
                p.currentRoundBet = 0;
                if (!p.folded && !p.leaveReserved) {
                    p.chips -= room.betAmount;
                    room.pot += room.betAmount;
                }
                p.hasActedInBettingRound = false;
                p.canExchange = false;
            });

            logDebug('[GameService]', `방 ${roomId} ${room.gameRoundName} 라운드의 베팅 페이즈 시작. 새로운 안테 수집 완료. 팟: ${room.pot}`); // ✨ FIX: 태그 추가
            this.io.to(`room-${roomId}`).emit('roundStarted', {
                currentBettingRoundIndex: room.currentBettingRoundIndex,
                currentExchangeOpportunityIndex: room.currentExchangeOpportunityIndex,
                gameRoundName: this.bettingRoundNames[room.currentBettingRoundIndex],
                currentPhase: room.currentPhase,
                pot: room.pot,
                currentBet: room.currentBet,
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });

            let startIndex = (room.dealerIndex + 1) % room.players.length;

            let nextTurnPlayerIndex = -1;
            let loopCount = 0;
            const numPlayers = room.players.length;

            do {
                const potentialPlayer = room.players[startIndex];
                if (!potentialPlayer.folded && !potentialPlayer.leaveReserved) {
                    nextTurnPlayerIndex = startIndex;
                    break;
                }
                startIndex = (startIndex + 1) % numPlayers;
                loopCount++;
            } while (loopCount < numPlayers);

            if (nextTurnPlayerIndex === -1) {
                errorDebug('[GameService]', `방 ${roomId} 다음 베팅 라운드의 첫 턴 플레이어를 찾을 수 없습니다. 강제 쇼다운.`); // ✨ FIX: 태그 추가
                this.showdown(roomId, true);
                return false;
            }
            room.turnIndex = nextTurnPlayerIndex;
            room.currentTurnPlayerId = room.players[room.turnIndex].id;
            room.turnIndexAtRoundStart = room.turnIndex;

            this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
            this.io.to(`room-${roomId}`).emit('roomUpdated', room);
            this.startTurnTimer(roomId, room.currentTurnPlayerId);
            return true;
        } else {
            logDebug('[GameService]', `방 ${roomId} 모든 베팅 라운드가 끝났습니다. 쇼다운으로 이동.`); // ✨ FIX: 태그 추가
            this.showdown(roomId, false);
            return false;
        }
    }


    handleBettingAction(roomId, playerId, actionType, amount = 0) {
        const room = this.rooms[roomId];

        if (!room) { return { success: false, message: '방 정보를 찾을 수 없습니다.' }; }
        if (room.currentTurnPlayerId !== playerId) {
            warnDebug('[GameService]', `잘못된 턴 액션 요청: Player ${playerId}, Room ${roomId}. 현재 턴: ${room.currentTurnPlayerId}`); // ✨ FIX: 태그 추가
            return { success: false, message: '지금은 당신의 턴이 아닙니다.' };
        }

        const player = room.players.find(p => p.id === playerId);
        if (!player) { return { success: false, message: '플레이어를 찾을 수 없습니다.' }; }
        if (player.folded) {
            warnDebug('[GameService]', `폴드된 플레이어의 액션 요청: Player ${playerId}, Room ${roomId}`); // ✨ FIX: 태그 추가
            return { success: false, message: '이미 폴드된 플레이어입니다.' };
        }
        if (player.leaveReserved) {
            warnDebug('[GameService]', `퇴장 예약된 플레이어의 액션 요청: Player ${playerId}, Room ${roomId}`); // ✨ FIX: 태그 추가
            return { success: false, message: '퇴장이 예약되어 있어 액션할 수 없습니다.' };
        }
        if (room.currentPhase !== 'betting') {
            return { success: false, message: '현재는 베팅 페이즈가 아닙니다. 카드 교환 또는 스테이를 선택하세요.' };
        }
        if (player.chips <= 0 && actionType !== 'die' && actionType !== 'call') {
            return { success: false, message: '칩이 부족하여 해당 액션을 할 수 없습니다. 다이하거나 올인 콜하세요.' };
        }

        logDebug('[GameService]', `Player ${player.name} (ID: ${playerId}) 액션: ${actionType}, 금액: ${amount}, 현재 팟: ${room.pot}, 현재 베팅: ${room.currentBet}, 내 베팅: ${player.currentRoundBet}`); // ✨ FIX: 태그 추가

        switch (actionType) {
            case 'check':
                if (room.currentBet > 0) { return { success: false, message: '이미 베팅이 이루어진 상태에서는 체크할 수 없습니다.' }; }
                if (room.currentBet > player.currentRoundBet) { return { success: false, message: '체크할 수 없습니다. 베팅 금액을 맞춰야 합니다.' }; }
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'check', message: `${player.name}이(가) 체크했습니다.` });
                room.lastActionPlayerId = playerId;
                player.hasActedInBettingRound = true;
                break;

            case 'bet':
                const myCurrentRoundBetForBbing = player.currentRoundBet;
                let chipsToPayForBbing = 0;
                let newTotalBetAmountForBbing = amount;

                if (newTotalBetAmountForBbing < room.betAmount) { return { success: false, message: `삥 금액은 최소 ${room.betAmount} 칩 이상이어야 합니다.` }; }

                if (room.currentBet === 0) {
                    if (newTotalBetAmountForBbing !== room.betAmount) { return { success: false, message: `첫 삥은 ${room.betAmount} 칩으로만 할 수 있습니다.` }; }
                    chipsToPayForBbing = newTotalBetAmountForBbing - myCurrentRoundBetForBbing;
                }
                else {
                    const expectedBbingAmount = room.currentBet + room.betAmount;
                    if (newTotalBetAmountForBbing < expectedBbingAmount) { return { success: false, message: `삥 금액은 현재 베팅액(${room.currentBet})에 삥 금액(${room.betAmount})을 더한 ${expectedBbingAmount} 칩 이상이어야 합니다.` }; }
                    chipsToPayForBbing = newTotalBetAmountForBbing - myCurrentRoundBetForBbing;
                }

                if (chipsToPayForBbing <= 0) { return { success: false, message: '삥을 걸 필요가 없습니다. 체크 또는 콜/레이즈하세요.' }; }
                if (chipsToPayForBbing > player.chips) { return { success: false, message: '칩이 부족하여 삥을 걸 수 없습니다. 콜 또는 다이하세요.' }; }

                player.chips -= chipsToPayForBbing; room.pot += chipsToPayForBbing; room.currentBet = newTotalBetAmountForBbing;
                player.currentRoundBet = newTotalBetAmountForBbing; room.lastBettingPlayer = playerId; room.lastActionPlayerId = playerId;
                player.hasActedInBettingRound = true;
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'bet', amount: newTotalBetAmountForBbing, message: `${player.name}이(가) ${newTotalBetAmountForBbing} 칩으로 삥을 걸었습니다.` });
                break;

            case 'call':
                const myCurrentRoundBetForCall = player.currentRoundBet;
                const chipsNeededToMatch = room.currentBet - myCurrentRoundBetForCall;

                if (room.currentBet === 0) {
                    if (chipsNeededToMatch !== 0) { warnDebug('[GameService]', `방 ${roomId} Player ${playerId} - currentBet이 0인데 콜 요청 시 chipsNeededToMatch가 0이 아님. 액션 불가.`); return { success: false, message: '베팅 금액이 0일 때는 콜할 칩이 없습니다.' }; } // ✨ FIX: 태그 추가
                    this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'check', message: `${player.name}이(가) 콜(0)했습니다.` });
                    room.lastActionPlayerId = playerId; player.hasActedInBettingRound = true;
                    break;
                }

                let chipsActuallyPaidForCall = 0;

                if (chipsNeededToMatch <= 0) { return { success: false, message: '콜할 필요가 없습니다. 체크하거나 레이즈하세요.' }; }
                else if (chipsNeededToMatch > player.chips) {
                    chipsActuallyPaidForCall = player.chips; player.chips = 0; room.pot += chipsActuallyPaidForCall;
                    player.currentRoundBet += chipsActuallyPaidForCall;
                    this.io.to(`room-${roomId}`).emit('playerAction', {
                        playerId, actionType: 'allIn', amount: chipsActuallyPaidForCall,
                        message: `${player.name}이(가) ${chipsActuallyPaidForCall} 칩으로 올인했습니다! (총 베팅: ${player.currentRoundBet})`
                    });
                    room.lastBettingPlayer = playerId;
                } else {
                    chipsActuallyPaidForCall = chipsNeededToMatch; player.chips -= chipsActuallyPaidForCall; room.pot += chipsActuallyPaidForCall;
                    player.currentRoundBet = room.currentBet;
                    this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'call', amount: chipsActuallyPaidForCall, message: `${player.name}이(가) ${chipsActuallyPaidForCall} 칩으로 콜했습니다.` });
                    room.lastBettingPlayer = playerId;
                }
                player.hasActedInBettingRound = true; room.lastActionPlayerId = playerId;
                break;

            case 'raise':
                const myCurrentRoundBetForRaise = player.currentRoundBet;
                let actualChipsToPayForRaise = 0;
                let newRoomCurrentBetForRaise = 0;

                if (room.currentBet === 0) {
                    if (amount < room.betAmount) { return { success: false, message: `유효하지 않은 레이즈 금액입니다. 총 ${room.betAmount} 칩 이상을 베팅해야 합니다.` }; }
                    newRoomCurrentBetForRaise = amount; actualChipsToPayForRaise = amount - myCurrentRoundBetForRaise;
                } else {
                    const minRaiseAmountTotal = room.currentBet + room.betAmount;
                    if (amount < minRaiseAmountTotal) { return { success: false, message: `유효하지 않은 레이즈 금액입니다. 총 ${minRaiseAmountTotal} 칩 이상을 베팅해야 합니다.` }; }
                    newRoomCurrentBetForRaise = amount; actualChipsToPayForRaise = amount - myCurrentRoundBetForRaise;
                }

                if (actualChipsToPayForRaise <= 0) { return { success: false, message: '레이즈 금액이 유효하지 않습니다. 현재 베팅액보다 높아야 합니다.' }; }
                if (actualChipsToPayForRaise > player.chips) { return { success: false, message: '칩이 부족하여 레이즈할 수 없습니다. 콜 또는 다이하세요.' }; }

                player.chips -= actualChipsToPayForRaise; room.pot += actualChipsToPayForRaise; room.currentBet = newRoomCurrentBetForRaise;
                player.currentRoundBet = newRoomCurrentBetForRaise; room.lastBettingPlayer = playerId; room.lastActionPlayerId = playerId;
                player.hasActedInBettingRound = true;
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'raise', amount: amount, message: `${player.name}이(가) ${amount} 칩으로 레이즈했습니다.` });
                break;

            case 'die':
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'die', message: `${player.name}이(가) 다이를 선언했습니다.` });
                player.folded = true; player.status = 'folded'; room.lastActionPlayerId = playerId;
                player.hasActedInBettingRound = true;
                break;

            default:
                warnDebug('[GameService]', `알 수 없는 액션 타입: ${actionType}`); // ✨ FIX: 태그 추가
                return { success: false, message: '알 수 없는 액션입니다.' };
        }

        this.advanceTurn(roomId);
        return { success: true };
    }

    handleCardExchange(roomId, playerId, cardsToExchange) {
        const room = this.rooms[roomId];

        if (!room) { return { success: false, message: '방 정보를 찾을 수 없습니다.' }; }
        if (room.currentTurnPlayerId !== playerId) { warnDebug('[GameService]', `잘못된 턴 카드 교환 요청: Player ${playerId}, Room ${roomId}`); return { success: false, message: '지금은 당신의 턴이 아닙니다.' }; } // ✨ FIX: 태그 추가
        if (room.currentPhase !== 'exchange') { return { success: false, message: '지금은 카드 교환 페이즈가 아닙니다.' }; }
        if (room.currentExchangeOpportunityIndex === -1 || room.currentExchangeOpportunityIndex >= this.maxExchangeOpportunities) { return { success: false, message: '현재 라운드에는 카드를 교환할 수 없습니다.' }; }
        const player = room.players.find(p => p.id === playerId);
        if (!player) { return { success: false, message: '플레이어를 찾을 수 없습니다.' }; }
        if (!player.canExchange) { return { success: false, message: '이번 라운드에 카드를 교환할 수 없습니다.' }; }
        if (player.folded) { return { success: false, message: '폴드된 플레이어는 카드를 교환할 수 없습니다.' }; }

        if (!Array.isArray(cardsToExchange) || cardsToExchange.length < 0 || cardsToExchange.length > 4) { return { success: false, message: '교환할 카드는 0~4장만 선택할 수 있습니다.' }; }

        if (cardsToExchange.length === 0) {
            player.canExchange = false;
            this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'stay', message: `${player.name}이(가) 스테이했습니다.` });
            room.lastActionPlayerId = playerId;
            this.advanceTurn(roomId);
            return { success: true };
        }

        const playerHand = room.hands[playerId];
        if (!playerHand) { return { success: false, message: '플레이어의 패를 찾을 수 없습니다.' }; }

        const idsToExchangeSet = new Set(cardsToExchange);
        const actualCardsToExchange = playerHand.filter(card => idsToExchangeSet.has(card.id));
        if (actualCardsToExchange.length !== cardsToExchange.length) { return { success: false, message: '교환하려는 카드 중 일부가 패에 존재하지 않습니다.' }; }

        const newHand = playerHand.filter(card => !idsToExchangeSet.has(card.id));

        const cardsDrawn = [];
        for (let i = 0; i < cardsToExchange.length; i++) {
            const newCard = this.drawCard(roomId);
            if (newCard) {
                newHand.push(newCard); cardsDrawn.push(newCard);
            } else {
                errorDebug('[GameService]', `방 ${roomId} 덱이 비어 카드 드로우 실패. 카드 교환 중단.`); // ✨ FIX: 태그 추가
                return { success: false, message: '덱이 비어 카드를 교환할 수 없습니다.' };
            }
        }

        if (newHand.length !== 4) {
            errorDebug('[GameService]', `카드 교환 후 패의 길이가 4장이 아닙니다! 현재 길이: ${newHand.length}, playerId: ${playerId}, roomId: ${roomId}`); // ✨ FIX: 태그 추가
            return { success: false, message: '카드 교환 후 패가 올바르지 않습니다.' };
        }

        room.hands[playerId] = newHand; player.canExchange = false;
        player.bestHand = evaluateBadugiHand(newHand);
        logDebug('[GameService]', `User ${player.name} (ID: ${playerId}) 카드 교환 완료. 새로운 패: ${newHand.map(c => `${c.suit}${c.rank}`).join(', ')}`); // ✨ FIX: 태그 추가

        this.io.to(`room-${roomId}`).emit('playerAction', {
            playerId, actionType: 'exchange', count: cardsToExchange.length,
            message: `${player.name}이(가) ${cardsToExchange.length}장 교환했습니다.`,
        });
        this.io.to(player.socketId).emit('myHandUpdated', { hand: newHand, bestHand: player.bestHand });

        room.lastActionPlayerId = playerId;
        this.advanceTurn(roomId);
        return { success: true };
    }

    showdown(roomId, forceWinner = false) {
        const room = this.rooms[roomId];
        if (!room) { errorDebug('[GameService]', `showdown 실패: 방 ${roomId}를 찾을 수 없습니다.`); return; } // ✨ FIX: 태그 추가

        room.status = 'showdown';
        logDebug('[GameService]', `방 ${roomId} 쇼다운 시작!`); // ✨ FIX: 태그 추가

        let eligiblePlayers = room.players.filter(p => !p.folded && !p.leaveReserved);

        if (forceWinner && eligiblePlayers.length === 1) {
            const winner = eligiblePlayers[0];
            winner.chips += room.pot; room.pot = 0; room.status = 'ended';
            logDebug('[GameService]', `방 ${roomId} 강제 종료. 승자: User ${winner.name} (ID: ${winner.id})`); // ✨ FIX: 태그 추가
            this.io.to(`room-${roomId}`).emit('gameEnded', {
                roomStatus: room.status, winnerIds: [winner.id], winnerNames: [winner.name],
                reason: '모든 상대방이 다이하거나 퇴장하여 승리', finalHands: room.hands,
                finalPlayers: room.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, bestHand: p.bestHand, isCreator: p.isCreator, folded: p.folded, status: p.status }))
            });
            this.cleanupRoomAfterGame(roomId);
            return;
        }

        if (eligiblePlayers.length > 1) {
            const playerHandsToCompare = eligiblePlayers.map(p => ({
                playerId: p.id, hand: room.hands[p.id], bestHand: p.bestHand
            }));

            const winners = compareBadugiHands(playerHandsToCompare);

            if (winners.length > 0) {
                const winnerIds = winners.map(w => w.playerId);
                const winnerNames = winnerIds.map(id => room.players.find(p => p.id === id)?.name || `Unknown User (${id})`);

                let prizePerWinner = Math.floor(room.pot / winners.length);
                let remainder = room.pot % winners.length;

                winners.forEach((winner, idx) => {
                    const player = room.players.find(p => p.id === winner.playerId);
                    if (player) { player.chips += prizePerWinner + (idx < remainder ? 1 : 0); }
                });
                room.pot = 0; room.status = 'ended';
                logDebug('[GameService]', `방 ${roomId} 쇼다운 승자: ${winnerNames.join(', ')} (ID: ${winnerIds.join(', ')})`); // ✨ FIX: 태그 추가

                const finalHandsToShow = {};
                room.players.forEach(p => {
                    if (!p.folded || winnerIds.includes(p.id)) { finalHandsToShow[p.id] = room.hands[p.id]; }
                });

                this.io.to(`room-${roomId}`).emit('gameEnded', {
                    roomStatus: room.status, winnerIds: winnerIds, winnerNames: winnerNames,
                    winningHands: winners.map(w => ({ playerId: w.playerId, hand: room.hands[w.playerId], bestHand: w.bestHand })),
                    finalHands: finalHandsToShow,
                    finalPlayers: room.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, bestHand: p.bestHand, isCreator: p.isCreator, folded: p.folded, status: p.status }))
                });
            } else {
                errorDebug('[GameService]', `방 ${roomId} 쇼다운에서 승자를 찾을 수 없습니다. (오류)`); // ✨ FIX: 태그 추가
                room.status = 'ended';
                this.io.to(`room-${roomId}`).emit('gameEnded', { roomStatus: room.status, reason: '승자를 찾을 수 없습니다. (오류)' });
            }
        } else {
            room.status = 'ended';
            this.io.to(`room-${roomId}`).emit('gameEnded', { roomStatus: room.status, reason: '모든 플레이어가 게임에서 퇴장했습니다.' });
        }
        this.cleanupRoomAfterGame(roomId);
        this.io.to(`room-${roomId}`).emit('roomUpdated', room);
    }

    cleanupRoomAfterGame(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;

        this.clearTurnTimer(roomId);

        room.status = 'waiting'; room.currentBettingRoundIndex = 0; room.currentExchangeOpportunityIndex = -1;
        room.gameRoundName = '대기 중'; room.pot = 0; room.currentBet = 0; room.lastBettingPlayer = null;
        room.currentPhase = 'waiting'; room.dealerIndex = -1; room.dealerId = -1; room.smallBlindId = -1;
        room.bigBlindId = -1; room.lastActionPlayerId = null; room.timerProcessingLock = false;
        room.turnIndexAtRoundStart = null;

        room.players = room.players.filter(player => {
            if (player.leaveReserved) {
                logDebug('[GameService]', `게임 종료 후 퇴장 예약된 User ${player.name} (ID: ${player.id}) 방 ${roomId}에서 제거.`); // ✨ FIX: 태그 추가
                this.io.to(player.socketId).emit('forceLeaveRoom', { roomId: roomId, message: '게임이 종료되어 방에서 나갑니다.' });
                return false;
            }
            player.currentRoundBet = 0; player.folded = false; player.status = 'waiting';
            player.bestHand = null; player.canExchange = false; player.hasActedInBettingRound = false;
            return true;
        });

        if (room.players.length === 0) {
            delete this.rooms[roomId];
            logDebug('[GameService]', `게임 종료 후 빈 방 ${roomId} 삭제.`); // ✨ FIX: 태그 추가
        } else {
            if (!room.players.some(p => p.id === room.creatorId)) {
                if (room.players.length > 0) {
                    room.creatorId = room.players[0].id;
                    room.players[0].isCreator = true;
                    logDebug('[GameService]', `게임 종료 후 방장 위임: 방 ${roomId}의 새로운 방장은 User ${room.players[0].name} (ID: ${room.players[0].id})`); // ✨ FIX: 태그 추가
                } else {
                    delete this.rooms[roomId];
                    logDebug('[GameService]', `게임 종료 후 방장 없는 빈 방 ${roomId} 삭제.`); // ✨ FIX: 태그 추가
                }
            }
        }
        logDebug('[GameService]', `방 ${roomId} 게임 종료 후 정리 완료.`); // ✨ FIX: 태그 추가
    }

    startTurnTimer(roomId, playerId) {
        this.clearTurnTimer(roomId);

        let timeLeft = this.turnTimeLimit;
        const timerInterval = setInterval(() => {
            timeLeft--;
            this.io.to(`room-${roomId}`).emit('timerUpdate', { timeLeft: timeLeft, currentPlayerId: playerId });

            if (timeLeft <= 0) {
                this.clearTurnTimer(roomId);
                this.handleTimerTimeout(roomId, playerId);
            }
        }, 1000);

        this.turnTimers[roomId] = {
            interval: timerInterval,
            timeout: setTimeout(() => {
                this.clearTurnTimer(roomId);
                this.handleTimerTimeout(roomId, playerId);
            }, this.turnTimeLimit * 1000 + 500)
        };
        logDebug('[GameService]', `방 ${roomId} 턴 타이머 시작. 플레이어: ${playerId}, 시간: ${this.turnTimeLimit}초`); // ✨ FIX: 태그 추가
    }

    clearTurnTimer(roomId) {
        if (this.turnTimers[roomId]) {
            clearInterval(this.turnTimers[roomId].interval);
            clearTimeout(this.turnTimers[roomId].timeout);
            delete this.turnTimers[roomId];
            logDebug('[GameService]', `방 ${roomId} 턴 타이머 클리어.`); // ✨ FIX: 태그 추가
        }
    }

    handleTimerTimeout(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room) { warnDebug('[GameService]', `타이머 만료 시 방 ${roomId}를 찾을 수 없습니다.`); return; } // ✨ FIX: 태그 추가
        if (room.currentTurnPlayerId !== playerId) { warnDebug('[GameService]', `타이머 만료 시점 플레이어 불일치. 현재 턴: ${room.currentTurnPlayerId}, 만료된 플레이어: ${playerId}`); return; } // ✨ FIX: 태그 추가

        if (room.timerProcessingLock) { warnDebug('[GameService]', `방 ${roomId} 타이머 처리 락 활성화 중. 중복 처리 요청 무시.`); return; } // ✨ FIX: 태그 추가
        room.timerProcessingLock = true;

        let result;
        if (room.currentPhase === 'exchange') {
            logDebug('[GameService]', `방 ${roomId} 플레이어 ${playerId} 턴 시간 만료! 자동 스테이 처리.`); // ✨ FIX: 태그 추가
            result = this.handleCardExchange(roomId, playerId, []);
            if (!result.success) { errorDebug('[GameService]', `타이머 만료 후 자동 스테이 처리 실패: ${result.message}`); } // ✨ FIX: 태그 추가
            else {
                this.io.to(`room-${roomId}`).emit('playerAction', {
                    playerId, actionType: 'autoStay',
                    message: `${room.players.find(p => p.id === playerId)?.name}이(가) 시간 만료로 자동 스테이했습니다.`
                });
            }
        } else {
            logDebug('[GameService]', `방 ${roomId} 플레이어 ${playerId} 턴 시간 만료! 자동 다이 처리.`); // ✨ FIX: 태그 추가
            result = this.handleBettingAction(roomId, playerId, 'die', 0);
            if (!result.success) { errorDebug('[GameService]', `타이머 만료 후 자동 다이 처리 실패: ${result.message}`); } // ✨ FIX: 태그 추가
            else {
                this.io.to(`room-${roomId}`).emit('playerAction', {
                    playerId, actionType: 'autoDie',
                    message: `${room.players.find(p => p.id === playerId)?.name}이(가) 시간 만료로 자동 다이했습니다.`
                });
            }
        }

        room.timerProcessingLock = false;
    }
}

export { GameService };