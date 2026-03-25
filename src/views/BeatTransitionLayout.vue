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
  { label: '径向光束', path: '/transition/beam', icon: 'beam' },
  { label: '粒子重组', path: '/transition/particle', icon: 'particle' },
  { label: '万花筒棱镜', path: '/transition/kaleidoscope', icon: 'kaleidoscope' },
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
        <!-- 径向光束 icon -->
        <svg v-else-if="tab.icon === 'beam'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" /><line x1="12" y1="1" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" /><line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" /><line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
        </svg>
        <!-- 粒子重组 icon -->
        <svg v-else-if="tab.icon === 'particle'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="2" /><circle cx="5" cy="5" r="1.5" /><circle cx="19" cy="5" r="1.5" />
          <circle cx="5" cy="19" r="1.5" /><circle cx="19" cy="19" r="1.5" />
          <line x1="7" y1="7" x2="10" y2="10" opacity="0.5" /><line x1="17" y1="7" x2="14" y2="10" opacity="0.5" />
          <line x1="7" y1="17" x2="10" y2="14" opacity="0.5" /><line x1="17" y1="17" x2="14" y2="14" opacity="0.5" />
        </svg>
        <!-- 万花筒棱镜 icon -->
        <svg v-else-if="tab.icon === 'kaleidoscope'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
          <line x1="12" y1="2" x2="12" y2="22" opacity="0.5" />
          <line x1="22" y1="8.5" x2="2" y2="15.5" opacity="0.5" />
          <line x1="2" y1="8.5" x2="22" y2="15.5" opacity="0.5" />
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
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.sub-tab {
  display: inline-flex;
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
  overflow: hidden;
}
</style>
