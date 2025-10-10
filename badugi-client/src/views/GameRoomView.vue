<template>
  <div class="game-room-page-wrapper container">
    <h1 class="text-center">게임 방 (ID: {{ roomId }})</h1>
    <p class="text-center">이곳은 실제 바둑이 게임이 진행되는 공간입니다.</p>
    <p class="text-center">방 제목: {{ roomName }}</p>
    <p class="text-center">현재 인원: {{ players.length }}명 / 베팅: {{ betAmount }}</p>

    <!-- 라운드 정보 표시 -->
    <h2 class="text-center mt-3 mb-4">현재 라운드: <span class="badge badge-primary">{{ gameRoundName }}</span></h2>

    <div class="player-list mb-4">
        <h4>참가자</h4>
        <ul class="list-group">
            <li v-for="player in players" :key="player.id" class="list-group-item">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        {{ player.name }} (칩: {{ player.chips }}) <span v-if="player.id == myUserId">(나)</span>
                        <span v-if="player.isCreator" class="badge badge-info ml-1">방장</span>
                        <span v-if="player.leaveReserved" class="badge badge-warning ml-1">퇴장 예약됨</span>
                        <span v-if="player.folded" class="badge badge-secondary ml-1">폴드</span>
                        <span v-if="player.id == currentTurnPlayerId" class="badge badge-success ml-1">내 턴</span>
                    </div>
                    <div>
                        <span v-if="player.bestHand && player.bestHand.rank !== 'Invalid'" class="badge badge-primary ml-1">
                            {{ player.bestHand.badugiCount }}구 {{ player.bestHand.rank.split('-')[0] }}
                        </span>
                        <span v-else class="badge badge-secondary ml-1">패 없음</span>
                    </div>
                </div>
                <!-- 카드 표시 영역 -->
                <div class="player-hand mt-2">
                    <div v-for="(card, index) in getPlayerCards(player.id)" :key="card ? card.id : `${player.id}-card-back-${index}`"
                         :class="getCardClass(card, player.id === myUserId || (roomStatus === 'showdown' || roomStatus === 'ended'), isCardSelected(card ? card.id : null))"
                         :title="card && (player.id === myUserId || (roomStatus === 'showdown' || roomStatus === 'ended')) ? `${card.suit}${card.rank}` : 'Hidden Card'"
                         @click="player.id === myUserId && roomStatus === 'playing' && isMyTurn && card ? toggleCardSelection(card.id) : null"
                    >
                        <img v-if="!shouldShowCardFace(card, player.id === myUserId)" src="/cards/card_back.png" alt="Card Back" class="card-image-back">
                    </div>
                </div>
            </li>
        </ul>
    </div>

    <div class="d-flex justify-content-center mt-4">
        <button @click="handleLeaveRoom" :class="['btn', { 'btn-danger': !myPlayer?.leaveReserved, 'btn-secondary': myPlayer?.leaveReserved }]">
            <span v-if="isRoomCreator && players.length > 1 && room.status === 'waiting'">방장 퇴장 불가</span>
            <span v-else-if="room.status === 'playing' && !myPlayer?.leaveReserved">게임 종료 후 나가기 예약</span>
            <span v-else>방 나가기</span>
        </button>
        <button v-if="isRoomCreator && room.status === 'waiting'" @click="startGame" class="btn btn-success ml-2" :disabled="players.length < 2">게임 시작</button>
        <button v-if="room.status === 'playing' && myPlayer?.leaveReserved" @click="cancelLeaveRoom" class="btn btn-warning ml-2">예약 취소</button>

        <!-- 액션 버튼 -->
        <template v-if="room.status === 'playing' && isMyTurn && !myPlayer?.folded && !myPlayer?.leaveReserved">
            <!-- 'betting' 페이즈에서 베팅 관련 액션 -->
            <template v-if="currentPhase === 'betting'">
                <button @click="handlePlayerAction('check')" class="btn btn-primary ml-2" :disabled="!canCheck">첵</button>
                <button @click="handlePlayerAction('call')" class="btn btn-primary ml-2" :disabled="!canCall">콜</button>
                <!-- '삥' 버튼은 항상 betAmount를 표시하고, 서버에는 해당 액션의 의도에 맞는 금액을 보냅니다. -->
                <button @click="handlePlayerAction('bet', betAmount)" class="btn btn-info ml-2" :disabled="!canBbing">삥 ({{ betAmount }})</button>
                <button @click="handlePlayerAction('raise', getRaiseAmountForHalf)" class="btn btn-info ml-2" :disabled="!canRaiseToHalf">하프 ({{ getRaiseAmountForHalf }})</button>
                <button @click="handlePlayerAction('raise', getRaiseAmountForFull)" class="btn btn-info ml-2" :disabled="!canRaiseToFull">풀 ({{ getRaiseAmountForFull }})</button>
                <button @click="handlePlayerAction('die')" class="btn btn-dark ml-2" :disabled="!canDie">다이</button>
            </template>

            <!-- 'exchange' 페이즈에서 카드 교환 또는 스테이 액션 -->
            <template v-else-if="currentPhase === 'exchange'">
                <button @click="handlePlayerAction('exchange', selectedCardsIds)" class="btn btn-warning ml-2" :disabled="!canExchangeCards">카드 교환 ({{ selectedCardsIds.length }}장)</button>
                <button @click="handlePlayerAction('stay')" class="btn btn-light ml-2" :disabled="!canStay">스테이</button>
                <button @click="handlePlayerAction('die')" class="btn btn-dark ml-2" :disabled="!canDie">다이</button>
            </template>
        </template>
    </div>

    <!-- 게임 종료 결과 모달 -->
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
            <button @click="closeGameEndedModal" class="btn btn-primary mt-4">확인</button>
        </div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, inject, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { logger } from '../utils/logger';

