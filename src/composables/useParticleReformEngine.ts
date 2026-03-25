// ─────────────────────────────────────────────────────────────────────────────
// 粒子重组引擎 — Canvas 2D 粒子分解→重组转场动画
// 高性能版本：使用 ImageData 像素级操作，单次 putImageData 渲染
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, ParticleImage, ParticleConfig } from '../types'
import {
  getManualTotalDuration as _getManualTotalDuration,
  getBeatTotalDuration as _getBeatTotalDuration,
  resolveManual as _resolveManual,
  resolveBeatSync as _resolveBeatSync,
  type PrecomputedImageData,
  type ResolvedSlot,
} from '../utils/diffusionRenderer'
import { canvasBg } from './useTheme'

/* ── Pseudo-random (deterministic) ───────────────────────────────────── */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/* ── Particle data (SoA layout for cache efficiency) ─────────────────── */
interface ParticleArrays {
  count: number
  /** Source X on canvas (top-left of particle block) */
  sx: Float32Array
  /** Source Y on canvas */
  sy: Float32Array
  /** Scattered X offset */
  scatterX: Float32Array
  /** Scattered Y offset */
  scatterY: Float32Array
  /** Stagger delay (0-1) */
  delay: Float32Array
  /** Average color r */
  r: Uint8Array
  /** Average color g */
  g: Uint8Array
  /** Average color b */
  b: Uint8Array
}

/* ── Pre-computed data per image ──────────────────────────────────────── */
interface PrecomputedData {
  offscreen: HTMLCanvasElement
  srcPixels: Uint8ClampedArray
  width: number
  height: number
  particles: ParticleArrays
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
export function useParticleReformEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<ParticleImage[]>,
  configRef: Ref<ParticleConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()
  /** Reusable output ImageData (avoids allocation per frame) */
  let outImageData: ImageData | null = null
  /** Reusable Uint32 view of outImageData for fast pixel writes */
  let outBuf32: Uint32Array | null = null
  let outW = 0, outH = 0

  function ensureOutputBuffer(w: number, h: number) {
    if (outW !== w || outH !== h || !outImageData) {
      outImageData = new ImageData(w, h)
      outBuf32 = new Uint32Array(outImageData.data.buffer)
      outW = w
      outH = h
    }
  }

