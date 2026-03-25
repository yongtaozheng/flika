// ─────────────────────────────────────────────────────────────────────────────
// 墨水渲染引擎 — Canvas 2D 水墨画风格扩散动画
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, InkImage, InkConfig } from '../types'
import {
  smoothstep,
  computeDistanceField,
  getManualTotalDuration as _getManualTotalDuration,
  getBeatTotalDuration as _getBeatTotalDuration,
  resolveManual as _resolveManual,
  resolveBeatSync as _resolveBeatSync,
  type PrecomputedImageData,
  type ResolvedSlot,
} from '../utils/diffusionRenderer'
import { canvasBg } from './useTheme'

/* ── Paper & ink color constants ──────────────────────────────────────── */
const PAPER_R = 245, PAPER_G = 238, PAPER_B = 225  // 宣纸暖白色
const INK_R = 12, INK_G = 8, INK_B = 18            // 墨汁深色（微偏蓝紫）

/* ── Splatter particle constants ──────────────────────────────────────── */
const SPLATTER_PER_POINT = 30           // 每个墨点产生的飞溅粒子数
const SPLATTER_MAX_RADIUS = 5           // 最大粒子半径 (px)
const SPLATTER_LEAD = 0.15              // 粒子相对主墨迹提前出现的比例

interface SplatterParticle {
  /** 距离墨点的距离（归一化为 maxDist 的倍数） */
  distRatio: number
  /** 角度 */
  angle: number
  /** 粒子大小 (px) */
  radius: number
  /** 墨水浓度 */
  opacity: number
}

/* ── Pre-computed data per image ──────────────────────────────────────── */
interface PrecomputedData {
  originalData: Uint8ClampedArray
  distanceField: Float32Array
  cosAngle: Float32Array
  sinAngle: Float32Array
  maxDist: number
  width: number
  height: number
  /** 每个墨点的飞溅粒子 */
  splatters: { px: number; py: number; particle: SplatterParticle }[]
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
  const sw = el.naturalWidth, sh = el.naturalHeight
  if (!sw || !sh) return
  const scale = Math.max(cw / sw, ch / sh)
  const dw = sw * scale, dh = sh * scale
  ctx.drawImage(el, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
}

/* ── Deterministic pseudo-random (sin-based) ─────────────────────────── */
function pseudoRandom(seed: number): number {
  return (Math.sin(seed * 127.1 + 311.7) * 43758.5453) % 1
}
function absRandom(seed: number): number {
  return Math.abs(pseudoRandom(seed))
}

/* ── Generate splatter particles for a set of points ─────────────────── */
function generateSplatters(
  points: { x: number; y: number }[],
  width: number,
  height: number,
  maxDist: number,
): { px: number; py: number; particle: SplatterParticle }[] {
  const splatters: { px: number; py: number; particle: SplatterParticle }[] = []
  for (let pi = 0; pi < points.length; pi++) {
    const pt = points[pi]
    const cx = pt.x * width, cy = pt.y * height
    for (let i = 0; i < SPLATTER_PER_POINT; i++) {
      const seed = pi * 1000 + i
      const angle = pseudoRandom(seed) * Math.PI * 2
      const distRatio = 0.3 + absRandom(seed + 1) * 0.7 // 0.3 ~ 1.0
      const dist = distRatio * maxDist
      const radius = 1 + absRandom(seed + 2) * SPLATTER_MAX_RADIUS
      const opacity = 0.3 + absRandom(seed + 3) * 0.7

      const px = cx + Math.cos(angle) * dist
      const py = cy + Math.sin(angle) * dist

      if (px >= 0 && px < width && py >= 0 && py < height) {
        splatters.push({ px, py, particle: { distRatio, angle, radius, opacity } })
      }
    }
  }
  return splatters
}

/* ═══════════════════════════════════════════════════════════════════════ */
export function useInkRenderEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<InkImage[]>,
  configRef: Ref<InkConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()

