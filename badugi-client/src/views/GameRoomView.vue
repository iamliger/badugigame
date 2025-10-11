<template>
  <div class="game-room-page-wrapper container">
    <h1 class="text-center">게임 방 (ID: {{ roomId }})</h1>
    <p class="text-center">이곳은 실제 바둑이 게임이 진행되는 공간입니다.</p>

    <div class="room-info-summary mb-4 p-3 border rounded bg-light">
        <p class="mb-1">방 제목: <strong>{{ roomName }}</strong></p>
        <p class="mb-1">최소 베팅액: <strong>{{ betAmount }} 칩</strong> | 현재 팟: <strong>{{ pot }} 칩</strong> | 현재 최고 베팅액: <strong>{{ currentBet }} 칩</strong></p>
        <p class="mb-1">현재 인원: <strong>{{ players.length }}</strong>명 / 최대: <strong>{{ room.maxPlayers }}</strong>명</p>
        <p class="mb-1">
            게임 상태: <span class="badge" :class="{'badge-success': roomStatus === 'playing', 'badge-info': roomStatus === 'waiting', 'badge-warning': roomStatus === 'showdown', 'badge-dark': roomStatus === 'ended'}">{{ displayRoomStatus }}</span>
            <span class="ml-2">페이즈: <span class="badge" :class="{'badge-primary': currentPhase === 'betting', 'badge-info': currentPhase === 'exchange', 'badge-secondary': currentPhase === 'waiting'}">{{ displayCurrentPhase }}</span></span>
        </p>
        <p class="mb-0">
            라운드: <strong class="text-primary">{{ gameRoundName }}</strong>
            (베팅 라운드: {{ currentBettingRoundIndex + 1 }}/{{ maxBettingRounds }})
            <span v-if="currentExchangeOpportunityIndex > -1" class="ml-2">(교환 기회: {{ currentExchangeOpportunityIndex + 1 }}/{{ maxExchangeOpportunities }})</span>
        </p>
        <p v-if="currentTurnPlayer" class="mt-2 mb-0">현재 턴: <strong class="text-success">{{ currentTurnPlayer.name }}</strong> 님</p>
    </div>

    <div class="player-list mb-4">
        <h4>참가자</h4>
        <ul class="list-group">
            <li v-for="player in players" :key="player.id" class="list-group-item" :class="{'active-player-turn': player.id == currentTurnPlayerId}">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>{{ player.name }}</strong>
                        <span v-if="player.id == myUserId">(나)</span>
                        (칩: {{ player.chips }})
                        <span v-if="player.currentRoundBet > 0" class="badge badge-warning ml-1">이번 라운드 베팅: {{ player.currentRoundBet }}</span>
                        <!-- 역할 배지 추가 -->
                        <span v-for="role in getPlayerRoleBadges(player)" :key="role.text" class="badge ml-1" :class="role.class">{{ role.text }}</span>
                        <!-- 기존 상태 배지 유지 -->
                        <span v-if="player.leaveReserved" class="badge badge-danger ml-1">퇴장 예약됨</span>
                        <span v-if="player.folded" class="badge badge-secondary ml-1">폴드</span>
                        <span v-if="player.id == currentTurnPlayerId && roomStatus === 'playing'" class="badge badge-success ml-1">현재 턴</span>
                    </div>
                    <div>
                        <span v-if="player.bestHand && player.bestHand.rank !== 'Invalid'" class="badge badge-primary ml-1">
                            {{ player.bestHand.badugiCount }}구 {{ player.bestHand.rank.split('-')[0] }}
                        </span>
                        <span v-else-if="roomStatus === 'playing'" class="badge badge-secondary ml-1">패 없음</span>
                    </div>
                </div>
                <!-- 카드 표시 영역 -->
                <div class="player-hand mt-2">
                    <div v-for="(card, index) in getPlayerCards(player.id)" :key="card ? card.id : `${player.id}-card-back-${index}`"
                         :class="getCardClass(card, player.id === myUserId || (roomStatus === 'showdown' || roomStatus === 'ended'), isCardSelected(card ? card.id : null))"
                         :title="getCardTitle(card, player.id === myUserId)"
                         @click="player.id === myUserId && roomStatus === 'playing' && isMyTurn && currentPhase === 'exchange' && myPlayer?.canExchange && card ? toggleCardSelection(card.id) : null"
                    >
                        <!-- card가 null이거나, 뒷면 표시가 필요한 경우 -->
                        <img v-if="!shouldShowCardFace(card, player.id === myUserId)" src="/cards/card_back.png" alt="Card Back" class="card-image-back">
                        <!-- 카드 앞면은 getCardClass에서 background-image로 처리됨 -->
                    </div>
                </div>
            </li>
        </ul>
    </div>

    <div class="d-flex justify-content-center mt-4 action-buttons-row">
        <!-- 방 나가기 및 게임 시작 버튼 -->
        <button @click="handleLeaveRoom" :class="['btn', { 'btn-danger': !myPlayer?.leaveReserved, 'btn-secondary': myPlayer?.leaveReserved }]">
            <span v-if="isRoomCreator && players.length > 1 && room.status === 'waiting'">방장 퇴장 불가</span>
            <span v-else-if="room.status === 'playing' && !myPlayer?.leaveReserved">게임 종료 후 나가기 예약</span>
            <span v-else>방 나가기</span>
        </button>
        <button v-if="isRoomCreator && room.status === 'waiting'" @click="startGame" class="btn btn-success ml-2" :disabled="players.length < 2">게임 시작</button>
        <button v-if="room.status === 'playing' && myPlayer?.leaveReserved" @click="cancelLeaveRoom" class="btn btn-warning ml-2">예약 취소</button>

        <template v-if="room.status === 'playing' && isMyTurn && !myPlayer?.folded && !myPlayer?.leaveReserved">

            <!-- 베팅 페이즈 버튼 -->
            <template v-if="currentPhase === 'betting'">
                <button @click="handlePlayerAction('check')" class="btn btn-primary ml-2" :disabled="!canCheck">체크</button>
                <button @click="handlePlayerAction('call')" class="btn btn-primary ml-2" :disabled="!canCall">콜</button>
                <button @click="handlePlayerAction('bet', betAmount)" class="btn btn-info ml-2" :disabled="!canBbing">삥 ({{ betAmount }})</button>
                <button @click="handlePlayerAction('raise', getRaiseAmountForHalf)" class="btn btn-info ml-2" :disabled="!canRaiseToHalf">하프 ({{ getRaiseAmountForHalf }})</button>
                <button @click="handlePlayerAction('raise', getRaiseAmountForFull)" class="btn btn-info ml-2" :disabled="!canRaiseToFull">풀 ({{ getRaiseAmountForFull }})</button>
                <button @click="handlePlayerAction('die')" class="btn btn-dark ml-2" :disabled="!canDie">다이</button>
            </template>

            <!-- 교환 페이즈 버튼 - canExchange가 true일 때만 표시 -->
            <template v-else-if="currentPhase === 'exchange' && myPlayer?.canExchange">
                <button @click="handlePlayerAction('exchange', selectedCardsIds)" class="btn btn-warning ml-2" :disabled="!canExchangeCards">카드 교환 ({{ selectedCardsIds.length }}장)</button>
                <button @click="handlePlayerAction('stay')" class="btn btn-light ml-2" :disabled="!canStay">스테이</button>
                <!-- 카드 교환 페이즈에서는 '다이' 버튼 제거 요청 -->
                <!-- <button @click="handlePlayerAction('die')" class="btn btn-dark ml-2" :disabled="!canDie">다이</button> -->
            </template>

            <!-- 교환 페이즈지만 이미 액션한 경우 대기 메시지 -->
            <template v-else-if="currentPhase === 'exchange' && !myPlayer?.canExchange">
                <div class="alert alert-info ml-2 mb-0 py-2 px-3" style="display: inline-block;">
                    다른 플레이어의 카드 교환을 기다리는 중...
                </div>
            </template>

        </template>
    </div>

    <!-- 디버그 패널 -->
    <div class="debug-panel mt-3 p-2 border rounded" style="background: #f0f0f0; font-size: 0.8em;">
        <h6>🔧 디버그 정보</h6>
        <p>게임 상태: <strong>{{ roomStatus }}</strong>, 페이즈: <strong>{{ currentPhase }}</strong>, 라운드: <strong>{{ gameRoundName }} ({{ currentBettingRoundIndex + 1 }}/{{ maxBettingRounds }})</strong></p>
        <p>내 턴: <strong>{{ isMyTurn ? 'Yes' : 'No' }}</strong>, 내 ID: <strong>{{ myUserId }}</strong>, 현재 턴 ID: <strong>{{ currentTurnPlayerId }}</strong></p>
        <p>딜러 ID: <strong>{{ dealerId || 'N/A' }}</strong>, SB ID: <strong>{{ smallBlindId || 'N/A' }}</strong>, BB ID: <strong>{{ bigBlindId || 'N/A' }}</strong></p>
        <hr>
        <p>내 칩: <strong>{{ myPlayer?.chips }}</strong>, 내 이번 라운드 베팅: <strong>{{ myPlayer?.currentRoundBet }}</strong></p>
        <p>룸 총 팟: <strong>{{ pot }}</strong>, 룸 현재 최고 베팅: <strong>{{ currentBet }}</strong>, 방 최소 베팅액: <strong>{{ betAmount }}</strong></p>
        <p>내 `canExchange`: <strong>{{ myPlayer?.canExchange }}</strong>, 내 `folded`: <strong>{{ myPlayer?.folded }}</strong>, 내 `leaveReserved`: <strong>{{ myPlayer?.leaveReserved }}</strong></p>
        <p>삥 버튼 클릭 시 낼 칩: <strong>{{ myChipsToPayForBbing }}</strong> (예상)</p>
        <hr>
        <p>버튼 활성화 상태:</p>
        <p style="font-size: 0.75em; margin-left: 10px;">
            Check: <strong>{{ canCheck }}</strong>, Call: <strong>{{ canCall }}</strong>, Bbing: <strong>{{ canBbing }}</strong>,
            Half ({{ getRaiseAmountForHalf }}): <strong>{{ canRaiseToHalf }}</strong>, Full ({{ getRaiseAmountForFull }}): <strong>{{ canRaiseToFull }}</strong>,
            Die: <strong>{{ canDie }}</strong>
        </p>
        <p style="font-size: 0.75em; margin-left: 10px;">
            Exchange ({{ selectedCardsIds.length }}장): <strong>{{ canExchangeCards }}</strong>, Stay: <strong>{{ canStay }}</strong>
        </p>
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
            <button @click.stop="closeGameEndedModal" class="btn btn-primary mt-4">확인</button>
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
const pot = ref(0); // 현재 팟 금액

