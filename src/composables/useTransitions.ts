// ─────────────────────────────────────────────────────────────────────────────
// Trending video transitions (2024-2025) — Canvas 2D, no WebGL required.
// All functions: (ctx, from, to, progress 0→1) => void
// ─────────────────────────────────────────────────────────────────────────────

import { canvasBg } from './useTheme'

export type DrawTransitionType =
  | 'pushLeft' | 'pushRight' | 'pushUp' | 'pushDown'
  | 'zoom' | 'cardFlip' | 'pageFlip'
  | 'maskCircle' | 'radialWipe' | 'blindsH' | 'inkSpread'
  | 'liquid' | 'glitch' | 'pixelate' | 'lensFlare'

export type TransitionType = 'ripple' | DrawTransitionType

export type DrawTransitionFn = (
  ctx: CanvasRenderingContext2D,
  from: CanvasImageSource,
  to: CanvasImageSource,
  progress: number,
) => void

export interface TransitionMeta {
  type: TransitionType
  label: string
  desc: string
  cat: 'push' | 'transform' | 'reveal' | 'distort' | 'light'
}

export const TRANSITIONS: TransitionMeta[] = [
  // ── Distort
  { type: 'ripple',     label: '涟漪', desc: '水面波纹扩散',    cat: 'distort'    },
  { type: 'liquid',     label: '液态', desc: '液体从下流入',    cat: 'distort'    },
  { type: 'glitch',     label: '故障', desc: 'RGB通道错位闪切', cat: 'distort'    },
  { type: 'pixelate',   label: '像素', desc: '马赛克像素化',    cat: 'distort'    },
  // ── Push / Motion
  { type: 'pushLeft',   label: '推左', desc: '画面向左推移',    cat: 'push'       },
  { type: 'pushRight',  label: '推右', desc: '画面向右推移',    cat: 'push'       },
  { type: 'pushUp',     label: '推上', desc: '画面向上推移',    cat: 'push'       },
  { type: 'pushDown',   label: '推下', desc: '画面向下推移',    cat: 'push'       },
  // ── Transform
  { type: 'zoom',       label: '穿越', desc: '急速缩放穿越',    cat: 'transform'  },
  { type: 'cardFlip',   label: '翻转', desc: '卡片水平翻转',    cat: 'transform'  },
  { type: 'pageFlip',   label: '翻页', desc: '书页向左翻过',    cat: 'transform'  },
  // ── Reveal
  { type: 'maskCircle', label: '圆形', desc: '圆形扩散遮罩',    cat: 'reveal'     },
  { type: 'radialWipe', label: '雷达', desc: '时钟扫描揭示',    cat: 'reveal'     },
  { type: 'blindsH',    label: '百叶', desc: '水平百叶窗展开',  cat: 'reveal'     },
  { type: 'inkSpread',  label: '墨染', desc: '有机油墨扩散',    cat: 'reveal'     },
  // ── Light
  { type: 'lensFlare',  label: '光晕', desc: '镜头光斑扫过',    cat: 'light'      },
]

