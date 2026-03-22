<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { UploadedImage } from '../types'
import { useAudioPlayer } from '../composables/useAudioPlayer'
import { useBeatDetector } from '../composables/useBeatDetector'
import { useFilmStripEngine, COL_W, FILM_H, FRAME_STRIDE, FULL_STRIDE, type FilmColumnData } from '../composables/useFilmStripEngine'
import { saveVideoFile } from '../utils/filePicker'

// ── Column state ──────────────────────────────────────────────────────────────
interface LocalColumn {
  id: string
  type: 'images' | 'video'
  images: UploadedImage[]
  videoFile: File | null
  videoUrl: string
  videoStartTime: number
  videoDuration: number
}

function makeCol(id: string): LocalColumn {
  return { id, type: 'images', images: [], videoFile: null, videoUrl: '', videoStartTime: 0, videoDuration: 0 }
}

const columns     = reactive<LocalColumn[]>([makeCol('c0'), makeCol('c1'), makeCol('c2')])
const columnCount = ref<1 | 2 | 3>(1)
const activeColIdx = ref(0)

// per-column image pan offsets: imgId → {x, y} in canvas pixels
const imgOffsets: Map<string, { x: number; y: number }>[] = [new Map(), new Map(), new Map()]

const activeCols = computed<FilmColumnData[]>(() =>
  columns.slice(0, columnCount.value).map((c, i) => ({
    id: c.id, type: c.type, images: c.images, videoStartTime: c.videoStartTime,
    imgOffsets: imgOffsets[i],
    fullHeight: i < 2,
  })),
)

// canvas dimensions (reactive to column count)
const canvasWidth  = computed(() => columnCount.value * COL_W)

// ── Audio ─────────────────────────────────────────────────────────────────────
const audioFile      = ref<File | null>(null)
const audioStartTime = ref(0)
const { isPlaying, currentTime, duration, loadAudio, togglePlay, stop, audioElement } = useAudioPlayer()
const { beats, analyzeBeats } = useBeatDetector()

// ── Engine ────────────────────────────────────────────────────────────────────
const canvasRef  = ref<HTMLCanvasElement | null>(null)
const engine     = useFilmStripEngine(canvasRef, activeCols, columnCount)

// ── Effects ───────────────────────────────────────────────────────────────────
const filmGrain    = ref(false)
const filmFlicker  = ref(true)
const filmScratches = ref(true)
const vintageColor  = ref(false)
const scrollSpeed   = ref(3)

function effectiveOpts() {
  return { grain: filmGrain.value, vintage: vintageColor.value, scratches: filmScratches.value, beatStrength: filmFlicker.value ? beatStrength.value : 0 }
}

// ── Animation state ───────────────────────────────────────────────────────────
const scrollOffsets  = reactive([0, 0, 0])
const beatStrength   = ref(0)
const colReachedEnd  = reactive([false, false, false])
const reachedEnd     = computed(() => {
  const imgsActive = activeCols.value.filter(c => c.type === 'images')
  return imgsActive.length > 0
    ? activeCols.value.every((c, i) => c.type !== 'images' || colReachedEnd[i])
    : false
})
let localPlaying = false
let rafId: number | null = null
let lastTs = 0

function animLoop(ts: number) {
  if (!lastTs) lastTs = ts
  const delta = Math.min((ts - lastTs) / 1000, 0.1)
  lastTs = ts

  if (isPlaying.value && audioFile.value) {
    const beat = beats.value.find(b => { const d = currentTime.value - b.time; return d >= 0 && d < 0.15 })
    if (beat) { beatStrength.value = beat.strength; setTimeout(() => { beatStrength.value = 0 }, 140) }
  }

  const playing = audioFile.value ? isPlaying.value : localPlaying
  if (playing) {
    const boost    = beatStrength.value * 8
    const pxPerSec = (scrollSpeed.value + boost) * 60
    for (let i = 0; i < columnCount.value; i++) {
      const col = columns[i]
      if (col.type === 'video') {
        scrollOffsets[i] += pxPerSec * delta   // sprocket animation only
      } else {
        const total = col.images.length * (i < 2 ? FULL_STRIDE : FRAME_STRIDE)
        if (!colReachedEnd[i]) {
          const next = scrollOffsets[i] + pxPerSec * delta
          if (next >= total) { scrollOffsets[i] = total; colReachedEnd[i] = true }
          else               { scrollOffsets[i] = next }
        }
      }
    }
    if (reachedEnd.value) {
      localPlaying = false
      if (audioFile.value && isPlaying.value) stop()
      pauseAllVideos()
    }
  }

  engine.renderFrame([...scrollOffsets], effectiveOpts())
  rafId = requestAnimationFrame(animLoop)
}

