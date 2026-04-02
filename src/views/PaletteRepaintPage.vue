<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { UploadedImage, PaletteRepaintImage, PaletteRepaintConfig } from '../types'
import { usePaletteRepaintEngine } from '../composables/usePaletteRepaintEngine'
import { useAudioPlayer } from '../composables/useAudioPlayer'
import { useBeatDetector } from '../composables/useBeatDetector'
import { saveVideoFile } from '../utils/filePicker'
import { useOrientation } from '../composables/useOrientation'
import { canvasBg } from '../composables/useTheme'
import ImageUploader from '../components/ImageUploader.vue'
import AudioUploader from '../components/AudioUploader.vue'
import OrientationSelector from '../components/OrientationSelector.vue'
import { useWaveform } from '../composables/useWaveform'
import WaveformSelector from '../components/WaveformSelector.vue'

// ── Canvas ──────────────────────────────────────────────────────────────────
const canvasRef = ref<HTMLCanvasElement | null>(null)
const { orientation, CW, CH, canvasAspectRatio } = useOrientation()

// ── Images ──────────────────────────────────────────────────────────────────
const images = ref<PaletteRepaintImage[]>([])
const uploaderImages = computed<UploadedImage[]>(() =>
  images.value.map(({ id, file, url, name }) => ({ id, file, url, name })),
)

// ── Audio & Beat detection ──────────────────────────────────────────────────
const audioFile = ref<File | null>(null)
const audioPlayer = useAudioPlayer()
const { beats, isAnalyzing, progress: analyzeProgress, bpm, analyzeBeats } = useBeatDetector()
const sensitivity = ref(0.5)
const { waveformData, extractWaveform } = useWaveform()
const segmentStart = ref(0)
const segmentEnd = ref(0)
const segmentLoop = ref(false)

watch([segmentStart, segmentEnd], ([start, end]) => {
  audioPlayer.setSegment(start, end)
})
watch(segmentLoop, (loop) => {
  audioPlayer.setSegmentLoop(loop)
})

