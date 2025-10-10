import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('../views/AboutView.vue')
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { guest: true }
    },
    {
      path: '/lobby',
      name: 'lobby',
      component: () => import('../views/LobbyView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/room/:id',
      name: 'room',
      component: () => import('../views/GameRoomView.vue'),
      meta: { requiresAuth: true }
    }
    // --- START MODIFICATION ---
    // /register 라우트 제거 (경고 방지). 필요시 나중에 추가
    // {
    //   path: '/register',
    //   name: 'register',
    //   component: () => import('../views/RegisterView.vue'),
    //   meta: { guest: true }
    // }
    // --- END MODIFICATION ---
  ]
})

// 전역 네비게이션 가드 (인증 체크)
router.beforeEach((to, from, next) => {
  const isAuthenticated = localStorage.getItem('jwt_token'); // JWT 토큰 존재 여부로 인증 확인

  if (to.meta.requiresAuth && !isAuthenticated) {
    // 로그인 필요 라우트인데 토큰이 없으면 로그인 페이지로 리다이렉트
    next('/login');
  } else if (to.meta.guest && isAuthenticated) {
    // 로그인 페이지인데 이미 토큰이 있으면 로비로 리다이렉트
    next('/lobby');
  } else {
    next(); // 정상적으로 이동
  }
});

export default router
