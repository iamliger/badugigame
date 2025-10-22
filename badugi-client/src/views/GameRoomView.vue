<template>
  <div class="game-room-page-wrapper container">
    <h1 class="text-center game-title">바둑이 게임 (ID: {{ roomId }})</h1>

    <!-- 게임 정보 요약 패널 -->
    <div class="game-info-panel mb-4 p-3 border rounded bg-light">
      <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <p class="mb-0">방 제목: <strong class="text-primary">{{ roomName }}</strong></p>
        <p class="mb-0">인원: <strong>{{ players.length }}/{{ room.maxPlayers }}</strong>명</p>
        <p class="mb-0">
          게임 상태: <span class="badge" :class="{'badge-success': roomStatus === 'playing', 'badge-info': roomStatus === 'waiting', 'badge-warning': roomStatus === 'showdown', 'badge-dark': roomStatus === 'ended'}">{{ displayRoomStatus }}</span>
        </p>
      </div>
      <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <p class="mb-0">최소 베팅액: <strong>{{ betAmount }} 칩</strong></p>
        <p class="mb-0">현재 팟: <strong class="text-warning">{{ pot }} 칩</strong></p>
        <p class="mb-0">현재 최고 베팅액: <strong class="text-info">{{ currentBet }} 칩</strong></p>
      </div>
      <div class="d-flex justify-content-between align-items-center mb-0 flex-wrap gap-2">
        <p class="mb-0">
            라운드: <strong class="text-primary">{{ gameRoundName }}</strong>
            (베팅: {{ currentBettingRoundIndex + 1 }}/{{ maxBettingRounds }})
            <span v-if="currentExchangeOpportunityIndex > -1" class="ml-2">(교환: {{ currentExchangeOpportunityIndex + 1 }}/{{ maxExchangeOpportunities }})</span>
        </p>
        <p class="mb-0">페이즈: <span class="badge" :class="{'badge-primary': currentPhase === 'betting', 'badge-info': currentPhase === 'exchange', 'badge-secondary': currentPhase === 'waiting'}">{{ displayCurrentPhase }}</span></p>
      </div>
    </div>

    <!-- 플레이어 테이블 레이아웃 -->
    <div class="game-table-layout">
      <!-- 딜러, 블라인드, 내 턴 정보 오버레이 -->
      <div v-if="currentTurnPlayer" class="turn-indicator">
        <span class="badge badge-success turn-badge">
          <i class="fas fa-hand-point-right mr-1"></i> 현재 턴: {{ currentTurnPlayer.name }} 님
        </span>
        <span class="badge badge-info timer-badge ml-2">
          <i class="fas fa-clock mr-1"></i> {{ timeLeft }}초
        </span>
      </div>

      <!-- 플레이어 카드 및 정보 표시 -->
      <div class="player-positions">
        <div v-for="player in players" :key="player.id"
             class="player-card-area"
             :class="{'player-is-me': player.id == myUserId, 'player-is-turn': player.id == currentTurnPlayerId, 'player-folded': player.folded, 'player-reserved-leave': player.leaveReserved}">
          <div class="player-info">
            <div class="player-name">
              <strong>{{ player.name }}</strong>
              <span v-if="player.id == myUserId" class="badge badge-primary ml-1">나</span>
            </div>
            <div class="player-chips">
              <i class="fas fa-coins mr-1"></i>{{ player.chips }} 칩
            </div>
            <div class="player-bet" v-if="player.currentRoundBet > 0">
              <span class="badge badge-warning">베팅: {{ player.currentRoundBet }}</span>
            </div>
            <div class="player-status-badges">
                <span v-for="role in getPlayerRoleBadges(player)" :key="role.text" class="badge ml-1" :class="role.class">{{ role.text }}</span>
                <span v-if="player.leaveReserved" class="badge badge-danger ml-1">퇴장 예약</span>
                <span v-if="player.folded" class="badge badge-secondary ml-1">폴드</span>
                <span v-if="player.bestHand && player.bestHand.rank !== 'Invalid' && (roomStatus === 'showdown' || roomStatus === 'ended')" class="badge badge-success ml-1">
                    {{ player.bestHand.badugiCount }}구 {{ player.bestHand.rank.split('-')[0] }}
                </span>
            </div>
          </div>
          <!-- 카드 표시 영역 -->
          <div class="player-hand">
              <div v-for="(card, index) in getPlayerCards(player.id)" :key="card ? card.id : `${player.id}-card-back-${index}`"
                   :class="getCardClass(card, player.id === myUserId || (roomStatus === 'showdown' || roomStatus === 'ended'), isCardSelected(card ? card.id : null))"
                   :title="getCardTitle(card, player.id === myUserId)"
                   @click="player.id === myUserId && roomStatus === 'playing' && isMyTurn && currentPhase === 'exchange' && myPlayer?.canExchange && card ? toggleCardSelection(card.id) : null"
              >
                  <img v-if="!shouldShowCardFace(card, player.id === myUserId)" src="/cards/card_back.png" alt="Card Back" class="card-image-back">
              </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 액션 및 제어 버튼 -->
    <div class="game-controls mt-4">
      <div class="control-section-wrapper mb-3">
        <h5 class="control-section-title">기본 제어</h5>
        <div class="d-flex justify-content-center flex-wrap gap-2">
            <button @click="handleLeaveRoom" :class="['btn', { 'btn-danger': !myPlayer?.leaveReserved, 'btn-secondary': myPlayer?.leaveReserved }]">
                <span v-if="isRoomCreator && players.length > 1 && room.status === 'waiting'">방장 퇴장 불가</span>
                <span v-else-if="room.status === 'playing' && !myPlayer?.leaveReserved">게임 종료 후 나가기 예약</span>
                <span v-else>방 나가기</span>
            </button>
            <button v-if="isRoomCreator && room.status === 'waiting'" @click="startGame" class="btn btn-success" :disabled="players.length < 2">게임 시작</button>
            <button v-if="room.status === 'playing' && myPlayer?.leaveReserved" @click="cancelLeaveRoom" class="btn btn-warning">예약 취소</button>
        </div>
      </div>

      <template v-if="room.status === 'playing' && isMyTurn && !myPlayer?.folded && !myPlayer?.leaveReserved">
        <!-- 베팅 페이즈 버튼 -->
        <div v-if="currentPhase === 'betting'" class="control-section-wrapper mb-3">
            <h5 class="control-section-title">베팅 액션</h5>
            <div class="d-flex justify-content-center flex-wrap gap-2">
                <button @click="handlePlayerAction('check')" class="btn btn-primary" :disabled="!canCheck">체크</button>
                <button @click="handlePlayerAction('call', myChipsToPayForCall)" class="btn btn-primary" :disabled="!canCall">
                    <span v-if="myChipsToPayForCall > 0">콜 ({{ myChipsToPayForCall }})</span>
                    <span v-else>콜 (0)</span>
                </button>
                <button @click="handlePlayerAction('bet', myTargetTotalBetForBbing)" class="btn btn-info" :disabled="!canBbing">삥 ({{ myChipsToPayForBbing }})</button>
                <button @click="handlePlayerAction('raise', getRaiseAmountForHalf)" class="btn btn-info" :disabled="!canRaiseToHalf">하프 ({{ calculateChipsNeededForTotalBet(getRaiseAmountForHalf) }})</button>
                <button @click="handlePlayerAction('raise', getRaiseAmountForFull)" class="btn btn-info" :disabled="!canRaiseToFull">풀 ({{ calculateChipsNeededForTotalBet(getRaiseAmountForFull) }})</button>
                <button @click="handlePlayerAction('die')" class="btn btn-dark" :disabled="!canDie">다이</button>
            </div>
        </div>

        <!-- 교환 페이즈 버튼 -->
        <div v-else-if="currentPhase === 'exchange' && myPlayer?.canExchange" class="control-section-wrapper mb-3">
            <h5 class="control-section-title">카드 교환</h5>
            <div class="d-flex justify-content-center flex-wrap gap-2">
                <button @click="handlePlayerAction('exchange', selectedCardsIds)" class="btn btn-warning" :disabled="!canExchangeCards">카드 교환 ({{ selectedCardsIds.length }}장)</button>
                <button @click="handlePlayerAction('stay', [])" class="btn btn-light" :disabled="!canStay">스테이</button>
            </div>
        </div>

        <!-- 교환 페이즈지만 이미 액션한 경우 대기 메시지 -->
        <div v-else-if="currentPhase === 'exchange' && !myPlayer?.canExchange" class="alert alert-info text-center ml-2 mb-0 py-2 px-3">
            다른 플레이어의 카드 교환을 기다리는 중...
        </div>
      </template>
    </div>

    <!-- ✨ REMOVED: 디버그 패널 및 게임 이벤트 로그 영역 -->

    <!-- 게임 종료 결과 모달 (공용 CSS 그대로 유지) -->
    <div v-if="showGameEndedModal" class="modal-overlay">
        <div class="modal-content">
            <h4>게임 종료!</h4>
            <div v-if="gameWinnerNames.length > 0">
                <p>승자: <strong class="text-success">{{ gameWinnerNames.join(', ') }}</strong> 님!</p>
                <p>축하합니다! 팟을 획득했습니다.</p>
            </div>
            <div v-else>
                <p>게임이 종료되었습니다.</p>
                <p>{{ gameEndReason }}</p>
            </div>
            <h5 class="mt-3">최종 패 공개</h5>
            <div v-for="playerId in Object.keys(finalHands)" :key="playerId" class="text-left mb-2">
                <strong>{{ players.find(p => p.id == playerId)?.name || `User ${playerId}` }} 님의 패:</strong>
                <div class="player-hand justify-content-start">
                    <div v-for="card in finalHands[playerId]" :key="card.id" :class="getCardClass(card, true)" :title="`${card.suit}${card.rank}`"></div>
                </div>
                <p>족보: {{ players.find(p => p.id == playerId)?.bestHand?.rank }} (점수: {{ players.find(p => p.id == playerId)?.bestHand?.value }})</p>
            </div>
            <button @click.stop="closeGameEndedModal" class="btn btn-primary mt-4">확인</button>
        </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, inject, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { logger } from '../utils/logger'; // 브라우저 콘솔 로거