  let offscreen: HTMLCanvasElement | null = null
  let offCtx: CanvasRenderingContext2D | null = null

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
  function loadImageElement(img: InkImage): Promise<HTMLImageElement> {
    const existing = imageCache.get(img.id)
    if (existing && existing.complete && existing.naturalWidth > 0) {
      return Promise.resolve(existing)
    }
    return new Promise((resolve) => {
      const el = new Image()
      el.onload = () => { imageCache.set(img.id, el); resolve(el) }
      el.onerror = () => resolve(el)
      el.src = img.url
    })
  }

  async function preloadImages(): Promise<void> {
    await Promise.all(imagesRef.value.map((img) => loadImageElement(img)))
  }

  /* ── Pre-compute for a single image ────────────────────────────── */
  function precomputeImage(image: InkImage): void {
    const el = imageCache.get(image.id)
    if (!el || !el.complete || !el.naturalWidth) return

    const CW = canvasRef.value?.width ?? 1280
    const CH = canvasRef.value?.height ?? 720

    ensureOffscreen(CW, CH)
    drawCover(offCtx!, el, CW, CH)

    const originalData = offCtx!.getImageData(0, 0, CW, CH).data

    let distanceField: Float32Array
    let cosAngle: Float32Array
    let sinAngle: Float32Array
    let maxDist: number
    let splatters: PrecomputedData['splatters'] = []

    if (image.points.length > 0) {
      const result = computeDistanceField(CW, CH, image.points)
      distanceField = result.field
      cosAngle = result.cosAngle
      sinAngle = result.sinAngle
      maxDist = result.maxDist
      splatters = generateSplatters(image.points, CW, CH, maxDist)
    } else {
      distanceField = new Float32Array(CW * CH).fill(Infinity)
      cosAngle = new Float32Array(CW * CH)
      sinAngle = new Float32Array(CW * CH)
      maxDist = Infinity
    }

    precomputed.set(image.id, {
      originalData,
      distanceField,
      cosAngle,
      sinAngle,
      maxDist,
      width: CW,
      height: CH,
      splatters,
    })
  }

  function precomputeAll(): void {
    for (const img of imagesRef.value) precomputeImage(img)
  }