const router = useRouter();
const route = useRoute();
const socket = inject('socket');
const isSocketConnected = inject('isSocketConnected');

const roomId = ref(route.params.id);
const roomName = ref('불러오는 중...');
const betAmount = ref(0); // 방의 기본 베팅액
const players = ref([]);
const myUserId = ref(parseInt(localStorage.getItem('user_id')));

const roomStatus = ref('loading');
const roomCreatorId = ref(null);
const currentBet = ref(0); // 현재 라운드의 최고 베팅액

const myHand = ref([]);
const currentTurnPlayerId = ref(null);

const gameRound = ref(0); // 현재 라운드 (0: 아침, 1: 점심, 2: 저녁)
const gameRoundName = ref('대기 중'); // 현재 라운드 이름 (아침, 점심, 저녁)
const showGameEndedModal = ref(false); // 게임 종료 모달 표시 여부
const gameWinnerNames = ref([]); // 게임 승자 이름 목록
const gameEndReason = ref(''); // 게임 종료 이유
const finalHands = ref({}); // 최종 패 공개
const currentPhase = ref('loading'); // 'betting', 'exchange'
const maxRounds = ref(3); // 총 라운드 수 (아침, 점심, 저녁)

const isMyTurn = computed(() => currentTurnPlayerId.value === myUserId.value);

const isRoomCreator = computed(() => {
    return roomCreatorId.value === myUserId.value;
});

const myPlayer = computed(() => {
    return players.value.find(p => p.id === myUserId.value);
});

const selectedCardsIds = ref([]); // 교환할 카드 ID 목록

// 룸 전체 객체를 하나의 computed로 묶어 편의성 및 가독성 향상
const room = computed(() => ({
    id: roomId.value,
    name: roomName.value,
    betAmount: betAmount.value,
    players: players.value,
    status: roomStatus.value,
    creatorId: roomCreatorId.value,
    currentTurnPlayerId: currentTurnPlayerId.value,
    currentRound: gameRound.value,
    gameRoundName: gameRoundName.value,
    currentPhase: currentPhase.value,
    currentBet: currentBet.value, // 현재 최고 베팅액
    maxRounds: maxRounds.value
}));

// --- 액션 버튼 활성화/비활성화 로직 (Computed Properties) ---
const canBettingAction = computed(() => {
    return isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved &&
           room.value.status === 'playing' && room.value.currentPhase === 'betting';
});

const canExchangePhaseAction = computed(() => {
    return isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved &&
           room.value.status === 'playing' && room.value.currentPhase === 'exchange';
});

const canCheck = computed(() => {
    return canBettingAction.value && room.value.currentBet === (myPlayer.value?.currentRoundBet || 0);
});

const canCall = computed(() => {
    const amountToCall = room.value.currentBet - (myPlayer.value?.currentRoundBet || 0);
    return canBettingAction.value && amountToCall > 0 && amountToCall <= (myPlayer.value?.chips || 0);
});

const canBbing = computed(() => {
    if (!canBettingAction.value) return false;

    const myChips = myPlayer.value?.chips || 0;
    const bbingAmount = room.value.betAmount; // '삥'은 항상 방의 기본 베팅액
    const myCurrentRoundBet = myPlayer.value?.currentRoundBet || 0;

    // '삥'을 통해 도달하려는 총 베팅액 (서버의 로직과 일치해야 함)
    // 서버: '삥' 금액(amount)이 room.betAmount로 왔을 때
    // 1. (currentBet - myCurrentRoundBet) <= 0: 내가 이미 베팅액을 맞췄거나 초과 -> 레이즈로 처리
    //    -> newTotalBet = room.currentBet + room.betAmount
    // 2. (currentBet - myCurrentRoundBet) > 0: 내가 베팅액을 맞춰야 함 -> 콜로 처리
    //    -> newTotalBet = room.currentBet

    let targetTotalBet;
    const chipsToCoverCurrentBet = room.value.currentBet - myCurrentRoundBet;

    if (chipsToCoverCurrentBet <= 0) { // 내가 이미 베팅액을 맞췄거나 초과한 경우
        targetTotalBet = room.value.currentBet + bbingAmount; // 삥은 레이즈 의미
    } else { // 내가 베팅액을 맞춰야 하는 경우
        targetTotalBet = room.value.currentBet; // 삥은 콜 의미
    }

    const chipsNeeded = targetTotalBet - myCurrentRoundBet;

    return chipsNeeded > 0 && myChips >= chipsNeeded;
});


