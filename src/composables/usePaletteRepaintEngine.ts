// ─────────────────────────────────────────────────────────────────────────────
// 调色板重绘引擎 — Canvas 2D 调色板重绘转场动画
// 仿佛画家用调色板上的颜色一笔一笔地重新绘制画面：旧画面上出现各种笔触，
// 每一笔都带着下一张图的真实色彩，笔触逐渐铺满画布，最终完成向新画面的转场。
// 支持三种画风：水彩晕染、油画堆叠、素描线条。
// ─────────────────────────────────────────────────────────────────────────────

import { type Ref, onUnmounted } from 'vue'
import type { Beat, PaletteRepaintImage, PaletteRepaintConfig } from '../types'
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

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/* ── Deterministic pseudo-random ─────────────────────────────────── */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/* ── Simplex-like 2D noise for organic texture ────────────────────── */
function noise2D(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const a = pseudoRandom(ix + iy * 57.0)
  const b = pseudoRandom(ix + 1 + iy * 57.0)
  const c = pseudoRandom(ix + (iy + 1) * 57.0)
  const d = pseudoRandom(ix + 1 + (iy + 1) * 57.0)
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/* ── Brush stroke data structure ──────────────────────────────────── */
interface BrushStroke {
  /** 归一化中心 X (0-1) */
  cx: number
  /** 归一化中心 Y (0-1) */
  cy: number
  /** 笔触长度(px) */
  length: number
  /** 笔触宽度(px) */
  width: number
  /** 笔触角度(弧度) */
  angle: number
  /** 笔触出现时刻 (0-1 of transition progress) */
  birthProgress: number
  /** 笔触绘制持续的进度跨度 */
  drawDuration: number
  /** 曲率偏移 — 让笔触略有弧度 */
  curvature: number
  /** 笔触的不透明度峰值 (0.4-1) */
  peakAlpha: number
  /** 笔触抖动偏移 (模拟手绘的不稳定) */
  jitterX: number
  jitterY: number
  /** 颜色从目标图片采样的偏移 */
  colorOffsetX: number
  colorOffsetY: number
}

/* ── Pre-computed data ──────────────────────────────────────────── */
interface PrecomputedData {
  offscreen: HTMLCanvasElement
  imageData: ImageData
  width: number
  height: number
  /** 从图片中提取的主色调色板 (5-8 colors) */
  palette: string[]
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

/* ── Extract a color palette from ImageData ──────────────────────── */
function extractPalette(imgData: ImageData, count: number): string[] {
  const { data, width, height } = imgData
  const colors: string[] = []
  const step = Math.max(1, Math.floor((width * height) / (count * 50)))

  // Collect sampled color buckets
  const buckets: { r: number; g: number; b: number; count: number }[] = []

  for (let i = 0; i < width * height; i += step) {
    const idx = i * 4
    const r = data[idx], g = data[idx + 1], b = data[idx + 2]
    // Quantize to reduce color space
    const qr = Math.round(r / 32) * 32
    const qg = Math.round(g / 32) * 32
    const qb = Math.round(b / 32) * 32

    let found = false
    for (const bucket of buckets) {
      if (Math.abs(bucket.r - qr) < 48 && Math.abs(bucket.g - qg) < 48 && Math.abs(bucket.b - qb) < 48) {
        bucket.r = (bucket.r * bucket.count + r) / (bucket.count + 1)
        bucket.g = (bucket.g * bucket.count + g) / (bucket.count + 1)
        bucket.b = (bucket.b * bucket.count + b) / (bucket.count + 1)
        bucket.count++
        found = true
        break
      }
    }
    if (!found && buckets.length < 64) {
      buckets.push({ r, g, b, count: 1 })
    }
  }

  // Sort by frequency and pick top colors
  buckets.sort((a, b) => b.count - a.count)
  for (let i = 0; i < Math.min(count, buckets.length); i++) {
    const { r, g, b } = buckets[i]
    colors.push(`rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`)
  }

  // Pad if we don't have enough
  while (colors.length < count) {
    colors.push(colors[colors.length - 1] || 'rgb(128,128,128)')
  }

  return colors
}

/* ── Generate brush strokes for a transition ──────────────────────── */
function generateBrushStrokes(
  count: number,
  brushSize: number,
  strokeSpeed: number,
  mode: 'watercolor' | 'oil' | 'sketch',
  seed: number,
): BrushStroke[] {
  const strokes: BrushStroke[] = []

  for (let i = 0; i < count; i++) {
    const s = seed + i * 13.17

    const cx = pseudoRandom(s)
    const cy = pseudoRandom(s + 1)

    // Mode-specific brush characteristics
    let lengthMul = 1
    let widthMul = 1
    let curvatureMul = 1
    let alphaMul = 1
    let durationBase = 0.15

    switch (mode) {
      case 'watercolor':
        lengthMul = 1.5 + pseudoRandom(s + 2) * 2.0   // long, flowing strokes
        widthMul = 1.2 + pseudoRandom(s + 3) * 1.5     // wider, softer
        curvatureMul = 0.8 + pseudoRandom(s + 4) * 1.5  // more curve
        alphaMul = 0.5 + pseudoRandom(s + 5) * 0.3      // semi-transparent
        durationBase = 0.18
        break
      case 'oil':
        lengthMul = 0.8 + pseudoRandom(s + 2) * 1.2    // medium strokes
        widthMul = 1.5 + pseudoRandom(s + 3) * 2.0     // thick, impasto
        curvatureMul = 0.3 + pseudoRandom(s + 4) * 0.6  // less curve
        alphaMul = 0.8 + pseudoRandom(s + 5) * 0.2      // more opaque
        durationBase = 0.12
        break
      case 'sketch':
        lengthMul = 2.0 + pseudoRandom(s + 2) * 3.0    // long, thin lines
        widthMul = 0.2 + pseudoRandom(s + 3) * 0.4     // very thin
        curvatureMul = 0.2 + pseudoRandom(s + 4) * 0.4  // subtle curve
        alphaMul = 0.4 + pseudoRandom(s + 5) * 0.4      // varied opacity
        durationBase = 0.1
        break
    }

    const length = brushSize * lengthMul
    const width = brushSize * widthMul * 0.4
    const angle = pseudoRandom(s + 6) * Math.PI * 2
    const birthProgress = pseudoRandom(s + 7) * 0.7 / strokeSpeed
    const drawDuration = durationBase / strokeSpeed + pseudoRandom(s + 8) * 0.08
    const curvature = (pseudoRandom(s + 9) - 0.5) * 0.4 * curvatureMul
    const peakAlpha = alphaMul
    const jitterX = (pseudoRandom(s + 10) - 0.5) * brushSize * 0.1
    const jitterY = (pseudoRandom(s + 11) - 0.5) * brushSize * 0.1
    const colorOffsetX = (pseudoRandom(s + 12) - 0.5) * 0.02
    const colorOffsetY = (pseudoRandom(s + 13) - 0.5) * 0.02

    strokes.push({
      cx, cy,
      length, width, angle,
      birthProgress, drawDuration,
      curvature, peakAlpha,
      jitterX, jitterY,
      colorOffsetX, colorOffsetY,
    })
  }

  // Sort by birth progress so earlier strokes paint first
  strokes.sort((a, b) => a.birthProgress - b.birthProgress)
  return strokes
}

/* ═══════════════════════════════════════════════════════════════════ */
export function usePaletteRepaintEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  imagesRef: Ref<PaletteRepaintImage[]>,
  configRef: Ref<PaletteRepaintConfig>,
  beatsRef: Ref<Beat[]>,
) {
  /* ── Caches ──────────────────────────────────────────────────── */
  const imageCache = new Map<string, HTMLImageElement>()
  const precomputed = new Map<string, PrecomputedData>()
  let strokesCache: BrushStroke[] | null = null
  let lastStrokeSeed = 0

  /* ── Image element loading ─────────────────────────────────── */
  function loadImageElement(img: PaletteRepaintImage): Promise<HTMLImageElement> {
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
  function precomputeImage(image: PaletteRepaintImage, _index: number): void {
    const el = imageCache.get(image.id)
    if (!el || !el.complete || !el.naturalWidth) return

    const CW = canvasRef.value?.width ?? 1280
    const CH = canvasRef.value?.height ?? 720

    const off = document.createElement('canvas')
    off.width = CW
    off.height = CH
    const offCtx = off.getContext('2d')!
    drawCover(offCtx, el, CW, CH)

    const imageData = offCtx.getImageData(0, 0, CW, CH)
    const palette = extractPalette(imageData, 6)

    precomputed.set(image.id, {
      offscreen: off,
      imageData,
      width: CW,
      height: CH,
      palette,
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

  /* ── Generate / refresh strokes cache ──────────────────────── */
  function ensureStrokes(imageIndex: number): BrushStroke[] {
    const cfg = configRef.value
    const newSeed = imageIndex * 1000 + cfg.strokeDensity + cfg.brushSize
    if (strokesCache && lastStrokeSeed === newSeed) return strokesCache

    lastStrokeSeed = newSeed
    strokesCache = generateBrushStrokes(
      cfg.strokeDensity,
      cfg.brushSize,
      cfg.strokeSpeed,
      cfg.paintMode,
      newSeed,
    )
    return strokesCache
  }

  /* ── Sample color from image data at (nx, ny) normalized ───── */
  function sampleColor(
    imgData: ImageData,
    nx: number,
    ny: number,
    paletteHue: number,
  ): string {
    const x = Math.min(imgData.width - 1, Math.max(0, Math.floor(nx * imgData.width)))
    const y = Math.min(imgData.height - 1, Math.max(0, Math.floor(ny * imgData.height)))
    const idx = (y * imgData.width + x) * 4
    let r = imgData.data[idx]
    let g = imgData.data[idx + 1]
    let b = imgData.data[idx + 2]

    // Apply hue shift if non-zero
    if (paletteHue > 0) {
      const [h, s, l] = rgbToHsl(r, g, b)
      const shifted = hslToRgb((h + paletteHue / 360) % 1, s, l)
      r = shifted[0]
      g = shifted[1]
      b = shifted[2]
    }

    return `rgb(${r}, ${g}, ${b})`
  }

  /* ── Color conversion helpers ──────────────────────────────── */
  function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const l = (max + min) / 2
    if (max === min) return [0, 0, l]
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h = 0
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
    return [h, s, l]
  }

  function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) {
      const v = Math.round(l * 255)
      return [v, v, v]
    }
    function hue2rgb(p: number, q: number, t: number) {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ]
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

    // Draw decorative palette indicator in corner
    drawPaletteOverlay(ctx, data.palette, cw, ch, 0.5)

    // Draw some faint brush stroke hints
    const strokes = ensureStrokes(index)
    ctx.save()
    ctx.globalAlpha = 0.08
    const mode = configRef.value.paintMode
    for (let i = 0; i < Math.min(strokes.length, 15); i++) {
      const stroke = strokes[i]
      const px = stroke.cx * cw + stroke.jitterX
      const py = stroke.cy * ch + stroke.jitterY
      drawSingleStroke(ctx, stroke, px, py, 1.0, mode, 'rgba(255,255,255,0.3)', cw, ch)
    }
    ctx.restore()
  }

  /* ── Draw color palette dots overlay ───────────────────────── */
  function drawPaletteOverlay(
    ctx: CanvasRenderingContext2D,
    palette: string[],
    cw: number,
    ch: number,
    alpha: number,
  ): void {
    if (alpha <= 0) return

    ctx.save()
    ctx.globalAlpha = alpha * 0.6

    const dotRadius = Math.max(6, Math.min(12, cw * 0.01))
    const spacing = dotRadius * 2.8
    const totalWidth = palette.length * spacing
    const startX = cw - totalWidth - 15
    const startY = ch - dotRadius - 12

    // Background pill
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath()
    const pillPad = 8
    const pillX = startX - pillPad
    const pillY = startY - dotRadius - pillPad
    const pillW = totalWidth + pillPad * 2
    const pillH = dotRadius * 2 + pillPad * 2
    const pillR = pillH / 2
    ctx.moveTo(pillX + pillR, pillY)
    ctx.lineTo(pillX + pillW - pillR, pillY)
    ctx.arc(pillX + pillW - pillR, pillY + pillR, pillR, -Math.PI / 2, Math.PI / 2)
    ctx.lineTo(pillX + pillR, pillY + pillH)
    ctx.arc(pillX + pillR, pillY + pillR, pillR, Math.PI / 2, -Math.PI / 2)
    ctx.closePath()
    ctx.fill()

    // Color dots
    for (let i = 0; i < palette.length; i++) {
      const x = startX + i * spacing
      const y = startY

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath()
      ctx.arc(x, y + 1, dotRadius, 0, Math.PI * 2)
      ctx.fill()

      // Color dot
      ctx.fillStyle = palette[i]
      ctx.beginPath()
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2)
      ctx.fill()

      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.arc(x - dotRadius * 0.25, y - dotRadius * 0.25, dotRadius * 0.35, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  /* ── Draw a single brush stroke shape ──────────────────────── */
  function drawSingleStroke(
    ctx: CanvasRenderingContext2D,
    stroke: BrushStroke,
    px: number,
    py: number,
    strokeProgress: number,  // 0-1 how much of the stroke is drawn
    mode: 'watercolor' | 'oil' | 'sketch',
    color: string,
    _cw: number,
    _ch: number,
  ): void {
    if (strokeProgress <= 0) return

    const drawLen = stroke.length * strokeProgress
    const w = stroke.width

    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(stroke.angle)

    switch (mode) {
      case 'watercolor': {
        // Soft, blurred, overlapping ellipses with varied opacity
        const steps = Math.max(3, Math.ceil(drawLen / (w * 0.6)))
        for (let i = 0; i < steps; i++) {
          const t = i / Math.max(1, steps - 1)
          const x = (t - 0.5) * drawLen
          const y = stroke.curvature * drawLen * Math.sin(t * Math.PI) * 0.3
          const r = w * (0.6 + 0.4 * Math.sin(t * Math.PI))  // thicker in middle
          const a = 0.15 + 0.15 * Math.sin(t * Math.PI)
          // Slight noise distortion
          const nx = x + noise2D(px + i * 0.3, py) * w * 0.3
          const ny = y + noise2D(px, py + i * 0.3) * w * 0.3

          ctx.globalAlpha = a * strokeProgress
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.ellipse(nx, ny, r, r * 0.7, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }

      case 'oil': {
        // Thick, textured strokes with visible edges
        ctx.lineWidth = w
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        // Main stroke body
        ctx.beginPath()
        ctx.moveTo(-drawLen / 2, 0)

        const cp1x = -drawLen / 6
        const cp1y = stroke.curvature * drawLen * 0.5
        const cp2x = drawLen / 6
        const cp2y = -stroke.curvature * drawLen * 0.3
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, drawLen / 2, 0)

        ctx.strokeStyle = color
        ctx.globalAlpha = stroke.peakAlpha * strokeProgress
        ctx.stroke()

        // Impasto highlight (thick paint texture)
        ctx.lineWidth = w * 0.4
        ctx.globalAlpha = 0.2 * strokeProgress
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.beginPath()
        ctx.moveTo(-drawLen / 2 + w * 0.3, -w * 0.15)
        ctx.bezierCurveTo(
          cp1x + w * 0.2, cp1y - w * 0.2,
          cp2x + w * 0.2, cp2y - w * 0.2,
          drawLen / 2 - w * 0.3, -w * 0.15,
        )
        ctx.stroke()

        // Edge shadow (depth effect)
        ctx.lineWidth = w * 0.3
        ctx.globalAlpha = 0.1 * strokeProgress
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'
        ctx.beginPath()
        ctx.moveTo(-drawLen / 2 + w * 0.2, w * 0.2)
        ctx.bezierCurveTo(
          cp1x - w * 0.1, cp1y + w * 0.25,
          cp2x - w * 0.1, cp2y + w * 0.25,
          drawLen / 2 - w * 0.2, w * 0.2,
        )
        ctx.stroke()
        break
      }

      case 'sketch': {
        // Thin, hatched lines with slight randomness
        ctx.lineWidth = Math.max(0.5, w * 0.3)
        ctx.lineCap = 'round'
        ctx.strokeStyle = color
        ctx.globalAlpha = stroke.peakAlpha * strokeProgress

        // Main line
        ctx.beginPath()
        const segs = Math.max(4, Math.ceil(drawLen / 8))
        ctx.moveTo(-drawLen / 2, 0)
        for (let i = 1; i <= segs; i++) {
          const t = i / segs
          const x = (-0.5 + t) * drawLen
          const y = stroke.curvature * drawLen * Math.sin(t * Math.PI) * 0.2
          // Tiny hand-drawn jitter
          const jx = (pseudoRandom(stroke.cx * 100 + i) - 0.5) * 2
          const jy = (pseudoRandom(stroke.cy * 100 + i) - 0.5) * 2
          ctx.lineTo(x + jx, y + jy)
        }
        ctx.stroke()

        // Secondary hatching line (cross-hatch)
        if (strokeProgress > 0.3) {
          ctx.globalAlpha = 0.3 * (strokeProgress - 0.3) / 0.7
          ctx.lineWidth = Math.max(0.5, w * 0.2)
          ctx.beginPath()
          ctx.moveTo(-drawLen / 2 + drawLen * 0.1, -w * 0.5)
          ctx.lineTo(drawLen / 2 - drawLen * 0.1, w * 0.5)
          ctx.stroke()
        }
        break
      }
    }

    ctx.restore()
  }

  /* ── Core: draw brush effect for a single stroke ────────────── */
  function drawBrushEffect(
    ctx: CanvasRenderingContext2D,
    stroke: BrushStroke,
    progress: number,
    cw: number,
    ch: number,
    toData: PrecomputedData,
    cfg: PaletteRepaintConfig,
  ): void {
    // Not yet born
    if (progress < stroke.birthProgress) return

    const strokeLifeProgress = Math.min(
      1,
      (progress - stroke.birthProgress) / Math.max(0.01, stroke.drawDuration),
    )
    if (strokeLifeProgress <= 0) return

    const px = stroke.cx * cw + stroke.jitterX
    const py = stroke.cy * ch + stroke.jitterY
    const drawEase = easeOutExpo(strokeLifeProgress)

    // Sample color from the target image at stroke position
    const sampleX = Math.min(1, Math.max(0, stroke.cx + stroke.colorOffsetX))
    const sampleY = Math.min(1, Math.max(0, stroke.cy + stroke.colorOffsetY))
    const color = sampleColor(toData.imageData, sampleX, sampleY, cfg.paletteHue)

    // ── Phase 1: Draw the brush stroke ──
    ctx.save()

    // Color bleed: expand the stroke area slightly with a transparent version
    if (cfg.colorBleed > 0 && strokeLifeProgress > 0.2) {
      const bleedAlpha = cfg.colorBleed * 0.15 * easeOutQuart((strokeLifeProgress - 0.2) / 0.8)
      ctx.globalAlpha = bleedAlpha
      const bleedStroke = {
        ...stroke,
        width: stroke.width * (1 + cfg.colorBleed * 0.8),
        length: stroke.length * (1 + cfg.colorBleed * 0.3),
      }
      drawSingleStroke(ctx, bleedStroke, px, py, drawEase, cfg.paintMode, color, cw, ch)
    }

    // Main stroke
    ctx.globalAlpha = 1
    drawSingleStroke(ctx, stroke, px, py, drawEase, cfg.paintMode, color, cw, ch)

    ctx.restore()

    // ── Phase 2: Reveal the target image through stroke clip ──
    if (strokeLifeProgress > 0.4) {
      const revealProgress = easeOutQuart((strokeLifeProgress - 0.4) / 0.6)

      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(stroke.angle)

      // Create clipping region matching the stroke shape
      const clipLen = stroke.length * drawEase
      const clipW = stroke.width * revealProgress

      ctx.beginPath()
      switch (cfg.paintMode) {
        case 'watercolor': {
          // Soft elliptical clip
          ctx.ellipse(0, 0, clipLen / 2, clipW, 0, 0, Math.PI * 2)
          break
        }
        case 'oil': {
          // Thick bezier clip
          const half = clipLen / 2
          ctx.moveTo(-half, -clipW / 2)
          ctx.bezierCurveTo(
            -half / 3, -clipW / 2 + stroke.curvature * clipLen * 0.3,
            half / 3, -clipW / 2 - stroke.curvature * clipLen * 0.2,
            half, -clipW / 2,
          )
          ctx.lineTo(half, clipW / 2)
          ctx.bezierCurveTo(
            half / 3, clipW / 2 - stroke.curvature * clipLen * 0.2,
            -half / 3, clipW / 2 + stroke.curvature * clipLen * 0.3,
            -half, clipW / 2,
          )
          ctx.closePath()
          break
        }
        case 'sketch': {
          // Thin rect clip
          const half = clipLen / 2
          ctx.rect(-half, -clipW / 2, clipLen, clipW)
          break
        }
      }
      ctx.clip()

      // Reset transform to draw the image at canvas coordinates
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = revealProgress * 0.6
      ctx.drawImage(toData.offscreen, 0, 0)

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

      // Subtle palette overlay during pause
      if (rawProgress >= 1 && images.length > 1 && nextData) {
        const pauseFade = Math.sin((elapsedMs * 0.001) % Math.PI)
        drawPaletteOverlay(ctx, nextData.palette, cw, ch, 0.3 + 0.2 * pauseFade)
      }
      return
    }

    // ── Transition: palette repaint ────────────────────────────
    const strokes = ensureStrokes(imageIndex)

    // Draw base (from) image
    ctx.drawImage(data.offscreen, 0, 0)

    // Optional: slight desaturation of from-image as transition progresses
    if (rawProgress > 0.1) {
      const fadeAlpha = easeInOutCubic(Math.min(1, (rawProgress - 0.1) / 0.5)) * 0.15
      ctx.save()
      ctx.globalAlpha = fadeAlpha
      ctx.fillStyle = 'rgba(128, 128, 128, 1)'
      ctx.globalCompositeOperation = 'saturation'
      ctx.fillRect(0, 0, cw, ch)
      ctx.restore()
    }

    // Draw each brush stroke
    for (const stroke of strokes) {
      drawBrushEffect(ctx, stroke, rawProgress, cw, ch, nextData, cfg)
    }

    // ── Final cross-fade for smooth ending ────────────────────
    if (rawProgress > 0.82) {
      const fadeProgress = (rawProgress - 0.82) / 0.18
      ctx.save()
      ctx.globalAlpha = easeInOutCubic(fadeProgress)
      ctx.drawImage(nextData.offscreen, 0, 0)
      ctx.restore()
    }

    // ── Canvas texture overlay (paper/canvas grain) ───────────
    if (cfg.paintMode === 'watercolor' || cfg.paintMode === 'oil') {
      drawCanvasTexture(ctx, cw, ch, rawProgress, cfg.paintMode)
    }

    // ── Palette overlay ──────────────────────────────────────
    const paletteAlpha = Math.sin(rawProgress * Math.PI) * 0.8
    drawPaletteOverlay(ctx, nextData.palette, cw, ch, paletteAlpha)
  }

  /* ── Canvas texture overlay ─────────────────────────────────── */
  function drawCanvasTexture(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    progress: number,
    mode: 'watercolor' | 'oil',
  ): void {
    const intensity = Math.sin(progress * Math.PI) * 0.03

    if (intensity <= 0.001) return

    ctx.save()
    ctx.globalAlpha = intensity

    if (mode === 'watercolor') {
      // Subtle paper texture effect — random speckles
      ctx.fillStyle = 'rgba(245, 240, 230, 1)'
      ctx.globalCompositeOperation = 'overlay'
      const step = 12
      for (let x = 0; x < cw; x += step) {
        for (let y = 0; y < ch; y += step) {
          const n = noise2D(x * 0.05, y * 0.05)
          if (n > 0.55) {
            ctx.globalAlpha = intensity * (n - 0.55) * 4
            ctx.fillRect(x, y, step, step)
          }
        }
      }
    } else {
      // Oil painting canvas weave
      ctx.strokeStyle = 'rgba(200, 190, 170, 0.5)'
      ctx.lineWidth = 0.5
      ctx.globalCompositeOperation = 'overlay'
      const step = 8
      for (let x = 0; x < cw; x += step) {
        const wave = Math.sin(x * 0.1 + progress * 10) * 0.5
        ctx.globalAlpha = intensity * (0.5 + wave * 0.5)
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, ch)
        ctx.stroke()
      }
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
    strokesCache = null
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
