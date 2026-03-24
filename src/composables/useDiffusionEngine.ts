import { type Ref, onUnmounted } from 'vue'
import type { Beat, DiffusionImage, DiffusionConfig } from '../types'

/* ── Pre-computed data per image ─────────────────────────────────────────── */
interface PrecomputedData {
  originalData: Uint8ClampedArray
  grayscaleData: Uint8ClampedArray
  distanceField: Float32Array
  /** Pre-computed cos(angle) for radial wave displacement — avoids trig in hot loop */
  cosAngle: Float32Array
  /** Pre-computed sin(angle) for radial wave displacement */
  sinAngle: Float32Array
  maxDist: number
  width: number
  height: number
}

/* ── Resolved time-slot info ─────────────────────────────────────────────── */
interface ResolvedSlot {
  imageIndex: number
  imageTime: number
  /** The spread duration that applies to this slot (may differ from per-image value in beat mode) */
  effectiveSpreadDuration: number
}

/* ── Smoothstep helper ───────────────────────────────────────────────────── */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/* ── Grayscale conversion (luminance) ────────────────────────────────────── */
function toGrayscale(data: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    gray[i] = gray[i + 1] = gray[i + 2] = lum
    gray[i + 3] = data[i + 3]
  }
  return gray
}

/* ── Distance field computation ──────────────────────────────────────────── */
function computeDistanceField(
  width: number,
  height: number,
  points: { x: number; y: number }[],
): { field: Float32Array; cosAngle: Float32Array; sinAngle: Float32Array; maxDist: number } {
  const field = new Float32Array(width * height)
  const cosAngle = new Float32Array(width * height)
  const sinAngle = new Float32Array(width * height)
  let maxDist = 0

  const pxPoints = points.map((p) => ({ x: p.x * width, y: p.y * height }))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minDist = Infinity
      let nearDx = 0
      let nearDy = 0
      for (const pt of pxPoints) {
        const dx = x - pt.x
        const dy = y - pt.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < minDist) {
          minDist = dist
          nearDx = dx
          nearDy = dy
        }
      }
      const idx = y * width + x
      field[idx] = minDist
      // Pre-compute trig so the render hot-loop only does array lookups
      const angle = Math.atan2(nearDy, nearDx)
      cosAngle[idx] = Math.cos(angle)
      sinAngle[idx] = Math.sin(angle)
      if (minDist > maxDist) maxDist = minDist
    }
  }

  return { field, cosAngle, sinAngle, maxDist }
}

