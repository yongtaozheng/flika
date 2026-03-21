<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import type { PosterConfig, PosterRatio } from '../types'
import { usePosterEngine } from '../composables/usePosterEngine'
import { saveImageFile } from '../utils/filePicker'

// ─── Canvas dims ────────────────────────────────────────────────────────────

const RATIO_DIMS: Record<PosterRatio, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1':  [1080, 1080],
  '4:3':  [1440, 1080],
}

// ─── Templates ──────────────────────────────────────────────────────────────

interface TplText {
  x: number; y: number
  fontSize: number; fontWeight: string
  textAlign: 'left' | 'center' | 'right'
  color: string
  shadowColor: string; shadowBlur: number
  strokeColor?: string; strokeWidth?: number
}
interface TplLogo { x: number; y: number; size: number }

interface PosterTemplate {
  id: string
  name: string
  tag: string           // platform tag
  desc: string
  bgColor: string
  bgColorEnd: string
  lightBg: boolean      // true = light background, need dark marks in swatch
  title: TplText
  subtitle: TplText
  logo: TplLogo
}

const TEMPLATES: PosterTemplate[] = [
  // ── 小红书 ────────────────────────────────────────────────────────────────

  // ① 热辣橙红 — 高饱和橙红渐变，白色大字，美食/生活类爆款
  {
    id: 'xhs-orange',
    name: '热辣橙红',
    tag: '小红书',
    desc: '高饱和橙红 · 白字冲击',
    bgColor: '#ff4500', bgColorEnd: '#ff9000', lightBg: false,
    logo:     { x: 0.5,  y: 0.17, size: 0.10 },
    title:    { x: 0.5,  y: 0.47, fontSize: 104, fontWeight: 'bold',   textAlign: 'center', color: '#ffffff',      shadowColor: 'rgba(0,0,0,0.4)',        shadowBlur: 18, strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.5,  y: 0.63, fontSize: 38,  fontWeight: 'normal', textAlign: 'center', color: 'rgba(255,255,255,0.9)',  shadowColor: 'rgba(0,0,0,0.3)',        shadowBlur: 8  },
  },
  // ② 薰衣草 — 浅紫粉渐变，深紫文字，美妆/穿搭/治愈系
  {
    id: 'xhs-lavender',
    name: '薰衣草',
    tag: '小红书',
    desc: '柔和紫粉 · 深色文字',
    bgColor: '#e8d5f8', bgColorEnd: '#f8d0e8', lightBg: true,
    logo:     { x: 0.5,  y: 0.18, size: 0.11 },
    title:    { x: 0.5,  y: 0.47, fontSize: 90,  fontWeight: 'bold',   textAlign: 'center', color: '#3a1060',      shadowColor: 'rgba(0,0,0,0)',          shadowBlur: 0,  strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.5,  y: 0.63, fontSize: 34,  fontWeight: 'normal', textAlign: 'center', color: '#7840a8',      shadowColor: 'rgba(0,0,0,0)',          shadowBlur: 0  },
  },
  // ③ 柠檬黄 — 鲜亮黄色，深色左对齐大字，美食/好物推荐爆款
  {
    id: 'xhs-yellow',
    name: '柠檬黄',
    tag: '小红书',
    desc: '鲜亮黄 · 左对齐大字',
    bgColor: '#ffe000', bgColorEnd: '#ffb300', lightBg: true,
    logo:     { x: 0.9,  y: 0.12, size: 0.07 },
    title:    { x: 0.08, y: 0.44, fontSize: 108, fontWeight: 'bold',   textAlign: 'left',   color: '#1a0800',      shadowColor: 'rgba(0,0,0,0)',          shadowBlur: 0,  strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.08, y: 0.62, fontSize: 36,  fontWeight: 'normal', textAlign: 'left',   color: '#4a2800',      shadowColor: 'rgba(0,0,0,0)',          shadowBlur: 0  },
  },
  // ④ 清新绿 — 薄荷渐变，图上字下，健身/健康/自然内容
  {
    id: 'xhs-mint',
    name: '清新薄荷',
    tag: '小红书',
    desc: '薄荷绿 · 图大字沉底',
    bgColor: '#d0f4e0', bgColorEnd: '#a8e8c8', lightBg: true,
    logo:     { x: 0.5,  y: 0.29, size: 0.22 },
    title:    { x: 0.5,  y: 0.73, fontSize: 84,  fontWeight: 'bold',   textAlign: 'center', color: '#0d3d20',      shadowColor: 'rgba(0,0,0,0)',          shadowBlur: 0,  strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.5,  y: 0.86, fontSize: 30,  fontWeight: 'normal', textAlign: 'center', color: '#2d7a50',      shadowColor: 'rgba(0,0,0,0)',          shadowBlur: 0  },
  },

  // ── B站 ──────────────────────────────────────────────────────────────────

  // ⑤ 赛博霓虹 — 深黑底+青/品红霓虹，游戏/科技/二次元
  {
    id: 'bili-neon',
    name: '赛博霓虹',
    tag: 'B站',
    desc: '深黑 · 青色标题 · 品红副标题',
    bgColor: '#040210', bgColorEnd: '#0c0528', lightBg: false,
    logo:     { x: 0.1,  y: 0.13, size: 0.09 },
    title:    { x: 0.07, y: 0.45, fontSize: 96,  fontWeight: 'bold',   textAlign: 'left',   color: '#00f5e0',      shadowColor: 'rgba(0,245,224,0.9)',    shadowBlur: 40, strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.07, y: 0.62, fontSize: 34,  fontWeight: 'normal', textAlign: 'left',   color: '#ff38b0',      shadowColor: 'rgba(255,56,176,0.7)',   shadowBlur: 20 },
  },
  // ⑥ 番剧感 — 深紫底，白字粉光，居中，动漫/剧情内容
  {
    id: 'bili-anime',
    name: '番剧感',
    tag: 'B站',
    desc: '深紫底 · 白字粉光 · 居中',
    bgColor: '#0c0015', bgColorEnd: '#1e0035', lightBg: false,
    logo:     { x: 0.5,  y: 0.18, size: 0.12 },
    title:    { x: 0.5,  y: 0.52, fontSize: 90,  fontWeight: 'bold',   textAlign: 'center', color: '#ffffff',      shadowColor: 'rgba(255,100,200,0.85)', shadowBlur: 38, strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.5,  y: 0.67, fontSize: 30,  fontWeight: 'normal', textAlign: 'center', color: '#ff80c8',      shadowColor: 'rgba(255,80,180,0.6)',   shadowBlur: 16 },
  },
  // ⑦ 知识区 — 深海蓝，黄色左对齐标题，蓝色副标题，教程/知识/测评
  {
    id: 'bili-edu',
    name: '知识区',
    tag: 'B站',
    desc: '深海蓝 · 黄标题 · 蓝副标题',
    bgColor: '#010c1e', bgColorEnd: '#021a38', lightBg: false,
    logo:     { x: 0.1,  y: 0.14, size: 0.09 },
    title:    { x: 0.07, y: 0.43, fontSize: 94,  fontWeight: 'bold',   textAlign: 'left',   color: '#ffd740',      shadowColor: 'rgba(255,215,64,0.8)',   shadowBlur: 32, strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.07, y: 0.61, fontSize: 32,  fontWeight: 'normal', textAlign: 'left',   color: '#82b4ff',      shadowColor: 'rgba(100,160,255,0.6)',  shadowBlur: 14 },
  },
  // ⑧ 美食Vlog — 暖棕底，奶油黄居中，字上图下，生活/美食类
  {
    id: 'bili-vlog',
    name: '生活Vlog',
    tag: 'B站',
    desc: '暖棕底 · 奶油字 · 字上图下',
    bgColor: '#100804', bgColorEnd: '#201408', lightBg: false,
    logo:     { x: 0.5,  y: 0.68, size: 0.22 },
    title:    { x: 0.5,  y: 0.2,  fontSize: 86,  fontWeight: 'bold',   textAlign: 'center', color: '#ffe0a0',      shadowColor: 'rgba(255,180,60,0.75)',  shadowBlur: 30, strokeColor: '#000', strokeWidth: 0 },
    subtitle: { x: 0.5,  y: 0.34, fontSize: 32,  fontWeight: 'normal', textAlign: 'center', color: 'rgba(255,215,150,0.72)', shadowColor: 'rgba(180,100,20,0.5)',   shadowBlur: 10 },
  },
]

