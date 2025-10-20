<template>
  <div class="lobby-page-wrapper container">
    <h1 class="text-center mb-4">바둑이 로비</h1>

    <!-- 사용자 정보 및 주요 액션 버튼 -->
    <div class="user-actions-panel card card-info card-outline mb-4">
        <div class="card-header">
            <h3 class="card-title"><i class="fas fa-user-circle mr-2"></i><strong>{{ userName }}</strong> 님</h3>
            <div class="card-tools">
                <span class="badge badge-success"><i class="fas fa-coins mr-1"></i>보유 칩: <strong>{{ Number(userChips).toLocaleString() }}</strong></span>
            </div>
        </div>
        <div class="card-body d-flex justify-content-center flex-wrap">
            <button @click="createRoom" class="btn btn-primary btn-lg mr-2 mb-2"><i class="fas fa-plus-circle mr-2"></i>새 방 만들기</button>
            <button @click="logout" class="btn btn-danger btn-lg mb-2"><i class="fas fa-sign-out-alt mr-2"></i>로그아웃</button>
        </div>
    </div>

    <h3 class="mb-3"><i class="fas fa-chess-king mr-2"></i>개설된 게임 방</h3>
    <div v-if="!isSocketConnected" class="alert alert-warning text-center">
        <i class="fas fa-spinner fa-spin mr-2"></i>Socket.IO 서버에 연결 중입니다... 잠시만 기다려주세요.
        <br>
        <small>({{ socketStatusMessage }})</small>
    </div>
    <div v-else-if="isLoadingRooms" class="alert alert-info text-center">
        <i class="fas fa-sync-alt fa-spin mr-2"></i>방 목록을 불러오는 중입니다...
    </div>
    <div v-else-if="rooms.length === 0" class="alert alert-info text-center">
        <i class="fas fa-info-circle mr-2"></i>현재 개설된 방이 없습니다. 새 방을 만들어보세요!
    </div>
    <div v-else class="room-list-grid">
        <div v-for="room in rooms" :key="room.id" class="room-card card card-widget card-outline"
             :class="{
                'card-primary': room.status === 'waiting',
                'card-secondary': room.status === 'playing' || room.status === 'showdown',
                'border-danger': room.status !== 'waiting' || room.players >= room.maxPlayers
             }">
            <div class="card-header">
                <h5 class="card-title">{{ room.name }} <span v-if="room.isPrivate" class="badge badge-secondary ml-1"><i class="fas fa-lock"></i> 비밀방</span></h5>
                <div class="card-tools">
                    <span :class="['badge', room.status === 'waiting' ? 'badge-primary' : (room.status === 'playing' ? 'badge-secondary' : 'badge-warning')]">
                        {{ room.status === 'waiting' ? '대기 중' : (room.status === 'playing' ? '게임 중' : '종료됨') }}
                    </span>
                </div>
            </div>
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <p class="mb-0 text-muted"><i class="fas fa-users mr-1"></i>인원: {{ room.players }}/{{ room.maxPlayers }}</p>
                    <p class="mb-0 text-muted"><i class="fas fa-money-bill-wave mr-1"></i>베팅: {{ room.betAmount }} 칩</p>
                </div>
                <button @click="handleJoinRoom(room)" :disabled="room.status !== 'waiting' || room.players >= room.maxPlayers" class="btn btn-block btn-flat"
                        :class="{'btn-primary': room.status === 'waiting' && room.players < room.maxPlayers, 'btn-secondary': room.status !== 'waiting' || room.players >= room.maxPlayers}">
                    <i class="fas fa-door-open mr-2"></i>{{ room.status === 'waiting' && room.players < room.maxPlayers ? '입장하기' : (room.status === 'playing' ? '게임 중' : '방 가득참') }}
                </button>
            </div>
        </div>
    </div>

    <!-- 새 방 만들기 모달 -->
    <div v-if="showCreateRoomModal" class="modal-overlay">
        <div class="modal-content">
            <h4>새 게임 방 만들기</h4>
            <div class="form-group">
                <label for="roomName">방 제목:</label>
                <input type="text" id="roomName" v-model="newRoom.name" class="form-control">
            </div>
            <div class="form-group">
                <label for="betAmount">최소 베팅 칩:</label>
                <input type="number" id="betAmount" v-model="newRoom.betAmount" class="form-control">
            </div>
            <div class="form-group">
                <label for="roomPassword">비밀번호 (선택 사항):</label>
                <input type="password" id="roomPassword" v-model="newRoom.password" class="form-control">
            </div>
            <div class="button-group d-flex justify-content-center gap-2 mt-3">
              <button @click="submitCreateRoom" class="btn btn-success flex-grow-1">
                <i class="fas fa-check mr-2"></i>생성
              </button>
              <button @click="cancelCreateRoom" class="btn btn-secondary flex-grow-1">
                <i class="fas fa-times mr-2"></i>취소
              </button>
            </div>
        </div>
    </div>

    <!-- 비밀방 입장용 비밀번호 입력 모달 -->
    <div v-if="showPasswordModal" class="modal-overlay">
        <div class="modal-content">
            <h4>비밀방 입장</h4>
            <p class="text-muted mb-3">"{{ selectedRoomName }}" 방에 입장하려면 비밀번호를 입력하세요.</p>
            <div class="form-group">
                <label for="joinPassword">비밀번호:</label>
                <input type="password" id="joinPassword" v-model="joinPasswordInput" class="form-control" @keyup.enter="confirmJoinRoom">
            </div>
            <div class="button-group d-flex justify-content-center gap-2 mt-3">
              <button @click="confirmJoinRoom" class="btn btn-primary flex-grow-1"><i class="fas fa-door-open mr-2"></i>입장</button>
              <button @click="cancelPasswordModal" class="btn btn-secondary flex-grow-1"><i class="fas fa-times mr-2"></i>취소</button>
            </div>
        </div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, inject, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { logger } from '../utils/logger';
