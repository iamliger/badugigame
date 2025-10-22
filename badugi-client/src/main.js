// badugi-client/src/main.js
//import './assets/main.css'
import './assets/cards.css' // cards.css 임포트
import './assets/game-common.css' // ✨ NEW: 공용 게임 UI CSS 임포트
// import './assets/auth-forms.css' // ✨ NEW: 공통 인증 폼 CSS 임포트

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import socketPlugin from './plugins/socket' // socket.js 플러그인 임포트

// --- START MODIFICATION ---
// Socket.IO 클라이언트 디버그 모드 활성화
if (import.meta.env.VITE_SOCKET_IO_DEBUG === 'true') {
  localStorage.debug = 'socket.io-client:*'; // 모든 socket.io-client 로그 활성화
} else {
  localStorage.removeItem('debug'); // 디버그 비활성화
}
// --- END MODIFICATION ---

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(socketPlugin) // Socket.IO 플러그인 사용

app.mount('#app')
