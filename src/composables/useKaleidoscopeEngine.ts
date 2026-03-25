// ─────────────────────────────────────────────────────────────────────────────
// 万花筒棱镜引擎 — Canvas 2D 万花筒镜像 + 棱镜彩虹转场动画
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, KaleidoscopeImage, KaleidoscopeConfig } from '../types'
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
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

/* ── Pre-computed data per image ──────────────────────────────────── */
interface PrecomputedData {
  offscreen: HTMLCanvasElement
  width: number
  height: number
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

/* ── Draw kaleidoscope pattern onto a canvas ──────────────────────── */
function drawKaleidoscope(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  cw: number,
  ch: number,
  segments: number,
  rotation: number,
  zoom: number,
  reflectMode: 'mirror' | 'repeat',
  cx: number,
  cy: number,
) {
  const sectorAngle = (Math.PI * 2) / segments

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rotation)

  for (let i = 0; i < segments; i++) {
    ctx.save()
    ctx.rotate(i * sectorAngle)

    // Clip to triangular sector
    ctx.beginPath()
    ctx.moveTo(0, 0)
    const reach = Math.sqrt(cw * cw + ch * ch) * 1.5
    ctx.lineTo(reach * Math.cos(0), reach * Math.sin(0))
    ctx.arc(0, 0, reach, 0, sectorAngle)
    ctx.lineTo(0, 0)
    ctx.closePath()
    ctx.clip()

    // Mirror every other segment for kaleidoscope effect
    if (reflectMode === 'mirror' && i % 2 === 1) {
      ctx.scale(1, -1)
      ctx.rotate(sectorAngle)
    }

    // Draw the source image centered at origin with zoom
    ctx.save()
    ctx.scale(zoom, zoom)
    ctx.drawImage(source, -cx, -cy, cw, ch)
    ctx.restore()

    ctx.restore()
  }

  ctx.restore()
}