// SVG layout-mark helpers (used in swatch preview)
function tBarW(fontSize: number) { return Math.min(72, Math.max(28, fontSize / 2.2)) }
function tBarX(align: string, x: number, w: number) {
  if (align === 'left')  return Math.max(2, x * 100)
  if (align === 'right') return Math.min(98 - w, x * 100 - w)
  return Math.max(2, Math.min(98 - w, x * 100 - w / 2))
}

// ─── Config ─────────────────────────────────────────────────────────────────

const config = reactive<PosterConfig>({
  ratio: '16:9',
  bgType: 'color',
  bgFile: null,
  bgUrl: '',
  bgOverlayOpacity: 0.4,
  bgColor: '#0d0d1a',
  bgColorEnd: '#1a0d2e',
  bgVideoTime: 0,
  title: {
    text: '我的封面标题',
    fontSize: 96,
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#ffffff',
    x: 0.5,
    y: 0.45,
    textAlign: 'center',
    shadowColor: 'rgba(168,152,255,0.8)',
    shadowBlur: 30,
    strokeColor: '#000000',
    strokeWidth: 0,
  },
  subtitle: {
    text: 'Flika · 副标题',
    fontSize: 36,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: 'rgba(255,255,255,0.7)',
    x: 0.5,
    y: 0.6,
    textAlign: 'center',
    shadowColor: 'rgba(0,0,0,0.6)',
    shadowBlur: 10,
    strokeColor: '#000000',
    strokeWidth: 0,
  },
  logo: {
    file: null,
    url: '',
    size: 0.15,
    x: 0.5,
    y: 0.25,
    opacity: 1,
    rounded: false,
  },
})