const myHand = ref([]);
const currentTurnPlayerId = ref(null);

// ✨ 게임 진행 상태 변수들
const currentBettingRoundIndex = ref(0); // 현재 베팅 라운드 인덱스 (0, 1, 2, 3)
const currentExchangeOpportunityIndex = ref(-1); // 현재 교환 기회 인덱스 (-1, 0, 1, 2)
const gameRoundName = ref('대기 중'); // 현재 베팅 라운드 이름 (아침, 점심, 저녁, 최종)
const currentPhase = ref('loading'); // 'betting', 'exchange'

const maxBettingRounds = ref(4); // 서버와 동기화 (기본 4)
const maxExchangeOpportunities = ref(3); // 서버와 동기화 (기본 3)

const showGameEndedModal = ref(false); // 게임 종료 모달 표시 여부
const gameWinnerNames = ref([]); // 게임 승자 이름 목록
const gameEndReason = ref(''); // 게임 종료 이유
const finalHands = ref({}); // 최종 패 공개

// ✨ 블라인드/딜러 역할 ID 추가
const dealerId = ref(null);
const smallBlindId = ref(null);
const bigBlindId = ref(null);

const isMyTurn = computed(() => currentTurnPlayerId.value === myUserId.value);

const isRoomCreator = computed(() => {
    return roomCreatorId.value === myUserId.value;
});