import axios from 'axios';

const router = useRouter();
const socket = inject('socket'); // socketInstance ref
const isSocketConnected = inject('isSocketConnected');

const userName = ref(localStorage.getItem('user_name') || '게스트');
const userChips = ref(localStorage.getItem('user_chips') ? parseInt(localStorage.getItem('user_chips')) : 0);

const rooms = ref([]);
const showCreateRoomModal = ref(false);
const newRoom = ref({
  name: `${userName.value}의 방`,
  betAmount: 100,
  maxPlayers: 5,
  password: '',
});

const socketStatusMessage = ref('초기화 중...');
const isLoadingRooms = ref(true);

const showPasswordModal = ref(false);
const selectedRoomId = ref(null);
const selectedRoomName = ref('');
const joinPasswordInput = ref('');


const createRoom = () => {
  showCreateRoomModal.value = true;
};

const cancelCreateRoom = () => {
  showCreateRoomModal.value = false;
  newRoom.value = {
    name: `${userName.value}의 방`,
    betAmount: 100,
    maxPlayers: 5,
    password: '',
  };
};

const submitCreateRoom = () => {
  if (!newRoom.value.name || !newRoom.value.betAmount) {
    logger.notify('방 제목과 베팅 금액을 입력해주세요.', 'warn');
    return;
  }
  if (newRoom.value.betAmount <= 0) {
      logger.notify('최소 베팅 금액은 0보다 커야 합니다.', 'warn');
      return;
  }
  if (newRoom.value.betAmount > userChips.value) {
      logger.notify('보유 칩보다 높은 베팅 금액으로 방을 생성할 수 없습니다.', 'warn');
      return;
  }

  logger.log('[Lobby] 새 방 생성 요청:', newRoom.value);

  if (!isSocketConnected.value) {
      logger.notify('Socket.IO 연결이 끊어졌습니다. 방을 생성할 수 없습니다. 다시 로그인해주세요.', 'error');
      return;
  }

  // ✨ FIX: socket.value.emit으로 변경
  if (socket.value) {
    socket.value.emit('createRoom', newRoom.value, (response) => {
      if (response.success) {
        logger.log('[Lobby] 방 생성 성공:', response.room);
        // ✨ FIX: socket.value.emit으로 변경
        if (socket.value) { // 중첩된 emit에도 socket.value 확인
          socket.value.emit('joinRoom', { roomId: response.room.id, password: newRoom.value.password, initialChips: userChips.value }, (joinResponse) => {
            if (joinResponse.success) {
                logger.log('[Lobby] 방 생성 후 자동 입장 성공:', joinResponse.room);
                router.push(`/room/${joinResponse.room.id}`);
            } else {
                logger.notify('방 생성 후 자동 입장 실패: ' + joinResponse.message, 'error');
                if (isSocketConnected.value) {
                  // ✨ FIX: socket.value.emit으로 변경
                  if (socket.value) {
                    socket.value.emit('getRooms');
                  }
                }
            }
          });
        }
      } else {
        logger.notify('방 생성 실패: ' + response.message, 'error');
      }
    });
  }
  cancelCreateRoom();
};