// -----------------------------------------------------------
// 1. 상태 변수 (ref) 및 주입된 값
// -----------------------------------------------------------
const router = useRouter();
const route = useRoute();
const socketRef = inject('socket'); // socket 인스턴스 ref 객체 주입
const isSocketConnected = inject('isSocketConnected');

// 실제 Socket.IO 인스턴스를 직접 참조하기 위한 변수
const socket = socketRef.value;

const roomId = ref(route.params.id);
const roomName = ref('불러오는 중...');
const betAmount = ref(0);
const players = ref([]);
const myUserId = ref(parseInt(localStorage.getItem('user_id')));

const roomStatus = ref('loading');
const roomCreatorId = ref(null);
const currentBet = ref(0);
const pot = ref(0);

const myHand = ref([]);
const currentTurnPlayerId = ref(null);

const currentBettingRoundIndex = ref(0);
const currentExchangeOpportunityIndex = ref(-1);
const gameRoundName = ref('대기 중');
const currentPhase = ref('loading');

const maxBettingRounds = ref(4);
const maxExchangeOpportunities = ref(3);

const showGameEndedModal = ref(false);
const gameWinnerNames = ref([]);
const gameEndReason = ref('');
const finalHands = ref({});

const dealerId = ref(null);
const smallBlindId = ref(null);
const bigBlindId = ref(null);

// ✨ REMOVED: gameEventLogs는 UI에서 제거되었으므로 더 이상 필요 없습니다.
// const gameEventLogs = ref([]);
const timeLeft = ref(0);

const selectedCardsIds = ref([]); // 교환할 카드 ID 목록

// -----------------------------------------------------------
// 2. Computed 속성
// -----------------------------------------------------------
const isMyTurn = computed(() => currentTurnPlayerId.value === myUserId.value);
const isRoomCreator = computed(() => roomCreatorId.value === myUserId.value);
const myPlayer = computed(() => {
    const player = players.value.find(p => p.id === myUserId.value);
    if (player) {
        player.isDealer = dealerId.value === myUserId.value;
        player.isSmallBlind = smallBlindId.value === myUserId.value;
        player.isBigBlind = bigBlindId.value === myUserId.value;
    }
    return player;
});
const currentTurnPlayer = computed(() => players.value.find(p => p.id === currentTurnPlayerId.value));
const room = computed(() => ({
    id: roomId.value, name: roomName.value, betAmount: betAmount.value, maxPlayers: 5, players: players.value,
    status: roomStatus.value, creatorId: roomCreatorId.value, currentTurnPlayerId: currentTurnPlayerId.value,
    currentBet: currentBet.value, pot: pot.value, currentBettingRoundIndex: currentBettingRoundIndex.value,
    currentExchangeOpportunityIndex: currentExchangeOpportunityIndex.value, gameRoundName: gameRoundName.value,
    currentPhase: currentPhase.value, maxBettingRounds: maxBettingRounds.value, maxExchangeOpportunities: maxExchangeOpportunities.value,
    dealerId: dealerId.value, smallBlindId: smallBlindId.value, bigBlindId: bigBlindId.value
}));
const displayRoomStatus = computed(() => {
    switch(roomStatus.value) {
        case 'waiting': return '대기 중'; case 'playing': return '게임 중'; case 'showdown': return '쇼다운'; case 'ended': return '게임 종료'; default: return '알 수 없음';
    }
});
const displayCurrentPhase = computed(() => {
    switch(currentPhase.value) {
        case 'betting': return '베팅 페이즈'; case 'exchange': return '카드 교환 페이즈'; case 'waiting': return '대기'; default: return '알 수 없음';
    }
});
const canBettingPhaseAction = computed(() => isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved && room.value.status === 'playing' && room.value.currentPhase === 'betting');
const canExchangePhaseAction = computed(() => isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved && room.value.status === 'playing' && room.value.currentPhase === 'exchange');
const isMyFirstActionInRound = computed(() => room.value.players.every(p => !p.hasActedInBettingRound));
const hasOtherPlayersActedInRound = computed(() => room.value.players.some(p => p.id !== myUserId.value && p.hasActedInBettingRound));
const canCheck = computed(() => canBettingPhaseAction.value && room.value.currentBet === 0 && isMyFirstActionInRound.value);
const myChipsToPayForCall = computed(() => {
    if (!canBettingPhaseAction.value) return 0;
    const myCurrentRoundBet = myPlayer.value?.currentRoundBet || 0; const currentHighestBet = room.value.currentBet;
    if (currentHighestBet === 0) return 0;
    const chipsToPay = currentHighestBet - myCurrentRoundBet;
    return chipsToPay > 0 ? Math.min(chipsToPay, myPlayer.value?.chips || 0) : 0;
});
const canCall = computed(() => {
    if (!canBettingPhaseAction.value) return false;
    const myChips = myPlayer.value?.chips || 0; const chipsToPay = myChipsToPayForCall.value;
    if (isMyFirstActionInRound.value && room.value.currentBet === 0) return false;
    if (room.value.currentBet === 0 && chipsToPay === 0 && hasOtherPlayersActedInRound.value) return true;
    return chipsToPay > 0 && myChips >= chipsToPay;
});
const myTargetTotalBetForBbing = computed(() => {
    if (!canBettingPhaseAction.value) return 0;
    const bbingUnit = room.value.betAmount; const currentHighestBet = room.value.currentBet;
    let targetTotalBet = (currentHighestBet === 0) ? bbingUnit : (currentHighestBet + bbingUnit);
    if (targetTotalBet < bbingUnit) return 0;
    const chipsToPay = targetTotalBet - (myPlayer.value?.currentRoundBet || 0);
    return (myPlayer.value?.chips || 0) >= chipsToPay ? targetTotalBet : 0;
});
const myChipsToPayForBbing = computed(() => {
    const targetTotalBet = myTargetTotalBetForBbing.value;
    if (targetTotalBet === 0) return 0; return targetTotalBet - (myPlayer.value?.currentRoundBet || 0);
});
const canBbing = computed(() => !canBettingPhaseAction.value ? false : myTargetTotalBetForBbing.value > 0);
const calculateChipsNeededForTotalBet = (totalTargetBet) => totalTargetBet - (myPlayer.value?.currentRoundBet || 0);
const getRaiseAmountForHalf = computed(() => {
    const pot = room.value.pot || 0; const currentBet = room.value.currentBet || 0; const minRaiseUnit = room.value.betAmount || 0;
    let targetTotalBet = (currentBet === 0) ? (minRaiseUnit + Math.floor(pot / 2)) : (currentBet + Math.floor(pot / 2));
    const minPossibleRaiseTotal = currentBet === 0 ? minRaiseUnit : currentBet + minRaiseUnit;
    return Math.max(targetTotalBet, minPossibleRaiseTotal);
});
const canRaiseToHalf = computed(() => {
    if (!canBettingPhaseAction.value) return false; const totalTargetBet = getRaiseAmountForHalf.value; const amountNeeded = calculateChipsNeededForTotalBet(totalTargetBet);
    const myChips = myPlayer.value?.chips || 0; if (amountNeeded <= 0) return false; if (myChips < amountNeeded) return false;
    if (room.value.currentBet === 0) return totalTargetBet >= room.value.betAmount;
    else return totalTargetBet >= (room.value.currentBet + room.value.betAmount);
});
const getRaiseAmountForFull = computed(() => {
    const pot = room.value.pot || 0; const currentBet = room.value.currentBet || 0; const minRaiseUnit = room.value.betAmount || 0;
    let targetTotalBet = (currentBet === 0) ? (minRaiseUnit + pot) : (currentBet + pot);
    const minPossibleRaiseTotal = currentBet === 0 ? minRaiseUnit : currentBet + minRaiseUnit;
    return Math.max(targetTotalBet, minPossibleRaiseTotal);
});
const canRaiseToFull = computed(() => {
    if (!canBettingPhaseAction.value) return false; const totalTargetBet = getRaiseAmountForFull.value; const amountNeeded = calculateChipsNeededForTotalBet(totalTargetBet);
    const myChips = myPlayer.value?.chips || 0; if (amountNeeded <= 0) return false; if (myChips < amountNeeded) return false;
    if (room.value.currentBet === 0) return totalTargetBet >= room.value.betAmount;
    else return totalTargetBet >= (room.value.currentBet + room.value.betAmount);
});
const canDie = computed(() => isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved && room.value.status === 'playing');
const canExchangeCards = computed(() => canExchangePhaseAction.value && myPlayer.value?.canExchange === true && room.value.currentExchangeOpportunityIndex > -1 && room.value.currentExchangeOpportunityIndex < room.value.maxExchangeOpportunities);
const canStay = computed(() => canExchangePhaseAction.value && myPlayer.value?.canExchange === true && room.value.currentExchangeOpportunityIndex > -1 && room.value.currentExchangeOpportunityIndex < room.value.maxExchangeOpportunities);