const myPlayer = computed(() => {
    const player = players.value.find(p => p.id === myUserId.value);
    if (player) {
        // 클라이언트 측에서 역할 정보 추가 (서버에서 받은 ID 기반)
        player.isDealer = dealerId.value === myUserId.value;
        player.isSmallBlind = smallBlindId.value === myUserId.value;
        player.isBigBlind = bigBlindId.value === myUserId.value;
    }
    return player;
});

const currentTurnPlayer = computed(() => {
    return players.value.find(p => p.id === currentTurnPlayerId.value);
});

const selectedCardsIds = ref([]); // 교환할 카드 ID 목록

// 룸 전체 객체를 하나의 computed로 묶어 편의성 및 가독성 향상
const room = computed(() => ({
    id: roomId.value,
    name: roomName.value,
    betAmount: betAmount.value,
    maxPlayers: 5, // 서버에서 받아오지 못했을 때 기본값 (server.js에서 room 생성 시 maxPlayers 5로 고정)
    players: players.value,
    status: roomStatus.value,
    creatorId: roomCreatorId.value,
    currentTurnPlayerId: currentTurnPlayerId.value,
    currentBet: currentBet.value,
    pot: pot.value,
    currentBettingRoundIndex: currentBettingRoundIndex.value,
    currentExchangeOpportunityIndex: currentExchangeOpportunityIndex.value,
    gameRoundName: gameRoundName.value,
    currentPhase: currentPhase.value,
    maxBettingRounds: maxBettingRounds.value,
    maxExchangeOpportunities: maxExchangeOpportunities.value,
    dealerId: dealerId.value, // NEW: 딜러 ID 포함
    smallBlindId: smallBlindId.value, // NEW: 스몰 블라인드 ID 포함
    bigBlindId: bigBlindId.value // NEW: 빅 블라인드 ID 포함
}));

