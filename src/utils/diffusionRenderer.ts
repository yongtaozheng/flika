/**
 * 扩散着色 — 纯计算渲染函数（无 DOM 依赖）
 *
 * 本模块提取自 useDiffusionEngine.ts 的核心像素计算逻辑，
 * 主线程和 WebWorker 均可 import 使用。
 */

/* ── Types (无 Vue 依赖) ─────────────────────────────────────────────── */

export interface PrecomputedImageData {
  id: string
  originalData: Uint8ClampedArray
  grayscaleData: Uint8ClampedArray
  distanceField: Float32Array
  cosAngle: Float32Array
  sinAngle: Float32Array
  maxDist: number
  width: number
  height: number
  /** 扩散点列表（归一化坐标，用于高光环绘制） */
  points: { x: number; y: number }[]
  spreadDuration: number
  pauseDuration: number
}

export interface DiffusionConfigPure {
  spreadDuration: number
  pauseDuration: number
  loop: boolean
  edgeWidth: number
  rippleEnabled: boolean
  beatSyncEnabled: boolean
}

export interface BeatPure {
  time: number
  strength: number
}

export interface ResolvedSlot {
  imageIndex: number
  imageTime: number
  effectiveSpreadDuration: number
}

export interface RenderContext {
  images: PrecomputedImageData[]
  config: DiffusionConfigPure
  beats: BeatPure[]
  width: number
  height: number
}

/* ── Wave ripple constants ───────────────────────────────────────────── */
export const WAVE_COUNT = 3
export const WAVE_WIDTH = 60
export const WAVE_AMPLITUDE = 18
export const WAVE_ZONE = WAVE_WIDTH * WAVE_COUNT

/* ── Smoothstep helper ───────────────────────────────────────────────── */
export function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/* ── Grayscale conversion (luminance) ────────────────────────────────── */
export function toGrayscale(data: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    gray[i] = gray[i + 1] = gray[i + 2] = lum
    gray[i + 3] = data[i + 3]
  }
  return gray
}

/* ── Distance field computation ──────────────────────────────────────── */
export function computeDistanceField(
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
      const angle = Math.atan2(nearDy, nearDx)
      cosAngle[idx] = Math.cos(angle)
      sinAngle[idx] = Math.sin(angle)
      if (minDist > maxDist) maxDist = minDist
    }
  }

  return { field, cosAngle, sinAngle, maxDist }
}

/* ── Time resolution: manual mode ────────────────────────────────────── */
export function getManualTotalDuration(images: PrecomputedImageData[]): number {
  let total = 0
  for (const img of images) {
    total += img.spreadDuration + img.pauseDuration
  }
  return total
}