// -----------------------------------------------------------
// 3. 헬퍼 함수
// -----------------------------------------------------------
const getPlayerRoleBadges = (player) => {
    const roles = [];
    if (player.isCreator) roles.push({ text: '방장', class: 'badge-info' });
    if (player.isDealer) roles.push({ text: 'D', class: 'badge-dark' });
    if (player.isSmallBlind) roles.push({ text: 'SB', class: 'badge-warning' });
    if (player.isBigBlind) roles.push({ text: 'BB', class: 'badge-danger' });
    return roles;
};

// ✨ REMOVED: addGameEventLog 함수는 UI에서 제거되었으므로 더 이상 필요 없습니다.
// const addGameEventLog = (message, type = 'info') => {
//     const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
//     gameEventLogs.value.unshift({ message: `[${timestamp}] ${message}`, type: `log-${type}` });
//     if (gameEventLogs.value.length > 50) {
//         gameEventLogs.value.pop();
//     }
// };

const toggleCardSelection = (cardId) => {
    if (!canExchangePhaseAction.value || !myPlayer.value?.canExchange) {
        logger.notify('지금은 카드를 선택할 수 없습니다. 카드 교환 페이즈에만 가능하며, 교환 기회가 있어야 합니다.', 'warn');
        // addGameEventLog('카드 선택 실패: 교환 불가 조건', 'warn'); // REMOVED
        return;
    }
    if (room.value.currentExchangeOpportunityIndex === -1 || room.value.currentExchangeOpportunityIndex >= room.value.maxExchangeOpportunities) {
        logger.notify('현재 라운드에는 카드를 교환할 수 없습니다. 교환 기회를 확인하세요.', 'warn');
        // addGameEventLog('카드 선택 실패: 교환 기회 없음', 'warn'); // REMOVED
        return;
    }
    const index = selectedCardsIds.value.indexOf(cardId);
    if (index > -1) {
        selectedCardsIds.value.splice(index, 1);
        // addGameEventLog(`카드 선택 해제: ${cardId}`); // REMOVED
    } else {
        if (selectedCardsIds.value.length < 4) {
            selectedCardsIds.value.push(cardId);
            // addGameEventLog(`카드 선택: ${cardId}`); // REMOVED
        } else {
            logger.notify('카드는 최대 4장까지 선택할 수 있습니다.', 'warn');
            // addGameEventLog('카드 선택 최대 4장 초과', 'warn'); // REMOVED
        }
    }
};

const isCardSelected = (cardId) => cardId !== null && selectedCardsIds.value.includes(cardId);

const getCardTitle = (card, isMyCard) => {
    if (!card || card.suit === 'back' || card.rank === 'back') return 'Hidden Card';
    if (roomStatus.value === 'showdown' || roomStatus.value === 'ended') return `${card.suit}${card.rank}`;
    return isMyCard ? `${card.suit}${card.rank}` : 'Hidden Card';
};

const getCardClass = (card, showFront = true, isSelected = false) => {
    const classes = ['card-face'];
    if (card === null) { classes.push('card-empty-slot'); return classes; }
    if (card.suit === 'back' || card.rank === 'back') { /* img 태그로 뒷면 이미지 */ }
    else if (shouldShowCardFace(card, showFront)) {
        classes.push(`suit-${card.suit.toLowerCase()}`);
        const rankClass = card.rank === 'T' ? 't' : card.rank.toLowerCase();
        classes.push(`rank-${rankClass}`);
    } else { /* img 태그로 뒷면 이미지 */ }
    if (isSelected) { classes.push('card-selected'); }
    return classes;
};

const getPlayerCards = (playerId) => {
    if (playerId === myUserId.value) {
        const displayHand = [...myHand.value];
        while (displayHand.length < 4) { displayHand.push(null); }
        return displayHand;
    } else {
        return Array(4).fill(null).map((_, index) => ({ id: `back-${playerId}-${index}`, suit: 'back', rank: 'back' }));
    }
};

const shouldShowCardFace = (card, isMyCard) => {
    if (card === null) return false; if (card.suit === 'back' || card.rank === 'back') return false;
    if (room.value.status === 'showdown' || room.value.status === 'ended') {
        const playerFinalHand = finalHands.value[players.value.find(p => p.id === myUserId.value)?.id || ''];
        if (isMyCard && playerFinalHand && playerFinalHand.some(fc => fc.id === card.id)) return true;
        return true;
    }
    return isMyCard;
};


// -----------------------------------------------------------
// 4. 이벤트 핸들러 함수
// -----------------------------------------------------------

// 게임 서버 이벤트 핸들러
const handleRoomUpdated = (updatedRoom) => {
    if (updatedRoom.id == roomId.value) {
        logger.log('[GameRoom] 방 정보 업데이트 수신:', updatedRoom);
        // addGameEventLog('방 정보 업데이트 수신', 'info'); // REMOVED
        roomName.value = updatedRoom.name;
        betAmount.value = updatedRoom.betAmount;
        players.value = updatedRoom.players;
        roomStatus.value = updatedRoom.status;
        roomCreatorId.value = updatedRoom.creatorId;
        currentTurnPlayerId.value = updatedRoom.currentTurnPlayerId;
        currentBet.value = updatedRoom.currentBet;
        pot.value = updatedRoom.pot;

        currentBettingRoundIndex.value = updatedRoom.currentBettingRoundIndex;
        currentExchangeOpportunityIndex.value = updatedRoom.currentExchangeOpportunityIndex;
        gameRoundName.value = updatedRoom.gameRoundName;
        currentPhase.value = updatedRoom.currentPhase;
        maxBettingRounds.value = updatedRoom.maxBettingRounds || 4;
        maxExchangeOpportunities.value = updatedRoom.maxExchangeOpportunities || 3;

        dealerId.value = updatedRoom.dealerId;
        smallBlindId.value = updatedRoom.smallBlindId;
        bigBlindId.value = updatedRoom.bigBlindId;
    }
};