const getMinRaiseTotalAmount = computed(() => {
    return (room.value.currentBet || 0) + (room.value.betAmount || 0);
});

// 레이즈에 필요한 추가 칩 계산 헬퍼 함수
const calculateChipsNeededForTotalBet = (totalTargetBet) => {
    return totalTargetBet - (myPlayer.value?.currentRoundBet || 0);
};

const getRaiseAmountForHalf = computed(() => {
    // '하프'는 현재 베팅액 + 팟의 절반
    const pot = room.value.pot || 0;
    const currentBet = room.value.currentBet || 0;
    const halfPot = Math.floor(pot / 2);
    // 최소 레이즈 금액 이상이 되도록 보장
    return Math.max(currentBet + halfPot, getMinRaiseTotalAmount.value);
});

const canRaiseToHalf = computed(() => {
    if (!canBettingAction.value) return false;
    const totalTargetBet = getRaiseAmountForHalf.value;
    const amountNeeded = calculateChipsNeededForTotalBet(totalTargetBet);
    const myChips = myPlayer.value?.chips || 0;

    return amountNeeded > 0 && myChips >= amountNeeded;
});

const getRaiseAmountForFull = computed(() => {
    // '풀'은 현재 베팅액 + 팟 전체
    const pot = room.value.pot || 0;
    const currentBet = room.value.currentBet || 0;
    // 최소 레이즈 금액 이상이 되도록 보장
    return Math.max(currentBet + pot, getMinRaiseTotalAmount.value);
});

const canRaiseToFull = computed(() => {
    if (!canBettingAction.value) return false;
    const totalTargetBet = getRaiseAmountForFull.value;
    const amountNeeded = calculateChipsNeededForTotalBet(totalTargetBet);
    const myChips = myPlayer.value?.chips || 0;

    return amountNeeded > 0 && myChips >= amountNeeded;
});

const canDie = computed(() => {
    return isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved && room.value.status === 'playing';
});

const canExchangeCards = computed(() => {
    // 아침(0) 라운드에는 교환 불가.
    // currentRound는 1: 점심, 2: 저녁 라운드에서만 가능
    return canExchangePhaseAction.value && myPlayer.value?.canExchange &&
           room.value.currentRound > 0 && room.value.currentRound < room.value.maxRounds;
});

const canStay = computed(() => {
    // 아침(0) 라운드에는 스테이 불가 (교환 라운드가 아니므로).
    // currentRound는 1: 점심, 2: 저녁 라운드에서만 가능
    return canExchangePhaseAction.value && myPlayer.value?.canExchange &&
           room.value.currentRound > 0 && room.value.currentRound < room.value.maxRounds;
});
// --- 끝: 액션 버튼 활성화/비활성화 로직 ---

const toggleCardSelection = (cardId) => {
    // 자신의 턴에만 카드 선택 가능하고, 게임 중이고, 폴드하지 않았을 때만
    // 중요: 'exchange' 페이즈에서만 카드 선택 가능
    if (!isMyTurn.value || room.value.status !== 'playing' || myPlayer.value?.folded || myPlayer.value?.leaveReserved ||
        room.value.currentPhase !== 'exchange') {
        logger.notify('지금은 카드를 선택할 수 없습니다. 카드 교환 페이즈에만 가능합니다.', 'warn');
        return;
    }

    // 아침(0) 라운드에는 카드 교환 불가
    // 저녁(2) 라운드까지만 교환 가능. 총 3 라운드(0, 1, 2)
    if (room.value.currentRound === 0 || room.value.currentRound >= room.value.maxRounds) {
        logger.notify('현재 라운드에는 카드를 교환할 수 없습니다.', 'warn');
        return;
    }

    // 이미 교환 기회를 사용했다면 선택 불가
    if (!myPlayer.value?.canExchange) {
        logger.notify('이번 라운드에 이미 카드를 교환했거나 스테이했습니다.', 'warn');
        return;
    }

    const index = selectedCardsIds.value.indexOf(cardId);
    if (index > -1) {
        selectedCardsIds.value.splice(index, 1); // 선택 해제
    } else {
        if (selectedCardsIds.value.length < 4) { // 로우바둑이 규칙: 최대 4장까지 선택 가능 (0장 교환도 가능)
            selectedCardsIds.value.push(cardId); // 선택
        } else {
            logger.notify('카드는 최대 4장까지 선택할 수 있습니다.', 'warn');
        }
    }
};

