<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import type { UploadedImage, DiffusionImage, DiffusionConfig } from '../types'
import { useDiffusionEngine } from '../composables/useDiffusionEngine'
import { useAudioPlayer } from '../composables/useAudioPlayer'
import { useBeatDetector } from '../composables/useBeatDetector'
import { saveVideoFile } from '../utils/filePicker'
import { canvasBg } from '../composables/useTheme'
import ImageUploader from '../components/ImageUploader.vue'
import AudioUploader from '../components/AudioUploader.vue'
import { v4 as uuidv4 } from 'uuid';

// ── Canvas ──────────────────────────────────────────────────────────────────
const canvasRef = ref<HTMLCanvasElement | null>(null)
const CW = 1280
const CH = 720

// ── Images ──────────────────────────────────────────────────────────────────
const images = ref<DiffusionImage[]>([])
const uploaderImages = computed<UploadedImage[]>(() =>
  images.value.map(({ id, file, url, name }) => ({ id, file, url, name })),
)

// ── Audio & Beat detection ──────────────────────────────────────────────────
const audioFile = ref<File | null>(null)
const audioPlayer = useAudioPlayer()
const { beats, isAnalyzing, progress: analyzeProgress, bpm, analyzeBeats } = useBeatDetector()
const sensitivity = ref(0.5)

async function handleAudioUpload(file: File) {
  audioFile.value = file
  audioPlayer.loadAudio(file)
  try {
    await analyzeBeats(file, sensitivity.value)
    // 上传音乐并检测到节拍后，自动开启踩点模式
    if (beats.value.length >= 2) {
      config.beatSyncEnabled = true
    }
  } catch (e) {
    console.error('节拍分析失败', e)
  }
}

let analyzeDebounce: ReturnType<typeof setTimeout> | null = null
watch(sensitivity, (val) => {
  if (!audioFile.value) return
  if (analyzeDebounce) clearTimeout(analyzeDebounce)
  analyzeDebounce = setTimeout(() => analyzeBeats(audioFile.value!, val), 500)
})

// ── Config ──────────────────────────────────────────────────────────────────
const config = reactive<DiffusionConfig>({
  spreadDuration: 3000,
  pauseDuration: 1000,
  loop: false,
  edgeWidth: 30,
  rippleEnabled: true,
  beatSyncEnabled: false,
  bouncingBallEnabled: false,
})
const configRef = computed(() => ({ ...config }))

// ── Engine ──────────────────────────────────────────────────────────────────
const engine = useDiffusionEngine(canvasRef, images, configRef, beats)

// ── Editing state ───────────────────────────────────────────────────────────
const editingMode = ref(false)
const selectedImageIndex = ref(0)
const currentImage = computed(() => images.value[selectedImageIndex.value] ?? null)
const currentImagePoints = computed(() => currentImage.value?.points ?? [])

// ── Playback state ──────────────────────────────────────────────────────────
const isPlaying = ref(false)
const isExporting = ref(false)
const exportProgress = ref(0)
const playElapsed = ref(0)

let rafId: number | null = null
let playStartMs = 0

// ── Canvas helpers ──────────────────────────────────────────────────────────
function clearCanvas() {
  const c = canvasRef.value?.getContext('2d')
  if (c) { c.fillStyle = canvasBg.value; c.fillRect(0, 0, CW, CH) }
}

// ── Image management ────────────────────────────────────────────────────────
function handleImagesAdd(newImgs: UploadedImage[]) {
  const diffImgs: DiffusionImage[] = newImgs.map((img) => ({
    ...img,
    points: [],
    spreadDuration: config.spreadDuration,
    pauseDuration: config.pauseDuration,
  }))
  images.value = [...images.value, ...diffImgs]

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
    points: img.points,
    spreadDuration: img.spreadDuration,
    pauseDuration: img.pauseDuration,
  }]))
  images.value = reordered.map((img) => {
    const extra = extraMap.get(img.id)
    return {
      ...img,
      points: extra?.points ?? [],
      spreadDuration: extra?.spreadDuration ?? config.spreadDuration,
      pauseDuration: extra?.pauseDuration ?? config.pauseDuration,
    }
  })
}

// ── Point editing ───────────────────────────────────────────────────────────
function handleCanvasClick(e: MouseEvent) {
  if (!editingMode.value || isPlaying.value) return
  if (images.value.length === 0) return

  const canvas = canvasRef.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const pixelX = (e.clientX - rect.left) * scaleX
  const pixelY = (e.clientY - rect.top) * scaleY

  const nx = pixelX / canvas.width
  const ny = pixelY / canvas.height

  const img = images.value[selectedImageIndex.value]
  if (!img) return

  img.points.push({ id: uuidv4(), x: nx, y: ny })
  engine.precomputeImage(img)
  engine.renderStaticFrame(selectedImageIndex.value)
}