export function resolveManual(images: PrecomputedImageData[], effectiveTime: number): ResolvedSlot {
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

/* ── Beat-sync helpers ────────────────────────────────────────────────── */

/** 计算平均节拍间隔 (秒) */
function avgBeatInterval(beats: BeatPure[]): number {
  return (beats[beats.length - 1].time - beats[0].time) / (beats.length - 1)
}

/* ── Time resolution: beat-sync mode ─────────────────────────────────── */
/**
 * 一轮完整展示所有图片的时长。
 * 如果节拍段数 >= 图片数，直接用节拍覆盖；
 * 否则用平均节拍间隔外推不足的部分，保证每张图片都有展示时间。
 */
export function getBeatTotalDuration(images: PrecomputedImageData[], beats: BeatPure[]): number {
  if (beats.length < 2) return getManualTotalDuration(images)

  const beatSegments = beats.length - 1
  const imgCount = images.length

  if (beatSegments >= imgCount) {
    // 节拍段够用，总时长 = 最后一个节拍时间
    return beats[beats.length - 1].time * 1000
  }

  // 节拍段不够：用平均间隔外推
  const extraNeeded = imgCount - beatSegments
  return (beats[beats.length - 1].time + extraNeeded * avgBeatInterval(beats)) * 1000
}

export function resolveBeatSync(
  images: PrecomputedImageData[],
  beats: BeatPure[],
  effectiveTimeMs: number,
): ResolvedSlot {
  const imgCount = images.length
  if (beats.length < 2 || imgCount === 0) {
    return resolveManual(images, effectiveTimeMs)
  }

  const effectiveTimeSec = effectiveTimeMs / 1000

  // 在已有节拍段内查找
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

  // 过了最后一个真实节拍 → 用平均间隔外推，继续切换图片
  const realSegments = beats.length - 1
  const intervalSec = avgBeatInterval(beats)
  const lastBeatSec = beats[beats.length - 1].time
  const timePast = effectiveTimeSec - lastBeatSec

  if (intervalSec > 0 && timePast >= 0) {
    const extraIdx = Math.floor(timePast / intervalSec)
    const totalSegIdx = realSegments + extraIdx
    const imageIndex = totalSegIdx % imgCount
    const segStartSec = lastBeatSec + extraIdx * intervalSec
    const imageTimeMs = (effectiveTimeSec - segStartSec) * 1000
    return {
      imageIndex,
      imageTime: imageTimeMs,
      effectiveSpreadDuration: intervalSec * 1000,
    }
  }

  // Fallback：最后一张完全上色
  const imageIndex = (beats.length - 1) % imgCount
  return {
    imageIndex,
    imageTime: 0,
    effectiveSpreadDuration: 1,
  }
}

/* ── Unified helpers ─────────────────────────────────────────────────── */
export function isBeatMode(config: DiffusionConfigPure, beats: BeatPure[]): boolean {
  return config.beatSyncEnabled && beats.length >= 2
}

export function getTotalCycleDuration(ctx: RenderContext): number {
  return isBeatMode(ctx.config, ctx.beats)
    ? getBeatTotalDuration(ctx.images, ctx.beats)
    : getManualTotalDuration(ctx.images)
}

export function resolveImageAtTime(ctx: RenderContext, effectiveTime: number): ResolvedSlot {
  return isBeatMode(ctx.config, ctx.beats)
    ? resolveBeatSync(ctx.images, ctx.beats, effectiveTime)
    : resolveManual(ctx.images, effectiveTime)
}

/* ── Core pure pixel renderer ────────────────────────────────────────── */
/**
 * 纯计算版本的 renderFrame，不访问任何 DOM API。
 * 返回 Uint8ClampedArray（width * height * 4 RGBA）。
 *
 * @param ctx     渲染上下文（图片数据 + 配置 + 节拍）
 * @param elapsedMs  动画经过时间(ms)
 * @param step    像素采样步长 (1 = 全质量, 2 = 4× 快)
 * @returns       像素 buffer (Uint8ClampedArray)，以及该帧的扩散信息
 */
export function renderFramePure(
  ctx: RenderContext,
  elapsedMs: number,
  step: number = 1,
): {
  buffer: Uint8ClampedArray
  /** 当前帧的图片索引（用于主线程绘制高光环） */
  imageIndex: number
  /** 扩散半径 */
  currentRadius: number
  /** 扩散进度 0-1 */
  spreadProgress: number
  /** 涟漪是否激活 */
  rippleActive: boolean
  /** 动画淡入淡出系数 */
  animFade: number
} {
  const { images, config: cfg, width, height } = ctx
  const totalPixels = width * height * 4
  const output = new Uint8ClampedArray(totalPixels)

  if (images.length === 0) {
    // 全黑帧
    for (let i = 3; i < totalPixels; i += 4) output[i] = 255
    return { buffer: output, imageIndex: 0, currentRadius: 0, spreadProgress: 0, rippleActive: false, animFade: 0 }
  }

  const totalCycle = getTotalCycleDuration(ctx)

  let effectiveTime = elapsedMs
  if (cfg.loop) {
    effectiveTime = elapsedMs % totalCycle
  } else {
    effectiveTime = Math.min(elapsedMs, totalCycle - 1)
  }

  const { imageIndex, imageTime, effectiveSpreadDuration } = resolveImageAtTime(ctx, effectiveTime)

  const data = images[imageIndex]
  if (!data) {
    for (let i = 3; i < totalPixels; i += 4) output[i] = 255
    return { buffer: output, imageIndex, currentRadius: 0, spreadProgress: 0, rippleActive: false, animFade: 0 }
  }

  const spreadProgress = Math.min(1, imageTime / effectiveSpreadDuration)
  const currentRadius = spreadProgress * data.maxDist
  const edgeWidth = cfg.edgeWidth

  const { originalData, grayscaleData, distanceField, cosAngle, sinAngle } = data
  const rippleActive = cfg.rippleEnabled && spreadProgress > 0 && spreadProgress < 1
  const animFade = rippleActive ? Math.sin(spreadProgress * Math.PI) : 0

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = y * width + x
      const dist = distanceField[idx]

      // ── Wave displacement
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

      // Clamp
      srcX = Math.max(0, Math.min(width - 1, Math.round(srcX)))
      srcY = Math.max(0, Math.min(height - 1, Math.round(srcY)))
      const srcPx = (srcY * width + srcX) * 4

      // Color / grayscale blending
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

      // Fill step × step block
      for (let dy2 = 0; dy2 < step && y + dy2 < height; dy2++) {
        for (let dx2 = 0; dx2 < step && x + dx2 < width; dx2++) {
          const outPx = ((y + dy2) * width + (x + dx2)) * 4
          output[outPx] = r
          output[outPx + 1] = g
          output[outPx + 2] = b
          output[outPx + 3] = a
        }
      }
    }
  }

  return { buffer: output, imageIndex, currentRadius, spreadProgress, rippleActive, animFade }
}