const isCardSelected = (cardId) => {
    // cardId가 null일 경우 (빈 카드 슬롯) 선택될 수 없도록 처리
    return cardId !== null && selectedCardsIds.value.includes(cardId);
};

const handleLeaveRoom = () => {
    if (isRoomCreator.value && players.value.length > 1 && room.value.status === 'waiting') {
        logger.notify('다른 플레이어가 있는 대기 중인 방장은 나갈 수 없습니다.', 'warn');
        return;
    }

    if (room.value.status === 'playing' && myPlayer.value && !myPlayer.value.leaveReserved) {
        if (confirm('게임이 진행 중입니다. 게임 종료 후 방을 나가시겠습니까?')) {
            socket.emit('reserveLeaveRoom', roomId.value, (response) => {
                if (response.success) {
                    logger.notify('게임 종료 후 퇴장 예약되었습니다.', 'info');
                } else {
                    logger.notify('퇴장 예약 실패: ' + response.message, 'error');
                }
            });
        }
    } else {
        leaveRoom();
    }
};

const leaveRoom = () => {
  if (!isSocketConnected.value) {
      logger.warn('[GameRoom] Socket.IO 연결이 끊어진 상태에서 방 나가기 요청. 로그인 페이지로 리다이렉트.');
      router.replace('/login');
      return;
  }

  socket.emit('leaveRoom', roomId.value, (response) => {
    if (response.success) {
      logger.log('방 나가기 성공');
      router.replace('/lobby');
    } else {
      logger.notify('방 나가기 실패: ' + (response.message || '알 수 없는 오류'), 'error');
    }
  });
};

const cancelLeaveRoom = () => {
    if (room.value.status === 'playing' && myPlayer.value && myPlayer.value.leaveReserved) {
        socket.emit('cancelLeaveRoom', roomId.value, (response) => {
            if (response.success) {
                logger.notify('퇴장 예약이 취소되었습니다.', 'info');
            } else {
                logger.notify('퇴장 예약 취소 실패: ' + response.message, 'error');
            }
        });
    }
};

const startGame = () => {
    if (socket.connected && isRoomCreator.value && room.value.status === 'waiting') {
        if (players.value.length < 2) {
            logger.notify('최소 2명 이상의 플레이어가 있어야 게임을 시작할 수 있습니다.', 'warn');
            return;
        }
        logger.log('게임 시작 요청');
        socket.emit('startGame', roomId.value, (response) => {
            if (response.success) {
                logger.log('게임 시작 성공!');
            } else {
                logger.notify('게임 시작 실패: ' + response.message, 'error');
            }
        });
    } else if (room.value.status === 'playing') {
        logger.notify('이미 게임이 진행 중입니다.', 'warn');
    } else if (!isRoomCreator.value) {
        logger.notify('방장만 게임을 시작할 수 있습니다.', 'warn');
    }
};

const getCardClass = (card, showFront = true, isSelected = false) => {
    const classes = ['card-face'];
    // card가 null이거나, 뒷면 카드 더미 객체인 경우 (suit/rank가 'back'일 때)
    if (!card || card.suit === 'back' || card.rank === 'back') {
        // 이 경우에는 suit/rank 클래스를 추가하지 않고, img 태그로 뒷면 이미지를 보여줍니다.
    } else if (shouldShowCardFace(card, showFront)) { // 앞면을 보여줄 카드인 경우
        classes.push(`suit-${card.suit.toLowerCase()}`);
        const rankClass = card.rank === 'T' ? 't' : card.rank.toLowerCase();
        classes.push(`rank-${rankClass}`);
    } else {
        // 이 경우도 뒷면을 보여주므로 suit/rank 클래스 불필요.
    }

    if (isSelected) {
        classes.push('card-selected');
    }
    return classes;
};

const getPlayerCards = (playerId) => {
    if (playerId === myUserId.value) {
        const displayHand = [...myHand.value];
        while (displayHand.length < 4) {
            displayHand.push(null); // 빈 카드 슬롯
        }
        return displayHand;
    } else {
        // 다른 플레이어의 패는 항상 뒷면 카드 더미 객체로 반환
        return Array(4).fill(null).map((_, index) => ({ id: `back-${playerId}-${index}`, suit: 'back', rank: 'back' }));
    }
};

const shouldShowCardFace = (card, isMyCard) => {
    // card가 null이면 무조건 뒷면 (또는 빈 슬롯)
    if (card === null) return false;
    // 뒷면 카드 더미 객체인 경우 (suit/rank가 'back'일 때)
    if (card.suit === 'back' || card.rank === 'back') return false;

    // 게임 종료 (showdown, ended) 상태일 때는 모든 카드 공개
    if (room.value.status === 'showdown' || room.value.status === 'ended') {
        return true;
    }
    return isMyCard; // 게임 중에는 내 카드만 앞면
};


