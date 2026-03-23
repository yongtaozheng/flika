import { type Ref, onUnmounted } from 'vue'
import type { DiffusionImage, DiffusionConfig } from '../types'

/* ── Pre-computed data per image ─────────────────────────────────────────── */
interface PrecomputedData {
  originalData: Uint8ClampedArray
  grayscaleData: Uint8ClampedArray
  distanceField: Float32Array
  maxDist: number
  width: number
  height: number
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
): { field: Float32Array; maxDist: number } {
  const field = new Float32Array(width * height)
  let maxDist = 0

  const pxPoints = points.map((p) => ({ x: p.x * width, y: p.y * height }))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minDist = Infinity
      for (const pt of pxPoints) {
        const dx = x - pt.x
        const dy = y - pt.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < minDist) minDist = dist
      }
      const idx = y * width + x
      field[idx] = minDist
      if (minDist > maxDist) maxDist = minDist
    }
  }

  return { field, maxDist }
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
    let maxDist: number

    if (image.points.length > 0) {
      const result = computeDistanceField(CW, CH, image.points)
      distanceField = result.field
      maxDist = result.maxDist
    } else {
      distanceField = new Float32Array(CW * CH).fill(Infinity)
      maxDist = Infinity
    }

    precomputed.set(image.id, {
      originalData,
      grayscaleData,
      distanceField,
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

  /* ── Core render frame at given elapsed time (ms) ────────────────────── */
  function renderFrame(elapsedMs: number): void {
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
    const totalPerImage = cfg.spreadDuration + cfg.pauseDuration
    const totalCycle = images.length * totalPerImage

    let effectiveTime = elapsedMs
    if (cfg.loop) {
      effectiveTime = elapsedMs % totalCycle
    } else {
      effectiveTime = Math.min(elapsedMs, totalCycle - 1)
    }

    // Determine current image and phase
    const imageIndex = Math.min(
      Math.floor(effectiveTime / totalPerImage),
      images.length - 1,
    )
    const imageTime = effectiveTime - imageIndex * totalPerImage

    const image = images[imageIndex]
    const data = precomputed.get(image.id)
    if (!data) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      return
    }

    const spreadProgress = Math.min(1, imageTime / cfg.spreadDuration)
    const currentRadius = spreadProgress * data.maxDist
    const edgeWidth = cfg.edgeWidth

    // Ripple wave parameters
    const RIPPLE_COUNT = 3          // number of trailing ripple rings
    const RIPPLE_SPACING = 40       // px between rings
    const RIPPLE_WIDTH = 6          // width of each ripple band (px)
    const RIPPLE_BRIGHTNESS = 0.45  // max brightness boost at wavefront

    const output = ctx.createImageData(width, height)
    const outData = output.data
    const { originalData, grayscaleData, distanceField } = data
    const pixelCount = width * height

    for (let i = 0; i < pixelCount; i++) {
      const dist = distanceField[i]
      const px = i * 4

      let r: number, g: number, b: number

      if (dist <= currentRadius - edgeWidth) {
        // Fully colored
        r = originalData[px]
        g = originalData[px + 1]
        b = originalData[px + 2]
      } else if (dist <= currentRadius) {
        // Transition zone
        const t = smoothstep((currentRadius - dist) / edgeWidth)
        r = grayscaleData[px] + (originalData[px] - grayscaleData[px]) * t
        g = grayscaleData[px + 1] + (originalData[px + 1] - grayscaleData[px + 1]) * t
        b = grayscaleData[px + 2] + (originalData[px + 2] - grayscaleData[px + 2]) * t
      } else {
        // Fully grayscale
        r = grayscaleData[px]
        g = grayscaleData[px + 1]
        b = grayscaleData[px + 2]
      }

      // Ripple wave brightness boost — concentric rings trailing behind wavefront
      if (cfg.rippleEnabled && spreadProgress > 0 && spreadProgress < 1) {
        let rippleBoost = 0
        for (let w = 0; w < RIPPLE_COUNT; w++) {
          const ringRadius = currentRadius - w * RIPPLE_SPACING
          if (ringRadius <= 0) break
          const d = Math.abs(dist - ringRadius)
          if (d < RIPPLE_WIDTH) {
            // Gaussian-like falloff within the ring band
            const intensity = Math.cos((d / RIPPLE_WIDTH) * Math.PI * 0.5)
            // Outer rings fade out, all rings fade near start/end of animation
            const ringFade = (1 - w / RIPPLE_COUNT) * Math.sin(spreadProgress * Math.PI)
            rippleBoost = Math.max(rippleBoost, intensity * ringFade * RIPPLE_BRIGHTNESS)
          }
        }
        if (rippleBoost > 0) {
          // Additive light tint (slight blue-white for water ripple feel)
          r = Math.min(255, r + 200 * rippleBoost)
          g = Math.min(255, g + 220 * rippleBoost)
          b = Math.min(255, b + 255 * rippleBoost)
        }
      }

      outData[px] = r
      outData[px + 1] = g
      outData[px + 2] = b
      outData[px + 3] = originalData[px + 3]
    }

    ctx.putImageData(output, 0, 0)

    // Draw glowing ripple arcs from each diffusion point (canvas overlay)
    if (cfg.rippleEnabled && spreadProgress > 0 && spreadProgress < 1 && image.points.length > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      for (const pt of image.points) {
        const cx = pt.x * width
        const cy = pt.y * height
        for (let w = 0; w < RIPPLE_COUNT; w++) {
          const ringR = currentRadius - w * RIPPLE_SPACING
          if (ringR <= 2) continue
          const fade = (1 - w / RIPPLE_COUNT) * Math.sin(spreadProgress * Math.PI)
          const alpha = Math.max(0, fade * 0.35)
          const lineW = Math.max(1, 2.5 - w * 0.6)
          ctx.beginPath()
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(180, 210, 255, ${alpha})`
          ctx.lineWidth = lineW
          ctx.stroke()
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

    const totalPerImage = cfg.spreadDuration + cfg.pauseDuration
    const totalCycle = images.length * totalPerImage

    let effectiveTime = cfg.loop ? elapsedMs % totalCycle : Math.min(elapsedMs, totalCycle - 1)
    const imageIndex = Math.min(
      Math.floor(effectiveTime / totalPerImage),
      images.length - 1,
    )
    const imageTime = effectiveTime - imageIndex * totalPerImage

    if (imageTime <= cfg.spreadDuration) {
      return {
        index: imageIndex,
        phase: 'spreading' as const,
        progress: imageTime / cfg.spreadDuration,
      }
    }
    return {
      index: imageIndex,
      phase: 'pausing' as const,
      progress: 1,
    }
  }

  /* ── Export video ────────────────────────────────────────────────────── */
  async function exportVideo(
    onProgress?: (p: number) => void,
  ): Promise<Blob> {
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas not available')

    await preloadImages()
    precomputeAll()

    const cfg = configRef.value
    const images = imagesRef.value
    const totalDuration = images.length * (cfg.spreadDuration + cfg.pauseDuration)

    const FPS = 30
    const FRAME_MS = 1000 / FPS
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    const stream = canvas.captureStream(FPS)
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }

    return new Promise<Blob>((resolve, reject) => {
      recorder.onerror = reject
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
      recorder.start()

      let elapsed = 0
      function tick() {
        if (elapsed >= totalDuration) {
          recorder.stop()
          return
        }
        renderFrame(elapsed)
        onProgress?.(elapsed / totalDuration)
        elapsed += FRAME_MS
        setTimeout(tick, FRAME_MS)
      }
      tick()
    })
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
    exportVideo,
    cleanup,
  }
}