  /* ── Image element loading ─────────────────────────────────────── */
  function loadImageElement(img: ParticleImage): Promise<HTMLImageElement> {
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

  /* ── Generate particles (SoA) for a single image ──────────────── */
  function generateParticles(
    srcPixels: Uint8ClampedArray,
    imageIndex: number,
    cw: number,
    ch: number,
    cfg: ParticleConfig,
  ): ParticleArrays {
    const ps = cfg.particleSize
    const cols = Math.ceil(cw / ps)
    const rows = Math.ceil(ch / ps)
    const total = cols * rows
    const scatterPx = Math.max(cw, ch) * cfg.scatterRange
    const halfCW = cw / 2
    const halfCH = ch / 2
    const maxCenterDist = Math.sqrt(halfCW * halfCW + halfCH * halfCH)

    // Allocate typed arrays (may be slightly larger than needed if transparent pixels are skipped)
    const sxArr = new Float32Array(total)
    const syArr = new Float32Array(total)
    const scXArr = new Float32Array(total)
    const scYArr = new Float32Array(total)
    const delayArr = new Float32Array(total)
    const rArr = new Uint8Array(total)
    const gArr = new Uint8Array(total)
    const bArr = new Uint8Array(total)
    let count = 0

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col
        const seed = imageIndex * 100000 + idx

        // Sample center pixel of block
        const px = Math.min((col * ps + ps / 2) | 0, cw - 1)
        const py = Math.min((row * ps + ps / 2) | 0, ch - 1)
        const pi = (py * cw + px) * 4

        if (srcPixels[pi + 3] < 10) continue // skip transparent

        const sx = col * ps
        const sy = row * ps
        const centerX = sx + ps / 2
        const centerY = sy + ps / 2

        // Scatter position based on mode
        let scX: number, scY: number
        const dx = centerX - halfCW
        const dy = centerY - halfCH
        const distFromCenter = Math.sqrt(dx * dx + dy * dy)

        switch (cfg.scatterMode) {
          case 'explode': {
            const angle = Math.atan2(dy, dx) + (seededRandom(seed) - 0.5) * 1.2
            const dist = scatterPx * (0.4 + seededRandom(seed + 1) * 0.6)
            scX = Math.cos(angle) * dist
            scY = Math.sin(angle) * dist
            break
          }
          case 'vortex': {
            const baseAngle = Math.atan2(dy, dx)
            const spiralAngle = baseAngle + Math.PI * 1.5 * (seededRandom(seed) * 0.5 + 0.5)
            const dist = scatterPx * (0.3 + seededRandom(seed + 1) * 0.7)
            scX = Math.cos(spiralAngle) * dist
            scY = Math.sin(spiralAngle) * dist
            break
          }
          case 'gravity': {
            scX = (seededRandom(seed) - 0.5) * scatterPx * 0.6
            scY = scatterPx * (0.5 + seededRandom(seed + 1) * 0.5)
            break
          }
          case 'radial':
          default: {
            const angle = seededRandom(seed) * Math.PI * 2
            const normDist = distFromCenter / Math.max(cw, ch)
            const dist = scatterPx * (0.3 + normDist + seededRandom(seed + 1) * 0.4)
            scX = Math.cos(angle) * dist
            scY = Math.sin(angle) * dist
            break
          }
        }

        // Stagger delay
        let delay: number
        if (cfg.scatterMode === 'radial' || cfg.scatterMode === 'explode') {
          delay = distFromCenter / maxCenterDist
        } else if (cfg.scatterMode === 'vortex') {
          delay = seededRandom(seed + 3) * 0.7 + (distFromCenter / maxCenterDist) * 0.3
        } else {
          delay = centerY / ch
        }

        sxArr[count] = sx
        syArr[count] = sy
        scXArr[count] = scX
        scYArr[count] = scY
        delayArr[count] = delay
        rArr[count] = srcPixels[pi]
        gArr[count] = srcPixels[pi + 1]
        bArr[count] = srcPixels[pi + 2]
        count++
      }
    }

