// ─────────────────────────────────────────────────────────────────────────────
// 径向光束引擎 — Canvas 2D 径向光束扫描转场动画
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, RadialBeamImage, RadialBeamConfig } from '../types'
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
  /** The pre-rendered cover-fit image as an offscreen canvas */
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

/* ═══════════════════════════════════════════════════════════════════ */
export function useRadialBeamEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<RadialBeamImage[]>,
  configRef: Ref<RadialBeamConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()

  /* ── Image element loading ─────────────────────────────────── */
  function loadImageElement(img: RadialBeamImage): Promise<HTMLImageElement> {
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
  function precomputeImage(image: RadialBeamImage, _index: number): void {
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

    // Static preview: show full image with subtle beam overlay hint
    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(data.offscreen, 0, 0)

    // Draw subtle radial beam guides
    const cfg = configRef.value
    const cx = cfg.centerX * canvas.width
    const cy = cfg.centerY * canvas.height
    const maxR = Math.sqrt(canvas.width ** 2 + canvas.height ** 2)
    const sectorAngle = (Math.PI * 2) / cfg.beamCount

    ctx.save()
    ctx.globalAlpha = 0.08
    ctx.strokeStyle = `hsl(${cfg.beamHue}, 80%, 70%)`
    ctx.lineWidth = 1

    for (let i = 0; i < cfg.beamCount; i++) {
      const angle = i * sectorAngle
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.stroke()
    }

    // Center dot
    ctx.globalAlpha = 0.3
    ctx.fillStyle = `hsl(${cfg.beamHue}, 80%, 70%)`
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

    // Determine next image
    const nextImageIndex = (imageIndex + 1) % images.length
    const nextImage = images[nextImageIndex]
    const nextData = precomputed.get(nextImage?.id)

    // ── No transition or single image: just show current image
    if (rawProgress >= 1 || images.length <= 1) {
      ctx.drawImage(data.offscreen, 0, 0)
      return
    }

    if (rawProgress <= 0) {
      ctx.drawImage(data.offscreen, 0, 0)
      return
    }

    // ── Radial beam transition
    const cx = cfg.centerX * width
    const cy = cfg.centerY * height
    const maxReach = Math.sqrt(width ** 2 + height ** 2) * 1.2
    const beamCount = cfg.beamCount
    const sectorAngle = (Math.PI * 2) / beamCount

    // Eased progress for smooth animation
    const easedProgress = easeInOutCubic(rawProgress)

    // Beam reach extends from center outward
    const reachProgress = easeOutQuart(rawProgress)
    const currentReach = reachProgress * maxReach

    // Beam angular width grows with progress
    // At progress=0: beams are thin (10% of sector)
    // At progress=1: beams cover entire sector (100%)
    const minBeamFraction = 0.05
    const beamFraction = minBeamFraction + (1 - minBeamFraction) * easedProgress
    const halfBeamAngle = (sectorAngle * beamFraction * cfg.beamWidth) / 2

    // Rotation offset
    const rotationOffset = rawProgress * cfg.rotationSpeed * Math.PI * 2

    // ── Phase 1: Draw current image (background)
    ctx.drawImage(data.offscreen, 0, 0)

    // ── Phase 2: Draw beams revealing next image
    if (nextData) {
      ctx.save()

      // Create beam clipping path
      ctx.beginPath()
      for (let i = 0; i < beamCount; i++) {
        const baseAngle = i * sectorAngle + rotationOffset
        const startAngle = baseAngle - halfBeamAngle
        const endAngle = baseAngle + halfBeamAngle

        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, currentReach, startAngle, endAngle)
        ctx.lineTo(cx, cy)
      }
      ctx.clip()

      // Draw next image through beam mask
      ctx.drawImage(nextData.offscreen, 0, 0)
      ctx.restore()
    }

    // ── Phase 3: Glow effects along beam edges
    const glowIntensity = cfg.glowIntensity
    if (glowIntensity > 0 && rawProgress > 0.02 && rawProgress < 0.95) {
      const glowAlpha = glowIntensity * Math.sin(rawProgress * Math.PI) * 0.6
      const hue = cfg.beamHue

      ctx.save()

      // Draw glow lines at beam edges
      for (let i = 0; i < beamCount; i++) {
        const baseAngle = i * sectorAngle + rotationOffset
        const edgeAngle1 = baseAngle - halfBeamAngle
        const edgeAngle2 = baseAngle + halfBeamAngle

        for (const edgeAngle of [edgeAngle1, edgeAngle2]) {
          const ex = cx + Math.cos(edgeAngle) * currentReach
          const ey = cy + Math.sin(edgeAngle) * currentReach

          // Main glow line
          const grad = ctx.createLinearGradient(cx, cy, ex, ey)
          grad.addColorStop(0, `hsla(${hue}, 90%, 80%, 0)`)
          grad.addColorStop(0.1, `hsla(${hue}, 90%, 80%, ${glowAlpha * 0.8})`)
          grad.addColorStop(0.5, `hsla(${hue}, 85%, 70%, ${glowAlpha * 0.5})`)
          grad.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`)

          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(ex, ey)
          ctx.strokeStyle = grad
          ctx.lineWidth = 2.5
          ctx.stroke()
        }
      }

      // ── Center burst glow
      const burstRadius = 20 + currentReach * 0.05
      const burstGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, burstRadius)
      burstGrad.addColorStop(0, `hsla(${hue}, 90%, 90%, ${glowAlpha * 0.9})`)
      burstGrad.addColorStop(0.3, `hsla(${hue}, 85%, 75%, ${glowAlpha * 0.5})`)
      burstGrad.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`)

      ctx.fillStyle = burstGrad
      ctx.beginPath()
      ctx.arc(cx, cy, burstRadius, 0, Math.PI * 2)
      ctx.fill()

      // ── Beam tip glow particles
      if (rawProgress > 0.1 && rawProgress < 0.85) {
        for (let i = 0; i < beamCount; i++) {
          const baseAngle = i * sectorAngle + rotationOffset
          const tipX = cx + Math.cos(baseAngle) * currentReach * 0.95
          const tipY = cy + Math.sin(baseAngle) * currentReach * 0.95

          const tipGrad = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 8)
          tipGrad.addColorStop(0, `hsla(${hue}, 90%, 90%, ${glowAlpha * 0.7})`)
          tipGrad.addColorStop(1, `hsla(${hue}, 85%, 70%, 0)`)

          ctx.fillStyle = tipGrad
          ctx.beginPath()
          ctx.arc(tipX, tipY, 8, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      ctx.restore()
    }

    // ── Phase 4: Sweep highlight ring at the beam frontier
    if (rawProgress > 0.05 && rawProgress < 0.9) {
      const ringAlpha = 0.15 * Math.sin(rawProgress * Math.PI)
      const hue = cfg.beamHue

      ctx.save()
      ctx.globalAlpha = ringAlpha
      ctx.strokeStyle = `hsl(${hue}, 80%, 75%)`
      ctx.lineWidth = 1.5

      ctx.beginPath()
      ctx.arc(cx, cy, currentReach * 0.98, 0, Math.PI * 2)
      ctx.stroke()

      // Secondary inner ring
      if (currentReach > 60) {
        ctx.globalAlpha = ringAlpha * 0.5
        ctx.beginPath()
        ctx.arc(cx, cy, currentReach * 0.7, 0, Math.PI * 2)
        ctx.stroke()
      }

      ctx.restore()
    }

    // ── Final cross-fade at end of transition for clean handoff
    if (rawProgress >= 0.88 && nextData) {
      const fadeAlpha = Math.min(1, (rawProgress - 0.88) / 0.12)
      ctx.save()
      ctx.globalAlpha = fadeAlpha
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
