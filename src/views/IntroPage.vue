<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import type { IntroConfig, IntroAnimation } from '../types'
import { useIntroEngine } from '../composables/useIntroEngine'
import { useAudioPlayer } from '../composables/useAudioPlayer'
import { useBeatDetector } from '../composables/useBeatDetector'
import { saveVideoFile } from '../utils/filePicker'

// ─── Config ────────────────────────────────────────────────────────────────

const config = reactive<IntroConfig>({
  duration: 5,
  bgType: 'color',
  bgFile: null,
  bgUrl: '',
  bgOverlayOpacity: 0.4,
  bgColor: '#0d0d1a',
  bgColorEnd: '#1a0d2e',
  title: {
    text: '我的视频开场',
    fontSize: 64,
    fontWeight: 'bold',
    color: '#ffffff',
    x: 0.5,
    y: 0.42,
    animation: 'slideUp',
    delay: 0.3,
    animDuration: 0.8,
  },
  subtitle: {
    text: 'A Flika Production',
    fontSize: 24,
    fontWeight: 'normal',
    color: 'rgba(255,255,255,0.6)',
    x: 0.5,
    y: 0.58,
    animation: 'fadeIn',
    delay: 0.9,
    animDuration: 0.7,
  },
  logo: {
    file: null,
    url: '',
    size: 0.18,
    x: 0.5,
    y: 0.22,
    animation: 'zoomIn',
    delay: 0.0,
    animDuration: 0.6,
  },
  syncToBeats: false,
})

// ─── Canvas ────────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)
const configRef = computed(() => config as IntroConfig)

const engine = useIntroEngine(canvasRef, configRef)

// ─── Audio ─────────────────────────────────────────────────────────────────

const audioPlayer = useAudioPlayer()
const { audio: audioElement, isPlaying, currentTime, loadAudio, togglePlay, seek } = audioPlayer
const audioFile = ref<File | null>(null)

const { beats, analyzeBeats } = useBeatDetector()

async function handleAudioDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file && file.type.startsWith('audio/')) {
    audioFile.value = file
    loadAudio(file)
    await analyzeBeats(file, 0.5)
  }
}

async function handleAudioInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  audioFile.value = file
  loadAudio(file)
  await analyzeBeats(file, 0.5)
}

// computed: first beat time (for sync)
const firstBeatTime = computed(() =>
  beats.value.length > 0 ? beats.value[0].time : undefined
)

// title's effective delay (may be overridden by beat sync)
const titleEffectiveDelay = computed(() => {
  if (config.syncToBeats && firstBeatTime.value !== undefined) {
    return firstBeatTime.value
  }
  return undefined // use layer's own delay
})

// ─── Logo upload ───────────────────────────────────────────────────────────

async function handleLogoDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file && file.type.startsWith('image/')) {
    config.logo.file = file
    config.logo.url = URL.createObjectURL(file)
    await engine.loadLogoImage(file)
  }
}

async function handleLogoInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  config.logo.file = file
  config.logo.url = URL.createObjectURL(file)
  await engine.loadLogoImage(file)
}

function clearLogo() {
  if (config.logo.url) URL.revokeObjectURL(config.logo.url)
  config.logo.file = null
  config.logo.url = ''
  engine.clearLogo()
}

// ─── Background media ──────────────────────────────────────────────────────

function guessMediaType(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  // Tauri desktop: File.type may be empty, fall back to extension
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(ext)) return 'video'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image'
  return null
}

async function handleBgDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (!file) return
  const t = guessMediaType(file)
  if (t) await setBgFile(file, t)
}

async function handleBgInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const t = guessMediaType(file)
  if (t) await setBgFile(file, t)
}

async function setBgFile(file: File, type: 'image' | 'video') {
  clearBgFile()
  config.bgFile = file
  config.bgUrl = URL.createObjectURL(file)
  config.bgType = type
  await engine.loadBgMedia(file, type)
  engine.renderFrame(previewTime.value, titleEffectiveDelay.value)
}