// ── Play / rewind ─────────────────────────────────────────────────────────────
function togglePreview() {
  if (reachedEnd.value) rewind()
  if (audioFile.value) {
    if (!isPlaying.value && audioElement?.value) audioElement.value.currentTime = audioStartTime.value
    togglePlay()
  } else {
    localPlaying = !localPlaying
  }
  if (localPlaying || (audioFile.value && !isPlaying.value)) {
    playActiveVideos()
  } else {
    pauseAllVideos()
  }
}

function rewind() {
  scrollOffsets[0] = scrollOffsets[1] = scrollOffsets[2] = 0
  colReachedEnd[0] = colReachedEnd[1] = colReachedEnd[2] = false
  localPlaying = false
  if (audioFile.value && isPlaying.value) stop()
  pauseAllVideos()
  seekAllVideosToStart()
}

function isPreviewPlaying() {
  return audioFile.value ? isPlaying.value : localPlaying
}

function playActiveVideos() {
  for (let i = 0; i < columnCount.value; i++) {
    const col = columns[i]
    if (col.type === 'video') engine.getVideoEl(col.id)?.play().catch(() => {})
  }
}
function pauseAllVideos() {
  columns.forEach(col => { if (col.type === 'video') engine.getVideoEl(col.id)?.pause() })
}
function seekAllVideosToStart() {
  columns.forEach(col => {
    if (col.type === 'video') {
      const el = engine.getVideoEl(col.id)
      if (el) el.currentTime = col.videoStartTime
    }
  })
}

// ── Column count change ───────────────────────────────────────────────────────
watch(columnCount, async (n) => {
  if (activeColIdx.value >= n) activeColIdx.value = n - 1
  await nextTick()
  engine.renderFrame([...scrollOffsets], effectiveOpts())
})

// ── Audio upload ──────────────────────────────────────────────────────────────
async function handleAudioFile(file: File) {
  audioFile.value = file
  loadAudio(file)
  audioStartTime.value = 0
  try { await analyzeBeats(file, 0.5) } catch { /* ok */ }
}
function onAudioDrop(e: DragEvent) {
  e.preventDefault()
  const f = e.dataTransfer?.files[0]
  if (f?.type.startsWith('audio/')) handleAudioFile(f)
}
function onAudioInput(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) handleAudioFile(f)
}