function removePoint(imageId: string, pointId: string) {
  const img = images.value.find((i) => i.id === imageId)
  if (!img) return
  img.points = img.points.filter((p) => p.id !== pointId)
  engine.precomputeImage(img)
  if (!isPlaying.value) engine.renderStaticFrame(selectedImageIndex.value)
}

function clearPoints(imageId: string) {
  const img = images.value.find((i) => i.id === imageId)
  if (!img) return
  img.points = []
  engine.precomputeImage(img)
  if (!isPlaying.value) engine.renderStaticFrame(selectedImageIndex.value)
}

/** 一键为所有没有扩散点的图片随机添加一个扩散点 */
function autoAddPoints() {
  let changed = false
  for (const img of images.value) {
    if (img.points.length === 0) {
      // 随机点，避免太靠边缘（0.15 ~ 0.85）
      const x = 0.15 + Math.random() * 0.7
      const y = 0.15 + Math.random() * 0.7
      img.points.push({ id: uuidv4(), x, y })
      engine.precomputeImage(img)
      changed = true
    }
  }
  if (changed && !isPlaying.value) {
    engine.renderStaticFrame(selectedImageIndex.value)
  }
}

function pointMarkerStyle(pt: { x: number; y: number }) {
  return {
    left: `${pt.x * 100}%`,
    top: `${pt.y * 100}%`,
  }
}

// ── Image selection ─────────────────────────────────────────────────────────
function selectImage(idx: number) {
  selectedImageIndex.value = idx
  if (!isPlaying.value) engine.renderStaticFrame(idx)
}

