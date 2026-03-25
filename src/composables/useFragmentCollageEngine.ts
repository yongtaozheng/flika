// ─────────────────────────────────────────────────────────────────────────────
// 碎片拼贴引擎 — Canvas 2D 碎片飞入拼贴动画
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, FragmentImage, FragmentConfig } from '../types'
import {
  getManualTotalDuration as _getManualTotalDuration,
  getBeatTotalDuration as _getBeatTotalDuration,
  resolveManual as _resolveManual,
  resolveBeatSync as _resolveBeatSync,
  type PrecomputedImageData,
  type ResolvedSlot,
} from '../utils/diffusionRenderer'
import { canvasBg } from './useTheme'

/* ── Easing helpers ──────────────────────────────────────────────────── */
function easeOutBack(t: number): number {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/* ── Pseudo-random (deterministic) ───────────────────────────────────── */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/* ── Fragment data ───────────────────────────────────────────────────── */
interface FragmentData {
  /** Grid column */
  col: number
  /** Grid row */
  row: number
  /** Scattered X offset (px, relative to canvas center) */
  scatterX: number
  /** Scattered Y offset (px, relative to canvas center) */
  scatterY: number
  /** Scattered rotation (radians) */
  scatterRotation: number
  /** Scattered scale */
  scatterScale: number
  /** Stagger delay (0-1) */
  delay: number
}

/* ── Pre-computed data per image ──────────────────────────────────────── */
interface PrecomputedData {
  /** The pre-rendered cover-fit image as an offscreen canvas */
  offscreen: HTMLCanvasElement
  width: number
  height: number
  /** Fragment scatter parameters per fragment */
  fragments: FragmentData[]
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

/* ═══════════════════════════════════════════════════════════════════════ */
export function useFragmentCollageEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<FragmentImage[]>,
  configRef: Ref<FragmentConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()

  /* ── Image element loading ─────────────────────────────────────── */
  function loadImageElement(img: FragmentImage): Promise<HTMLImageElement> {
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

  /* ── Generate fragment scatter data ────────────────────────────── */
  function generateFragments(
    _imageId: string,
    imageIndex: number,
    cols: number,
    rows: number,
    cw: number,
    ch: number,
    cfg: FragmentConfig,
  ): FragmentData[] {
    const fragments: FragmentData[] = []
    const scatterPx = Math.max(cw, ch) * cfg.scatterRange
    const rotMax = (cfg.rotationRange * Math.PI) / 180

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col
        const seed = imageIndex * 10000 + idx

        // Scatter position: random offset from canvas center
        const angle = seededRandom(seed) * Math.PI * 2
        const dist = scatterPx * (0.5 + seededRandom(seed + 1) * 0.5)
        const scatterX = Math.cos(angle) * dist
        const scatterY = Math.sin(angle) * dist

        // Scatter rotation
        const scatterRotation = (seededRandom(seed + 2) - 0.5) * 2 * rotMax

        // Scatter scale
        const scatterScale = 0.3 + seededRandom(seed + 3) * 0.4

        // Stagger delay based on assembly mode
        let delay: number
        if (cfg.assembleMode === 'radial') {
          // Radial from center: center fragments appear first
          const cx = (col + 0.5) / cols - 0.5
          const cy = (row + 0.5) / rows - 0.5
          delay = Math.sqrt(cx * cx + cy * cy) / 0.707 // normalize to 0~1
        } else if (cfg.assembleMode === 'sweep') {
          // Linear sweep from left to right
          delay = col / (cols - 1 || 1)
        } else {
          // Random
          delay = seededRandom(seed + 4)
        }

        fragments.push({
          col, row,
          scatterX, scatterY,
          scatterRotation,
          scatterScale,
          delay,
        })
      }
    }

    return fragments
  }

  /* ── Pre-compute for a single image ────────────────────────────── */
  function precomputeImage(image: FragmentImage, index: number): void {
    const el = imageCache.get(image.id)
    if (!el || !el.complete || !el.naturalWidth) return

    const CW = canvasRef.value?.width ?? 1280
    const CH = canvasRef.value?.height ?? 720
    const cfg = configRef.value

    // Create offscreen canvas with the cover-fit rendered image
    const off = document.createElement('canvas')
    off.width = CW
    off.height = CH
    const offCtx = off.getContext('2d')!
    drawCover(offCtx, el, CW, CH)

    const fragments = generateFragments(
      image.id, index,
      cfg.gridCols, cfg.gridRows,
      CW, CH, cfg,
    )

    precomputed.set(image.id, {
      offscreen: off,
      width: CW,
      height: CH,
      fragments,
    })
  }

  function precomputeAll(): void {
    imagesRef.value.forEach((img, i) => precomputeImage(img, i))
  }

  /* ── Build image list for resolvers (reuse diffusionRenderer) ── */
  function buildImageList(): PrecomputedImageData[] {
    return imagesRef.value.map((img) => {
      const data = precomputed.get(img.id)
      return {
        id: img.id,
        originalData: new Uint8ClampedArray(0),
        grayscaleData: new Uint8ClampedArray(0),
        distanceField: new Float32Array(0),
        cosAngle: new Float32Array(0),
        sinAngle: new Float32Array(0),
        maxDist: 0,
        width: data?.width ?? 0,
        height: data?.height ?? 0,
        points: [],
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

    // Static preview: show the assembled image with a subtle fragment grid overlay
    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(data.offscreen, 0, 0)

    // Draw subtle grid lines to hint at fragments
    const cfg = configRef.value
    const fragW = canvas.width / cfg.gridCols
    const fragH = canvas.height / cfg.gridRows

    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1

    for (let c = 1; c < cfg.gridCols; c++) {
      const x = Math.round(c * fragW)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    for (let r = 1; r < cfg.gridRows; r++) {
      const y = Math.round(r * fragH)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  /* ── Core render frame ─────────────────────────────────────────── */
  function renderFrame(elapsedMs: number): void {
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

    // Overall progress (0→1) for this image's "spread" phase
    const rawProgress = Math.min(1, imageTime / effectiveSpreadDuration)

    // Clear canvas
    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, width, height)

    const cols = cfg.gridCols
    const rows = cfg.gridRows
    const fragW = width / cols
    const fragH = height / rows
    const gap = cfg.fragmentGap
    const perspective = cfg.perspectiveEnabled

    const fragments = data.fragments

    // ── Stagger range: 30% of the total time is used for stagger
    const staggerRange = 0.35

    for (const frag of fragments) {
      // Per-fragment progress with stagger
      const fragDelay = frag.delay * staggerRange
      const fragDuration = 1 - staggerRange
      const localProgress = Math.max(0, Math.min(1, (rawProgress - fragDelay) / fragDuration))

      // Easing
      const eased = easeOutBack(localProgress)
      const easedSmooth = easeOutCubic(localProgress)

      // Target position (center of fragment cell)
      const targetX = frag.col * fragW + fragW / 2
      const targetY = frag.row * fragH + fragH / 2

      // Current position: interpolate from scattered to target
      const currentX = targetX + frag.scatterX * (1 - eased)
      const currentY = targetY + frag.scatterY * (1 - eased)

      // Current rotation
      const currentRotation = frag.scatterRotation * (1 - easedSmooth)

      // Current scale: from scattered small to full
      const currentScale = frag.scatterScale + (1 - frag.scatterScale) * easedSmooth

      // Current opacity
      const opacity = Math.min(1, localProgress * 3) // fast fade in

      if (opacity <= 0) continue

      ctx.save()
      ctx.globalAlpha = opacity
      ctx.translate(currentX, currentY)
      ctx.rotate(currentRotation)

      if (perspective && localProgress < 0.8) {
        // Simulate 3D flip: skew based on progress
        const flipProgress = Math.min(1, localProgress / 0.8)
        const skewAmount = (1 - flipProgress) * 0.3
        ctx.transform(1, skewAmount * 0.5, -skewAmount * 0.3, 1, 0, 0)
      }

      ctx.scale(currentScale, currentScale)

      // Draw fragment with gap
      const drawW = fragW - gap
      const drawH = fragH - gap
      const halfW = drawW / 2
      const halfH = drawH / 2

      // Clip to rounded rect for nicer look
      const radius = Math.min(4, drawW * 0.05, drawH * 0.05)
      ctx.beginPath()
      ctx.moveTo(-halfW + radius, -halfH)
      ctx.lineTo(halfW - radius, -halfH)
      ctx.quadraticCurveTo(halfW, -halfH, halfW, -halfH + radius)
      ctx.lineTo(halfW, halfH - radius)
      ctx.quadraticCurveTo(halfW, halfH, halfW - radius, halfH)
      ctx.lineTo(-halfW + radius, halfH)
      ctx.quadraticCurveTo(-halfW, halfH, -halfW, halfH - radius)
      ctx.lineTo(-halfW, -halfH + radius)
      ctx.quadraticCurveTo(-halfW, -halfH, -halfW + radius, -halfH)
      ctx.closePath()
      ctx.clip()

      // Draw the portion of the image for this fragment
      const srcX = frag.col * fragW
      const srcY = frag.row * fragH

      ctx.drawImage(
        data.offscreen,
        srcX, srcY, fragW, fragH,        // source rect
        -halfW, -halfH, drawW, drawH,    // dest rect (centered)
      )

      // Subtle border
      ctx.strokeStyle = `rgba(255,255,255,${0.2 * opacity})`
      ctx.lineWidth = 1
      ctx.stroke()

      // Shadow/depth effect when fragments are flying
      if (localProgress < 0.95) {
        const shadowAlpha = (1 - localProgress) * 0.15
        ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`
        ctx.shadowBlur = 10 * (1 - localProgress)
        ctx.shadowOffsetX = 3 * (1 - localProgress)
        ctx.shadowOffsetY = 5 * (1 - localProgress)
      }

      ctx.restore()
    }

    // After all fragments assembled, draw the seam-free full image overlay
    if (rawProgress >= 0.95) {
      const overlayAlpha = Math.min(1, (rawProgress - 0.95) / 0.05)
      ctx.save()
      ctx.globalAlpha = overlayAlpha
      ctx.drawImage(data.offscreen, 0, 0)
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
        renderFrame(t)
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
        renderFrame(t * 1000)
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
