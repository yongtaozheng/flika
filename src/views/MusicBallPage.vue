<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useAudioPlayer } from '../composables/useAudioPlayer'
import { useBeatDetector } from '../composables/useBeatDetector'

// --- 类型 ---
interface Ball {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  glowColor: string
  keyIndex: number
  opacity: number
  trail: { x: number; y: number; opacity: number }[]
  landed: boolean
  bounceCount: number
  spawnTime: number
}

interface KeyHit {
  keyIndex: number
  color: string
  time: number
  strength: number
}

interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  color: string
  opacity: number
}

// --- 配置 ---
const TOTAL_WHITE_KEYS = 28
const BLACK_KEY_PATTERN = [1, 1, 0, 1, 1, 1, 0] // C#D# F#G#A#
const GRAVITY = 980
const BOUNCE_DAMPING = 0.45
const MAX_BOUNCES = 3
const BALL_COLORS = [
  { fill: '#ff6b9d', glow: 'rgba(255,107,157,0.6)' },
  { fill: '#c084fc', glow: 'rgba(192,132,252,0.6)' },
  { fill: '#60a5fa', glow: 'rgba(96,165,250,0.6)' },
  { fill: '#34d399', glow: 'rgba(52,211,153,0.6)' },
  { fill: '#fbbf24', glow: 'rgba(251,191,36,0.6)' },
  { fill: '#fb923c', glow: 'rgba(251,146,60,0.6)' },
  { fill: '#f472b6', glow: 'rgba(244,114,182,0.6)' },
  { fill: '#a78bfa', glow: 'rgba(167,139,250,0.6)' },
  { fill: '#38bdf8', glow: 'rgba(56,189,248,0.6)' },
  { fill: '#4ade80', glow: 'rgba(74,222,128,0.6)' },
  { fill: '#e879f9', glow: 'rgba(232,121,249,0.6)' },
  { fill: '#fb7185', glow: 'rgba(251,113,133,0.6)' },
]

// --- 状态 ---
const canvasRef = ref<HTMLCanvasElement | null>(null)
const audioFile = ref<File | null>(null)
const isDragging = ref(false)
const ballSpeed = ref(5)
const ballSize = ref(1)
const trailEnabled = ref(true)
const glowEnabled = ref(true)
const rippleEnabled = ref(true)
const autoMode = ref(false)  // 自动演示模式（无音乐）

// 动画状态
let balls: Ball[] = []
let keyHits: KeyHit[] = []
let ripples: Ripple[] = []
let nextBallId = 0
let animFrameId: number | null = null
let lastTimestamp = 0
let lastBeatIndex = -1
let autoModeTimer = 0

// --- Composables ---
const { isPlaying, currentTime, duration, loadAudio, togglePlay, stop } = useAudioPlayer()
const { beats, isAnalyzing, progress: analyzeProgress, bpm, analyzeBeats } = useBeatDetector()

// --- 钢琴键布局计算 ---
function getPianoLayout(canvasWidth: number, canvasHeight: number) {
  const pianoHeight = canvasHeight * 0.15
  const pianoTop = canvasHeight - pianoHeight
  const whiteKeyWidth = canvasWidth / TOTAL_WHITE_KEYS
  const blackKeyWidth = whiteKeyWidth * 0.6
  const blackKeyHeight = pianoHeight * 0.6

  const whiteKeys: { x: number; width: number; index: number }[] = []
  const blackKeys: { x: number; width: number; index: number }[] = []

  for (let i = 0; i < TOTAL_WHITE_KEYS; i++) {
    whiteKeys.push({
      x: i * whiteKeyWidth,
      width: whiteKeyWidth,
      index: i,
    })
  }

  let whiteIndex = 0
  for (let octave = 0; octave < 4; octave++) {
    for (let j = 0; j < BLACK_KEY_PATTERN.length && whiteIndex < TOTAL_WHITE_KEYS - 1; j++) {
      if (BLACK_KEY_PATTERN[j]) {
        blackKeys.push({
          x: (whiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2,
          width: blackKeyWidth,
          index: blackKeys.length,
        })
      }
      whiteIndex++
    }
  }

  return { pianoHeight, pianoTop, whiteKeys, blackKeys, whiteKeyWidth, blackKeyWidth, blackKeyHeight }
}

// --- 音频处理 ---
function handleAudioDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files?.length) {
    const file = files[0]
    if (file.type.startsWith('audio/')) {
      handleAudioFile(file)
    }
  }
}

