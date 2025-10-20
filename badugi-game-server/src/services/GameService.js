// badugi-game-server/src/services/GameService.js

// 🃏 카드 유틸리티 함수 임포트
import { createDeck, shuffleDeck, evaluateBadugiHand, compareBadugiHands } from '../utils/cards.js';
// ✍️ 서버 로깅 함수 임포트 (server.js에서 내보낸 함수들을 여기서 임포트하여 사용)
import { logDebug, warnDebug, errorDebug } from '../../logger.js';

/**
 * 🎮 바둑이 게임의 핵심 로직을 관리하는 서비스 클래스입니다.
 */
class GameService {
    constructor(io, rooms, turnTimeLimit) { // ✨ NEW: turnTimeLimit 인자 추가
        this.io = io;
        this.rooms = rooms;

        this.bettingRoundNames = ['아침', '점심', '저녁', '최종']; // 4개의 베팅 라운드 이름
        this.maxBettingRounds = this.bettingRoundNames.length; // 총 베팅 라운드 수 (0, 1, 2, 3)
        this.maxExchangeOpportunities = this.maxBettingRounds - 1; // 총 카드 교환 기회 수 (3번) (인덱스 0, 1, 2)

        this.decks = {};
        this.turnTimers = {}; // 각 방의 턴 타이머를 저장할 객체
        this.turnTimeLimit = turnTimeLimit || 30; // ✨ MODIFIED: constructor 인자로 받음 (기본값 30초)

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
        if (!room) { errorDebug(`[GameService] 게임 시작 실패: 방 ${roomId}를 찾을 수 없습니다.`); return false; }
        if (room.status !== 'waiting') { warnDebug(`[GameService] 게임 시작 실패: 방 ${roomId}는 이미 ${room.status} 상태입니다.`); return false; }
        if (room.players.length < 2) { warnDebug(`[GameService] 게임 시작 실패: 방 ${roomId}에 최소 2명 이상의 플레이어가 필요합니다.`); return false; }

        room.status = 'playing';
        room.currentBettingRoundIndex = 0; // 현재 베팅 라운드 인덱스 (0: 아침)
        room.currentExchangeOpportunityIndex = -1; // 초기에는 교환 기회 없음
        room.gameRoundName = this.bettingRoundNames[room.currentBettingRoundIndex]; // 현재 베팅 라운드 이름
        room.pot = 0;
        room.currentBet = 0; // 게임 시작 시 현재 베팅액 0으로 초기화
        room.activePlayers = room.players.filter(p => !p.leaveReserved).map(p => p.id); // 현재 라운드 참여 가능한 플레이어 ID 목록

        room.lastBettingPlayer = null; // 마지막 베팅(삥/레이즈) 플레이어 ID
        room.hands = {};
        room.discardPiles = {};
        room.currentTurnPlayerId = null;
        room.currentPhase = 'betting'; // 게임 시작 시 초기 페이즈는 'betting'
        room.lastActionPlayerId = null; // 마지막 액션 플레이어 ID 초기화
        room.timerProcessingLock = false; // 타이머 처리 중복 방지 락
        room.turnIndexAtRoundStart = null; // 각 라운드 시작 시 첫 턴 플레이어 인덱스

        // 칩 부족 플레이어 확인 및 처리 (최초 안테 지불 전)
        const playersWithInsufficientChips = room.players.filter(player => player.chips < room.betAmount);
        if (playersWithInsufficientChips.length > 0) {
            errorDebug(`[GameService] 방 ${roomId} 칩 부족으로 게임 시작 불가. 다음 플레이어들: ${playersWithInsufficientChips.map(p => p.name).join(', ')} (필요 칩: ${room.betAmount})`);
            room.status = 'waiting';
            this.io.to(`room-${roomId}`).emit('gameError', { message: '일부 플레이어의 칩이 부족하여 게임을 시작할 수 없습니다.' });
            return false;
        }

        // 모든 플레이어에게 안테 징수 및 상태 초기화
        room.players.forEach(player => {
            player.chips -= room.betAmount;     // 칩 차감 (최초 안테)
            room.pot += room.betAmount;         // 팟에 추가
            player.currentRoundBet = 0; // 베팅 페이즈 시작 시 플레이어의 베팅액 0으로 초기화
            player.folded = false;
            player.status = 'playing';
            player.bestHand = null;
            player.canExchange = false; // 아침 라운드 교환 불가
            player.hasActedInBettingRound = false; // 이번 베팅 라운드에서 액션 여부
            player.leaveReserved = false;
        });
        logDebug(`[GameService] 방 ${roomId} 모든 플레이어 기본금 ${room.betAmount} 칩 지불 완료. 현재 팟: ${room.pot}`);

        // 딜러 순환 규칙 (라운드 진행 시): 한 게임이 끝날 때마다 딜러가 오른쪽으로 한 칸 이동.
        // 첫 게임 시작 시에는 방장 다음 플레이어를 딜러로 설정합니다.
        const currentCreatorIndex = room.players.findIndex(p => p.id === room.creatorId);
        if (currentCreatorIndex === -1) {
            errorDebug(`[GameService] 방 ${roomId}에서 방장(ID: ${room.creatorId})을 찾을 수 없습니다. 게임 시작 불가.`);
            room.status = 'waiting';
            return false;
        }

        // 첫 게임의 딜러는 방장 다음 플레이어
        // 이후 라운드부터는 기존 딜러 다음 플레이어가 딜러가 됩니다.
        if (room.dealerIndex === undefined || room.dealerIndex === -1) { // 첫 게임
            room.dealerIndex = (currentCreatorIndex + 1) % room.players.length;
        } else { // 다음 라운드
            room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
        }
        room.dealerId = room.players[room.dealerIndex].id;

        // 스몰 블라인드 (딜러 왼쪽)
        const smallBlindIndex = (room.dealerIndex + 1) % room.players.length;
        room.smallBlindId = room.players[smallBlindIndex].id;

        // 빅 블라인드 (스몰 블라인드 왼쪽)
        const bigBlindIndex = (smallBlindIndex + 1) % room.players.length;
        room.bigBlindId = room.players[bigBlindIndex].id;

        // 첫 턴은 딜러 다음 플레이어부터 시작 (로우 바둑이 규칙)
        let initialTurnPlayerIndex = (room.dealerIndex + 1) % room.players.length;
        // 폴드되었거나 퇴장 예약된 플레이어는 스킵하고 다음 활성 플레이어를 찾습니다.
        let loopCount = 0;
        const numPlayers = room.players.length;
        while ((room.players[initialTurnPlayerIndex].folded || room.players[initialTurnPlayerIndex].leaveReserved) && loopCount < numPlayers) {
            initialTurnPlayerIndex = (initialTurnPlayerIndex + 1) % numPlayers;
            loopCount++;
        }
        if (loopCount === numPlayers) { // 모든 플레이어가 폴드 또는 퇴장 예약
            errorDebug(`[GameService] 방 ${roomId} 첫 턴 플레이어를 찾을 수 없어 게임 시작 불가. (모든 플레이어 비활성)`);
            room.status = 'waiting';
            return false;
        }

        room.turnIndex = initialTurnPlayerIndex;
        room.currentTurnPlayerId = room.players[room.turnIndex].id;
        room.lastActionPlayerId = room.currentTurnPlayerId; // 첫 턴 플레이어를 마지막 액션 플레이어로 설정
        room.turnIndexAtRoundStart = room.turnIndex; // 라운드 시작 시 첫 턴 플레이어 인덱스 저장

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
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });
        });

        this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
        this.startTurnTimer(roomId, room.currentTurnPlayerId); // 첫 턴 타이머 시작
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

        this.clearTurnTimer(roomId); // ✨ FIX: 이전 턴 타이머 클리어 (Symptom A 해결)

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
            const activePlayersInRound = room.players.filter(p => !p.folded && !p.leaveReserved);

            // 모든 활성 플레이어가 room.currentBet에 자신의 currentRoundBet을 맞췄는지 확인
            // (올인한 플레이어 포함: p.currentRoundBet === room.currentBet || (p.chips === 0 && p.currentRoundBet < room.currentBet))
            const allPlayersCalledOrChecked = activePlayersInRound.every(p =>
                p.currentRoundBet === room.currentBet || (p.chips === 0 && p.currentRoundBet < room.currentBet)
            );

            if (room.currentBet > 0) { // 누군가 삥 또는 레이즈를 했다면 (사용자님의 'room.currentBet > 0' 조건)
                // ✅ 조건 1: 모든 플레이어의 베팅액이 동일해짐
                // ✅ 조건 2: 턴이 마지막으로 베팅한 사람에게 다시 돌아옴 (lastBettingPlayer)
                if (allPlayersCalledOrChecked &&
                    room.currentTurnPlayerId === room.lastBettingPlayer &&
                    room.lastBettingPlayer !== null) {
                    phaseCompleted = true;
                }
            } else { // room.currentBet이 0인 경우 (모두 체크/콜(0)만 하거나 아무도 베팅하지 않은 상태)
                // ✅ 조건: 모든 플레이어가 한 번씩 액션(체크 또는 콜(0))을 했을 때
                const allPlayersActedOnce = activePlayersInRound.every(p => p.hasActedInBettingRound);
                if (allPlayersActedOnce) { // ✨ MODIFIED: firstPlayerToActId 비교 제거, 모든 활성 플레이어가 액션했으면 종료.
                    phaseCompleted = true;
                }
            }

            if (phaseCompleted) {
                logDebug(`[GameService] 방 ${roomId} 베팅 페이즈 완료 (베팅 라운드 ${room.currentBettingRoundIndex}).`);
                return this.handlePhaseTransitionAfterBetting(roomId);
            }
        } else if (room.currentPhase === 'exchange') {
            // ✨ FIX: 교환 페이즈 완료 조건 재검증 (사용자님 제안 반영 - 2번 문제 해결)
            // 다이하지 않은 모든 플레이어가 canExchange=false (즉, 교환 또는 스테이 완료) 상태인지 확인
            const allPlayersFinishedExchange = activePlayersInRound.every(p => !p.canExchange);
            if (allPlayersFinishedExchange) {
                logDebug(`[GameService] 방 ${roomId} 모든 활성 플레이어가 교환 또는 스테이를 완료했습니다.`);
                phaseCompleted = true; // 교환 페이즈 완료
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
        const initialTurnPlayerId = room.currentTurnPlayerId; // 턴 시작 시점의 플레이어 ID

        // 턴 진행 루프 (모두가 폴드/교환 완료했거나 다음 액션 플레이어를 찾을 때까지)
        do {
            currentTurnIndex = (currentTurnIndex + 1) % numPlayers;
            const nextPlayer = room.players[currentTurnIndex];

            // 턴이 한 바퀴 돌아 원래 턴 플레이어에게 다시 왔을 때, 아직 다음 턴 플레이어를 찾지 못했다면 정지
            // (이는 모든 활성 플레이어가 액션을 완료했거나 폴드/퇴장 예약되었음을 의미)
            if (nextPlayer.id === initialTurnPlayerId && loopCount > 0) {
                warnDebug(`[GameService] 방 ${roomId} 턴 진행 중 다음 액션 플레이어를 찾지 못하고 한 바퀴 돌았습니다. (모두 액션했거나 폴드/퇴장 예상) - 강제 쇼다운`);
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
                    this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
                    this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 턴 변경 시 방 정보 업데이트
                    this.startTurnTimer(roomId, room.currentTurnPlayerId); // 새 턴 타이머 시작
                    return true; // 턴 성공적으로 진행
                }
            }
            loopCount++;
        } while (!nextTurnPlayerFound && loopCount < numPlayers + 1); // 무한 루프 방지를 위해 최대 플레이어 수 + 1만큼만 루프

        // 루프를 빠져나왔는데도 다음 턴 플레이어를 찾지 못했다면 오류 (비상 쇼다운)
        errorDebug(`[GameService] 방 ${roomId} 모든 플레이어 턴 순회 후 다음 액션 플레이어를 찾을 수 없습니다. (예상치 못한 정지) - 강제 쇼다운`);
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

        // ✨ FIX: 교환 기회 인덱스 증가 로직 수정 (사용자님 제안 반영 - 3번 문제 해결 및 Symptom D 주석 개선)
        // `maxExchangeOpportunities`는 3 (인덱스 0, 1, 2)
        // `currentExchangeOpportunityIndex`가 -1, 0, 1까지는 다음 교환으로 넘어가고
        // 2가 되면 다음 베팅 라운드 (또는 쇼다운)으로 가야 함.
        if (room.currentExchangeOpportunityIndex + 1 < this.maxExchangeOpportunities) { // ✨ MODIFIED: 의도를 명확히. `currentExchangeOpportunityIndex`가 2까지 허용.
            room.currentPhase = 'exchange';
            room.currentExchangeOpportunityIndex++; // 다음 교환 기회 인덱스 증가 (예: -1 -> 0, 0 -> 1, 1 -> 2)

            room.players.forEach(p => {
                if (!p.folded && !p.leaveReserved) {
                    p.canExchange = true; // 모든 활성 플레이어에게 카드 교환 기회 부여
                }
            });

            // 베팅 관련 플래그 초기화
            room.lastBettingPlayer = null;
            room.players.forEach(p => p.hasActedInBettingRound = false);
            room.players.forEach(p => p.currentRoundBet = 0); // 각 플레이어의 베팅액 초기화
            room.currentBet = 0; // 교환 페이즈 시작 시 currentBet을 0으로 초기화

            logDebug(`[GameService] 방 ${roomId} ${this.bettingRoundNames[room.currentBettingRoundIndex]} 라운드의 ${room.currentExchangeOpportunityIndex + 1}번째 교환 페이즈 시작.`);
            this.io.to(`room-${roomId}`).emit('phaseChanged', {
                currentBettingRoundIndex: room.currentBettingRoundIndex,
                currentExchangeOpportunityIndex: room.currentExchangeOpportunityIndex,
                gameRoundName: this.bettingRoundNames[room.currentBettingRoundIndex], // 이 교환은 이 베팅 라운드 이름으로 진행
                currentPhase: room.currentPhase,
                pot: room.pot, // 팟은 누적된 상태 유지
                currentBet: room.currentBet, // 0으로 초기화된 currentBet
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });

            // ✨ FIX: 턴 시작 인덱스 고정 문제 해결 (Symptom B/E 해결)
            // 다음 페이즈의 첫 턴은 마지막 액션 플레이어 다음 순서 (room.lastActionPlayerId 기준)
            let startIndex = room.players.findIndex(p => p.id === room.lastActionPlayerId);
            if (startIndex === -1) startIndex = room.dealerIndex; // Fallback: lastActionPlayer가 없으면 딜러 다음으로 시작

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
                errorDebug(`[GameService] 방 ${roomId} 다음 교환 페이즈의 첫 턴 플레이어를 찾을 수 없습니다. 강제 쇼다운.`);
                this.showdown(roomId, true);
                return false;
            }
            room.turnIndex = nextTurnPlayerIndex;
            room.currentTurnPlayerId = room.players[room.turnIndex].id;
            room.turnIndexAtRoundStart = room.turnIndex; // ✨ NEW: 다음 라운드 시작 시 첫 턴 인덱스 저장 (6번 문제 해결)

            this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
            this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 방 정보 업데이트
            this.startTurnTimer(roomId, room.currentTurnPlayerId); // 새 턴 타이머 시작
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
            room.gameRoundName = this.bettingRoundNames[room.currentBettingRoundIndex]; // ✨ 이 라인도 this.bettingRoundNames를 사용해야 합니다.
            room.currentPhase = 'betting'; // 다음 페이즈는 'betting'

            // 새로운 베팅 라운드를 위한 초기화 (팟은 누적)
            room.currentBet = 0; // 새로운 베팅 라운드 시작 시 currentBet을 0으로 초기화
            room.lastBettingPlayer = null;
            room.players.forEach(p => {
                p.currentRoundBet = 0; // 새 라운드 시작 시 플레이어의 베팅액 0으로 리셋
                if (!p.folded && !p.leaveReserved) {
                    p.chips -= room.betAmount; // 새 라운드 안테 지불
                    room.pot += room.betAmount;
                }
                p.hasActedInBettingRound = false; // 베팅 액션 여부 리셋
                p.canExchange = false; // 교환 페이즈가 아니므로 canExchange는 false로 유지
            });

            logDebug(`[GameService] 방 ${roomId} ${room.gameRoundName} 라운드의 베팅 페이즈 시작. 새로운 안테 수집 완료. 팟: ${room.pot}`);
            this.io.to(`room-${roomId}`).emit('roundStarted', { // roundStarted 이벤트를 사용하여 새 베팅 라운드 시작을 알림
                currentBettingRoundIndex: room.currentBettingRoundIndex,
                currentExchangeOpportunityIndex: room.currentExchangeOpportunityIndex, // 교환 기회 인덱스는 이전 값 유지 (이전 교환 기회)
                // ✨ FIX: 여기서 this.bettingRoundNames를 사용해야 합니다.
                gameRoundName: this.bettingRoundNames[room.currentBettingRoundIndex],
                currentPhase: room.currentPhase,
                pot: room.pot, // 팟은 누적된 상태 유지
                currentBet: room.currentBet, // 0으로 초기화된 currentBet
                dealerId: room.dealerId,
                smallBlindId: room.smallBlindId,
                bigBlindId: room.bigBlindId
            });

            // ✨ FIX: 턴 시작 인덱스 고정 문제 해결 (Symptom B/E 해결)
            // 다음 베팅 라운드의 첫 턴은 딜러 다음 플레이어부터 시작 (딜러 순환 규칙 반영)
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
                errorDebug(`[GameService] 방 ${roomId} 다음 베팅 라운드의 첫 턴 플레이어를 찾을 수 없습니다. 강제 쇼다운.`);
                this.showdown(roomId, true);
                return false;
            }
            room.turnIndex = nextTurnPlayerIndex;
            room.currentTurnPlayerId = room.players[room.turnIndex].id;
            room.turnIndexAtRoundStart = room.turnIndex; // ✨ NEW: 새로운 라운드 시작 시 첫 턴 인덱스 저장 (6번 문제 해결)

            this.io.to(`room-${roomId}`).emit('turnChanged', { currentPlayerId: room.currentTurnPlayerId, timeLeft: this.turnTimeLimit });
            this.io.to(`room-${roomId}`).emit('roomUpdated', room); // 방 정보 업데이트
            this.startTurnTimer(roomId, room.currentTurnPlayerId); // 새 턴 타이머 시작
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
     * @param {number} [amount=0] - 베팅 금액 (레이즈 시의 총액 또는 삥 금액, 콜 시 지불 금액)
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
        // 칩이 0이고 다이/콜이 아니면 액션 불가
        if (player.chips <= 0 && actionType !== 'die' && actionType !== 'call') {
            return { success: false, message: '칩이 부족하여 해당 액션을 할 수 없습니다. 다이하거나 올인 콜하세요.' };
        }


        logDebug(`[GameService] Player ${player.name} (ID: ${playerId}) 액션: ${actionType}, 금액: ${amount}, 현재 팟: ${room.pot}, 현재 베팅: ${room.currentBet}, 내 베팅: ${player.currentRoundBet}`);

        //player.hasActedInBettingRound = true; // ✨ REMOVED: 콜(0)과 체크를 구분하기 위해 여기서 설정하지 않고 개별 액션에서 설정

        switch (actionType) {
            case 'check':
                if (room.currentBet > 0) {
                    return { success: false, message: '이미 베팅이 이루어진 상태에서는 체크할 수 없습니다.' };
                }
                if (room.currentBet > player.currentRoundBet) {
                    return { success: false, message: '체크할 수 없습니다. 베팅 금액을 맞춰야 합니다.' };
                }
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'check', message: `${player.name}이(가) 체크했습니다.` });
                room.lastActionPlayerId = playerId;
                player.hasActedInBettingRound = true; // ✨ NEW: 체크 시 hasActedInBettingRound 설정
                // room.lastBettingPlayer는 갱신하지 않습니다. (체크는 베팅이 아님)
                break;

            case 'bet': // '삥' (클라이언트에서 계산된 총 베팅 금액이 넘어옴)
                const myCurrentRoundBetForBbing = player.currentRoundBet;
                let chipsToPayForBbing = 0;
                let newTotalBetAmountForBbing = amount; // 클라이언트에서 이미 최종 베팅 금액으로 계산해서 보낸다고 가정

                // 유효성 검사: amount는 방의 최소 베팅액 이상이어야 함
                if (newTotalBetAmountForBbing < room.betAmount) {
                    return { success: false, message: `삥 금액은 최소 ${room.betAmount} 칩 이상이어야 합니다.` };
                }

                // currentBet이 0인 경우 (이 라운드에서 첫 베팅)
                if (room.currentBet === 0) {
                    if (newTotalBetAmountForBbing !== room.betAmount) {
                        return { success: false, message: `첫 삥은 ${room.betAmount} 칩으로만 할 수 있습니다.` };
                    }
                    chipsToPayForBbing = newTotalBetAmountForBbing - myCurrentRoundBetForBbing; // myCurrentRoundBetForBbing은 0
                }
                // currentBet이 0이 아닌 경우 (누군가 이미 베팅/체크 한 후의 삥 -> 레이즈 역할)
                else {
                    // 사용자 규칙: 앞사람의 베팅금액(room.currentBet) + bbing (room.betAmount)
                    const expectedBbingAmount = room.currentBet + room.betAmount;
                    if (newTotalBetAmountForBbing < expectedBbingAmount) { // ✨ FIX: '==' 대신 '<'로 변경 (클라이언트에서 올 수 있는 예외 처리)
                        return { success: false, message: `삥 금액은 현재 베팅액(${room.currentBet})에 삥 금액(${room.betAmount})을 더한 ${expectedBbingAmount} 칩 이상이어야 합니다.` };
                    }
                    chipsToPayForBbing = newTotalBetAmountForBbing - myCurrentRoundBetForBbing;
                }

                if (chipsToPayForBbing <= 0) { // 이미 같은 금액을 베팅했거나 더 많이 베팅한 경우
                    return { success: false, message: '삥을 걸 필요가 없습니다. 체크 또는 콜/레이즈하세요.' };
                }
                if (chipsToPayForBbing > player.chips) { // 칩이 부족하면 삥 불가 (콜/다이만 가능)
                    return { success: false, message: '칩이 부족하여 삥을 걸 수 없습니다. 콜 또는 다이하세요.' };
                }

                player.chips -= chipsToPayForBbing;
                room.pot += chipsToPayForBbing;
                room.currentBet = newTotalBetAmountForBbing;
                player.currentRoundBet = newTotalBetAmountForBbing; // 플레이어의 currentRoundBet 업데이트
                room.lastBettingPlayer = playerId; // ✨ FIX: 삥을 건 플레이어가 마지막 베팅 플레이어 (Symptom E 해결)
                room.lastActionPlayerId = playerId; // 마지막 액션 플레이어 ID 갱신
                player.hasActedInBettingRound = true; // ✨ NEW: 삥 시 hasActedInBettingRound 설정
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'bet', amount: newTotalBetAmountForBbing, message: `${player.name}이(가) ${newTotalBetAmountForBbing} 칩으로 삥을 걸었습니다.` });
                break;

            case 'call':
                const myCurrentRoundBetForCall = player.currentRoundBet; // 현재 이 플레이어가 베팅한 총액
                const chipsNeededToMatch = room.currentBet - myCurrentRoundBetForCall; // 현재 최고 베팅액에 맞추기 위해 필요한 칩

                // ✨ FIX: room.currentBet이 0인 경우의 '콜(0)'은 '체크'로 간주하여 처리 (원인 ① 해결)
                // 클라이언트에서 `amount`를 `room.currentBet`으로 보내므로, `room.currentBet === 0`일 때 `amount`도 0.
                if (room.currentBet === 0) { // 클라이언트에서 콜(0)이 들어온 경우
                    // 이 시점에서 chipsNeededToMatch는 0이어야만 합니다.
                    if (chipsNeededToMatch !== 0) {
                        warnDebug(`[GameService] 방 ${roomId} Player ${playerId} - currentBet이 0인데 콜 요청 시 chipsNeededToMatch가 0이 아님. 액션 불가.`);
                        return { success: false, message: '베팅 금액이 0일 때는 콜할 칩이 없습니다.' };
                    }
                    this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'check', message: `${player.name}이(가) 콜(0)했습니다.` }); // 체크 이벤트로 알림
                    room.lastActionPlayerId = playerId;
                    player.hasActedInBettingRound = true; // ✨ NEW: 콜(0) 시 hasActedInBettingRound 설정
                    // room.lastBettingPlayer는 갱신하지 않습니다. (콜(0)은 베팅이 아님)
                    break; // 콜(0)은 체크처럼 처리되므로 여기서 break
                }

                // --- 이하, room.currentBet > 0 인 경우의 일반 콜 로직 (기존과 동일) ---
                let chipsActuallyPaidForCall = 0;

                if (chipsNeededToMatch <= 0) { // 이미 콜했거나 더 많이 베팅한 경우
                    return { success: false, message: '콜할 필요가 없습니다. 체크하거나 레이즈하세요.' };
                } else if (chipsNeededToMatch > player.chips) { // 칩 부족, 올인 콜 처리
                    chipsActuallyPaidForCall = player.chips; // 가진 칩 전부 지불
                    player.chips = 0; // 플레이어 칩 0
                    room.pot += chipsActuallyPaidForCall;
                    player.currentRoundBet += chipsActuallyPaidForCall; // 낸 만큼 currentRoundBet 업데이트
                    this.io.to(`room-${roomId}`).emit('playerAction', {
                        playerId,
                        actionType: 'allIn',
                        amount: chipsActuallyPaidForCall,
                        message: `${player.name}이(가) ${chipsActuallyPaidForCall} 칩으로 올인했습니다! (총 베팅: ${player.currentRoundBet})`
                    });
                    room.lastBettingPlayer = playerId; // 올인 콜도 베팅으로 간주
                } else { // 칩 충분, 일반 콜 처리
                    chipsActuallyPaidForCall = chipsNeededToMatch;
                    player.chips -= chipsActuallyPaidForCall;
                    room.pot += chipsActuallyPaidForCall;
                    // room.currentBet은 변경하지 않습니다. (콜은 베팅에 맞추는 것이므로 room.currentBet은 유지)
                    player.currentRoundBet = room.currentBet; // 플레이어의 총 베팅액을 room.currentBet과 동일하게 맞춥니다.
                    this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'call', amount: chipsActuallyPaidForCall, message: `${player.name}이(가) ${chipsActuallyPaidForCall} 칩으로 콜했습니다.` });
                    room.lastBettingPlayer = playerId; // ✨ FIX: 일반 콜은 lastBettingPlayer 갱신. (A 삥 -> B 콜, B가 마지막 베팅한 플레이어)
                }
                player.hasActedInBettingRound = true; // ✨ NEW: 일반 콜 시 hasActedInBettingRound 설정
                room.lastActionPlayerId = playerId; // 마지막 액션 플레이어 ID 갱신
                break;

            case 'raise':
                // amount는 플레이어가 총 베팅하고자 하는 금액 (내 currentRoundBet 포함)
                const myCurrentRoundBetForRaise = player.currentRoundBet;

                let actualChipsToPayForRaise = 0;
                let newRoomCurrentBetForRaise = 0;

                // room.currentBet이 0일 때도 레이즈 가능 (첫 베팅으로서의 레이즈)
                if (room.currentBet === 0) {
                    if (amount < room.betAmount) { // 최소한 방의 베팅액 이상이어야 함
                        return { success: false, message: `유효하지 않은 레이즈 금액입니다. 총 ${room.betAmount} 칩 이상을 베팅해야 합니다.` };
                    }
                    newRoomCurrentBetForRaise = amount;
                    actualChipsToPayForRaise = amount - myCurrentRoundBetForRaise; // myCurrentRoundBetForRaise는 0일 것
                } else { // 이미 베팅이 있는 상태 (후속 레이즈)
                    const minRaiseAmountTotal = room.currentBet + room.betAmount;
                    if (amount < minRaiseAmountTotal) {
                        return { success: false, message: `유효하지 않은 레이즈 금액입니다. 총 ${minRaiseAmountTotal} 칩 이상을 베팅해야 합니다.` };
                    }
                    newRoomCurrentBetForRaise = amount;
                    actualChipsToPayForRaise = amount - myCurrentRoundBetForRaise;
                }

                if (actualChipsToPayForRaise <= 0) { // 레이즈인데 추가 금액이 0이거나 음수
                    return { success: false, message: '레이즈 금액이 유효하지 않습니다. 현재 베팅액보다 높아야 합니다.' };
                }
                if (actualChipsToPayForRaise > player.chips) { // 칩이 부족하면 레이즈 불가 (콜/다이만 가능)
                    return { success: false, message: '칩이 부족하여 레이즈할 수 없습니다. 콜 또는 다이하세요.' };
                }

                player.chips -= actualChipsToPayForRaise;
                room.pot += actualChipsToPayForRaise;
                room.currentBet = newRoomCurrentBetForRaise;
                player.currentRoundBet = newRoomCurrentBetForRaise; // 플레이어의 currentRoundBet 업데이트
                room.lastBettingPlayer = playerId; // ✨ FIX: 레이즈를 한 플레이어가 마지막 베팅 플레이어 (Symptom E 해결)
                room.lastActionPlayerId = playerId; // 마지막 액션 플레이어 ID 갱신
                player.hasActedInBettingRound = true; // ✨ NEW: 레이즈 시 hasActedInBettingRound 설정
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'raise', amount: amount, message: `${player.name}이(가) ${amount} 칩으로 레이즈했습니다.` });
                break;

            case 'die': // '다이' (폴드와 동일)
                this.io.to(`room-${roomId}`).emit('playerAction', { playerId, actionType: 'die', message: `${player.name}이(가) 다이를 선언했습니다.` });
                player.folded = true;
                player.status = 'folded';
                room.lastActionPlayerId = playerId; // 마지막 액션 플레이어 ID 갱신
                player.hasActedInBettingRound = true; // ✨ NEW: 다이 시 hasActedInBettingRound 설정 (액션으로 간주)
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
            room.lastActionPlayerId = playerId; // 마지막 액션 플레이어 ID 갱신
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

        room.lastActionPlayerId = playerId; // 마지막 액션 플레이어 ID 갱신
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
                // ✨ FIX: winners -> winnerIds/names 매핑 및 안전한 emit (Symptom C 해결)
                const winnerIds = winners.map(w => w.playerId);
                const winnerNames = winnerIds.map(id => room.players.find(p => p.id === id)?.name || `Unknown User (${id})`);

                // 팟 분배 로직
                let prizePerWinner = Math.floor(room.pot / winners.length);
                let remainder = room.pot % winners.length;

                winners.forEach((winner, idx) => {
                    const player = room.players.find(p => p.id === winner.playerId);
                    if (player) { // 플레이어가 존재할 경우에만 칩 지급
                        player.chips += prizePerWinner + (idx < remainder ? 1 : 0); // 잔여칩을 첫 승자들부터 하나씩 분배
                    }
                });
                room.pot = 0;
                room.status = 'ended';

                logDebug(`[GameService] 방 ${roomId} 쇼다운 승자: ${winnerNames.join(', ')} (ID: ${winnerIds.join(', ')})`);

                const finalHandsToShow = {};
                room.players.forEach(p => {
                    // 폴드했더라도 승자라면 패를 보여줌 (일반적으로는 승자만 공개)
                    // 또는 모든 활성 플레이어의 패를 공개하고 싶다면 조건 변경
                    if (!p.folded || winnerIds.includes(p.id)) { // ✨ FIX: 폴드한 플레이어의 패는 기본적으로 숨기지만, 승자라면 공개
                        finalHandsToShow[p.id] = room.hands[p.id];
                    }
                });

                this.io.to(`room-${roomId}`).emit('gameEnded', {
                    roomStatus: room.status,
                    winnerIds: winnerIds,
                    winnerNames: winnerNames,
                    winningHands: winners.map(w => ({ playerId: w.playerId, hand: room.hands[w.playerId], bestHand: w.bestHand })), // Winning hand is the full hand
                    finalHands: finalHandsToShow, // 최종 패 공개
                    finalPlayers: room.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, bestHand: p.bestHand, isCreator: p.isCreator, folded: p.folded, status: p.status }))
                });
            } else {
                errorDebug(`[GameService] 방 ${roomId} 쇼다운에서 승자를 찾을 수 없습니다. (오류)`);
                room.status = 'ended';
                this.io.to(`room-${roomId}`).emit('gameEnded', { roomStatus: room.status, reason: '승자를 찾을 수 없습니다. (오류)' });
            }
        } else { // 활성 플레이어가 1명 이하인데 forceWinner가 아니면 (예: 모두 폴드)
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

        this.clearTurnTimer(roomId); // 게임 종료 시 타이머도 클리어

        room.status = 'waiting';
        room.currentBettingRoundIndex = 0; // 초기화
        room.currentExchangeOpportunityIndex = -1; // 초기화
        room.gameRoundName = '대기 중';
        room.pot = 0;
        room.currentBet = 0;
        room.lastBettingPlayer = null;
        room.currentPhase = 'waiting'; // 페이즈도 초기화
        // ✨ FIX: 역할 ID 및 턴 관련 필드 초기화 (Symptom F 해결)
        room.dealerIndex = -1; // 딜러 인덱스 초기화
        room.dealerId = -1;
        room.smallBlindId = -1;
        room.bigBlindId = -1;
        room.lastActionPlayerId = null;
        room.timerProcessingLock = false;
        room.turnIndexAtRoundStart = null;


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

    /**
     * 지정된 방의 턴 타이머를 시작합니다.
     * @param {number} roomId
     * @param {number} playerId - 현재 턴 플레이어 ID
     */
    startTurnTimer(roomId, playerId) {
        // ✨ FIX: 항상 먼저 정리하여 잔존 타이머 문제 방지 (Symptom A 해결)
        this.clearTurnTimer(roomId);

        let timeLeft = this.turnTimeLimit;
        // 1초마다 타이머 업데이트를 클라이언트에 전송
        const timerInterval = setInterval(() => {
            timeLeft--;
            this.io.to(`room-${roomId}`).emit('timerUpdate', { timeLeft: timeLeft, currentPlayerId: playerId });

            if (timeLeft <= 0) {
                this.clearTurnTimer(roomId);
                this.handleTimerTimeout(roomId, playerId); // 시간 만료 처리
            }
        }, 1000);

        // 혹시 모를 Interval 오류에 대비한 Timeout (백업 타이머 역할)
        this.turnTimers[roomId] = {
            interval: timerInterval,
            timeout: setTimeout(() => {
                this.clearTurnTimer(roomId);
                this.handleTimerTimeout(roomId, playerId);
            }, this.turnTimeLimit * 1000 + 500) // 약간의 여유 시간 추가
        };
        logDebug(`[GameService] 방 ${roomId} 턴 타이머 시작. 플레이어: ${playerId}, 시간: ${this.turnTimeLimit}초`);
    }

    /**
     * 지정된 방의 턴 타이머를 클리어합니다.
     * @param {number} roomId
     */
    clearTurnTimer(roomId) {
        if (this.turnTimers[roomId]) {
            clearInterval(this.turnTimers[roomId].interval);
            clearTimeout(this.turnTimers[roomId].timeout);
            delete this.turnTimers[roomId];
            logDebug(`[GameService] 방 ${roomId} 턴 타이머 클리어.`);
        }
    }

    /**
     * 턴 타이머 만료 시 처리 로직 (자동 다이 또는 자동 스테이)
     * @param {number} roomId
     * @param {number} playerId - 턴이 만료된 플레이어 ID
     */
    handleTimerTimeout(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room) {
            warnDebug(`[GameService] 타이머 만료 시 방 ${roomId}를 찾을 수 없습니다.`);
            return;
        }
        if (room.currentTurnPlayerId !== playerId) { // 이미 턴이 넘어간 경우
            warnDebug(`[GameService] 타이머 만료 시점 플레이어 불일치. 현재 턴: ${room.currentTurnPlayerId}, 만료된 플레이어: ${playerId}`);
            return;
        }

        if (room.timerProcessingLock) {
            warnDebug(`[GameService] 방 ${roomId} 타이머 처리 락 활성화 중. 중복 처리 요청 무시.`);
            return;
        }
        room.timerProcessingLock = true; // 락 설정

        let result;
        if (room.currentPhase === 'exchange') {
            logDebug(`[GameService] 방 ${roomId} 플레이어 ${playerId} 턴 시간 만료! 자동 스테이 처리.`);
            result = this.handleCardExchange(roomId, playerId, []); // 빈 배열은 스테이와 동일
            if (!result.success) {
                errorDebug(`[GameService] 타이머 만료 후 자동 스테이 처리 실패: ${result.message}`);
            } else {
                this.io.to(`room-${roomId}`).emit('playerAction', {
                    playerId,
                    actionType: 'autoStay',
                    message: `${room.players.find(p => p.id === playerId)?.name}이(가) 시간 만료로 자동 스테이했습니다.`
                });
            }
        } else { // 베팅 페이즈 타이머 만료 시 자동 다이
            logDebug(`[GameService] 방 ${roomId} 플레이어 ${playerId} 턴 시간 만료! 자동 다이 처리.`);
            result = this.handleBettingAction(roomId, playerId, 'die', 0);
            if (!result.success) {
                errorDebug(`[GameService] 타이머 만료 후 자동 다이 처리 실패: ${result.message}`);
            } else {
                this.io.to(`room-${roomId}`).emit('playerAction', {
                    playerId,
                    actionType: 'autoDie',
                    message: `${room.players.find(p => p.id === playerId)?.name}이(가) 시간 만료로 자동 다이했습니다.`
                });
            }
        }

        room.timerProcessingLock = false; // 락 해제
    }
}

export { GameService };