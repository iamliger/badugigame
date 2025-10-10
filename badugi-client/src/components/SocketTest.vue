<!-- badugi-client/src/components/SocketTest.vue -->
<template>
  <div>
    <h2>Socket.IO 테스트</h2>
    <p v-if="isConnected">서버 연결됨! Socket ID: {{ socketId }}</p>
    <p v-else>서버 연결 대기 중...</p>
    <button @click="connect" :disabled="isConnected">연결</button>
    <button @click="disconnect" :disabled="!isConnected">연결 해제</button>

    <br><br>
    <input v-model="message" @keyup.enter="sendMessage" placeholder="메시지 입력">
    <button @click="sendMessage">메시지 전송</button>

    <h3>수신 메시지:</h3>
    <ul>
      <li v-for="(msg, index) in receivedMessages" :key="index">{{ msg }}</li>
    </ul>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, inject } from 'vue';

const socket = inject('socket'); // 전역적으로 제공된 socket 인스턴스 주입

const isConnected = ref(false);
const socketId = ref('');
const message = ref('');
const receivedMessages = ref([]);

const connect = () => {
  if (!socket.connected) {
    socket.connect();
  }
};

const disconnect = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};

const sendMessage = () => {
  if (message.value && socket.connected) {
    socket.emit('message', message.value); // 'message' 이벤트와 함께 데이터 전송
    message.value = '';
  }
};

onMounted(() => {
  // 컴포넌트 마운트 시 소켓 연결 상태를 초기화
  isConnected.value = socket.connected;
  if (socket.connected) {
    socketId.value = socket.id;
  }

  // 소켓 이벤트 리스너 등록
  socket.on('connect', () => {
    isConnected.value = true;
    socketId.value = socket.id;
    console.log('SocketTest 컴포넌트: 연결됨');
  });

  socket.on('disconnect', () => {
    isConnected.value = false;
    socketId.value = '';
    console.log('SocketTest 컴포넌트: 연결 해제됨');
  });

  socket.on('message', (data) => {
    receivedMessages.value.push(data);
    console.log('SocketTest 컴포넌트: 메시지 수신', data);
  });

  // 자동 연결 (선택 사항)
  // socket.connect();
});

onUnmounted(() => {
  // 컴포넌트 언마운트 시 소켓 이벤트 리스너 제거 (메모리 누수 방지)
  socket.off('connect');
  socket.off('disconnect');
  socket.off('message');
});
</script>

<style scoped>
button { margin-right: 10px; padding: 8px 15px; cursor: pointer; }
input { padding: 8px; width: 300px; margin-right: 10px; }
ul { list-style-type: none; padding: 0; }
li { background: #f0f0f0; margin-bottom: 5px; padding: 8px; border-radius: 4px; }
</style>