/* ── Draw image with cover mode ──────────────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════════════════════ */
export function useDiffusionEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<DiffusionImage[]>,
  configRef: Ref<DiffusionConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────────────── */
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

  /* ── Image element loading ───────────────────────────────────────────── */
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

  /* ── Pre-compute for a single image ──────────────────────────────────── */
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

  /* ── Render a static grayscale frame (for preview / editing) ─────────── */
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
      // Fallback: draw original image
      const el = imageCache.get(images[index].id)
      if (el) drawCover(ctx, el, canvas.width, canvas.height)
      return
    }

    // Show fully grayscale
    const output = ctx.createImageData(data.width, data.height)
    output.data.set(data.grayscaleData)
    ctx.putImageData(output, 0, 0)
  }

  /* ── Helpers: per-image timing (manual mode) ─────────────────────────── */
  function getManualTotalDuration(): number {
    let total = 0
    for (const img of imagesRef.value) {
      total += img.spreadDuration + img.pauseDuration
    }
    return total
  }

  function resolveManual(effectiveTime: number): ResolvedSlot {
    const images = imagesRef.value
    let acc = 0
    for (let i = 0; i < images.length; i++) {
      const imgTotal = images[i].spreadDuration + images[i].pauseDuration
      if (acc + imgTotal > effectiveTime) {
        return {
          imageIndex: i,
          imageTime: effectiveTime - acc,
          effectiveSpreadDuration: images[i].spreadDuration,
        }
      }
      acc += imgTotal
    }
    // Past the end — clamp to last image
    const lastIdx = images.length - 1
    let lastStart = 0
    for (let i = 0; i < lastIdx; i++) {
      lastStart += images[i].spreadDuration + images[i].pauseDuration
    }
    return {
      imageIndex: lastIdx,
      imageTime: effectiveTime - lastStart,
      effectiveSpreadDuration: images[lastIdx].spreadDuration,
    }
  }

  /* ── Helpers: beat-sync mode ─────────────────────────────────────────── */
  function getBeatTotalDuration(): number {
    const beats = beatsRef.value
    if (beats.length < 2) return getManualTotalDuration()
    // Duration covers all beat segments
    return beats[beats.length - 1].time * 1000
  }

  function resolveBeatSync(effectiveTimeMs: number): ResolvedSlot {
    const beats = beatsRef.value
    const images = imagesRef.value
    const imgCount = images.length

    if (beats.length < 2 || imgCount === 0) {
      return resolveManual(effectiveTimeMs)
    }

    const effectiveTimeSec = effectiveTimeMs / 1000

    // Find which beat segment we're in
    for (let i = 0; i < beats.length - 1; i++) {
      const segStart = beats[i].time
      const segEnd = beats[i + 1].time
      if (effectiveTimeSec < segEnd) {
        const imageIndex = i % imgCount
        const segDurationMs = (segEnd - segStart) * 1000
        const imageTimeMs = (effectiveTimeSec - segStart) * 1000
        return {
          imageIndex,
          imageTime: imageTimeMs,
          effectiveSpreadDuration: segDurationMs,
        }
      }
    }

    // Past the last beat — show last image fully colored
    const lastBeatIdx = beats.length - 1
    const imageIndex = lastBeatIdx % imgCount
    return {
      imageIndex,
      imageTime: 0,
      effectiveSpreadDuration: 1, // effectively fully colored
    }
  }

  /* ── Unified resolve / total duration ────────────────────────────────── */
  function isBeatMode(): boolean {
    return configRef.value.beatSyncEnabled && beatsRef.value.length >= 2
  }

  function getTotalCycleDuration(): number {
    return isBeatMode() ? getBeatTotalDuration() : getManualTotalDuration()
  }

  function resolveImageAtTime(effectiveTime: number): ResolvedSlot {
    return isBeatMode() ? resolveBeatSync(effectiveTime) : resolveManual(effectiveTime)
  }

  /* ── Core render frame at given elapsed time (ms) ────────────────────── */
  /**
   * @param step  Pixel sampling step (1 = full quality, 2 = 4× faster for export).
   *              step > 1 fills step×step blocks from a single sample.
   */
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

    // Determine current image and phase
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

    // Wave ripple parameters (sinusoidal radial displacement — inspired by water ripple)
    const WAVE_COUNT = 3           // number of simultaneous wave rings
    const WAVE_WIDTH = 60          // pixel width of each wave cycle
    const WAVE_AMPLITUDE = 18      // max radial pixel displacement
    const WAVE_ZONE = WAVE_WIDTH * WAVE_COUNT  // total affected zone behind wavefront

    const output = ctx.createImageData(width, height)
    const outData = output.data
    const { originalData, grayscaleData, distanceField, cosAngle, sinAngle } = data
    const rippleActive = cfg.rippleEnabled && spreadProgress > 0 && spreadProgress < 1
    // Smooth fade at animation boundaries so ripple doesn't pop in/out
    const animFade = rippleActive ? Math.sin(spreadProgress * Math.PI) : 0

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = y * width + x
        const dist = distanceField[idx]

        // ── Wave displacement ──────────────────────────────────────────
        let srcX = x
        let srcY = y

        if (rippleActive) {
          const relDist = currentRadius - dist  // positive = inside wavefront
          if (relDist > 0 && relDist < WAVE_ZONE) {
            // Sinusoidal phase creates concentric wave rings
            const wavePhase = (relDist / WAVE_WIDTH) * Math.PI * 2
            // Exponential decay: waves fade as they get further from the front
            const amplitude = WAVE_AMPLITUDE
              * Math.sin(wavePhase)
              * Math.exp(-relDist / WAVE_ZONE * 2)
              * animFade

            // Push pixel radially — use pre-computed cos/sin (no trig here)
            srcX = x + cosAngle[idx] * amplitude
            srcY = y + sinAngle[idx] * amplitude
          }
        }

        // Clamp to canvas bounds
        srcX = Math.max(0, Math.min(width - 1, Math.round(srcX)))
        srcY = Math.max(0, Math.min(height - 1, Math.round(srcY)))
        const srcPx = (srcY * width + srcX) * 4

        // ── Color / grayscale blending (based on original dist, not displaced) ─
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

        // Fill step × step block (step=1 writes single pixel, step=2 fills 2×2 etc.)
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

    // Clear canvas to black first so alpha transparency is visible
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.putImageData(output, 0, 0)

    // Wave highlight rings — concentric arcs from each diffusion point
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

  /* ── Playback info (for status bar) ──────────────────────────────────── */
  function getPlaybackInfo(elapsedMs: number) {
    const images = imagesRef.value
    const cfg = configRef.value
    if (images.length === 0) return { index: 0, phase: 'idle' as const, progress: 0 }

    const totalCycle = getTotalCycleDuration()

    let effectiveTime = cfg.loop ? elapsedMs % totalCycle : Math.min(elapsedMs, totalCycle - 1)
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

  /* ── Export video (optional audio mux) ─────────────────────────────────── */
  async function exportVideo(
    onProgress?: (p: number) => void,
    audioElement?: HTMLAudioElement | null,
    /** Override the total export duration (ms). If omitted, defaults to one cycle. */
    exportDurationMs?: number,
  ): Promise<Blob> {
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas not available')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas context not available')

    await preloadImages()
    precomputeAll()

    const totalDuration = exportDurationMs ?? getTotalCycleDuration()

    const FPS = 30
    const FRAME_MS = 1000 / FPS
    const totalFrames = Math.ceil(totalDuration / FRAME_MS)
    const { width, height } = canvas

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    // Build the combined MediaStream (canvas video + optional audio)
    const videoStream = canvas.captureStream(FPS)
    let combinedStream: MediaStream = videoStream
    let audioCtx: AudioContext | null = null
    const hasAudio = !!(audioElement && isBeatMode())

    if (hasAudio) {
      try {
        audioCtx = new AudioContext()
        const source = audioCtx.createMediaElementSource(audioElement!)
        const dest = audioCtx.createMediaStreamDestination()
        source.connect(dest)
        source.connect(audioCtx.destination) // keep audible for user
        combinedStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ])
      } catch {
        combinedStream = videoStream
      }
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

    const cleanupAndFinalize = () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onerror = reject
        recorder.onstop = () => {
          if (audioElement) audioElement.pause()
          if (audioCtx) audioCtx.close().catch(() => {})
          resolve(new Blob(chunks, { type: 'video/webm' }))
        }
        recorder.stop()
      })

    if (hasAudio) {
      /* ── Audio export: audio drives the clock ──────────────────────────
       * Audio plays at normal speed → MediaRecorder duration = audio duration.
       * Video renders at audio's current position so frames stay in sync.
       * If rendering is slow some frames may duplicate, but duration is correct.
       */
      audioElement!.currentTime = 0
      await audioElement!.play().catch(() => {})
      recorder.start()

      const totalSec = totalDuration / 1000
      return new Promise<Blob>((resolve, reject) => {
        recorder.onerror = reject
        recorder.onstop = () => {
          audioElement!.pause()
          if (audioCtx) audioCtx.close().catch(() => {})
          resolve(new Blob(chunks, { type: 'video/webm' }))
        }
        function tick() {
          const t = audioElement!.currentTime
          if (t >= totalSec) {
            recorder.stop()
            return
          }
          renderFrame(t * 1000, 2)
          onProgress?.(t / totalSec)
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    }

    /* ── No-audio export: chunked pre-render + real-time playback ─────────
     * Phase A (recorder paused): render frames offline — can be slow.
     * Phase B (recorder active):  putImageData in real-time — trivially fast.
     * This completely decouples rendering speed from video duration.
     */
    const CHUNK = FPS // 30 frames per chunk ≈ 1 second, ~110 MB buffer

    recorder.start()
    recorder.pause() // start paused; only record during real-time playback

    for (let cs = 0; cs < totalFrames; cs += CHUNK) {
      const ce = Math.min(cs + CHUNK, totalFrames)

      // Phase A — pre-render chunk offline (recorder paused, no time penalty)
      const frameBuffer: ImageData[] = []
      for (let i = cs; i < ce; i++) {
        renderFrame(i * FRAME_MS) // full quality, step = 1
        frameBuffer.push(ctx.getImageData(0, 0, width, height))
      }

      // Phase B — play back chunk in real-time (recorder active)
      recorder.resume()
      const playStart = performance.now()
      for (let i = 0; i < frameBuffer.length; i++) {
        ctx.putImageData(frameBuffer[i], 0, 0)
        const nextTarget = playStart + (i + 1) * FRAME_MS
        const delay = Math.max(1, nextTarget - performance.now())
        await sleep(delay)
      }
      recorder.pause()

      onProgress?.(ce / totalFrames)
    }

    // Finalize
    recorder.resume()
    await sleep(100) // ensure last frames are captured
    return cleanupAndFinalize()
  }

  /* ── Cleanup ─────────────────────────────────────────────────────────── */
  function cleanup() {
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
    cleanup,
  }
}