// ── Playback ────────────────────────────────────────────────────────────────
function play() {
  if (images.value.length === 0) return
  isPlaying.value = true
  editingMode.value = false

  const useBeatMode = engine.isBeatMode()

  if (useBeatMode) {
    // Beat-sync: drive animation from audio time
    audioPlayer.seek(0)
    audioPlayer.play()

    function beatLoop() {
      if (!isPlaying.value) return
      const elapsed = audioPlayer.currentTime.value * 1000
      playElapsed.value = elapsed
      engine.renderFrame(elapsed)

      // Check if audio ended (non-loop)
      if (!config.loop) {
        const total = engine.getTotalCycleDuration()
        if (elapsed >= total) {
          stop()
          return
        }
      }
      rafId = requestAnimationFrame(beatLoop)
    }
    rafId = requestAnimationFrame(beatLoop)
  } else {
    // Manual timing: use performance.now()
    playStartMs = performance.now()

    function manualLoop() {
      if (!isPlaying.value) return
      const elapsed = performance.now() - playStartMs
      playElapsed.value = elapsed
      engine.renderFrame(elapsed)

      if (!config.loop) {
        const total = engine.getTotalCycleDuration()
        if (elapsed >= total) {
          isPlaying.value = false
          return
        }
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
  engine.resetBallState()
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

    // "轮播1遍"的时长：
    //   手动模式 → 所有图片 spreadDuration + pauseDuration 之和
    //   踩点模式 → 保证所有图片都展示（不够的节拍用平均间隔外推）
    const imgCount = images.value.length
    const beatList = beats.value
    let onePass: number
    if (engine.isBeatMode() && beatList.length > 1) {
      const beatSegments = beatList.length - 1
      if (beatSegments >= imgCount) {
        // 节拍段够用：前 N 段结束于 beats[N].time
        onePass = beatList[imgCount].time * 1000
      } else {
        // 节拍段不够：用平均间隔外推，保证每张图片都有展示时间
        const avgInterval = (beatList[beatList.length - 1].time - beatList[0].time) / beatSegments
        const extraNeeded = imgCount - beatSegments
        onePass = (beatList[beatList.length - 1].time + extraNeeded * avgInterval) * 1000
      }
    } else {
      onePass = engine.getTotalCycleDuration()
    }

    // 导出时长规则：
    // 1. 勾选循环 + 有歌曲 → 按歌曲时长
    // 2. 勾选循环 + 无歌曲 → 循环 2 遍
    // 3. 未勾选循环       → 轮播 1 遍
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
    const totalPts = images.value.reduce((s, img) => s + img.points.length, 0)
    const mode = config.beatSyncEnabled && beats.value.length >= 2 ? ' · 踩点模式' : ''
    return `${images.value.length} 张图片 · ${totalPts} 个扩散点${mode}`
  }
  const info = engine.getPlaybackInfo(playElapsed.value)
  const modeTag = engine.isBeatMode() ? ' 🎵' : ''
  if (info.phase === 'spreading')
    return `第 ${info.index + 1}/${images.value.length} 张 · 扩散中 ${Math.round(info.progress * 100)}%${modeTag}`
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

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

function onKeydown(e: KeyboardEvent) {
  if (e.code !== 'Space' || !isFullscreen.value) return
  if (isExporting.value) return
  e.preventDefault()
  if (isPlaying.value) stop()
  else play()
}

// ── Slider fill ─────────────────────────────────────────────────────────────
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
/** Apply selected image's timing to all images */
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
    canvasRef.value.width = CW
    canvasRef.value.height = CH
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
  <div class="diffusion-page">
    <!-- ── Left: Canvas preview ── -->
    <div class="preview-col">
      <div ref="canvasShellRef" class="canvas-shell" :class="{ 'is-fullscreen': isFullscreen }">
        <canvas
          ref="canvasRef"
          :width="CW"
          :height="CH"
          class="canvas"
          :class="{ 'edit-cursor': editingMode && !isPlaying }"
          @click="handleCanvasClick"
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
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25">
            <circle cx="22" cy="22" r="4" />
            <circle cx="22" cy="22" r="11" />
            <circle cx="22" cy="22" r="19" />
          </svg>
          <span>添加图片后预览扩散着色效果</span>
        </div>

        <!-- Point markers (editing mode) -->
        <template v-if="editingMode && !isPlaying && currentImage">
          <div
            v-for="(pt, idx) in currentImagePoints"
            :key="pt.id"
            class="point-marker"
            :style="pointMarkerStyle(pt)"
            @click.stop="removePoint(currentImage.id, pt.id)"
            :title="`点 ${idx + 1} — 点击移除`"
          >
            <span class="point-marker-num">{{ idx + 1 }}</span>
          </div>
        </template>

        <!-- Edit hint -->
        <Transition name="hint-fade">
          <div v-if="editingMode && !isPlaying && currentImage && currentImagePoints.length === 0" class="edit-hint">
            点击画布添加扩散点
          </div>
        </Transition>
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

        <!-- Beat analysis info -->
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

          <!-- Sensitivity -->
          <div class="setting-row" style="margin-top: 8px;">
            <label>灵敏度</label>
            <div class="setting-ctl">
              <input type="range" min="0" max="1" step="0.05"
                v-model.number="sensitivity"
                :style="sliderFill(sensitivity, 0, 1)" />
              <span class="setting-val">{{ Math.round(sensitivity * 100) }}%</span>
            </div>
          </div>

          <!-- Beat-sync toggle -->
          <label class="loop-toggle" :class="{ disabled: beats.length === 0 }">
            <input type="checkbox" v-model="config.beatSyncEnabled" :disabled="beats.length === 0" />
            <span class="loop-label">踩点切换图片</span>
          </label>
        </template>
      </div>

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

      <!-- Diffusion points editor -->
      <div v-if="images.length > 0" class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" opacity="0.3" /><circle cx="12" cy="12" r="6" opacity="0.5" /><circle cx="12" cy="12" r="2" />
          </svg>
          <span>扩散点</span>
          <span class="block-badge">{{ currentImagePoints.length }}</span>
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
            <span class="tab-pts">{{ img.points.length }}点 · {{ (img.spreadDuration / 1000).toFixed(1) }}s</span>
          </button>
        </div>

        <!-- Edit mode toggle + auto-add + clear -->
        <div class="point-actions">
          <button
            class="edit-toggle"
            :class="{ active: editingMode }"
            @click="editingMode = !editingMode"
            :disabled="isPlaying"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {{ editingMode ? '退出编辑' : '编辑扩散点' }}
          </button>
          <button
            v-if="images.some(img => img.points.length === 0)"
            class="auto-add-btn"
            @click="autoAddPoints"
            :disabled="isPlaying"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-7.07l-2.83 2.83M9.76 14.24l-2.83 2.83m12.14 0l-2.83-2.83M9.76 9.76L6.93 6.93" />
            </svg>
            一键添加
          </button>
          <button
            v-if="currentImagePoints.length > 0"
            class="clear-btn"
            @click="clearPoints(currentImage!.id)"
            :disabled="isPlaying"
          >
            清空
          </button>
        </div>

        <!-- Point list -->
        <div v-if="currentImagePoints.length > 0" class="point-list">
          <div v-for="(pt, idx) in currentImagePoints" :key="pt.id" class="point-item">
            <span class="point-num">{{ idx + 1 }}</span>
            <span class="point-coord">{{ (pt.x * 100).toFixed(0) }}%, {{ (pt.y * 100).toFixed(0) }}%</span>
            <button class="point-del" @click="removePoint(currentImage!.id, pt.id)" :disabled="isPlaying">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
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
            <label>扩散时长</label>
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

      <!-- Diffusion settings -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>扩散参数</span>
        </div>

        <div class="setting-row">
          <label>边缘柔和</label>
          <div class="setting-ctl">
            <input type="range" min="5" max="100" step="5"
              v-model.number="config.edgeWidth"
              :style="sliderFill(config.edgeWidth, 5, 100)" />
            <span class="setting-val">{{ config.edgeWidth }}px</span>
          </div>
        </div>

        <label class="loop-toggle">
          <input type="checkbox" v-model="config.loop" />
          <span class="loop-label">循环播放</span>
        </label>

        <label class="loop-toggle">
          <input type="checkbox" v-model="config.rippleEnabled" />
          <span class="loop-label">涟漪光波</span>
        </label>

        <label class="loop-toggle">
          <input type="checkbox" v-model="config.bouncingBallEnabled" />
          <span class="loop-label">弹跳小球</span>
        </label>
      </div>

    </aside>
  </div>
</template>

<style scoped>
/* ── Page layout ── */
.diffusion-page {
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

.canvas-shell {
  position: relative;
  flex: 1;
  min-height: 0;
  aspect-ratio: 16 / 9;
  background: var(--canvas-bg);
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 16px 48px rgba(0,0,0,0.3);
  align-self: center;
  width: 100%;
}

.canvas { width: 100%; height: 100%; display: block; }
.canvas.edit-cursor { cursor: crosshair; }

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

.edit-hint {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  padding: 6px 16px; border-radius: var(--r-md);
  background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
  color: var(--text-2); font-size: 12px; pointer-events: none;
}
.hint-fade-enter-active, .hint-fade-leave-active { transition: opacity 0.25s; }
.hint-fade-enter-from, .hint-fade-leave-to { opacity: 0; }

/* ── Point markers ── */
.point-marker {
  position: absolute;
  width: 22px; height: 22px;
  margin-left: -11px; margin-top: -11px;
  border-radius: 50%;
  background: rgba(112, 96, 255, 0.5);
  border: 2px solid rgba(168, 152, 255, 0.8);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s, background 0.15s;
  z-index: 2;
  box-shadow: 0 0 8px rgba(112, 96, 255, 0.5);
}
.point-marker:hover {
  transform: scale(1.3);
  background: rgba(232, 77, 138, 0.6);
  border-color: rgba(232, 77, 138, 0.9);
  box-shadow: 0 0 12px rgba(232, 77, 138, 0.6);
}
.point-marker-num {
  font-size: 9px; font-weight: 700; color: #fff;
  line-height: 1; pointer-events: none;
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
.status-dot.spreading { background: var(--teal); box-shadow: 0 0 6px var(--teal); animation: pulse 0.8s infinite; }
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

/* ── Point actions ── */
.point-actions {
  display: flex; gap: 6px; margin-bottom: 8px;
}
.edit-toggle {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
  padding: 7px; border-radius: var(--r-sm);
  font-size: 11.5px; font-weight: 500;
  color: var(--text-3); background: var(--surface-2); border: 1.5px solid transparent;
  cursor: pointer; transition: all 0.15s;
}
.edit-toggle:hover { background: var(--surface-3); color: var(--text-2); }
.edit-toggle.active {
  color: var(--accent); border-color: var(--accent);
  background: var(--accent-dim);
}
.edit-toggle:disabled { opacity: 0.4; cursor: default; }

.auto-add-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 12px; border-radius: var(--r-sm);
  font-size: 11.5px; font-weight: 500;
  color: var(--teal); background: var(--teal-dim);
  border: 1px solid rgba(29, 201, 158, 0.15);
  cursor: pointer; transition: all 0.15s;
}
.auto-add-btn:hover { background: rgba(29, 201, 158, 0.18); border-color: rgba(29, 201, 158, 0.3); }
.auto-add-btn:disabled { opacity: 0.4; cursor: default; }

.clear-btn {
  padding: 7px 12px; border-radius: var(--r-sm);
  font-size: 11.5px; font-weight: 500;
  color: var(--text-4); background: var(--surface-2);
  cursor: pointer; transition: all 0.15s;
}
.clear-btn:hover { color: #e84d8a; background: rgba(232, 77, 138, 0.1); }
.clear-btn:disabled { opacity: 0.4; cursor: default; }

/* ── Point list ── */
.point-list {
  display: flex; flex-direction: column; gap: 2px;
  max-height: 120px; overflow-y: auto;
}
.point-item {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; border-radius: var(--r-xs);
  transition: background 0.1s;
}
.point-item:hover { background: var(--surface-2); }
.point-num {
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--accent-dim); color: var(--accent);
  font-size: 9px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.point-coord {
  flex: 1; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums;
}
.point-del {
  width: 16px; height: 16px; border-radius: 3px;
  background: transparent; color: var(--text-4);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s; flex-shrink: 0;
}
.point-del:hover { background: rgba(220,50,80,0.15); color: #e84d8a; }
.point-del:disabled { opacity: 0.3; cursor: default; }

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
</style>