// ── Image management (per-column) ─────────────────────────────────────────────
function onImageDrop(e: DragEvent, colIdx: number) {
  e.preventDefault()
  addImages(Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/')), colIdx)
}
function onImageInput(e: Event, colIdx: number) {
  addImages(Array.from((e.target as HTMLInputElement).files ?? []).filter(f => f.type.startsWith('image/')), colIdx)
}
async function addImages(files: File[], colIdx: number) {
  const col = columns[colIdx]
  for (const f of files) {
    const id  = `img_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const url = URL.createObjectURL(f)
    col.images.push({ id, file: f, url, name: f.name })
  }
  colReachedEnd[colIdx] = false
  await engine.preloadColumnImages(col.id, col.images)
  engine.renderFrame([...scrollOffsets], effectiveOpts())
}
function removeImage(colIdx: number, imgId: string) {
  const col = columns[colIdx]
  const img = col.images.find(i => i.id === imgId)
  if (img) URL.revokeObjectURL(img.url)
  engine.removeColumnImage(col.id, imgId)
  imgOffsets[colIdx].delete(imgId)
  col.images = col.images.filter(i => i.id !== imgId)
  colReachedEnd[colIdx] = false
}
function moveImage(colIdx: number, imgIdx: number, dir: -1 | 1) {
  const imgs = columns[colIdx].images
  const to   = imgIdx + dir
  if (to < 0 || to >= imgs.length) return
  ;[imgs[imgIdx], imgs[to]] = [imgs[to], imgs[imgIdx]]
  engine.renderFrame([...scrollOffsets], effectiveOpts())
}

// ── Video management (per-column) ────────────────────────────────────────────
function onVideoDrop(e: DragEvent, colIdx: number) {
  e.preventDefault()
  const f = e.dataTransfer?.files[0]
  if (f?.type.startsWith('video/')) loadVideo(f, colIdx)
}
function onVideoInput(e: Event, colIdx: number) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) loadVideo(f, colIdx)
}
async function loadVideo(file: File, colIdx: number) {
  const col = columns[colIdx]
  if (col.videoUrl) URL.revokeObjectURL(col.videoUrl)
  col.videoFile = file
  col.videoUrl  = URL.createObjectURL(file)
  col.videoStartTime = 0
  col.videoDuration  = 0
  const el = await engine.loadColumnVideo(col.id, col.videoUrl, 0)
  // get duration
  if (!isNaN(el.duration)) col.videoDuration = el.duration
  else el.addEventListener('loadedmetadata', () => { col.videoDuration = el.duration }, { once: true })
  engine.renderFrame([...scrollOffsets], effectiveOpts())
}
function clearVideo(colIdx: number) {
  const col = columns[colIdx]
  if (col.videoUrl) URL.revokeObjectURL(col.videoUrl)
  engine.clearColumnVideo(col.id)
  col.videoFile = null; col.videoUrl = ''; col.videoStartTime = 0; col.videoDuration = 0
  engine.renderFrame([...scrollOffsets], effectiveOpts())
}
async function onVideoStartTimeChange(colIdx: number) {
  const col = columns[colIdx]
  const el  = engine.getVideoEl(col.id)
  if (el) el.currentTime = col.videoStartTime
  engine.renderFrame([...scrollOffsets], effectiveOpts())
}

// ── Canvas drag (image pan) ───────────────────────────────────────────────────
interface DragState {
  colIdx: number; imgId: string
  startClientX: number; startClientY: number
  startOff: { x: number; y: number }
}
let drag: DragState | null = null
const isDragging = ref(false)

function canvasCoord(e: MouseEvent) {
  const canvas = canvasRef.value!
  const rect   = canvas.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (canvasWidth.value / rect.width),
    y: (e.clientY - rect.top)  * (FILM_H / rect.height),
  }
}

function onCanvasMouseDown(e: MouseEvent) {
  const { x, y } = canvasCoord(e)
  const colIdx   = Math.floor(x / COL_W)
  if (colIdx >= columnCount.value || colIdx >= 2) return   // only columns 1 & 2
  const col = columns[colIdx]
  if (col.type !== 'images' || !col.images.length) return
  const stride = colIdx < 2 ? FULL_STRIDE : FRAME_STRIDE
  const imgIdx = Math.floor((y + scrollOffsets[colIdx]) / stride)
  if (imgIdx < 0 || imgIdx >= col.images.length) return
  const imgId  = col.images[imgIdx].id
  const off    = imgOffsets[colIdx].get(imgId) ?? { x: 0, y: 0 }
  drag = { colIdx, imgId, startClientX: e.clientX, startClientY: e.clientY, startOff: { ...off } }
  isDragging.value = true
  e.preventDefault()
}

function onCanvasMouseMove(e: MouseEvent) {
  if (!drag) return
  const canvas = canvasRef.value!
  const rect   = canvas.getBoundingClientRect()
  const scaleX = canvasWidth.value / rect.width
  const scaleY = FILM_H / rect.height
  imgOffsets[drag.colIdx].set(drag.imgId, {
    x: drag.startOff.x + (e.clientX - drag.startClientX) * scaleX,
    y: drag.startOff.y + (e.clientY - drag.startClientY) * scaleY,
  })
  engine.renderFrame([...scrollOffsets], effectiveOpts())
}

function onCanvasDragEnd() {
  drag = null
  isDragging.value = false
}

// ── Export ────────────────────────────────────────────────────────────────────
const isExporting    = ref(false)
const exportProgress = ref(0)
async function handleExport() {
  if (isExporting.value) return
  if (isPlaying.value) stop()
  localPlaying = false; pauseAllVideos()
  isExporting.value = true; exportProgress.value = 0
  try {
    const pxPerSec = scrollSpeed.value * 60
    const blob = await engine.exportVideo(
      audioFile.value && audioElement?.value ? audioElement.value : null,
      pxPerSec,
      { grain: filmGrain.value, vintage: vintageColor.value, scratches: filmScratches.value },
      p => { exportProgress.value = p },
    )
    await saveVideoFile(blob)
  } catch (err) { console.error('Export failed', err) }
  finally {
    isExporting.value = false; exportProgress.value = 0
    engine.renderFrame([...scrollOffsets], effectiveOpts())
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(s: number) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}
function hasContent(i: number) {
  const c = columns[i]
  return c.type === 'images' ? c.images.length > 0 : !!c.videoFile
}

// ── Effects re-render ─────────────────────────────────────────────────────────
watch([filmGrain, filmFlicker, filmScratches, vintageColor], () => {
  engine.renderFrame([...scrollOffsets], effectiveOpts())
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => { lastTs = 0; rafId = requestAnimationFrame(animLoop) })
onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  columns.forEach(col => {
    col.images.forEach(img => URL.revokeObjectURL(img.url))
    if (col.videoUrl) URL.revokeObjectURL(col.videoUrl)
  })
})
</script>

<template>
  <div class="filmstrip-page">
    <!-- Vintage overlays (DOM-side, subtle) -->
    <div class="film-overlay">
      <div v-if="filmGrain"     class="film-grain"></div>
      <div v-if="filmScratches" class="film-scratches"></div>
      <div v-if="vintageColor"  class="vintage-overlay"></div>
      <div v-if="filmFlicker && beatStrength > 0" class="beat-flash"
           :style="{ opacity: beatStrength * 0.32 }"></div>
    </div>

    <div class="page-layout">

      <!-- ── Sidebar ──────────────────────────────────────────────────────── -->
      <aside class="sidebar">
        <div class="sidebar-inner">

          <h2 class="sidebar-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2"/>
              <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
            </svg>
            胶片放映
          </h2>

          <!-- Column count -->
          <div class="ctrl-group">
            <div class="ctrl-label">列数</div>
            <div class="seg-row">
              <button v-for="n in [1,2,3]" :key="n"
                      class="seg-btn" :class="{ active: columnCount === n }"
                      @click="columnCount = n as 1|2|3">
                {{ n }} 列
              </button>
            </div>
          </div>

          <!-- Column tab selector -->
          <div v-if="columnCount > 1" class="ctrl-group">
            <div class="ctrl-label">配置列</div>
            <div class="seg-row">
              <button v-for="i in columnCount" :key="i"
                      class="seg-btn" :class="{ active: activeColIdx === i - 1, 'has-content': hasContent(i-1) }"
                      @click="activeColIdx = i - 1">
                列 {{ i }}
                <span v-if="hasContent(i-1)" class="col-dot"></span>
              </button>
            </div>
          </div>

          <!-- Per-column config -->
          <div class="col-panel">
            <div class="ctrl-label">
              {{ columnCount > 1 ? `列 ${activeColIdx + 1} — ` : '' }}内容类型
            </div>

            <!-- Type toggle -->
            <div class="seg-row">
              <button class="seg-btn" :class="{ active: columns[activeColIdx].type === 'images' }"
                      @click="columns[activeColIdx].type = 'images'">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                图片
              </button>
              <button class="seg-btn" :class="{ active: columns[activeColIdx].type === 'video' }"
                      @click="columns[activeColIdx].type = 'video'">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                视频
              </button>
            </div>

            <!-- Images panel -->
            <template v-if="columns[activeColIdx].type === 'images'">
              <div class="drop-zone"
                   @dragover.prevent @drop="e => onImageDrop(e, activeColIdx)"
                   @click="($refs[`imgInput${activeColIdx}`] as HTMLInputElement).click()">
                <span class="drop-hint">拖入或点击添加图片</span>
                <input :ref="`imgInput${activeColIdx}`" type="file" accept="image/*" multiple
                       style="display:none" @change="e => onImageInput(e, activeColIdx)" />
              </div>

              <!-- Ordered thumbnail list -->
              <div v-if="columns[activeColIdx].images.length" class="img-list">
                <div v-for="(img, idx) in columns[activeColIdx].images" :key="img.id" class="img-row">
                  <div class="img-num">{{ idx + 1 }}</div>
                  <img :src="img.url" class="img-thumb" />
                  <span class="img-name">{{ img.name }}</span>
                  <div class="img-actions">
                    <button class="action-btn" :disabled="idx === 0" @click="moveImage(activeColIdx, idx, -1)">↑</button>
                    <button class="action-btn" :disabled="idx === columns[activeColIdx].images.length - 1" @click="moveImage(activeColIdx, idx, 1)">↓</button>
                    <button class="action-btn del" @click="removeImage(activeColIdx, img.id)">×</button>
                  </div>
                </div>
              </div>
            </template>

            <!-- Video panel -->
            <template v-else>
              <div v-if="!columns[activeColIdx].videoFile"
                   class="drop-zone"
                   @dragover.prevent @drop="e => onVideoDrop(e, activeColIdx)"
                   @click="($refs[`vidInput${activeColIdx}`] as HTMLInputElement).click()">
                <span class="drop-hint">拖入或点击选择视频</span>
                <input :ref="`vidInput${activeColIdx}`" type="file" accept="video/*"
                       style="display:none" @change="e => onVideoInput(e, activeColIdx)" />
              </div>
              <template v-else>
                <div class="video-loaded-row">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#40d9c0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                  <span class="file-loaded">{{ columns[activeColIdx].videoFile!.name }}</span>
                  <button class="action-btn del" @click="clearVideo(activeColIdx)">×</button>
                </div>
                <!-- Start time slider -->
                <div class="ctrl-label" style="margin-top:6px">
                  起始位置
                  <span class="ctrl-val">{{ fmtTime(columns[activeColIdx].videoStartTime) }}</span>
                </div>
                <input type="range" class="film-slider"
                       v-model.number="columns[activeColIdx].videoStartTime"
                       min="0" :max="columns[activeColIdx].videoDuration || 60" step="0.1"
                       @input="onVideoStartTimeChange(activeColIdx)" />
              </template>
            </template>
          </div>

          <!-- Divider -->
          <div class="div-line"></div>

          <!-- Audio -->
          <div class="ctrl-group">
            <div class="ctrl-label">音乐</div>
            <div class="drop-zone" @dragover.prevent @drop="onAudioDrop"
                 @click="($refs.audioInput as HTMLInputElement).click()">
              <span v-if="audioFile" class="file-loaded">{{ audioFile.name }}</span>
              <span v-else class="drop-hint">拖入或点击选择音频</span>
              <input ref="audioInput" type="file" accept="audio/*" style="display:none" @change="onAudioInput" />
            </div>
            <!-- audio start time -->
            <template v-if="audioFile && duration > 0">
              <div class="ctrl-label">
                起播时间
                <span class="ctrl-val">{{ fmtTime(audioStartTime) }}</span>
              </div>
              <input type="range" class="film-slider" v-model.number="audioStartTime"
                     min="0" :max="duration" step="0.5" />
            </template>
          </div>

          <!-- Playback -->
          <div class="ctrl-group">
            <div class="ctrl-label">播放</div>
            <div class="play-row">
              <button class="play-btn" :class="{ active: isPreviewPlaying() }"
                      :disabled="!activeCols.some((_, i) => hasContent(i))"
                      @click="togglePreview">
                <svg v-if="!isPreviewPlaying()" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                {{ isPreviewPlaying() ? '暂停' : (reachedEnd ? '重放' : '播放') }}
              </button>
              <button class="rewind-btn" :disabled="scrollOffsets[0] === 0 && !reachedEnd" @click="rewind">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 .49-5.5"/></svg>
                重置
              </button>
            </div>
            <!-- progress -->
            <div v-if="audioFile && duration > 0" class="time-row">
              <span>{{ fmtTime(currentTime) }}</span>
              <div class="time-bar"><div class="time-fill" :style="{ width: `${(currentTime/duration)*100}%` }"></div></div>
              <span>{{ fmtTime(duration) }}</span>
            </div>
          </div>

          <!-- Speed & effects -->
          <div class="ctrl-group">
            <div class="ctrl-label">
              滚动速度 <span class="ctrl-val">{{ scrollSpeed.toFixed(1) }}</span>
            </div>
            <input type="range" class="film-slider" v-model.number="scrollSpeed" min="0.5" max="10" step="0.5" />
          </div>

          <div class="ctrl-group">
            <div class="ctrl-label">效果</div>
            <div class="toggle-list">
              <label class="toggle"><input type="checkbox" v-model="filmGrain" /><span>颗粒噪点</span></label>
              <label class="toggle"><input type="checkbox" v-model="filmFlicker" /><span>节拍闪烁</span></label>
              <label class="toggle"><input type="checkbox" v-model="filmScratches" /><span>胶片划痕</span></label>
              <label class="toggle"><input type="checkbox" v-model="vintageColor" /><span>复古色调</span></label>
            </div>
          </div>

          <!-- Export -->
          <div class="ctrl-group">
            <button class="export-btn"
                    :disabled="!activeCols.some((_c,i) => hasContent(i)) || isExporting"
                    @click="handleExport">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {{ isExporting ? `导出 ${Math.round(exportProgress * 100)}%` : '导出 WebM 视频' }}
            </button>
            <div v-if="isExporting" class="export-progress">
              <div class="export-fill" :style="{ width: `${exportProgress * 100}%` }"></div>
            </div>
          </div>

        </div>
      </aside>

      <!-- ── Film stage ─────────────────────────────────────────────────── -->
      <div class="film-stage">
        <div class="projector-beam"></div>

        <div class="canvas-area">
          <div class="canvas-wrap" :style="{ aspectRatio: `${canvasWidth} / ${FILM_H}` }">
            <canvas
              ref="canvasRef"
              :width="canvasWidth"
              :height="FILM_H"
              class="film-canvas"
              :style="{ cursor: isDragging ? 'grabbing' : 'grab' }"
              @mousedown="onCanvasMouseDown"
              @mousemove="onCanvasMouseMove"
              @mouseup="onCanvasDragEnd"
              @mouseleave="onCanvasDragEnd"
            />
            <!-- end overlay -->
            <div v-if="reachedEnd" class="end-overlay">
              <div class="end-msg">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>放映结束</span>
                <button class="end-btn" @click="rewind">重新放映</button>
              </div>
            </div>
          </div>
        </div>

        <div class="reel-deco" :class="{ spinning: isPreviewPlaying() }">
          <svg width="64" height="64" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.11)" stroke-width="1.5"/>
            <circle cx="50" cy="50" r="10" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
            <circle cx="50" cy="50" r="3.5" fill="rgba(255,255,255,0.22)"/>
            <line x1="50" y1="5" x2="50" y2="22" stroke="rgba(255,255,255,0.09)" stroke-width="1.5"/>
            <line x1="50" y1="78" x2="50" y2="95" stroke="rgba(255,255,255,0.09)" stroke-width="1.5"/>
            <line x1="5" y1="50" x2="22" y2="50" stroke="rgba(255,255,255,0.09)" stroke-width="1.5"/>
            <line x1="78" y1="50" x2="95" y2="50" stroke="rgba(255,255,255,0.09)" stroke-width="1.5"/>
          </svg>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.filmstrip-page { height: 100%; position: relative; overflow: hidden; background: #0a0908; }

/* ── Overlays ── */
.film-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 100; }
.film-grain { position: absolute; inset: 0; opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-size: 150px; animation: grain 0.5s steps(8) infinite; }
@keyframes grain {
  0%,100%{transform:translate(0,0)} 10%{transform:translate(-2%,-3%)} 20%{transform:translate(3%,1%)}
  30%{transform:translate(-1%,2%)} 40%{transform:translate(2%,-2%)} 50%{transform:translate(-3%,3%)}
  60%{transform:translate(1%,-1%)} 70%{transform:translate(-2%,1%)} 80%{transform:translate(3%,-3%)} 90%{transform:translate(-1%,2%)}
}
.film-scratches { position: absolute; inset: 0;
  background: repeating-linear-gradient(90deg,transparent,transparent 30%,rgba(255,255,255,.01) 30%,rgba(255,255,255,.01) 30.1%,transparent 30.1%,transparent 60%,rgba(255,255,255,.012) 60%,rgba(255,255,255,.012) 60.05%,transparent 60.05%);
  animation: scratch-move 5s linear infinite; }
@keyframes scratch-move { from{transform:translateX(0)} to{transform:translateX(6px)} }
.vintage-overlay { position: absolute; inset: 0;
  background: linear-gradient(180deg,rgba(130,80,25,.07) 0%,transparent 22%,transparent 78%,rgba(130,80,25,.07) 100%); }
.beat-flash { position: absolute; inset: 0;
  background: radial-gradient(ellipse at center,rgba(255,245,215,.35),transparent 70%); }

/* ── Layout ── */
.page-layout { display: grid; grid-template-columns: 260px 1fr; height: 100%; position: relative; z-index: 2; }

/* ── Sidebar ── */
.sidebar { background: rgba(14,11,7,.97); border-right: 1px solid rgba(255,255,255,.05); overflow-y: auto; }
.sidebar-inner { padding: 18px 14px 28px; display: flex; flex-direction: column; gap: 16px; }
.sidebar-title { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; margin: 0;
  color: rgba(255,235,195,.72); font-family: Georgia, serif; }
.ctrl-group { display: flex; flex-direction: column; gap: 6px; }
.ctrl-label { font-size: 10px; font-weight: 600; color: rgba(255,230,180,.38);
  text-transform: uppercase; letter-spacing: 1px;
  display: flex; align-items: center; justify-content: space-between; }
.ctrl-val { color: rgba(255,220,150,.62); font-family: monospace; letter-spacing: 0; text-transform: none; }
.div-line { height: 1px; background: rgba(255,255,255,.06); }

/* seg buttons */
.seg-row { display: flex; gap: 4px; }
.seg-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  padding: 5px 8px; border-radius: 5px; font-size: 11.5px;
  border: 1px solid rgba(255,235,180,.13); background: rgba(255,255,255,.03);
  color: rgba(255,230,175,.45); cursor: pointer; transition: all .15s; position: relative; }
.seg-btn:hover { color: rgba(255,230,175,.7); border-color: rgba(255,230,175,.25); }
.seg-btn.active { color: rgba(255,210,100,.92); background: rgba(255,210,80,.1); border-color: rgba(255,200,80,.35); }
.seg-btn.has-content { color: rgba(255,230,175,.6); }
.col-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,200,80,.7);
  position: absolute; top: 3px; right: 4px; }

/* drop zone */
.drop-zone { position: relative; border: 1px dashed rgba(255,230,180,.14); border-radius: 5px;
  padding: 10px 12px; text-align: center; cursor: pointer; background: rgba(255,255,255,.02);
  transition: border-color .15s, background .15s; }
.drop-zone:hover { border-color: rgba(255,200,100,.28); background: rgba(255,200,100,.04); }
.drop-hint { font-size: 11.5px; color: rgba(255,230,180,.28); }
.file-loaded { font-size: 11.5px; color: rgba(255,210,120,.62); word-break: break-all; }

/* image list */
.img-list { display: flex; flex-direction: column; gap: 3px; max-height: 200px; overflow-y: auto; }
.img-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 4px;
  background: rgba(255,255,255,.025); }
.img-num { font-size: 10px; font-family: monospace; color: rgba(255,200,80,.4); min-width: 16px; text-align: right; }
.img-thumb { width: 32px; height: 24px; object-fit: cover; border-radius: 2px; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.07); }
.img-name { flex: 1; font-size: 11px; color: rgba(255,230,175,.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.img-actions { display: flex; gap: 2px; flex-shrink: 0; }
.action-btn { padding: 2px 5px; border-radius: 3px; border: 1px solid rgba(255,255,255,.1);
  background: transparent; color: rgba(255,230,175,.45); font-size: 11px; cursor: pointer;
  transition: color .1s, background .1s; }
.action-btn:hover:not(:disabled) { color: rgba(255,230,175,.8); background: rgba(255,255,255,.06); }
.action-btn:disabled { opacity: .22; cursor: not-allowed; }
.action-btn.del:hover { color: rgba(255,100,80,.9); border-color: rgba(255,100,80,.3); }

/* video loaded row */
.video-loaded-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 4px;
  background: rgba(64,217,192,.07); border: 1px solid rgba(64,217,192,.2); }
.video-loaded-row .file-loaded { flex: 1; min-width: 0; }

/* play row */
.play-row { display: flex; gap: 5px; }
.play-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px; border-radius: 5px; border: 1px solid rgba(255,235,180,.18);
  background: rgba(255,235,180,.05); color: rgba(255,235,180,.75);
  font-size: 12px; font-weight: 500; cursor: pointer; transition: background .15s; }
.play-btn:hover:not(:disabled) { background: rgba(255,235,180,.11); }
.play-btn.active { background: rgba(255,200,80,.12); border-color: rgba(255,200,80,.38); color: rgba(255,210,100,.88); }
.play-btn:disabled { opacity: .35; cursor: not-allowed; }
.rewind-btn { display: inline-flex; align-items: center; gap: 4px; padding: 8px 9px; border-radius: 5px;
  border: 1px solid rgba(255,235,180,.1); background: transparent;
  color: rgba(255,235,180,.4); font-size: 11.5px; cursor: pointer; transition: color .15s; }
.rewind-btn:hover:not(:disabled) { color: rgba(255,235,180,.65); }
.rewind-btn:disabled { opacity: .2; cursor: not-allowed; }
.time-row { display: flex; align-items: center; gap: 5px; font-size: 10.5px; font-family: monospace; color: rgba(255,220,150,.38); }
.time-bar { flex: 1; height: 2px; background: rgba(255,235,180,.09); border-radius: 1px; overflow: hidden; }
.time-fill { height: 100%; background: rgba(255,200,80,.48); transition: width .1s linear; }

/* slider */
.film-slider { width: 100%; height: 3px; appearance: none;
  background: rgba(255,235,180,.1); border-radius: 2px; outline: none; cursor: pointer; }
.film-slider::-webkit-slider-thumb { appearance: none; width: 13px; height: 13px; border-radius: 50%;
  background: rgba(255,210,100,.68); border: 2px solid rgba(100,60,10,.5); cursor: pointer; }

/* toggles */
.toggle-list { display: flex; flex-direction: column; gap: 4px; }
.toggle { display: flex; align-items: center; gap: 7px; cursor: pointer;
  font-size: 12px; color: rgba(255,230,175,.48); padding: 2px 0; }
.toggle input[type="checkbox"] { width: 12px; height: 12px; accent-color: rgba(200,155,70,.8); }
.toggle:hover { color: rgba(255,230,175,.72); }

/* col panel */
.col-panel { display: flex; flex-direction: column; gap: 7px;
  padding: 10px 10px 12px; border-radius: 6px; background: rgba(255,255,255,.02);
  border: 1px solid rgba(255,255,255,.055); }

/* export */
.export-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 14px; border-radius: 5px; cursor: pointer;
  border: 1px solid rgba(255,100,80,.32); background: rgba(255,100,80,.1);
  color: rgba(255,180,160,.88); font-size: 12px; font-weight: 600; transition: background .15s; }
.export-btn:hover:not(:disabled) { background: rgba(255,100,80,.2); }
.export-btn:disabled { opacity: .4; cursor: not-allowed; }
.export-progress { height: 2px; border-radius: 1px; background: rgba(255,255,255,.07); overflow: hidden; }
.export-fill { height: 100%; background: rgba(255,130,100,.68); transition: width .15s; }

/* ── Stage ── */
.film-stage { display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden;
  background: radial-gradient(ellipse at center, rgba(26,20,12,1) 0%, rgba(8,7,6,1) 80%); }
.projector-beam { position: absolute; top: -160px; left: 50%; transform: translateX(-50%);
  width: 440px; height: 440px;
  background: radial-gradient(ellipse at center top, rgba(255,248,220,.022), transparent 65%); pointer-events: none; }

.canvas-area { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 16px; }
.canvas-wrap { position: relative; max-height: calc(100% - 32px); max-width: 100%;
  border-radius: 3px; overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255,255,255,.04), 0 6px 36px rgba(0,0,0,.72); }
.film-canvas { display: block; width: 100%; height: 100%; }

/* end overlay */
.end-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.68);
  display: flex; align-items: center; justify-content: center; }
.end-msg { display: flex; flex-direction: column; align-items: center; gap: 10px; color: rgba(255,230,175,.78); }
.end-msg svg { opacity: .55; }
.end-msg span { font-size: 13px; font-family: Georgia, serif; }
.end-btn { padding: 6px 18px; border-radius: 4px; border: 1px solid rgba(255,230,175,.22);
  background: rgba(255,230,175,.07); color: rgba(255,230,175,.72);
  font-size: 12px; cursor: pointer; transition: background .15s; }
.end-btn:hover { background: rgba(255,230,175,.14); }

/* reel deco */
.reel-deco { position: absolute; right: 20px; bottom: 22px; opacity: .62; }
.reel-deco.spinning { animation: reel-spin 4s linear infinite; }
@keyframes reel-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
</style>