  /* ── Build image list for resolvers ────────────────────────────── */
  function buildImageList(): PrecomputedImageData[] {
    return imagesRef.value.map((img) => {
      const data = precomputed.get(img.id)
      // We reuse PrecomputedImageData shape; grayscaleData is unused but needed for type
      return {
        id: img.id,
        originalData: data?.originalData ?? new Uint8ClampedArray(0),
        grayscaleData: new Uint8ClampedArray(0), // unused in ink mode
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

  /* ── Time helpers ───────────────────────────────────────────────── */
  function isBeatMode(): boolean {
    return configRef.value.beatSyncEnabled && beatsRef.value.length >= 2
  }

  function getTotalCycleDuration(): number {
    const images = buildImageList()
    return isBeatMode()
      ? _getBeatTotalDuration(images, beatsRef.value)
      : _getManualTotalDuration(images)
  }

  function resolveImageAtTime(effectiveTime: number): ResolvedSlot {
    const images = buildImageList()
    return isBeatMode()
      ? _resolveBeatSync(images, beatsRef.value, effectiveTime)
      : _resolveManual(images, effectiveTime)
  }

  /* ── Render static frame (preview / editing) ───────────────────── */
  function renderStaticFrame(index: number): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const images = imagesRef.value
    if (index < 0 || index >= images.length) {
      ctx.fillStyle = `rgb(${PAPER_R},${PAPER_G},${PAPER_B})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }

    const data = precomputed.get(images[index].id)
    if (!data) {
      const el = imageCache.get(images[index].id)
      if (el) drawCover(ctx, el, canvas.width, canvas.height)
      return
    }

    // 静态预览：根据 inkWashBase 显示水墨黑白 或 空白宣纸
    const { width, height, originalData } = data
    const cfg = configRef.value

    if (!cfg.inkWashBase) {
      // 空白宣纸模式：直接显示纸张底色
      ctx.fillStyle = `rgb(${PAPER_R},${PAPER_G},${PAPER_B})`
      ctx.fillRect(0, 0, width, height)
      return
    }

    // 水墨底图模式：显示水墨黑白版本
    const density = cfg.inkDensity
    const output = ctx.createImageData(width, height)
    const outData = output.data

    for (let i = 0; i < originalData.length; i += 4) {
      const lum = 0.299 * originalData[i] + 0.587 * originalData[i + 1] + 0.114 * originalData[i + 2]
      const t = lum / 255
      const contrast = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
      const inkAlpha = (1 - contrast) * density
      outData[i] = PAPER_R * (1 - inkAlpha) + INK_R * inkAlpha
      outData[i + 1] = PAPER_G * (1 - inkAlpha) + INK_G * inkAlpha
      outData[i + 2] = PAPER_B * (1 - inkAlpha) + INK_B * inkAlpha
      outData[i + 3] = originalData[i + 3]
    }

    ctx.putImageData(output, 0, 0)
  }

  /* ── Ink noise: organic boundary modulation ────────────────────── */
  function inkNoise(angle: number, dist: number, progress: number, roughness: number): number {
    const r = roughness
    return 1
      + r * 0.22 * Math.sin(angle * 2 + progress * 1.5)
      + r * 0.14 * Math.sin(angle * 5 + 0.8 - progress * 2)
      + r * 0.09 * Math.sin(angle * 11 + 1.5 + progress)
      + r * 0.06 * Math.sin(angle * 17 + dist * 0.003 + 2.3)
      + r * 0.04 * Math.sin(angle * 23 + dist * 0.005 + progress * 3 + 0.7)
      + r * 0.03 * Math.sin(angle * 31 + 2.1)
  }

  /* ── Core render frame ─────────────────────────────────────────── */
  function renderFrame(elapsedMs: number, step: number = 1): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const images = imagesRef.value
    const cfg = configRef.value
    if (images.length === 0) {
      ctx.fillStyle = `rgb(${PAPER_R},${PAPER_G},${PAPER_B})`
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
      ctx.fillStyle = `rgb(${PAPER_R},${PAPER_G},${PAPER_B})`
      ctx.fillRect(0, 0, width, height)
      return
    }

    const spreadProgress = Math.min(1, imageTime / effectiveSpreadDuration)
    const currentRadius = spreadProgress * data.maxDist
    const roughness = cfg.edgeRoughness
    const density = cfg.inkDensity
    const useInkWash = cfg.inkWashBase

    // Edge width: 40px base, scales with roughness
    const baseEdge = 40 + roughness * 30

    const output = ctx.createImageData(width, height)
    const outData = output.data
    const { originalData, distanceField, cosAngle, sinAngle } = data

    // ─────────────────────────────────────────────────────────────────
    // 三区渲染逻辑：
    //   内区（墨水已覆盖）→ 彩色原图
    //   边缘区（墨水前锋）→ 底色 ↔ 彩色过渡 + 有机边缘
    //   外区（墨水未到达）→ 水墨黑白 或 空白宣纸（取决于 inkWashBase）
    // ─────────────────────────────────────────────────────────────────

    // 宣纸纹理噪声（仅空白宣纸模式用到，但计算很轻量）
    const texScale = 0.02

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = y * width + x
        const dist = distanceField[idx]

        // Get angle from nearest point for noise
        const angle = Math.atan2(sinAngle[idx], cosAngle[idx])

        // Organic ink boundary with noise modulation
        const noise = inkNoise(angle, dist, spreadProgress, roughness)
        const inkBoundary = currentRadius * noise

        // Variable edge width for natural ink feathering
        const edgeWidth = baseEdge * (1 + 0.3 * Math.sin(angle * 7 + 1.1))

        let r: number, g: number, b: number

        const srcPx = idx * 4
        const origR = originalData[srcPx]
        const origG = originalData[srcPx + 1]
        const origB = originalData[srcPx + 2]
        const origA = originalData[srcPx + 3]

        // 外区底色：水墨黑白 或 空白宣纸
        let baseR: number, baseG: number, baseB: number
        if (useInkWash) {
          const lum = 0.299 * origR + 0.587 * origG + 0.114 * origB
          const lt = lum / 255
          const contrast = lt < 0.5 ? 2 * lt * lt : 1 - 2 * (1 - lt) * (1 - lt)
          const inkAlpha = (1 - contrast) * density
          baseR = PAPER_R * (1 - inkAlpha) + INK_R * inkAlpha
          baseG = PAPER_G * (1 - inkAlpha) + INK_G * inkAlpha
          baseB = PAPER_B * (1 - inkAlpha) + INK_B * inkAlpha
        } else {
          // 空白宣纸 + 微弱纹理
          const texNoise = 1 - texScale * Math.abs(Math.sin(x * 0.47 + y * 0.71) * Math.sin(y * 0.33 - x * 0.59))
          baseR = PAPER_R * texNoise
          baseG = PAPER_G * texNoise
          baseB = PAPER_B * texNoise
        }

        if (dist <= inkBoundary - edgeWidth) {
          // ── 内区：墨水已晕染过 → 显示彩色原图 ──
          r = origR; g = origG; b = origB
        } else if (dist <= inkBoundary) {
          // ── 边缘区：底色 → 彩色过渡 ──
          const edgeT = smoothstep((inkBoundary - dist) / edgeWidth)
          r = baseR + (origR - baseR) * edgeT
          g = baseG + (origG - baseG) * edgeT
          b = baseB + (origB - baseB) * edgeT
        } else {
          // ── 外区：水墨黑白 或 空白宣纸 ──
          r = baseR
          g = baseG
          b = baseB
        }

        // Fill step × step block
        for (let dy = 0; dy < step && y + dy < height; dy++) {
          for (let dx = 0; dx < step && x + dx < width; dx++) {
            const outPx = ((y + dy) * width + (x + dx)) * 4
            outData[outPx] = r
            outData[outPx + 1] = g
            outData[outPx + 2] = b
            outData[outPx + 3] = origA
          }
        }
      }
    }

    // Draw pixel data
    ctx.putImageData(output, 0, 0)

    // ── Ink splatter particles (彩色飞溅，提前预告即将显现的颜色) ──
    if (cfg.splatterEnabled && data.splatters.length > 0 && spreadProgress > 0 && spreadProgress < 1) {
      ctx.save()
      for (const s of data.splatters) {
        const particleDist = s.particle.distRatio * data.maxDist
        const appearThreshold = particleDist * (1 - SPLATTER_LEAD)
        const fadeThreshold = particleDist * 1.1

        if (currentRadius > appearThreshold && currentRadius < fadeThreshold) {
          const localProgress = (currentRadius - appearThreshold) / (fadeThreshold - appearThreshold)
          const fadeIn = Math.min(1, localProgress * 3)
          const fadeOut = Math.max(0, 1 - (localProgress - 0.6) / 0.4)
          const alpha = s.particle.opacity * fadeIn * fadeOut

          if (alpha > 0.05) {
            // 飞溅粒子使用原图彩色 — 在水墨区域提前透露即将显现的色彩
            const sx = Math.max(0, Math.min(width - 1, Math.round(s.px)))
            const sy = Math.max(0, Math.min(height - 1, Math.round(s.py)))
            const si = (sy * width + sx) * 4
            ctx.fillStyle = `rgba(${originalData[si]},${originalData[si + 1]},${originalData[si + 2]},${alpha})`
            ctx.beginPath()
            ctx.arc(s.px, s.py, s.particle.radius, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.restore()
    }

    // ── Ink flow tendrils near the spreading front ──
    if (spreadProgress > 0.05 && spreadProgress < 0.95 && image.points.length > 0) {
      ctx.save()
      const flowAlpha = 0.12 * Math.sin(spreadProgress * Math.PI)
      if (flowAlpha > 0.02) {
        ctx.globalAlpha = flowAlpha
        ctx.strokeStyle = 'rgba(80,60,40,0.5)'
        ctx.lineWidth = 1.5

        for (const pt of image.points) {
          const cx = pt.x * width, cy = pt.y * height
          for (let i = 0; i < 8; i++) {
            const baseAngle = (i / 8) * Math.PI * 2
            const noise1 = 0.4 * Math.sin(baseAngle * 3 + spreadProgress * 4 + i)
            const noise2 = 0.2 * Math.sin(baseAngle * 7 - spreadProgress * 2 + i * 2.3)
            const tendrilAngle = baseAngle + noise1 + noise2
            const tendrilLen = currentRadius * (0.9 + 0.2 * Math.sin(i * 1.7 + spreadProgress * 3))

            ctx.beginPath()
            ctx.moveTo(
              cx + Math.cos(tendrilAngle) * currentRadius * 0.8,
              cy + Math.sin(tendrilAngle) * currentRadius * 0.8,
            )
            const ctrlR = tendrilLen * 1.05
            const ctrlAngle = tendrilAngle + 0.15 * Math.sin(i * 2.3 + spreadProgress * 5)
            ctx.quadraticCurveTo(
              cx + Math.cos(ctrlAngle) * ctrlR,
              cy + Math.sin(ctrlAngle) * ctrlR,
              cx + Math.cos(tendrilAngle + 0.1) * tendrilLen * 1.1,
              cy + Math.sin(tendrilAngle + 0.1) * tendrilLen * 1.1,
            )
            ctx.stroke()
          }
        }
      }
      ctx.restore()
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

  /* ── Export video ───────────────────────────────────────────────── */
  let exportCancelled = false

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

    // No audio: frame-by-frame export
    return exportFrameByFrame(totalDuration, onProgress)
  }

  async function exportFrameByFrame(
    totalDuration: number,
    onProgress?: (p: number) => void,
  ): Promise<Blob> {
    exportCancelled = false
    const canvas = canvasRef.value!
    const FPS = 30

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    const stream = canvas.captureStream(FPS)
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

    recorder.start()
    const totalFrames = Math.ceil(totalDuration / 1000 * FPS)

    return new Promise<Blob>((resolve, reject) => {
      recorder.onerror = reject
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: 'video/webm' }))
      }

      let frame = 0
      function tick() {
        if (exportCancelled) { recorder.stop(); return }
        if (frame >= totalFrames) { recorder.stop(); return }

        const t = (frame / totalFrames) * totalDuration
        renderFrame(t, 1)
        onProgress?.(frame / totalFrames)
        frame++
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  async function exportWithAudio(
    audioElement: HTMLAudioElement,
    totalDuration: number,
    onProgress?: (p: number) => void,
  ): Promise<Blob> {
    exportCancelled = false
    const canvas = canvasRef.value!
    const FPS = 30

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

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
        if (exportCancelled) {
          exportAudio.pause()
          recorder.stop()
          return
        }
        const t = exportAudio.currentTime
        if (t >= totalSec) { recorder.stop(); return }
        renderFrame(t * 1000, 1)
        onProgress?.(t / totalSec)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  /* ── Cancel export ─────────────────────────────────────────────── */
  function cancelExport() {
    exportCancelled = true
  }

  /* ── Cleanup ───────────────────────────────────────────────────── */
  function cleanup() {
    cancelExport()
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
    cleanup,
  }
}
