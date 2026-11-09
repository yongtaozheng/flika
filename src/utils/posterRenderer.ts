import type { PosterConfig, PosterTextLayer } from '../types'
import { POSTER_DIMS, POSTER_FONTS } from './posterTemplates'

export interface PosterBounds {
  x: number
  y: number
  width: number
  height: number
}
export interface PosterTextBounds extends PosterBounds {
  fontSize: number
  overflow: boolean
}
export type PosterSelection = 'title' | 'subtitle' | 'logo' | 'image'
export type PosterRenderResult = Partial<Record<PosterSelection, PosterBounds>> & {
  title?: PosterTextBounds
  subtitle?: PosterTextBounds
}
export type PosterMedia = HTMLImageElement | HTMLVideoElement

export function mediaFrame(config: PosterConfig, w: number, h: number): PosterBounds {
  const portrait = h > w
  const square = h === w
  const tall = portrait || square
  const composition = config.composition
  if (composition) {
    switch (composition) {
      case 'panorama':
        return { x: w * 0.035, y: h * 0.15, width: w * 0.93, height: h * 0.79 }
      case 'contact':
        return tall
          ? { x: w * 0.08, y: h * 0.35, width: w * 0.84, height: h * 0.38 }
          : { x: w * 0.49, y: h * 0.18, width: w * 0.44, height: h * 0.49 }
      case 'record': {
        const side = Math.min(w * (tall ? 0.76 : 0.38), h * (tall ? 0.4 : 0.66))
        return {
          x: tall ? (w - side) / 2 : w * 0.55,
          y: h * (tall ? 0.39 : 0.18),
          width: side,
          height: side,
        }
      }
      case 'sleeve':
        return tall
          ? { x: w * 0.1, y: h * 0.37, width: w * 0.8, height: h * 0.43 }
          : { x: w * 0.53, y: h * 0.16, width: w * 0.4, height: h * 0.67 }
      case 'archive': {
        const side = Math.min(w * (tall ? 0.76 : 0.38), h * (tall ? 0.43 : 0.65))
        return {
          x: tall ? (w - side) / 2 : w * 0.55,
          y: h * (tall ? 0.38 : 0.19),
          width: side,
          height: side,
        }
      }
      case 'collage':
        return tall
          ? { x: w * 0.09, y: h * 0.14, width: w * 0.82, height: h * 0.43 }
          : { x: w * 0.52, y: h * 0.17, width: w * 0.41, height: h * 0.62 }
      case 'type':
        return tall
          ? { x: w * 0.24, y: h * 0.52, width: w * 0.7, height: h * 0.28 }
          : { x: w * 0.67, y: h * 0.22, width: w * 0.28, height: h * 0.58 }
      case 'orbit':
        return tall
          ? { x: w * 0.15, y: h * 0.4, width: w * 0.7, height: h * 0.37 }
          : { x: w * 0.58, y: h * 0.22, width: w * 0.34, height: h * 0.6 }
    }
  }
  switch (config.layout) {
    case 'album': {
      const side = Math.min(w * 0.8, h * (square ? 0.52 : 0.65))
      return {
        x: portrait || square ? (w - side) / 2 : w * 0.07,
        y: portrait ? h * 0.13 : h * 0.16,
        width: side,
        height: side,
      }
    }
    case 'editorial':
      return portrait || square
        ? { x: w * 0.08, y: h * 0.4, width: w * 0.84, height: h * 0.36 }
        : { x: w * 0.54, y: h * 0.17, width: w * 0.39, height: h * 0.66 }
    case 'bold':
      return portrait || square
        ? { x: w * 0.17, y: h * 0.46, width: w * 0.75, height: h * 0.36 }
        : { x: w * 0.59, y: h * 0.18, width: w * 0.34, height: h * 0.64 }
    default:
      return { x: 0, y: 0, width: w, height: h }
  }
}