// ✨ UI 표시용 상태명 변환
const displayRoomStatus = computed(() => {
    switch(roomStatus.value) {
        case 'waiting': return '대기 중';
        case 'playing': return '게임 중';
        case 'showdown': return '쇼다운';
        case 'ended': return '게임 종료';
        default: return '알 수 없음';
    }
});

const displayCurrentPhase = computed(() => {
    switch(currentPhase.value) {
        case 'betting': return '베팅 페이즈';
        case 'exchange': return '카드 교환 페이즈';
        case 'waiting': return '대기';
        default: return '알 수 없음';
    }
});

// --- 플레이어 역할 배지 생성을 위한 헬퍼 함수 ---
const getPlayerRoleBadges = (player) => {
    const roles = [];
    if (player.isCreator) roles.push({ text: '방장', class: 'badge-info' });
    if (player.isDealer) roles.push({ text: 'D', class: 'badge-dark' }); // Dealer
    if (player.isSmallBlind) roles.push({ text: 'SB', class: 'badge-warning' }); // Small Blind
    if (player.isBigBlind) roles.push({ text: 'BB', class: 'badge-danger' }); // Big Blind
    return roles;
};

// --- 액션 버튼 활성화/비활성화 로직 (Computed Properties) ---
const canBettingAction = computed(() => {
    return isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved &&
           room.value.status === 'playing' && room.value.currentPhase === 'betting';
});

const canCheck = computed(() => {
    // 체크는 내 현재 베팅액이 룸의 현재 최고 베팅액과 같을 때만 가능
    // (즉, 내가 이미 모든 베팅에 맞춰 냈거나, 아무도 베팅하지 않은 상태)
    return canBettingAction.value && room.value.currentBet === (myPlayer.value?.currentRoundBet || 0);
});

const canCall = computed(() => {
    const amountToCall = room.value.currentBet - (myPlayer.value?.currentRoundBet || 0);
    // 콜은 내 현재 베팅액이 룸의 현재 최고 베팅액보다 낮고, 칩이 충분할 때만 가능
    // 즉, amountToCall이 0보다 커야 콜할 수 있음
    return canBettingAction.value && amountToCall > 0 && amountToCall <= (myPlayer.value?.chips || 0);
});

// '삥' (bet) 액션 활성화 조건 (GameService와 동기화)
const canBbing = computed(() => {
    if (!canBettingAction.value) return false;

    const myChips = myPlayer.value?.chips || 0;
    const bbingAmount = room.value.betAmount; // '삥'의 기본 단위는 방의 최소 베팅액
    const myCurrentRoundBet = myPlayer.value?.currentRoundBet || 0;

    let chipsToPay = 0;
    let validBbingCondition = false;

    // 시나리오 1: 현재 룸의 최고 베팅액이 방의 최소 베팅액과 같고, 내가 이미 그만큼 베팅한 경우
    // (예: 모든 플레이어가 안테를 100씩 냈고, currentBet도 100인 상태에서 내가 첫 레이즈(삥)를 거는 상황)
    // 이 시나리오는 `handlePhaseTransitionAfterExchange`에서 `currentBet`을 `0`으로 초기화함으로써 방지됨.
    // 따라서, 이 조건은 현재 게임 로직 상 `false`가 될 가능성이 높음.
    /*
    if (room.value.currentBet === room.value.betAmount && myCurrentRoundBet === room.value.betAmount) {
        chipsToPay = bbingAmount; // 추가로 bbingAmount만큼 내야 함 (레이즈)
        validBbingCondition = true;
    }
    */
    // 시나리오 2: 현재 룸의 최고 베팅액이 0인 경우 (이 라운드에서 아무도 베팅하지 않은 첫 액션)
    // `handlePhaseTransitionAfterExchange`에서 `currentBet`이 `0`으로 초기화되므로,
    // 이 조건은 새로운 베팅 라운드 시작 시 첫 번째 액션으로 '삥'을 할 수 있도록 활성화됨.
    if (room.value.currentBet === 0) {
        chipsToPay = bbingAmount - myCurrentRoundBet; // 이 경우 myCurrentRoundBet도 0일 것
        if (chipsToPay > 0) {
            validBbingCondition = true;
        }
    }
    // 그 외의 경우 (누군가 이미 레이즈했거나, currentBet이 room.betAmount를 초과하는 경우) '삥' 액션 불가
    else {
        return false;
    }

    return validBbingCondition && myChips >= chipsToPay;
});

