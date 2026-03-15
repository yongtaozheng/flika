<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import type { Beat, AnimationEffect, UploadedImage, AnimationConfig } from '../types'
import { useAnimationEngine } from '../composables/useAnimationEngine'

const props = defineProps<{
  images: UploadedImage[]
  beats: Beat[]
  currentTime: number
  isPlaying: boolean
  config: AnimationConfig
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

// 响应式包装 - 使用 computed 确保跟踪 props 变化
const imagesRef = computed(() => props.images)
const beatsRef = computed(() => props.beats)
const currentTimeRef = computed(() => props.currentTime)

const { renderFrame, preloadImages, reset } = useAnimationEngine(
  canvasRef,
  imagesRef as any,
  beatsRef as any,
  currentTimeRef,
)

let animationId: number | null = null

// 获取启用的效果类型列表
const enabledEffects = computed<AnimationEffect[]>(() =>
  props.config.effects.filter((e) => e.enabled).map((e) => e.type)
)

// 监听图片变化，预加载
watch(
  () => props.images,
  async () => {
    await preloadImages()
    renderOnce()
  },
  { deep: true }
)

// 监听播放状态
watch(
  () => props.isPlaying,
  (playing) => {
    if (playing) {
      startRenderLoop()
    } else {
      stopRenderLoop()
      renderOnce()
    }
  }
)

// 非播放时跟随 currentTime 渲染
watch(
  () => props.currentTime,
  () => {
    if (!props.isPlaying) {
      renderOnce()
    }
  }
)

// 监听配置变化
watch(
  () => props.config,
  () => {
    if (!props.isPlaying) renderOnce()
  },
  { deep: true }
)

function renderOnce() {
  renderFrame(
    enabledEffects.value,
    props.config.effectDuration,
    props.config.backgroundColor
  )
}

function startRenderLoop() {
  function loop() {
    renderFrame(
      enabledEffects.value,
      props.config.effectDuration,
      props.config.backgroundColor
    )
    animationId = requestAnimationFrame(loop)
  }
  loop()
}

function stopRenderLoop() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
}

// 时间线可视化数据
const timelineBeats = computed(() => {
  if (!props.beats.length) return []
  const duration = props.beats[props.beats.length - 1]?.time || 1
  return props.beats.map((b) => ({
    left: `${(b.time / (duration + 1)) * 100}%`,
    height: `${30 + b.strength * 70}%`,
    opacity: 0.3 + b.strength * 0.7,
  }))
})

onMounted(async () => {
  if (canvasRef.value) {
    canvasRef.value.width = props.config.width
    canvasRef.value.height = props.config.height
  }
  await preloadImages()
  renderOnce()
})

onUnmounted(() => {
  stopRenderLoop()
})

// 暴露 canvas ref 给父组件（用于导出）
defineExpose({ canvasRef, reset })
</script>

<template>
  <div class="animation-preview" ref="containerRef">
    <div class="canvas-wrapper">
      <canvas
        ref="canvasRef"
        :width="config.width"
        :height="config.height"
        class="preview-canvas"
      />

      <!-- 播放状态指示 -->
      <div v-if="!isPlaying && images.length > 0" class="play-overlay">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </div>
    </div>

    <!-- 节拍时间线 -->
    <div class="beat-timeline" v-if="beats.length > 0">
      <div class="timeline-track">
        <div
          v-for="(beat, i) in timelineBeats"
          :key="i"
          class="beat-marker"
          :style="{
            left: beat.left,
            height: beat.height,
            opacity: beat.opacity,
          }"
        />
        <!-- 播放指针 -->
        <div
          class="playhead"
          :style="{
            left: `${(currentTime / (beats[beats.length - 1]?.time + 1 || 1)) * 100}%`,
          }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.animation-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.canvas-wrapper {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: #000;
  aspect-ratio: 16/9;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.preview-canvas {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.6);
  pointer-events: none;
  transition: opacity 0.3s;
}

.beat-timeline {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px 12px;
  height: 48px;
}

.timeline-track {
  position: relative;
  width: 100%;
  height: 100%;
}

.beat-marker {
  position: absolute;
  bottom: 0;
  width: 3px;
  background: #646cff;
  border-radius: 2px;
  transform: translateX(-50%);
  transition: none;
}

.playhead {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: #ff6b6b;
  border-radius: 1px;
  transform: translateX(-50%);
  box-shadow: 0 0 8px rgba(255, 107, 107, 0.5);
  z-index: 2;
}
</style>