function drawMedia(
  ctx: CanvasRenderingContext2D,
  source: PosterMedia,
  frame: PosterBounds,
  cfg: PosterConfig,
) {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  if (!sw || !sh) return
  const fit = cfg.bgFit === 'contain' ? Math.min : Math.max
  const scale = fit(frame.width / sw, frame.height / sh) * (cfg.bgZoom ?? 1)
  const dw = sw * scale
  const dh = sh * scale
  const x = frame.x + (frame.width - dw) * (cfg.bgPositionX ?? 0.5)
  const y = frame.y + (frame.height - dh) * (cfg.bgPositionY ?? 0.5)
  ctx.save()
  ctx.beginPath()
  ctx.rect(frame.x, frame.y, frame.width, frame.height)
  ctx.clip()
  ctx.drawImage(source, x, y, dw, dh)
  ctx.restore()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const char of Array.from(paragraph)) {
      if (line && ctx.measureText(line + char).width > maxWidth) {
        lines.push(line)
        line = char
      } else line += char
    }
    lines.push(line)
  }
  return lines
}

function drawText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  layer: PosterTextLayer,
): PosterTextBounds {
  const availableWidth = Math.max(1, (layer.width ?? 0.84) * w)
  const availableHeight = Math.max(1, (layer.maxHeight ?? 0.3) * h)
  let size = Math.max(12, Math.min(400, Number(layer.fontSize) || 12))
  const font = () =>
    `${layer.fontStyle} ${layer.fontWeight} ${size}px ${layer.fontFamily || POSTER_FONTS[0].value}`
  ctx.save()
  ctx.font = font()
  let lines = wrapText(ctx, layer.text, availableWidth)
  const lineSpacing = layer.lineHeight ?? 1.2
  if (
    layer.autoFit !== false &&
    (lines.length * size * lineSpacing > availableHeight ||
      lines.some((line) => ctx.measureText(line).width > availableWidth))
  ) {
    let lower = 12
    let upper = Math.floor(size)
    let fitted = 12
    while (lower <= upper) {
      size = Math.floor((lower + upper) / 2)
      ctx.font = font()
      const candidate = wrapText(ctx, layer.text, availableWidth)
      const fits =
        candidate.length * size * lineSpacing <= availableHeight &&
        candidate.every((line) => ctx.measureText(line).width <= availableWidth)
      if (fits) {
        fitted = size
        lower = size + 1
      } else upper = size - 1
    }
    size = fitted
    ctx.font = font()
    lines = wrapText(ctx, layer.text, availableWidth)
  }
  const textHeight = lines.length * size * lineSpacing
  const left =
    layer.x * w -
    (layer.textAlign === 'center'
      ? availableWidth / 2
      : layer.textAlign === 'right'
        ? availableWidth
        : 0)
  const top = layer.y * h - textHeight / 2
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  ctx.lineWidth = layer.strokeWidth * 2
  const highlight = layer.highlight?.trim()
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]
    const measured = ctx.measureText(text).width
    let x =
      left +
      (layer.textAlign === 'center'
        ? (availableWidth - measured) / 2
        : layer.textAlign === 'right'
          ? availableWidth - measured
          : 0)
    const y = top + (index + 0.5) * size * lineSpacing
    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.strokeColor
      ctx.strokeText(text, x, y)
    }
    ctx.shadowBlur = layer.shadowBlur
    ctx.shadowColor = layer.shadowColor
    const parts = highlight ? text.split(highlight) : [text]
    parts.forEach((part, partIndex) => {
      ctx.fillStyle = layer.color
      ctx.fillText(part, x, y)
      x += ctx.measureText(part).width
      if (partIndex < parts.length - 1) {
        ctx.fillStyle = layer.highlightColor || layer.color
        ctx.fillText(highlight!, x, y)
        x += ctx.measureText(highlight!).width
      }
    })
  }
  ctx.restore()
  return {
    x: left,
    y: top,
    width: availableWidth,
    height: Math.max(size * lineSpacing, textHeight),
    fontSize: size,
    overflow:
      textHeight > availableHeight ||
      left < 0 ||
      top < 0 ||
      left + availableWidth > w + 1 ||
      top + textHeight > h + 1,
  }
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  maxWidth?: number,
) {
  ctx.save()
  ctx.font = `500 ${size}px "Avenir Next", "PingFang SC", sans-serif`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (maxWidth) ctx.fillText(text, x, y, maxWidth)
  else ctx.fillText(text, x, y)
  ctx.restore()
}