const handlePlayerAction = (actionType, payload = null) => {
    if (!isMyTurn.value) {
        logger.notify('지금은 당신의 턴이 아닙니다.', 'warn');
        return;
    }
    if (!isSocketConnected.value) {
        logger.notify('Socket.IO 연결이 끊어졌습니다. 액션을 수행할 수 없습니다.', 'error');
        router.replace('/login');
        return;
    }

    // 액션 타입별 라운드/페이즈 유효성 검사 강화
    const isBettingPhaseAction = (actionType === 'bet' || actionType === 'call' || actionType === 'raise' || actionType === 'check');
    const isExchangePhaseAction = (actionType === 'exchange' || actionType === 'stay');
    const isCommonAction = (actionType === 'die'); // 'die'는 어느 페이즈에서든 가능

    if (room.value.currentPhase === 'betting' && !isBettingPhaseAction && !isCommonAction) {
        logger.notify('현재는 베팅 페이즈입니다. 베팅 관련 액션 또는 다이를 선택하세요.', 'warn');
        return;
    }
    if (room.value.currentPhase === 'exchange' && !isExchangePhaseAction && !isCommonAction) {
        logger.notify('현재는 카드 교환 페이즈입니다. 교환/스테이 또는 다이를 선택하세요.', 'warn');
        return;
    }
    // '아침'(0) 라운드에는 카드 교환/스테이 불가 (현재 currentRound가 1:점심 부터 가능)
    if (isExchangePhaseAction && room.value.currentRound === 0) {
        logger.notify('아침 라운드에는 베팅만 가능합니다.', 'warn');
        return;
    }

    let finalAmount = null; // 서버로 보낼 amount 값
    let cardsToExchangeData = undefined; // 교환할 카드 정보

    switch (actionType) {
        case 'check':
        case 'call':
        case 'die':
        case 'stay':
            // 이 액션들은 amount가 필요 없거나 0입니다.
            finalAmount = 0;
            break;
        case 'bet': // '삥'
            {
                // '삥'은 항상 방의 기본 베팅액을 보냅니다.
                finalAmount = room.value.betAmount;
                if (finalAmount <= 0) {
                    logger.notify('삥 금액을 정확히 계산할 수 없습니다.', 'error');
                    return;
                }
            }
            break;
        case 'raise':
            {
                finalAmount = payload; // payload는 이미 총 베팅 금액
                if (typeof finalAmount !== 'number' || finalAmount <= 0) {
                    logger.notify('유효한 레이즈 금액을 입력해주세요.', 'warn');
                    return;
                }
                // 클라이언트 측 최소 레이즈 유효성 검사 (서버에서도 다시 검사)
                const minRaiseTotal = getMinRaiseTotalAmount.value;
                if (finalAmount < minRaiseTotal) {
                    logger.notify(`레이즈는 총 ${minRaiseTotal} 칩 이상으로 해야 합니다.`, 'warn');
                    return;
                }
            }
            break;
        case 'exchange':
            {
                cardsToExchangeData = selectedCardsIds.value; // 선택된 카드 ID 목록
                if (!Array.isArray(cardsToExchangeData) || cardsToExchangeData.length < 0 || cardsToExchangeData.length > 4) {
                    logger.notify('교환할 카드는 0~4장만 선택해주세요.', 'warn');
                    return;
                }
            }
            break;
        default:
            logger.notify('알 수 없는 게임 액션입니다.', 'error');
            return;
    }

    logger.log(`[GameRoom] 플레이어 액션 전송: ${actionType}, Amount: ${finalAmount}, CardsToExchange:`, cardsToExchangeData);
    socket.emit('playerAction', {
        roomId: roomId.value,
        action: actionType,
        amount: finalAmount, // 'bet', 'call', 'raise' 등에 사용
        cardsToExchange: cardsToExchangeData // 'exchange'에 사용
    }, (response) => {
        if (response.success) {
            logger.log('[GameRoom] 액션 요청 성공:', actionType);
            selectedCardsIds.value = []; // 액션 성공 시 선택된 카드 초기화
        } else {
            logger.notify('액션 실패: ' + (response.message || '알 수 없는 오류'), 'error');
        }
    });
};