// ─── Engine ──────────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)
const configRef = computed(() => config as PosterConfig)
const engine = usePosterEngine(canvasRef, configRef)

const canvasWidth = computed(() => RATIO_DIMS[config.ratio][0])
const canvasHeight = computed(() => RATIO_DIMS[config.ratio][1])
const canvasAspectRatio = computed(() => {
  const [w, h] = RATIO_DIMS[config.ratio]
  return `${w} / ${h}`
})

// Re-render when ratio changes (canvas resizes after nextTick)
watch(() => config.ratio, async () => {
  await nextTick()
  engine.renderPoster()
})

// Re-render on any config change
watch(
  () => [
    config.bgType, config.bgColor, config.bgColorEnd, config.bgOverlayOpacity,
    config.title.text, config.title.fontSize, config.title.fontWeight, config.title.fontStyle,
    config.title.color, config.title.x, config.title.y, config.title.textAlign,
    config.title.shadowColor, config.title.shadowBlur, config.title.strokeColor, config.title.strokeWidth,
    config.subtitle.text, config.subtitle.fontSize, config.subtitle.fontWeight, config.subtitle.fontStyle,
    config.subtitle.color, config.subtitle.x, config.subtitle.y, config.subtitle.textAlign,
    config.subtitle.shadowColor, config.subtitle.shadowBlur, config.subtitle.strokeColor, config.subtitle.strokeWidth,
    config.logo.size, config.logo.x, config.logo.y, config.logo.opacity, config.logo.rounded,
  ],
  () => engine.renderPoster(),
)

// Seek bg video and re-render when bgVideoTime changes
watch(() => config.bgVideoTime, async (t) => {
  await engine.seekBgVideoAsync(t)
  engine.renderPoster()
})

onMounted(() => {
  setTimeout(() => engine.renderPoster(), 50)
})

// ─── Logo upload ─────────────────────────────────────────────────────────────

async function handleLogoDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file && file.type.startsWith('image/')) await setLogoFile(file)
}
async function handleLogoInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) await setLogoFile(file)
}
async function setLogoFile(file: File) {
  if (config.logo.url) URL.revokeObjectURL(config.logo.url)
  config.logo.file = file
  config.logo.url = URL.createObjectURL(file)
  await engine.loadLogoImage(file)
  engine.renderPoster()
}
function clearLogo() {
  if (config.logo.url) URL.revokeObjectURL(config.logo.url)
  config.logo.file = null
  config.logo.url = ''
  engine.clearLogo()
  engine.renderPoster()
}