async function handleAudioFile(file: File) {
  audioFile.value = file
  loadAudio(file)
  try {
    await analyzeBeats(file, 0.5)
  } catch (e) {
    console.error('Beat analysis failed', e)
  }
}

function handleAudioSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleAudioFile(file)
}

// --- 生成小球 ---
function spawnBall(canvas: HTMLCanvasElement, strength: number = 0.7) {
  const layout = getPianoLayout(canvas.width, canvas.height)
  const keyIndex = Math.floor(Math.random() * TOTAL_WHITE_KEYS)
  const colorIdx = Math.floor(Math.random() * BALL_COLORS.length)
  const color = BALL_COLORS[colorIdx]

  const whiteKey = layout.whiteKeys[keyIndex]
  const targetX = whiteKey.x + whiteKey.width / 2

  const baseRadius = 8 + strength * 8
  const radius = baseRadius * ballSize.value

  // 从顶部落下，有少量水平偏移
  const ball: Ball = {
    id: nextBallId++,
    x: targetX + (Math.random() - 0.5) * 10,
    y: -radius * 2,
    vx: (Math.random() - 0.5) * 30,
    vy: 60 + Math.random() * 40 + strength * ballSpeed.value * 40,
    radius,
    color: color.fill,
    glowColor: color.glow,
    keyIndex,
    opacity: 1,
    trail: [],
    landed: false,
    bounceCount: 0,
    spawnTime: performance.now(),
  }

  balls.push(ball)
}

// 批量生成（节拍强度越大，生成越多）
function spawnBallsForBeat(canvas: HTMLCanvasElement, strength: number) {
  const count = Math.max(1, Math.round(strength * 3))
  for (let i = 0; i < count; i++) {
    setTimeout(() => spawnBall(canvas, strength), i * 40)
  }
}

// --- 碰撞检测和物理更新 ---
function updateBalls(delta: number, canvas: HTMLCanvasElement) {
  const layout = getPianoLayout(canvas.width, canvas.height)
  const groundY = layout.pianoTop

  for (let i = balls.length - 1; i >= 0; i--) {
    const ball = balls[i]

    // 记录轨迹
    if (trailEnabled.value && !ball.landed) {
      ball.trail.push({ x: ball.x, y: ball.y, opacity: 1 })
      if (ball.trail.length > 20) ball.trail.shift()
    }

    // 物理更新
    ball.vy += GRAVITY * delta
    ball.x += ball.vx * delta
    ball.y += ball.vy * delta

    // 碰撞钢琴顶部
    if (ball.y + ball.radius >= groundY && ball.vy > 0) {
      ball.y = groundY - ball.radius
      ball.vy = -Math.abs(ball.vy) * BOUNCE_DAMPING
      ball.vx *= 0.8
      ball.bounceCount++

      // 触发琴键亮起
      const hitKeyIndex = Math.floor(ball.x / (canvas.width / TOTAL_WHITE_KEYS))
      if (hitKeyIndex >= 0 && hitKeyIndex < TOTAL_WHITE_KEYS) {
        keyHits.push({
          keyIndex: hitKeyIndex,
          color: ball.color,
          time: performance.now(),
          strength: Math.min(1, Math.abs(ball.vy) / 300),
        })
      }

      // 涟漪效果
      if (rippleEnabled.value && ball.bounceCount <= 1) {
        ripples.push({
          x: ball.x,
          y: groundY,
          radius: 0,
          maxRadius: 40 + ball.radius * 3,
          color: ball.glowColor,
          opacity: 0.7,
        })
      }

      if (ball.bounceCount >= MAX_BOUNCES) {
        ball.landed = true
      }
    }

    // 淡出已着陆的球
    if (ball.landed) {
      ball.opacity -= delta * 2
    }

    // 轨迹淡出
    for (const t of ball.trail) {
      t.opacity -= delta * 3
    }
    ball.trail = ball.trail.filter(t => t.opacity > 0)

    // 移除不可见的球
    if (ball.opacity <= 0 || ball.y > canvas.height + 100) {
      balls.splice(i, 1)
    }
  }
}

