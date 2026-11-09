<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const tabs = [
  { label: '扩散着色', path: '/transition/diffusion', icon: 'diffusion' },
  { label: '踩点动画', path: '/transition/beat', icon: 'beat' },
  { label: '涟漪拼接', path: '/transition/splice', icon: 'ripple' },
  { label: '墨水渲染', path: '/transition/ink', icon: 'ink' },
  { label: '碎片拼贴', path: '/transition/collage', icon: 'collage' },
  { label: '像素瀑布', path: '/transition/waterfall', icon: 'waterfall' },
  { label: '粒子重组', path: '/transition/particle', icon: 'particle' },
  { label: '雨滴侵蚀', path: '/transition/raindrop', icon: 'raindrop' },
]

const activeTab = computed(() => route.path)
</script>

<template>
  <div class="beat-transition-layout">
    <nav class="sub-tabs">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="sub-tab"
        :class="{ active: activeTab === tab.path }"
      >
        <!-- 扩散着色 icon -->
        <svg v-if="tab.icon === 'diffusion'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" opacity="0.3"/><circle cx="12" cy="12" r="6" opacity="0.5"/><circle cx="12" cy="12" r="2"/>
        </svg>
        <!-- 踩点动画 icon -->
        <svg v-else-if="tab.icon === 'beat'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
        <!-- 涟漪拼接 icon -->
        <svg v-else-if="tab.icon === 'ripple'" width="13" height="13" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="3.5">
          <circle cx="22" cy="22" r="5"/><circle cx="22" cy="22" r="13"/><circle cx="22" cy="22" r="21"/>
        </svg>
        <!-- 墨水渲染 icon -->
        <svg v-else-if="tab.icon === 'ink'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>
        </svg>
        <!-- 碎片拼贴 icon -->
        <svg v-else-if="tab.icon === 'collage'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="8" height="8" rx="1" /><rect x="14" y="2" width="8" height="8" rx="1" />
          <rect x="2" y="14" width="8" height="8" rx="1" /><rect x="14" y="14" width="8" height="8" rx="1" />
        </svg>
        <!-- 像素瀑布 icon -->
        <svg v-else-if="tab.icon === 'waterfall'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="2" width="4" height="4" rx="0.5" /><rect x="10" y="2" width="4" height="4" rx="0.5" /><rect x="17" y="2" width="4" height="4" rx="0.5" />
          <path d="M5 9v6M12 8v8M19 10v5" />
          <circle cx="5" cy="18" r="1.5" fill="currentColor" opacity="0.5" /><circle cx="12" cy="19" r="1.5" fill="currentColor" opacity="0.5" /><circle cx="19" cy="18" r="1.5" fill="currentColor" opacity="0.5" />
        </svg>
        <!-- 粒子重组 icon -->
        <svg v-else-if="tab.icon === 'particle'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="2" /><circle cx="5" cy="5" r="1.5" /><circle cx="19" cy="5" r="1.5" />
          <circle cx="5" cy="19" r="1.5" /><circle cx="19" cy="19" r="1.5" />
          <line x1="7" y1="7" x2="10" y2="10" opacity="0.5" /><line x1="17" y1="7" x2="14" y2="10" opacity="0.5" />
          <line x1="7" y1="17" x2="10" y2="14" opacity="0.5" /><line x1="17" y1="17" x2="14" y2="14" opacity="0.5" />
        </svg>
        <!-- 雨滴侵蚀 icon -->
        <svg v-else-if="tab.icon === 'raindrop'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
        </svg>
        {{ tab.label }}
      </router-link>
    </nav>

    <div class="sub-content">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.beat-transition-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.sub-tabs {
  flex-shrink: 0;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 20px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.sub-tabs::-webkit-scrollbar { display: none; }

.sub-tab {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 5px 14px;
  border-radius: var(--r-sm);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-3);
  transition: color 0.15s, background 0.15s;
  position: relative;
}

.sub-tab:hover {
  color: var(--text-2);
  background: var(--hover-bg);
}

.sub-tab.active {
  color: var(--text);
  background: var(--hover-bg-2);
}

.sub-tab.active::after {
  content: '';
  position: absolute;
  bottom: -7px;
  left: 14px;
  right: 14px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.sub-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 760px) {
  .beat-transition-layout {
    height: auto;
    min-height: 100%;
  }

  .sub-tabs {
    position: sticky;
    top: 0;
    z-index: 30;
    height: 44px;
    justify-content: flex-start;
    gap: 4px;
    padding: 0 12px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .sub-tabs::-webkit-scrollbar { display: none; }

  .sub-tab {
    flex: 0 0 auto;
    min-height: 34px;
    padding: 7px 12px;
    font-size: 12.5px;
  }

  .sub-tab.active::after {
    bottom: -5px;
    left: 12px;
    right: 12px;
  }

  .sub-content {
    flex: none;
    min-height: calc(100dvh - 136px);
    overflow: visible;
  }
}
</style>
