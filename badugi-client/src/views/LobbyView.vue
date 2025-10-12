<template>
  <div class="lobby-page-wrapper container">
    <h1 class="text-center">로비</h1>
    <p class="text-center">환영합니다, <strong>{{ userName }}</strong>님! 현재 보유 칩: <strong>{{ userChips }}</strong></p>
    <p class="text-center text-muted">({{ socketStatusMessage }})</p>

    <div class="d-flex justify-content-center mb-4">
        <button @click="createRoom" class="btn btn-success">새 방 만들기</button>
        <button @click="logout" class="btn btn-danger ml-2">로그아웃</button>
        <button v-if="!isFullScreenSupported" class="btn btn-secondary ml-2" disabled>전체 화면 (지원 안됨)</button>
        <button v-else @click="toggleFullScreen" :class="['btn', 'ml-2', isFullScreen ? 'btn-warning' : 'btn-info']">
            {{ isFullScreen ? '전체 화면 종료' : '전체 화면 전환' }}
        </button>
    </div>

    <h2 class="text-center mb-3">개설된 게임 방</h2>

    <div v-if="rooms.length === 0" class="alert alert-info text-center">
        현재 개설된 방이 없습니다. 새 방을 만들어보세요!
    </div>
    <ul v-else class="list-group room-list">
        <li v-for="room in rooms" :key="room.id" class="list-group-item d-flex justify-content-between align-items-center">
            <div>
                <strong>{{ room.name }}</strong>
                <span v-if="room.isPrivate" class="badge badge-secondary ml-1">비밀방</span>
                <br>
                인원: {{ room.players }}/{{ room.maxPlayers }} | 베팅: {{ room.betAmount }} 칩
                <span class="badge ml-1" :class="{'badge-info': room.status === 'waiting', 'badge-primary': room.status === 'playing'}">
                    {{ room.status === 'waiting' ? '대기 중' : (room.status === 'playing' ? '게임 중' : room.status) }}
                </span>
            </div>
            <button @click="handleJoinRoom(room)" class="btn btn-primary" :disabled="room.status === 'playing' || room.players >= room.maxPlayers">입장</button>
        </li>
    </ul>

    <!-- 새 게임 방 만들기 모달 -->
    <div v-if="showCreateRoomModal" class="modal-overlay">
      <div class="modal-content">
        <h4>새 게임 방 만들기</h4>
        <div class="form-group">
          <label for="roomName">방 제목:</label>
          <input type="text" id="roomName" v-model="newRoom.name" class="form-control">
        </div>
        <div class="form-group">
          <label for="betAmount">최소 베팅 칩:</label>
          <input type="number" id="betAmount" v-model.number="newRoom.betAmount" class="form-control" min="100" step="100">
        </div>
        <div class="form-group">
          <label for="password">비밀번호 (선택 사항):</label>
          <input type="password" id="password" v-model="newRoom.password" class="form-control">
        </div>
        <div class="d-flex justify-content-end mt-3">
          <button @click="submitCreateRoom" class="btn btn-success">생성</button>
          <button @click="cancelCreateRoom" class="btn btn-secondary ml-2">취소</button>
        </div>
      </div>
    </div>

    <!-- 비밀방 입장 비밀번호 모달 -->
    <div v-if="showPasswordModal" class="modal-overlay">
      <div class="modal-content">
        <h4>비밀방 입장</h4>
        <p>"{{ selectedRoomName }}" 방에 입장하려면 비밀번호를 입력하세요.</p>
        <div class="form-group">
          <label for="joinPassword">비밀번호:</label>
          <input type="password" id="joinPassword" v-model="joinPasswordInput" class="form-control">
        </div>
        <div class="d-flex justify-content-end mt-3">
          <button @click="confirmJoinRoom" class="btn btn-primary">입장</button>
          <button @click="cancelPasswordModal" class="btn btn-secondary ml-2">취소</button>
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
const socket = inject('socket');
const isSocketConnected = inject('isSocketConnected');

const userName = ref(localStorage.getItem('user_name') || '게스트');
const userChips = ref(0);

const rooms = ref([]);
const showCreateRoomModal = ref(false);
const newRoom = ref({
  name: `${userName.value}의 방`,
  betAmount: 100,
  maxPlayers: 5,
  password: '',
});