/* ═══════════════════════════════════════════════════════════════════ */
export function useKaleidoscopeEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<KaleidoscopeImage[]>,
  configRef: Ref<KaleidoscopeConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()

  /* ── Image element loading ─────────────────────────────────── */
  function loadImageElement(img: KaleidoscopeImage): Promise<HTMLImageElement> {
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

  /* ── Pre-compute for a single image ────────────────────────── */
  function precomputeImage(image: KaleidoscopeImage, _index: number): void {
    const el = imageCache.get(image.id)
    if (!el || !el.complete || !el.naturalWidth) return

    const CW = canvasRef.value?.width ?? 1280
    const CH = canvasRef.value?.height ?? 720

    const off = document.createElement('canvas')
    off.width = CW
    off.height = CH
    const offCtx = off.getContext('2d')!
    drawCover(offCtx, el, CW, CH)

    precomputed.set(image.id, {
      offscreen: off,
      width: CW,
      height: CH,
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

    const cfg = configRef.value
    const cw = canvas.width
    const ch = canvas.height
    const cx = cfg.centerX * cw
    const cy = cfg.centerY * ch

    // Clear
    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, cw, ch)

    // Draw static kaleidoscope preview
    drawKaleidoscope(
      ctx, data.offscreen, cw, ch,
      cfg.segments, 0, cfg.zoom,
      cfg.reflectMode, cx, cy,
    )

    // Subtle segment guide lines
    const sectorAngle = (Math.PI * 2) / cfg.segments
    const maxR = Math.sqrt(cw ** 2 + ch ** 2)
    ctx.save()
    ctx.globalAlpha = 0.06
    ctx.strokeStyle = `hsl(${cfg.prismHue}, 80%, 70%)`
    ctx.lineWidth = 1
    for (let i = 0; i < cfg.segments; i++) {
      const angle = i * sectorAngle
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.stroke()
    }
    // Center dot
    ctx.globalAlpha = 0.3
    ctx.fillStyle = `hsl(${cfg.prismHue}, 80%, 70%)`
    ctx.beginPath()
    ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fill()
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

    const { width: cw, height: ch } = canvas
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
      ctx.fillRect(0, 0, cw, ch)
      return
    }

    const rawProgress = Math.min(1, imageTime / effectiveSpreadDuration)
    const cx = cfg.centerX * cw
    const cy = cfg.centerY * ch

    // Clear canvas
    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, cw, ch)

    // Determine next image
    const nextImageIndex = (imageIndex + 1) % images.length
    const nextImage = images[nextImageIndex]
    const nextData = precomputed.get(nextImage?.id)

    // ── No transition, single image, or pause phase: show kaleidoscope of current
    if (rawProgress >= 1 || images.length <= 1 || rawProgress <= 0) {
      const baseRotation = elapsedMs * 0.0001 * cfg.rotationSpeed
      drawKaleidoscope(
        ctx, data.offscreen, cw, ch,
        cfg.segments, baseRotation, cfg.zoom,
        cfg.reflectMode, cx, cy,
      )
      return
    }

    // ── Transition animation ────────────────────────────────────
    const easedProgress = easeInOutCubic(rawProgress)
    const rotationBase = elapsedMs * 0.0001 * cfg.rotationSpeed

    // Phase 1: Current image kaleidoscope with increasing rotation speed
    const transRotationBoost = rawProgress * cfg.rotationSpeed * Math.PI * 0.5
    const currentRotation = rotationBase + transRotationBoost

    // Phase 2: Zoom pulse during transition
    const zoomPulse = cfg.zoom + Math.sin(rawProgress * Math.PI) * 0.3

    // Phase 3: Segment count morphing effect
    // During mid-transition, briefly double the segments for a dazzling effect
    const segmentMultiplier = 1 + Math.sin(rawProgress * Math.PI) * 0.5
    const effectiveSegments = Math.round(cfg.segments * segmentMultiplier)

    if (rawProgress < 0.5) {
      // First half: dissolve current image with kaleidoscope spin
      const fadeOut = easeOutQuart(rawProgress * 2)

      // Draw current image kaleidoscope
      drawKaleidoscope(
        ctx, data.offscreen, cw, ch,
        effectiveSegments, currentRotation, zoomPulse,
        cfg.reflectMode, cx, cy,
      )

      // Overlay next image kaleidoscope with increasing opacity
      if (nextData) {
        ctx.save()
        ctx.globalAlpha = fadeOut * 0.6
        drawKaleidoscope(
          ctx, nextData.offscreen, cw, ch,
          effectiveSegments, currentRotation + Math.PI / cfg.segments, zoomPulse * 1.1,
          cfg.reflectMode, cx, cy,
        )
        ctx.restore()
      }
    } else {
      // Second half: next image kaleidoscope solidifies
      const fadeIn = easeOutQuart((rawProgress - 0.5) * 2)

      if (nextData) {
        // Draw next image kaleidoscope (settling)
        const settleRotation = rotationBase + transRotationBoost * (1 - fadeIn)
        const settleZoom = zoomPulse + (cfg.zoom - zoomPulse) * fadeIn
        const settleSegments = effectiveSegments + Math.round((cfg.segments - effectiveSegments) * fadeIn)

        drawKaleidoscope(
          ctx, nextData.offscreen, cw, ch,
          Math.max(3, settleSegments), settleRotation, settleZoom,
          cfg.reflectMode, cx, cy,
        )

        // Ghost of current image fading out
        ctx.save()
        ctx.globalAlpha = (1 - fadeIn) * 0.4
        drawKaleidoscope(
          ctx, data.offscreen, cw, ch,
          effectiveSegments, currentRotation, zoomPulse,
          cfg.reflectMode, cx, cy,
        )
        ctx.restore()
      } else {
        drawKaleidoscope(
          ctx, data.offscreen, cw, ch,
          effectiveSegments, currentRotation, zoomPulse,
          cfg.reflectMode, cx, cy,
        )
      }
    }

    // ── Prism rainbow edge glow ─────────────────────────────────
    const prismIntensity = cfg.prismIntensity
    if (prismIntensity > 0 && rawProgress > 0.02 && rawProgress < 0.95) {
      const glowAlpha = prismIntensity * Math.sin(rawProgress * Math.PI) * 0.5
      const sectorAngle = (Math.PI * 2) / cfg.segments
      const maxR = Math.sqrt(cw ** 2 + ch ** 2) * 1.2

      ctx.save()

      // Rainbow refraction lines along segment edges
      for (let i = 0; i < cfg.segments; i++) {
        const angle = i * sectorAngle + currentRotation
        const ex = cx + Math.cos(angle) * maxR
        const ey = cy + Math.sin(angle) * maxR

        // Each edge gets a different rainbow hue
        const edgeHue = (cfg.prismHue + (i / cfg.segments) * 360) % 360

        // Main prism line
        const grad = ctx.createLinearGradient(cx, cy, ex, ey)
        grad.addColorStop(0, `hsla(${edgeHue}, 100%, 85%, 0)`)
        grad.addColorStop(0.05, `hsla(${edgeHue}, 95%, 80%, ${glowAlpha * 0.9})`)
        grad.addColorStop(0.3, `hsla(${(edgeHue + 30) % 360}, 90%, 70%, ${glowAlpha * 0.6})`)
        grad.addColorStop(0.6, `hsla(${(edgeHue + 60) % 360}, 85%, 65%, ${glowAlpha * 0.3})`)
        grad.addColorStop(1, `hsla(${(edgeHue + 90) % 360}, 80%, 60%, 0)`)

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(ex, ey)
        ctx.strokeStyle = grad
        ctx.lineWidth = 2.5 + prismIntensity * 2
        ctx.stroke()

        // Secondary dispersion line (offset)
        const offsetAngle = angle + sectorAngle * 0.02
        const ex2 = cx + Math.cos(offsetAngle) * maxR
        const ey2 = cy + Math.sin(offsetAngle) * maxR

        const grad2 = ctx.createLinearGradient(cx, cy, ex2, ey2)
        grad2.addColorStop(0, `hsla(${(edgeHue + 120) % 360}, 100%, 90%, 0)`)
        grad2.addColorStop(0.15, `hsla(${(edgeHue + 120) % 360}, 90%, 80%, ${glowAlpha * 0.4})`)
        grad2.addColorStop(1, `hsla(${(edgeHue + 180) % 360}, 80%, 70%, 0)`)

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(ex2, ey2)
        ctx.strokeStyle = grad2
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // ── Center prism burst (diamond-shaped light refraction)
      const burstRadius = 15 + easedProgress * 25
      const burstGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, burstRadius)
      burstGrad.addColorStop(0, `hsla(${cfg.prismHue}, 100%, 95%, ${glowAlpha * 0.8})`)
      burstGrad.addColorStop(0.3, `hsla(${(cfg.prismHue + 60) % 360}, 90%, 85%, ${glowAlpha * 0.5})`)
      burstGrad.addColorStop(0.6, `hsla(${(cfg.prismHue + 120) % 360}, 85%, 75%, ${glowAlpha * 0.3})`)
      burstGrad.addColorStop(1, `hsla(${(cfg.prismHue + 180) % 360}, 80%, 65%, 0)`)

      ctx.fillStyle = burstGrad
      ctx.beginPath()
      ctx.arc(cx, cy, burstRadius, 0, Math.PI * 2)
      ctx.fill()

      // ── Rotating rainbow ring at mid-radius
      if (rawProgress > 0.1 && rawProgress < 0.85) {
        const ringRadius = maxR * 0.3 * easeOutQuart(rawProgress)
        const ringAlpha = glowAlpha * 0.3

        for (let i = 0; i < 36; i++) {
          const sparkAngle = currentRotation * 2 + (i / 36) * Math.PI * 2
          const sparkHue = (cfg.prismHue + i * 10) % 360
          const sx = cx + Math.cos(sparkAngle) * ringRadius
          const sy = cy + Math.sin(sparkAngle) * ringRadius

          ctx.fillStyle = `hsla(${sparkHue}, 90%, 80%, ${ringAlpha})`
          ctx.beginPath()
          ctx.arc(sx, sy, 2 + prismIntensity * 2, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      ctx.restore()
    }

    // ── Final cross-fade at end of transition for clean handoff
    if (rawProgress >= 0.9 && nextData) {
      const fadeAlpha = Math.min(1, (rawProgress - 0.9) / 0.1)
      ctx.save()
      ctx.globalAlpha = fadeAlpha
      drawKaleidoscope(
        ctx, nextData.offscreen, cw, ch,
        cfg.segments, rotationBase, cfg.zoom,
        cfg.reflectMode, cx, cy,
      )
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
