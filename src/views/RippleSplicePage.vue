<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import type { SpliceItem, RippleConfig } from '../types'
import { useRippleTransition, type RippleCenter } from '../composables/useRippleTransition'
import {
  useTransitions,
  TRANSITIONS,
  type TransitionType,
  type DrawTransitionType,
} from '../composables/useTransitions'
import { saveVideoFile } from '../utils/filePicker'
import { canvasBg } from '../composables/useTheme'
import { v4 as uuidv4 } from 'uuid';

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const CW = 1280
const CH = 720

// ── Items & media elements ────────────────────────────────────────────────────
const items = ref<SpliceItem[]>([])
const mediaMap = new Map<string, HTMLImageElement | HTMLVideoElement>()

// ── Transition selection ──────────────────────────────────────────────────────
const selectedTransition = ref<TransitionType>('ripple')
const { fns: transitionFns } = useTransitions()

// ── Ripple config (only used when selectedTransition === 'ripple') ────────────
const rippleConfig = reactive<RippleConfig>({
  waveAmplitude: 20,
  waveCount: 3,
  waveWidth: 60,
  transitionDuration: 2200,
  step: 2,
})

// ── General transition duration (non-ripple) ──────────────────────────────────
const transitionDuration = ref(1200) // ms

function getTransitionDuration() {
  return selectedTransition.value === 'ripple'
    ? rippleConfig.transitionDuration
    : transitionDuration.value
}

// ── Default hold duration ─────────────────────────────────────────────────────
const defaultHold = ref(2000)

// ── Playback state ────────────────────────────────────────────────────────────
type PS = 'idle' | 'holding' | 'transitioning' | 'finished'
const playState = ref<PS>('idle')
const currentIndex = ref(0)
const isPlaying = ref(false)
const isExporting = ref(false)
const exportProgress = ref(0)

let rafId: number | null = null
let phaseStart = 0

// Ripple pixel data (pre-captured at transition start)
let rippleFromData: Uint8ClampedArray | null = null
let rippleToData: Uint8ClampedArray | null = null
let rippleCenter: RippleCenter | null = null

// Draw-based transition sources
let fromEl: CanvasImageSource | null = null
let toEl: CanvasImageSource | null = null

// ── Drag-sort ─────────────────────────────────────────────────────────────────
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const { renderRippleFrame, randomCenter, captureMediaData } = useRippleTransition()

// ── Canvas helpers ────────────────────────────────────────────────────────────
function getCtx() { return canvasRef.value?.getContext('2d') ?? null }

function drawCover(c: CanvasRenderingContext2D, el: HTMLImageElement | HTMLVideoElement) {
  c.fillStyle = canvasBg.value; c.fillRect(0, 0, CW, CH)
  const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
  const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
  if (!sw || !sh) return
  const scale = Math.max(CW / sw, CH / sh)
  c.drawImage(el, (CW - sw * scale) / 2, (CH - sh * scale) / 2, sw * scale, sh * scale)
}

function drawItem(index: number) {
  const c = getCtx(); if (!c) return
  const el = mediaMap.get(items.value[index].id); if (!el) return
  drawCover(c, el)
}

function captureItemData(index: number): Uint8ClampedArray {
  const el = mediaMap.get(items.value[index].id)
  if (!el) return new Uint8ClampedArray(CW * CH * 4)
  return captureMediaData(el, CW, CH)
}

// ── Start transition phase ────────────────────────────────────────────────────
function beginTransition(fromIdx: number, ts: number) {
  fromEl = mediaMap.get(items.value[fromIdx].id) || null
  toEl   = mediaMap.get(items.value[fromIdx + 1].id) || null
  if (selectedTransition.value === 'ripple') {
    rippleFromData = captureItemData(fromIdx)
    rippleToData   = captureItemData(fromIdx + 1)
    rippleCenter   = randomCenter(CW, CH)
  }
  phaseStart = ts
  playState.value = 'transitioning'
}

