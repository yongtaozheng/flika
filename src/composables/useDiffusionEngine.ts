import { type Ref, onUnmounted } from 'vue'
import type { Beat, DiffusionImage, DiffusionConfig } from '../types'
import {
  smoothstep,
  toGrayscale,
  computeDistanceField,
  getManualTotalDuration as _getManualTotalDuration,
  getBeatTotalDuration as _getBeatTotalDuration,
  resolveManual as _resolveManual,
  resolveBeatSync as _resolveBeatSync,
  WAVE_COUNT,
  WAVE_WIDTH,
  WAVE_AMPLITUDE,
  WAVE_ZONE,
  type PrecomputedImageData,
  type ResolvedSlot,
} from '../utils/diffusionRenderer'
import { createWorkerExport, type WorkerExportHandle } from './useDiffusionWorkerExport'
import { canvasBg } from './useTheme'

/* ── Pre-computed data per image (internal, with DOM refs stripped) ──── */
interface PrecomputedData {
  originalData: Uint8ClampedArray
  grayscaleData: Uint8ClampedArray
  distanceField: Float32Array
  cosAngle: Float32Array
  sinAngle: Float32Array
  maxDist: number
  width: number
  height: number
}

/* ── Draw image with cover mode ──────────────────────────────────────── */
function drawCover(
  ctx: CanvasRenderingContext2D,
  el: HTMLImageElement,
  cw: number,
  ch: number,
) {
  ctx.fillStyle = canvasBg.value
  ctx.fillRect(0, 0, cw, ch)
  const sw = el.naturalWidth
  const sh = el.naturalHeight
  if (!sw || !sh) return
  const scale = Math.max(cw / sw, ch / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(el, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
}

/* ── Bouncing ball constants ────────────────────────────────────────── */
const BOUNCE_DURATION = 500          // ms — 弹跳动画时长
const BALL_RADIUS = 12               // px — 小球半径
const BOUNCE_HEIGHT_RATIO = 0.40     // 弹跳高度 = 两点距离 × 此比率
const BOUNCE_HEIGHT_MIN = 0.10       // 最小弹跳高度（归一化）
const LANDING_RIPPLE_DURATION = 400  // ms — 落地波纹持续时间
const LANDING_RIPPLE_MAX_R = 40      // px — 落地波纹最大半径

interface BallState {
  /** 上一帧的图片索引 */
  prevImageIndex: number
  /** 弹跳起点（归一化坐标） */
  fromX: number; fromY: number
  /** 弹跳终点（归一化坐标） */
  toX: number; toY: number
  /** 弹跳动画开始时间 (ms) */
  bounceStartMs: number
  /** 本次弹跳的实际时长 (ms) */
  bounceDuration: number
  /** 是否正在弹跳 */
  isBouncing: boolean
  /** 落地波纹开始时间 (ms)，-1 = 无 */
  landingRippleStart: number
  /** 落地波纹位置（像素） */
  landingX: number; landingY: number
  /** 哪张图片触发了弹跳（防止重复触发），-1 = 无 */
  bounceTriggerImage: number
}

/** 获取图片的第一个扩散点坐标（归一化），无点则用画面中心 */
function getFirstPoint(images: DiffusionImage[], index: number): { x: number; y: number } {
  const img = images[index]
  if (img && img.points.length > 0) return { x: img.points[0].x, y: img.points[0].y }
  return { x: 0.5, y: 0.5 }
}

/** 绘制弹跳小球 overlay（在 putImageData 之后调用） */
function drawBouncingBall(
  ctx: CanvasRenderingContext2D,
  ball: BallState,
  elapsedMs: number,
  imageIndex: number,
  images: DiffusionImage[],
  width: number,
  height: number,
): void {
  // 当前停留点
  const restPt = getFirstPoint(images, imageIndex)
  let bx: number, by: number
  let scaleX = 1, scaleY = 1

  if (ball.isBouncing) {
    const raw = (elapsedMs - ball.bounceStartMs) / ball.bounceDuration
    const t = Math.max(0, Math.min(1, raw))

    // 线性插值 X/Y
    bx = ball.fromX + (ball.toX - ball.fromX) * t
    by = ball.fromY + (ball.toY - ball.fromY) * t

    // 抛物线弧线
    const dx = ball.toX - ball.fromX
    const dy = ball.toY - ball.fromY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const bounceH = Math.max(BOUNCE_HEIGHT_MIN, dist * BOUNCE_HEIGHT_RATIO)
    const arc = -bounceH * 4 * t * (1 - t)
    by += arc

    // 挤压/拉伸
    const speed = Math.abs(2 * t - 1) // 0=中间最快, 1=端点
    if (t < 0.15) {
      // 起跳挤压
      const s = t / 0.15
      scaleX = 1 + 0.2 * (1 - s)
      scaleY = 1 - 0.2 * (1 - s)
    } else if (t > 0.85) {
      // 落地挤压
      const s = (t - 0.85) / 0.15
      scaleX = 1 + 0.2 * s
      scaleY = 1 - 0.2 * s
    } else {
      // 空中拉伸
      scaleX = 1 - 0.15 * (1 - speed)
      scaleY = 1 + 0.15 * (1 - speed)
    }

    // 弹跳结束
    if (raw >= 1) {
      ball.isBouncing = false
      ball.landingRippleStart = elapsedMs
      ball.landingX = ball.toX * width
      ball.landingY = ball.toY * height
    }
  } else {
    if (ball.bounceTriggerImage >= 0) {
      // 弹跳已完成（停留阶段），停在目标点（下一张图的扩散中心）
      bx = ball.toX
      by = ball.toY
    } else {
      // 正常停留在当前图片的扩散中心
      bx = restPt.x
      by = restPt.y
    }
    // 静止时微弱浮动呼吸
    const breath = Math.sin(elapsedMs / 600) * 0.003
    by += breath
  }

  const px = bx * width
  const py = by * height

  // ── 落地波纹
  if (ball.landingRippleStart >= 0) {
    const rt = (elapsedMs - ball.landingRippleStart) / LANDING_RIPPLE_DURATION
    if (rt >= 0 && rt < 1) {
      const rippleR = BALL_RADIUS + (LANDING_RIPPLE_MAX_R - BALL_RADIUS) * rt
      const rippleAlpha = 0.5 * (1 - rt)
      ctx.save()
      ctx.beginPath()
      ctx.arc(ball.landingX, ball.landingY, rippleR, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(120, 180, 255, ${rippleAlpha})`
      ctx.lineWidth = 2 * (1 - rt)
      ctx.stroke()
      ctx.restore()
    } else if (rt >= 1) {
      ball.landingRippleStart = -1
    }
  }

  // ── 小球本体
  ctx.save()
  ctx.translate(px, py)
  ctx.scale(scaleX, scaleY)

  // 发光
  ctx.shadowColor = 'rgba(100, 160, 255, 0.6)'
  ctx.shadowBlur = 16

  // 径向渐变
  const grad = ctx.createRadialGradient(0, -2, 0, 0, 0, BALL_RADIUS)
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
  grad.addColorStop(0.4, 'rgba(180, 210, 255, 0.85)')
  grad.addColorStop(1, 'rgba(100, 160, 255, 0.6)')

  ctx.beginPath()
  ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()

  // 高光点
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.arc(-3, -4, 3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fill()

  ctx.restore()
}

/* ═══════════════════════════════════════════════════════════════════════ */
export function useDiffusionEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<DiffusionImage[]>,
  configRef: Ref<DiffusionConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()

  let offscreen: HTMLCanvasElement | null = null
  let offCtx: CanvasRenderingContext2D | null = null

  /** 当前活跃的 Worker 导出器（用于取消） */
  let activeExportHandle: WorkerExportHandle | null = null

  /* ── Bouncing ball state ─────────────────────────────────────────── */
  const ballState: BallState = {
    prevImageIndex: -1,
    fromX: 0.5, fromY: 0.5,
    toX: 0.5, toY: 0.5,
    bounceStartMs: 0,
    bounceDuration: BOUNCE_DURATION,
    isBouncing: false,
    landingRippleStart: -1,
    landingX: 0, landingY: 0,
    bounceTriggerImage: -1,
  }

  function resetBallState() {
    ballState.prevImageIndex = -1
    ballState.isBouncing = false
    ballState.landingRippleStart = -1
    ballState.bounceTriggerImage = -1
  }

  function ensureOffscreen(w: number, h: number) {
    if (!offscreen) {
      offscreen = document.createElement('canvas')
      offCtx = offscreen.getContext('2d', { willReadFrequently: true })!
    }
    if (offscreen.width !== w || offscreen.height !== h) {
      offscreen.width = w
      offscreen.height = h
    }
  }

  /* ── Image element loading ─────────────────────────────────────── */
  function loadImageElement(img: DiffusionImage): Promise<HTMLImageElement> {
    const existing = imageCache.get(img.id)
    if (existing && existing.complete && existing.naturalWidth > 0) {
      return Promise.resolve(existing)
    }
    return new Promise((resolve) => {
      const el = new Image()
      el.onload = () => {
        imageCache.set(img.id, el)
        resolve(el)
      }
      el.onerror = () => resolve(el)
      el.src = img.url
    })
  }

  async function preloadImages(): Promise<void> {
    await Promise.all(imagesRef.value.map((img) => loadImageElement(img)))
  }

  /* ── Pre-compute for a single image ────────────────────────────── */
  function precomputeImage(image: DiffusionImage): void {
    const el = imageCache.get(image.id)
    if (!el || !el.complete || !el.naturalWidth) return

    const CW = canvasRef.value?.width ?? 1280
    const CH = canvasRef.value?.height ?? 720

    ensureOffscreen(CW, CH)
    drawCover(offCtx!, el, CW, CH)

    const originalData = offCtx!.getImageData(0, 0, CW, CH).data
    const grayscaleData = toGrayscale(originalData)

    let distanceField: Float32Array
    let cosAngle: Float32Array
    let sinAngle: Float32Array
    let maxDist: number

    if (image.points.length > 0) {
      const result = computeDistanceField(CW, CH, image.points)
      distanceField = result.field
      cosAngle = result.cosAngle
      sinAngle = result.sinAngle
      maxDist = result.maxDist
    } else {
      distanceField = new Float32Array(CW * CH).fill(Infinity)
      cosAngle = new Float32Array(CW * CH)
      sinAngle = new Float32Array(CW * CH)
      maxDist = Infinity
    }

    precomputed.set(image.id, {
      originalData,
      grayscaleData,
      distanceField,
      cosAngle,
      sinAngle,
      maxDist,
      width: CW,
      height: CH,
    })
  }

  function precomputeAll(): void {
    for (const img of imagesRef.value) precomputeImage(img)
  }

  /* ── Render a static grayscale frame (for preview / editing) ───── */
  function renderStaticFrame(index: number): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const images = imagesRef.value
    if (index < 0 || index >= images.length) {
      ctx.fillStyle = canvasBg.value
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }

    const data = precomputed.get(images[index].id)
    if (!data) {
      const el = imageCache.get(images[index].id)
      if (el) drawCover(ctx, el, canvas.width, canvas.height)
      return
    }

    const output = ctx.createImageData(data.width, data.height)
    output.data.set(data.grayscaleData)
    ctx.putImageData(output, 0, 0)
  }

  /* ── Helpers: build internal image list for resolvers ───────────── */
  function buildImageList(): PrecomputedImageData[] {
    return imagesRef.value.map((img) => {
      const data = precomputed.get(img.id)
      return {
        id: img.id,
        originalData: data?.originalData ?? new Uint8ClampedArray(0),
        grayscaleData: data?.grayscaleData ?? new Uint8ClampedArray(0),
        distanceField: data?.distanceField ?? new Float32Array(0),
        cosAngle: data?.cosAngle ?? new Float32Array(0),
        sinAngle: data?.sinAngle ?? new Float32Array(0),
        maxDist: data?.maxDist ?? 0,
        width: data?.width ?? 0,
        height: data?.height ?? 0,
        points: img.points.map((p) => ({ x: p.x, y: p.y })),
        spreadDuration: img.spreadDuration,
        pauseDuration: img.pauseDuration,
      }
    })
  }

  /* ── Helpers: per-image timing (manual mode) ───────────────────── */
  function getManualTotalDuration(): number {
    return _getManualTotalDuration(buildImageList())
  }

  function resolveManual(effectiveTime: number): ResolvedSlot {
    return _resolveManual(buildImageList(), effectiveTime)
  }

  /* ── Helpers: beat-sync mode ───────────────────────────────────── */
  function getBeatTotalDuration(): number {
    return _getBeatTotalDuration(buildImageList(), beatsRef.value)
  }

  function resolveBeatSync(effectiveTimeMs: number): ResolvedSlot {
    return _resolveBeatSync(buildImageList(), beatsRef.value, effectiveTimeMs)
  }

  /* ── Unified resolve / total duration ──────────────────────────── */
  function isBeatMode(): boolean {
    return configRef.value.beatSyncEnabled && beatsRef.value.length >= 2
  }

  function getTotalCycleDuration(): number {
    return isBeatMode() ? getBeatTotalDuration() : getManualTotalDuration()
  }

  function resolveImageAtTime(effectiveTime: number): ResolvedSlot {
    return isBeatMode() ? resolveBeatSync(effectiveTime) : resolveManual(effectiveTime)
  }

  /* ── Core render frame (main thread, for preview playback) ─────── */
  function renderFrame(elapsedMs: number, step: number = 1): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const images = imagesRef.value
    const cfg = configRef.value
    if (images.length === 0) {
      ctx.fillStyle = canvasBg.value
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }

    const { width, height } = canvas
    const totalCycle = getTotalCycleDuration()

    let effectiveTime = elapsedMs
    if (cfg.loop) {
      effectiveTime = elapsedMs % totalCycle
    } else {
      effectiveTime = Math.min(elapsedMs, totalCycle - 1)
    }

    const { imageIndex, imageTime, effectiveSpreadDuration } = resolveImageAtTime(effectiveTime)

    const image = images[imageIndex]
    const data = precomputed.get(image.id)
    if (!data) {
      ctx.fillStyle = canvasBg.value
      ctx.fillRect(0, 0, width, height)
      return
    }

    const spreadProgress = Math.min(1, imageTime / effectiveSpreadDuration)
    const currentRadius = spreadProgress * data.maxDist
    const edgeWidth = cfg.edgeWidth

    const output = ctx.createImageData(width, height)
    const outData = output.data
    const { originalData, grayscaleData, distanceField, cosAngle, sinAngle } = data
    const rippleActive = cfg.rippleEnabled && spreadProgress > 0 && spreadProgress < 1
    const animFade = rippleActive ? Math.sin(spreadProgress * Math.PI) : 0

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = y * width + x
        const dist = distanceField[idx]

        let srcX = x
        let srcY = y

        if (rippleActive) {
          const relDist = currentRadius - dist
          if (relDist > 0 && relDist < WAVE_ZONE) {
            const wavePhase = (relDist / WAVE_WIDTH) * Math.PI * 2
            const amplitude = WAVE_AMPLITUDE
              * Math.sin(wavePhase)
              * Math.exp(-relDist / WAVE_ZONE * 2)
              * animFade

            srcX = x + cosAngle[idx] * amplitude
            srcY = y + sinAngle[idx] * amplitude
          }
        }

        srcX = Math.max(0, Math.min(width - 1, Math.round(srcX)))
        srcY = Math.max(0, Math.min(height - 1, Math.round(srcY)))
        const srcPx = (srcY * width + srcX) * 4

        let r: number, g: number, b: number
        const a: number = originalData[srcPx + 3]

        if (dist <= currentRadius - edgeWidth) {
          r = originalData[srcPx]
          g = originalData[srcPx + 1]
          b = originalData[srcPx + 2]
        } else if (dist <= currentRadius) {
          const t = smoothstep((currentRadius - dist) / edgeWidth)
          r = grayscaleData[srcPx] + (originalData[srcPx] - grayscaleData[srcPx]) * t
          g = grayscaleData[srcPx + 1] + (originalData[srcPx + 1] - grayscaleData[srcPx + 1]) * t
          b = grayscaleData[srcPx + 2] + (originalData[srcPx + 2] - grayscaleData[srcPx + 2]) * t
        } else {
          r = grayscaleData[srcPx]
          g = grayscaleData[srcPx + 1]
          b = grayscaleData[srcPx + 2]
        }

        for (let dy2 = 0; dy2 < step && y + dy2 < height; dy2++) {
          for (let dx2 = 0; dx2 < step && x + dx2 < width; dx2++) {
            const outPx = ((y + dy2) * width + (x + dx2)) * 4
            outData[outPx] = r
            outData[outPx + 1] = g
            outData[outPx + 2] = b
            outData[outPx + 3] = a
          }
        }
      }
    }

    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, width, height)
    ctx.putImageData(output, 0, 0)

    // Wave highlight rings
    if (rippleActive && image.points.length > 0 && currentRadius > 4) {
      ctx.save()
      ctx.globalAlpha = 0.25 * animFade
      for (const pt of image.points) {
        const cx = pt.x * width
        const cy = pt.y * height
        for (let w = 0; w < WAVE_COUNT; w++) {
          const ringRadius = currentRadius - w * WAVE_WIDTH
          if (ringRadius > 0) {
            ctx.beginPath()
            ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(150, 200, 255, ${0.3 - w * 0.08})`
            ctx.lineWidth = 1.5
            ctx.stroke()
          }
        }
      }
      ctx.restore()
    }

    // Bouncing ball overlay
    if (cfg.bouncingBallEnabled && images.length > 1) {
      const isLast = imageIndex === images.length - 1
      const hasNext = cfg.loop || !isLast

      // 计算当前图片槽位总时长和距离切换的剩余时间
      const slotDuration = isBeatMode()
        ? effectiveSpreadDuration
        : (image.spreadDuration + image.pauseDuration)
      const timeUntilSwitch = slotDuration - imageTime

      // 在距离切换 BOUNCE_DURATION 时触发弹跳，确保小球在扩散前到位
      // bounceDuration 动态适配：取 BOUNCE_DURATION 和 slotDuration*0.6 的较小值
      const actualBounceDur = Math.max(200, Math.min(BOUNCE_DURATION, slotDuration * 0.6))

      if (timeUntilSwitch <= actualBounceDur && timeUntilSwitch > 0
          && hasNext && ballState.bounceTriggerImage !== imageIndex) {
        const nextIdx = (imageIndex + 1) % images.length
        const fromPt = getFirstPoint(images, imageIndex)
        const toPt = getFirstPoint(images, nextIdx)
        ballState.fromX = fromPt.x
        ballState.fromY = fromPt.y
        ballState.toX = toPt.x
        ballState.toY = toPt.y
        ballState.bounceStartMs = elapsedMs
        ballState.bounceDuration = actualBounceDur
        ballState.isBouncing = true
        ballState.landingRippleStart = -1
        ballState.bounceTriggerImage = imageIndex
      }

      // 图片切换后重置触发标记（新图片开始扩散，小球已就位）
      if (imageIndex !== ballState.prevImageIndex && ballState.prevImageIndex >= 0) {
        ballState.bounceTriggerImage = -1
      }
      ballState.prevImageIndex = imageIndex

      drawBouncingBall(ctx, ballState, elapsedMs, imageIndex, images, width, height)
    }
  }

  /* ── Playback info (for status bar) ────────────────────────────── */
  function getPlaybackInfo(elapsedMs: number) {
    const images = imagesRef.value
    const cfg = configRef.value
    if (images.length === 0) return { index: 0, phase: 'idle' as const, progress: 0 }

    const totalCycle = getTotalCycleDuration()

    const effectiveTime = cfg.loop ? elapsedMs % totalCycle : Math.min(elapsedMs, totalCycle - 1)
    const { imageIndex, imageTime, effectiveSpreadDuration } = resolveImageAtTime(effectiveTime)

    if (imageTime <= effectiveSpreadDuration) {
      return {
        index: imageIndex,
        phase: 'spreading' as const,
        progress: imageTime / effectiveSpreadDuration,
      }
    }
    return {
      index: imageIndex,
      phase: 'pausing' as const,
      progress: 1,
    }
  }

  /* ── Export video ────────────────────────────────────────────────
   * 有音频 → 主线程渲染（音频时间驱动画面，保证踩点同步）
   * 无音频 → WebWorker 渲染（不阻塞主线程，UI 流畅）
   */
  async function exportVideo(
    onProgress?: (p: number) => void,
    audioElement?: HTMLAudioElement | null,
    exportDurationMs?: number,
  ): Promise<Blob> {
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas not available')

    await preloadImages()
    precomputeAll()

    const totalDuration = exportDurationMs ?? getTotalCycleDuration()
    const hasAudio = !!(audioElement && isBeatMode())

    if (hasAudio) {
      return exportWithAudio(audioElement!, totalDuration, onProgress)
    }

    // 无音频 → Worker 导出
    const workerImages = buildImageList()
    const handle = createWorkerExport({
      canvas,
      images: workerImages,
      config: { ...configRef.value },
      beats: beatsRef.value.map((b) => ({ time: b.time, strength: b.strength })),
      totalDurationMs: totalDuration,
      fps: 30,
      step: 1,
      onProgress,
    })

    activeExportHandle = handle

    try {
      const blob = await handle.start()
      return blob
    } finally {
      activeExportHandle = null
    }
  }

  /* ── 有音频导出：主线程渲染，音频驱动时钟（保证踩点同步）────── */
  let audioCancelled = false

  async function exportWithAudio(
    audioElement: HTMLAudioElement,
    totalDuration: number,
    onProgress?: (p: number) => void,
  ): Promise<Blob> {
    audioCancelled = false

    const canvas = canvasRef.value!
    const FPS = 30

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    // 创建独立的 audio 元素用于导出，避免 createMediaElementSource 永久接管预览用的 audio 元素
    const exportAudio = new Audio(audioElement.src)
    exportAudio.preload = 'auto'
    await new Promise<void>((resolve, reject) => {
      exportAudio.addEventListener('canplaythrough', () => resolve(), { once: true })
      exportAudio.addEventListener('error', reject, { once: true })
      exportAudio.load()
    })

    const videoStream = canvas.captureStream(FPS)
    let combinedStream: MediaStream = videoStream
    let audioCtx: AudioContext | null = null

    try {
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaElementSource(exportAudio)
      const dest = audioCtx.createMediaStreamDestination()
      source.connect(dest)
      source.connect(audioCtx.destination)
      combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ])
    } catch {
      combinedStream = videoStream
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

    exportAudio.currentTime = 0
    await exportAudio.play().catch(() => {})
    recorder.start()

    const totalSec = totalDuration / 1000

    return new Promise<Blob>((resolve, reject) => {
      recorder.onerror = reject
      recorder.onstop = () => {
        exportAudio.pause()
        exportAudio.src = ''
        if (audioCtx) audioCtx.close().catch(() => {})
        resolve(new Blob(chunks, { type: 'video/webm' }))
      }
      function tick() {
        if (audioCancelled) {
          exportAudio.pause()
          recorder.stop()
          return
        }
        const t = exportAudio.currentTime
        if (t >= totalSec) {
          recorder.stop()
          return
        }
        // 以音频当前时间驱动渲染 —— 帧和节拍完美同步（step=1 保持原图清晰度）
        renderFrame(t * 1000, 1)
        onProgress?.(t / totalSec)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  /* ── Cancel export ─────────────────────────────────────────────── */
  function cancelExport() {
    // 取消 Worker 导出（无音频路径）
    if (activeExportHandle) {
      activeExportHandle.cancel()
      activeExportHandle = null
    }
    // 取消音频导出（有音频路径）
    audioCancelled = true
  }

  /* ── Cleanup ───────────────────────────────────────────────────── */
  function cleanup() {
    cancelExport()
    resetBallState()
    imageCache.clear()
    precomputed.clear()
    offscreen = null
    offCtx = null
  }

  onUnmounted(cleanup)

  return {
    preloadImages,
    precomputeImage,
    precomputeAll,
    renderFrame,
    renderStaticFrame,
    getPlaybackInfo,
    getTotalCycleDuration,
    isBeatMode,
    exportVideo,
    cancelExport,
    resetBallState,
    cleanup,
  }
}
