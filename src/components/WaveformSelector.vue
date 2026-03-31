<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { WaveformData } from '../composables/useWaveform'

const props = defineProps<{
  waveformData: WaveformData | null
  currentTime: number
  duration: number
  segmentStart: number
  segmentEnd: number
}>()

const emit = defineEmits<{
  'update:segmentStart': [time: number]
  'update:segmentEnd': [time: number]
  'seek': [time: number]
}>()

const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// ── 百分比计算 ──
const startPct = computed(() =>
  props.duration > 0 ? (props.segmentStart / props.duration) * 100 : 0
)
const endPct = computed(() =>
  props.duration > 0 ? (props.segmentEnd / props.duration) * 100 : 100
)
const playheadPct = computed(() =>
  props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0
)

// ── 时间格式化 ──
function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

// ── Canvas 渲染 ──
function drawWaveform() {
  const canvas = canvasRef.value
  const data = props.waveformData
  if (!canvas || !data) return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height

  canvas.width = w * dpr
  canvas.height = h * dpr

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const peaks = data.peaks
  const barCount = peaks.length
  const barWidth = w / barCount
  const gap = Math.max(0.5, barWidth * 0.15)
  const effectiveBarW = barWidth - gap

  // 选区百分比范围
  const startFrac = props.duration > 0 ? props.segmentStart / props.duration : 0
  const endFrac = props.duration > 0 ? props.segmentEnd / props.duration : 1

  for (let i = 0; i < barCount; i++) {
    const frac = i / barCount
    const peak = peaks[i]
    const barH = Math.max(2, peak * (h - 4))
    const x = i * barWidth + gap / 2
    const y = (h - barH) / 2

    const inSelection = frac >= startFrac && frac <= endFrac

    if (inSelection) {
      // 选中区域：accent 渐变
      const grad = ctx.createLinearGradient(x, y + barH, x, y)
      grad.addColorStop(0, 'rgba(112, 96, 255, 0.85)')   // --accent
      grad.addColorStop(1, 'rgba(140, 130, 255, 0.95)')   // --accent-light
      ctx.fillStyle = grad
    } else {
      // 未选中区域：暗淡
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
    }

    ctx.beginPath()
    ctx.roundRect(x, y, effectiveBarW, barH, 1)
    ctx.fill()
  }
}

// 监听数据变化重绘
watch(
  () => [props.waveformData, props.segmentStart, props.segmentEnd],
  () => nextTick(drawWaveform),
  { deep: true }
)

// ── ResizeObserver ──
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(drawWaveform)
  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(() => drawWaveform())
    resizeObserver.observe(canvasRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

// ── 拖拽逻辑 ──
let dragType: 'start' | 'end' | null = null

function handleMouseDown(type: 'start' | 'end', e: MouseEvent) {
  dragType = type
  e.preventDefault()
  e.stopPropagation()
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(e: MouseEvent) {
  if (!containerRef.value || !dragType) return
  const rect = containerRef.value.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const time = +(pct * props.duration).toFixed(2)

  const minGap = 0.5 // 最小 0.5 秒间距

  if (dragType === 'start') {
    const clamped = Math.min(time, props.segmentEnd - minGap)
    emit('update:segmentStart', Math.max(0, clamped))
  } else {
    const clamped = Math.max(time, props.segmentStart + minGap)
    emit('update:segmentEnd', Math.min(props.duration, clamped))
  }
}

function handleMouseUp() {
  dragType = null
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
}

// ── 点击波形跳转 ──
function handleContainerClick(e: MouseEvent) {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  emit('seek', +(pct * props.duration).toFixed(2))
}
</script>

<template>
  <div
    class="waveform-selector"
    ref="containerRef"
    @click="handleContainerClick"
  >
    <!-- 波形 Canvas -->
    <canvas ref="canvasRef" class="waveform-canvas" />

    <!-- 未选中遮罩：左侧 -->
    <div class="overlay-dim" :style="{ left: '0', width: `${startPct}%` }" />
    <!-- 未选中遮罩：右侧 -->
    <div class="overlay-dim" :style="{ left: `${endPct}%`, width: `${100 - endPct}%` }" />

    <!-- 选区高亮 -->
    <div
      class="selection-region"
      :style="{ left: `${startPct}%`, width: `${endPct - startPct}%` }"
    />

    <!-- 左手柄 -->
    <div
      class="handle handle-start"
      :style="{ left: `${startPct}%` }"
      @mousedown.stop="handleMouseDown('start', $event)"
    >
      <div class="handle-bar" />
      <div class="handle-knob" />
      <span class="handle-time">{{ formatTime(segmentStart) }}</span>
    </div>

    <!-- 右手柄 -->
    <div
      class="handle handle-end"
      :style="{ left: `${endPct}%` }"
      @mousedown.stop="handleMouseDown('end', $event)"
    >
      <div class="handle-bar" />
      <div class="handle-knob" />
      <span class="handle-time">{{ formatTime(segmentEnd) }}</span>
    </div>

    <!-- 播放指针 -->
    <div class="wf-playhead" :style="{ left: `${playheadPct}%` }" />
  </div>
</template>

<style scoped>
.waveform-selector {
  position: relative;
  height: 80px;
  border-radius: var(--r-md);
  background: var(--surface-2);
  border: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  overflow: hidden;
}

.waveform-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* ── 遮罩 ── */
.overlay-dim {
  position: absolute;
  top: 0;
  height: 100%;
  background: rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 1;
}

/* ── 选区高亮 ── */
.selection-region {
  position: absolute;
  top: 0;
  height: 100%;
  background: rgba(112, 96, 255, 0.06);
  border-left: none;
  border-right: none;
  pointer-events: none;
  z-index: 1;
}

/* ── 手柄 ── */
.handle {
  position: absolute;
  top: 0;
  height: 100%;
  z-index: 3;
  cursor: ew-resize;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.handle-start { transform: translateX(-50%); }
.handle-end   { transform: translateX(-50%); }

.handle-bar {
  width: 3px;
  flex: 1;
  background: var(--accent);
  border-radius: 2px;
  opacity: 0.9;
  transition: opacity 0.15s;
}

.handle:hover .handle-bar { opacity: 1; }

.handle-knob {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--surface-2), 0 0 8px rgba(112, 96, 255, 0.4);
  transition: transform 0.12s, box-shadow 0.12s;
}

.handle:hover .handle-knob {
  transform: translateY(-50%) scale(1.15);
  box-shadow: 0 0 0 2px var(--surface-2), 0 0 12px rgba(112, 96, 255, 0.6);
}

.handle-time {
  position: absolute;
  bottom: -18px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

/* ── 播放指针 ── */
.wf-playhead {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: var(--pink);
  box-shadow: 0 0 6px var(--pink);
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 4;
  transition: left 0.05s linear;
}
</style>