const handleGameStarted = (data) => {
    logger.log('[GameRoom] 게임 시작 이벤트 수신:', data);
    // addGameEventLog('게임 시작! 🃏', 'important'); // REMOVED

    if (!data || !data.room) {
        logger.error('[GameRoom] gameStarted 이벤트 데이터 또는 room 객체가 유효하지 않습니다.', data);
        // addGameEventLog('게임 시작 데이터 오류. 로비로 돌아갑니다.', 'error'); // REMOVED
        router.replace('/lobby');
        return;
    }

    roomStatus.value = data.room.status;
    players.value = data.room.players;
    currentTurnPlayerId.value = data.currentPlayerId;
    myHand.value = data.myHand;
    currentBet.value = data.room.currentBet;
    pot.value = data.room.pot;

    currentBettingRoundIndex.value = data.currentBettingRoundIndex;
    currentExchangeOpportunityIndex.value = data.currentExchangeOpportunityIndex;
    gameRoundName.value = data.gameRoundName;
    currentPhase.value = data.currentPhase;
    maxBettingRounds.value = data.maxBettingRounds;
    maxExchangeOpportunities.value = data.maxExchangeOpportunities;

    dealerId.value = data.dealerId;
    smallBlindId.value = data.smallBlindId;
    bigBlindId.value = data.bigBlindId;

    logger.notify('게임이 시작되었습니다!', 'info');
    selectedCardsIds.value = [];
};

const handleRoundStarted = (data) => {
    logger.log('[GameRoom] 라운드 시작 이벤트 수신:', data);
    // addGameEventLog(`${data.gameRoundName} 라운드 시작! 💰`, 'important'); // REMOVED
    currentBettingRoundIndex.value = data.currentBettingRoundIndex;
    currentExchangeOpportunityIndex.value = data.currentExchangeOpportunityIndex;
    gameRoundName.value = data.gameRoundName;
    currentPhase.value = data.currentPhase;
    currentBet.value = data.currentBet;
    pot.value = data.pot;
    selectedCardsIds.value = [];
    logger.notify(`${data.gameRoundName} 라운드가 시작되었습니다!`, 'info');
};

const handlePhaseChanged = (data) => {
    logger.log('[GameRoom] 페이즈 변경 이벤트 수신:', data);
    // addGameEventLog(`페이즈 변경: ${data.currentPhase === 'betting' ? '베팅 페이즈' : '카드 교환 페이즈'}`, 'info'); // REMOVED
    currentBettingRoundIndex.value = data.currentBettingRoundIndex;
    currentExchangeOpportunityIndex.value = data.currentExchangeOpportunityIndex;
    gameRoundName.value = data.gameRoundName;
    currentPhase.value = data.currentPhase;
    currentBet.value = data.currentBet;
    pot.value = data.value.pot;
    logger.notify(data.message || `현재 페이즈: ${displayCurrentPhase.value}`, 'info');
    selectedCardsIds.value = [];
};

const handleTurnChanged = (data) => {
    logger.log('[GameRoom] 턴 변경 이벤트 수신:', data);
    const player = players.value.find(p => p.id === data.currentPlayerId);
    if (player) {
        // addGameEventLog(`${player.name}님의 턴입니다. (남은 시간: ${data.timeLeft}초)`, 'info'); // REMOVED
    }
    currentTurnPlayerId.value = data.currentPlayerId;
    timeLeft.value = data.timeLeft;
    if (isMyTurn.value) {
        logger.notify('당신의 턴입니다!', 'info');
        if (currentPhase.value === 'betting') {
            const logMessage = `버튼 상태: Check: ${canCheck.value}, Call: ${canCall.value} (낼 금액: ${myChipsToPayForCall.value}), Bbing (낼 금액: ${myChipsToPayForBbing.value}) (총: ${myTargetTotalBetForBbing.value}): ${canBbing.value}, Half (낼 금액: ${calculateChipsNeededForTotalBet(getRaiseAmountForHalf.value)}) (총: ${getRaiseAmountForHalf.value}): ${canRaiseToHalf.value}, Full (낼 금액: ${calculateChipsNeededForTotalBet(getRaiseAmountForFull.value)}) (총: ${getRaiseAmountForFull.value}): ${canRaiseToFull.value}, Die: ${canDie.value}`;
            // addGameEventLog(`(내 턴) 라운드의 첫 액션 플레이어 (베팅 시작): ${logMessage}`, 'debug'); // REMOVED
            logger.log(`[GameRoom] ${logMessage}`);
        }
    }
    selectedCardsIds.value = [];
};

const handlePlayerActionEvt = (data) => {
    logger.log('[GameRoom] 플레이어 액션 이벤트 수신:', data);
    if (data.actionType === 'allIn') {
        // addGameEventLog(data.message, 'warn'); // REMOVED
        logger.notify(data.message, 'warning');
    } else if (data.actionType === 'autoDie') {
        // addGameEventLog(data.message, 'error'); // REMOVED
        logger.notify(data.message, 'error');
    } else if (data.actionType === 'autoStay') {
        // addGameEventLog(data.message, 'warn'); // REMOVED
        logger.notify(data.message, 'info');
    } else {
        // addGameEventLog(data.message, 'action'); // REMOVED
        logger.notify(data.message, 'info');
    }
};

const handleMyHandUpdated = (data) => {
    logger.log('[GameRoom] 내 패 업데이트 이벤트 수신:', data);
    // addGameEventLog('내 패가 업데이트되었습니다! 🃏', 'info'); // REMOVED
    myHand.value = data.hand;
    if (data.bestHand) {
        const player = players.value.find(p => p.id === myUserId.value);
        if (player) player.bestHand = data.bestHand;
    }
    logger.notify('카드를 교환하여 새로운 패를 받았습니다!', 'info');
    selectedCardsIds.value = [];
};

const handleGameEnded = (data) => {
    logger.log('[GameRoom] 게임 종료 이벤트 수신:', data);
    // addGameEventLog('게임 종료! 🏆', 'important'); // REMOVED
    roomStatus.value = data.roomStatus || 'ended';
    gameWinnerNames.value = data.winnerNames || [];
    gameEndReason.value = data.reason || '게임이 종료되었습니다.';
    finalHands.value = data.finalHands || {};
    showGameEndedModal.value = true;
    logger.notify('게임이 종료되었습니다!', 'info');
    selectedCardsIds.value = [];
};

const handleForceLeaveRoom = (data) => {
  logger.warn(`[GameRoom] 서버로부터 강제 퇴장 요청: ${data.message}`);
  // addGameEventLog(`강제 퇴장: ${data.message}`, 'error'); // REMOVED
  logger.notify(data.message || '방에서 강제 퇴장되었습니다.', 'warn');
  router.replace('/lobby');
};

const handleTimerUpdate = (data) => {
    if (data.currentPlayerId === currentTurnPlayerId.value) {
        timeLeft.value = data.timeLeft;
        if (isMyTurn.value && data.timeLeft <= 5 && data.timeLeft > 0) {
            logger.notify(`${data.timeLeft}초 남았습니다!`, 'warn');
        }
    }
};

