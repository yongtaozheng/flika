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
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, cw, ch)
  const sw = el.naturalWidth
  const sh = el.naturalHeight
  if (!sw || !sh) return
  const scale = Math.max(cw / sw, ch / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(el, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
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
      ctx.fillStyle = '#000'
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
      ctx.fillStyle = '#000'
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
      ctx.fillStyle = '#000'
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

    ctx.fillStyle = '#000'
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

    const videoStream = canvas.captureStream(FPS)
    let combinedStream: MediaStream = videoStream
    let audioCtx: AudioContext | null = null

    try {
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaElementSource(audioElement)
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
      videoBitsPerSecond: 5_000_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

    audioElement.currentTime = 0
    await audioElement.play().catch(() => {})
    recorder.start()

    const totalSec = totalDuration / 1000

    return new Promise<Blob>((resolve, reject) => {
      recorder.onerror = reject
      recorder.onstop = () => {
        audioElement.pause()
        if (audioCtx) audioCtx.close().catch(() => {})
        resolve(new Blob(chunks, { type: 'video/webm' }))
      }
      function tick() {
        if (audioCancelled) {
          audioElement.pause()
          recorder.stop()
          return
        }
        const t = audioElement.currentTime
        if (t >= totalSec) {
          recorder.stop()
          return
        }
        // 以音频当前时间驱动渲染 —— 帧和节拍完美同步
        renderFrame(t * 1000, 2)
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