const handleJoinRoom = (room) => {
    if (room.isPrivate) {
        selectedRoomId.value = room.id;
        selectedRoomName.value = room.name;
        joinPasswordInput.value = '';
        showPasswordModal.value = true;
    } else {
        joinRoom(room.id, null);
    }
};

const confirmJoinRoom = () => {
    if (!joinPasswordInput.value) {
        logger.notify('비밀번호를 입력해주세요.', 'warn');
        return;
    }
    joinRoom(selectedRoomId.value, joinPasswordInput.value);
    cancelPasswordModal();
};

const cancelPasswordModal = () => {
    showPasswordModal.value = false;
    selectedRoomId.value = null;
    selectedRoomName.value = '';
    joinPasswordInput.value = '';
};

const joinRoom = (roomId, password = null) => {
    logger.log('[Lobby] 방 입장 요청:', roomId, '비밀번호 유무:', !!password, '내 칩:', userChips.value);
    if (!isSocketConnected.value) {
        logger.notify('Socket.IO 연결이 끊어졌습니다. 방에 입장할 수 없습니다. 다시 로그인해주세요.', 'error');
        return;
    }

    // ✨ FIX: socket.value.emit으로 변경
    if (socket.value) {
      socket.value.emit('joinRoom', {
          roomId: roomId,
          password: password,
          initialChips: userChips.value
      }, (response) => {
          if (response.success) {
              logger.log('[Lobby] 방 입장 성공:', response.room);
              router.push(`/room/${response.room.id}`);
          } else {
              logger.notify('방 입장 실패: ' + response.message, 'error');
          }
      });
    }
};

const logout = () => {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('user_name');
  localStorage.removeItem('user_id');
  localStorage.removeItem('user_chips');
  if (socket.value) {
    socket.value.disconnect();
  }
  router.replace('/login');
};

const handleRoomsUpdated = (updatedRooms) => {
  logger.log('[Lobby] 방 목록 업데이트 수신:', updatedRooms);
    rooms.value = [...updatedRooms];
    isLoadingRooms.value = false;
    nextTick(() => {
        logger.log('[Lobby] UI 갱신 후 rooms.value:', rooms.value);
        logger.log('[Lobby] UI 갱신 후 rooms.length:', rooms.value.length);
    });
};