function updateRipples(delta: number) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i]
    r.radius += delta * 200
    r.opacity -= delta * 2
    if (r.opacity <= 0 || r.radius >= r.maxRadius) {
      ripples.splice(i, 1)
    }
  }
}

// --- 绘制 ---
function drawScene(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  const width = canvas.width
  const height = canvas.height
  const layout = getPianoLayout(width, height)

  // 清除画布
  ctx.clearRect(0, 0, width, height)

  // 背景渐变
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height)
  bgGrad.addColorStop(0, '#0a0a1a')
  bgGrad.addColorStop(0.7, '#0d0d20')
  bgGrad.addColorStop(1, '#111128')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, width, height)

  // 背景网格（微弱）
  ctx.strokeStyle = 'rgba(100,108,255,0.03)'
  ctx.lineWidth = 1
  const gridSize = 40
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, layout.pianoTop)
    ctx.stroke()
  }
  for (let y = 0; y < layout.pianoTop; y += gridSize) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  // 绘制轨迹
  if (trailEnabled.value) {
    for (const ball of balls) {
      if (ball.trail.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(ball.trail[0].x, ball.trail[0].y)
      for (let i = 1; i < ball.trail.length; i++) {
        ctx.lineTo(ball.trail[i].x, ball.trail[i].y)
      }
      ctx.strokeStyle = ball.glowColor.replace(/[\d.]+\)$/, `${ball.opacity * 0.4})`)
      ctx.lineWidth = ball.radius * 0.6
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
  }

  // 绘制涟漪
  for (const r of ripples) {
    ctx.beginPath()
    ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2)
    ctx.strokeStyle = r.color.replace(/[\d.]+\)$/, `${r.opacity})`)
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // 绘制小球
  for (const ball of balls) {
    ctx.save()
    ctx.globalAlpha = ball.opacity

    // 发光效果
    if (glowEnabled.value) {
      ctx.shadowColor = ball.color
      ctx.shadowBlur = ball.radius * 2
    }

    // 球体
    const grad = ctx.createRadialGradient(
      ball.x - ball.radius * 0.3,
      ball.y - ball.radius * 0.3,
      ball.radius * 0.1,
      ball.x,
      ball.y,
      ball.radius
    )
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.3, ball.color)
    grad.addColorStop(1, ball.color.replace(')', ',0.6)').replace('rgb', 'rgba'))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
    ctx.fill()

    // 高光
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    const hlGrad = ctx.createRadialGradient(
      ball.x - ball.radius * 0.25,
      ball.y - ball.radius * 0.25,
      0,
      ball.x - ball.radius * 0.25,
      ball.y - ball.radius * 0.25,
      ball.radius * 0.5
    )
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.6)')
    hlGrad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = hlGrad
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  // 钢琴 — 白键
  const now = performance.now()
  for (const wk of layout.whiteKeys) {
    // 检查是否被击中
    const hit = keyHits.find(
      h => h.keyIndex === wk.index && now - h.time < 300
    )

    ctx.fillStyle = hit
      ? blendKeyColor('#e8e8e8', hit.color, Math.max(0, 1 - (now - hit.time) / 300))
      : '#e8e8e8'
    ctx.fillRect(wk.x + 1, layout.pianoTop, wk.width - 2, layout.pianoHeight)

    // 键边框
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(wk.x + 1, layout.pianoTop, wk.width - 2, layout.pianoHeight)

    // 键底阴影
    const shadowGrad = ctx.createLinearGradient(0, layout.pianoTop + layout.pianoHeight - 10, 0, layout.pianoTop + layout.pianoHeight)
    shadowGrad.addColorStop(0, 'rgba(0,0,0,0)')
    shadowGrad.addColorStop(1, 'rgba(0,0,0,0.1)')
    ctx.fillStyle = shadowGrad
    ctx.fillRect(wk.x + 1, layout.pianoTop + layout.pianoHeight - 10, wk.width - 2, 10)

    // 发光效果
    if (hit && glowEnabled.value) {
      const glowOpacity = Math.max(0, 1 - (now - hit.time) / 300) * hit.strength
      ctx.fillStyle = hit.color.replace(')', `,${glowOpacity * 0.3})`).replace('#', '')
      // 使用 hex 转 rgba
      const r = parseInt(hit.color.slice(1, 3), 16)
      const g = parseInt(hit.color.slice(3, 5), 16)
      const b = parseInt(hit.color.slice(5, 7), 16)
      ctx.fillStyle = `rgba(${r},${g},${b},${glowOpacity * 0.3})`
      ctx.fillRect(wk.x + 1, layout.pianoTop, wk.width - 2, layout.pianoHeight)

      // 键顶光晕
      const topGlow = ctx.createLinearGradient(0, layout.pianoTop - 20, 0, layout.pianoTop + 10)
      topGlow.addColorStop(0, `rgba(${r},${g},${b},0)`)
      topGlow.addColorStop(1, `rgba(${r},${g},${b},${glowOpacity * 0.5})`)
      ctx.fillStyle = topGlow
      ctx.fillRect(wk.x + 1, layout.pianoTop - 20, wk.width - 2, 30)
    }
  }

  // 钢琴 — 黑键
  for (const bk of layout.blackKeys) {
    const grad = ctx.createLinearGradient(0, layout.pianoTop, 0, layout.pianoTop + layout.blackKeyHeight)
    grad.addColorStop(0, '#2a2a2a')
    grad.addColorStop(0.8, '#1a1a1a')
    grad.addColorStop(1, '#111')
    ctx.fillStyle = grad
    ctx.fillRect(bk.x, layout.pianoTop, bk.width, layout.blackKeyHeight)

    // 高光
    const hlGrad = ctx.createLinearGradient(0, layout.pianoTop, 0, layout.pianoTop + layout.blackKeyHeight * 0.3)
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.08)')
    hlGrad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = hlGrad
    ctx.fillRect(bk.x, layout.pianoTop, bk.width, layout.blackKeyHeight * 0.3)
  }

  // 钢琴顶部分界线
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, layout.pianoTop)
  ctx.lineTo(width, layout.pianoTop)
  ctx.stroke()

  // 清理过期的击键
  keyHits = keyHits.filter(h => now - h.time < 500)
}

