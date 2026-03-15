<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const isFilmStrip = computed(() => route.path === '/filmstrip')
</script>

<template>
  <div class="app">
    <!-- 头部导航 -->
    <header class="app-header">
      <div class="header-content">
        <h1 class="app-title">
          <span class="title-icon">{{ isFilmStrip ? '🎞️' : '🎵' }}</span>
          <span>{{ isFilmStrip ? '复古胶片放映' : '踩点动画生成器' }}</span>
        </h1>
        <p class="app-desc">
          {{ isFilmStrip
            ? '经典胶片滚动效果，重温复古放映的魅力'
            : '上传音乐和图片，自动生成随节拍跳动的酷炫动画'
          }}
        </p>
      </div>

      <!-- 路由导航 -->
      <nav class="app-nav">
        <router-link to="/" class="nav-link" :class="{ active: !isFilmStrip }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          踩点动画
        </router-link>
        <router-link to="/filmstrip" class="nav-link" :class="{ active: isFilmStrip }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
            <line x1="7" y1="2" x2="7" y2="22" />
            <line x1="17" y1="2" x2="17" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="2" y1="7" x2="7" y2="7" />
            <line x1="2" y1="17" x2="7" y2="17" />
            <line x1="17" y1="7" x2="22" y2="7" />
            <line x1="17" y1="17" x2="22" y2="17" />
          </svg>
          胶片放映
        </router-link>
      </nav>
    </header>

    <router-view />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  text-align: center;
  padding: 32px 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.header-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.app-title {
  font-size: 36px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.95);
}

.title-icon {
  font-size: 40px;
}

.app-desc {
  margin: 10px 0 0;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.45);
}

/* 导航 */
.app-nav {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  text-decoration: none;
  transition: all 0.25s;
  cursor: pointer;
}

.nav-link:hover {
  color: rgba(255, 255, 255, 0.65);
  background: rgba(255, 255, 255, 0.04);
}

.nav-link.active {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(100, 108, 255, 0.15);
  box-shadow: 0 1px 4px rgba(100, 108, 255, 0.1);
}

/* 响应式 */
@media (max-width: 1024px) {
  .app-title {
    font-size: 28px;
  }
}

@media (max-width: 600px) {
  .app-header {
    padding: 20px 16px 12px;
  }

  .app-title {
    font-size: 22px;
  }

  .title-icon {
    font-size: 28px;
  }

  .app-desc {
    font-size: 14px;
  }

  .nav-link {
    padding: 6px 12px;
    font-size: 13px;
  }
}
</style>
