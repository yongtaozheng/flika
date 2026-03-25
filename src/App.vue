<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'
import { useTheme } from './composables/useTheme'

const route = useRoute()
const { isDark, toggleTheme } = useTheme()
const isTransition = computed(() => route.path.startsWith('/transition'))
const isFilmStrip = computed(() => route.path === '/filmstrip')
const isMusicBall = computed(() => route.path === '/music-ball')
const isIntro = computed(() => route.path === '/intro')
const isPoster = computed(() => route.path === '/poster')
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
        <router-link to="/transition" class="nav-item" :class="{ active: isTransition }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          踩点转场
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
      </nav>

      <div class="header-right">
        <button class="theme-toggle" @click="toggleTheme" :title="isDark ? '切换到浅色模式' : '切换到深色模式'">
          <svg v-if="isDark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
        <a
          href="https://github.com/yongtaozheng/flika"
          target="_blank"
          rel="noopener noreferrer"
          class="source-link"
          title="GitHub"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
        </a>
        <a
          href="https://gitee.com/zheng_yongtao/flika"
          target="_blank"
          rel="noopener noreferrer"
          class="source-link"
          title="Gitee"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H8.37a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h5.852z"/>
          </svg>
        </a>
        <a
          href="https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzAxNjIxMzM1Ng==&action=getalbum&album_id=3169344224111329280&scene=126&sessionid=1774326363287#wechat_redirect"
          target="_blank"
          rel="noopener noreferrer"
          class="source-link"
          title="微信公众号"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05a6.13 6.13 0 0 1-.253-1.744c0-3.61 3.228-6.544 7.229-6.544.2 0 .392.02.585.034C16.088 4.883 12.725 2.188 8.691 2.188zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm4.37 4.125c-3.47 0-6.28 2.556-6.28 5.713 0 3.156 2.81 5.711 6.28 5.711a7.33 7.33 0 0 0 2.14-.322.752.752 0 0 1 .613.083l1.43.838a.28.28 0 0 0 .142.047c.133 0 .245-.112.245-.25 0-.06-.023-.12-.038-.18l-.293-1.113a.506.506 0 0 1 .183-.568C22.927 19.064 24 17.27 24 15.83c0-3.158-2.81-5.714-6.28-5.714h.248zm-2.335 3.365a.95.95 0 0 1 .953.961.95.95 0 0 1-.953.962.95.95 0 0 1-.953-.962.95.95 0 0 1 .953-.961zm4.719 0a.95.95 0 0 1 .953.961.95.95 0 0 1-.953.962.95.95 0 0 1-.953-.962.95.95 0 0 1 .953-.961z"/>
          </svg>
        </a>
      </div>
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
  background: linear-gradient(135deg, var(--accent-light) 0%, var(--accent-hi) 100%);
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
  background: var(--hover-bg);
}

.nav-item.active {
  color: var(--accent-light);
  background: var(--accent-dim);
}

.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.source-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  color: var(--text-3);
  transition: color 0.15s, background 0.15s;
}

.source-link:hover {
  color: var(--text);
  background: var(--hover-bg-2);
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  color: var(--text-3);
  transition: color 0.15s, background 0.15s;
}
.theme-toggle:hover {
  color: var(--text);
  background: var(--hover-bg-2);
}

.app-body {
  flex: 1;
  overflow: hidden;
}
</style>
