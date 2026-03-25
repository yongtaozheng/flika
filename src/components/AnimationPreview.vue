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

/** CSS aspect-ratio computed from config dimensions */
const canvasAspectRatio = computed(() => `${props.config.width} / ${props.config.height}`)

const imagesRef = computed(() => props.images)
const beatsRef = computed(() => props.beats)
const currentTimeRef = computed(() => props.currentTime)

const { renderFrame, preloadImages, reset, exportVideo } = useAnimationEngine(
  canvasRef,
  imagesRef as any,
  beatsRef as any,
  currentTimeRef,
)

let animationId: number | null = null

const enabledEffects = computed<AnimationEffect[]>(() =>
  props.config.effects.filter((e) => e.enabled).map((e) => e.type)
)

watch(() => props.images, async () => { await preloadImages(); renderOnce() }, { deep: true })
watch(() => props.isPlaying, (playing) => {
  if (playing) startRenderLoop()
  else { stopRenderLoop(); renderOnce() }
})
watch(() => props.currentTime, () => { if (!props.isPlaying) renderOnce() })
watch(() => props.config, () => { if (!props.isPlaying) renderOnce() }, { deep: true })

function renderOnce() {
  renderFrame(enabledEffects.value, props.config.effectDuration, props.config.backgroundColor)
}

function startRenderLoop() {
  function loop() {
    renderFrame(enabledEffects.value, props.config.effectDuration, props.config.backgroundColor)
    animationId = requestAnimationFrame(loop)
  }
  loop()
}

function stopRenderLoop() {
  if (animationId !== null) { cancelAnimationFrame(animationId); animationId = null }
}

// Beat timeline data
const timelineBeats = computed(() => {
  if (!props.beats.length) return []
  const dur = props.beats[props.beats.length - 1]?.time || 1
  return props.beats.map((b) => ({
    left: `${(b.time / (dur + 1)) * 100}%`,
    height: `${20 + b.strength * 80}%`,
    opacity: 0.35 + b.strength * 0.65,
  }))
})

const playheadLeft = computed(() => {
  const total = (props.beats[props.beats.length - 1]?.time ?? 0) + 1
  return `${(props.currentTime / total) * 100}%`
})

onMounted(async () => {
  if (canvasRef.value) {
    canvasRef.value.width = props.config.width
    canvasRef.value.height = props.config.height
  }
  await preloadImages()
  renderOnce()
})

onUnmounted(() => stopRenderLoop())

defineExpose({ canvasRef, reset, exportVideo })
</script>

<template>
  <div class="preview-root">
    <!-- Canvas -->
    <div class="canvas-wrapper">
    <div class="canvas-shell" :style="{ aspectRatio: canvasAspectRatio }">
      <canvas
        ref="canvasRef"
        :width="config.width"
        :height="config.height"
        class="canvas"
      />
      <!-- Play hint overlay -->
      <Transition name="overlay-fade">
        <div v-if="!isPlaying && images.length > 0" class="play-hint">
          <div class="play-hint-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3"/>
            </svg>
          </div>
        </div>
      </Transition>
      <!-- Empty state -->
      <div v-if="images.length === 0" class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.25">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
        <span>上传图片后预览</span>
      </div>
    </div>
    </div>

    <!-- Beat timeline -->
    <div class="timeline" v-if="beats.length > 0">
      <div class="timeline-inner">
        <div
          v-for="(b, i) in timelineBeats"
          :key="i"
          class="beat-bar"
          :style="{ left: b.left, height: b.height, opacity: b.opacity }"
        />
        <div class="playhead" :style="{ left: playheadLeft }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Canvas wrapper (flex container for centering) ── */
.canvas-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Canvas shell ── */
.canvas-shell {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  background: var(--canvas-bg);
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 16px 48px rgba(0,0,0,0.3);
}

.canvas {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

/* ── Play hint ── */
.play-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.32);
  pointer-events: none;
}

.play-hint-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.7);
  border: 1px solid rgba(255,255,255,0.15);
}

/* ── Empty state ── */
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 13px;
  pointer-events: none;
}

/* ── Timeline ── */
.timeline {
  height: 44px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 6px 10px;
  overflow: hidden;
}

.timeline-inner {
  position: relative;
  width: 100%;
  height: 100%;
}

.beat-bar {
  position: absolute;
  bottom: 0;
  width: 2px;
  background: linear-gradient(to top, var(--accent), var(--accent-light));
  border-radius: 1px;
  transform: translateX(-50%);
}

.playhead {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--pink);
  border-radius: 1px;
  transform: translateX(-50%);
  box-shadow: 0 0 6px var(--pink);
  z-index: 2;
}

/* ── Transitions ── */
.overlay-fade-enter-active, .overlay-fade-leave-active { transition: opacity 0.25s; }
.overlay-fade-enter-from, .overlay-fade-leave-to { opacity: 0; }
</style>