// 颜色混合辅助
function blendKeyColor(baseHex: string, hitHex: string, t: number): string {
  const br = parseInt(baseHex.slice(1, 3), 16)
  const bg = parseInt(baseHex.slice(3, 5), 16)
  const bb = parseInt(baseHex.slice(5, 7), 16)
  const hr = parseInt(hitHex.slice(1, 3), 16)
  const hg = parseInt(hitHex.slice(3, 5), 16)
  const hb = parseInt(hitHex.slice(5, 7), 16)
  const r = Math.round(br + (hr - br) * t * 0.5)
  const g = Math.round(bg + (hg - bg) * t * 0.5)
  const b = Math.round(bb + (hb - bb) * t * 0.5)
  return `rgb(${r},${g},${b})`
}

// --- 主动画循环 ---
function animationLoop(timestamp: number) {
  const canvas = canvasRef.value
  if (!canvas) {
    animFrameId = requestAnimationFrame(animationLoop)
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    animFrameId = requestAnimationFrame(animationLoop)
    return
  }

  // 确保 canvas 尺寸
  const container = canvas.parentElement
  if (container) {
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.floor(rect.width * dpr)
    const h = Math.floor(rect.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'
      ctx.scale(dpr, dpr)
    }
  }

  if (!lastTimestamp) lastTimestamp = timestamp
  const rawDelta = (timestamp - lastTimestamp) / 1000
  const delta = Math.min(rawDelta, 0.05) // 限制最大 delta 防止跳帧
  lastTimestamp = timestamp

  // 节拍触发小球
  if (isPlaying.value && beats.value.length > 0) {
    const time = currentTime.value
    for (let i = 0; i < beats.value.length; i++) {
      const beat = beats.value[i]
      const diff = time - beat.time
      if (diff >= 0 && diff < 0.08 && i > lastBeatIndex) {
        spawnBallsForBeat(canvas, beat.strength)
        lastBeatIndex = i
        break
      }
    }
  }

  // 自动演示模式
  if (autoMode.value && !isPlaying.value) {
    autoModeTimer += delta
    if (autoModeTimer > 0.3 + Math.random() * 0.3) {
      autoModeTimer = 0
      spawnBall(canvas, 0.3 + Math.random() * 0.7)
    }
  }

  // 更新物理
  // 使用 CSS 像素坐标（非设备像素）
  const dpr = window.devicePixelRatio || 1
  const cssCanvas = {
    width: canvas.width / dpr,
    height: canvas.height / dpr,
  } as HTMLCanvasElement
  // 用一个临时对象适配 getPianoLayout
  Object.defineProperty(cssCanvas, 'parentElement', { value: canvas.parentElement })
  updateBalls(delta, cssCanvas)
  updateRipples(delta)

  // 恢复缩放后绘制
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const dprCurrent = window.devicePixelRatio || 1
  ctx.scale(dprCurrent, dprCurrent)
  drawScene(ctx, cssCanvas)
  ctx.restore()

  animFrameId = requestAnimationFrame(animationLoop)
}