// '삥' 버튼 클릭 시 실제로 나갈 칩 금액을 계산하는 computed 속성
const myChipsToPayForBbing = computed(() => {
    if (!canBettingAction.value) return 0; // 버튼이 비활성화되면 0

    const bbingAmount = room.value.betAmount;
    const myCurrentRoundBet = myPlayer.value?.currentRoundBet || 0;

    // `canBbing`의 로직과 동일하게 계산
    if (room.value.currentBet === room.value.betAmount && myCurrentRoundBet === room.value.betAmount) {
        return bbingAmount;
    } else if (room.value.currentBet === 0) {
        return bbingAmount - myCurrentRoundBet;
    } else {
        return 0; // '삥' 불가 상황
    }
});


const getMinRaiseTotalAmount = computed(() => {
    return (room.value.currentBet || 0) + (room.value.betAmount || 0);
});

// 레이즈에 필요한 추가 칩 계산 헬퍼 함수
const calculateChipsNeededForTotalBet = (totalTargetBet) => {
    return totalTargetBet - (myPlayer.value?.currentRoundBet || 0);
};

const getRaiseAmountForHalf = computed(() => {
    const pot = room.value.pot || 0;
    const currentBet = room.value.currentBet || 0;
    const minRaise = room.value.betAmount || 0; // 최소 레이즈 단위

    let targetRaiseAmount = currentBet + Math.floor(pot / 2);
    // 최소 레이즈 금액(현재 베팅액 + 최소 베팅 단위)보다 낮으면 최소 레이즈 금액으로 설정
    // 또한, 0보다 작은 값은 없도록 Math.max
    return Math.max(targetRaiseAmount, currentBet + minRaise, minRaise); // 최소한 minRaise는 되어야 함
});

const canRaiseToHalf = computed(() => {
    if (!canBettingAction.value) return false;
    const totalTargetBet = getRaiseAmountForHalf.value;
    const amountNeeded = calculateChipsNeededForTotalBet(totalTargetBet);
    const myChips = myPlayer.value?.chips || 0;

    // 레이즈 금액이 currentBet보다 커야 하고, 칩이 충분해야 함
    return totalTargetBet > room.value.currentBet && amountNeeded > 0 && myChips >= amountNeeded;
});

const getRaiseAmountForFull = computed(() => {
    const pot = room.value.pot || 0;
    const currentBet = room.value.currentBet || 0;
    const minRaise = room.value.betAmount || 0;

    let targetRaiseAmount = currentBet + pot;
    // 최소 레이즈 금액(현재 베팅액 + 최소 베팅 단위)보다 낮으면 최소 레이즈 금액으로 설정
    // 또한, 0보다 작은 값은 없도록 Math.max
    return Math.max(targetRaiseAmount, currentBet + minRaise, minRaise);
});

const canRaiseToFull = computed(() => {
    if (!canBettingAction.value) return false;
    const totalTargetBet = getRaiseAmountForFull.value;
    const amountNeeded = calculateChipsNeededForTotalBet(totalTargetBet);
    const myChips = myPlayer.value?.chips || 0;

    // 레이즈 금액이 currentBet보다 커야 하고, 칩이 충분해야 함
    return totalTargetBet > room.value.currentBet && amountNeeded > 0 && myChips >= amountNeeded;
});

const canDie = computed(() => {
    return isMyTurn.value && !myPlayer.value?.folded && !myPlayer.value?.leaveReserved && room.value.status === 'playing';
});

