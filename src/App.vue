<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const isFilmStrip = computed(() => route.path === '/filmstrip')
const isMusicBall = computed(() => route.path === '/music-ball')
const isSplice = computed(() => route.path === '/splice')
const isIntro = computed(() => route.path === '/intro')
const isPoster = computed(() => route.path === '/poster')
const isDiffusion = computed(() => route.path === '/diffusion')
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="brand">
        <svg class="brand-mark" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="10" cy="10" r="3.5" fill="currentColor" opacity="0.3"/>
          <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
          <line x1="10" y1="1.5" x2="10" y2="3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="10" y1="16.5" x2="10" y2="18.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="1.5" y1="10" x2="3.5" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="16.5" y1="10" x2="18.5" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span class="brand-name">Flika</span>
      </div>

      <div class="divider" />

      <nav class="app-nav">
        <!-- 暂时隐藏：踩点动画 -->
        <router-link v-if="false" to="/beat" class="nav-item" :class="{ active: route.path === '/beat' }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          踩点动画
        </router-link>
        <router-link to="/filmstrip" class="nav-item" :class="{ active: isFilmStrip }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2"/>
            <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
          </svg>
          胶片放映
        </router-link>
        <!-- 暂时隐藏：音乐小球 -->
        <router-link v-if="false" to="/music-ball" class="nav-item" :class="{ active: isMusicBall }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="7" r="4"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/>
            <line x1="9" y1="10" x2="7" y2="15"/><line x1="15" y1="10" x2="17" y2="15"/>
          </svg>
          音乐小球
        </router-link>
        <!-- 暂时隐藏：涟漪拼接 -->
        <router-link v-if="false" to="/splice" class="nav-item" :class="{ active: isSplice }">
          <svg width="13" height="13" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="3.5">
            <circle cx="22" cy="22" r="5"/><circle cx="22" cy="22" r="13"/><circle cx="22" cy="22" r="21"/>
          </svg>
          涟漪拼接
        </router-link>
        <router-link to="/intro" class="nav-item" :class="{ active: isIntro }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <path d="M8 6V4M16 6V4M8 18v2M16 18v2"/>
            <circle cx="12" cy="12" r="2.5" fill="currentColor" opacity="0.7"/>
          </svg>
          视频开场
        </router-link>
        <router-link to="/poster" class="nav-item" :class="{ active: isPoster }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
          封面海报
        </router-link>
        <router-link to="/diffusion" class="nav-item" :class="{ active: isDiffusion }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" opacity="0.3"/><circle cx="12" cy="12" r="6" opacity="0.5"/><circle cx="12" cy="12" r="2"/>
          </svg>
          扩散着色
        </router-link>
      </nav>
    </header>

    <div class="app-body">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.app-header {
  flex-shrink: 0;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.brand-mark { color: var(--accent); }

.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: linear-gradient(135deg, #a898ff 0%, #c0b0ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  flex-shrink: 0;
}

.app-nav {
  display: flex;
  gap: 2px;
}

.nav-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: var(--r-sm);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-3);
  transition: color 0.15s, background 0.15s;
}

.nav-item:hover {
  color: var(--text-2);
  background: rgba(255,255,255,0.05);
}

.nav-item.active {
  color: #a898ff;
  background: var(--accent-dim);
}

.app-body {
  flex: 1;
  overflow: hidden;
}
</style>