// ─── Bg media upload ─────────────────────────────────────────────────────────

async function handleBgDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (!file) return
  if (file.type.startsWith('image/')) await setBgFile(file, 'image')
  else if (file.type.startsWith('video/')) await setBgFile(file, 'video')
}
async function handleBgInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.type.startsWith('image/')) await setBgFile(file, 'image')
  else if (file.type.startsWith('video/')) await setBgFile(file, 'video')
}
async function setBgFile(file: File, type: 'image' | 'video') {
  clearBgFile()
  config.bgFile = file
  config.bgUrl = URL.createObjectURL(file)
  config.bgType = type
  config.bgVideoTime = 0
  await engine.loadBgMedia(file, type)
  engine.renderPoster()
}
function clearBgFile() {
  if (config.bgUrl) URL.revokeObjectURL(config.bgUrl)
  config.bgFile = null
  config.bgUrl = ''
  engine.clearBgMedia()
}
function switchBgType(type: 'color' | 'image' | 'video') {
  if (type === 'color') clearBgFile()
  else if (config.bgType !== type) clearBgFile()
  config.bgType = type
  engine.renderPoster()
}

// ─── Video bg duration ───────────────────────────────────────────────────────

const bgVideoDuration = computed(() => {
  if (engine.bgMedia.value instanceof HTMLVideoElement) {
    return engine.bgMedia.value.duration || 60
  }
  return 60
})

// ─── Export ───────────────────────────────────────────────────────────────────

const isExporting = ref<null | 'png' | 'jpeg'>(null)

// ─── Apply template ──────────────────────────────────────────────────────────