    return {
      count,
      sx: sxArr,
      sy: syArr,
      scatterX: scXArr,
      scatterY: scYArr,
      delay: delayArr,
      r: rArr,
      g: gArr,
      b: bArr,
    }
  }

  /* ── Pre-compute for a single image ────────────────────────────── */
  function precomputeImage(image: ParticleImage, index: number): void {
    const el = imageCache.get(image.id)
    if (!el || !el.complete || !el.naturalWidth) return

    const CW = canvasRef.value?.width ?? 1280
    const CH = canvasRef.value?.height ?? 720
    const cfg = configRef.value

    const off = document.createElement('canvas')
    off.width = CW
    off.height = CH
    const offCtx = off.getContext('2d')!
    drawCover(offCtx, el, CW, CH)

    const imgData = offCtx.getImageData(0, 0, CW, CH)
    const particles = generateParticles(imgData.data, index, CW, CH, cfg)

    precomputed.set(image.id, {
      offscreen: off,
      srcPixels: imgData.data,
      width: CW,
      height: CH,
      particles,
    })
  }

  function precomputeAll(): void {
    imagesRef.value.forEach((img, i) => precomputeImage(img, i))
  }

  /* ── Build image list for resolvers ────────────────────────────── */
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

  /* ── Render static frame ───────────────────────────────────────── */
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

    ctx.fillStyle = canvasBg.value
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(data.offscreen, 0, 0)
  }

  /* ── Core render frame (ImageData pixel ops — high performance) ── */
  function renderFrame(elapsedMs: number): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const images = imagesRef.value
    const cfg = configRef.value
    const { width, height } = canvas

    if (images.length === 0) {
      ctx.fillStyle = canvasBg.value
      ctx.fillRect(0, 0, width, height)
      return
    }

    const totalCycle = getTotalCycleDuration()
    const ps = cfg.particleSize

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

    const rawProgress = Math.min(1, imageTime / effectiveSpreadDuration)

    // Pause phase: just draw the full image
    if (rawProgress >= 1) {
      ctx.drawImage(data.offscreen, 0, 0)
      return
    }

    // Near-complete reform → cross-fade to full image
    if (rawProgress > 0.95) {
      ensureOutputBuffer(width, height)
      renderParticleFrame(data, rawProgress, width, height, ps, cfg)
      ctx.putImageData(outImageData!, 0, 0)
      // Overlay the clean image with increasing opacity
      const alpha = (rawProgress - 0.95) / 0.05
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.drawImage(data.offscreen, 0, 0)
      ctx.restore()
      return
    }

    // Main particle rendering via pixel buffer
    ensureOutputBuffer(width, height)
    renderParticleFrame(data, rawProgress, width, height, ps, cfg)
    ctx.putImageData(outImageData!, 0, 0)
  }

  /**
   * Core pixel-level particle renderer.
   * Writes directly into outBuf32 — no Canvas draw calls.
   */
  function renderParticleFrame(
    data: PrecomputedData,
    rawProgress: number,
    W: number,
    H: number,
    ps: number,
    cfg: ParticleConfig,
  ) {
    const buf = outBuf32!
    const pixels = outImageData!.data

    // Fill with background color (parse canvasBg)
    const bgIsDark = canvasBg.value === '#000'
    const bgPixel = bgIsDark ? 0xFF000000 : 0xFFF0E8E8 // ABGR
    buf.fill(bgPixel)

    // Determine phase
    let phase: 0 | 1 | 2 // 0=scatter, 1=hold, 2=reform
    let phaseProgress: number

    if (rawProgress < 0.4) {
      phase = 0 // scatter
      phaseProgress = rawProgress / 0.4
    } else if (rawProgress < 0.5) {
      phase = 1 // hold
      phaseProgress = (rawProgress - 0.4) / 0.1
    } else {
      phase = 2 // reform
      phaseProgress = (rawProgress - 0.5) / 0.5
    }

    const p = data.particles
    const count = p.count
    const staggerRange = 0.3
    const fragDuration = 1 - staggerRange
    const srcData = data.srcPixels
    const hueShift = cfg.hueShift
    const doHue = hueShift > 0
    const doTrail = cfg.trailEnabled && (phase === 0 || phase === 2)
    const doGlow = cfg.glowEnabled

    // Pre-compute hue shift matrix if needed
    let hm0 = 0, hm1 = 0, hm2 = 0, hm3 = 0, hm4 = 0, hm5 = 0, hm6 = 0, hm7 = 0, hm8 = 0
    if (doHue) {
      const cosA = Math.cos(hueShift * Math.PI / 180)
      const sinA = Math.sin(hueShift * Math.PI / 180)
      const s3 = Math.sqrt(1 / 3)
      const oneMinusCos3 = (1 - cosA) / 3
      hm0 = cosA + oneMinusCos3;           hm1 = oneMinusCos3 - s3 * sinA; hm2 = oneMinusCos3 + s3 * sinA
      hm3 = oneMinusCos3 + s3 * sinA;      hm4 = cosA + oneMinusCos3;      hm5 = oneMinusCos3 - s3 * sinA
      hm6 = oneMinusCos3 - s3 * sinA;      hm7 = oneMinusCos3 + s3 * sinA; hm8 = cosA + oneMinusCos3
    }

    for (let i = 0; i < count; i++) {
      const sx = p.sx[i]
      const sy = p.sy[i]
      const scX = p.scatterX[i]
      const scY = p.scatterY[i]
      const dl = p.delay[i]

      let offsetX: number, offsetY: number
      let alphaScale: number // 0-1 opacity multiplier

      if (phase === 0) {
        // Scatter
        const fragDelay = dl * staggerRange
        let lp = (phaseProgress - fragDelay) / fragDuration
        if (lp < 0) lp = 0; else if (lp > 1) lp = 1
        const eased = lp * lp * lp // easeInCubic
        offsetX = scX * eased
        offsetY = scY * eased
        alphaScale = 1 - lp * 0.3
      } else if (phase === 1) {
        // Hold — slight drift
        const drift = Math.sin(phaseProgress * 6.2832 + dl * 10) * 3
        offsetX = scX + drift
        offsetY = scY + drift * 0.5
        alphaScale = 0.7
      } else {
        // Reform
        const fragDelay = (1 - dl) * staggerRange
        let lp = (phaseProgress - fragDelay) / fragDuration
        if (lp < 0) lp = 0; else if (lp > 1) lp = 1
        // easeInOutQuart inline
        const eased = lp < 0.5 ? 8 * lp * lp * lp * lp : 1 - Math.pow(-2 * lp + 2, 4) / 2
        offsetX = scX * (1 - eased)
        offsetY = scY * (1 - eased)
        alphaScale = 0.7 + eased * 0.3
      }

      const destX = (sx + offsetX) | 0
      const destY = (sy + offsetY) | 0

      // Draw trail line into pixel buffer
      if (doTrail) {
        const trailAlpha = alphaScale * 0.12
        const startX = (sx) | 0
        const startY = (sy) | 0
        drawLinePixels(pixels, W, H, startX, startY, destX, destY,
          p.r[i], p.g[i], p.b[i], trailAlpha)
      }

      // Write particle block into pixel buffer
      const alpha = (alphaScale * 255 + 0.5) | 0

      // Get particle color
      let cr = p.r[i], cg = p.g[i], cb = p.b[i]
      if (doHue) {
        const nr = cr * hm0 + cg * hm1 + cb * hm2
        const ng = cr * hm3 + cg * hm4 + cb * hm5
        const nb = cr * hm6 + cg * hm7 + cb * hm8
        cr = nr < 0 ? 0 : nr > 255 ? 255 : nr | 0
        cg = ng < 0 ? 0 : ng > 255 ? 255 : ng | 0
        cb = nb < 0 ? 0 : nb > 255 ? 255 : nb | 0
      }

      // For reform phase > 60%, use source image pixels for richer detail
      const useSourcePixels = phase === 2 && phaseProgress > 0.6

      // Write ps×ps block
      const endX = destX + ps
      const endY = destY + ps
      const clampedStartX = destX < 0 ? 0 : destX
      const clampedStartY = destY < 0 ? 0 : destY
      const clampedEndX = endX > W ? W : endX
      const clampedEndY = endY > H ? H : endY

      if (clampedStartX >= clampedEndX || clampedStartY >= clampedEndY) continue

      if (useSourcePixels) {
        // Copy source pixels with alpha blend
        const srcBaseX = (sx) | 0
        const srcBaseY = (sy) | 0
        for (let py = clampedStartY; py < clampedEndY; py++) {
          const outRowBase = py * W
          const srcRowY = srcBaseY + (py - destY)
          if (srcRowY < 0 || srcRowY >= H) continue
          const srcRowBase = srcRowY * W
          for (let px = clampedStartX; px < clampedEndX; px++) {
            const srcColX = srcBaseX + (px - destX)
            if (srcColX < 0 || srcColX >= W) continue
            const si = (srcRowBase + srcColX) * 4
            const di = (outRowBase + px) * 4
            const sa = (srcData[si + 3] * alpha / 255) | 0
            if (sa === 0) continue
            const invSa = 255 - sa
            pixels[di]     = (srcData[si] * sa + pixels[di] * invSa + 127) / 255 | 0
            pixels[di + 1] = (srcData[si + 1] * sa + pixels[di + 1] * invSa + 127) / 255 | 0
            pixels[di + 2] = (srcData[si + 2] * sa + pixels[di + 2] * invSa + 127) / 255 | 0
            pixels[di + 3] = 255
          }
        }
      } else {
        // Fill solid color block
        if (alpha >= 250) {
          // Fully opaque — fast path with Uint32
          const pixel32 = (255 << 24) | (cb << 16) | (cg << 8) | cr // ABGR
          for (let py = clampedStartY; py < clampedEndY; py++) {
            const rowBase = py * W
            for (let px = clampedStartX; px < clampedEndX; px++) {
              buf[rowBase + px] = pixel32
            }
          }
        } else {
          // Alpha blend
          const invA = 255 - alpha
          for (let py = clampedStartY; py < clampedEndY; py++) {
            const rowBase = py * W
            for (let px = clampedStartX; px < clampedEndX; px++) {
              const di = (rowBase + px) * 4
              pixels[di]     = (cr * alpha + pixels[di] * invA + 127) / 255 | 0
              pixels[di + 1] = (cg * alpha + pixels[di + 1] * invA + 127) / 255 | 0
              pixels[di + 2] = (cb * alpha + pixels[di + 2] * invA + 127) / 255 | 0
              pixels[di + 3] = 255
            }
          }
        }

        // Glow: add a subtle bright border on the particle
        if (doGlow && alpha > 100 && ps >= 4) {
          const glowAlpha = alpha * 0.3
          const invGlowA = 255 - glowAlpha
          // Only top and bottom edges (1px)
          for (let px = clampedStartX; px < clampedEndX; px++) {
            // Top edge
            if (clampedStartY >= 0 && clampedStartY < H) {
              const di = (clampedStartY * W + px) * 4
              pixels[di]     = Math.min(255, (cr * glowAlpha + pixels[di] * invGlowA + 127) / 255 + 30) | 0
              pixels[di + 1] = Math.min(255, (cg * glowAlpha + pixels[di + 1] * invGlowA + 127) / 255 + 20) | 0
              pixels[di + 2] = Math.min(255, (cb * glowAlpha + pixels[di + 2] * invGlowA + 127) / 255 + 40) | 0
            }
            // Bottom edge
            const bRow = clampedEndY - 1
            if (bRow >= 0 && bRow < H) {
              const di = (bRow * W + px) * 4
              pixels[di]     = Math.min(255, (cr * glowAlpha + pixels[di] * invGlowA + 127) / 255 + 30) | 0
              pixels[di + 1] = Math.min(255, (cg * glowAlpha + pixels[di + 1] * invGlowA + 127) / 255 + 20) | 0
              pixels[di + 2] = Math.min(255, (cb * glowAlpha + pixels[di + 2] * invGlowA + 127) / 255 + 40) | 0
            }
          }
        }
      }
    }
  }

  /**
   * Draw a 1px anti-aliased line into the pixel buffer using Bresenham.
   */
  function drawLinePixels(
    pixels: Uint8ClampedArray,
    W: number, H: number,
    x0: number, y0: number, x1: number, y1: number,
    r: number, g: number, b: number, alpha: number,
  ) {
    const a = (alpha * 255) | 0
    if (a <= 0) return
    const invA = 255 - a

    let dx = Math.abs(x1 - x0)
    let dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy

    // Limit iterations to avoid excessive line drawing
    const maxSteps = ((dx + dy) >> 1) + 1
    let steps = 0

    while (steps < maxSteps) {
      if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) {
        const di = (y0 * W + x0) * 4
        pixels[di]     = (r * a + pixels[di] * invA + 127) / 255 | 0
        pixels[di + 1] = (g * a + pixels[di + 1] * invA + 127) / 255 | 0
        pixels[di + 2] = (b * a + pixels[di + 2] * invA + 127) / 255 | 0
        pixels[di + 3] = 255
      }
      if (x0 === x1 && y0 === y1) break
      const e2 = err * 2
      if (e2 > -dy) { err -= dy; x0 += sx }
      if (e2 < dx)  { err += dx; y0 += sy }
      steps++
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