// 액션 관련 함수
const handleLeaveRoom = () => {
    if (isRoomCreator.value && players.value.length > 1 && room.value.status === 'waiting') {
        logger.notify('다른 플레이어가 있는 대기 중인 방장은 나갈 수 없습니다.', 'warn');
        // addGameEventLog('방장: 다른 플레이어 있으면 대기 중인 방 나갈 수 없음', 'warn'); // REMOVED
        return;
    }
    if (room.value.status === 'playing' && myPlayer.value && !myPlayer.value.leaveReserved) {
        if (confirm('게임이 진행 중입니다. 게임 종료 후 방을 나가시겠습니까?')) {
            if (socket) {
                socket.emit('reserveLeaveRoom', roomId.value, (response) => {
                    if (response.success) {
                        logger.notify('게임 종료 후 퇴장 예약되었습니다.', 'info');
                        // addGameEventLog('퇴장 예약 성공', 'info'); // REMOVED
                    } else {
                        logger.notify('퇴장 예약 실패: ' + response.message, 'error');
                        // addGameEventLog(`퇴장 예약 실패: ${response.message}`, 'error'); // REMOVED
                    }
                });
            } else {
                logger.error('[GameRoom] Socket.IO 인스턴스가 없어 reserveLeaveRoom 이벤트를 보낼 수 없습니다.');
                // addGameEventLog('Socket.IO 인스턴스 없음. 퇴장 예약 실패.', 'error'); // REMOVED
            }
        }
    } else {
        leaveRoom();
    }
};

const leaveRoom = () => {
  if (!isSocketConnected.value) {
      logger.warn('[GameRoom] Socket.IO 연결이 끊어진 상태에서 방 나가기 요청. 로그인 페이지로 리다이렉트.');
      // addGameEventLog('Socket 연결 끊김. 방 나가기 실패.', 'error'); // REMOVED
      router.replace('/login');
      return;
  }
  if (socket) {
    socket.emit('leaveRoom', roomId.value, (response) => {
      if (response.success) {
        logger.log('방 나가기 성공');
        // addGameEventLog('방 나가기 성공', 'info'); // REMOVED
        router.replace('/lobby');
      } else {
        logger.notify('방 나가기 실패: ' + (response.message || '알 수 없는 오류'), 'error');
        // addGameEventLog(`방 나가기 실패: ${response.message || '알 수 없는 오류'}`, 'error'); // REMOVED
      }
    });
  } else {
      logger.error('[GameRoom] Socket.IO 인스턴스가 없어 leaveRoom 이벤트를 보낼 수 없습니다.');
      // addGameEventLog('Socket.IO 인스턴스 없음. 방 나가기 실패.', 'error'); // REMOVED
  }
};

const cancelLeaveRoom = () => {
    if (room.value.status === 'playing' && myPlayer.value && myPlayer.value.leaveReserved) {
        if (socket) {
            socket.emit('cancelLeaveRoom', roomId.value, (response) => {
                if (response.success) {
                    logger.notify('퇴장 예약이 취소되었습니다.', 'info');
                    // addGameEventLog('퇴장 예약 취소 성공', 'info'); // REMOVED
                } else {
                    logger.notify('퇴장 예약 취소 실패: ' + response.message, 'error');
                    // addGameEventLog(`퇴장 예약 취소 실패: ${response.message}`, 'error'); // REMOVED
                }
            });
        } else {
            logger.error('[GameRoom] Socket.IO 인스턴스가 없어 cancelLeaveRoom 이벤트를 보낼 수 없습니다.');
            // addGameEventLog('Socket.IO 인스턴스 없음. 퇴장 예약 취소 실패.', 'error'); // REMOVED
        }
    }
};

const startGame = () => {
    if (socket?.connected && isRoomCreator.value && room.value.status === 'waiting') {
        if (players.value.length < 2) {
            logger.notify('최소 2명 이상의 플레이어가 있어야 게임을 시작할 수 있습니다.', 'warn');
            // addGameEventLog('게임 시작 실패: 최소 인원 미달', 'warn'); // REMOVED
            return;
        }
        logger.log('게임 시작 요청');
        // addGameEventLog('게임 시작 요청', 'info'); // REMOVED
        if (socket) {
            socket.emit('startGame', roomId.value, (response) => {
                if (response.success) {
                    logger.log('게임 시작 성공!');
                    // addGameEventLog('게임 시작 성공!', 'success'); // REMOVED
                } else {
                    logger.notify('게임 시작 실패: ' + response.message, 'error');
                    // addGameEventLog(`게임 시작 실패: ${response.message}`, 'error'); // REMOVED
                }
            });
        } else {
            logger.error('[GameRoom] Socket.IO 인스턴스가 없어 startGame 이벤트를 보낼 수 없습니다.');
            // addGameEventLog('Socket.IO 인스턴스 없음. 게임 시작 실패.', 'error'); // REMOVED
        }
    } else if (room.value.status === 'playing') {
        logger.notify('이미 게임이 진행 중입니다.', 'warn');
        // addGameEventLog('게임 시작 실패: 이미 게임 중', 'warn'); // REMOVED
    } else if (!isRoomCreator.value) {
        logger.notify('방장만 게임을 시작할 수 있습니다.', 'warn');
        // addGameEventLog('게임 시작 실패: 방장만 가능', 'warn'); // REMOVED
    }
};


