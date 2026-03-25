// ─────────────────────────────────────────────────────────────────────────────
// 像素瀑布引擎 — Canvas 2D 像素块瀑布下落转场动画
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, PixelWaterfallImage, PixelWaterfallConfig } from '../types'
import {
  getManualTotalDuration as _getManualTotalDuration,
  getBeatTotalDuration as _getBeatTotalDuration,
  resolveManual as _resolveManual,
  resolveBeatSync as _resolveBeatSync,
  type PrecomputedImageData,
  type ResolvedSlot,
} from '../utils/diffusionRenderer'
import { canvasBg } from './useTheme'

/* ── Easing helpers ──────────────────────────────────────────────── */
function easeInQuad(t: number): number {
  return t * t
}

function easeInCubic(t: number): number {
  return t * t * t
}

// easeOutCubic kept available for future use
// function easeOutCubic(t: number): number {
//   return 1 - Math.pow(1 - t, 3)
// }

/* ── Pseudo-random (deterministic) ───────────────────────────────── */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/* ── Pixel block data ───────────────────────────────────────────── */
interface PixelBlock {
  /** Grid column index */
  col: number
  /** Grid row index */
  row: number
  /** Cascade delay (0-1 normalized) — when this block starts falling */
  cascadeDelay: number
  /** Horizontal drift direction (-1 to 1) */
  driftDir: number
  /** Random rotation speed factor */
  rotSpeed: number
  /** Random seed for variation */
  seed: number
}

/* ── Pre-computed data per image ──────────────────────────────────── */
interface PrecomputedData {
  /** The pre-rendered cover-fit image as an offscreen canvas */
  offscreen: HTMLCanvasElement
  width: number
  height: number
  /** Pixel block parameters */
  blocks: PixelBlock[]
}