const socketStatusMessage = ref('초기화 중...');

const showPasswordModal = ref(false);
const selectedRoomId = ref(null);
const selectedRoomName = ref('');
const joinPasswordInput = ref('');

// ✨ 전체 화면 관련 상태 및 기능 추가
const isFullScreen = ref(false);
const isFullScreenSupported = ref(false);

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
  if (newRoom.value.betAmount > userChips.value) {
      logger.notify('보유 칩보다 높은 베팅 금액으로 방을 생성할 수 없습니다.', 'warn');
      return;
  }

  logger.log('[Lobby] 새 방 생성 요청:', newRoom.value);

  if (!isSocketConnected.value) {
      logger.notify('Socket.IO 연결이 끊어졌습니다. 방을 생성할 수 없습니다. 다시 로그인해주세요.', 'error');
      return;
  }

  socket.emit('createRoom', newRoom.value, (response) => {
    if (response.success) {
      logger.log('[Lobby] 방 생성 성공:', response.room);
      socket.emit('joinRoom', { roomId: response.room.id, password: newRoom.value.password }, (joinResponse) => {
        if (joinResponse.success) {
            logger.log('[Lobby] 방 생성 후 자동 입장 성공:', joinResponse.room);
            router.push(`/room/${joinResponse.room.id}`);
        } else {
            logger.notify('방 생성 후 자동 입장 실패: ' + joinResponse.message, 'error');
            if (isSocketConnected.value) {
              socket.emit('getRooms');
            }
        }
      });
    } else {
      logger.notify('방 생성 실패: ' + response.message, 'error');
    }
  });
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
    logger.log('[Lobby] 방 입장 요청:', roomId, '비밀번호 유무:', !!password);
    if (!isSocketConnected.value) {
        logger.notify('Socket.IO 연결이 끊어졌습니다. 방에 입장할 수 없습니다. 다시 로그인해주세요.', 'error');
        return;
    }

    socket.emit('joinRoom', { roomId: roomId, password: password }, (response) => {
        if (response.success) {
            logger.log('[Lobby] 방 입장 성공:', response.room);
            router.push(`/room/${response.room.id}`);
        } else {
            logger.notify('방 입장 실패: ' + response.message, 'error');
        }
    });
};

const logout = () => {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('user_name');
  localStorage.removeItem('user_id');
  localStorage.removeItem('user_chips');
  socket.disconnect();
  router.replace('/login');
};

const handleRoomsUpdated = (updatedRooms) => {
    logger.log('[Lobby] 방 목록 업데이트 수신:', updatedRooms);
    rooms.value = [...updatedRooms];
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
        socket.emit('getRooms');
        fetchUserChips();
    } else {
        logger.warn('[Lobby] Socket.IO 연결되지 않음. Socket.IO 플러그인에서 리다이렉션 처리 예정.');
        const token = localStorage.getItem('jwt_token');
        if (token && !socket.connected) {
            logger.log('[Lobby] 토큰 존재하지만 연결 끊김, Socket.IO 재연결 시도 중...');
            socket.connect();
        }
    }
};

// ✨ 전체 화면 기능 토글
const toggleFullScreen = () => {
    if (!isFullScreenSupported.value) {
        logger.notify('이 브라우저는 전체 화면 기능을 지원하지 않습니다.', 'warn');
        return;
    }

    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen()
            .then(() => {
                isFullScreen.value = true;
                logger.log('전체 화면 전환 성공');
            })
            .catch(err => {
                logger.error('전체 화면 전환 실패:', err);
                logger.notify('전체 화면 전환에 실패했습니다.', 'error');
            });
    } else {
        document.exitFullscreen()
            .then(() => {
                isFullScreen.value = false;
                logger.log('전체 화면 종료 성공');
            })
            .catch(err => {
                logger.error('전체 화면 종료 실패:', err);
                logger.notify('전체 화면 종료에 실패했습니다.', 'error');
            });
    }
};

// ✨ 전체 화면 상태 변화 감지
const handleFullscreenChange = () => {
    isFullScreen.value = !!document.fullscreenElement;
    logger.log('전체 화면 상태 변경 감지:', isFullScreen.value);
};