const handlePlayerAction = (actionType, payload = null) => {
    if (!isMyTurn.value) { logger.notify('지금은 당신의 턴이 아닙니다.', 'warn'); return; }
    if (!socket?.connected) { logger.notify('Socket.IO 연결이 끊어졌습니다. 액션을 수행할 수 없습니다.', 'error'); router.replace('/login'); return; }
    if (myPlayer.value?.chips <= 0 && actionType !== 'die' && actionType !== 'call') { logger.notify('칩이 부족하여 해당 액션을 할 수 없습니다. 다이하거나 올인 콜하세요.', 'warn'); return; }

    const isBettingPhaseActionCheck = (actionType === 'bet' || actionType === 'call' || actionType === 'raise' || actionType === 'check');
    const isExchangePhaseActionCheck = (actionType === 'exchange' || actionType === 'stay');
    const isCommonAction = (actionType === 'die');

    if (room.value.currentPhase === 'betting') {
        if (!isBettingPhaseActionCheck && !isCommonAction) { logger.notify('현재는 베팅 페이즈입니다. 베팅 관련 액션 또는 다이를 선택하세요.', 'warn'); /* addGameEventLog('액션 실패: 현재 페이즈와 액션 불일치 (베팅 페이즈)', 'warn'); */ return; }
    } else if (room.value.currentPhase === 'exchange') {
        if (!isExchangePhaseActionCheck && !isCommonAction) { logger.notify('현재는 카드 교환 페이즈입니다. 교환/스테이 또는 다이를 선택하세요.', 'warn'); /* addGameEventLog('액션 실패: 현재 페이즈와 액션 불일치 (교환 페이즈)', 'warn'); */ return; }
        if (isExchangePhaseActionCheck && (room.value.currentExchangeOpportunityIndex === -1 || room.value.currentExchangeOpportunityIndex >= room.value.maxExchangeOpportunities)) { logger.notify('현재 라운드에는 카드 교환을 할 수 없습니다.', 'warn'); /* addGameEventLog('액션 실패: 유효한 교환 기회가 아님', 'warn'); */ return; }
    } else { logger.notify(`현재 게임 상태(${displayCurrentPhase.value})에서는 해당 액션을 할 수 없습니다.`, 'warn'); /* addGameEventLog(`액션 실패: 현재 페이즈(${displayCurrentPhase.value})에서 액션 불가`, 'warn'); */ return; }

    let finalAmount = null; let cardsToExchangeData = undefined;

    switch (actionType) {
        case 'check':
            if (!canCheck.value) { logger.notify('체크할 수 없습니다. 조건을 확인하세요.', 'warn'); /* addGameEventLog('액션 실패: 체크 불가 (조건 불충족)', 'warn'); */ return; } finalAmount = 0; break;
        case 'call':
            if (!canCall.value) { logger.notify('콜할 수 없습니다. 조건을 확인하세요.', 'warn'); /* addGameEventLog('액션 실패: 콜 불가 (조건 불충족)', 'warn'); */ return; } finalAmount = room.value.currentBet;
            if (room.value.currentBet === 0 && myChipsToPayForCall.value === 0) { finalAmount = 0; } break;
        case 'die': finalAmount = 0; break;
        case 'stay': cardsToExchangeData = []; finalAmount = 0; break;
        case 'bet':
            if (!canBbing.value) { logger.notify('현재 삥을 걸 수 없습니다. 조건을 확인하세요.', 'warn'); /* addGameEventLog('액션 실패: 삥 불가 (조건 불충족)', 'warn'); */ return; } finalAmount = myTargetTotalBetForBbing.value; break;
        case 'raise': {
            if ((payload === getRaiseAmountForHalf.value && !canRaiseToHalf.value) || (payload === getRaiseAmountForFull.value && !canRaiseToFull.value)) { logger.notify('레이즈할 수 없습니다. 조건을 확인하세요.', 'warn'); /* addGameEventLog('액션 실패: 레이즈 불가 (조건 불충족)', 'warn'); */ return; }
            finalAmount = payload; if (typeof finalAmount !== 'number' || finalAmount <= 0) { logger.notify('유효한 레이즈 금액을 입력해주세요.', 'warn'); /* addGameEventLog('액션 실패: 유효하지 않은 레이즈 금액', 'warn'); */ return; }
            const currentMinRaiseTotal = room.value.currentBet === 0 ? room.value.betAmount : (room.value.currentBet + room.value.betAmount);
            if (room.value.currentBet === 0) { if (finalAmount < room.value.betAmount) { logger.notify(`레이즈는 총 ${room.value.betAmount} 칩 이상으로 해야 합니다.`, 'warn'); /* addGameEventLog(`액션 실패: 선 레이즈 최소 금액 미달 (최소: ${room.value.betAmount})`, 'warn'); */ return; } }
            else { if (finalAmount < currentMinRaiseTotal) { logger.notify(`레이즈는 총 ${currentMinRaiseTotal} 칩 이상으로 해야 합니다.`, 'warn'); /* addGameEventLog(`액션 실패: 레이즈 최소 금액 미달 (최소: ${currentMinRaiseTotal})`, 'warn'); */ return; } }
            if (calculateChipsNeededForTotalBet(finalAmount) > (myPlayer.value?.chips || 0)) { logger.notify('칩이 부족하여 레이즈할 수 없습니다.', 'warn'); /* addGameEventLog('액션 실패: 칩 부족으로 레이즈 불가', 'warn'); */ return; }
        } break;
        case 'exchange': {
            if (!canExchangeCards.value) { logger.notify('카드를 교환할 수 없습니다. 조건을 확인하세요.', 'warn'); /* addGameEventLog('액션 실패: 카드 교환 불가 (조건 불충족)', 'warn'); */ return; }
            cardsToExchangeData = selectedCardsIds.value; if (!Array.isArray(cardsToExchangeData) || cardsToExchangeData.length < 0 || cardsToExchangeData.length > 4) { logger.notify('교환할 카드는 0~4장만 선택해주세요.', 'warn'); /* addGameEventLog('액션 실패: 유효하지 않은 교환 카드 수', 'warn'); */ return; }
        } break;
        default: logger.notify('알 수 없는 게임 액션입니다.', 'error'); /* addGameEventLog('액션 실패: 알 수 없는 액션 타입', 'error'); */ return;
    }

    logger.log(`[GameRoom] 플레이어 액션 전송: ${actionType}, Amount: ${finalAmount}, CardsToExchange:`, cardsToExchangeData);
    // addGameEventLog(`액션 전송: ${actionType} (금액: ${finalAmount !== null ? finalAmount : 'N/A'}, 교환 카드: ${cardsToExchangeData ? cardsToExchangeData.length + '장' : '없음'})`, 'info'); // REMOVED

    if (socket) {
      socket.emit('playerAction', { roomId: roomId.value, action: actionType, amount: finalAmount, cardsToExchange: cardsToExchangeData }, (response) => {
          if (response.success) { logger.log('[GameRoom] 액션 요청 성공:', actionType); /* addGameEventLog(`액션 성공: ${actionType}`, 'success'); */ selectedCardsIds.value = []; }
          else { logger.notify('액션 실패: ' + (response.message || '알 수 없는 오류'), 'error'); /* addGameEventLog(`액션 실패: ${response.message || '알 수 없는 오류'}`, 'error'); */ }
      });
    } else {
        logger.error('[GameRoom] Socket.IO 인스턴스가 없어 playerAction 이벤트를 보낼 수 없습니다.');
        // addGameEventLog('Socket.IO 인스턴스 없음. 액션 실패.', 'error'); // REMOVED
    }
};

const requestRoomInfo = () => {
    logger.log(`[GameRoom] Socket.IO 연결 상태:`, isSocketConnected.value);
    if (!isSocketConnected.value) {
        logger.warn(`[GameRoom] Socket.IO 연결되지 않음. 로그인 페이지로 리다이렉트.`);
        // addGameEventLog('Socket 연결되지 않아 방 정보 요청 불가.', 'error'); // REMOVED
        router.replace('/login');
        return;
    }

    logger.log(`[GameRoom] Socket.IO 연결됨, 방 ${roomId.value} 정보 요청 중...`);
    // addGameEventLog(`방 ${roomId.value} 정보 요청 중...`, 'info'); // REMOVED
    if (socket) {
        socket.emit('getRoomInfo', roomId.value, (response) => {
            if (response.success && response.room) {
                logger.log('초기 방 정보 수신:', response.room);
                // addGameEventLog('초기 방 정보 수신 완료.', 'info'); // REMOVED
                roomName.value = response.room.name; betAmount.value = response.room.betAmount; players.value = response.room.players;
                roomStatus.value = response.room.status; roomCreatorId.value = response.room.creatorId; currentTurnPlayerId.value = response.room.currentTurnPlayerId;
                currentBet.value = response.room.currentBet; pot.value = response.room.pot;
                currentBettingRoundIndex.value = response.room.currentBettingRoundIndex; currentExchangeOpportunityIndex.value = response.room.currentExchangeOpportunityIndex;
                gameRoundName.value = response.room.gameRoundName; currentPhase.value = response.room.currentPhase;
                maxBettingRounds.value = response.room.maxBettingRounds || 4; maxExchangeOpportunities.value = response.room.maxExchangeOpportunities || 3;
                dealerId.value = response.room.dealerId; smallBlindId.value = response.room.smallBlindId; bigBlindId.value = response.room.bigBlindId;
                timeLeft.value = 0;

                if (!response.room.players.some(p => p.id === myUserId.value) && response.room.status === 'waiting') {
                    if (socket) {
                        socket.emit('joinRoom', { roomId: roomId.value, password: null }, (joinResponse) => {
                            if (!joinResponse.success) {
                                logger.notify('방 입장 실패: ' + joinResponse.message, 'error'); // addGameEventLog(`방 입장 실패: ${joinResponse.message}`, 'error'); // REMOVED
                                router.replace('/lobby');
                            } else { /* addGameEventLog('방 입장 성공!', 'success'); */ } // REMOVED
                        });
                    }
                } else if (!response.room.players.some(p => p.id === myUserId.value) && response.room.status === 'playing') {
                    logger.notify('게임 중인 방에는 입장할 수 없습니다.', 'warn'); // addGameEventLog('게임 중인 방 입장 불가.', 'warn'); // REMOVED
                    router.replace('/lobby');
                }
            } else {
                logger.notify('방 정보를 가져오지 못했습니다: ' + (response.message || '알 수 없는 오류'), 'error'); // addGameEventLog(`방 정보 요청 실패: ${response.message || '알 수 없는 오류'}`, 'error'); // REMOVED
                router.replace('/lobby');
            }
        });
    } else {
        logger.error('[GameRoom] Socket.IO 인스턴스 없음. 방 정보 요청 실패.'); // addGameEventLog('Socket.IO 인스턴스 없음. 방 정보 요청 실패.', 'error'); // REMOVED
    }
};

const handleBeforeUnload = (event) => {
    if (isRoomCreator.value && players.value.length > 1 && room.value.status === 'waiting') {
        event.preventDefault(); event.returnValue = '다른 플레이어가 있는 대기 중인 방장은 나갈 수 없습니다. 새로고침 시 강제 퇴장됩니다.';
        logger.warn('페이지를 새로고침하면 다른 플레이어가 있는 방에서 강제 퇴장됩니다!'); // addGameEventLog('새로고침 시도: 방장이므로 강제 퇴장 경고', 'warn'); // REMOVED
        return '';
    } else if (room.value.status === 'playing') {
        event.preventDefault(); event.returnValue = '게임이 진행 중입니다. 새로고침 시 게임에서 강제 퇴장됩니다.';
        logger.warn('페이지를 새로고침하면 게임에서 강제 퇴장됩니다!'); // addGameEventLog('새로고침 시도: 게임 중이므로 강제 퇴장 경고', 'warn'); // REMOVED
        return '';
    }
};

