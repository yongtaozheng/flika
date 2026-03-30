// ─────────────────────────────────────────────────────────────────────────────
// 雨滴侵蚀引擎 — Canvas 2D 雨滴侵蚀转场动画
// 雨滴从天而降，撞击画面后水花飞溅、水痕蜿蜒，旧画面被"侵蚀"溶解，
// 新画面从水痕处渗透显现。
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, RaindropErosionImage, RaindropErosionConfig } from '../types'
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

function easeOutBounce(t: number): number {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
  return n * (t -= 2.625 / d) * t + 0.984375
}

/* ── Deterministic pseudo-random ─────────────────────────────────── */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/* ── Raindrop data structure ─────────────────────────────────────── */
interface Raindrop {
  /** 归一化 X 坐标 (0-1) */
  x: number
  /** 起始 Y 的归一化偏移 (-0.3 to 0) — 在画面顶部上方开始 */
  startY: number
  /** 雨滴半径 */
  radius: number
  /** 雨滴下落速度系数 (个体差异) */
  speed: number
  /** 雨滴出现的进度时刻 (0-1) */
  birthProgress: number
  /** 撞击进度 (0-1 中的时刻) */
  impactProgress: number
  /** 水痕路径角度 (弧度) */
  streakAngle: number
  /** 水痕长度系数 */
  streakLength: number
  /** 溅射方向角度列表 */
  splashAngles: number[]
  /** 溅射距离列表 */
  splashDistances: number[]
}

/* ── Pre-computed data ──────────────────────────────────────────── */
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

/* ── Generate raindrops for a transition ──────────────────────────── */
function generateRaindrops(
  count: number,
  maxRadius: number,
  fallSpeed: number,
  splashCount: number,
  mode: 'natural' | 'storm' | 'drizzle',
  seed: number,
): Raindrop[] {
  const drops: Raindrop[] = []

  for (let i = 0; i < count; i++) {
    const s = seed + i * 7.31
    const x = pseudoRandom(s)
    const startY = -0.05 - pseudoRandom(s + 1) * 0.25

    // Mode-specific adjustments
    let radiusMul = 1
    let speedMul = 1
    let birthSpread = 1

    switch (mode) {
      case 'storm':
        radiusMul = 0.8 + pseudoRandom(s + 2) * 1.2
        speedMul = 1.2 + pseudoRandom(s + 3) * 0.8
        birthSpread = 0.4  // drops come fast
        break
      case 'drizzle':
        radiusMul = 0.3 + pseudoRandom(s + 2) * 0.5
        speedMul = 0.5 + pseudoRandom(s + 3) * 0.3
        birthSpread = 1.0  // spread out more
        break
      default: // natural
        radiusMul = 0.5 + pseudoRandom(s + 2) * 1.0
        speedMul = 0.7 + pseudoRandom(s + 3) * 0.6
        birthSpread = 0.7
        break
    }

    const radius = maxRadius * radiusMul
    const speed = fallSpeed * speedMul
    const birthProgress = pseudoRandom(s + 4) * birthSpread * 0.6

    // Impact occurs after falling from startY to a random landing point
    const landingY = 0.2 + pseudoRandom(s + 5) * 0.7  // land between 20% and 90% of canvas
    const fallDuration = (landingY - startY) / (speed * 1.5)
    const impactProgress = Math.min(0.9, birthProgress + fallDuration)

    // Water streak
    const streakAngle = -Math.PI / 2 + (pseudoRandom(s + 6) - 0.5) * 0.6  // mostly downward
    const streakLength = 0.05 + pseudoRandom(s + 7) * 0.15

    // Splash particles
    const splashAngles: number[] = []
    const splashDistances: number[] = []
    for (let j = 0; j < splashCount; j++) {
      splashAngles.push(pseudoRandom(s + 10 + j) * Math.PI * 2)
      splashDistances.push(0.3 + pseudoRandom(s + 100 + j) * 0.7)
    }

    drops.push({
      x,
      startY,
      radius,
      speed,
      birthProgress,
      impactProgress,
      streakAngle,
      streakLength,
      splashAngles,
      splashDistances,
    })
  }

  return drops
}