function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  endX: number,
  endY: number,
  color: string,
  width = 1,
) {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(endX, endY)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.beginPath()
  for (let index = 0; index < 16; index++) {
    const angle = (index * Math.PI) / 8
    const distance = index % 2 === 0 ? radius : radius * 0.32
    const px = x + Math.cos(angle) * distance
    const py = y + Math.sin(angle) * distance
    if (index === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function paperTexture(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save()
  ctx.fillStyle = '#44392b'
  ctx.globalAlpha = 0.07
  let seed = 23
  for (let index = 0; index < 1600; index++) {
    seed = (seed * 16807) % 2147483647
    const x = seed % Math.ceil(w)
    seed = (seed * 16807) % 2147483647
    const y = seed % Math.ceil(h)
    ctx.fillRect(x, y, Math.max(0.5, w * 0.0006), Math.max(0.5, h * 0.0008))
  }
  ctx.restore()
}

function tornPhotoPath(ctx: CanvasRenderingContext2D, frame: PosterBounds, padding = 0) {
  const { x, y, width, height } = frame
  ctx.beginPath()
  ctx.moveTo(x - padding, y - padding)
  for (let index = 0; index <= 40; index++) {
    const tear = (Math.sin(index * 7.3) + Math.cos(index * 3.1)) * width * 0.004
    ctx.lineTo(x + (width * index) / 40, y - padding + tear)
  }
  ctx.lineTo(x + width + padding, y + height + padding)
  for (let index = 40; index >= 0; index--) {
    const tear = (Math.sin(index * 5.7) + Math.cos(index * 8.1)) * width * 0.006
    ctx.lineTo(x + (width * index) / 40, y + height + padding + tear)
  }
  ctx.closePath()
}

function clipCompositionPhoto(
  ctx: CanvasRenderingContext2D,
  cfg: PosterConfig,
  frame: PosterBounds,
) {
  const { x, y, width, height } = frame
  ctx.beginPath()
  ctx.rect(x, y, width, height)
  ctx.clip()
  if (['record', 'archive', 'orbit'].includes(cfg.composition || '')) {
    ctx.beginPath()
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    ctx.clip()
  } else if (cfg.composition === 'sleeve' || cfg.composition === 'type') {
    const radius = Math.min(width / 2, height * 0.65)
    ctx.beginPath()
    ctx.moveTo(x, y + height)
    ctx.lineTo(x, y + radius)
    ctx.ellipse(x + width / 2, y + radius, width / 2, radius, 0, Math.PI, 0)
    ctx.lineTo(x + width, y + height)
    ctx.closePath()
    ctx.clip()
  } else if (cfg.composition === 'collage') {
    tornPhotoPath(ctx, frame)
    ctx.clip()
  }
}

function drawCompositionBase(
  ctx: CanvasRenderingContext2D,
  cfg: PosterConfig,
  w: number,
  h: number,
  frame: PosterBounds,
) {
  const ink = cfg.title.color
  const accent = cfg.accentColor || '#ec643b'
  const unit = Math.min(w, h)
  const tall = h >= w
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  ctx.save()
  if (cfg.composition === 'record') {
    // The photo is the record label, with playable grooves surrounding it.
    const radius = frame.width * 0.59
    ctx.fillStyle = '#181d1b'
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 0; i < 18; i++) {
      ctx.beginPath()
      ctx.arc(cx, cy, radius - i * unit * 0.0033, 0, Math.PI * 2)
      ctx.strokeStyle = i % 3 === 0 ? '#ffffff30' : '#ffffff10'
      ctx.lineWidth = unit * 0.001
      ctx.stroke()
    }
    const gradient = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius)
    gradient.addColorStop(0, '#ffffff00')
    gradient.addColorStop(0.45, '#ffffff00')
    gradient.addColorStop(0.5, '#ffffff28')
    gradient.addColorStop(0.55, '#ffffff00')
    gradient.addColorStop(1, '#ffffff00')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
    label(ctx, cfg.edition || '01', w * 0.08, h * (tall ? 0.32 : 0.63), unit * 0.075, accent)
  }
  if (cfg.composition === 'sleeve') {
    ctx.fillStyle = accent
    ctx.fillRect(0, h * 0.7, w, h * 0.3)
    ctx.fillStyle = ink
    ctx.fillRect(w * 0.025, 0, w * 0.018, h)
    for (let i = 0; i < 7; i++)
      line(
        ctx,
        w * 0.48 + i * unit * 0.017,
        h * 0.08,
        w * 0.48 + i * unit * 0.017,
        h * 0.92,
        ink,
        unit * 0.001,
      )
    label(ctx, cfg.edition || '01', w * 0.92, h * 0.91, unit * 0.075, ink, 'right')
    star(ctx, w * (tall ? 0.83 : 0.43), h * (tall ? 0.3 : 0.62), unit * 0.055, ink)
  }
  if (cfg.composition === 'archive') {
    ctx.strokeStyle = '#2d514219'
    ctx.lineWidth = unit * 0.001
    for (let x = w * 0.025; x < w; x += unit * 0.055)
      line(ctx, x, 0, x, h, '#2d514219', unit * 0.001)
    for (let y = h * 0.025; y < h; y += unit * 0.055)
      line(ctx, 0, y, w, y, '#2d514219', unit * 0.001)
    ctx.beginPath()
    ctx.moveTo(w * 0.04, h * 0.86)
    ctx.bezierCurveTo(w * 0.62, h * 0.9, w * 0.14, h * 0.34, w * 0.94, h * 0.32)
    ctx.strokeStyle = accent
    ctx.lineWidth = unit * 0.0025
    ctx.setLineDash([unit * 0.006, unit * 0.006])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(cx, cy, frame.width * 0.53, 0, Math.PI * 2)
    ctx.fillStyle = '#f9f6eb'
    ctx.fill()
    ctx.strokeStyle = ink
    ctx.lineWidth = unit * 0.001
    ctx.stroke()
    label(ctx, cfg.edition || '01', w * 0.92, h * 0.12, unit * 0.1, accent, 'right')
  }
  if (cfg.composition === 'collage') {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.055)
    ctx.fillStyle = '#b9bca4'
    ctx.fillRect(-frame.width * 0.53, -frame.height * 0.53, frame.width * 1.06, frame.height * 1.06)
    ctx.restore()
    tornPhotoPath(ctx, frame, unit * 0.016)
    ctx.shadowColor = '#3c332630'
    ctx.shadowBlur = unit * 0.025
    ctx.shadowOffsetY = unit * 0.012
    ctx.fillStyle = '#fff9e9'
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.strokeStyle = '#b7493260'
    ctx.lineWidth = unit * 0.001
    for (let y = h * 0.18; y < h * 0.92; y += unit * 0.035)
      line(ctx, w * 0.04, y, w * 0.46, y, '#83765d20', unit * 0.001)
  }
  if (cfg.composition === 'type') {
    ctx.fillStyle = ink
    ctx.fillRect(
      w * (tall ? 0.2 : 0.64),
      h * (tall ? 0.48 : 0.17),
      w * (tall ? 0.77 : 0.34),
      h * (tall ? 0.36 : 0.69),
    )
    ctx.strokeStyle = ink
    ctx.lineWidth = unit * 0.0015
    ctx.strokeRect(w * 0.025, h * 0.035, w * 0.95, h * 0.93)
    star(ctx, w * (tall ? 0.11 : 0.59), h * (tall ? 0.69 : 0.16), unit * 0.065, accent)
    ctx.save()
    ctx.translate(w * 0.97, h * 0.82)
    ctx.rotate(-Math.PI / 2)
    label(ctx, cfg.eyebrow || '', 0, 0, unit * 0.016, ink, 'left', h * 0.5)
    ctx.restore()
  }
  if (cfg.composition === 'orbit') {
    const metal = ctx.createLinearGradient(
      frame.x,
      frame.y,
      frame.x + frame.width,
      frame.y + frame.height,
    )
    metal.addColorStop(0, '#f1f2e9')
    metal.addColorStop(0.35, '#a5b5bb')
    metal.addColorStop(0.51, '#fbfaf0')
    metal.addColorStop(0.7, '#8e9bba')
    metal.addColorStop(1, '#e8eada')
    ctx.beginPath()
    ctx.ellipse(cx, cy, frame.width * 0.58, frame.height * 0.58, 0, 0, Math.PI * 2)
    ctx.fillStyle = metal
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx, cy, frame.width * 0.76, frame.height * 0.35, -0.6, 0, Math.PI * 2)
    ctx.strokeStyle = accent
    ctx.lineWidth = unit * 0.002
    ctx.stroke()
    label(ctx, cfg.edition || '01', w * 0.92, h * 0.14, unit * 0.11, '#d5f07e', 'right')
  }
  if (cfg.composition !== 'orbit' && cfg.composition !== 'contact') paperTexture(ctx, w, h)
  ctx.restore()
}