function clearBgFile() {
  if (config.bgUrl) URL.revokeObjectURL(config.bgUrl)
  config.bgFile = null
  config.bgUrl = ''
  engine.clearBgMedia()
}

function switchBgType(type: 'color' | 'image' | 'video') {
  if (type === 'color') {
    clearBgFile()
  } else if (config.bgType !== type) {
    clearBgFile()
  }
  config.bgType = type
  engine.renderFrame(previewTime.value, titleEffectiveDelay.value)
}

// ─── Preview playback ──────────────────────────────────────────────────────

const previewTime = ref(0)
const localPlaying = ref(false)
let localStartMs = 0
let localStartT = 0
let rafId: number | null = null

const isPreviewPlaying = computed(() => audioFile.value ? isPlaying.value : localPlaying.value)

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

// Audio-driven loop
function startAudioLoop() {
  stopLoop()
  function loop() {
    previewTime.value = currentTime.value
    engine.renderFrame(previewTime.value, titleEffectiveDelay.value)
    rafId = requestAnimationFrame(loop)
  }
  loop()
}

// Standalone timer loop (no audio)
function startLocalLoop() {
  stopLoop()
  localStartMs = performance.now()
  localStartT = previewTime.value
  function loop() {
    const t = Math.min(localStartT + (performance.now() - localStartMs) / 1000, config.duration)
    previewTime.value = t
    engine.seekBgVideo(t)
    engine.renderFrame(t, titleEffectiveDelay.value)
    if (t < config.duration) {
      rafId = requestAnimationFrame(loop)
    } else {
      localPlaying.value = false
      rafId = null
    }
  }
  loop()
}

function togglePreview() {
  if (audioFile.value) {
    togglePlay()
  } else {
    if (localPlaying.value) {
      localPlaying.value = false
      stopLoop()
      engine.renderFrame(previewTime.value, titleEffectiveDelay.value)
    } else {
      if (previewTime.value >= config.duration) previewTime.value = 0
      localPlaying.value = true
      startLocalLoop()
    }
  }
}

// When not playing, render on previewTime change (scrub)
watch(previewTime, (t) => {
  if (!isPreviewPlaying.value) {
    engine.seekBgVideo(t)
    engine.renderFrame(t, titleEffectiveDelay.value)
  }
})

watch(isPlaying, (playing) => {
  if (playing) {
    startAudioLoop()
  } else {
    stopLoop()
    engine.renderFrame(currentTime.value, titleEffectiveDelay.value)
  }
})

// Re-render static frame when config changes (while not playing)
watch(
  () => [
    config.bgColor, config.bgColorEnd, config.bgType, config.bgOverlayOpacity,
    config.title.text, config.title.fontSize, config.title.fontWeight, config.title.color,
    config.title.animation, config.title.delay, config.title.animDuration,
    config.title.x, config.title.y,
    config.subtitle.text, config.subtitle.fontSize, config.subtitle.color,
    config.subtitle.animation, config.subtitle.delay, config.subtitle.animDuration,
    config.subtitle.x, config.subtitle.y,
    config.logo.size, config.logo.x, config.logo.y,
    config.logo.animation, config.logo.delay, config.logo.animDuration,
    config.syncToBeats,
    firstBeatTime.value,
  ],
  () => {
    if (!isPlaying.value) {
      engine.renderFrame(previewTime.value, titleEffectiveDelay.value)
    }
  }
)

// ─── Seekbar ───────────────────────────────────────────────────────────────

const seekbarMax = computed(() => config.duration)

function onSeek(e: Event) {
  const t = parseFloat((e.target as HTMLInputElement).value)
  previewTime.value = t
  if (audioFile.value) seek(t)
  // reset local clock offset so resuming play continues from here
  localStartMs = performance.now()
  localStartT = t
  engine.seekBgVideo(t)
  engine.renderFrame(t, titleEffectiveDelay.value)
}

// ─── Export ────────────────────────────────────────────────────────────────

const isExporting = ref(false)
const exportProgress = ref(0)