/* ── Draw image with cover mode ──────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════════════ */
export function usePixelWaterfallEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<PixelWaterfallImage[]>,
  configRef: Ref<PixelWaterfallConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()

  /* ── Image element loading ─────────────────────────────────── */
  function loadImageElement(img: PixelWaterfallImage): Promise<HTMLImageElement> {
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

  /* ── Generate pixel block data ──────────────────────────────── */
  function generateBlocks(
    imageIndex: number,
    cols: number,
    rows: number,
    cfg: PixelWaterfallConfig,
  ): PixelBlock[] {
    const blocks: PixelBlock[] = []

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col
        const seed = imageIndex * 10000 + idx

        // Cascade delay depends on mode
        let cascadeDelay: number
        if (cfg.cascadeMode === 'columns') {
          // Column-based waterfall: left-to-right with bottom-to-top within each column
          const colDelay = col / (cols - 1 || 1)
          const rowDelay = (rows - 1 - row) / (rows - 1 || 1) * 0.3
          cascadeDelay = colDelay * 0.6 + rowDelay * 0.4
        } else if (cfg.cascadeMode === 'rows') {
          // Row-based: top rows fall first
          cascadeDelay = row / (rows - 1 || 1)
        } else if (cfg.cascadeMode === 'wave') {
          // Wave pattern: sine wave across columns
          const phase = (col / (cols - 1 || 1)) * Math.PI * 2
          const waveVal = (Math.sin(phase + imageIndex * 1.5) + 1) / 2
          const rowFactor = row / (rows - 1 || 1) * 0.3
          cascadeDelay = waveVal * 0.6 + rowFactor * 0.4
        } else {
          // Random
          cascadeDelay = seededRandom(seed + 10)
        }

        // Drift direction
        const driftDir = (seededRandom(seed + 1) - 0.5) * 2

        // Rotation speed
        const rotSpeed = (seededRandom(seed + 2) - 0.5) * 2

        blocks.push({
          col,
          row,
          cascadeDelay,
          driftDir,
          rotSpeed,
          seed,
        })
      }
    }

    return blocks
  }

  /* ── Pre-compute for a single image ────────────────────────── */
  function precomputeImage(image: PixelWaterfallImage, index: number): void {
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

    const pixelSize = cfg.pixelSize
    const cols = Math.ceil(CW / pixelSize)
    const rows = Math.ceil(CH / pixelSize)

    const blocks = generateBlocks(index, cols, rows, cfg)

    precomputed.set(image.id, {
      offscreen: off,
      width: CW,
      height: CH,
      blocks,
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

  /* ── Time helpers ───────────────────────────────────────────── */
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

  /* ── Render static frame (preview / editing) ───────────────── */
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

    // Static preview: show the full image with a subtle pixel grid overlay
    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(data.offscreen, 0, 0)

    // Draw subtle pixel grid to hint at blocks
    const cfg = configRef.value
    const pixelSize = cfg.pixelSize

    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 0.5

    for (let x = pixelSize; x < canvas.width; x += pixelSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    for (let y = pixelSize; y < canvas.height; y += pixelSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  /* ── Core render frame ─────────────────────────────────────── */
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

    const pixelSize = cfg.pixelSize
    const gravity = cfg.gravity
    const drift = cfg.drift
    const trailEnabled = cfg.trailEnabled

    const blocks = data.blocks

    // ── Cascade timing: 40% of total time is for stagger
    const staggerRange = 0.4
    const fallDuration = 1 - staggerRange

    // ── Determine next image for reveal
    const nextImageIndex = (imageIndex + 1) % images.length
    const nextImage = images[nextImageIndex]
    const nextData = precomputed.get(nextImage?.id)

    // ── Phase 1: Draw the "incoming" or "revealed" image underneath
    if (rawProgress > 0 && nextData && images.length > 1) {
      // During the fall transition, show next image underneath
      ctx.drawImage(nextData.offscreen, 0, 0)
    } else if (rawProgress >= 1) {
      // In pause phase, show current image fully
      ctx.drawImage(data.offscreen, 0, 0)
      return
    } else {
      // Before transition starts or single image
      ctx.drawImage(data.offscreen, 0, 0)
      return
    }

    // ── Phase 2: Draw falling pixel blocks of the current image on top
    for (const block of blocks) {
      // Per-block progress with cascade stagger
      const blockDelay = block.cascadeDelay * staggerRange
      const localProgress = Math.max(0, Math.min(1, (rawProgress - blockDelay) / fallDuration))

      if (localProgress <= 0) {
        // Block hasn't started falling yet — draw it in place
        const srcX = block.col * pixelSize
        const srcY = block.row * pixelSize
        const drawW = Math.min(pixelSize, width - srcX)
        const drawH = Math.min(pixelSize, height - srcY)
        if (drawW <= 0 || drawH <= 0) continue

        ctx.drawImage(
          data.offscreen,
          srcX, srcY, drawW, drawH,
          srcX, srcY, drawW, drawH,
        )
        continue
      }

      if (localProgress >= 1) {
        // Block has fully fallen away — don't draw it (next image shows through)
        continue
      }

      // ── Falling animation
      const easedFall = easeInQuad(localProgress) // accelerating fall
      const easedSpin = easeInCubic(localProgress)

      const srcX = block.col * pixelSize
      const srcY = block.row * pixelSize
      const drawW = Math.min(pixelSize, width - srcX)
      const drawH = Math.min(pixelSize, height - srcY)
      if (drawW <= 0 || drawH <= 0) continue

      // Fall distance: accelerate downward
      const maxFallDist = height * 1.2 * gravity
      const fallY = easedFall * maxFallDist

      // Horizontal drift
      const driftX = block.driftDir * drift * pixelSize * 3 * easedFall

      // Rotation
      const rotation = block.rotSpeed * easedSpin * Math.PI * 2

      // Scale: shrink slightly as they fall
      const scale = 1 - localProgress * 0.3

      // Opacity: fade out in the last 30% of the fall
      const opacity = localProgress > 0.7 ? 1 - (localProgress - 0.7) / 0.3 : 1

      if (opacity <= 0) continue

      // Compute final position
      const centerX = srcX + drawW / 2 + driftX
      const centerY = srcY + drawH / 2 + fallY

      // Skip if completely off-screen
      if (centerY - drawH > height || centerX + drawW < 0 || centerX - drawW > width) continue

      ctx.save()
      ctx.globalAlpha = opacity
      ctx.translate(centerX, centerY)
      ctx.rotate(rotation)
      ctx.scale(scale, scale)

      // Draw the pixel block
      ctx.drawImage(
        data.offscreen,
        srcX, srcY, drawW, drawH,
        -drawW / 2, -drawH / 2, drawW, drawH,
      )

      // ── Trail effect: subtle glow/streak behind falling blocks
      if (trailEnabled && localProgress > 0.05) {
        const trailAlpha = opacity * 0.3 * localProgress
        ctx.fillStyle = `rgba(255, 255, 255, ${trailAlpha})`
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, 2)
      }

      ctx.restore()
    }

    // ── Optional: waterfall mist effect at the bottom
    if (rawProgress > 0.2 && rawProgress < 0.95) {
      const mistAlpha = Math.sin((rawProgress - 0.2) / 0.75 * Math.PI) * 0.15
      const gradient = ctx.createLinearGradient(0, height * 0.85, 0, height)
      gradient.addColorStop(0, `rgba(200, 220, 255, 0)`)
      gradient.addColorStop(0.5, `rgba(200, 220, 255, ${mistAlpha})`)
      gradient.addColorStop(1, `rgba(200, 220, 255, ${mistAlpha * 0.5})`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, height * 0.85, width, height * 0.15)
    }

    // After transition complete, cross-fade to clean next image
    if (rawProgress >= 0.9 && nextData && images.length > 1) {
      const overlayAlpha = Math.min(1, (rawProgress - 0.9) / 0.1)
      ctx.save()
      ctx.globalAlpha = overlayAlpha
      ctx.drawImage(nextData.offscreen, 0, 0)
      ctx.restore()
    }
  }

  /* ── Playback info (for status bar) ────────────────────────── */
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

  /* ── Export video ───────────────────────────────────────────── */
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

  /* ── Cancel export ─────────────────────────────────────────── */
  function cancelExport() {
    exportCancelled = true
  }

  /* ── Cleanup ───────────────────────────────────────────────── */
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