// ── rAF loop ──────────────────────────────────────────────────────────────────
function startLoop() {
  function loop(ts: number) {
    if (!isPlaying.value) return
    const c = getCtx(); if (!c) return
    const tDur = getTransitionDuration()

    if (playState.value === 'holding') {
      drawItem(currentIndex.value)
      if (ts - phaseStart >= items.value[currentIndex.value].holdDuration) {
        if (currentIndex.value < items.value.length - 1) {
          beginTransition(currentIndex.value, ts)
        } else {
          playState.value = 'finished'; isPlaying.value = false; return
        }
      }
    } else if (playState.value === 'transitioning') {
      const progress = Math.min((ts - phaseStart) / tDur, 1)
      if (selectedTransition.value === 'ripple') {
        if (rippleFromData && rippleToData && rippleCenter)
          renderRippleFrame(c, rippleFromData, rippleToData, progress, rippleCenter, rippleConfig)
      } else {
        if (fromEl && toEl)
          transitionFns[selectedTransition.value as DrawTransitionType](c, fromEl, toEl, progress)
      }
      if (progress >= 1) {
        currentIndex.value++; phaseStart = ts; playState.value = 'holding'
      }
    }
    rafId = requestAnimationFrame(loop)
  }
  phaseStart = performance.now()
  rafId = requestAnimationFrame(loop)
}

function stopLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
}

// ── Playback controls ─────────────────────────────────────────────────────────
function play() {
  if (items.value.length === 0) return
  currentIndex.value = 0; playState.value = 'holding'; isPlaying.value = true
  startLoop()
}

function stop() {
  stopLoop(); isPlaying.value = false; playState.value = 'idle'; currentIndex.value = 0
  if (items.value.length > 0) drawItem(0)
  else { const c = getCtx(); if (c) { c.fillStyle = canvasBg.value; c.fillRect(0, 0, CW, CH) } }
}

// ── File input ────────────────────────────────────────────────────────────────
function triggerFileInput() { fileInputRef.value?.click() }

function handleFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) { processFiles(Array.from(target.files)); target.value = '' }
}

function processFiles(files: File[]) {
  const valid = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
  if (!valid.length) { alert('请选择图片或视频文件'); return }

  const newItems: SpliceItem[] = valid.map((file) => ({
    id: uuidv4(), file, url: URL.createObjectURL(file),
    name: file.name, type: file.type.startsWith('video/') ? 'video' : 'image',
    holdDuration: defaultHold.value,
  }))

  for (const item of newItems) {
    if (item.type === 'image') {
      const img = new Image(); img.src = item.url
      mediaMap.set(item.id, img)
    } else {
      const video = document.createElement('video')
      video.src = item.url; video.preload = 'metadata'; video.muted = true; video.playsInline = true
      video.onloadedmetadata = () => {
        if (item.holdDuration === defaultHold.value)
          item.holdDuration = Math.max(500, Math.round(video.duration * 1000))
      }
      mediaMap.set(item.id, video)
    }
  }

  items.value = [...items.value, ...newItems]
  if (playState.value === 'idle' && items.value.length === newItems.length)
    setTimeout(() => drawItem(0), 120)
}

function removeItem(id: string) {
  if (isPlaying.value) return
  const item = items.value.find((i) => i.id === id)
  if (item) { URL.revokeObjectURL(item.url); mediaMap.delete(id) }
  items.value = items.value.filter((i) => i.id !== id)
  if (items.value.length > 0) drawItem(0)
  else { const c = getCtx(); if (c) { c.fillStyle = canvasBg.value; c.fillRect(0, 0, CW, CH) } }
}

// ── Drag sort ─────────────────────────────────────────────────────────────────
function onDragStart(i: number) { dragIndex.value = i }
function onDragOver(e: DragEvent, i: number) { e.preventDefault(); dragOverIndex.value = i }
function onDragDrop(i: number) {
  if (dragIndex.value === null || dragIndex.value === i) return
  const arr = [...items.value]; const [m] = arr.splice(dragIndex.value, 1)
  arr.splice(i, 0, m); items.value = arr
  dragIndex.value = null; dragOverIndex.value = null
}
function onDragEnd() { dragIndex.value = null; dragOverIndex.value = null }

