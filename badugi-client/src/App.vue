<!-- badugi-client/src/App.vue -->
<script setup>
import { RouterView } from 'vue-router'
// import HelloWorld from './components/HelloWorld.vue' // 필요 없으면 제거
// import TheWelcome from './components/TheWelcome.vue' // 필요 없으면 제거
</script>

<template>
  <!-- 기존 <header> 또는 <nav> 태그가 있다면 제거하거나 조건부 렌더링 처리 -->
  <!-- 예를 들어, 로그인/회원가입 페이지에서는 헤더를 렌더링하지 않도록 합니다. -->
  <RouterView />
</template>

<style scoped>
/* App.vue의 전역 스타일도 확인하여 충돌하는 부분이 없는지 확인 */
</style>