const canExchangeCards = computed(() => {
    // 내 턴이고, 교환 페이즈이고, 교환 기회가 남아있고, 아직 교환하지 않았을 때
    return isMyTurn.value &&
           !myPlayer.value?.folded &&
           !myPlayer.value?.leaveReserved &&
           room.value.status === 'playing' &&
           room.value.currentPhase === 'exchange' &&
           myPlayer.value?.canExchange === true && // ✅ 명시적으로 true 체크
           room.value.currentExchangeOpportunityIndex > -1 &&
           room.value.currentExchangeOpportunityIndex < room.value.maxExchangeOpportunities;
});

const canStay = computed(() => {
    // 교환과 동일한 조건
    return isMyTurn.value &&
           !myPlayer.value?.folded &&
           !myPlayer.value?.leaveReserved &&
           room.value.status === 'playing' &&
           room.value.currentPhase === 'exchange' &&
           myPlayer.value?.canExchange === true && // ✅ 명시적으로 true 체크
           room.value.currentExchangeOpportunityIndex > -1 &&
           room.value.currentExchangeOpportunityIndex < room.value.maxExchangeOpportunities;
});
// --- 끝: 액션 버튼 활성화/비활성화 로직 ---

const toggleCardSelection = (cardId) => {
    if (!isMyTurn.value || room.value.status !== 'playing' || myPlayer.value?.folded || myPlayer.value?.leaveReserved ||
        room.value.currentPhase !== 'exchange') {
        logger.notify('지금은 카드를 선택할 수 없습니다. 카드 교환 페이즈에만 가능합니다.', 'warn');
        return;
    }

    if (room.value.currentExchangeOpportunityIndex === -1 || room.value.currentExchangeOpportunityIndex >= room.value.maxExchangeOpportunities) {
        logger.notify('현재 라운드에는 카드를 교환할 수 없습니다. 교환 기회를 확인하세요.', 'warn');
        return;
    }

    if (!myPlayer.value?.canExchange) {
        logger.notify('이번 교환 페이즈에 이미 카드를 교환했거나 스테이했습니다.', 'warn');
        return;
    }

    const index = selectedCardsIds.value.indexOf(cardId);
    if (index > -1) {
        selectedCardsIds.value.splice(index, 1);
    } else {
        if (selectedCardsIds.value.length < 4) {
            selectedCardsIds.value.push(cardId);
        } else {
            logger.notify('카드는 최대 4장까지 선택할 수 있습니다.', 'warn');
        }
    }
};

const isCardSelected = (cardId) => {
    return cardId !== null && selectedCardsIds.value.includes(cardId);
};

const getCardTitle = (card, isMyCard) => {
    if (!card || card.suit === 'back' || card.rank === 'back') {
        return 'Hidden Card';
    }
    if (roomStatus.value === 'showdown' || roomStatus.value === 'ended') {
        return `${card.suit}${card.rank}`;
    }
    return isMyCard ? `${card.suit}${card.rank}` : 'Hidden Card';
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
    if (card === null) {
        classes.push('card-empty-slot');
        return classes;
    }
    if (card.suit === 'back' || card.rank === 'back') {
        // img 태그로 뒷면 이미지를 보여주므로, 여기에 suit/rank 클래스 불필요
    } else if (shouldShowCardFace(card, showFront)) {
        classes.push(`suit-${card.suit.toLowerCase()}`);
        const rankClass = card.rank === 'T' ? 't' : card.rank.toLowerCase();
        classes.push(`rank-${rankClass}`);
    } else {
        // img 태그로 뒷면 이미지를 보여주므로, 여기에 suit/rank 클래스 불필요
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
            displayHand.push(null);
        }
        return displayHand;
    } else {
        return Array(4).fill(null).map((_, index) => ({ id: `back-${playerId}-${index}`, suit: 'back', rank: 'back' }));
    }
};

