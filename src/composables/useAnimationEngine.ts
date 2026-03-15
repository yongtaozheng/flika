import { ref, type Ref } from 'vue'
import type { Beat, AnimationEffect, UploadedImage } from '../types'

/**
 * 动画渲染引擎 composable
 * 基于 Canvas 2D，根据节拍驱动动画效果
 */
export function useAnimationEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  images: Ref<UploadedImage[]>,
  beats: Ref<Beat[]>,
  currentTime: Ref<number>,
) {
  const currentImageIndex = ref(0)
  const isRendering = ref(false)

  // 缓存已加载的 HTMLImageElement
  const imageCache = new Map<string, HTMLImageElement>()

  // 当前生效的效果状态
  const activeEffects = ref<Map<AnimationEffect, { startTime: number; strength: number }>>(
    new Map()
  )

  /**
   * 预加载所有图片到缓存
   */
  async function preloadImages() {
    const promises = images.value.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (imageCache.has(img.id)) {
            resolve()
            return
          }
          const el = new Image()
          el.crossOrigin = 'anonymous'
          el.onload = () => {
            imageCache.set(img.id, el)
            resolve()
          }
          el.onerror = () => resolve()
          el.src = img.url
        })
    )
    await Promise.all(promises)
  }

  /**
   * 查找当前时间最近的节拍
   */
  function findCurrentBeat(time: number, effectDuration: number): Beat | null {
    for (const beat of beats.value) {
      const diff = time - beat.time
      if (diff >= 0 && diff < effectDuration / 1000) {
        return beat
      }
    }
    return null
  }

  /**
   * 查找下一个节拍要切换到的图片索引
   */
  function getNextImageIndex(): number {
    if (images.value.length === 0) return 0
    return (currentImageIndex.value + 1) % images.value.length
  }

  /**
   * 更新效果状态
   */
  function updateEffects(
    time: number,
    enabledEffects: AnimationEffect[],
    effectDuration: number
  ) {
    // 检查当前时间是否有节拍
    const beat = findCurrentBeat(time, effectDuration)

    if (beat) {
      for (const effect of enabledEffects) {
        const existing = activeEffects.value.get(effect)
        if (!existing || Math.abs(existing.startTime - beat.time) > 0.01) {
          activeEffects.value.set(effect, {
            startTime: beat.time,
            strength: beat.strength,
          })

          // 如果有切换效果，更新图片索引
          if (effect === 'switch') {
            const lastSwitch = activeEffects.value.get('switch')
            if (lastSwitch && Math.abs(lastSwitch.startTime - beat.time) < 0.01) {
              currentImageIndex.value = getNextImageIndex()
            }
          }
        }
      }
    }

    // 清理过期效果
    for (const [effect, state] of activeEffects.value.entries()) {
      if (time - state.startTime > effectDuration / 1000) {
        activeEffects.value.delete(effect)
      }
    }
  }

  /**
   * 计算效果的进度 (0-1, 1 = 刚触发, 0 = 结束)
   */
  function getEffectProgress(effect: AnimationEffect, time: number, effectDuration: number): number {
    const state = activeEffects.value.get(effect)
    if (!state) return 0
    const elapsed = time - state.startTime
    const duration = effectDuration / 1000
    if (elapsed < 0 || elapsed > duration) return 0
    // ease out
    const t = 1 - elapsed / duration
    return t * t * state.strength
  }

  /**
   * 计算弹跳效果的进度（带弹性缓动）
   */
  function getBounceProgress(effect: AnimationEffect, time: number, effectDuration: number): number {
    const state = activeEffects.value.get(effect)
    if (!state) return 0
    const elapsed = time - state.startTime
    const duration = effectDuration / 1000
    if (elapsed < 0 || elapsed > duration) return 0
    const t = elapsed / duration
    // 弹性缓动：模拟弹簧效果
    const bounce = Math.sin(t * Math.PI * 3) * Math.exp(-t * 4)
    return bounce * state.strength
  }

  /**
   * 渲染单帧到 Canvas
   */
  function renderFrame(
    enabledEffects: AnimationEffect[],
    effectDuration: number,
    backgroundColor: string
  ) {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const time = currentTime.value

    // 更新效果
    updateEffects(time, enabledEffects, effectDuration)

    // 清除画布
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)

    if (images.value.length === 0) {
      // 没有图片，绘制提示
      ctx.fillStyle = '#666'
      ctx.font = '20px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('请上传图片', width / 2, height / 2)
      return
    }

    // 获取当前图片
    const currentImg = images.value[currentImageIndex.value]
    const imgEl = imageCache.get(currentImg?.id || '')

    if (!imgEl) return

    // 保存上下文
    ctx.save()

    // 应用效果
    let scale = 1
    let rotation = 0
    let offsetX = 0
    let offsetY = 0
    let opacity = 1
    let blur = 0
    let scaleX = 1 // 独立 X 轴缩放（用于翻转）

    for (const effect of enabledEffects) {
      const p = getEffectProgress(effect, time, effectDuration)

      switch (effect) {
        case 'zoom':
          if (p > 0) scale += p * 0.3
          break
        case 'rotate':
          if (p > 0) rotation += p * (Math.PI / 8)
          break
        case 'shake':
          if (p > 0) {
            offsetX += (Math.random() - 0.5) * p * 30
            offsetY += (Math.random() - 0.5) * p * 30
          }
          break
        case 'flash':
          // flash 在图片绘制后叠加白色
          break
        case 'blur':
          if (p > 0) blur = p * 8
          break
        case 'slide': {
          if (p > 0) {
            offsetX += (1 - p) * width * 0.3 - width * 0.3
          }
          break
        }
        case 'fadeIn': {
          if (p > 0) {
            // 节拍触发时从半透明渐入到完全不透明
            opacity = 0.3 + 0.7 * (1 - p)
          }
          break
        }
        case 'bounce': {
          const bp = getBounceProgress('bounce', time, effectDuration)
          if (Math.abs(bp) > 0) {
            scale += bp * 0.25
          }
          break
        }
        case 'flipX': {
          if (p > 0) {
            // 翻转效果：从 -1 翻到 1
            scaleX = Math.cos(p * Math.PI)
          }
          break
        }
        case 'glitch':
          // glitch 在图片绘制后处理
          break
        case 'pixelate':
          // pixelate 在图片绘制后处理
          break
        case 'colorInvert':
          // colorInvert 在图片绘制后处理
          break
      }
    }

    // 应用变换
    ctx.translate(width / 2 + offsetX, height / 2 + offsetY)
    ctx.rotate(rotation)
    ctx.scale(scale * scaleX, scale)

    // 应用模糊
    if (blur > 0) {
      ctx.filter = `blur(${blur}px)`
    }

    // 计算图片绘制区域（cover 模式）
    const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight
    const canvasRatio = width / height
    let drawWidth: number, drawHeight: number

    if (imgRatio > canvasRatio) {
      drawHeight = height
      drawWidth = height * imgRatio
    } else {
      drawWidth = width
      drawHeight = width / imgRatio
    }

    // 绘制图片（居中）
    ctx.globalAlpha = opacity
    ctx.drawImage(imgEl, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)

    // Flash 效果 - 叠加白色
    const flashP = getEffectProgress('flash', time, effectDuration)
    if (flashP > 0) {
      ctx.globalAlpha = flashP * 0.6
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    }

    ctx.restore()

    // ====== 后处理效果（需要在 restore 之后操作像素） ======

    // Glitch 故障效果 - RGB 通道分离
    const glitchP = getEffectProgress('glitch', time, effectDuration)
    if (glitchP > 0) {
      const glitchOffset = Math.round(glitchP * 12)
      if (glitchOffset > 0) {
        try {
          const imageData = ctx.getImageData(0, 0, width, height)
          const data = imageData.data
          const tempData = new Uint8ClampedArray(data)

          // 水平偏移红色通道
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const srcX = Math.min(width - 1, Math.max(0, x + glitchOffset))
              const dstIdx = (y * width + x) * 4
              const srcIdx = (y * width + srcX) * 4
              data[dstIdx] = tempData[srcIdx] // R 通道右移
            }
          }

          // 水平偏移蓝色通道（反方向）
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const srcX = Math.min(width - 1, Math.max(0, x - glitchOffset))
              const dstIdx = (y * width + x) * 4
              const srcIdx = (y * width + srcX) * 4
              data[dstIdx + 2] = tempData[srcIdx + 2] // B 通道左移
            }
          }

          // 随机水平切片错位
          const sliceCount = Math.ceil(glitchP * 6)
          for (let i = 0; i < sliceCount; i++) {
            const sliceY = Math.floor(Math.random() * height)
            const sliceH = Math.floor(Math.random() * 15) + 2
            const sliceShift = Math.round((Math.random() - 0.5) * glitchP * 40)
            for (let y = sliceY; y < Math.min(height, sliceY + sliceH); y++) {
              for (let x = 0; x < width; x++) {
                const srcX = Math.min(width - 1, Math.max(0, x + sliceShift))
                const dstIdx = (y * width + x) * 4
                const srcIdx = (y * width + srcX) * 4
                data[dstIdx] = tempData[srcIdx]
                data[dstIdx + 1] = tempData[srcIdx + 1]
                data[dstIdx + 2] = tempData[srcIdx + 2]
              }
            }
          }

          ctx.putImageData(imageData, 0, 0)
        } catch {
          // getImageData 可能因跨域限制失败，静默忽略
        }
      }
    }

    // Pixelate 像素化效果
    const pixelateP = getEffectProgress('pixelate', time, effectDuration)
    if (pixelateP > 0) {
      const pixelSize = Math.max(2, Math.round(pixelateP * 20))
      try {
        // 先缩小再放大实现像素化
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = width
        tempCanvas.height = height
        const tempCtx = tempCanvas.getContext('2d')
        if (tempCtx) {
          // 关闭抗锯齿
          tempCtx.imageSmoothingEnabled = false

          const smallW = Math.max(1, Math.ceil(width / pixelSize))
          const smallH = Math.max(1, Math.ceil(height / pixelSize))

          // 缩小
          tempCtx.drawImage(canvas, 0, 0, smallW, smallH)
          // 放大回原始尺寸
          ctx.imageSmoothingEnabled = false
          ctx.clearRect(0, 0, width, height)
          ctx.fillStyle = backgroundColor
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, width, height)
          ctx.imageSmoothingEnabled = true
        }
      } catch {
        // 静默忽略
      }
    }

    // ColorInvert 颜色反转效果
    const invertP = getEffectProgress('colorInvert', time, effectDuration)
    if (invertP > 0) {
      try {
        const imageData = ctx.getImageData(0, 0, width, height)
        const data = imageData.data
        const strength = invertP // 0~1，控制反转混合程度

        for (let i = 0; i < data.length; i += 4) {
          data[i]     = Math.round(data[i]     + (255 - 2 * data[i])     * strength) // R
          data[i + 1] = Math.round(data[i + 1] + (255 - 2 * data[i + 1]) * strength) // G
          data[i + 2] = Math.round(data[i + 2] + (255 - 2 * data[i + 2]) * strength) // B
        }

        ctx.putImageData(imageData, 0, 0)
      } catch {
        // getImageData 可能因跨域限制失败，静默忽略
      }
    }
  }

  /**
   * 重置状态
   */
  function reset() {
    currentImageIndex.value = 0
    activeEffects.value.clear()
    imageCache.clear()
  }

  /**
   * 导出为视频 (WebM)
   */
  async function exportVideo(
    audioElement: HTMLAudioElement,
    enabledEffects: AnimationEffect[],
    effectDuration: number,
    backgroundColor: string,
    fps: number = 30,
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas 不可用')

    isRendering.value = true

    try {
      await preloadImages()

      // 使用 captureStream + MediaRecorder
      const stream = canvas.captureStream(fps)

      // 创建音频源
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaElementSource(audioElement)
      const dest = audioCtx.createMediaStreamDestination()
      source.connect(dest)
      source.connect(audioCtx.destination) // 同时播放

      // 合并视频流和音频流
      const combinedStream = new MediaStream([
        ...stream.getTracks(),
        ...dest.stream.getTracks(),
      ])

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 5000000,
      })

      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      return new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' })
          source.disconnect()
          audioCtx.close()
          isRendering.value = false
          resolve(blob)
        }

        recorder.onerror = (e) => {
          isRendering.value = false
          reject(e)
        }

        recorder.start()

        // 开始播放
        reset()
        audioElement.currentTime = 0
        audioElement.play()

        // 渲染循环
        const renderLoop = () => {
          if (!audioElement.paused && !audioElement.ended) {
            renderFrame(enabledEffects, effectDuration, backgroundColor)
            if (onProgress) {
              onProgress(audioElement.currentTime / audioElement.duration)
            }
            requestAnimationFrame(renderLoop)
          } else {
            recorder.stop()
          }
        }
        renderLoop()
      })
    } catch (error) {
      isRendering.value = false
      throw error
    }
  }

  return {
    currentImageIndex,
    isRendering,
    activeEffects,
    preloadImages,
    renderFrame,
    reset,
    exportVideo,
  }
}