// ── Export ────────────────────────────────────────────────────────────────────
async function handleExport() {
  if (items.value.length < 2) { alert('至少需要 2 个素材才能导出'); return }
  const canvas = canvasRef.value; if (!canvas) return

  // Pre-render items to pixel data (needed only for ripple)
  const prerendered = selectedTransition.value === 'ripple'
    ? items.value.map((_, i) => captureItemData(i))
    : []

  const tDur = getTransitionDuration()
  let totalDuration = 0
  for (let i = 0; i < items.value.length; i++) {
    totalDuration += items.value[i].holdDuration
    if (i < items.value.length - 1) totalDuration += tDur
  }

  isExporting.value = true; exportProgress.value = 0
  try {
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm'
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

    await new Promise<void>((resolve, reject) => {
      recorder.onerror = reject; recorder.onstop = () => resolve(); recorder.start()
      const FPS = 30, FRAME_MS = 1000 / FPS
      const c = canvas.getContext('2d')!
      let elapsed = 0, expIdx = 0
      let expPhase: 'holding' | 'transitioning' = 'holding'
      let phaseElapsed = 0
      let expFromData: Uint8ClampedArray | null = null
      let expToData: Uint8ClampedArray | null = null
      let expCenter: RippleCenter | null = null

      function renderExportFrame() {
        if (expPhase === 'holding') {
          const el = mediaMap.get(items.value[expIdx].id); if (el) drawCover(c, el)
          phaseElapsed += FRAME_MS; elapsed += FRAME_MS
          exportProgress.value = Math.min(1, elapsed / totalDuration)
          if (phaseElapsed >= items.value[expIdx].holdDuration) {
            if (expIdx < items.value.length - 1) {
              if (selectedTransition.value === 'ripple') {
                expFromData = prerendered[expIdx]; expToData = prerendered[expIdx + 1]
                expCenter = randomCenter(CW, CH)
              }
              phaseElapsed = 0; expPhase = 'transitioning'
            } else { recorder.stop(); return }
          }
        } else {
          const progress = Math.min(phaseElapsed / tDur, 1)
          if (selectedTransition.value === 'ripple') {
            if (expFromData && expToData && expCenter)
              renderRippleFrame(c, expFromData, expToData, progress, expCenter, rippleConfig)
          } else {
            const fEl = mediaMap.get(items.value[expIdx].id)!
            const tEl = mediaMap.get(items.value[expIdx + 1].id)!
            transitionFns[selectedTransition.value as DrawTransitionType](c, fEl, tEl, progress)
          }
          phaseElapsed += FRAME_MS; elapsed += FRAME_MS
          exportProgress.value = Math.min(1, elapsed / totalDuration)
          if (phaseElapsed >= tDur) { expIdx++; phaseElapsed = 0; expPhase = 'holding' }
        }
        setTimeout(renderExportFrame, FRAME_MS)
      }
      renderExportFrame()
    })

    const blob = new Blob(chunks, { type: 'video/webm' })
    await saveVideoFile(blob)
  } catch (e) {
    console.error('导出失败', e); alert('导出失败，请重试')
  } finally {
    isExporting.value = false; exportProgress.value = 0
  }
}