const handleRoomUpdated = (updatedRoom) => {
    if (updatedRoom.id == roomId.value) {
        logger.log('[GameRoom] 방 정보 업데이트 수신:', updatedRoom);
        roomName.value = updatedRoom.name;
        betAmount.value = updatedRoom.betAmount;
        players.value = updatedRoom.players;
        roomStatus.value = updatedRoom.status;
        roomCreatorId.value = updatedRoom.creatorId;
        currentTurnPlayerId.value = updatedRoom.currentTurnPlayerId;
        currentBet.value = updatedRoom.currentBet; // 현재 최고 베팅액 업데이트
        gameRound.value = updatedRoom.currentRound;
        gameRoundName.value = updatedRoom.roomRoundName || updatedRoom.gameRoundName; // 서버에서 name으로 올 수도 있음
        currentPhase.value = updatedRoom.currentPhase;
        maxRounds.value = updatedRoom.maxRounds || 3; // maxRounds도 업데이트

        // 자신의 패 정보는 'myHandUpdated' 이벤트로만 업데이트되도록 합니다.
        // 다른 플레이어의 패 정보가 roomUpdated에 포함될 수 있으므로,
        // 여기서는 myHand.value를 직접 업데이트하지 않습니다.
        // 다만, 최초 로드 시 myHand가 없는 경우를 대비해 requestRoomInfo에서만 초기화합니다.
        // selectedCardsIds.value = []; // 라운드/페이즈 변경 시 선택된 카드 초기화는 여기서는 하지 않음
    }
};

socket.on('gameStarted', (data) => {
    logger.log('[GameRoom] 게임 시작 이벤트 수신:', data);
    roomStatus.value = data.room.status;
    players.value = data.room.players;
    currentTurnPlayerId.value = data.currentPlayerId;
    myHand.value = data.myHand; // 자신의 패 정보 업데이트
    currentBet.value = data.room.currentBet; // 시작 시 currentBet 업데이트
    gameRound.value = data.room.currentRound;
    gameRoundName.value = data.room.gameRoundName;
    currentPhase.value = data.room.currentPhase;
    maxRounds.value = data.room.maxRounds;
    logger.notify('게임이 시작되었습니다!', 'info');
    selectedCardsIds.value = [];
});

socket.on('roundStarted', (data) => {
    logger.log('[GameRoom] 라운드 시작 이벤트 수신:', data);
    gameRound.value = data.currentRound;
    gameRoundName.value = data.gameRoundName;
    currentPhase.value = data.currentPhase;
    currentBet.value = data.currentBet || room.value.betAmount; // 새 라운드의 기본 베팅액으로 currentBet 초기화
    // 플레이어의 canExchange 상태는 GameService에서 초기화됩니다.
    logger.notify(`${data.gameRoundName} 라운드가 시작되었습니다!`, 'info');
    selectedCardsIds.value = [];
});

socket.on('phaseChanged', (data) => { // ✨ 새로운 페이즈 변경 이벤트 처리
    logger.log('[GameRoom] 페이즈 변경 이벤트 수신:', data);
    currentPhase.value = data.currentPhase;
    currentBet.value = data.currentBet || room.value.betAmount;
    logger.notify(data.message, 'info');
    selectedCardsIds.value = [];
});

socket.on('turnChanged', (data) => {
    logger.log('[GameRoom] 턴 변경 이벤트 수신:', data);
    currentTurnPlayerId.value = data.currentPlayerId;
    if (isMyTurn.value) {
        logger.notify('당신의 턴입니다!', 'info');
    }
    selectedCardsIds.value = [];
});

socket.on('playerAction', (data) => {
    logger.log('[GameRoom] 플레이어 액션 이벤트 수신:', data);
    logger.notify(data.message, 'info');
});

socket.on('myHandUpdated', (data) => {
    logger.log('[GameRoom] 내 패 업데이트 이벤트 수신:', data);
    myHand.value = data.hand;
    if (data.bestHand) {
        const player = players.value.find(p => p.id === myUserId.value);
        if (player) player.bestHand = data.bestHand;
    }
    logger.notify('카드를 교환하여 새로운 패를 받았습니다!', 'info');
    selectedCardsIds.value = [];
});

socket.on('gameEnded', (data) => {
    logger.log('[GameRoom] 게임 종료 이벤트 수신:', data);
    roomStatus.value = data.roomStatus || 'ended';
    gameWinnerNames.value = data.winnerNames || [];
    gameEndReason.value = data.reason || '게임이 종료되었습니다.';
    finalHands.value = data.finalHands || {};
    showGameEndedModal.value = true;
    logger.notify('게임이 종료되었습니다!', 'info');
    selectedCardsIds.value = [];
});

socket.on('forceLeaveRoom', (data) => {
  logger.warn(`[GameRoom] 서버로부터 강제 퇴장 요청: ${data.message}`);
  logger.notify(data.message || '방에서 강제 퇴장되었습니다.', 'warn');
  router.replace('/lobby'); // 로비로 강제 이동
});