// 播放/停止时重置
watch(isPlaying, (playing) => {
  if (playing) {
    lastBeatIndex = -1
  }
})

function handleStop() {
  stop()
  balls = []
  keyHits = []
  ripples = []
  lastBeatIndex = -1
}

// --- 生命周期 ---
onMounted(() => {
  animFrameId = requestAnimationFrame(animationLoop)
})

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
})

// --- 计算 ---
const beatCount = computed(() => beats.value.length)
const formattedTime = computed(() => {
  const cur = Math.floor(currentTime.value)
  const dur = Math.floor(duration.value)
  const cm = Math.floor(cur / 60)
  const cs = (cur % 60).toString().padStart(2, '0')
  const dm = Math.floor(dur / 60)
  const ds = (dur % 60).toString().padStart(2, '0')
  return `${cm}:${cs} / ${dm}:${ds}`
})
</script>

<template>
  <div class="music-ball-page">
    <!-- Canvas 区域 -->
    <div class="canvas-area">
      <div class="canvas-wrapper" ref="canvasWrapper">
        <canvas ref="canvasRef"></canvas>

        <!-- 播放覆盖层 -->
        <div
          v-if="!isPlaying && !autoMode && audioFile"
          class="play-overlay"
          @click="togglePlay"
        >
          <div class="play-btn-big">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span class="play-hint">点击播放</span>
        </div>

        <!-- 空状态 -->
        <div v-if="!audioFile && !autoMode" class="empty-overlay">
          <div class="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </div>
          <p class="empty-text">上传音乐，小球随节拍跳动 🎵</p>
          <p class="empty-hint">或开启「自动演示」模式体验效果</p>
        </div>

        <!-- 信息条 -->
        <div class="info-bar" v-if="audioFile || autoMode">
          <div class="info-item" v-if="bpm > 0">
            <span class="info-label">BPM</span>
            <span class="info-val">{{ bpm }}</span>
          </div>
          <div class="info-item" v-if="beatCount > 0">
            <span class="info-label">节拍</span>
            <span class="info-val">{{ beatCount }}</span>
          </div>
          <div class="info-item" v-if="duration > 0">
            <span class="info-label">时间</span>
            <span class="info-val">{{ formattedTime }}</span>
          </div>
          <div class="info-item" v-if="autoMode">
            <span class="info-val auto-badge">自动演示中</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 侧边控制面板 -->
    <aside class="side-panel">
      <div class="panel-inner">
        <h2 class="panel-title">
          <span>🎵</span>
          <span>音乐小球</span>
        </h2>
        <p class="panel-desc">小球随节拍在琴键上跳动</p>

        <!-- 音频上传 -->
        <div class="ctrl-group">
          <label class="ctrl-label">音乐文件</label>
          <div
            class="upload-zone"
            :class="{ 'drag-over': isDragging, 'has-file': !!audioFile }"
            @dragover.prevent="isDragging = true"
            @dragleave="isDragging = false"
            @drop="handleAudioDrop"
          >
            <template v-if="isAnalyzing">
              <div class="analyzing">
                <div class="analyze-spinner"></div>
                <span>分析中 {{ analyzeProgress }}%</span>
              </div>
            </template>
            <template v-else-if="audioFile">
              <span class="file-name">🎶 {{ audioFile.name }}</span>
            </template>
            <template v-else>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>拖放或点击上传音频</span>
            </template>
            <input
              type="file"
              accept="audio/*"
              class="file-input"
              @change="handleAudioSelect"
            />
          </div>
        </div>

        <!-- 播放控制 -->
        <div class="ctrl-group" v-if="audioFile">
          <label class="ctrl-label">播放控制</label>
          <div class="btn-row">
            <button class="ctrl-btn primary" @click="togglePlay">
              {{ isPlaying ? '⏸ 暂停' : '▶ 播放' }}
            </button>
            <button class="ctrl-btn" @click="handleStop">
              ⏹ 停止
            </button>
          </div>
          <!-- 进度条 -->
          <div class="progress-track" v-if="duration > 0">
            <div
              class="progress-fill"
              :style="{ width: (currentTime / duration * 100) + '%' }"
            ></div>
          </div>
        </div>

        <!-- 自动演示 -->
        <div class="ctrl-group">
          <label class="ctrl-label">演示模式</label>
          <label class="toggle-row">
            <input type="checkbox" v-model="autoMode" />
            <span class="toggle-text">自动演示（无需音乐）</span>
          </label>
        </div>

        <!-- 效果设置 -->
        <div class="ctrl-group">
          <label class="ctrl-label">
            小球速度
            <span class="ctrl-val">{{ ballSpeed.toFixed(1) }}</span>
          </label>
          <input type="range" class="slider" v-model.number="ballSpeed" min="1" max="10" step="0.5" />
        </div>

        <div class="ctrl-group">
          <label class="ctrl-label">
            小球大小
            <span class="ctrl-val">{{ ballSize.toFixed(1) }}x</span>
          </label>
          <input type="range" class="slider" v-model.number="ballSize" min="0.5" max="2" step="0.1" />
        </div>

        <!-- 视觉效果开关 -->
        <div class="ctrl-group">
          <label class="ctrl-label">视觉效果</label>
          <div class="toggle-list">
            <label class="toggle-row">
              <input type="checkbox" v-model="trailEnabled" />
              <span class="toggle-text">轨迹拖尾</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" v-model="glowEnabled" />
              <span class="toggle-text">发光效果</span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" v-model="rippleEnabled" />
              <span class="toggle-text">碰撞涟漪</span>
            </label>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* 页面布局 */