const closeGameEndedModal = () => { showGameEndedModal.value = false; };

// -----------------------------------------------------------
// 5. 라이프사이클 훅 (onMounted, onUnmounted)
// -----------------------------------------------------------
onMounted(() => {
    // Socket.IO 인스턴스가 `socketRef.value`에 할당된 후에 이벤트 리스너를 등록합니다.
    const unwatchIsConnected = watch(isSocketConnected, (newValue) => {
        logger.log('[GameRoom] isSocketConnected watch 발동, newValue:', newValue);
        if (newValue === true) {
            logger.log('[GameRoom] isSocketConnected가 true로 변경됨, 방 정보 요청 및 이벤트 리스너 등록.');
            // addGameEventLog('Socket 연결됨, 방 정보 요청 시작.', 'info'); // REMOVED

            // ✨ FIX: Socket.IO 인스턴스 참조를 `socketRef.value` 대신 `socket` 변수를 사용
            if (socket) {
                socket.on('roomUpdated', handleRoomUpdated);
                socket.on('gameStarted', handleGameStarted);
                socket.on('roundStarted', handleRoundStarted);
                socket.on('phaseChanged', handlePhaseChanged);
                socket.on('turnChanged', handleTurnChanged);
                socket.on('playerAction', handlePlayerActionEvt);
                socket.on('myHandUpdated', handleMyHandUpdated);
                socket.on('gameEnded', handleGameEnded);
                socket.on('forceLeaveRoom', handleForceLeaveRoom);
                socket.on('timerUpdate', handleTimerUpdate);
            } else {
                logger.error('[GameRoom] onMounted watch: Socket.IO 인스턴스가 여전히 null입니다. 로비로 리다이렉트.');
                // addGameEventLog('onMounted watch: Socket.IO 인스턴스 없음. 게임방 진입 실패.', 'error'); // REMOVED
                router.replace('/lobby');
                return;
            }

            requestRoomInfo();
        } else {
            logger.warn('[GameRoom] isSocketConnected가 false로 변경됨. Socket.IO 플러그인에서 리다이렉션 처리 예정.');
            // addGameEventLog('Socket 연결 끊김 감지.', 'error'); // REMOVED
        }
    }, { immediate: true });

    window.addEventListener('beforeunload', handleBeforeUnload);

    onUnmounted(() => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        unwatchIsConnected();

        // ✨ FIX: socket 인스턴스가 존재하는지 확인 후 모든 이벤트 리스너를 해제합니다.
        if (socket) {
            socket.off('roomUpdated', handleRoomUpdated);
            socket.off('gameStarted', handleGameStarted);
            socket.off('roundStarted', handleRoundStarted);
            socket.off('phaseChanged', handlePhaseChanged);
            socket.off('turnChanged', handleTurnChanged);
            socket.off('playerAction', handlePlayerActionEvt);
            socket.off('myHandUpdated', handleMyHandUpdated);
            socket.off('gameEnded', handleGameEnded);
            socket.off('forceLeaveRoom', handleForceLeaveRoom);
            socket.off('timerUpdate', handleTimerUpdate);
        }
    });
});
</script>

<style scoped>
/* (스타일 부분은 이전 단계에서 개선된 내용을 그대로 유지합니다. 변경 없음.) */
/* game-common.css로 이동된 스타일은 여기서 제거합니다. */

.game-room-page-wrapper {
  max-width: 1200px;
  margin: 20px auto;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  background-color: #f8f9fa;
  min-height: 80vh; /* 최소 높이 설정 */
  display: flex;
  flex-direction: column;
}

.game-title {
  color: #343a40;
  font-weight: 600;
  margin-bottom: 20px;
}

.game-info-panel {
    background-color: #e9ecef;
    border: 1px solid #dee2e6;
    padding: 15px;
    border-radius: 5px;
    margin-bottom: 20px;
}
.game-info-panel p {
    font-size: 0.95rem;
}

/* --- 게임 테이블 레이아웃 --- */
.game-table-layout {
  position: relative;
  width: 100%;
  padding-bottom: 300px; /* 플레이어 카드 영역을 위한 하단 패딩 */
  min-height: 400px;
  background-color: #006400; /* 어두운 녹색 (펠트 천 느낌) */
  border-radius: 15px;
  box-shadow: inset 0 0 10px rgba(0,0,0,0.5);
  margin-bottom: 20px;
  flex-grow: 1; /* 남은 공간을 채우도록 */
  display: flex; /* 내부 요소들을 flex로 배치 */
  justify-content: center; /* 플레이어 영역 중앙 정렬 */
  align-items: flex-end; /* 플레이어 영역을 하단에 배치 */
}

.turn-indicator {
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.9);
    padding: 10px 20px;
    border-radius: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    white-space: nowrap;
    z-index: 10;
    display: flex;
    align-items: center;
}
.turn-badge {
    font-size: 1.1em;
    padding: 0.6em 1em;
    margin-right: 5px;
}
.timer-badge {
    font-size: 1em;
    padding: 0.5em 0.8em;
}

.player-positions {
  position: absolute;
  bottom: 10px; /* 테이블 하단에서 살짝 띄움 */
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  flex-wrap: wrap; /* 플레이어 수가 많아지면 줄 바꿈 */
  gap: 20px; /* 플레이어 간 간격 */
  width: 100%;
}

.player-card-area {
  background-color: rgba(0, 0, 0, 0.4); /* 플레이어 영역 배경 */
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 10px;
  padding: 10px;
  width: 250px; /* 각 플레이어 영역 고정 너비 */
  min-height: 380px; /* 플레이어 정보 + 카드 영역 높이 */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  transition: all 0.3s ease;
  position: relative;
  box-shadow: 0 4px 10px rgba(0,0,0,0.4);
}

.player-card-area.player-is-turn {
  border-color: #28a745; /* 현재 턴 플레이어 강조 */
  box-shadow: 0 0 15px 5px rgba(40,167,69,0.7), 0 0 5px 2px rgba(40,167,69,0.5);
  transform: translateY(-5px);
}
.player-card-area.player-folded {
  opacity: 0.6;
  filter: grayscale(80%);
}
.player-card-area.player-reserved-leave {
  border-color: #dc3545;
  filter: saturate(50%);
}
.player-card-area.player-is-me {
    order: -1; /* '나'를 항상 왼쪽에 배치 (시각적 편의) */
}


.player-info {
  text-align: center;
  margin-bottom: 10px;
  color: white;
  font-size: 0.9em;
  width: 100%;
}
.player-name strong {
    font-size: 1.1em;
    color: #ffd700; /* 강조 색상 */
    display: block;
    margin-bottom: 3px;
}
.player-chips {
    font-size: 1em;
    margin-bottom: 5px;
    color: #e0e0e0;
}
.player-bet {
    margin-top: 5px;
    margin-bottom: 5px;
}
.player-status-badges {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 5px;
    min-height: 25px; /* 공간 확보 */
}


/* 카드 표시 영역 */
.player-hand {
    display: flex;
    flex-wrap: wrap; /* 카드가 많아지면 줄 바꿈 */
    gap: 3px;
    justify-content: center; /* 카드 중앙 정렬 */
    margin-top: 10px;
    min-height: 150px; /* 카드 영역을 위한 최소 높이 */
    align-items: flex-end; /* 카드 하단 정렬 */
}