function applyTemplate(t: PosterTemplate) {
  config.bgType = 'color'
  config.bgColor = t.bgColor
  config.bgColorEnd = t.bgColorEnd
  Object.assign(config.title, t.title)
  Object.assign(config.subtitle, t.subtitle)
  Object.assign(config.logo, t.logo)
  engine.renderPoster()
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function handleExport(format: 'png' | 'jpeg') {
  if (isExporting.value) return
  isExporting.value = format
  try {
    const blob = format === 'png' ? await engine.exportPNG() : await engine.exportJPEG(0.92)
    await saveImageFile(blob, format)
  } catch (err) {
    console.error('导出失败', err)
  } finally {
    isExporting.value = null
  }
}
</script>

<template>
  <div class="poster-page">

    <!-- Preview column -->
    <div class="preview-col">
      <div class="canvas-wrapper">
        <div class="canvas-shell" :style="{ aspectRatio: canvasAspectRatio }">
          <canvas
            ref="canvasRef"
            :width="canvasWidth"
            :height="canvasHeight"
            class="preview-canvas"
          />
        </div>
      </div>

      <!-- Export bar -->
      <div class="export-bar">
        <button
          class="export-btn png"
          :disabled="!!isExporting"
          @click="handleExport('png')"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {{ isExporting === 'png' ? '导出中…' : '导出 PNG' }}
        </button>
        <button
          class="export-btn jpg"
          :disabled="!!isExporting"
          @click="handleExport('jpeg')"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {{ isExporting === 'jpeg' ? '导出中…' : '导出 JPG' }}
        </button>
        <span class="size-hint">{{ canvasWidth }} × {{ canvasHeight }}</span>
      </div>
    </div>

    <!-- Sidebar -->
    <div class="sidebar">

      <!-- Templates -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
          模版
        </div>
        <!-- group by tag -->
        <div v-for="group in [['小红书', 'xhs'], ['B站', 'bili']]" :key="group[0]">
          <div class="tpl-group-label">{{ group[0] }}</div>
          <div class="template-grid">
            <button
              v-for="t in TEMPLATES.filter(t => t.tag === group[0])"
              :key="t.id"
              class="template-swatch"
              :style="{ background: `linear-gradient(160deg, ${t.bgColor} 0%, ${t.bgColorEnd} 100%)` }"
              @click="applyTemplate(t)"
            >
              <!-- SVG layout diagram -->
              <svg class="swatch-diagram" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet">
                <!-- logo circle -->
                <circle
                  :cx="t.logo.x * 100"
                  :cy="t.logo.y * 60"
                  :r="Math.min(12, Math.max(3, t.logo.size * 18))"
                  fill="none"
                  :stroke="t.lightBg ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.35)'"
                  stroke-width="1.2"
                />
                <!-- title bar -->
                <rect
                  :x="tBarX(t.title.textAlign, t.title.x, tBarW(t.title.fontSize))"
                  :y="t.title.y * 60 - 2"
                  :width="tBarW(t.title.fontSize)"
                  height="3.5"
                  :fill="t.title.color"
                  opacity="0.85"
                  rx="1.5"
                />
                <!-- subtitle bar -->
                <rect
                  :x="tBarX(t.subtitle.textAlign, t.subtitle.x, tBarW(t.subtitle.fontSize) * 0.62)"
                  :y="t.subtitle.y * 60 - 1.2"
                  :width="tBarW(t.subtitle.fontSize) * 0.62"
                  height="2"
                  :fill="t.lightBg ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.45)'"
                  rx="1"
                />
              </svg>
              <!-- info bar -->
              <div class="swatch-info" :class="{ 'swatch-info--light': t.lightBg }">
                <span class="swatch-name" :style="{ color: t.lightBg ? t.title.color : t.title.color }">{{ t.name }}</span>
                <span class="swatch-desc">{{ t.desc }}</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div class="divider" />

      <!-- Ratio -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
          画布尺寸
        </div>
        <div class="ratio-row">
          <button
            v-for="r in (['16:9','9:16','1:1','4:3'] as PosterRatio[])"
            :key="r"
            class="ratio-btn"
            :class="{ active: config.ratio === r }"
            @click="config.ratio = r"
          >{{ r }}</button>
        </div>
      </div>

      <div class="divider" />

      <!-- Background -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          背景
        </div>

        <div class="bg-type-row">
          <button class="bg-type-btn" :class="{ active: config.bgType === 'color' }" @click="switchBgType('color')">纯色/渐变</button>
          <button class="bg-type-btn" :class="{ active: config.bgType === 'image' }" @click="switchBgType('image')">图片</button>
          <button class="bg-type-btn" :class="{ active: config.bgType === 'video' }" @click="switchBgType('video')">视频</button>
        </div>

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
            <div class="bg-preview-row">
              <img v-if="config.bgType === 'image'" :src="config.bgUrl" class="bg-thumb" />
              <video v-else :src="config.bgUrl" class="bg-thumb" muted />
              <span class="file-name">{{ config.bgFile.name }}</span>
              <button class="remove-btn" @click="clearBgFile(); config.bgType = 'color'">✕</button>
            </div>
            <!-- video frame picker -->
            <template v-if="config.bgType === 'video'">
              <label class="field-row">
                <span>帧位</span>
                <input
                  type="range"
                  v-model.number="config.bgVideoTime"
                  min="0"
                  :max="bgVideoDuration"
                  step="0.1"
                  class="range-input"
                />
                <span class="unit">{{ config.bgVideoTime.toFixed(1) }}s</span>
              </label>
            </template>
          </template>

          <label class="field-row">
            <span>暗化</span>
            <input type="range" v-model.number="config.bgOverlayOpacity" min="0" max="0.9" step="0.05" class="range-input" />
            <span class="unit">{{ Math.round(config.bgOverlayOpacity * 100) }}%</span>
          </label>
        </template>
      </div>

      <div class="divider" />

      <!-- Title -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 7 4 4 20 4 20 7"/>
            <line x1="9" y1="20" x2="15" y2="20"/>
            <line x1="12" y1="4" x2="12" y2="20"/>
          </svg>
          标题
        </div>

        <label class="field-row">
          <span>文字</span>
          <textarea v-model="config.title.text" class="text-area" rows="2" placeholder="标题文字（换行用 Enter）" />
        </label>
        <label class="field-row">
          <span>字号</span>
          <input type="number" v-model.number="config.title.fontSize" class="num-input" min="12" max="400" />
          <span class="unit">px</span>
        </label>
        <label class="field-row">
          <span>粗体</span>
          <input type="checkbox" :checked="config.title.fontWeight === 'bold'" @change="config.title.fontWeight = ($event.target as HTMLInputElement).checked ? 'bold' : 'normal'" />
          <span class="gap" />
          <span>斜体</span>
          <input type="checkbox" :checked="config.title.fontStyle === 'italic'" @change="config.title.fontStyle = ($event.target as HTMLInputElement).checked ? 'italic' : 'normal'" />
        </label>
        <label class="field-row">
          <span>颜色</span>
          <input type="color" v-model="config.title.color" class="color-input" />
          <span class="gap" />
          <span>对齐</span>
          <select v-model="config.title.textAlign" class="select-input sm">
            <option value="left">左</option>
            <option value="center">中</option>
            <option value="right">右</option>
          </select>
        </label>
        <label class="field-row">
          <span>水平</span>
          <input type="range" v-model.number="config.title.x" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <label class="field-row">
          <span>垂直</span>
          <input type="range" v-model.number="config.title.y" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <div class="sub-label">发光 / 阴影</div>
        <label class="field-row">
          <span>颜色</span>
          <input type="color" v-model="config.title.shadowColor" class="color-input" />
          <span class="gap" />
          <span>强度</span>
          <input type="number" v-model.number="config.title.shadowBlur" class="num-input" min="0" max="100" />
        </label>
        <div class="sub-label">描边</div>
        <label class="field-row">
          <span>颜色</span>
          <input type="color" v-model="config.title.strokeColor" class="color-input" />
          <span class="gap" />
          <span>宽度</span>
          <input type="number" v-model.number="config.title.strokeWidth" class="num-input" min="0" max="20" />
        </label>
      </div>

      <div class="divider" />

      <!-- Subtitle -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/>
            <line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/>
          </svg>
          副标题
        </div>

        <label class="field-row">
          <span>文字</span>
          <textarea v-model="config.subtitle.text" class="text-area" rows="2" placeholder="副标题（可留空）" />
        </label>
        <label class="field-row">
          <span>字号</span>
          <input type="number" v-model.number="config.subtitle.fontSize" class="num-input" min="8" max="200" />
          <span class="unit">px</span>
        </label>
        <label class="field-row">
          <span>颜色</span>
          <input type="color" v-model="config.subtitle.color" class="color-input" />
          <span class="gap" />
          <span>对齐</span>
          <select v-model="config.subtitle.textAlign" class="select-input sm">
            <option value="left">左</option>
            <option value="center">中</option>
            <option value="right">右</option>
          </select>
        </label>
        <label class="field-row">
          <span>垂直</span>
          <input type="range" v-model.number="config.subtitle.y" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <label class="field-row">
          <span>水平</span>
          <input type="range" v-model.number="config.subtitle.x" min="0" max="1" step="0.01" class="range-input" />
        </label>
        <div class="sub-label">发光 / 阴影</div>
        <label class="field-row">
          <span>颜色</span>
          <input type="color" v-model="config.subtitle.shadowColor" class="color-input" />
          <span class="gap" />
          <span>强度</span>
          <input type="number" v-model.number="config.subtitle.shadowBlur" class="num-input" min="0" max="100" />
        </label>
      </div>

      <div class="divider" />

      <!-- Logo -->
      <div class="sidebar-block">
        <div class="block-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          图片 / Logo
        </div>

        <div
          v-if="!config.logo.file"
          class="drop-zone"
          @dragover.prevent
          @drop="handleLogoDrop"
          @click="($refs.logoInput as HTMLInputElement).click()"
        >
          <span>拖入图片或点击选择</span>
          <input ref="logoInput" type="file" accept="image/*" style="display:none" @change="handleLogoInput" />
        </div>
        <div v-else class="logo-preview-row">
          <img :src="config.logo.url" class="logo-thumb" />
          <span class="file-name">{{ config.logo.file.name }}</span>
          <button class="remove-btn" @click="clearLogo">✕</button>
        </div>

        <label class="field-row">
          <span>大小</span>
          <input type="range" v-model.number="config.logo.size" min="0.03" max="0.8" step="0.01" class="range-input" />
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
          <span>透明</span>
          <input type="range" v-model.number="config.logo.opacity" min="0" max="1" step="0.05" class="range-input" />
          <span class="unit">{{ Math.round(config.logo.opacity * 100) }}%</span>
        </label>
        <label class="field-row">
          <span>圆形</span>
          <input type="checkbox" v-model="config.logo.rounded" />
        </label>
      </div>

    </div>
  </div>
</template>

<style scoped>
.poster-page {
  display: grid;
  grid-template-columns: 1fr 360px;
  height: 100%;
  overflow: hidden;
}

/* ── Preview ── */
.preview-col {
  display: flex;
  flex-direction: column;
  padding: 16px 16px 14px 20px;
  gap: 12px;
  overflow: hidden;
  min-height: 0;
}

.canvas-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.canvas-shell {
  max-width: 100%;
  max-height: 100%;
  background: #000;
  border-radius: var(--r-md, 8px);
  border: 1px solid var(--border);
  box-shadow: 0 4px 28px rgba(0,0,0,0.5);
  overflow: hidden;
}

.preview-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* ── Export bar ── */
.export-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.export-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 16px;
  border-radius: var(--r-sm, 6px);
  font-size: 12.5px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.export-btn.png { background: var(--accent, #a898ff); color: #fff; }
.export-btn.jpg { background: var(--teal, #40d9c0); color: #111; }
.export-btn:hover:not(:disabled) { opacity: 0.85; }
.export-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.size-hint {
  font-size: 11.5px;
  color: var(--text-4, #555);
  margin-left: 4px;
}

/* ── Sidebar ── */
.sidebar {
  border-left: 1px solid var(--border);
  overflow-y: auto;
  padding-bottom: 24px;
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

.sub-label {
  font-size: 11px;
  color: var(--text-4, #555);
  margin-top: 4px;
  padding-left: 2px;
}

.divider {
  height: 1px;
  background: var(--border);
}

/* ── Ratio selector ── */
.ratio-row {
  display: flex;
  gap: 4px;
}

.ratio-btn {
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
.ratio-btn:hover { color: var(--text-2, #bbb); background: var(--surface-3, #2a2a3a); }
.ratio-btn.active {
  color: #a898ff;
  background: var(--accent-dim, rgba(168,152,255,0.12));
  border-color: rgba(168,152,255,0.35);
}

/* ── Bg type toggle ── */
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

/* ── Fields ── */
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-2, #bbb);
  cursor: pointer;
}

.field-row > span:first-child {
  min-width: 38px;
  color: var(--text-3, #888);
  flex-shrink: 0;
}

.gap { flex: 1; }

.text-area {
  flex: 1;
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 4px);
  color: var(--text, #eee);
  padding: 5px 8px;
  font-size: 12.5px;
  resize: vertical;
  outline: none;
  font-family: inherit;
  line-height: 1.4;
}
.text-area:focus { border-color: rgba(168,152,255,0.5); }

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
.select-input.sm { flex: none; width: 50px; }

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
  min-width: 28px;
  text-align: right;
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
  border: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--surface-2, #1e1e2e);
}

.logo-preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.logo-thumb {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--surface-2, #1e1e2e);
  border: 1px solid var(--border);
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
  flex-shrink: 0;
}
.remove-btn:hover { color: var(--text, #eee); }

/* ── Templates ── */
.tpl-group-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-4, #555);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 8px 2px 5px;
}
.tpl-group-label:first-child { padding-top: 0; }

.template-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 4px;
}

.template-swatch {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 6px);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: hidden;
  transition: border-color 0.15s, transform 0.12s, box-shadow 0.15s;
  padding: 0;
  text-align: left;
}
.template-swatch:hover {
  border-color: rgba(168,152,255,0.45);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.template-swatch:active {
  transform: translateY(0);
}

.swatch-diagram {
  width: 100%;
  height: 70px;
  display: block;
  flex-shrink: 0;
}

.swatch-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px 7px;
  background: rgba(0,0,0,0.42);
  border-top: 1px solid rgba(255,255,255,0.07);
}
.swatch-info--light {
  background: rgba(255,255,255,0.62);
  border-top-color: rgba(0,0,0,0.1);
}
.swatch-info--light .swatch-desc {
  color: rgba(0,0,0,0.42);
}

.swatch-name {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.swatch-desc {
  font-size: 10px;
  color: rgba(255,255,255,0.38);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
