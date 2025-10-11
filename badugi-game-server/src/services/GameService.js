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

        this.bettingRoundNames = ['아침', '점심', '저녁', '최종']; // 4개의 베팅 라운드 이름
        this.maxBettingRounds = this.bettingRoundNames.length; // 총 베팅 라운드 수 (0, 1, 2, 3)
        this.maxExchangeOpportunities = this.maxBettingRounds - 1; // 총 카드 교환 기회 수 (3번)

        this.decks = {};

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
    }

    startGame(roomId) {
        const room = this.rooms[roomId];
        if (!room) { errorDebug(`[GameService] 게임 시작 실패: 방 ${roomId}를 찾을 수 없습니다.`); return false; }
        if (room.status !== 'waiting') { warnDebug(`[GameService] 게임 시작 실패: 방 ${roomId}는 이미 ${room.status} 상태입니다.`); return false; }
        if (room.players.length < 2) { warnDebug(`[GameService] 게임 시작 실패: 방 ${roomId}에 최소 2명 이상의 플레이어가 필요합니다.`); return false; }

        room.status = 'playing';
        room.currentBettingRoundIndex = 0; // 현재 베팅 라운드 인덱스 (0: 아침)
        room.currentExchangeOpportunityIndex = -1; // 초기에는 교환 기회 없음
        room.gameRoundName = this.bettingRoundNames[room.currentBettingRoundIndex]; // 현재 베팅 라운드 이름
        room.pot = 0;
        room.currentBet = room.betAmount; // 초기 베팅액은 방 설정 베팅액 (안테로 간주)
        room.activePlayers = room.players.filter(p => !p.leaveReserved).map(p => p.id);
        room.lastBettingPlayer = null;
        room.hands = {};
        room.discardPiles = {};
        room.currentTurnPlayerId = null;
        room.currentPhase = 'betting'; // 게임 시작 시 초기 페이즈는 'betting'

        // 칩 부족 플레이어 확인 및 처리 (최초 안테 지불 전)
        const playersWithInsufficientChips = room.players.filter(player => player.chips < room.betAmount);
        if (playersWithInsufficientChips.length > 0) {
            errorDebug(`[GameService] 방 ${roomId} 칩 부족으로 게임 시작 불가. 다음 플레이어들: ${playersWithInsufficientChips.map(p => p.name).join(', ')} (필요 칩: ${room.betAmount})`);
            room.status = 'waiting';
            this.io.to(`room-${roomId}`).emit('gameError', { message: '일부 플레이어의 칩이 부족하여 게임을 시작할 수 없습니다.' });
            return false;
        }

        room.players.forEach(player => {
            player.chips -= room.betAmount;     // 칩 차감 (최초 안테)
            room.pot += room.betAmount;         // 팟에 추가
            player.currentRoundBet = room.betAmount; // 현재 라운드 베팅액에 기본금 포함
            player.folded = false;
            player.status = 'playing';
            player.bestHand = null;
            player.canExchange = false; // 아침 라운드 교환 불가
            player.hasActedInBettingRound = false;
            player.leaveReserved = false;
        });
        logDebug(`[GameService] 방 ${roomId} 모든 플레이어 기본금 ${room.betAmount} 칩 지불 완료. 현재 팟: ${room.pot}`);

        // ✨ 딜러, 스몰 블라인드, 빅 블라인드 설정 (블라인드 베팅은 없지만 역할 표시는 필요)
        // 방장부터 시작하고, 딜러는 방장의 오른쪽.
        const creatorPlayerIndex = room.players.findIndex(p => p.id === room.creatorId);
        if (creatorPlayerIndex === -1) {
            errorDebug(`[GameService] 방 ${roomId}에서 방장(ID: ${room.creatorId})을 찾을 수 없습니다.`);
            room.status = 'waiting';
            return false;
        }

        // 딜러 위치 설정 (랜덤 또는 이전 라운드 딜러의 다음)
        // 현재는 첫 게임이므로 방장 다음을 딜러로 시작 (방장의 오른쪽)
        room.dealerIndex = (creatorPlayerIndex - 1 + room.players.length) % room.players.length;
        room.dealerId = room.players[room.dealerIndex].id;

        // 스몰 블라인드 (딜러 왼쪽)
        const smallBlindIndex = (room.dealerIndex + 1) % room.players.length;
        room.smallBlindId = room.players[smallBlindIndex].id;

        // 빅 블라인드 (스몰 블라인드 왼쪽)
        const bigBlindIndex = (smallBlindIndex + 1) % room.players.length;
        room.bigBlindId = room.players[bigBlindIndex].id;

        // 첫 턴은 방장부터 시작
        room.turnIndex = creatorPlayerIndex;
        room.currentTurnPlayerId = room.creatorId;

        logDebug(`[GameService] 방 ${roomId} 게임 시작. 딜러: ${room.players[room.dealerIndex].name}, SB: ${room.players[smallBlindIndex].name}, BB: ${room.players[bigBlindIndex].name}. 첫 턴: User ${room.players[room.turnIndex].name} (ID: ${room.currentTurnPlayerId})`);

        // 덱 생성 및 패 분배
        const newDeck = shuffleDeck(createDeck());
        this.decks[roomId] = newDeck;
        room.players.forEach(player => {
            const hand = []; for (let i = 0; i < 4; i++) hand.push(this.drawCard(roomId));
            room.hands[player.id] = hand;
            player.bestHand = evaluateBadugiHand(room.hands[player.id]);
            logDebug(`[GameService] User ${player.name} (ID: ${player.id}) 초기 패 분배 완료: ${hand.map(c => `${c.suit}${c.rank}`).join(', ')}, 족보: ${player.bestHand.rank}`);
        });

        // 클라이언트에게 게임 시작 정보 전송
        room.players.forEach(player => {
            const roomForClient = { ...room, hands: {} }; // hands는 개인 정보이므로 전송하지 않음
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
                dealerId: room.dealerId, // ✨ 역할 ID 전송
                smallBlindId: room.smallBlindId, // ✨ 역할 ID 전송
                bigBlindId: room.bigBlindId // ✨ 역할 ID 전송
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
     * ➡️ 턴을 진행하거나 페이즈/라운드를 전환합니다.
     * @param {number} roomId - 턴을 진행할 방의 ID
     * @returns {boolean} 성공 여부 (true: 턴/페이즈 전환 성공, false: 정지 또는 오류)
     */
    advanceTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room) { errorDebug(`[GameService] advanceTurn 실패: 방 ${roomId}를 찾을 수 없습니다.`); return false; }

        let currentTurnIndex = room.turnIndex;
        const activePlayersInRound = room.players.filter(p => !p.folded && !p.leaveReserved);

        // 1. 활성 플레이어가 1명 이하이면 게임 즉시 종료 (강제 승리)
        if (activePlayersInRound.length <= 1) {
            logDebug(`[GameService] 방 ${roomId} 활성 플레이어 1명 이하. 게임 즉시 종료.`);
            this.showdown(roomId, true);
            return false;
        }

        // --- Phase Completion Check ---
        let phaseCompleted = false;
        if (room.currentPhase === 'betting') {
            const allPlayersCalledOrChecked = activePlayersInRound.every(p => p.currentRoundBet === room.currentBet);
            const allPlayersActedOnce = activePlayersInRound.every(p => p.hasActedInBettingRound); // '첵'도 액션으로 간주

            // 베팅 라운드 완료 조건:
            // 1. 모든 활성 플레이어가 현재 베팅액에 콜하거나 체크했을 때
            // 2. 그리고 (누군가 베팅/레이즈를 했다면 마지막 베팅 플레이어에게 턴이 돌아왔을 때 OR 아무도 레이즈하지 않고 모두 '첵'을 했을 때)

            // `currentBet`이 `room.betAmount` (최초 안테) 보다 크다면 누군가 '삥' 또는 '레이즈'를 한 경우
            if (room.currentBet > room.betAmount) {
                if (allPlayersCalledOrChecked && room.currentTurnPlayerId === room.lastBettingPlayer && room.lastBettingPlayer !== null) {
                    phaseCompleted = true;
                }
            } else { // `currentBet`이 `room.betAmount`와 같거나 0인 경우 (최초 안테만 냈거나, 모두 체크만 한 경우)
                if (allPlayersCalledOrChecked && allPlayersActedOnce) {
                    phaseCompleted = true;
                }
            }

            if (phaseCompleted) {
                logDebug(`[GameService] 방 ${roomId} 베팅 페이즈 완료 (베팅 라운드 ${room.currentBettingRoundIndex}).`);
                return this.handlePhaseTransitionAfterBetting(roomId);
            }
        } else if (room.currentPhase === 'exchange') {
            const allPlayersExchangedOrStayed = activePlayersInRound.every(p => !p.canExchange);
            if (allPlayersExchangedOrStayed) {
                phaseCompleted = true;
            }

            if (phaseCompleted) {
                logDebug(`[GameService] 방 ${roomId} 교환 페이즈 완료 (기회 ${room.currentExchangeOpportunityIndex}).`);
                return this.handlePhaseTransitionAfterExchange(roomId);
            }
        }
        // --- End Phase Completion Check ---

        // --- Advance Turn (if phase not completed) ---
        let nextTurnPlayerFound = false;
        let loopCount = 0;
        const numPlayers = room.players.length;
        const initialTurnPlayerId = room.currentTurnPlayerId;

        // 턴 진행 루프 (모두가 폴드/교환 완료했거나 다음 액션 플레이어를 찾을 때까지)
        do {
            currentTurnIndex = (currentTurnIndex + 1) % numPlayers;
            const nextPlayer = room.players[currentTurnIndex];

            // 턴이 한 바퀴 돌아 현재 플레이어에게 다시 왔는데, 아직 다음 턴 플레이어를 찾지 못했다면 정지
            if (nextPlayer.id === initialTurnPlayerId && loopCount > 0) {
                warnDebug(`[GameService] 방 ${roomId} 턴 진행 중 다음 액션 플레이어를 찾지 못하고 한 바퀴 돌았습니다. (모두 액션했거나 폴드/퇴장 예상)`);
                // 이 경우, phaseCompleted가 true여야 하지만 false라면 논리 오류.
                // 강제 쇼다운으로 게임을 비상 종료
                this.showdown(roomId, true);
                return false;
            }

            // 활성 플레이어이며, 퇴장 예약도 아닌지 확인
            if (!nextPlayer.folded && !nextPlayer.leaveReserved) {
                // 현재 교환 페이즈이고, 이 플레이어가 이미 교환 액션을 완료했다면 스킵
                if (room.currentPhase === 'exchange' && !nextPlayer.canExchange) {
                    logDebug(`[GameService] Player ${nextPlayer.name} (ID: ${nextPlayer.id})는 이미 교환 완료. 턴 스킵.`);
                } else {
                    // 이 플레이어가 액션해야 함
                    room.turnIndex = currentTurnIndex;
                    room.currentTurnPlayerId = nextPlayer.id;
                    nextTurnPlayerFound = true;
                    logDebug(`[GameService] 방 ${roomId} 다음 턴: User ${nextPlayer.name} (ID: ${nextPlayer.id})`);
                    this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: 30 });
                    this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 턴 변경 시 방 정보 업데이트
                    return true; // 턴 성공적으로 진행
                }
            }
            loopCount++;
        } while (!nextTurnPlayerFound && loopCount < numPlayers + 1); // 무한 루프 방지를 위해 최대 플레이어 수 + 1만큼만 루프

        // 루프를 빠져나왔는데도 다음 턴 플레이어를 찾지 못했다면 오류
        errorDebug(`[GameService] 방 ${roomId} 모든 플레이어 턴 순회 후 다음 액션 플레이어를 찾을 수 없습니다. (예상치 못한 정지) - 강제 종료`);
        this.showdown(roomId, true); // 비상 탈출: 강제 쇼다운
        return false;
    }

    /**
     * ➡️ 베팅 페이즈 완료 후 다음 페이즈로 전환 (교환 또는 쇼다운).
     * @param {number} roomId - 방 ID
     * @returns {boolean} 전환 성공 여부
     */
    handlePhaseTransitionAfterBetting(roomId) {
        const room = this.rooms[roomId];

        if (room.currentBettingRoundIndex < this.maxExchangeOpportunities) { // 교환 기회가 남아있다면
            room.currentPhase = 'exchange';
            room.currentExchangeOpportunityIndex = room.currentBettingRoundIndex; // 예: 0, 1, 2 (총 3번)

            room.players.forEach(p => {
                if (!p.folded && !p.leaveReserved) {
                    p.canExchange = true; // 모든 활성 플레이어에게 카드 교환 기회 부여
                }
            });

            // 베팅 관련 플래그 초기화 (다음 베팅 라운드까지는 베팅 페이즈가 아니므로)
            room.lastBettingPlayer = null;
            room.players.forEach(p => p.hasActedInBettingRound = false);
            // room.currentBet은 베팅 페이즈 종료 시점의 금액을 유지
            // room.currentRoundBet은 각 플레이어의 베팅액을 초기화하여 다음 베팅 라운드 준비
            room.players.forEach(p => p.currentRoundBet = 0);

            logDebug(`[GameService] 방 ${roomId} ${this.bettingRoundNames[room.currentBettingRoundIndex]} 라운드의 ${room.currentExchangeOpportunityIndex + 1}번째 교환 페이즈 시작.`);
            this.io.to(`room-${roomId}`).emit('phaseChanged', {
                currentBettingRoundIndex: room.currentBettingRoundIndex,
                currentExchangeOpportunityIndex: room.currentExchangeOpportunityIndex,
                gameRoundName: this.bettingRoundNames[room.currentBettingRoundIndex], // 이 교환은 이 베팅 라운드 이름으로 진행
                currentPhase: room.currentPhase,
                pot: room.pot, // 팟은 누적된 상태 유지
                currentBet: 0, // ✅ 수정: 교환 페이즈 시작 시 currentBet을 0으로 초기화
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });

            // 턴은 딜러 다음 플레이어부터 시작 (새 페이즈 시작)
            room.turnIndex = (room.dealerIndex + 1) % room.players.length;
            room.currentTurnPlayerId = room.players[room.turnIndex].id;
            this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: 30 });
            this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 방 정보 업데이트
            return true;
        } else { // 더 이상 교환 기회가 없다면 쇼다운으로 진행 (마지막 베팅 라운드 후)
            logDebug(`[GameService] 방 ${roomId} 모든 교환 기회 종료. 쇼다운으로 이동.`);
            this.showdown(roomId, false);
            return false;
        }
    }

    /**
     * ➡️ 교환 페이즈 완료 후 다음 페이즈로 전환 (다음 베팅 라운드 또는 쇼다운).
     * @param {number} roomId - 방 ID
     * @returns {boolean} 전환 성공 여부
     */
    handlePhaseTransitionAfterExchange(roomId) {
        const room = this.rooms[roomId];
        room.currentBettingRoundIndex++; // 다음 베팅 라운드 인덱스 증가

        if (room.currentBettingRoundIndex < this.maxBettingRounds) { // 다음 베팅 라운드가 있다면
            room.gameRoundName = this.bettingRoundNames[room.currentBettingRoundIndex];
            room.currentPhase = 'betting'; // 다음 페이즈는 'betting'

            // 새로운 베팅 라운드를 위한 초기화 (팟은 누적)
            room.currentBet = 0; // ✅ 수정: 새로운 베팅 라운드 시작 시 currentBet을 0으로 초기화
            room.lastBettingPlayer = null;
            room.players.forEach(p => {
                p.currentRoundBet = 0; // 각 플레이어의 현재 라운드 베팅액 초기화
                p.hasActedInBettingRound = false; // 베팅 액션 여부 리셋
                p.canExchange = false; // 교환 페이즈가 아니므로 canExchange는 false로 유지
            });

            logDebug(`[GameService] 방 ${roomId} ${room.gameRoundName} 라운드의 베팅 페이즈 시작.`);
            this.io.to(`room-${roomId}`).emit('roundStarted', { // roundStarted 이벤트를 사용하여 새 베팅 라운드 시작을 알림
                currentBettingRoundIndex: room.currentBettingRoundIndex,
                currentExchangeOpportunityIndex: room.currentExchangeOpportunityIndex, // 교환 기회 인덱스는 이전 값 유지 (이전 교환 기회)
                gameRoundName: room.gameRoundName,
                currentPhase: room.currentPhase,
                pot: room.pot, // 팟은 누적된 상태 유지
                currentBet: room.currentBet, // 새로운 베팅 라운드의 초기 베팅액 (0)
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });

            // 턴은 딜러 다음 플레이어부터 시작 (새 페이즈 시작)
            room.turnIndex = (room.dealerIndex + 1) % room.players.length;
            room.currentTurnPlayerId = room.players[room.turnIndex].id;
            this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: 30 });
            this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 방 정보 업데이트
            return true;
        } else { // 모든 베팅 라운드가 끝났다면 (즉, 마지막 교환 후 다음 베팅 라운드가 없는 경우)
            logDebug(`[GameService] 방 ${roomId} 모든 베팅 라운드가 끝났습니다. 쇼다운으로 이동.`);
            this.showdown(roomId, false);
            return false;
        }
    }


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
                if (room.currentBet > player.currentRoundBet) { // 현재 베팅액이 내 베팅액보다 높으면 체크 불가
                    return { success: false, message: '체크할 수 없습니다. 베팅 금액을 맞춰야 합니다.' };
                }
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'check', message: `${player.name}이(가) 체크했습니다.` });
                break;

            case 'bet': // '삥' (클라이언트에서 보내는 amount는 방의 기본 베팅액)
                if (amount !== room.betAmount) {
                    return { success: false, message: `'삥' 액션은 ${room.betAmount} 칩으로만 시작할 수 있습니다.` };
                }

                const myCurrentRoundBet = player.currentRoundBet;
                let chipsToPay = 0;
                let newTotalBetAmount = 0;

                // 시나리오 1: 현재 베팅액이 0인 경우 (이 라운드에서 아무도 베팅하지 않은 첫 액션)
                if (room.currentBet === 0) {
                    newTotalBetAmount = room.betAmount; // 총 베팅액을 방의 기본 베팅액으로 설정
                    chipsToPay = newTotalBetAmount - myCurrentRoundBet; // 이 경우 myCurrentRoundBet도 0일 것
                }
                // 시나리오 2: 현재 베팅액이 방의 최소 베팅액과 같고, 내가 이미 그만큼 베팅한 경우 (안테만 낸 상태에서 첫 레이즈)
                else if (room.currentBet === room.betAmount && myCurrentRoundBet === room.betAmount) {
                    newTotalBetAmount = room.currentBet + room.betAmount; // 총 베팅액을 (현재 베팅액 + 방의 기본 베팅액)으로 설정 (최소 레이즈)
                    chipsToPay = newTotalBetAmount - myCurrentRoundBet; // 방의 기본 베팅액만큼 추가 지불
                }
                // 그 외의 경우 (누군가 이미 레이즈했거나, currentBet이 room.betAmount를 초과하는 경우) '삥' 액션 불가
                else {
                    return { success: false, message: '삥은 현재 베팅이 없거나 안테만 있는 경우에만 시작할 수 있습니다.' };
                }

                if (chipsToPay <= 0) {
                    return { success: false, message: '삥을 걸 필요가 없습니다. 체크 또는 레이즈하세요.' };
                }
                if (chipsToPay > player.chips) {
                    return { success: false, message: '칩이 부족하여 삥을 걸 수 없습니다.' };
                }

                player.chips -= chipsToPay;
                room.pot += chipsToPay;
                room.currentBet = newTotalBetAmount;
                player.currentRoundBet = newTotalBetAmount;
                room.lastBettingPlayer = playerId;
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'bet', amount: newTotalBetAmount, message: `${player.name}이(가) ${newTotalBetAmount} 칩으로 삥을 걸었습니다.` });
                break;

            case 'call':
                const amountToCall = room.currentBet - player.currentRoundBet;
                if (amountToCall <= 0) { // 콜할 필요 없음
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
                const minRaiseAmountTotal = room.currentBet + room.betAmount; // 최소 레이즈 총액
                if (amount < minRaiseAmountTotal) {
                    return { success: false, message: `유효하지 않은 레이즈 금액입니다. 총 ${minRaiseAmountTotal} 칩 이상을 베팅해야 합니다.` };
                }
                const amountToRaise = amount - player.currentRoundBet; // 실제로 칩에서 차감할 금액
                if (amountToRaise <= 0) { // 레이즈인데 추가 금액이 0이거나 음수
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
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'die', message: `${player.name}이(가) 다이를 선언했습니다.` });
                player.folded = true;
                player.status = 'folded';
                break;

            default:
                warnDebug(`[GameService] 알 수 없는 액션 타입: ${actionType}`);
                return { success: false, message: '알 수 없는 액션입니다.' };
        }

        this.advanceTurn(roomId);
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
        if (room.currentExchangeOpportunityIndex === -1 || room.currentExchangeOpportunityIndex >= this.maxExchangeOpportunities) {
            return { success: false, message: '현재 라운드에는 카드를 교환할 수 없습니다.' };
        }
        const player = room.players.find(p => p.id === playerId);
        if (!player) { return { success: false, message: '플레이어를 찾을 수 없습니다.' }; }
        if (!player.canExchange) {
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
            return { success: true };
        }

        const playerHand = room.hands[playerId];
        if (!playerHand) { return { success: false, message: '플레이어의 패를 찾을 수 없습니다.' }; }

        const idsToExchangeSet = new Set(cardsToExchange);
        const actualCardsToExchange = playerHand.filter(card => idsToExchangeSet.has(card.id));
        if (actualCardsToExchange.length !== cardsToExchange.length) {
            return { success: false, message: '교환하려는 카드 중 일부가 패에 존재하지 않습니다.' };
        }

        const newHand = playerHand.filter(card => !idsToExchangeSet.has(card.id));

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

        this.advanceTurn(roomId);
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
            room.status = 'ended';
            this.io.to(`room-${roomId}`).emit('gameEnded', { roomStatus: room.status, reason: '모든 플레이어가 게임에서 퇴장했습니다.' });
        }
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
        room.currentBettingRoundIndex = 0; // 초기화
        room.currentExchangeOpportunityIndex = -1; // 초기화
        room.gameRoundName = '대기 중';
        room.pot = 0;
        room.currentBet = 0;
        room.lastBettingPlayer = null;
        room.currentPhase = 'waiting'; // 페이즈도 초기화
        room.dealerId = -1; // 역할 ID 초기화
        room.smallBlindId = -1;
        room.bigBlindId = -1;

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
            player.canExchange = false; // canExchange 초기화
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