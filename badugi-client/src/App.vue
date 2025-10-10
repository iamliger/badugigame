<!-- badugi-client/src/App.vue -->
<script setup>
import { RouterLink, RouterView } from 'vue-router'
// --- START MODIFICATION ---
// import { inject } from 'vue'; // socket 주입을 위해 필요했지만, 이제 여기서 직접 사용하지 않으므로 제거
// --- END MODIFICATION ---
import TokenChecker from './components/common/TokenChecker.vue';

// --- START MODIFICATION ---
// const socket = inject('socket'); // 'socket' 경고를 제거하기 위해 이 라인을 삭제합니다.
// --- END MODIFICATION ---
</script>

<template>
  <!-- --- START MODIFICATION (단일 루트 요소로 묶기) --- -->
  <main>
    <header>
      <img alt="Vue logo" class="logo" src="@/assets/logo.svg" width="125" height="125" />

      <div class="wrapper">
        <nav>
          <RouterLink to="/">Home</RouterLink> |
          <RouterLink to="/about">About</RouterLink> |
          <RouterLink to="/login">Login</RouterLink> |
          <RouterLink to="/lobby">Lobby</RouterLink>
        </nav>
      </div>
    </header>

    <RouterView />

    <TokenChecker />
  </main>
  <!-- --- END MODIFICATION --- -->
</template>

<style scoped>
/* 기존 스타일 유지 */
header {
  line-height: 1.5;
  max-height: 100vh;
  display: flex; /* Flexbox를 사용하여 정렬 */
  justify-content: center; /* 수평 가운데 정렬 */
  align-items: center; /* 수직 가운데 정렬 */
  flex-direction: column; /* 세로 방향으로 아이템 정렬 */
  padding-bottom: 20px;
}

.logo {
  display: block;
  margin: 0 auto 2rem;
}

nav {
  width: 100%;
  font-size: 12px;
  text-align: center;
  margin-top: 2rem;
}

nav a.router-link-exact-active {
  color: var(--color-text);
}

nav a.router-link-exact-active:hover {
  background-color: transparent;
}

nav a {
  display: inline-block;
  padding: 0 1rem;
  border-left: 1px solid var(--color-border);
}

nav a:first-of-type {
  border: 0;
}

@media (min-width: 1024px) {
  header {
    display: flex;
    place-items: center;
    padding-right: calc(var(--section-gap) / 2);
  }

  .logo {
    margin: 0 2rem 0 0;
  }

  header .wrapper {
    display: flex;
    place-items: flex-start;
    flex-wrap: wrap;
  }

  nav {
    text-align: left;
    margin-left: -1rem;
    font-size: 1rem;

    padding: 1rem 0;
    margin-top: 1rem;
  }
}
</style>