const fetchUserChips = async () => {
    const jwtToken = localStorage.getItem('jwt_token');
    if (!jwtToken) {
        logger.notify('인증 토큰이 없습니다. 다시 로그인해주세요.', 'warn');
        router.replace('/login');
        return;
    }
    try {
        const response = await axios.get('http://localhost:8000/api/auth/user-chips', {
            headers: {
                'Authorization': `Bearer ${jwtToken}`
            }
        });
        userChips.value = response.data.chips;
        localStorage.setItem('user_chips', response.data.chips);
        logger.log('[Lobby] 사용자 칩 정보 가져오기 성공:', response.data.chips);
    } catch (error) {
        logger.error('[Lobby] 사용자 칩 정보 가져오기 실패:', error);
        if (error.response && error.response.status === 401) {
            logger.notify('인증 토큰이 만료되었습니다. 다시 로그인해주세요.', 'error');
            logout();
        } else {
            logger.notify('사용자 칩 정보를 가져오는 데 실패했습니다.', 'error');
        }
    }
};

const requestRoomsAndChips = () => {
  logger.log('[Lobby] Socket.IO 연결 상태:', isSocketConnected.value);
    if (isSocketConnected.value) {
        logger.log('[Lobby] Socket.IO 연결됨, 방 목록 및 칩 요청 중...');
        isLoadingRooms.value = true;
        if (socket.value) {
          socket.value.emit('getRooms');
        }
        fetchUserChips();
    } else {
        logger.warn('[Lobby] Socket.IO 연결되지 않음. 로비에서 연결 대기.');
        rooms.value = [];
        socketStatusMessage.value = 'Socket.IO 서버에 연결 중입니다...';
        isLoadingRooms.value = false;
    }
};


onMounted(() => {
    const unwatchIsConnected = watch(isSocketConnected, (newValue) => {
        logger.log('[Lobby] isSocketConnected watch 발동, newValue:', newValue);
        if (newValue === true) {
            logger.log('[Lobby] Socket.IO 연결됨, 방 목록 및 칩 요청.');
            requestRoomsAndChips();
            socketStatusMessage.value = 'Socket.IO 서버에 연결되었습니다.';
        } else {
            logger.warn('[Lobby] Socket.IO 연결 끊김 감지.');
            rooms.value = [];
            socketStatusMessage.value = `Socket.IO 서버에 연결 끊김. (${socket.value?.io?.engine?.transport?.name || 'Unknown'}) 재연결 시도 중...`;
            isLoadingRooms.value = false;
        }
    }, { immediate: true });


    if (socket.value) {
      socket.value.on('roomsUpdated', handleRoomsUpdated);
      socket.value.on('connect', () => {
          logger.log('[Lobby] Socket.IO: 연결 성공 (Lobby Listener)');
          socketStatusMessage.value = 'Socket.IO 서버에 연결되었습니다.';
      });
      socket.value.on('disconnect', (reason) => {
          logger.warn(`[Lobby] Socket.IO: 연결 해제됨 (Lobby Listener - ${reason})`);
          socketStatusMessage.value = `Socket.IO 서버에 연결 해제됨: ${reason}`;
      });
      socket.value.on('connect_error', (error) => {
          logger.error(`[Lobby] Socket.IO: 연결 오류 발생 (Lobby Listener) - ${error.message}`);
          socketStatusMessage.value = `Socket.IO 연결 오류: ${error.message}`;
      });
      socket.value.on('reconnect_attempt', (attemptNumber) => {
          logger.info(`[Lobby] Socket.IO: 재연결 시도 중 (Lobby Listener - ${attemptNumber}번째)`);
          socketStatusMessage.value = `Socket.IO 재연결 시도 중... (${attemptNumber}번째)`;
      });
      socket.value.on('reconnect_failed', () => {
          logger.error('[Lobby] Socket.IO: 재연결 실패 (Lobby Listener)');
          socketStatusMessage.value = 'Socket.IO 재연결 실패';
      });
      socket.value.on('reconnect', (attemptNumber) => {
          logger.log(`[Lobby] Socket.IO: 재연결 성공 (Lobby Listener - ${attemptNumber}번째)`);
          socketStatusMessage.value = 'Socket.IO 서버에 재연결되었습니다.';
      });
    }


    onUnmounted(() => {
        unwatchIsConnected();
        if (socket.value) {
          socket.value.off('roomsUpdated', handleRoomsUpdated);
          socket.value.off('connect');
          socket.value.off('disconnect');
          socket.value.off('connect_error');
          socket.value.off('reconnect_attempt');
          socket.value.off('reconnect_failed');
          socket.value.off('reconnect');
        }
    });
});
</script>