function drawCompositionDetails(
  ctx: CanvasRenderingContext2D,
  cfg: PosterConfig,
  w: number,
  h: number,
  frame: PosterBounds,
  media: PosterMedia | null,
) {
  const unit = Math.min(w, h)
  const accent = cfg.accentColor || '#ec643b'
  const ink = cfg.title.color
  const tall = h >= w
  const edition = cfg.edition || '01'
  ctx.save()
  if (cfg.composition === 'panorama') {
    label(ctx, cfg.eyebrow || '', w * 0.035, h * 0.055, unit * 0.023, '#29382f', 'left', w * 0.6)
    label(ctx, edition, w * 0.965, h * 0.075, unit * 0.12, accent, 'right')
    line(ctx, w * 0.035, h * 0.115, w * 0.79, h * 0.115, '#29382f', unit * 0.001)
    label(ctx, cfg.footer || '', w * 0.965, h * 0.972, unit * 0.014, '#29382f', 'right', w * 0.8)
    label(ctx, '◉', w * 0.035, h * 0.972, unit * 0.023, accent)
  } else if (cfg.composition === 'contact') {
    label(ctx, cfg.eyebrow || '', w * 0.08, h * 0.065, unit * 0.018, accent, 'left', w * 0.72)
    const stripY = h * (tall ? 0.77 : 0.82)
    const stripH = h * (tall ? 0.07 : 0.1)
    const frameW = w * 0.265
    for (let index = 0; index < 3; index++) {
      const x = w * 0.08 + index * w * 0.288
      const mini = { x, y: stripY, width: frameW, height: stripH }
      if (media && cfg.bgType !== 'color')
        drawMedia(ctx, media, mini, { ...cfg, bgZoom: 1.2 + index * 0.35, bgPositionX: index / 2 })
      label(ctx, `${edition}.${index + 1}`, x, stripY - unit * 0.012, unit * 0.012, accent)
    }
    for (let index = 0; index < 16; index++) {
      ctx.fillStyle = '#f4f0d9'
      const x = frame.x + (frame.width * index) / 16
      ctx.fillRect(x, frame.y - unit * 0.022, frame.width * 0.035, unit * 0.012)
      ctx.fillRect(x, frame.y + frame.height + unit * 0.01, frame.width * 0.035, unit * 0.012)
    }
    label(ctx, cfg.footer || '', w * 0.92, h * 0.97, unit * 0.013, '#f4f0d9', 'right', w * 0.8)
  } else if (cfg.composition === 'record') {
    const cx = frame.x + frame.width / 2
    const cy = frame.y + frame.height / 2
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(cx, cy, unit * 0.025, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#dedcd0'
    ctx.beginPath()
    ctx.arc(cx, cy, unit * 0.006, 0, Math.PI * 2)
    ctx.fill()
    label(ctx, '33⅓', w * 0.92, h * 0.08, unit * 0.04, ink, 'right')
    label(ctx, cfg.eyebrow || '', w * 0.08, h * 0.07, unit * 0.017, ink, 'left', w * 0.65)
    line(ctx, w * 0.08, h * 0.85, w * 0.92, h * 0.85, ink, unit * 0.001)
    label(ctx, cfg.footer || '', w * 0.92, h * 0.97, unit * 0.013, ink, 'right', w * 0.8)
    for (let i = 0; i < 40; i++)
      ctx.fillRect(
        w * 0.08 + i * unit * 0.005,
        h * 0.95,
        unit * (i % 3 === 0 ? 0.0025 : 0.001),
        unit * 0.025,
      )
  } else if (cfg.composition === 'collage') {
    for (const corner of [0.2, 0.76]) {
      ctx.save()
      ctx.translate(frame.x + frame.width * corner, frame.y)
      ctx.rotate(corner < 0.5 ? -0.15 : 0.18)
      ctx.fillStyle = '#d6bd7eb5'
      ctx.fillRect(-unit * 0.055, -unit * 0.025, unit * 0.11, unit * 0.05)
      ctx.restore()
    }
    ctx.save()
    ctx.translate(w * 0.84, h * (tall ? 0.61 : 0.82))
    ctx.rotate(-0.16)
    ctx.strokeStyle = accent
    ctx.lineWidth = unit * 0.002
    ctx.beginPath()
    ctx.arc(0, 0, unit * 0.055, 0, Math.PI * 2)
    ctx.stroke()
    label(ctx, edition, 0, 0, unit * 0.045, accent, 'center')
    ctx.restore()
    label(ctx, cfg.eyebrow || '', w * 0.08, h * 0.065, unit * 0.017, ink, 'left', w * 0.78)
    label(ctx, cfg.footer || '', w * 0.92, h * 0.98, unit * 0.012, ink, 'right', w * 0.8)
    line(
      ctx,
      w * 0.08,
      h * (tall ? 0.63 : 0.62),
      w * (tall ? 0.4 : 0.29),
      h * (tall ? 0.63 : 0.62),
      accent,
      unit * 0.003,
    )
  } else {
    const labelColor = cfg.composition === 'orbit' ? '#f2f1e8' : ink
    label(ctx, cfg.eyebrow || '', w * 0.075, h * 0.06, unit * 0.017, labelColor, 'left', w * 0.72)
    label(ctx, cfg.footer || '', w * 0.925, h * 0.97, unit * 0.013, labelColor, 'right', w * 0.8)
    if (cfg.composition === 'archive') {
      const x = frame.x + frame.width * 0.72
      const y = frame.y + frame.height * 0.13
      star(ctx, x, y, unit * 0.027, accent)
      line(ctx, w * 0.075, h * 0.88, w * 0.925, h * 0.88, ink, unit * 0.001)
    }
    if (cfg.composition === 'orbit') {
      star(ctx, frame.x + frame.width * 0.83, frame.y + frame.height * 0.92, unit * 0.055, accent)
      line(ctx, w * 0.08, h * 0.87, w * 0.36, h * 0.87, accent, unit * 0.002)
    }
    if (cfg.composition === 'type') label(ctx, edition, w * 0.08, h * 0.77, unit * 0.1, accent)
  }
  ctx.restore()
}

function drawDetails(ctx: CanvasRenderingContext2D, cfg: PosterConfig, w: number, h: number) {
  const accent = cfg.accentColor || '#e7c898'
  const ink = cfg.title.color
  const scale = Math.min(w, h)
  ctx.save()
  ctx.fillStyle = cfg.layout === 'cinematic' ? '#fff8e9' : ink
  ctx.font = `500 ${scale * 0.018}px ${POSTER_FONTS[2].value}`
  ctx.textBaseline = 'middle'
  ctx.fillText(cfg.eyebrow || '', w * 0.08, h * 0.075, w * 0.65)
  ctx.strokeStyle = cfg.layout === 'cinematic' ? '#ffffff60' : `${ink}50`
  ctx.lineWidth = Math.max(1, scale * 0.001)
  ctx.beginPath()
  ctx.moveTo(w * 0.08, h * 0.105)
  ctx.lineTo(w * 0.92, h * 0.105)
  ctx.stroke()
  if (cfg.layout === 'editorial') {
    ctx.fillStyle = accent
    ctx.fillRect(w * 0.08, h * 0.14, w * 0.035, scale * 0.008)
  }
  if (cfg.layout === 'album') {
    const frame = mediaFrame(cfg, w, h)
    ctx.strokeStyle = `${ink}45`
    ctx.strokeRect(
      frame.x - scale * 0.01,
      frame.y - scale * 0.01,
      frame.width + scale * 0.02,
      frame.height + scale * 0.02,
    )
    ctx.fillStyle = accent
    for (let i = 0; i < 28; i++) {
      const barH = scale * (0.008 + Math.abs(Math.sin(i * 1.7)) * 0.024)
      ctx.fillRect(w * 0.08 + i * scale * 0.008, h * 0.955 - barH / 2, scale * 0.003, barH)
    }
  }
  if (cfg.layout === 'bold') {
    ctx.fillStyle = accent
    ctx.fillRect(w * 0.08, h * 0.13, w * 0.09, scale * 0.012)
    ctx.beginPath()
    ctx.moveTo(w * 0.88, h * 0.9)
    ctx.lineTo(w * 0.92, h * 0.9)
    ctx.lineTo(w * 0.92, h * 0.9 - scale * 0.04)
    ctx.strokeStyle = ink
    ctx.lineWidth = scale * 0.005
    ctx.stroke()
  }
  ctx.fillStyle = cfg.layout === 'cinematic' ? '#fff8e9bb' : ink
  ctx.globalAlpha = 0.65
  ctx.font = `400 ${scale * 0.014}px ${POSTER_FONTS[0].value}`
  ctx.textAlign = 'right'
  ctx.fillText(cfg.footer || '', w * 0.92, h * 0.955, w * 0.58)
  ctx.restore()
}

/** One drawing path for the editor, template previews and image exports. */
export function renderPosterCanvas(
  canvas: HTMLCanvasElement,
  cfg: PosterConfig,
  media: PosterMedia | null,
  logo: HTMLImageElement | null,
): PosterRenderResult {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布，请重试')
  const [w, h] = POSTER_DIMS[cfg.ratio]
  ctx.save()
  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const gradient = ctx.createLinearGradient(0, 0, 0, h)
  gradient.addColorStop(0, cfg.bgColor)
  gradient.addColorStop(1, cfg.bgColorEnd)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
  const frame = mediaFrame(cfg, w, h)
  if (cfg.composition) drawCompositionBase(ctx, cfg, w, h, frame)
  if (media && cfg.bgType !== 'color') {
    ctx.save()
    clipCompositionPhoto(ctx, cfg, frame)
    drawMedia(ctx, media, frame, cfg)
    ctx.save()
    if (
      cfg.composition === 'panorama' ||
      (!cfg.composition && (cfg.layout === 'cinematic' || !cfg.layout))
    ) {
      const shade = ctx.createLinearGradient(0, h * 0.3, 0, h)
      shade.addColorStop(0, 'rgba(0,0,0,0)')
      shade.addColorStop(1, `rgba(0,0,0,${Math.min(0.96, 0.5 + cfg.bgOverlayOpacity * 0.5)})`)
      ctx.fillStyle = shade
      ctx.fillRect(0, 0, w, h)
    }
    ctx.fillStyle = `rgba(0,0,0,${cfg.bgOverlayOpacity * (cfg.layout === 'cinematic' ? 0.4 : 0.6)})`
    ctx.fillRect(frame.x, frame.y, frame.width, frame.height)
    ctx.restore()
    ctx.restore()
  }
  if (cfg.composition) drawCompositionDetails(ctx, cfg, w, h, frame, media)
  else if (cfg.layout) drawDetails(ctx, cfg, w, h)
  const result: PosterRenderResult = { image: frame }
  if (logo && cfg.logo.opacity > 0) {
    const dw = cfg.logo.size * w
    const dh = (dw * logo.naturalHeight) / logo.naturalWidth
    const x = cfg.logo.x * w - dw / 2
    const y = cfg.logo.y * h - dh / 2
    ctx.save()
    ctx.globalAlpha = cfg.logo.opacity
    if (cfg.logo.rounded) {
      ctx.beginPath()
      ctx.arc(x + dw / 2, y + dh / 2, Math.min(dw, dh) / 2, 0, Math.PI * 2)
      ctx.clip()
    }
    ctx.drawImage(logo, x, y, dw, dh)
    ctx.restore()
    result.logo = { x, y, width: dw, height: dh }
  }
  if (cfg.title.text.trim()) result.title = drawText(ctx, w, h, cfg.title)
  if (cfg.subtitle.text.trim()) result.subtitle = drawText(ctx, w, h, cfg.subtitle)
  ctx.restore()
  return result
}