function resetSegment() {
  segmentStart.value = 0
  segmentEnd.value = audioPlayer.duration.value
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

async function handleAudioUpload(file: File) {
  audioFile.value = file
  audioPlayer.loadAudio(file)

  const results = await Promise.allSettled([
    analyzeBeats(file, sensitivity.value),
    extractWaveform(file),
  ])

  // Auto-enable beat sync
  if (results[0].status === 'fulfilled' && beats.value.length >= 2) {
    config.beatSyncEnabled = true
  } else if (results[0].status === 'rejected') {
    console.error('节拍分析失败', results[0].reason)
  }

  // Initialize segment to full range
  const wfResult = results[1]
  if (wfResult.status === 'fulfilled' && wfResult.value) {
    segmentStart.value = 0
    segmentEnd.value = wfResult.value.duration
  }
}

let analyzeDebounce: ReturnType<typeof setTimeout> | null = null
watch(sensitivity, (val) => {
  if (!audioFile.value) return
  if (analyzeDebounce) clearTimeout(analyzeDebounce)
  analyzeDebounce = setTimeout(() => analyzeBeats(audioFile.value!, val), 500)
})

// ── Config ──────────────────────────────────────────────────────────────────
const config = reactive<PaletteRepaintConfig>({
  brushSize: 35,
  strokeDensity: 80,
  paintMode: 'watercolor',
  strokeSpeed: 1.0,
  colorBleed: 0.5,
  spreadDuration: 3000,
  pauseDuration: 1000,
  loop: false,
  beatSyncEnabled: false,
  paletteHue: 0,
})
const configRef = computed(() => ({ ...config }))

// ── Engine ──────────────────────────────────────────────────────────────────
const engine = usePaletteRepaintEngine(canvasRef, images, configRef, beats)

// ── 切换画布方向 ─────────────────────────────────────────────────────────────
watch(orientation, async () => {
  if (isPlaying.value) stop()
  await nextTick()
  if (canvasRef.value) {
    canvasRef.value.width = CW.value
    canvasRef.value.height = CH.value
  }
  if (images.value.length > 0) {
    await engine.preloadImages()
    engine.precomputeAll()
    engine.renderStaticFrame(selectedImageIndex.value)
  } else {
    clearCanvas()
  }
})

// ── Playback state ──────────────────────────────────────────────────────────
const selectedImageIndex = ref(0)
const isPlaying = ref(false)
const isExporting = ref(false)
const exportProgress = ref(0)
const playElapsed = ref(0)

let rafId: number | null = null
let playStartMs = 0

// ── Canvas helpers ──────────────────────────────────────────────────────────
function clearCanvas() {
  const c = canvasRef.value?.getContext('2d')
  if (c) { c.fillStyle = canvasBg.value; c.fillRect(0, 0, CW.value, CH.value) }
}

watch(canvasBg, () => {
  if (isPlaying.value) return
  if (images.value.length > 0) engine.renderStaticFrame(selectedImageIndex.value)
  else clearCanvas()
})

// ── Image management ────────────────────────────────────────────────────────
function handleImagesAdd(newImgs: UploadedImage[]) {
  const rImgs: PaletteRepaintImage[] = newImgs.map((img) => ({
    ...img,
    spreadDuration: config.spreadDuration,
    pauseDuration: config.pauseDuration,
  }))
  images.value = [...images.value, ...rImgs]

  engine.preloadImages().then(() => {
    engine.precomputeAll()
    if (!isPlaying.value && images.value.length > 0) {
      engine.renderStaticFrame(selectedImageIndex.value)
    }
  })
}

function handleImageRemove(id: string) {
  const img = images.value.find((i) => i.id === id)
  if (img) URL.revokeObjectURL(img.url)
  images.value = images.value.filter((i) => i.id !== id)
  if (selectedImageIndex.value >= images.value.length) {
    selectedImageIndex.value = Math.max(0, images.value.length - 1)
  }
  if (images.value.length === 0) clearCanvas()
  else if (!isPlaying.value) engine.renderStaticFrame(selectedImageIndex.value)
}

function handleImagesReorder(reordered: UploadedImage[]) {
  const extraMap = new Map(images.value.map((img) => [img.id, {
    spreadDuration: img.spreadDuration,
    pauseDuration: img.pauseDuration,
  }]))
  images.value = reordered.map((img) => {
    const extra = extraMap.get(img.id)
    return {
      ...img,
      spreadDuration: extra?.spreadDuration ?? config.spreadDuration,
      pauseDuration: extra?.pauseDuration ?? config.pauseDuration,
    }
  })
}

// ── Image selection ─────────────────────────────────────────────────────────
const currentImage = computed(() => images.value[selectedImageIndex.value] ?? null)

function selectImage(idx: number) {
  selectedImageIndex.value = idx
  if (!isPlaying.value) engine.renderStaticFrame(idx)
}

// ── Re-render when visual config changes ─────────────────────────────────────
watch(
  () => [config.brushSize, config.strokeDensity, config.paintMode, config.paletteHue, config.colorBleed],
  () => {
    if (images.value.length > 0 && !isPlaying.value) {
      engine.renderStaticFrame(selectedImageIndex.value)
    }
  },
)

// ── Playback ────────────────────────────────────────────────────────────────
function play() {
  if (images.value.length === 0) return
  isPlaying.value = true

  const useBeatMode = engine.isBeatMode()

  if (useBeatMode) {
    audioPlayer.seek(segmentStart.value)
    audioPlayer.play()

    function beatLoop() {
      if (!isPlaying.value) return
      const elapsed = audioPlayer.currentTime.value * 1000
      playElapsed.value = elapsed
      engine.renderFrame(elapsed)

      if (!config.loop) {
        const total = engine.getTotalCycleDuration()
        if (elapsed >= total) { stop(); return }
      }
      rafId = requestAnimationFrame(beatLoop)
    }
    rafId = requestAnimationFrame(beatLoop)
  } else {
    playStartMs = performance.now()

    function manualLoop() {
      if (!isPlaying.value) return
      const elapsed = performance.now() - playStartMs
      playElapsed.value = elapsed
      engine.renderFrame(elapsed)

      if (!config.loop) {
        const total = engine.getTotalCycleDuration()
        if (elapsed >= total) { isPlaying.value = false; return }
      }
      rafId = requestAnimationFrame(manualLoop)
    }
    rafId = requestAnimationFrame(manualLoop)
  }
}

function stop() {
  isPlaying.value = false
  playElapsed.value = 0
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  audioPlayer.stop()
  if (images.value.length > 0) engine.renderStaticFrame(selectedImageIndex.value)
  else clearCanvas()
}

// ── Export ───────────────────────────────────────────────────────────────────
async function handleExport() {
  if (images.value.length === 0) return
  isExporting.value = true
  exportProgress.value = 0

  try {
    const audioEl = engine.isBeatMode() ? audioPlayer.audioElement.value : null

    const imgCount = images.value.length
    const beatList = beats.value
    let onePass: number
    if (engine.isBeatMode() && beatList.length > 1) {
      const beatSegments = beatList.length - 1
      if (beatSegments >= imgCount) {
        onePass = beatList[imgCount].time * 1000
      } else {
        const avgInterval = (beatList[beatList.length - 1].time - beatList[0].time) / beatSegments
        const extraNeeded = imgCount - beatSegments
        onePass = (beatList[beatList.length - 1].time + extraNeeded * avgInterval) * 1000
      }
    } else {
      onePass = engine.getTotalCycleDuration()
    }

    let exportDuration: number
    if (config.loop) {
      const audioDurMs = audioPlayer.duration.value * 1000
      exportDuration = audioDurMs > 0 ? audioDurMs : onePass * 2
    } else {
      exportDuration = onePass
    }

    const blob = await engine.exportVideo(
      (p) => { exportProgress.value = p },
      audioEl,
      exportDuration,
    )
    await saveVideoFile(blob)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg !== 'Export cancelled') {
      console.error('导出失败', e)
      alert('导出失败，请重试')
    }
  } finally {
    isExporting.value = false
    exportProgress.value = 0
  }
}