.music-ball-page {
  display: grid;
  grid-template-columns: 1fr 280px;
  min-height: calc(100vh - 80px);
  gap: 0;
}

/* Canvas 区域 */
.canvas-area {
  position: relative;
  overflow: hidden;
  background: #0a0a1a;
}

.canvas-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 500px;
}

.canvas-wrapper canvas {
  display: block;
  position: absolute;
  top: 0;
  left: 0;
}

/* 播放覆盖 */
.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  z-index: 10;
  transition: background 0.2s;
}

.play-overlay:hover {
  background: rgba(0, 0, 0, 0.2);
}

.play-btn-big {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(100, 108, 255, 0.25);
  border: 2px solid rgba(100, 108, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.play-overlay:hover .play-btn-big {
  background: rgba(100, 108, 255, 0.35);
  transform: scale(1.05);
}

.play-hint {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
}

/* 空状态 */
.empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 5;
}

.empty-icon {
  opacity: 0.6;
  animation: pulse-slow 3s ease-in-out infinite;
}

@keyframes pulse-slow {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.05); opacity: 0.8; }
}

.empty-text {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
}

.empty-hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.2);
  margin: 0;
}

/* 信息条 */
.info-bar {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 16px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  z-index: 10;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.info-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 500;
}

.info-val {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  font-family: var(--mono);
}