/* ═══════════════════════════════════════════════════════════════════ */
export function useRaindropErosionEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<RaindropErosionImage[]>,
  configRef: Ref<RaindropErosionConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()
  let raindropsCache: Raindrop[] | null = null
  let lastDropSeed = 0

  /* ── Image element loading ─────────────────────────────────── */
  function loadImageElement(img: RaindropErosionImage): Promise<HTMLImageElement> {
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
  function precomputeImage(image: RaindropErosionImage, _index: number): void {
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

  /* ── Build image list for time resolvers ──────────────────── */
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

  /* ── Generate / refresh raindrop cache ──────────────────────── */
  function ensureRaindrops(imageIndex: number): Raindrop[] {
    const cfg = configRef.value
    const newSeed = imageIndex * 1000 + cfg.dropDensity
    if (raindropsCache && lastDropSeed === newSeed) return raindropsCache

    lastDropSeed = newSeed
    raindropsCache = generateRaindrops(
      cfg.dropDensity,
      cfg.dropMaxRadius,
      cfg.fallSpeed,
      cfg.splashCount,
      cfg.erosionMode,
      newSeed,
    )
    return raindropsCache
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

    const cw = canvas.width
    const ch = canvas.height

    // Draw the image
    ctx.drawImage(data.offscreen, 0, 0)

    // Draw some static raindrop hints
    const drops = ensureRaindrops(index)
    ctx.save()
    ctx.globalAlpha = 0.15
    for (let i = 0; i < Math.min(drops.length, 30); i++) {
      const d = drops[i]
      const px = d.x * cw
      const py = 0.5 * ch + (pseudoRandom(i + 99) - 0.5) * ch * 0.4
      const r = d.radius * 0.6

      // Raindrop shape (elongated ellipse)
      ctx.beginPath()
      ctx.ellipse(px, py, r * 0.6, r * 1.2, 0, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(200, 80%, 80%, 0.3)`
      ctx.fill()
    }
    ctx.restore()
  }

  /* ── Core: draw a single raindrop at given progress ──────── */
  function drawRaindropEffect(
    ctx: CanvasRenderingContext2D,
    drop: Raindrop,
    progress: number,
    cw: number,
    ch: number,
    toCanvas: HTMLCanvasElement,
    cfg: RaindropErosionConfig,
  ): void {
    // Skip drops not yet born
    if (progress < drop.birthProgress) return

    const dropProgress = Math.min(1, (progress - drop.birthProgress) / Math.max(0.01, drop.impactProgress - drop.birthProgress))
    const postImpact = progress > drop.impactProgress
    const postImpactProgress = postImpact
      ? Math.min(1, (progress - drop.impactProgress) / Math.max(0.01, 1 - drop.impactProgress))
      : 0

    const px = drop.x * cw
    const maxR = drop.radius

    // ── Phase 1: Falling raindrop ────────────────
    if (!postImpact) {
      const fallEase = easeInOutCubic(dropProgress)
      const py = (drop.startY + fallEase * (1 - drop.startY) * 0.8) * ch

      // Elongated raindrop shape
      ctx.save()
      const stretch = 1 + dropProgress * 1.5 // elongate as it accelerates
      ctx.translate(px, py)

      // Subtle motion blur
      const blurAlpha = 0.2 + dropProgress * 0.3
      const dropHsl = cfg.dropHue === 0
        ? `hsla(200, 60%, 85%, ${blurAlpha})`
        : `hsla(${cfg.dropHue}, 50%, 80%, ${blurAlpha})`

      ctx.fillStyle = dropHsl
      ctx.beginPath()
      ctx.ellipse(0, 0, maxR * 0.5, maxR * stretch * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()

      // Bright core
      ctx.fillStyle = cfg.dropHue === 0
        ? `hsla(200, 80%, 95%, ${blurAlpha * 1.5})`
        : `hsla(${cfg.dropHue}, 70%, 95%, ${blurAlpha * 1.5})`
      ctx.beginPath()
      ctx.ellipse(0, 0, maxR * 0.2, maxR * stretch * 0.25, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
      return
    }

    // ── Phase 2: Impact + erosion reveal ─────────
    const impactY = (drop.startY + (1 - drop.startY) * 0.8) * ch
    const revealEase = easeOutQuart(postImpactProgress)
    const bounceEase = easeOutBounce(Math.min(1, postImpactProgress * 3))

    // Erosion circle — reveal the "to" image through a growing circular region
    const erosionRadius = maxR * (1 + revealEase * 4)
    ctx.save()
    ctx.beginPath()
    ctx.arc(px, impactY, erosionRadius, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(toCanvas, 0, 0)
    ctx.restore()

    // Water streak — a trail that reveals more of the "to" image
    if (cfg.streakIntensity > 0 && postImpactProgress > 0.1) {
      const streakProgress = easeOutQuart((postImpactProgress - 0.1) / 0.9)
      const streakLen = drop.streakLength * ch * streakProgress * cfg.streakIntensity
      const sx = px + Math.cos(drop.streakAngle) * streakLen
      const sy = impactY + Math.sin(drop.streakAngle) * streakLen
      const streakWidth = maxR * 0.8 * (1 - streakProgress * 0.5)

      // Draw streak as a clipping path to reveal "to" image
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(px - streakWidth, impactY)
      ctx.quadraticCurveTo(
        (px + sx) / 2 + (pseudoRandom(drop.x * 100) - 0.5) * streakWidth * 3,
        (impactY + sy) / 2,
        sx,
        sy,
      )
      ctx.lineTo(sx + streakWidth * 0.3, sy)
      ctx.quadraticCurveTo(
        (px + sx) / 2 + (pseudoRandom(drop.x * 200) - 0.5) * streakWidth * 2,
        (impactY + sy) / 2 + streakWidth,
        px + streakWidth,
        impactY,
      )
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(toCanvas, 0, 0)
      ctx.restore()

      // Water sheen on streak
      ctx.save()
      ctx.globalAlpha = 0.15 * (1 - streakProgress)
      const sheenGrad = ctx.createLinearGradient(px, impactY, sx, sy)
      sheenGrad.addColorStop(0, 'rgba(255,255,255,0.5)')
      sheenGrad.addColorStop(0.5, 'rgba(200,220,255,0.3)')
      sheenGrad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.strokeStyle = sheenGrad
      ctx.lineWidth = streakWidth * 1.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(px, impactY)
      ctx.quadraticCurveTo(
        (px + sx) / 2 + (pseudoRandom(drop.x * 100) - 0.5) * streakWidth * 3,
        (impactY + sy) / 2,
        sx, sy,
      )
      ctx.stroke()
      ctx.restore()
    }

    // Splash particles on impact
    if (postImpactProgress < 0.6 && cfg.splashCount > 0) {
      const splashEase = easeOutQuart(postImpactProgress / 0.6)
      const splashAlpha = (1 - splashEase) * 0.7

      ctx.save()
      ctx.globalAlpha = splashAlpha
      for (let j = 0; j < drop.splashAngles.length; j++) {
        const angle = drop.splashAngles[j]
        const dist = drop.splashDistances[j] * maxR * 3 * bounceEase
        const sx = px + Math.cos(angle) * dist
        const sy = impactY + Math.sin(angle) * dist - (1 - splashEase) * maxR * 2

        const particleR = maxR * 0.15 * (1 - splashEase)
        if (particleR < 0.5) continue

        ctx.fillStyle = cfg.dropHue === 0
          ? `hsla(200, 70%, 90%, ${splashAlpha})`
          : `hsla(${cfg.dropHue}, 60%, 90%, ${splashAlpha})`
        ctx.beginPath()
        ctx.arc(sx, sy, particleR, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // Impact ring ripple
    if (postImpactProgress < 0.5) {
      const ringProgress = postImpactProgress / 0.5
      const ringRadius = maxR * (1 + ringProgress * 6)
      const ringAlpha = (1 - ringProgress) * 0.4

      ctx.save()
      ctx.globalAlpha = ringAlpha
      ctx.strokeStyle = cfg.dropHue === 0
        ? 'rgba(180, 210, 255, 0.6)'
        : `hsla(${cfg.dropHue}, 60%, 80%, 0.6)`
      ctx.lineWidth = 1.5 * (1 - ringProgress)
      ctx.beginPath()
      ctx.arc(px, impactY, ringRadius, 0, Math.PI * 2)
      ctx.stroke()

      // Second concentric ring
      if (ringProgress > 0.15) {
        const ring2Progress = (ringProgress - 0.15) / 0.85
        const ring2Radius = maxR * (1 + ring2Progress * 4)
        ctx.globalAlpha = (1 - ring2Progress) * 0.25
        ctx.beginPath()
        ctx.arc(px, impactY, ring2Radius, 0, Math.PI * 2)
        ctx.stroke()
      }

      ctx.restore()
    }
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

    // Determine next image
    const nextImageIndex = (imageIndex + 1) % images.length
    const nextImage = images[nextImageIndex]
    const nextData = precomputed.get(nextImage?.id)

    // ── No transition or single image: show current image cleanly ──
    if (rawProgress >= 1 || images.length <= 1 || !nextData) {
      ctx.drawImage(data.offscreen, 0, 0)

      // Ambient rain effect during pause phase
      if (rawProgress >= 1 && images.length > 1) {
        drawAmbientRain(ctx, cw, ch, elapsedMs, cfg)
      }
      return
    }

    // ── Transition: raindrop erosion ────────────────────────────
    const drops = ensureRaindrops(imageIndex)

    // Draw base (from) image
    ctx.drawImage(data.offscreen, 0, 0)

    // Global cross-fade for smooth ending
    if (rawProgress > 0.85) {
      const fadeProgress = (rawProgress - 0.85) / 0.15
      ctx.save()
      ctx.globalAlpha = easeInOutCubic(fadeProgress)
      ctx.drawImage(nextData.offscreen, 0, 0)
      ctx.restore()
    }

    // Draw each raindrop's effect
    for (const drop of drops) {
      drawRaindropEffect(ctx, drop, rawProgress, cw, ch, nextData.offscreen, cfg)
    }

    // ── Wet surface overlay (glass-like water film) ─────────────
    if (rawProgress > 0.3) {
      const wetProgress = easeOutQuart((rawProgress - 0.3) / 0.7)
      ctx.save()
      ctx.globalAlpha = 0.04 * wetProgress
      ctx.fillStyle = cfg.dropHue === 0
        ? 'rgba(150, 190, 230, 1)'
        : `hsla(${cfg.dropHue}, 40%, 70%, 1)`
      ctx.fillRect(0, 0, cw, ch)
      ctx.restore()
    }

    // ── Rain streaks in foreground ──────────────────────────────
    drawFallingRain(ctx, cw, ch, rawProgress, elapsedMs, cfg)
  }

  /* ── Ambient rain (gentle rain during pause) ────────────────── */
  function drawAmbientRain(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    elapsedMs: number,
    cfg: RaindropErosionConfig,
  ) {
    const time = elapsedMs * 0.001
    const count = Math.floor(cfg.dropDensity * 0.15)

    ctx.save()
    ctx.globalAlpha = 0.08
    ctx.strokeStyle = cfg.dropHue === 0
      ? 'rgba(180, 210, 255, 0.5)'
      : `hsla(${cfg.dropHue}, 50%, 80%, 0.5)`
    ctx.lineWidth = 1

    for (let i = 0; i < count; i++) {
      const x = pseudoRandom(i * 3.17) * cw
      const y = ((time * 200 + pseudoRandom(i * 7.89) * ch) % (ch * 1.3)) - ch * 0.15
      const len = 8 + pseudoRandom(i * 5.43) * 15

      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - 1, y + len)
      ctx.stroke()
    }
    ctx.restore()
  }

  /* ── Foreground rain streaks during transition ─────────────── */
  function drawFallingRain(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    progress: number,
    elapsedMs: number,
    cfg: RaindropErosionConfig,
  ) {
    const intensity = Math.sin(progress * Math.PI) // peak at middle of transition
    const count = Math.floor(cfg.dropDensity * 0.5 * intensity)
    if (count <= 0) return

    const time = elapsedMs * 0.001

    ctx.save()
    ctx.globalAlpha = 0.12 * intensity

    for (let i = 0; i < count; i++) {
      const x = pseudoRandom(i * 2.71 + 0.5) * cw
      const baseY = pseudoRandom(i * 4.33 + 0.3) * ch
      const y = ((time * (250 + pseudoRandom(i * 6.17) * 150) + baseY) % (ch * 1.4)) - ch * 0.2
      const len = 12 + pseudoRandom(i * 8.91) * 25
      const width = 0.5 + pseudoRandom(i * 1.23) * 1

      const alpha = 0.15 + pseudoRandom(i * 9.87) * 0.2
      ctx.strokeStyle = cfg.dropHue === 0
        ? `rgba(200, 220, 255, ${alpha})`
        : `hsla(${cfg.dropHue}, 50%, 85%, ${alpha})`
      ctx.lineWidth = width

      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - 0.5, y + len)
      ctx.stroke()
    }
    ctx.restore()
  }

  /* ── Playback info ─────────────────────────────────────────── */
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
    raindropsCache = null
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