function handleCancelExport() {
  engine.cancelExport()
  isExporting.value = false
  exportProgress.value = 0
}

// ── Status ──────────────────────────────────────────────────────────────────
const statusText = computed(() => {
  if (isExporting.value) return `导出中 ${Math.round(exportProgress.value * 100)}%`
  if (images.value.length === 0) return '添加图片后开始'
  if (!isPlaying.value) {
    const modeLabel = { watercolor: '水彩', oil: '油画', sketch: '素描' }[config.paintMode]
    const mode = config.beatSyncEnabled && beats.value.length >= 2 ? ' · 踩点模式' : ''
    return `${images.value.length} 张图片 · ${modeLabel}画风${mode}`
  }
  const info = engine.getPlaybackInfo(playElapsed.value)
  const modeTag = engine.isBeatMode() ? ' 🎵' : ''
  if (info.phase === 'spreading')
    return `第 ${info.index + 1}/${images.value.length} 张 · 调色板重绘中 ${Math.round(info.progress * 100)}%${modeTag}`
  return `第 ${info.index + 1}/${images.value.length} 张 · 停留中${modeTag}`
})

const statusPhase = computed(() => {
  if (!isPlaying.value) return 'idle'
  const info = engine.getPlaybackInfo(playElapsed.value)
  return info.phase
})

// ── Fullscreen ──────────────────────────────────────────────────────────────
const canvasShellRef = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)

function toggleFullscreen() {
  if (!canvasShellRef.value) return
  if (!document.fullscreenElement) {
    canvasShellRef.value.requestFullscreen().catch(() => {})
  } else {
    document.exitFullscreen().catch(() => {})
  }
}

function onFullscreenChange() { isFullscreen.value = !!document.fullscreenElement }