async function handleExport() {
  if (isExporting.value) return
  isExporting.value = true
  exportProgress.value = 0

  try {
    const blob = await engine.exportIntro(
      audioElement.value,
      (p) => { exportProgress.value = p },
      titleEffectiveDelay.value,
    )
    await saveVideoFile(blob)
  } catch (err) {
    console.error('导出失败', err)
  } finally {
    isExporting.value = false
    exportProgress.value = 0
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

onMounted(() => {
  // initial static frame at t=0
  setTimeout(() => {
    engine.renderFrame(0, titleEffectiveDelay.value)
  }, 50)
})

onUnmounted(() => {
  stopLoop()
})

// ─── Helpers ───────────────────────────────────────────────────────────────

const animOptions: { value: IntroAnimation; label: string }[] = [
  { value: 'none',        label: '无' },
  { value: 'fadeIn',      label: '淡入' },
  { value: 'slideUp',     label: '上滑' },
  { value: 'slideDown',   label: '下滑' },
  { value: 'slideLeft',   label: '左滑' },
  { value: 'zoomIn',      label: '缩放' },
  { value: 'typewriter',  label: '打字机' },
  { value: 'glitch',      label: '故障' },
  { value: 'textReveal',  label: '✦ 镂空揭幕' },
]

function formatTime(t: number) {
  return t.toFixed(1) + 's'
}
</script>

<template>
  <div class="intro-page">
    <!-- Preview column -->
    <div class="preview-col">
      <div class="canvas-shell">
        <canvas ref="canvasRef" width="1280" height="720" class="preview-canvas" />
      </div>

      <!-- Timeline -->
      <div class="timeline-row">
        <button class="play-btn" @click="togglePreview">
          <svg v-if="!isPreviewPlaying" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
        </button>

        <span class="time-label">{{ formatTime(previewTime) }}</span>

        <input
          type="range"
          class="seekbar"
          min="0"
          :max="seekbarMax"
          step="0.05"
          :value="previewTime"
          @input="onSeek"
        />

        <span class="time-label muted">{{ formatTime(config.duration) }}</span>

        <button class="export-btn" @click="handleExport" :disabled="isExporting">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {{ isExporting ? `导出中 ${Math.round(exportProgress * 100)}%` : '导出 WebM' }}
        </button>
      </div>
    </div>

    <!-- Sidebar -->
    <div class="sidebar">

      <!-- Audio -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          音频
        </div>
        <div
          v-if="!audioFile"
          class="drop-zone"
          @dragover.prevent
          @drop="handleAudioDrop"
          @click="($refs.audioInput as HTMLInputElement).click()"
        >
          <span>拖入音频文件或点击选择</span>
          <input ref="audioInput" type="file" accept="audio/*" style="display:none" @change="handleAudioInput" />
        </div>
        <div v-else class="loaded-row">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <span class="file-name">{{ audioFile.name }}</span>
          <button class="remove-btn" @click="() => { audioPlayer.cleanup(); audioFile = null }">✕</button>
        </div>

        <label class="sync-row">
          <input type="checkbox" v-model="config.syncToBeats" :disabled="beats.length === 0" />
          <span>标题对齐第一个节拍</span>
          <span v-if="firstBeatTime !== undefined" class="beat-hint">{{ formatTime(firstBeatTime) }}</span>
        </label>
      </div>

      <div class="divider" />

      <!-- Title -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
          </svg>
          标题文字
        </div>

        <label class="field-row">
          <span>文字</span>
          <input type="text" v-model="config.title.text" class="text-input" placeholder="标题文字" />
        </label>
        <label class="field-row">
          <span>字号</span>
          <input type="number" v-model.number="config.title.fontSize" class="num-input" min="12" max="200" />
          <span class="unit">px</span>
        </label>
        <label class="field-row">
          <span>粗体</span>
          <input type="checkbox" :checked="config.title.fontWeight === 'bold'" @change="config.title.fontWeight = ($event.target as HTMLInputElement).checked ? 'bold' : 'normal'" />
        </label>
        <label class="field-row">
          <span>颜色</span>
          <input type="color" v-model="config.title.color" class="color-input" />
        </label>
        <label class="field-row">
          <span>水平</span>
          <input type="range" v-model.number="config.title.x" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <label class="field-row">
          <span>垂直</span>
          <input type="range" v-model.number="config.title.y" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <label class="field-row">
          <span>动画</span>
          <select v-model="config.title.animation" class="select-input">
            <option v-for="opt in animOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </label>
        <!-- textReveal hint -->
        <div v-if="config.title.animation === 'textReveal'" class="reveal-hint">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span v-if="config.bgType !== 'color' && config.bgFile">背景{{ config.bgType === 'video' ? '视频' : '图片' }}将从文字镂空中显示</span>
          <span v-else class="warn">请先在「背景」中上传视频或图片作为揭幕内容</span>
        </div>
        <label class="field-row">
          <span>延迟</span>
          <input type="number" v-model.number="config.title.delay" class="num-input" min="0" max="10" step="0.1" />
          <span class="unit">s</span>
        </label>
        <label class="field-row">
          <span>时长</span>
          <input type="number" v-model.number="config.title.animDuration" class="num-input" min="0.1" max="5" step="0.1" />
          <span class="unit">s</span>
        </label>
      </div>

      <div class="divider" />

      <!-- Subtitle -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/>
          </svg>
          副标题
        </div>

        <label class="field-row">
          <span>文字</span>
          <input type="text" v-model="config.subtitle.text" class="text-input" placeholder="副标题文字" />
        </label>
        <label class="field-row">
          <span>字号</span>
          <input type="number" v-model.number="config.subtitle.fontSize" class="num-input" min="8" max="120" />
          <span class="unit">px</span>
        </label>
        <label class="field-row">
          <span>颜色</span>
          <input type="color" v-model="config.subtitle.color" class="color-input" />
        </label>
        <label class="field-row">
          <span>垂直</span>
          <input type="range" v-model.number="config.subtitle.y" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <label class="field-row">
          <span>动画</span>
          <select v-model="config.subtitle.animation" class="select-input">
            <option v-for="opt in animOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </label>
        <label class="field-row">
          <span>延迟</span>
          <input type="number" v-model.number="config.subtitle.delay" class="num-input" min="0" max="10" step="0.1" />
          <span class="unit">s</span>
        </label>
        <label class="field-row">
          <span>时长</span>
          <input type="number" v-model.number="config.subtitle.animDuration" class="num-input" min="0.1" max="5" step="0.1" />
          <span class="unit">s</span>
        </label>
      </div>

      <div class="divider" />

      <!-- Logo -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Logo 图片
        </div>

        <div
          v-if="!config.logo.file"
          class="drop-zone"
          @dragover.prevent
          @drop="handleLogoDrop"
          @click="($refs.logoInput as HTMLInputElement).click()"
        >
          <span>拖入 Logo 图片或点击选择</span>
          <input ref="logoInput" type="file" accept="image/*" style="display:none" @change="handleLogoInput" />
        </div>
        <div v-else class="logo-preview-row">
          <img :src="config.logo.url" class="logo-thumb" />
          <span class="file-name">{{ config.logo.file.name }}</span>
          <button class="remove-btn" @click="clearLogo">✕</button>
        </div>

        <label class="field-row">
          <span>大小</span>
          <input type="range" v-model.number="config.logo.size" min="0.05" max="0.6" step="0.01" class="range-input" />
          <span class="unit">{{ Math.round(config.logo.size * 100) }}%</span>
        </label>
        <label class="field-row">
          <span>水平</span>
          <input type="range" v-model.number="config.logo.x" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <label class="field-row">
          <span>垂直</span>
          <input type="range" v-model.number="config.logo.y" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <label class="field-row">
          <span>动画</span>
          <select v-model="config.logo.animation" class="select-input">
            <option v-for="opt in animOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </label>
        <label class="field-row">
          <span>延迟</span>
          <input type="number" v-model.number="config.logo.delay" class="num-input" min="0" max="10" step="0.1" />
          <span class="unit">s</span>
        </label>
        <label class="field-row">
          <span>时长</span>
          <input type="number" v-model.number="config.logo.animDuration" class="num-input" min="0.1" max="5" step="0.1" />
          <span class="unit">s</span>
        </label>
      </div>

      <div class="divider" />

      <!-- Background -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          背景
        </div>

        <!-- type toggle -->
        <div class="bg-type-row">
          <button
            class="bg-type-btn"
            :class="{ active: config.bgType === 'color' }"
            @click="switchBgType('color')"
          >纯色/渐变</button>
          <button
            class="bg-type-btn"
            :class="{ active: config.bgType === 'image' }"
            @click="switchBgType('image')"
          >图片</button>
          <button
            class="bg-type-btn"
            :class="{ active: config.bgType === 'video' }"
            @click="switchBgType('video')"
          >视频</button>
        </div>

        <!-- color mode -->
        <template v-if="config.bgType === 'color'">
          <label class="field-row">
            <span>顶部</span>
            <input type="color" v-model="config.bgColor" class="color-input" />
          </label>
          <label class="field-row">
            <span>底部</span>
            <input type="color" v-model="config.bgColorEnd" class="color-input" />
            <span class="hint">渐变</span>
          </label>
        </template>

        <!-- image / video mode -->
        <template v-else>
          <div
            v-if="!config.bgFile"
            class="drop-zone"
            @dragover.prevent
            @drop="handleBgDrop"
            @click="($refs.bgInput as HTMLInputElement).click()"
          >
            <span v-if="config.bgType === 'image'">拖入图片或点击选择</span>
            <span v-else>拖入视频或点击选择</span>
            <input
              ref="bgInput"
              type="file"
              :accept="config.bgType === 'image' ? 'image/*' : 'video/*'"
              style="display:none"
              @change="handleBgInput"
            />
          </div>
          <template v-else>
            <!-- image preview -->
            <div v-if="config.bgType === 'image'" class="bg-preview-row">
              <img :src="config.bgUrl" class="bg-thumb" />
              <span class="file-name">{{ config.bgFile.name }}</span>
              <button class="remove-btn" @click="clearBgFile">✕</button>
            </div>
            <!-- video preview -->
            <div v-else class="bg-preview-row">
              <video :src="config.bgUrl" class="bg-thumb" muted />
              <span class="file-name">{{ config.bgFile.name }}</span>
              <button class="remove-btn" @click="clearBgFile">✕</button>
            </div>
          </template>

          <label class="field-row">
            <span>暗化</span>
            <input type="range" v-model.number="config.bgOverlayOpacity" min="0" max="0.9" step="0.05" class="range-input" />
            <span class="unit">{{ Math.round(config.bgOverlayOpacity * 100) }}%</span>
          </label>
        </template>
      </div>

      <div class="divider" />

      <!-- Duration -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          总时长
        </div>
        <label class="field-row">
          <span>{{ config.duration }}s</span>
          <input type="range" v-model.number="config.duration" min="2" max="10" step="0.5" class="range-input" />
        </label>
      </div>

    </div>
  </div>
</template>

<style scoped>
.intro-page {
  display: grid;
  grid-template-columns: 1fr 360px;
  height: 100%;
  overflow: hidden;
}

/* ── Preview ── */
.preview-col {
  display: flex;
  flex-direction: column;
  padding: 20px 16px 16px 20px;
  gap: 14px;
  overflow: hidden;
}

.canvas-shell {
  flex: 1;
  min-height: 0;
  background: #000;
  border-radius: var(--r-md, 8px);
  border: 1px solid var(--border);
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

/* ── Timeline ── */
.timeline-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.play-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--accent-dim, rgba(168,152,255,0.15));
  border: 1px solid rgba(168,152,255,0.3);
  color: #a898ff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.play-btn:hover:not(:disabled) { background: rgba(168,152,255,0.25); }
.play-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.time-label {
  font-size: 12px;
  color: var(--text-3, #888);
  flex-shrink: 0;
  min-width: 30px;
}
.time-label.muted { color: var(--text-4, #555); }

.seekbar {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--surface-3, #2a2a3a);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.seekbar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #a898ff;
  cursor: pointer;
}

.export-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: var(--r-sm, 6px);
  background: var(--pink, #ff5fa0);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.export-btn:hover:not(:disabled) { opacity: 0.85; }
.export-btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Sidebar ── */
.sidebar {
  border-left: 1px solid var(--border);
  overflow-y: auto;
  padding: 0 0 20px;
}

.sidebar-block {
  padding: 14px 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.block-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-3, #888);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}

.divider {
  height: 1px;
  background: var(--border);
  margin: 0;
}

/* ── Fields ── */
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-2, #bbb);
  cursor: pointer;
}

.field-row span:first-child {
  min-width: 38px;
  color: var(--text-3, #888);
  flex-shrink: 0;
}

.text-input {
  flex: 1;
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 4px);
  color: var(--text, #eee);
  padding: 4px 8px;
  font-size: 12.5px;
  outline: none;
}
.text-input:focus { border-color: rgba(168,152,255,0.5); }

.num-input {
  width: 58px;
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 4px);
  color: var(--text, #eee);
  padding: 4px 6px;
  font-size: 12.5px;
  outline: none;
}
.num-input:focus { border-color: rgba(168,152,255,0.5); }

.select-input {
  flex: 1;
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 4px);
  color: var(--text, #eee);
  padding: 4px 6px;
  font-size: 12.5px;
  outline: none;
}

.color-input {
  width: 36px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: none;
  cursor: pointer;
  padding: 1px;
}

.range-input {
  flex: 1;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--surface-3, #2a2a3a);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #a898ff;
  cursor: pointer;
}

.unit {
  font-size: 11px;
  color: var(--text-4, #555);
  flex-shrink: 0;
}

.hint {
  font-size: 11px;
  color: var(--teal, #40d9c0);
  flex-shrink: 0;
}

/* ── Drop zones ── */
.drop-zone {
  border: 1px dashed var(--border);
  border-radius: var(--r-sm, 6px);
  padding: 12px 10px;
  text-align: center;
  color: var(--text-3, #888);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.drop-zone:hover {
  border-color: rgba(168,152,255,0.4);
  background: rgba(168,152,255,0.05);
}

.loaded-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(64,217,192,0.1);
  border: 1px solid rgba(64,217,192,0.25);
  border-radius: var(--r-sm, 6px);
  padding: 6px 10px;
  color: var(--teal, #40d9c0);
  font-size: 12px;
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2, #bbb);
  font-size: 12px;
}

.remove-btn {
  background: none;
  border: none;
  color: var(--text-3, #888);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  line-height: 1;
}
.remove-btn:hover { color: var(--text, #eee); }

.logo-preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.logo-thumb {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border);
}

/* ── Sync checkbox row ── */
.sync-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2, #bbb);
  cursor: pointer;
  padding-top: 2px;
}

.beat-hint {
  margin-left: 4px;
  color: var(--teal, #40d9c0);
  font-size: 11px;
}

/* ── textReveal hint ── */
.reveal-hint {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  padding: 7px 9px;
  border-radius: var(--r-sm, 4px);
  background: rgba(168,152,255,0.08);
  border: 1px solid rgba(168,152,255,0.2);
  font-size: 11.5px;
  color: rgba(168,152,255,0.9);
  line-height: 1.4;
}
.reveal-hint svg { flex-shrink: 0; margin-top: 1px; }
.reveal-hint .warn { color: var(--amber, #fbbf24); }

/* ── Background type toggle ── */
.bg-type-row {
  display: flex;
  gap: 4px;
}

.bg-type-btn {
  flex: 1;
  padding: 5px 0;
  border-radius: var(--r-sm, 4px);
  border: 1px solid var(--border);
  background: var(--surface-2, #1e1e2e);
  color: var(--text-3, #888);
  font-size: 11.5px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.bg-type-btn:hover { color: var(--text-2, #bbb); background: var(--surface-3, #2a2a3a); }
.bg-type-btn.active {
  color: #a898ff;
  background: var(--accent-dim, rgba(168,152,255,0.12));
  border-color: rgba(168,152,255,0.35);
}

/* ── Background media preview ── */
.bg-preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.bg-thumb {
  width: 56px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border);
  flex-shrink: 0;
}
</style>