<style scoped>
.lobby-page-wrapper {
  max-width: 1200px; /* 데스크톱에서 최대 너비 */
  margin: 20px auto;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  background-color: #f8f9fa;
}

h1, h3 {
    color: #343a40;
    font-weight: 600;
}

/* 사용자 정보 및 액션 패널 */
.user-actions-panel.card {
    border-top: 3px solid #007bff; /* AdminLTE primary color */
    box-shadow: 0 0 1px rgba(0,0,0,.125),0 1px 3px rgba(0,0,0,.2);
}
.user-actions-panel .card-header {
    background-color: #f4f6f9; /* 약간 다른 배경색 */
    border-bottom: 1px solid rgba(0,0,0,.125);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.25rem;
}
.user-actions-panel .card-title {
    font-size: 1.15rem;
    font-weight: 600;
    color: #343a40;
}
.user-actions-panel .card-tools .badge {
    padding: 0.5em 0.8em;
    font-size: 0.9em;
}
.user-actions-panel .card-body {
    padding: 1.25rem;
    justify-content: center; /* 버튼 중앙 정렬 */
}
.user-actions-panel .btn-lg {
    min-width: 180px; /* 버튼 최소 너비 */
    font-size: 1.05rem;
}
.user-actions-panel .btn-lg.mr-2 {
    margin-right: 15px; /* 버튼 사이 간격 */
}

/* 방 목록 그리드 레이아웃 */
.room-list-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); /* 최소 280px, 반응형 */
    gap: 20px; /* 카드 사이 간격 */
}