// ── Slider fill ───────────────────────────────────────────────────────────────
function sliderFill(value: number, min: number, max: number) {
  const pct = ((value - min) / (max - min)) * 100
  return { background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--surface-3) ${pct}%, var(--surface-3) 100%)` }
}

// ── Status ────────────────────────────────────────────────────────────────────
const selectedMeta = computed(() => TRANSITIONS.find((t) => t.type === selectedTransition.value))
const statusText = computed(() => {
  if (isExporting.value) return `导出中 ${Math.round(exportProgress.value * 100)}%`
  if (items.value.length === 0) return '添加图片或视频后开始'
  if (playState.value === 'idle') return `${items.value.length} 个素材 · ${selectedMeta.value?.label ?? ''} 转场`
  if (playState.value === 'holding') return `展示第 ${currentIndex.value + 1} / ${items.value.length}`
  if (playState.value === 'transitioning') return `${selectedMeta.value?.label ?? ''} 过渡中…`
  if (playState.value === 'finished') return '播放完毕'
  return ''
})

// Category color map
const catColor: Record<string, string> = {
  push: 'var(--text-3)',
  transform: '#a855f7',
  reveal: 'var(--teal)',
  distort: 'var(--accent)',
  light: 'var(--amber)',
}

onMounted(() => {
  if (canvasRef.value) {
    canvasRef.value.width = CW; canvasRef.value.height = CH
    const c = canvasRef.value.getContext('2d')!
    c.fillStyle = canvasBg.value; c.fillRect(0, 0, CW, CH)
  }
})

onUnmounted(() => { stopLoop(); for (const item of items.value) URL.revokeObjectURL(item.url) })
</script>

<template>
  <div class="splice-page">
    <input ref="fileInputRef" type="file" accept="image/*,video/*" multiple class="hidden" @change="handleFileInput" />

    <!-- ── Left: Canvas preview ── -->
    <div class="preview-col">
      <div class="canvas-shell">
        <canvas ref="canvasRef" :width="CW" :height="CH" class="canvas" />
        <div v-if="items.length === 0" class="empty-state">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25">
            <circle cx="22" cy="22" r="5"/><circle cx="22" cy="22" r="12"/><circle cx="22" cy="22" r="20"/>
          </svg>
          <span>添加图片或视频后预览</span>
        </div>
        <Transition name="overlay-fade">
          <div v-if="playState === 'finished'" class="finished-overlay">
            <span>播放完毕</span>
            <button class="finished-replay" @click="stop">重置</button>
          </div>
        </Transition>
      </div>

      <div class="status-bar">
        <span class="status-dot" :class="playState" />
        <span class="status-text">{{ statusText }}</span>
        <div v-if="isExporting" class="export-progress-wrap">
          <div class="export-progress-fill" :style="{ width: `${exportProgress * 100}%` }" />
        </div>
      </div>
    </div>

    <!-- ── Right: Sidebar ── -->
    <aside class="sidebar">

      <!-- Add media -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="3">
            <circle cx="22" cy="22" r="5"/><circle cx="22" cy="22" r="12"/><circle cx="22" cy="22" r="20"/>
          </svg>
          <span>视频拼接</span>
          <span v-if="items.length" class="block-badge">{{ items.length }}</span>
        </div>
        <button class="add-btn" @click="triggerFileInput">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          添加图片 / 视频
        </button>
      </div>

      <!-- Item list -->
      <div v-if="items.length" class="item-list">
        <div
          v-for="(item, idx) in items"
          :key="item.id"
          class="item-row"
          :class="{ sorting: dragIndex === idx, over: dragOverIndex === idx, active: isPlaying && currentIndex === idx }"
          draggable="true"
          @dragstart="onDragStart(idx)"
          @dragover="(e) => onDragOver(e, idx)"
          @drop.stop="onDragDrop(idx)"
          @dragend="onDragEnd"
        >
          <div class="item-drag">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.35">
              <circle cx="3" cy="2" r="1"/><circle cx="7" cy="2" r="1"/>
              <circle cx="3" cy="5" r="1"/><circle cx="7" cy="5" r="1"/>
              <circle cx="3" cy="8" r="1"/><circle cx="7" cy="8" r="1"/>
            </svg>
          </div>
          <div class="item-thumb">
            <img v-if="item.type === 'image'" :src="item.url" :alt="item.name" />
            <video v-else :src="item.url" preload="metadata" />
            <span class="item-type-badge">{{ item.type === 'video' ? '▶' : '' }}</span>
          </div>
          <div class="item-info">
            <span class="item-name">{{ item.name.length > 22 ? item.name.slice(0, 19) + '…' : item.name }}</span>
            <div class="item-hold-row">
              <span class="hold-label">展示</span>
              <input
                type="number" class="hold-input"
                :value="(item.holdDuration / 1000).toFixed(1)"
                min="0.5" max="60" step="0.5"
                @change="(e) => { item.holdDuration = Math.max(500, Math.round(parseFloat((e.target as HTMLInputElement).value) * 1000)) }"
              />
              <span class="hold-label">秒</span>
            </div>
          </div>
          <span class="item-index">{{ idx + 1 }}</span>
          <button class="item-del" :disabled="isPlaying" @click.stop="removeItem(item.id)" title="删除">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Playback controls -->
      <div class="sidebar-block controls-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>播放控制</span>
        </div>
        <div class="playback-btns">
          <button class="btn-play" :disabled="items.length === 0 || isExporting" @click="isPlaying ? stop() : play()">
            <svg v-if="!isPlaying" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            {{ isPlaying ? '停止' : '播放预览' }}
          </button>
          <button class="btn-export" :disabled="items.length < 2 || isExporting || isPlaying" @click="handleExport">
            <span v-if="isExporting" class="spinner" />
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {{ isExporting ? `${Math.round(exportProgress * 100)}%` : '导出视频' }}
          </button>
        </div>
      </div>

      <!-- Transition picker -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          <span>转场效果</span>
          <span class="block-badge" :style="{ background: `${catColor[selectedMeta?.cat ?? 'distort']}22`, color: catColor[selectedMeta?.cat ?? 'distort'] }">
            {{ selectedMeta?.label }}
          </span>
        </div>

        <div class="trans-grid">
          <button
            v-for="t in TRANSITIONS"
            :key="t.type"
            class="trans-btn"
            :class="{ active: selectedTransition === t.type }"
            :style="{ '--cat-color': catColor[t.cat] }"
            :title="t.desc"
            @click="selectedTransition = t.type"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <!-- Settings — general duration (non-ripple) -->
      <div v-if="selectedTransition !== 'ripple'" class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>过渡参数</span>
        </div>

        <div class="setting-row">
          <label>过渡时长</label>
          <div class="setting-ctl">
            <input type="range" min="300" max="3000" step="100" v-model.number="transitionDuration" :style="sliderFill(transitionDuration, 300, 3000)" />
            <span class="setting-val">{{ (transitionDuration / 1000).toFixed(1) }}s</span>
          </div>
        </div>

        <div class="setting-row">
          <label>默认展示</label>
          <div class="setting-ctl">
            <input type="range" min="500" max="10000" step="500" v-model.number="defaultHold" :style="sliderFill(defaultHold, 500, 10000)" />
            <span class="setting-val">{{ (defaultHold / 1000).toFixed(1) }}s</span>
          </div>
        </div>
      </div>

      <!-- Ripple-specific settings -->
      <div v-if="selectedTransition === 'ripple'" class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>涟漪参数</span>
        </div>

        <div class="setting-row">
          <label>过渡时长</label>
          <div class="setting-ctl">
            <input type="range" min="500" max="5000" step="100" v-model.number="rippleConfig.transitionDuration" :style="sliderFill(rippleConfig.transitionDuration, 500, 5000)" />
            <span class="setting-val">{{ (rippleConfig.transitionDuration / 1000).toFixed(1) }}s</span>
          </div>
        </div>
        <div class="setting-row">
          <label>波纹强度</label>
          <div class="setting-ctl">
            <input type="range" min="5" max="60" step="1" v-model.number="rippleConfig.waveAmplitude" :style="sliderFill(rippleConfig.waveAmplitude, 5, 60)" />
            <span class="setting-val">{{ rippleConfig.waveAmplitude }}</span>
          </div>
        </div>
        <div class="setting-row">
          <label>波纹数量</label>
          <div class="setting-ctl">
            <input type="range" min="1" max="6" step="1" v-model.number="rippleConfig.waveCount" :style="sliderFill(rippleConfig.waveCount, 1, 6)" />
            <span class="setting-val">{{ rippleConfig.waveCount }}</span>
          </div>
        </div>
        <div class="setting-row">
          <label>波纹宽度</label>
          <div class="setting-ctl">
            <input type="range" min="20" max="150" step="5" v-model.number="rippleConfig.waveWidth" :style="sliderFill(rippleConfig.waveWidth, 20, 150)" />
            <span class="setting-val">{{ rippleConfig.waveWidth }}</span>
          </div>
        </div>
        <div class="setting-row">
          <label>渲染精度</label>
          <div class="setting-ctl">
            <input type="range" min="1" max="4" step="1"
              :value="5 - rippleConfig.step"
              @input="(e) => { rippleConfig.step = 5 - parseInt((e.target as HTMLInputElement).value) }"
              :style="sliderFill(5 - rippleConfig.step, 1, 4)" />
            <span class="setting-val">{{ ['','粗糙','普通','精细','最高'][5 - rippleConfig.step] }}</span>
          </div>
        </div>
        <div class="setting-row">
          <label>默认展示</label>
          <div class="setting-ctl">
            <input type="range" min="500" max="10000" step="500" v-model.number="defaultHold" :style="sliderFill(defaultHold, 500, 10000)" />
            <span class="setting-val">{{ (defaultHold / 1000).toFixed(1) }}s</span>
          </div>
        </div>
      </div>

    </aside>
  </div>
</template>

<style scoped>
.hidden { display: none; }

/* ── Page layout ── */
.splice-page {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 360px;
  overflow: hidden;
}

/* ── Preview ── */
.preview-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  overflow: hidden;
  border-right: 1px solid var(--border);
}

.canvas-shell {
  position: relative;
  flex: 1;
  min-height: 0;
  aspect-ratio: 16 / 9;
  background: var(--canvas-bg);
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  align-self: center;
  width: 100%;
}

.canvas { width: 100%; height: 100%; display: block; }

.empty-state {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; color: var(--text-3); font-size: 13px; pointer-events: none;
}

.finished-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
  font-size: 16px; font-weight: 600; color: var(--text-2);
}
.finished-replay {
  padding: 8px 20px; border-radius: var(--r-sm);
  background: var(--accent-dim); color: var(--accent-light); font-size: 13px; font-weight: 500;
  transition: background 0.15s;
}
.finished-replay:hover { background: rgba(112,96,255,0.18); }

/* ── Status bar ── */
.status-bar {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
  font-size: 12px; color: var(--text-3);
}
.status-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--surface-3); transition: background 0.3s;
}
.status-dot.holding     { background: var(--teal); box-shadow: 0 0 6px var(--teal); }
.status-dot.transitioning { background: var(--accent); box-shadow: 0 0 6px var(--accent); animation: pulse 0.8s infinite; }
.status-dot.finished    { background: var(--pink); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.status-text { flex: 1; }
.export-progress-wrap {
  width: 80px; height: 4px; background: var(--surface-3); border-radius: 2px; overflow: hidden; flex-shrink: 0;
}
.export-progress-fill {
  height: 100%; background: linear-gradient(to right, var(--accent), var(--accent-light));
  border-radius: 2px; transition: width 0.1s;
}

/* ── Sidebar ── */
.sidebar { display: flex; flex-direction: column; overflow-y: auto; background: var(--surface); }
.sidebar-block { padding: 14px 16px; border-bottom: 1px solid var(--border); }
.controls-block { flex-shrink: 0; }

.block-header {
  display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
  color: var(--text-3); font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
}
.block-header span { color: var(--text-3); }
.block-badge {
  margin-left: auto;
  background: var(--accent-dim); color: var(--accent);
  font-size: 10px; font-weight: 700; padding: 1px 6px;
  border-radius: 10px; letter-spacing: 0; text-transform: none;
}

/* ── Add button ── */
.add-btn {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px; border: 1.5px dashed var(--border-hover); border-radius: var(--r-md);
  color: var(--text-3); font-size: 12.5px; font-weight: 500;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.add-btn:hover { border-color: var(--accent); color: var(--accent-light); background: var(--accent-dim); }

/* ── Item list ── */
.item-list {
  overflow-y: auto; max-height: 280px;
  padding: 6px 16px; display: flex; flex-direction: column; gap: 3px;
  border-bottom: 1px solid var(--border);
}
.item-row {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 7px; border-radius: var(--r-sm); border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s; cursor: grab;
}
.item-row:hover { background: var(--surface-2); }
.item-row.sorting { opacity: 0.3; }
.item-row.over    { border-color: var(--accent); background: var(--accent-dim); }
.item-row.active  { border-color: var(--teal); background: var(--teal-dim); }
.item-drag { flex-shrink: 0; color: var(--text-4); cursor: grab; }

.item-thumb {
  position: relative; width: 40px; height: 40px; border-radius: 4px;
  overflow: hidden; flex-shrink: 0; background: var(--surface-3);
}
.item-thumb img, .item-thumb video { width: 100%; height: 100%; object-fit: cover; }
.item-type-badge { position: absolute; bottom: 2px; right: 2px; font-size: 7px; opacity: 0.7; }

.item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.item-name { font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-hold-row { display: flex; align-items: center; gap: 3px; }
.hold-label { font-size: 10px; color: var(--text-4); }
.hold-input {
  width: 40px; padding: 2px 4px; border-radius: 4px;
  background: var(--surface-3); border: 1px solid var(--border);
  color: var(--text); font-size: 10.5px; text-align: center;
}
.hold-input:focus { outline: none; border-color: var(--accent); }

.item-index { font-size: 10px; font-weight: 700; color: var(--text-4); width: 14px; text-align: center; flex-shrink: 0; }
.item-del {
  width: 18px; height: 18px; border-radius: 3px; background: transparent;
  color: var(--text-4); display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.15s, color 0.15s;
}
.item-del:hover { background: rgba(220,50,80,0.15); color: #e84d8a; }
.item-del:disabled { opacity: 0.3; cursor: default; }

/* ── Playback buttons ── */
.playback-btns { display: flex; gap: 8px; }
.btn-play {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 10px; border-radius: var(--r-md);
  background: var(--accent); color: var(--on-accent); font-size: 13px; font-weight: 600;
  box-shadow: 0 4px 16px rgba(112,96,255,0.25);
  transition: background 0.15s, opacity 0.15s, box-shadow 0.15s;
}
.btn-play:hover:not(:disabled) { background: #8070ff; box-shadow: 0 4px 20px rgba(112,96,255,0.4); }
.btn-play:disabled { opacity: 0.4; cursor: default; box-shadow: none; }

.btn-export {
  display: flex; align-items: center; gap: 6px; padding: 10px 14px;
  border-radius: var(--r-md); background: var(--surface-3); color: var(--text-2);
  font-size: 12.5px; font-weight: 500; border: 1px solid var(--border);
  transition: background 0.15s, color 0.15s, opacity 0.15s; white-space: nowrap;
}
.btn-export:hover:not(:disabled) { background: var(--surface-4); color: var(--text); }
.btn-export:disabled { opacity: 0.4; cursor: default; }

.spinner {
  width: 13px; height: 13px; border: 2px solid var(--border-hover);
  border-top-color: var(--text-2); border-radius: 50%;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Transition picker grid ── */
.trans-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}

.trans-btn {
  padding: 7px 4px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
  background: var(--surface-2);
  border: 1.5px solid transparent;
  text-align: center;
  transition: color 0.13s, background 0.13s, border-color 0.13s;
  cursor: pointer;
  line-height: 1;
}
.trans-btn:hover {
  color: var(--cat-color, var(--accent));
  background: var(--surface-3);
}
.trans-btn.active {
  color: var(--cat-color, var(--accent));
  background: color-mix(in srgb, var(--cat-color, var(--accent)) 12%, transparent);
  border-color: color-mix(in srgb, var(--cat-color, var(--accent)) 50%, transparent);
  font-weight: 600;
}

/* ── Settings sliders ── */
.setting-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.setting-row:last-child { margin-bottom: 0; }
.setting-row label { width: 60px; font-size: 11.5px; color: var(--text-3); flex-shrink: 0; }
.setting-ctl { flex: 1; display: flex; align-items: center; gap: 8px; }
.setting-ctl input[type='range'] {
  flex: 1; height: 4px; border-radius: 2px; appearance: none; cursor: pointer; outline: none;
}
.setting-ctl input[type='range']::-webkit-slider-thumb {
  appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px rgba(112,96,255,0.4); cursor: pointer;
}
.setting-val { width: 38px; font-size: 11px; color: var(--text-3); text-align: right; flex-shrink: 0; }

/* ── Transitions ── */
.overlay-fade-enter-active, .overlay-fade-leave-active { transition: opacity 0.3s; }
.overlay-fade-enter-from, .overlay-fade-leave-to { opacity: 0; }
</style>