const shouldShowCardFace = (card, isMyCard) => {
    if (card === null) return false;
    if (card.suit === 'back' || card.rank === 'back') return false;

    if (room.value.status === 'showdown' || room.value.status === 'ended') {
        const playerFinalHand = finalHands.value[players.value.find(p => p.id === myUserId.value)?.id || ''];
        if (isMyCard && playerFinalHand && playerFinalHand.some(fc => fc.id === card.id)) return true;
        return true;
    }
    return isMyCard;
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

    const isBettingPhaseAction = (actionType === 'bet' || actionType === 'call' || actionType === 'raise' || actionType === 'check');
    const isExchangePhaseAction = (actionType === 'exchange' || actionType === 'stay');
    const isCommonAction = (actionType === 'die');

    if (room.value.currentPhase === 'betting' && !isBettingPhaseAction && !isCommonAction) {
        logger.notify('현재는 베팅 페이즈입니다. 베팅 관련 액션 또는 다이를 선택하세요.', 'warn');
        return;
    }
    if (room.value.currentPhase === 'exchange' && !isExchangePhaseAction && !isCommonAction) {
        logger.notify('현재는 카드 교환 페이즈입니다. 교환/스테이 또는 다이를 선택하세요.', 'warn');
        return;
    }
    if (isExchangePhaseAction && (room.value.currentExchangeOpportunityIndex === -1 || room.value.currentExchangeOpportunityIndex >= room.value.maxExchangeOpportunities)) {
        logger.notify('현재 라운드에는 카드 교환을 할 수 없습니다.', 'warn');
        return;
    }
    if (myPlayer.value?.chips <= 0 && actionType !== 'die') {
        logger.notify('칩이 부족하여 해당 액션을 할 수 없습니다. 다이하세요.', 'warn');
        return;
    }

    let finalAmount = null;
    let cardsToExchangeData = undefined;

    switch (actionType) {
        case 'check':
            if (!canCheck.value) {
                logger.notify('체크할 수 없습니다. 베팅 금액을 맞춰야 합니다.', 'warn');
                return;
            }
            finalAmount = 0;
            break;
        case 'call':
            if (!canCall.value) {
                logger.notify('콜할 수 없습니다. 조건을 확인하세요.', 'warn');
                return;
            }
            finalAmount = room.value.currentBet - (myPlayer.value?.currentRoundBet || 0);
            break;
        case 'die':
        case 'stay':
            finalAmount = 0;
            break;
        case 'bet':
            {
                if (!canBbing.value) {
                     logger.notify('현재 삥을 걸 수 없습니다. 조건을 확인하세요.', 'warn');
                     return;
                }
                finalAmount = room.value.betAmount; // 삥은 방의 최소 베팅액으로
            }
            break;
        case 'raise':
            {
                if (!canRaiseToHalf.value && !canRaiseToFull.value) { // 레이즈 자체가 불가능한 경우
                    logger.notify('레이즈할 수 없습니다. 조건을 확인하세요.', 'warn');
                    return;
                }
                finalAmount = payload;
                if (typeof finalAmount !== 'number' || finalAmount <= 0) {
                    logger.notify('유효한 레이즈 금액을 입력해주세요.', 'warn');
                    return;
                }
                const minRaiseTotal = getMinRaiseTotalAmount.value;
                if (finalAmount < minRaiseTotal) {
                    logger.notify(`레이즈는 총 ${minRaiseTotal} 칩 이상으로 해야 합니다.`, 'warn');
                    return;
                }
            }
            break;
        case 'exchange':
            {
                if (!canExchangeCards.value) {
                    logger.notify('카드를 교환할 수 없습니다. 조건을 확인하세요.', 'warn');
                    return;
                }
                cardsToExchangeData = selectedCardsIds.value;
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
        amount: finalAmount,
        cardsToExchange: cardsToExchangeData
    }, (response) => {
        if (response.success) {
            logger.log('[GameRoom] 액션 요청 성공:', actionType);
            selectedCardsIds.value = [];
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

socket.on('gameStarted', (data) => {
    logger.log('[GameRoom] 게임 시작 이벤트 수신:', data);
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
});

socket.on('roundStarted', (data) => {
    logger.log('[GameRoom] 라운드 시작 이벤트 수신:', data);
    currentBettingRoundIndex.value = data.currentBettingRoundIndex;
    currentExchangeOpportunityIndex.value = data.currentExchangeOpportunityIndex;
    gameRoundName.value = data.gameRoundName;
    currentPhase.value = data.currentPhase;
    currentBet.value = data.currentBet;
    pot.value = data.pot;

    logger.notify(`${data.gameRoundName} 라운드가 시작되었습니다!`, 'info');
    selectedCardsIds.value = [];
});

socket.on('phaseChanged', (data) => {
    logger.log('[GameRoom] 페이즈 변경 이벤트 수신:', data);
    currentBettingRoundIndex.value = data.currentBettingRoundIndex;
    currentExchangeOpportunityIndex.value = data.currentExchangeOpportunityIndex;
    gameRoundName.value = data.gameRoundName;
    currentPhase.value = data.currentPhase;
    currentBet.value = data.currentBet;
    pot.value = data.pot;

    logger.notify(data.message || `현재 페이즈: ${displayCurrentPhase.value}`, 'info');
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
  router.replace('/lobby');
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
            currentBet.value = response.room.currentBet;
            pot.value = response.room.pot;

            currentBettingRoundIndex.value = response.room.currentBettingRoundIndex;
            currentExchangeOpportunityIndex.value = response.room.currentExchangeOpportunityIndex;
            gameRoundName.value = response.room.gameRoundName;
            currentPhase.value = response.room.currentPhase;
            maxBettingRounds.value = response.room.maxBettingRounds || 4;
            maxExchangeOpportunities.value = response.room.maxExchangeOpportunities || 3;

            dealerId.value = response.room.dealerId;
            smallBlindId.value = response.room.smallBlindId;
            bigBlindId.value = response.room.bigBlindId;

            if (!response.room.players.some(p => p.id === myUserId.value) && response.room.status === 'waiting') {
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
    router.replace('/lobby');
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
    socket.on('phaseChanged', (data) => { logger.log('[GameRoom] phaseChanged 이벤트 수신', data); });
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
        socket.off('phaseChanged');
        socket.off('turnChanged');
        socket.off('playerAction');
        socket.off('myHandUpdated');
        socket.off('gameEnded');
        socket.off('forceLeaveRoom');
    });
});

// ✅ 개발 모드에서만 활성화되는 디버그용 watch (필요시 주석 해제)
// watch(() => ({
//     phase: currentPhase.value,
//     isMyTurn: isMyTurn.value,
//     canExchange: myPlayer.value?.canExchange,
//     folded: myPlayer.value?.folded,
//     currentBet: currentBet.value,
//     myCurrentRoundBet: myPlayer.value?.currentRoundBet,
//     pot: pot.value,
//     betAmount: betAmount.value,
//     canCheck: canCheck.value,
//     canCall: canCall.value,
//     canBbing: canBbing.value,
//     canRaiseToHalf: canRaiseToHalf.value,
//     canRaiseToFull: canRaiseToFull.value,
//     canDie: canDie.value,
//     canExchangeCards: canExchangeCards.value,
//     canStay: canStay.value,
// }), (state) => {
//     if (isMyTurn.value) { // 내 턴일 때만 로그
//         console.log('[DEBUG-WATCH] 현재 상태 및 버튼 활성화:', state);
//     }
// }, { deep: true });
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
.mb-1 { margin-bottom: 0.25rem; }
.mb-0 { margin-bottom: 0 !important; }
.mt-2 { margin-top: 0.5rem; }
.mt-3 { margin-top: 1rem; }
.mt-4 { margin-top: 1.5rem; }
.mb-3 { margin-bottom: 1rem; }
.mb-4 { margin-bottom: 1.5rem; }
.d-flex { display: flex; }
.justify-content-center { justify-content: center; }
.align-items-center { align-items: center; }
.ml-1 { margin-left: 0.25rem; }
.ml-2 { margin-left: 0.5rem; }
.p-3 { padding: 1rem; }
.rounded { border-radius: 0.25rem; }
.border { border: 1px solid #dee2e6; }
.bg-light { background-color: #f8f9fa; }

.btn {
  padding: 0.75rem 1.25rem;
  border-radius: 0.3rem;
  font-size: 1rem;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s ease;
  white-space: nowrap;
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

.action-buttons-row button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.room-info-summary {
    background-color: #e9ecef;
    border: 1px solid #dee2e6;
    padding: 15px;
    border-radius: 5px;
    margin-bottom: 20px;
}
.room-info-summary p {
    font-size: 0.95rem;
}

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
.list-group-item.active-player-turn {
    border-left: 5px solid #28a745;
    background-color: #e6ffed;
    box-shadow: 0 2px 8px rgba(40,167,69,0.2);
}

.player-hand {
    display: flex;
    gap: 5px;
    justify-content: center;
    margin-top: 10px;
    min-height: 315px;
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
    background-size: calc(225px * 13) calc(315px * 4);
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
    background-color: #f0f0f0;
    border: 1px dashed #ccc;
    width: 225px;
    height: 315px;
    border-radius: 5px;
    display: inline-block;
    margin: 2px;
    box-shadow: inset 0 0 5px rgba(0,0,0,0.1);
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
.badge-danger { background-color: #dc3545; }
.badge-dark { background-color: #343a40; }


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

.alert-info {
    background-color: #d1ecf1;
    border-color: #bee5eb;
    color: #0c5460;
    border-radius: 0.3rem;
    font-size: 0.9rem;
}
</style>