.room-card.card {
    background-color: #ffffff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.08);
    border-radius: 0.5rem;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.room-card.card:hover {
    transform: translateY(-5px);
    box-shadow: 0 6px 15px rgba(0,0,0,0.15);
}
.room-card.card-primary { border-top-color: #007bff; }
.room-card.card-secondary { border-top-color: #6c757d; }
.room-card.border-danger { border-color: #dc3545; } /* 비활성 방 표시 */


.room-card .card-header {
    padding: 0.75rem 1.25rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(0,0,0,.08);
    background-color: #fbfdff; /* 헤더 배경색 */
}
.room-card .card-title {
    font-size: 1.1rem;
    font-weight: 500;
    margin-bottom: 0;
}
.room-card .card-body {
    padding: 1.25rem;
}
.room-card .card-text {
    font-size: 0.95rem;
    color: #555;
    margin-bottom: 0.5rem;
}
.room-card .badge {
    font-size: 0.85em;
    padding: 0.4em 0.7em;
}
.room-card .btn-block {
    margin-top: 15px;
    font-size: 1rem;
    padding: 0.65rem 1rem;
}
.room-card .btn-primary { background-color: #007bff; border-color: #007bff; color: white; }
.room-card .btn-primary:hover { background-color: #0069d9; border-color: #0062cc; }
.room-card .btn-secondary { background-color: #6c757d; border-color: #6c757d; color: white; opacity: 0.8; cursor: not-allowed;}
.room-card .btn-secondary:hover { background-color: #5a6268; border-color: #5a6268; }

/* 모달 스타일 (재사용) */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6); /* ✨ FIX: 배경을 더 어둡게 하여 모달을 부각 */
    display: flex;
    justify-content: center;
    align-items: center; /* ✨ FIX: 모달 수직 중앙 정렬 */
    z-index: 1000;
}

.modal-content {
    background: white;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
    width: 400px;
    max-width: 90%; /* 모바일 대응 */
    /* ✨ FIX: PC 환경에서 모달이 너무 내려오지 않도록 margin-top 조정 */
    margin-top: -50px; /* 화면 중앙보다 약간 위로 */
    text-align: center;
    position: relative; /* z-index가 제대로 작동하도록 */
}

.modal-content h4 {
    margin-bottom: 20px;
    color: #343a40;
    font-size: 1.5rem;
}

.modal-content p {
    margin-bottom: 15px;
    color: #555;
}
.form-group {
    margin-bottom: 20px;
    text-align: left;
}
.form-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: bold;
    color: #495057;
}
.form-control {
    width: 100%;
    padding: 12px;
    border: 1px solid #ced4da;
    border-radius: 5px;
    box-sizing: border-box;
    font-size: 1rem;
}
/* ✅ 버튼을 한 줄로 정렬 */
.modal-content .button-group {
    display: flex;
    justify-content: center;
    gap: 10px; /* 버튼 간격 */
    margin-top: 15px;
}

.modal-content .button-group button {
    flex: 1;
    padding: 0.75rem 1.25rem;
    font-size: 1rem;
    border-radius: 0.3rem;
}

.modal-content .btn-success {
    background-color: #28a745;
    color: white;
    border: none;
}
.modal-content .btn-success:hover {
    background-color: #218838;
}

.modal-content .btn-secondary {
    background-color: #6c757d;
    color: white;
    border: none;
}
.modal-content .btn-secondary:hover {
    background-color: #5a6268;
}


/* --- 반응형 디자인 (Media Queries) --- */

/* 태블릿 (최대 992px) */
@media (max-width: 992px) {
  .lobby-page-wrapper {
    max-width: 95%; /* 너비 확장 */
    padding: 15px;
  }
  .room-list-grid {
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); /* 카드 너비 최소값 조정 */
    gap: 15px;
  }
  .user-actions-panel .btn-lg {
      min-width: unset; /* 최소 너비 제한 해제 */
      width: calc(50% - 10px); /* 2개씩 한 줄에 */
  }
  .user-actions-panel .btn-lg.mr-2 {
      margin-right: 10px;
  }
}

/* 모바일 (최대 768px) */
@media (max-width: 768px) {
  .lobby-page-wrapper {
    margin: 10px auto;
    padding: 10px;
  }
  h1 {
    font-size: 2.2rem;
  }
  h3 {
    font-size: 1.5rem;
  }
  .user-actions-panel .card-header {
      flex-direction: column; /* 헤더 세로 정렬 */
      align-items: flex-start;
  }
  .user-actions-panel .card-title {
      margin-bottom: 10px;
  }
  .user-actions-panel .card-body {
      flex-direction: column; /* 버튼 세로 정렬 */
      padding: 1rem;
  }
  .user-actions-panel .btn-lg {
      width: 100%; /* 버튼 폭 최대로 */
      margin-right: 0 !important;
      margin-bottom: 10px;
  }
  .room-list-grid {
    grid-template-columns: 1fr; /* 모바일에서 1열로 정렬 */
    gap: 15px;
  }
  .modal-content {
      padding: 20px;
      width: 95%; /* 모달 폭 더 넓게 */
      margin-top: 0; /* 모바일에서는 중앙 정렬 */
  }
  .modal-content h4 {
      font-size: 1.3rem;
  }
  .modal-content p {
      font-size: 0.9rem;
  }
}

/* 추가 모바일 최적화 (최대 576px) */
@media (max-width: 576px) {
    .lobby-page-wrapper {
        padding: 5px;
        margin: 5px auto;
    }
    h1 {
        font-size: 1.8rem;
    }
    h3 {
        font-size: 1.3rem;
    }
    .user-actions-panel .card-title {
        font-size: 1rem;
    }
    .user-actions-panel .card-tools .badge {
        font-size: 0.8em;
    }
    .user-actions-panel .card-body {
        padding: 0.8rem;
    }
    .modal-content {
        max-width: 95%;
    }
    .modal-content .button-group {
      flex-direction: column; /* 모바일에서 버튼 세로 정렬 */
      gap: 5px;
    }
}
</style>