function onKeydown(e: KeyboardEvent) {
  if (e.code !== 'Space' || !isFullscreen.value) return
  if (isExporting.value) return
  e.preventDefault()
  if (isPlaying.value) stop()
  else play()
}

// ── Slider fill helper ──────────────────────────────────────────────────────
function sliderFill(value: number, min: number, max: number) {
  const pct = ((value - min) / (max - min)) * 100
  return {
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--surface-3) ${pct}%, var(--surface-3) 100%)`,
  }
}

// ── Per-image timing helpers ────────────────────────────────────────────────
function updateImageSpread(idx: number, val: number) {
  const clamped = Math.max(500, Math.min(15000, Math.round(val)))
  if (images.value[idx]) images.value[idx].spreadDuration = clamped
}
function updateImagePause(idx: number, val: number) {
  const clamped = Math.max(0, Math.min(10000, Math.round(val)))
  if (images.value[idx]) images.value[idx].pauseDuration = clamped
}
function applyTimingToAll() {
  const src = currentImage.value
  if (!src) return
  for (const img of images.value) {
    img.spreadDuration = src.spreadDuration
    img.pauseDuration = src.pauseDuration
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  if (canvasRef.value) {
    canvasRef.value.width = CW.value
    canvasRef.value.height = CH.value
    clearCanvas()
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  stop()
  audioPlayer.cleanup()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('keydown', onKeydown)
  for (const img of images.value) URL.revokeObjectURL(img.url)
})
</script>

<template>
  <div class="palette-page">
    <!-- ── Left: Canvas preview ── -->
    <div class="preview-col">
      <div class="canvas-wrapper">
      <div ref="canvasShellRef" class="canvas-shell" :class="{ 'is-fullscreen': isFullscreen }" :style="{ aspectRatio: canvasAspectRatio }">
        <canvas
          ref="canvasRef"
          :width="CW"
          :height="CH"
          class="canvas"
        />

        <!-- Fullscreen toggle -->
        <button class="fullscreen-btn" @click.stop="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏播放'">
          <svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>

        <!-- Empty state -->
        <div v-if="images.length === 0" class="empty-state">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>添加图片后预览调色板重绘效果</span>
        </div>
      </div>
      </div>

      <!-- Status bar -->
      <div class="status-bar">
        <span class="status-dot" :class="statusPhase" />
        <span class="status-text">{{ statusText }}</span>
        <div v-if="isExporting" class="export-progress-wrap">
          <div class="export-progress-fill" :style="{ width: `${exportProgress * 100}%` }" />
        </div>
      </div>
    </div>

    <!-- ── Right: Sidebar ── -->
    <aside class="sidebar">

      <!-- 画布方向 -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span>画布方向</span>
        </div>
        <OrientationSelector v-model="orientation" :disabled="isPlaying || isExporting" />
      </div>

      <!-- Audio uploader -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <span>音乐踩点</span>
          <span v-if="beats.length" class="block-badge beat-badge">{{ beats.length }} 拍</span>
        </div>
        <AudioUploader @upload="handleAudioUpload" />

        <template v-if="audioFile">
          <div v-if="isAnalyzing" class="analyze-bar">
            <span class="spinner-sm" />
            <span>分析节拍中… {{ Math.round(analyzeProgress) }}%</span>
            <div class="analyze-progress">
              <div class="analyze-fill" :style="{ width: `${analyzeProgress}%` }" />
            </div>
          </div>
          <div v-else-if="beats.length > 0" class="beat-info">
            <span class="beat-chip">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              BPM {{ bpm }}
            </span>
            <span class="beat-chip">{{ beats.length }} 个节拍</span>
          </div>

          <div class="setting-row" style="margin-top: 8px;">
            <label>灵敏度</label>
            <div class="setting-ctl">
              <input type="range" min="0" max="1" step="0.05"
                v-model.number="sensitivity"
                :style="sliderFill(sensitivity, 0, 1)" />
              <span class="setting-val">{{ Math.round(sensitivity * 100) }}%</span>
            </div>
          </div>

          <label class="loop-toggle" :class="{ disabled: beats.length === 0 }">
            <input type="checkbox" v-model="config.beatSyncEnabled" :disabled="beats.length === 0" />
            <span class="loop-label">踩点切换图片</span>
          </label>
        </template>
      </div>

      <!-- 片段选取 -->
      <Transition name="wf-fade">
        <div class="sidebar-block segment-block" v-if="waveformData">
          <div class="block-header">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <span>片段选取</span>
            <span class="block-badge segment-badge">
              {{ formatTime(segmentStart) }} – {{ formatTime(segmentEnd) }}
            </span>
          </div>
          <WaveformSelector
            :waveform-data="waveformData"
            :current-time="audioPlayer.currentTime.value"
            :duration="audioPlayer.duration.value"
            :segment-start="segmentStart"
            :segment-end="segmentEnd"
            @update:segment-start="segmentStart = $event"
            @update:segment-end="segmentEnd = $event"
            @seek="(t: number) => audioPlayer.seek(t)"
          />
          <div class="segment-controls">
            <label class="loop-toggle">
              <input type="checkbox" v-model="segmentLoop" />
              <span class="loop-label">循环片段</span>
            </label>
            <button class="btn-reset-segment" @click="resetSegment">全曲</button>
          </div>
        </div>
      </Transition>

      <!-- Image uploader -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
          <span>图片素材</span>
          <span v-if="images.length" class="block-badge">{{ images.length }}</span>
        </div>
        <ImageUploader
          :images="uploaderImages"
          @add="handleImagesAdd"
          @remove="handleImageRemove"
          @reorder="handleImagesReorder"
        />
      </div>

      <!-- Per-image timing -->
      <div v-if="images.length > 0" class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <span>时间设置</span>
        </div>

        <!-- Image tabs -->
        <div class="image-tabs">
          <button
            v-for="(img, idx) in images"
            :key="img.id"
            class="image-tab"
            :class="{ active: selectedImageIndex === idx }"
            @click="selectImage(idx)"
          >
            <img :src="img.url" class="tab-thumb" />
            <span class="tab-idx">{{ idx + 1 }}</span>
            <span class="tab-pts">{{ (img.spreadDuration / 1000).toFixed(1) }}s</span>
          </button>
        </div>

        <!-- Per-image timing -->
        <div v-if="currentImage" class="per-image-timing">
          <div class="timing-header">
            <span class="timing-label">图片 {{ selectedImageIndex + 1 }} 时间设置</span>
            <button v-if="images.length > 1" class="apply-all-btn" @click="applyTimingToAll" title="将当前时间设置应用到所有图片">
              应用到全部
            </button>
          </div>

          <div class="timing-row">
            <label>转场时长</label>
            <div class="timing-ctl">
              <input type="range" min="500" max="15000" step="100"
                :value="currentImage.spreadDuration"
                @input="updateImageSpread(selectedImageIndex, +($event.target as HTMLInputElement).value)"
                :style="sliderFill(currentImage.spreadDuration, 500, 15000)" />
              <div class="timing-input-wrap">
                <input type="number" class="timing-input" min="500" max="15000" step="100"
                  :value="currentImage.spreadDuration"
                  @change="updateImageSpread(selectedImageIndex, +($event.target as HTMLInputElement).value)" />
                <span class="timing-unit">ms</span>
              </div>
            </div>
          </div>

          <div class="timing-row">
            <label>停留时间</label>
            <div class="timing-ctl">
              <input type="range" min="0" max="10000" step="100"
                :value="currentImage.pauseDuration"
                @input="updateImagePause(selectedImageIndex, +($event.target as HTMLInputElement).value)"
                :style="sliderFill(currentImage.pauseDuration, 0, 10000)" />
              <div class="timing-input-wrap">
                <input type="number" class="timing-input" min="0" max="10000" step="100"
                  :value="currentImage.pauseDuration"
                  @change="updateImagePause(selectedImageIndex, +($event.target as HTMLInputElement).value)" />
                <span class="timing-unit">ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Playback controls -->
      <div class="sidebar-block controls-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>播放控制</span>
        </div>
        <div class="playback-btns">
          <button class="btn-play" :disabled="images.length === 0 || isExporting" @click="isPlaying ? stop() : play()">
            <svg v-if="!isPlaying" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            {{ isPlaying ? '停止' : '播放预览' }}
          </button>
          <button v-if="!isExporting" class="btn-export" :disabled="images.length === 0 || isPlaying" @click="handleExport">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            导出视频
          </button>
          <button v-else class="btn-cancel-export" @click="handleCancelExport">
            <span class="spinner" />
            <span>{{ Math.round(exportProgress * 100) }}%</span>
            <span class="cancel-hint">取消</span>
          </button>
        </div>
      </div>

      <!-- Palette repaint settings -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
            <circle cx="7.5" cy="10.5" r="1.5" /><circle cx="10.5" cy="7" r="1.5" /><circle cx="15.5" cy="7" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" />
          </svg>
          <span>重绘参数</span>
        </div>

        <div class="setting-row">
          <label>画笔大小</label>
          <div class="setting-ctl">
            <input type="range" min="10" max="80" step="2"
              v-model.number="config.brushSize"
              :style="sliderFill(config.brushSize, 10, 80)" />
            <span class="setting-val">{{ config.brushSize }}px</span>
          </div>
        </div>

        <div class="setting-row">
          <label>笔触密度</label>
          <div class="setting-ctl">
            <input type="range" min="20" max="200" step="5"
              v-model.number="config.strokeDensity"
              :style="sliderFill(config.strokeDensity, 20, 200)" />
            <span class="setting-val">{{ config.strokeDensity }}</span>
          </div>
        </div>

        <div class="setting-row">
          <label>笔触速度</label>
          <div class="setting-ctl">
            <input type="range" min="0.5" max="3" step="0.1"
              v-model.number="config.strokeSpeed"
              :style="sliderFill(config.strokeSpeed, 0.5, 3)" />
            <span class="setting-val">{{ config.strokeSpeed.toFixed(1) }}x</span>
          </div>
        </div>

        <div class="setting-row">
          <label>颜色溢出</label>
          <div class="setting-ctl">
            <input type="range" min="0" max="1" step="0.05"
              v-model.number="config.colorBleed"
              :style="sliderFill(config.colorBleed, 0, 1)" />
            <span class="setting-val">{{ Math.round(config.colorBleed * 100) }}%</span>
          </div>
        </div>

        <!-- Paint mode -->
        <div class="mode-row">
          <label class="mode-label">画风模式</label>
          <div class="mode-btns">
            <button
              class="mode-btn"
              :class="{ active: config.paintMode === 'watercolor' }"
              @click="config.paintMode = 'watercolor'"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
              </svg>
              水彩
            </button>
            <button
              class="mode-btn"
              :class="{ active: config.paintMode === 'oil' }"
              @click="config.paintMode = 'oil'"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" /><path d="M9 21V9" />
              </svg>
              油画
            </button>
            <button
              class="mode-btn"
              :class="{ active: config.paintMode === 'sketch' }"
              @click="config.paintMode = 'sketch'"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" />
                <line x1="15" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" />
              </svg>
              素描
            </button>
          </div>
        </div>

        <!-- Hue slider -->
        <div class="setting-row" style="margin-top: 8px;">
          <label>色调偏移</label>
          <div class="setting-ctl">
            <input type="range" min="0" max="360" step="5"
              v-model.number="config.paletteHue"
              :style="{ background: `linear-gradient(to right, hsl(0,80%,60%), hsl(60,80%,60%), hsl(120,80%,60%), hsl(180,80%,60%), hsl(240,80%,60%), hsl(300,80%,60%), hsl(360,80%,60%))` }" />
            <span class="setting-val">{{ config.paletteHue }}°</span>
          </div>
        </div>

        <label class="loop-toggle">
          <input type="checkbox" v-model="config.loop" />
          <span class="loop-label">循环播放</span>
        </label>
      </div>

    </aside>
  </div>
</template>

<style scoped>
/* ── Page layout ── */
.palette-page {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 360px;
  overflow: hidden;
}

/* ── Preview column ── */
.preview-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  overflow: hidden;
  border-right: 1px solid var(--border);
}

.canvas-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

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

.canvas { width: 100%; height: 100%; display: block; }

/* ── Fullscreen ── */
.canvas-shell.is-fullscreen {
  background: var(--canvas-bg);
  border: none;
  border-radius: 0;
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.canvas-shell.is-fullscreen .canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.fullscreen-btn {
  position: absolute; top: 10px; right: 10px;
  width: 32px; height: 32px; border-radius: var(--r-sm);
  background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(6px);
  color: rgba(255, 255, 255, 0.7);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s, color 0.15s;
  z-index: 10; opacity: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.canvas-shell:hover .fullscreen-btn,
.canvas-shell.is-fullscreen .fullscreen-btn { opacity: 1; }
.fullscreen-btn:hover { background: rgba(0, 0, 0, 0.75); color: var(--on-accent); }
.canvas-shell.is-fullscreen .fullscreen-btn {
  top: 16px; right: 16px;
  width: 40px; height: 40px; border-radius: var(--r-md);
}

.empty-state {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; color: var(--text-3); font-size: 13px; pointer-events: none;
}

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
.status-dot.spreading { background: var(--purple); box-shadow: 0 0 6px var(--purple); animation: pulse 0.8s infinite; }
.status-dot.pausing   { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
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

/* ── Image tabs ── */
.image-tabs {
  display: flex; gap: 4px; overflow-x: auto; padding-bottom: 8px;
  scrollbar-width: thin;
}
.image-tab {
  position: relative; flex-shrink: 0;
  width: 56px; display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 4px; border-radius: var(--r-sm);
  border: 1.5px solid transparent; background: var(--surface-2);
  cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.image-tab:hover { background: var(--surface-3); }
.image-tab.active {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.tab-thumb {
  width: 40px; height: 28px; border-radius: 3px;
  object-fit: cover; display: block;
}
.tab-idx {
  font-size: 9px; font-weight: 700; color: var(--text-3);
}
.tab-pts {
  font-size: 8px; color: var(--text-4);
}

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

.btn-cancel-export {
  display: flex; align-items: center; gap: 6px; padding: 10px 14px;
  border-radius: var(--r-md); background: rgba(232, 77, 138, 0.12); color: var(--pink);
  font-size: 12.5px; font-weight: 500; border: 1px solid rgba(232, 77, 138, 0.2);
  transition: background 0.15s, border-color 0.15s; white-space: nowrap; cursor: pointer;
}
.btn-cancel-export:hover {
  background: rgba(232, 77, 138, 0.2); border-color: rgba(232, 77, 138, 0.4);
}
.btn-cancel-export .cancel-hint {
  font-size: 10px; opacity: 0; transition: opacity 0.15s;
}
.btn-cancel-export:hover .cancel-hint { opacity: 1; }

.spinner {
  width: 13px; height: 13px; border: 2px solid var(--border-hover);
  border-top-color: var(--text-2); border-radius: 50%;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

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

/* ── Mode buttons ── */
.mode-row {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.mode-label { width: 60px; font-size: 11.5px; color: var(--text-3); flex-shrink: 0; }
.mode-btns { display: flex; gap: 6px; flex: 1; }
.mode-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
  padding: 6px 10px; border-radius: var(--r-sm);
  background: var(--surface-2); border: 1.5px solid transparent;
  color: var(--text-3); font-size: 11px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.mode-btn:hover { background: var(--surface-3); color: var(--text-2); }
.mode-btn.active {
  border-color: var(--accent);
  background: var(--accent-dim);
  color: var(--accent);
}

/* ── Loop toggle ── */
.loop-toggle {
  display: flex; align-items: center; gap: 8px;
  margin-top: 10px; cursor: pointer;
}
.loop-toggle input[type='checkbox'] {
  width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer;
}
.loop-label { font-size: 12px; color: var(--text-3); }

/* ── Per-image timing ── */
.per-image-timing {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.timing-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.timing-label {
  font-size: 11px; font-weight: 600; color: var(--text-3);
  letter-spacing: 0.04em;
}
.apply-all-btn {
  font-size: 10px; font-weight: 500; color: var(--accent);
  background: var(--accent-dim); border: 1px solid transparent;
  padding: 2px 8px; border-radius: var(--r-xs);
  cursor: pointer; transition: all 0.15s;
}
.apply-all-btn:hover {
  background: rgba(112, 96, 255, 0.2); border-color: var(--accent);
}

.timing-row {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
.timing-row:last-child { margin-bottom: 0; }
.timing-row label {
  width: 54px; font-size: 11px; color: var(--text-3); flex-shrink: 0;
}
.timing-ctl {
  flex: 1; display: flex; align-items: center; gap: 8px;
}
.timing-ctl input[type='range'] {
  flex: 1; height: 4px; border-radius: 2px; appearance: none;
  cursor: pointer; outline: none; min-width: 0;
}
.timing-ctl input[type='range']::-webkit-slider-thumb {
  appearance: none; width: 12px; height: 12px; border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px rgba(112,96,255,0.4);
  cursor: pointer;
}

.timing-input-wrap {
  display: flex; align-items: center; gap: 2px; flex-shrink: 0;
}
.timing-input {
  width: 52px; padding: 3px 4px; border-radius: var(--r-xs);
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-2); font-size: 11px; text-align: right;
  outline: none; font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}
.timing-input::-webkit-inner-spin-button,
.timing-input::-webkit-outer-spin-button {
  -webkit-appearance: none; margin: 0;
}
.timing-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(112, 96, 255, 0.3);
}
.timing-unit {
  font-size: 10px; color: var(--text-4); flex-shrink: 0;
}

/* ── Beat / Audio ── */
.beat-badge {
  background: rgba(29, 201, 158, 0.15) !important;
  color: var(--teal) !important;
}

.analyze-bar {
  display: flex; align-items: center; gap: 6px;
  margin-top: 10px; padding: 8px 10px;
  background: var(--surface-2); border-radius: var(--r-sm);
  font-size: 11px; color: var(--text-3);
}
.spinner-sm {
  width: 11px; height: 11px; border: 1.5px solid var(--border);
  border-top-color: var(--teal); border-radius: 50%;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
.analyze-progress {
  flex: 1; height: 3px; background: var(--surface-3); border-radius: 2px; overflow: hidden;
}
.analyze-fill {
  height: 100%; background: var(--teal); border-radius: 2px; transition: width 0.15s;
}

.beat-info {
  display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;
}
.beat-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: var(--r-xs);
  background: rgba(29, 201, 158, 0.1); color: var(--teal);
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
}

.loop-toggle.disabled { opacity: 0.4; cursor: default; }

/* ── Segment selector ── */
.segment-badge {
  font-variant-numeric: tabular-nums;
}
.segment-controls {
  display: flex; align-items: center; justify-content: space-between; margin-top: 10px;
}
.btn-reset-segment {
  font-size: 11px; font-weight: 500; color: var(--text-3);
  padding: 3px 10px; border-radius: var(--r-sm);
  background: var(--surface-3); border: 1px solid var(--border);
  cursor: pointer; transition: color 0.15s, background 0.15s;
}
.btn-reset-segment:hover { color: var(--text-2); background: var(--surface-4); }
.wf-fade-enter-active, .wf-fade-leave-active { transition: opacity 0.3s, transform 0.3s; }
.wf-fade-enter-from, .wf-fade-leave-to { opacity: 0; transform: translateY(4px); }
</style>