/* ✨ MODIFIED: 카드 크기 및 스프라이트 설정 */
.card-face {
    width: 100px; /* 카드 너비 */
    height: 140px; /* 카드 높이 (비율 5:7 유지) */
    background-image: url('/cards/cards_sprite.png');
    background-repeat: no-repeat;
    /* cards_sprite.png의 원본 개별 카드 크기가 225x315라고 가정할 때,
       100x140으로 스케일링하려면 (100/225) = (140/315) ≈ 0.4444 스케일 팩터가 필요합니다.
       총 스프라이트 크기는 (225*13)x(315*4) = 2925x1260 이므로,
       background-size는 (2925 * 0.4444)x(1260 * 0.4444) ≈ 1300px 560px 입니다.
       calc(100px * 13) calc(140px * 4)는 1300px 560px로 정확히 계산됩니다. */
    background-size: calc(100px * 13) calc(140px * 4);
    border: 1px solid #ccc;
    border-radius: 5px; /* 모서리 둥글게 */
    box-shadow: 2px 2px 5px rgba(0,0,0,0.2);
    display: inline-block;
    flex-shrink: 0;
    margin: 2px;
    overflow: hidden;
    position: relative;
    cursor: pointer;
}

/* 선택된 카드에 대한 스타일 */
.card-selected {
    box-shadow: 0 0 15px 5px #00f, 0 0 5px 2px #00f;
    transform: translateY(-10px); /* 선택 시 위로 살짝 */
    transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
}
/* 빈 카드 슬롯 스타일 */
.card-empty-slot {
    background-color: #444;
    border: 1px dashed #777;
    width: 100px;
    height: 140px;
    border-radius: 5px;
    display: inline-block;
    margin: 2px;
    box-shadow: inset 0 0 3px rgba(0,0,0,0.1);
}

.card-image-back {
    width: 100px;
    height: 140px;
    border: 1px solid #ccc;
    border-radius: 5px;
    object-fit: cover;
}

/* --- 무늬별 세로 위치 (Y 오프셋) --- */
/* 이미지 순서: 하트(0), 스페이드(1), 다이아몬드(2), 클로버(3) */
/* 각 값은 현재 카드 높이 (140px)의 음수 배수 */
.suit-h { background-position-y: 0px; }
.suit-s { background-position-y: -140px; } /* 1 * 140px */
.suit-d { background-position-y: -280px; } /* 2 * 140px */
.suit-c { background-position-y: -420px; } /* 3 * 140px */

/* --- 랭크별 가로 위치 (X 오프셋) --- */
/* 이미지 순서: A(0), 2(1), 3(2), ..., T(9), J(10), Q(11), K(12) */
/* 각 값은 현재 카드 너비 (100px)의 음수 배수 */
.rank-a { background-position-x: 0px; }
.rank-2 { background-position-x: -100px; } /* 1 * 100px */
.rank-3 { background-position-x: -200px; } /* 2 * 100px */
.rank-4 { background-position-x: -300px; } /* 3 * 100px */
.rank-5 { background-position-x: -400px; } /* 4 * 100px */
.rank-6 { background-position-x: -500px; } /* 5 * 100px */
.rank-7 { background-position-x: -600px; } /* 6 * 100px */
.rank-8 { background-position-x: -700px; } /* 7 * 100px */
.rank-9 { background-position-x: -800px; } /* 8 * 100px */
.rank-t { background-position-x: -900px; } /* 9 * 100px */
.rank-j { background-position-x: -1000px; } /* 10 * 100px */
.rank-q { background-position-x: -1100px; } /* 11 * 100px */
.rank-k { background-position-x: -1200px; } /* 12 * 100px */


/* --- 게임 제어 섹션 --- */
.game-controls {
  background-color: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 15px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
  margin-top: 20px; /* 디버그 패널 제거로 인한 간격 조정 */
}
.control-section-wrapper {
  margin-bottom: 15px;
  padding-bottom: 15px;
  border-bottom: 1px dashed #eee;
}
.control-section-wrapper:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}
.control-section-title {
  font-size: 1.1rem;
  font-weight: 500;
  color: #343a40;
  margin-bottom: 10px;
  text-align: center;
}
.game-controls .btn {
  flex-grow: 1;
  min-width: 100px;
  white-space: nowrap; /* 버튼 텍스트 줄 바꿈 방지 */
}

/* --- 반응형 디자인 --- */
@media (max-width: 992px) {
  .game-room-page-wrapper { padding: 15px; }
  .game-table-layout { padding-bottom: 250px; min-height: 350px; }
  .player-card-area { width: 220px; min-height: 350px; }
  /* 카드 크기 및 오프셋 조정 */
  .card-face { width: 80px; height: 112px; background-size: calc(80px * 13) calc(112px * 4); }
  .card-image-back, .card-empty-slot { width: 80px; height: 112px; }
  .suit-s { background-position-y: -112px; } .suit-d { background-position-y: -224px; } .suit-c { background-position-y: -336px; }
  .rank-2 { background-position-x: -80px; } .rank-3 { background-position-x: -160px; } .rank-4 { background-position-x: -240px; }
  .rank-5 { background-position-x: -320px; } .rank-6 { background-position-x: -400px; } .rank-7 { background-position-x: -480px; }
  .rank-8 { background-position-x: -560px; } .rank-9 { background-position-x: -640px; } .rank-t { background-position-x: -720px; }
  .rank-j { background-position-x: -800px; } .rank-q { background-position-x: -880px; } .rank-k { background-position-x: -960px; }
}

@media (max-width: 768px) {
  .game-room-page-wrapper { margin: 10px auto; padding: 10px; }
  .game-title { font-size: 1.8rem; }
  .turn-indicator { top: 10px; padding: 8px 15px; font-size: 0.9em; }
  .player-positions { gap: 10px; bottom: 5px; }
  .player-card-area { width: 150px; min-height: 250px; padding: 8px; }
  .player-info { font-size: 0.8em; }
  .player-name strong { font-size: 1em; }
  .player-hand { min-height: 100px; }
  /* 카드 크기 및 오프셋 조정 */
  .card-face { width: 60px; height: 84px; background-size: calc(60px * 13) calc(84px * 4); }
  .card-image-back, .card-empty-slot { width: 60px; height: 84px; }
  .suit-s { background-position-y: -84px; } .suit-d { background-position-y: -168px; } .suit-c { background-position-y: -252px; }
  .rank-2 { background-position-x: -60px; } .rank-3 { background-position-x: -120px; } .rank-4 { background-position-x: -180px; }
  .rank-5 { background-position-x: -240px; } .rank-6 { background-position-x: -300px; } .rank-7 { background-position-x: -360px; }
  .rank-8 { background-position-x: -420px; } .rank-9 { background-position-x: -480px; } .rank-t { background-position-x: -540px; }
  .rank-j { background-position-x: -600px; } .rank-q { background-position-x: -660px; } .rank-k { background-position-x: -720px; }
  .game-controls .btn { min-width: 80px; padding: 0.6rem 1rem; font-size: 0.9rem; }
}

@media (max-width: 576px) {
  .game-room-page-wrapper { padding: 5px; margin: 5px auto; }
  .game-title { font-size: 1.5rem; }
  .game-info-panel p { font-size: 0.85rem; }
  .player-card-area { width: 120px; min-height: 200px; padding: 5px; }
  .player-info { font-size: 0.75em; }
  .player-name strong { font-size: 0.9em; }
  /* 카드 크기 및 오프셋 조정 */
  .card-face { width: 45px; height: 63px; background-size: calc(45px * 13) calc(63px * 4); }
  .card-image-back, .card-empty-slot { width: 45px; height: 63px; }
  .suit-s { background-position-y: -63px; } .suit-d { background-position-y: -126px; } .suit-c { background-position-y: -189px; }
  .rank-2 { background-position-x: -45px; } .rank-3 { background-position-x: -90px; } .rank-4 { background-position-x: -135px; }
  .rank-5 { background-position-x: -180px; } .rank-6 { background-position-x: -225px; } .rank-7 { background-position-x: -270px; }
  .rank-8 { background-position-x: -315px; } .rank-9 { background-position-x: -360px; } .rank-t { background-position-x: -405px; }
  .rank-j { background-position-x: -450px; } .rank-q { background-position-x: -495px; } .rank-k { background-position-x: -540px; }
  .game-controls .btn { min-width: unset; width: 100%; margin-bottom: 5px; }
  .game-controls .d-flex.flex-wrap.gap-2 { flex-direction: column; gap: 5px; }
}
</style>