.auto-badge {
  color: rgba(100, 255, 150, 0.8);
  font-size: 12px;
}

/* 侧边面板 */
.side-panel {
  background: rgba(15, 15, 25, 0.98);
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
}

.panel-inner {
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-title {
  font-size: 20px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
  margin: -12px 0 0;
}

/* 控制组 */
.ctrl-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ctrl-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ctrl-val {
  font-family: var(--mono);
  color: rgba(100, 108, 255, 0.8);
}

/* 上传区域 */
.upload-zone {
  position: relative;
  border: 1.5px dashed rgba(100, 108, 255, 0.2);
  border-radius: 10px;
  padding: 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}

.upload-zone:hover {
  border-color: rgba(100, 108, 255, 0.4);
  background: rgba(100, 108, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
}

.upload-zone.drag-over {
  border-color: rgba(100, 108, 255, 0.6);
  background: rgba(100, 108, 255, 0.08);
}

.upload-zone.has-file {
  border-style: solid;
  border-color: rgba(100, 108, 255, 0.15);
  background: rgba(100, 108, 255, 0.04);
}

.file-name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  word-break: break-all;
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* 分析中 */
.analyzing {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(100, 108, 255, 0.8);
  font-size: 13px;
}

.analyze-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(100, 108, 255, 0.2);
  border-top-color: rgba(100, 108, 255, 0.8);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 按钮 */
.btn-row {
  display: flex;
  gap: 8px;
}

.ctrl-btn {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.ctrl-btn.primary {
  background: rgba(100, 108, 255, 0.15);
  border-color: rgba(100, 108, 255, 0.3);
  color: rgba(200, 205, 255, 0.9);
}

.ctrl-btn.primary:hover {
  background: rgba(100, 108, 255, 0.25);
}

/* 进度条 */
.progress-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #646cff, #a78bfa);
  border-radius: 2px;
  transition: width 0.1s linear;
}

/* 滑块 */
.slider {
  width: 100%;
  height: 4px;
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #646cff;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.15);
}

/* 开关列表 */
.toggle-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
}

.toggle-row input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #646cff;
}

.toggle-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

/* 响应式 */
@media (max-width: 900px) {
  .music-ball-page {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr auto;
  }

  .canvas-wrapper {
    min-height: 400px;
  }

  .side-panel {
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
}

@media (max-width: 600px) {
  .canvas-wrapper {
    min-height: 320px;
  }

  .panel-inner {
    padding: 16px 14px;
    gap: 14px;
  }
}
</style>