const requestRoomInfo = () => {
    logger.log(`[GameRoom] Socket.IO 연결 상태:`, isSocketConnected.value);
    if (!isSocketConnected.value) {
        logger.warn(`[GameRoom] Socket.IO 연결되지 않음. 로그인 페이지로 리다이렉트.`);
        router.replace('/login');
        return;
    }

    logger.log(`[GameRoom] Socket.IO 연결됨, 방 ${roomId.value} 정보 요청 중...`);
    socket.emit('getRoomInfo', roomId.value, (response) => {
        if (response.success && response.room) {
            logger.log('초기 방 정보 수신:', response.room);
            roomName.value = response.room.name;
            betAmount.value = response.room.betAmount;
            players.value = response.room.players;
            roomStatus.value = response.room.status;
            roomCreatorId.value = response.room.creatorId;
            currentTurnPlayerId.value = response.room.currentTurnPlayerId;
            currentBet.value = response.room.currentBet; // 초기 currentBet 설정
            myHand.value = response.room.hands?.[myUserId.value] || [];
            gameRound.value = response.room.currentRound;
            gameRoundName.value = response.room.gameRoundName;
            currentPhase.value = response.room.currentPhase;
            maxRounds.value = response.room.maxRounds;

            if (!response.room.players.some(p => p.id === myUserId.value) && response.room.status === 'waiting') {
                // 현재 플레이어가 방에 없으면 입장 시도
                socket.emit('joinRoom', { roomId: roomId.value, password: null }, (joinResponse) => {
                    if (!joinResponse.success) {
                        logger.notify('방 입장 실패: ' + joinResponse.message, 'error');
                        router.replace('/lobby');
                    }
                });
            } else if (!response.room.players.some(p => p.id === myUserId.value) && response.room.status === 'playing') {
                logger.notify('게임 중인 방에는 입장할 수 없습니다.', 'warn');
                router.replace('/lobby');
            }
        } else {
            logger.notify('방 정보를 가져오지 못했습니다: ' + (response.message || '알 수 없는 오류'), 'error');
            router.replace('/lobby');
        }
    });
};

const handleBeforeUnload = (event) => {
    if (isRoomCreator.value && players.value.length > 1 && room.value.status === 'waiting') {
        event.preventDefault();
        event.returnValue = '다른 플레이어가 있는 대기 중인 방장은 나갈 수 없습니다. 새로고침 시 강제 퇴장됩니다.';
        logger.warn('페이지를 새로고침하면 다른 플레이어가 있는 방에서 강제 퇴장됩니다!');
        return '';
    } else if (room.value.status === 'playing') {
        event.preventDefault();
        event.returnValue = '게임이 진행 중입니다. 새로고침 시 게임에서 강제 퇴장됩니다.';
        logger.warn('페이지를 새로고침하면 게임에서 강제 퇴장됩니다!');
        return '';
    }
};

const closeGameEndedModal = () => {
    showGameEndedModal.value = false;
    logger.log('[GameRoom] 게임 종료 모달 닫기 요청.');
    // await router.replace('/lobby'); // ✨ await 키워드 추가
};

onMounted(() => {
    const unwatchIsConnected = watch(isSocketConnected, (newValue) => {
        logger.log('[GameRoom] isSocketConnected watch 발동, newValue:', newValue);
        if (newValue === true) {
            logger.log('[GameRoom] isSocketConnected가 true로 변경됨, 방 정보 요청.');
            requestRoomInfo();
        } else {
            logger.warn('[GameRoom] isSocketConnected가 false로 변경됨. Socket.IO 플러그인에서 리다이렉션 처리 예정.');
        }
    }, { immediate: true });

    window.addEventListener('beforeunload', handleBeforeUnload);

    socket.on('roomUpdated', handleRoomUpdated);
    socket.on('gameStarted', (data) => { logger.log('[GameRoom] gameStarted 이벤트 수신', data); });
    socket.on('roundStarted', (data) => { logger.log('[GameRoom] roundStarted 이벤트 수신', data); });
    socket.on('phaseChanged', (data) => { logger.log('[GameRoom] phaseChanged 이벤트 수신', data); }); // ✨ 새로운 이벤트 리스너 추가
    socket.on('turnChanged', (data) => { logger.log('[GameRoom] turnChanged 이벤트 수신', data); });
    socket.on('playerAction', (data) => { logger.log('[GameRoom] playerAction 이벤트 수신', data); });
    socket.on('myHandUpdated', (data) => { logger.log('[GameRoom] myHandUpdated 이벤트 수신', data); });
    socket.on('gameEnded', (data) => { logger.log('[GameRoom] gameEnded 이벤트 수신', data); });
    socket.on('forceLeaveRoom', (data) => { logger.log('[GameRoom] forceLeaveRoom 이벤트 수신', data); });


    onUnmounted(() => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        unwatchIsConnected();
        socket.off('roomUpdated', handleRoomUpdated);
        socket.off('gameStarted');
        socket.off('roundStarted');
        socket.off('phaseChanged'); // ✨ 이벤트 리스너 해제
        socket.off('turnChanged');
        socket.off('playerAction');
        socket.off('myHandUpdated');
        socket.off('gameEnded');
        socket.off('forceLeaveRoom');
    });
});
</script>

<style scoped>
.game-room-page-wrapper {
  max-width: 1200px;
  margin: 20px auto;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  background-color: #f8f9fa;
}

