import type { RippleConfig } from '../types'
import { canvasBg } from './useTheme'

export interface RippleCenter {
  x: number
  y: number
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function useRippleTransition() {
  function randomCenter(width: number, height: number): RippleCenter {
    return {
      x: width * (0.3 + Math.random() * 0.4),
      y: height * (0.3 + Math.random() * 0.4),
    }
  }

  /**
   * Render a single frame of the ripple transition.
   * progress: 0..1, caller-driven.
   */
  function renderRippleFrame(
    ctx: CanvasRenderingContext2D,
    fromData: Uint8ClampedArray,
    toData: Uint8ClampedArray,
    progress: number,
    center: RippleCenter,
    config: RippleConfig,
  ): void {
    const { waveAmplitude, waveCount, waveWidth, step } = config
    const width = ctx.canvas.width
    const height = ctx.canvas.height
    const { x: cx, y: cy } = center

    const maxDist = Math.sqrt(
      Math.pow(Math.max(cx, width - cx), 2) + Math.pow(Math.max(cy, height - cy), 2),
    )
    const eased = easeInOutCubic(Math.min(progress, 1))
    const waveFront = eased * (maxDist + waveWidth * waveCount)

    const output = ctx.createImageData(width, height)
    const outData = output.data

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const dx = x - cx
        const dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const relDist = waveFront - dist

        let srcX = x
        let srcY = y
        let useNew = relDist > waveWidth

        if (relDist > 0 && relDist <= waveWidth) {
          const phase = (relDist / waveWidth) * Math.PI * 2
          const amplitude =
            waveAmplitude *
            Math.sin(phase) *
            Math.exp((-relDist / (waveWidth * waveCount)) * 2)
          if (dist > 0) {
            srcX = x + (dx / dist) * amplitude
            srcY = y + (dy / dist) * amplitude
          }
        }

        const sx = Math.max(0, Math.min(width - 1, Math.round(srcX)))
        const sy = Math.max(0, Math.min(height - 1, Math.round(srcY)))
        const srcIdx = (sy * width + sx) * 4
        const src = useNew ? toData : fromData

        // Fill step×step block
        for (let by = 0; by < step && y + by < height; by++) {
          for (let bx = 0; bx < step && x + bx < width; bx++) {
            const dstIdx = ((y + by) * width + (x + bx)) * 4
            outData[dstIdx] = src[srcIdx]
            outData[dstIdx + 1] = src[srcIdx + 1]
            outData[dstIdx + 2] = src[srcIdx + 2]
            outData[dstIdx + 3] = src[srcIdx + 3]
          }
        }
      }
    }

    ctx.putImageData(output, 0, 0)

    // Draw highlight rings at wave front
    for (let w = 0; w < waveCount; w++) {
      const ringR = waveFront - w * waveWidth
      if (ringR <= 0) continue
      const alpha = Math.max(0, 0.5 - w * 0.15)
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(150, 200, 255, ${alpha})`
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  /**
   * Render a media element (image or video) to an offscreen canvas
   * with cover-fill behavior and return the pixel data.
   */
  function captureMediaData(
    el: HTMLImageElement | HTMLVideoElement,
    width: number,
    height: number,
  ): Uint8ClampedArray {
    const off = document.createElement('canvas')
    off.width = width
    off.height = height
    const c = off.getContext('2d')!
    c.fillStyle = canvasBg.value
    c.fillRect(0, 0, width, height)
    const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
    const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
    if (sw && sh) {
      const scale = Math.max(width / sw, height / sh)
      const dw = sw * scale
      const dh = sh * scale
      c.drawImage(el, (width - dw) / 2, (height - dh) / 2, dw, dh)
    }
    return c.getImageData(0, 0, width, height).data
  }

  return { renderRippleFrame, randomCenter, captureMediaData }
}