onMounted(() => {
    // ✨ 전체 화면 지원 여부 확인
    isFullScreenSupported.value = document.fullscreenEnabled;
    if (isFullScreenSupported.value) {
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        // .env 설정에 따라 로비 진입 시 전체 화면 전환 시도
        if (import.meta.env.VITE_FULLSCREEN_MODE === 'true') {
            // 사용자 제스처 없이 requestFullscreen 호출은 대부분 실패하므로,
            // 별도의 버튼 클릭 등 사용자 상호작용 후에 호출하는 것이 좋습니다.
            // 여기서는 일단 마운트 시도 (경고가 뜰 수 있음)
            logger.warn('자동 전체 화면 전환은 브라우저 정책에 의해 차단될 수 있습니다. 버튼 클릭을 권장합니다.');
            // toggleFullScreen(); // 이 부분은 사용자 상호작용 없이 호출될 경우 차단될 가능성이 높습니다.
        }
    }


    const unwatchIsConnected = watch(isSocketConnected, (newValue) => {
        logger.log('[Lobby] isSocketConnected watch 발동, newValue:', newValue);
        if (newValue === true) {
            logger.log('[Lobby] isSocketConnected가 true로 변경됨, 방 목록 및 칩 요청.');
            requestRoomsAndChips();
            socketStatusMessage.value = 'Socket.IO 서버에 연결되었습니다.';
        } else {
            logger.warn('[Lobby] isSocketConnected가 false로 변경됨. Socket.IO 플러그인에서 리다이렉션 처리 예정.');
            rooms.value = [];
            socketStatusMessage.value = 'Socket.IO 서버에 연결 중입니다...';
        }
    }, { immediate: true });

    socket.on('roomsUpdated', handleRoomsUpdated);

    onUnmounted(() => {
        if (isFullScreenSupported.value) {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        }
        unwatchIsConnected();
        socket.off('roomsUpdated', handleRoomsUpdated);
        socket.off('connect');
        socket.off('disconnect');
        socket.off('connect_error');
        socket.off('reconnect_attempt');
        socket.off('reconnect');
        socket.off('reconnect_failed');
    });
});

watch(rooms, (newRooms) => {
  logger.log('[Lobby] Rooms ref detected change. Current rooms:', newRooms);
}, { deep: true, immediate: true });
</script>

<style scoped>
.lobby-page-wrapper {
  max-width: 900px;
  margin: 20px auto;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  background-color: #f8f9fa;
}

.text-center { text-align: center; }
.mb-4 { margin-bottom: 1.5rem; }
.mb-3 { margin-bottom: 1rem; }
.ml-1 { margin-left: 0.25rem; }
.ml-2 { margin-left: 0.5rem; }
.d-flex { display: flex; }
.justify-content-center { justify-content: center; }

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
.btn-secondary { background-color: #6c757d; color: white; }
.btn-secondary:hover { background-color: #5a6268; }
.btn-info { background-color: #17a2b8; color: white; }
.btn-info:hover { background-color: #117a8b; }
.btn-warning { background-color: #ffc107; color: #343a40; }
.btn-warning:hover { background-color: #e0a800; }


.alert {
  padding: 1rem;
  margin-top: 1rem;
  border-radius: 0.25rem;
}
.alert-info {
  color: #0c5460;
  background-color: #d1ecf1;
  border-color: #bee5eb;
}

.room-list {
    list-style: none;
    padding: 0;
}
.room-list .list-group-item {
    background-color: white;
    border: 1px solid #e0e0e0;
    border-radius: 0.3rem;
    padding: 0.75rem 1rem;
    margin-bottom: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
}
.room-list .list-group-item .badge {
    font-size: 0.7em;
    vertical-align: middle;
    margin-top: -3px;
}
.room-list .list-group-item .btn {
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
}

/* Modal styles */
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
    width: 400px;
    text-align: left;
}

.modal-content h4 {
    margin-bottom: 20px;
    color: #343a40;
    font-size: 1.5rem;
    text-align: center;
}

.form-group {
    margin-bottom: 15px;
}

.form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
    color: #555;
}

.form-control {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    box-sizing: border-box;
}

.mt-3 {
    margin-top: 1rem;
}

.justify-content-end {
    justify-content: flex-end;
}
</style>