// ─────────────────────────────────────────────────────────────────────────────
// Composable — call once per page instance to get shared cached resources
// ─────────────────────────────────────────────────────────────────────────────
export function useTransitions() {
  // Reusable offscreen canvas for pixel-based transitions (glitch, pixelate)
  let offW = 0, offH = 0
  let offscreen: OffscreenCanvas | null = null
  let offCtx: OffscreenCanvasRenderingContext2D | null = null

  function getOff(w: number, h: number) {
    if (!offscreen || offW !== w || offH !== h) {
      offscreen = new OffscreenCanvas(w, h)
      offCtx = offscreen.getContext('2d')!
      offW = w; offH = h
    }
    return { off: offscreen, oCtx: offCtx! }
  }

  // ── Easing ────────────────────────────────────────────────────────────────
  function ease(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  }

  // ── Cover-fit draw helper ─────────────────────────────────────────────────
  // Draws `src` centered & cover-fitted into the canvas, offset by (ox, oy).
  function drawAt(
    ctx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    ox: number,
    oy: number,
  ): void {
    const cw = ctx.canvas.width, ch = ctx.canvas.height
    const sw =
      src instanceof HTMLVideoElement ? src.videoWidth
      : src instanceof HTMLImageElement ? src.naturalWidth
      : (src as HTMLCanvasElement).width || cw
    const sh =
      src instanceof HTMLVideoElement ? src.videoHeight
      : src instanceof HTMLImageElement ? src.naturalHeight
      : (src as HTMLCanvasElement).height || ch
    if (!sw || !sh) { ctx.drawImage(src, ox, oy, cw, ch); return }
    const scale = Math.max(cw / sw, ch / sh)
    const dw = sw * scale, dh = sh * scale
    ctx.drawImage(src, ox + (cw - dw) / 2, oy + (ch - dh) / 2, dw, dh)
  }

  // ── 1-4  Push transitions ─────────────────────────────────────────────────
  const pushLeft: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const e = ease(t)
    ctx.fillStyle = canvasBg.value; ctx.fillRect(0, 0, w, h)
    drawAt(ctx, from, -w * e, 0)
    drawAt(ctx, to,   w * (1 - e), 0)
  }

  const pushRight: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const e = ease(t)
    ctx.fillStyle = canvasBg.value; ctx.fillRect(0, 0, w, h)
    drawAt(ctx, from, w * e, 0)
    drawAt(ctx, to,  -w * (1 - e), 0)
  }

  const pushUp: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const e = ease(t)
    ctx.fillStyle = canvasBg.value; ctx.fillRect(0, 0, w, h)
    drawAt(ctx, from, 0, -h * e)
    drawAt(ctx, to,   0,  h * (1 - e))
  }

  const pushDown: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const e = ease(t)
    ctx.fillStyle = canvasBg.value; ctx.fillRect(0, 0, w, h)
    drawAt(ctx, from, 0,  h * e)
    drawAt(ctx, to,   0, -h * (1 - e))
  }

  // ── 5  Zoom punch-through ─────────────────────────────────────────────────
  // First half: FROM zooms IN 1x → 5x (camera rushing forward)
  // Second half: TO zooms OUT 5x → 1x (camera pulling back)
  const zoom: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const cx = w / 2, cy = h / 2
    ctx.fillStyle = canvasBg.value; ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.translate(cx, cy)
    let scale: number
    if (t < 0.5) {
      scale = 1 + ease(t * 2) * 4
      ctx.scale(scale, scale)
      ctx.translate(-cx, -cy)
      drawAt(ctx, from, 0, 0)
    } else {
      scale = 5 - ease((t - 0.5) * 2) * 4
      ctx.scale(scale, scale)
      ctx.translate(-cx, -cy)
      drawAt(ctx, to, 0, 0)
    }
    ctx.restore()
  }

  // ── 6  Card flip (horizontal X-axis compression) ──────────────────────────
  const cardFlip: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    ctx.fillStyle = canvasBg.value; ctx.fillRect(0, 0, w, h)
    const half = t < 0.5
    const localT = half ? ease(t * 2) : ease((t - 0.5) * 2)
    const scaleX = half ? 1 - localT : localT
    const curW = w * scaleX
    if (curW <= 0) return
    const ox = (w - curW) / 2
    ctx.drawImage(half ? from : to, ox, 0, curW, h)
    // Edge shadow for depth
    const grad = ctx.createLinearGradient(ox, 0, ox + curW, 0)
    grad.addColorStop(0,   'rgba(0,0,0,0.55)')
    grad.addColorStop(0.12,'rgba(0,0,0,0)')
    grad.addColorStop(0.88,'rgba(0,0,0,0)')
    grad.addColorStop(1,   'rgba(0,0,0,0.55)')
    ctx.fillStyle = grad
    ctx.fillRect(ox, 0, curW, h)
  }

  // ── 7  Page flip (right-to-left fold reveal) ──────────────────────────────
  const pageFlip: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const e = ease(t)
    const foldX = w * (1 - e)  // fold line moves right→left

    // TO image as background
    drawAt(ctx, to, 0, 0)

    // FROM image — only the part to the right of the fold
    if (foldX > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(foldX, 0, w - foldX, h)
      ctx.clip()
      drawAt(ctx, from, 0, 0)
      ctx.restore()

      // Fold shadow falling onto TO image
      const shadowW = Math.min(foldX, 60)
      const shadowGrad = ctx.createLinearGradient(Math.max(0, foldX - shadowW), 0, foldX, 0)
      shadowGrad.addColorStop(0, 'rgba(0,0,0,0)')
      shadowGrad.addColorStop(1, 'rgba(0,0,0,0.4)')
      ctx.fillStyle = shadowGrad
      ctx.fillRect(Math.max(0, foldX - shadowW), 0, shadowW, h)

      // Bright fold highlight
      const hlGrad = ctx.createLinearGradient(foldX - 2, 0, foldX + 2, 0)
      hlGrad.addColorStop(0,   'rgba(255,255,255,0)')
      hlGrad.addColorStop(0.5, `rgba(255,255,255,${0.35 * (1 - e)})`)
      hlGrad.addColorStop(1,   'rgba(255,255,255,0)')
      ctx.fillStyle = hlGrad
      ctx.fillRect(foldX - 2, 0, 4, h)
    }
  }

  // ── 8  Mask circle (expanding circle reveal) ──────────────────────────────
  const maskCircle: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const maxR = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2) * 1.05
    drawAt(ctx, from, 0, 0)
    ctx.save()
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, ease(t) * maxR, 0, Math.PI * 2)
    ctx.clip()
    drawAt(ctx, to, 0, 0)
    ctx.restore()
  }

  // ── 9  Radial wipe (clockwise sweep from 12 o'clock) ──────────────────────
  const radialWipe: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const cx = w / 2, cy = h / 2
    const maxR = Math.sqrt(cx ** 2 + cy ** 2) * 1.1
    drawAt(ctx, from, 0, 0)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, maxR, -Math.PI / 2, -Math.PI / 2 + ease(t) * Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    drawAt(ctx, to, 0, 0)
    ctx.restore()
  }

  // ── 10  Venetian blinds (horizontal strips, staggered) ───────────────────
  const blindsH: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const COUNT = 10
    const sliceH = h / COUNT
    drawAt(ctx, from, 0, 0)
    for (let i = 0; i < COUNT; i++) {
      const delay = (i / COUNT) * 0.45
      const local = Math.max(0, Math.min(1, (t - delay) / (1 - 0.45)))
      if (local <= 0) continue
      const curW = w * ease(local)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, i * sliceH, curW, sliceH)
      ctx.clip()
      drawAt(ctx, to, 0, 0)
      ctx.restore()
    }
  }

  // ── 11  Ink spread (organic blob path, deterministic noise) ──────────────
  const inkSpread: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const cx = w / 2, cy = h / 2
    const maxR = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2) * 1.3
    const r = ease(t) * maxR
    drawAt(ctx, from, 0, 0)
    ctx.save()
    // Organic blob outline using deterministic harmonic noise
    const PTS = 80
    ctx.beginPath()
    for (let i = 0; i <= PTS; i++) {
      const a = (i / PTS) * Math.PI * 2
      const n =
        1
        + 0.28 * Math.sin(a * 2 + 0.5)
        + 0.14 * Math.sin(a * 5 + 1.2)
        + 0.08 * Math.sin(a * 9 + 0.8)
        + 0.05 * Math.sin(a * 13 + 2.1)
      const blobR = r * n
      const x = cx + Math.cos(a) * blobR
      const y = cy + Math.sin(a) * blobR
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.clip()
    drawAt(ctx, to, 0, 0)
    ctx.restore()
  }

  // ── 12  Liquid flow (sine-wave bottom rising up) ──────────────────────────
  const liquid: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const liquidTop = h * (1 - ease(t))
    const waveAmp = 22 * Math.sin(t * Math.PI) // max amplitude at midpoint
    drawAt(ctx, from, 0, 0)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(0, liquidTop)
    const STEPS = 48
    for (let i = 0; i <= STEPS; i++) {
      const x = (i / STEPS) * w
      // Two-harmonic wave for organic feel
      const wave =
        Math.sin((i / STEPS) * Math.PI * 5) * waveAmp
        + Math.sin((i / STEPS) * Math.PI * 9 + 1.0) * waveAmp * 0.4
      ctx.lineTo(x, liquidTop + wave)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.clip()
    drawAt(ctx, to, 0, 0)
    ctx.restore()
  }

  // ── 13  Lens flare / light leak ───────────────────────────────────────────
  const lensFlare: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    // Base image switches at 50%
    drawAt(ctx, t < 0.5 ? from : to, 0, 0)
    const intensity = Math.sin(t * Math.PI) // peaks at t=0.5
    // Flare moves diagonally: top-left → bottom-right
    const fx = w * (0.05 + t * 0.7)
    const fy = h * (0.05 + t * 0.5)
    const mainR = 350 * intensity + 60
    // Main glow
    const gMain = ctx.createRadialGradient(fx, fy, 0, fx, fy, mainR)
    gMain.addColorStop(0,    `rgba(255,252,230,${intensity * 0.92})`)
    gMain.addColorStop(0.18, `rgba(255,220,170,${intensity * 0.55})`)
    gMain.addColorStop(0.45, `rgba(255,200,140,${intensity * 0.22})`)
    gMain.addColorStop(1,    'rgba(255,180,100,0)')
    ctx.fillStyle = gMain
    ctx.fillRect(0, 0, w, h)
    // Secondary lens flares along the axis
    const flares = [
      { rx: -0.18, ry: -0.08, r: 55,  a: 0.38 },
      { rx:  0.10, ry:  0.04, r: 95,  a: 0.24 },
      { rx:  0.28, ry:  0.10, r: 40,  a: 0.48 },
      { rx: -0.32, ry: -0.12, r: 70,  a: 0.20 },
      { rx:  0.42, ry:  0.16, r: 25,  a: 0.55 },
    ]
    for (const f of flares) {
      const gx = fx + w * f.rx, gy = fy + h * f.ry
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, f.r)
      g.addColorStop(0, `rgba(255,242,200,${f.a * intensity})`)
      g.addColorStop(1, 'rgba(255,210,120,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    // Center over-exposure whiteout
    if (intensity > 0.68) {
      const overExp = (intensity - 0.68) / 0.32
      ctx.fillStyle = `rgba(255,255,255,${overExp * 0.96})`
      ctx.fillRect(0, 0, w, h)
    }
  }

  // ── 14  Glitch / Signal error (RGB channel split + block distortion) ──────
  // Uses step=2 blocks for performance. Deterministic pseudo-random for export.
  const glitch: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const intensity = Math.sin(t * Math.PI)
    const { oCtx } = getOff(w, h)

    oCtx.drawImage(t < 0.5 ? from : to, 0, 0, w, h)
    const src = oCtx.getImageData(0, 0, w, h).data
    const out = new Uint8ClampedArray(w * h * 4)

    const step = 2
    const shiftR =  Math.round(intensity * 18)
    const shiftB = -Math.round(intensity * 12)

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const xR = Math.max(0, Math.min(w - 1, x + shiftR))
        const xB = Math.max(0, Math.min(w - 1, x + shiftB))
        const i   = (y * w + x) * 4
        const iR  = (y * w + xR) * 4
        const iB  = (y * w + xB) * 4
        const r = src[iR], g = src[i + 1], b = src[iB + 2]
        for (let by = 0; by < step && y + by < h; by++) {
          for (let bx = 0; bx < step && x + bx < w; bx++) {
            const di = ((y + by) * w + (x + bx)) * 4
            out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = 255
          }
        }
      }
    }

    // Deterministic horizontal block shifts (sin-based pseudo-random)
    const blockCount = Math.floor(intensity * 7) + 1
    for (let bi = 0; bi < blockCount; bi++) {
      const blockY = Math.floor(((Math.sin(bi * 1.73 + t * 21) * 0.5 + 0.5)) * h)
      const blockH = 8 + Math.floor((Math.cos(bi * 2.31 + t * 17) * 0.5 + 0.5) * 28)
      const shift  = Math.round(Math.sin(bi * 3.14 + t * 29) * 45)
      for (let y = blockY; y < Math.min(blockY + blockH, h); y++) {
        for (let x = 0; x < w; x++) {
          const sx = Math.max(0, Math.min(w - 1, x + shift))
          const di = (y * w + x) * 4
          const si = (y * w + sx) * 4
          out[di] = out[si]; out[di + 1] = out[si + 1]
          out[di + 2] = out[si + 2]; out[di + 3] = out[si + 3]
        }
      }
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0)

    // Flash burst at peak
    if (intensity > 0.62) {
      ctx.fillStyle = `rgba(255,255,255,${((intensity - 0.62) / 0.38) * 0.75})`
      ctx.fillRect(0, 0, w, h)
    }
  }

  // ── 15  Pixelate / Mosaic ─────────────────────────────────────────────────
  // First half: FROM pixelates (1px → 60px blocks).
  // Second half: TO un-pixelates (60px → 1px blocks).
  const pixelate: DrawTransitionFn = (ctx, from, to, t) => {
    const { width: w, height: h } = ctx.canvas
    const half = t < 0.5
    const localT = half ? ease(t * 2) : ease((1 - t) * 2)
    const pixelSize = Math.max(1, Math.round(localT * 60))
    const src = half ? from : to

    if (pixelSize <= 1) { drawAt(ctx, src, 0, 0); return }

    const smallW = Math.max(1, Math.ceil(w / pixelSize))
    const smallH = Math.max(1, Math.ceil(h / pixelSize))
    const { off, oCtx } = getOff(smallW, smallH)
    oCtx.imageSmoothingEnabled = false
    oCtx.drawImage(src, 0, 0, smallW, smallH)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(off, 0, 0, smallW, smallH, 0, 0, w, h)
    ctx.imageSmoothingEnabled = true
  }

  // ── Export map ────────────────────────────────────────────────────────────
  const fns: Record<DrawTransitionType, DrawTransitionFn> = {
    pushLeft, pushRight, pushUp, pushDown,
    zoom, cardFlip, pageFlip,
    maskCircle, radialWipe, blindsH, inkSpread,
    liquid, glitch, pixelate, lensFlare,
  }

  return { fns }
}
