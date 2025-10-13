<template>
  <div class="lobby-page container">
    <h1 class="text-center mb-4">로비</h1>
    <p class="text-center">환영합니다, {{ userName }}님! 현재 보유 칩: {{ userChips }}</p>

    <div class="d-flex justify-content-center mb-4">
        <button @click="createRoom" class="btn btn-success">새 방 만들기</button>
        <button @click="logout" class="btn btn-danger ml-2">로그아웃</button>
        <!-- ✨ 전체 화면 버튼 추가 -->
        <button v-if="!isFullScreenSupported" class="btn btn-secondary ml-2" disabled>전체 화면 (지원 안됨)</button>
        <button v-else @click="toggleFullScreen" :class="['btn', 'ml-2', isFullScreen ? 'btn-warning' : 'btn-info']">
            {{ isFullScreen ? '전체 화면 종료' : '전체 화면 전환' }}
        </button>
    </div>

    <h3 class="mb-3">개설된 게임 방</h3>
    <div v-if="!isSocketConnected" class="alert alert-warning text-center">
        Socket.IO 서버에 연결 중입니다... 잠시만 기다려주세요.
        <br>
        <small>({{ socketStatusMessage }})</small>
    </div>
    <div v-else-if="rooms.length === 0" class="alert alert-info text-center">
        현재 개설된 방이 없습니다. 새 방을 만들어보세요!
    </div>
    <ul v-else class="list-group">
        <li v-for="room in rooms" :key="room.id" class="list-group-item d-flex justify-content-between align-items-center">
            <div class="room-info">
                <h5>{{ room.name }} <span v-if="room.isPrivate" class="badge badge-secondary ml-1">비밀방</span></h5>
                <p>인원: {{ room.players }}/{{ room.maxPlayers }} | 베팅: {{ room.betAmount }} 칩</p>
                <span :class="['badge', room.status === 'waiting' ? 'badge-primary' : (room.status === 'playing' ? 'badge-secondary' : room.status)]">
                    {{ room.status === 'waiting' ? '대기 중' : (room.status === 'playing' ? '게임 중' : room.status) }}
                </span>
            </div>
            <!-- --- START MODIFICATION (handleJoinRoom 호출) --- -->
            <button @click="handleJoinRoom(room)" :disabled="room.status !== 'waiting' || room.players >= room.maxPlayers" class="btn btn-primary">입장</button>
            <!-- --- END MODIFICATION --- -->
        </li>
    </ul>

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
            <button @click="submitCreateRoom" class="btn btn-success">생성</button>
            <button @click="cancelCreateRoom" class="btn btn-secondary ml-2">취소</button>
        </div>
    </div>

    <!-- --- START MODIFICATION (비밀방 입장용 비밀번호 입력 모달) --- -->
    <div v-if="showPasswordModal" class="modal-overlay">
        <div class="modal-content">
            <h4>비밀방 입장</h4>
            <p>"{{ selectedRoomName }}" 방에 입장하려면 비밀번호를 입력하세요.</p>
            <div class="form-group">
                <label for="joinPassword">비밀번호:</label>
                <input type="password" id="joinPassword" v-model="joinPasswordInput" class="form-control" @keyup.enter="confirmJoinRoom">
            </div>
            <button @click="confirmJoinRoom" class="btn btn-primary">입장</button>
            <button @click="cancelPasswordModal" class="btn btn-secondary ml-2">취소</button>
        </div>
    </div>
    <!-- --- END MODIFICATION --- -->

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

// --- START MODIFICATION (비밀방 입장 관련 상태 추가) ---
const showPasswordModal = ref(false);
const selectedRoomId = ref(null);
const selectedRoomName = ref('');
const joinPasswordInput = ref('');

const isFullScreen = ref(false); // ✨ 전체 화면 상태 추적
// --- END MODIFICATION ---

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

// --- START MODIFICATION (handleJoinRoom 함수 추가) ---
const handleJoinRoom = (room) => {
    if (room.isPrivate) {
        // 비밀방인 경우 비밀번호 입력 모달 띄우기
        selectedRoomId.value = room.id;
        selectedRoomName.value = room.name;
        joinPasswordInput.value = ''; // 비밀번호 입력 필드 초기화
        showPasswordModal.value = true;
    } else {
        // 일반 방인 경우 바로 입장 시도
        joinRoom(room.id, null); // 비밀번호 없이 입장
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
// --- END MODIFICATION ---


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

onMounted(() => {
    const unwatchIsConnected = watch(isSocketConnected, (newValue) => {
        logger.log('[Lobby] isSocketConnected watch 발동, newValue:', newValue);
        if (newValue === true) {
            logger.log('[Lobby] isSocketConnected가 true로 변경됨, 방 목록 및 칩 요청.');
            requestRoomsAndChips();
            socketStatusMessage.value = 'Socket.IO 서버에 연결되었습니다.';
        } else {
            logger.warn('[Lobby] isSocketConnected가 false로 변경됨. Socket.IO 플러그인에서 리다이렉션 처리 예정.');
            rooms.value = []; // 방 목록 초기화 (UI 비우기)
            socketStatusMessage.value = 'Socket.IO 서버에 연결 중입니다...';
        }
    }, { immediate: true });

    socket.on('roomsUpdated', handleRoomsUpdated);

    onUnmounted(() => {
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
.lobby-page {
  max-width: 900px;
  margin: 50px auto;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  background-color: #f8f9fa;
}
.text-center { text-align: center; }
.mb-4 { margin-bottom: 1.5rem; }
.mb-3 { margin-bottom: 1rem; }
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


.list-group {
  list-style: none;
  padding: 0;
}
.list-group-item {
  background-color: white;
  border: 1px solid #e0e0e0;
  border-radius: 0.3rem;
  padding: 1rem 1.5rem;
  margin-bottom: 10px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.03);
}
.room-info h5 {
  margin-bottom: 0.25rem;
  font-size: 1.25rem;
  color: #343a40;
}
.room-info p {
  margin-bottom: 0.5rem;
  color: #6c757d;
}
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
    text-align: center;
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
</style>