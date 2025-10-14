import { createRouter, createWebHistory } from 'vue-router'
import LobbyView from '../views/LobbyView.vue'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import GameRoomView from '../views/GameRoomView.vue'
import { logger } from '../utils/logger'; // logger 임포트

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      redirect: '/lobby' // 기본 경로를 로비로 리다이렉트
    },
    {
      path: '/lobby',
      name: 'lobby',
      component: LobbyView,
      meta: { requiresAuth: true } // 인증 필요
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { guestOnly: true } // 로그인 상태면 접근 불가
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView,
      meta: { guestOnly: true } // 로그인 상태면 접근 불가
    },
    {
      path: '/room/:id',
      name: 'room',
      component: GameRoomView,
      meta: { requiresAuth: true } // 인증 필요
    },
    // 모든 알 수 없는 경로를 로그인 페이지로 리다이렉트 (선택 사항)
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      redirect: '/login'
    }
  ]
})

// ✨ NEW: 전역 네비게이션 가드 추가
router.beforeEach((to, from, next) => {
  const isAuthenticated = localStorage.getItem('jwt_token'); // 토큰 존재 여부 확인

  if (to.matched.some(record => record.meta.requiresAuth)) {
    // 인증이 필요한 페이지인데 토큰이 없다면 로그인 페이지로 리다이렉트
    if (!isAuthenticated) {
      logger.warn(`[Router Guard] 인증되지 않은 접근: ${to.path}. 로그인 페이지로 리다이렉트.`, 'warn');
      next({ name: 'login' });
    } else {
      next(); // 인증된 사용자, 통과
    }
  } else if (to.matched.some(record => record.meta.guestOnly)) {
    // 로그인 상태에서만 접근 가능한 페이지 (예: 로그인, 회원가입)인데 토큰이 있다면 로비로 리다이렉트
    if (isAuthenticated) {
      logger.warn(`[Router Guard] 로그인 상태에서 게스트 전용 페이지 접근: ${to.path}. 로비 페이지로 리다이렉트.`, 'warn');
      next({ name: 'lobby' });
    } else {
      next(); // 로그인 상태가 아님, 통과
    }
  } else {
    next(); // 메타 정보가 없는 페이지, 통과
  }
});

export default router