.text-center { text-align: center; }
.mb-4 { margin-bottom: 1.5rem; }
.d-flex { display: flex; }
.justify-content-center { justify-content: center; }
.ml-2 { margin-left: 0.5rem; }

.btn {
  padding: 0.75rem 1.25rem;
  border-radius: 0.3rem;
  font-size: 1rem;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s ease;
}
.btn-success { background-color: #28a745; color: white; }
.btn-success:hover { background-color: #218838; }
.btn-danger { background-color: #dc3545; color: white; }
.btn-danger:hover { background-color: #c82333; }
.btn-primary { background-color: #007bff; color: white; }
.btn-primary:hover { background-color: #0056b3; }
.btn-dark { background-color: #343a40; color: white; }
.btn-dark:hover { background-color: #23272b; }
.btn-info { background-color: #17a2b8; color: white; }
.btn-info:hover { background-color: #117a8b; }
.btn-warning { background-color: #ffc107; color: #343a40; }
.btn-warning:hover { background-color: #e0a800; }
.btn-light { background-color: #f8f9fa; color: #212529; border: 1px solid #ced4da; }
.btn-light:hover { background-color: #e2e6ea; }


.player-list h4 {
    margin-bottom: 15px;
    color: #343a40;
}
.list-group {
    list-style: none;
    padding: 0;
}
.list-group-item {
    background-color: white;
    border: 1px solid #e0e0e0;
    border-radius: 0.3rem;
    padding: 0.75rem 1rem;
    margin-bottom: 5px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
}

.player-hand {
    display: flex;
    gap: 5px;
    justify-content: center;
    margin-top: 10px;
    min-height: 315px; /* 카드 이미지 높이만큼 최소 높이 지정 (빈 패일 때 공간 확보) */
}

/* 최종 패 공개 시 왼쪽 정렬 */
.modal-content .player-hand {
    justify-content: flex-start;
}

.card-face {
    width: 225px;
    height: 315px;
    background-image: url('/cards/cards_sprite.png');
    background-repeat: no-repeat;
    background-size: calc(225px * 13) calc(315px * 4); /* 원본 스프라이트 시트 크기 */
    border: 1px solid #ccc;
    border-radius: 5px;
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
    transform: translateY(-10px);
    transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
}
/* 빈 카드 슬롯 스타일 */
.card-empty-slot {
    background-color: #f0f0f0; /* 빈 카드 슬롯 배경색 */
    border: 1px dashed #ccc;   /* 빈 카드 슬롯 테두리 */
    width: 225px; /* 실제 카드와 동일한 크기 */
    height: 315px;
    border-radius: 5px;
    display: inline-block;
    margin: 2px;
}


.card-image-back {
    width: 225px;
    height: 315px;
    border: 1px solid #ccc;
    border-radius: 4px;
    object-fit: cover;
}

/* --- 무늬별 세로 위치 (Y 오프셋) --- */
/* 이미지 순서: 하트(0), 스페이드(1), 다이아몬드(2), 클로버(3) */
.suit-h { background-position-y: 0px; }
.suit-s { background-position-y: -315px; }
.suit-d { background-position-y: -630px; }
.suit-c { background-position-y: -945px; }

/* --- 랭크별 가로 위치 (X 오프셋) --- */
/* 이미지 순서: A(0), 2(1), 3(2), ..., T(9), J(10), Q(11), K(12) */
.rank-a { background-position-x: 0px; }
.rank-2 { background-position-x: -225px; }
.rank-3 { background-position-x: -450px; }
.rank-4 { background-position-x: -675px; }
.rank-5 { background-position-x: -900px; }
.rank-6 { background-position-x: -1125px; }
.rank-7 { background-position-x: -1350px; }
.rank-8 { background-position-x: -1575px; }
.rank-9 { background-position-x: -1800px; }
.rank-t { background-position-x: -2025px; }
.rank-j { background-position-x: -2250px; }
.rank-q { background-position-x: -2475px; }
.rank-k { background-position-x: -2700px; }


.badge {
    padding: 0.4em 0.6em;
    border-radius: 0.25rem;
    font-size: 0.75em;
    font-weight: bold;
    color: white;
}
.badge-primary { background-color: #007bff; }
.badge-secondary { background-color: #6c757d; }
.badge-info { background-color: #17a2b8; }
.badge-warning { background-color: #ffc107; color: #343a40; }
.badge-success { background-color: #28a745; }

/* 게임 종료 모달 스타일 */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.modal-content {
    background: white;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
    width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    text-align: center;
}
.modal-content h4 {
    margin-bottom: 20px;
    color: #343a40;
    font-size: 1.5rem;
}
.modal-content h5 {
    margin-top: 20px;
    margin-bottom: 15px;
    color: #343a40;
}
.modal-content p {
    margin-bottom: 10px;
    color: #555;
}
.modal-content .text-left {
    text-align: left;
}
.modal-content .text-success {
    color: #28a745;
}
</style>