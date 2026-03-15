import { ref } from 'vue'
import type { Beat } from '../types'

/**
 * 音频节拍检测 composable
 * 使用 Web Audio API 的 OfflineAudioContext 分析音频，检测节拍点
 */
export function useBeatDetector() {
  const beats = ref<Beat[]>([])
  const isAnalyzing = ref(false)
  const progress = ref(0)
  const bpm = ref(0)

  /**
   * 分析音频文件，提取节拍信息
   * @param file 音频文件
   * @param sensitivity 灵敏度 0-1，越高检测越多节拍
   */
  async function analyzeBeats(file: File, sensitivity: number = 0.5): Promise<Beat[]> {
    isAnalyzing.value = true
    progress.value = 0
    beats.value = []

    try {
      const arrayBuffer = await file.arrayBuffer()
      const audioContext = new AudioContext()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      await audioContext.close()

      progress.value = 20

      // 使用离线音频上下文进行分析
      const offlineCtx = new OfflineAudioContext(
        1, // 单声道
        audioBuffer.length,
        audioBuffer.sampleRate
      )

      // 获取音频数据
      const channelData = audioBuffer.getChannelData(0)

      progress.value = 40

      // 节拍检测算法：能量峰值检测
      const detectedBeats = detectBeatsFromEnergy(
        channelData,
        audioBuffer.sampleRate,
        sensitivity
      )

      progress.value = 80

      // 计算 BPM
      bpm.value = calculateBPM(detectedBeats)

      beats.value = detectedBeats
      progress.value = 100

      await offlineCtx.startRendering()

      return detectedBeats
    } catch (error) {
      console.error('节拍检测失败:', error)
      throw error
    } finally {
      isAnalyzing.value = false
    }
  }

  /**
   * 基于能量峰值的节拍检测算法
   */
  function detectBeatsFromEnergy(
    channelData: Float32Array,
    sampleRate: number,
    sensitivity: number
  ): Beat[] {
    const result: Beat[] = []

    // 分块计算能量，每块约 10ms
    const blockSize = Math.floor(sampleRate * 0.01)
    const numBlocks = Math.floor(channelData.length / blockSize)
    const energies: number[] = []

    // 计算每块的 RMS 能量
    for (let i = 0; i < numBlocks; i++) {
      let sum = 0
      const start = i * blockSize
      for (let j = 0; j < blockSize; j++) {
        const sample = channelData[start + j]
        sum += sample * sample
      }
      energies.push(Math.sqrt(sum / blockSize))
    }

    // 对能量进行平滑处理
    const smoothWindow = 5
    const smoothedEnergies: number[] = []
    for (let i = 0; i < energies.length; i++) {
      let sum = 0
      let count = 0
      for (let j = Math.max(0, i - smoothWindow); j <= Math.min(energies.length - 1, i + smoothWindow); j++) {
        sum += energies[j]
        count++
      }
      smoothedEnergies.push(sum / count)
    }

    // 计算局部平均能量，使用滑动窗口
    const windowSize = Math.floor(sampleRate / blockSize * 0.5) // 0.5秒窗口
    const threshold = 1.2 + (1 - sensitivity) * 1.5 // 灵敏度影响阈值

    // 最小节拍间隔（防止检测到过于密集的节拍）
    const minBeatInterval = Math.floor(sampleRate / blockSize * 0.15) // 至少 150ms 间隔

    let lastBeatIndex = -minBeatInterval

    for (let i = windowSize; i < smoothedEnergies.length - windowSize; i++) {
      // 计算局部平均
      let localSum = 0
      for (let j = i - windowSize; j < i + windowSize; j++) {
        localSum += smoothedEnergies[j]
      }
      const localAvg = localSum / (windowSize * 2)

      // 检查是否是局部峰值
      const isPeak =
        smoothedEnergies[i] > smoothedEnergies[i - 1] &&
        smoothedEnergies[i] > smoothedEnergies[i + 1]

      // 能量超过局部平均的一定倍数，且是局部峰值
      if (
        isPeak &&
        smoothedEnergies[i] > localAvg * threshold &&
        i - lastBeatIndex >= minBeatInterval
      ) {
        const time = (i * blockSize) / sampleRate
        // 强度归一化到 0-1
        const strength = Math.min(1, (smoothedEnergies[i] - localAvg) / localAvg)

        result.push({ time, strength })
        lastBeatIndex = i
      }
    }

    return result
  }

  /**
   * 根据节拍间隔估算 BPM
   */
  function calculateBPM(detectedBeats: Beat[]): number {
    if (detectedBeats.length < 2) return 0

    // 计算相邻节拍间隔
    const intervals: number[] = []
    for (let i = 1; i < detectedBeats.length; i++) {
      intervals.push(detectedBeats[i].time - detectedBeats[i - 1].time)
    }

    // 使用中位数作为典型间隔（抗离群值）
    intervals.sort((a, b) => a - b)
    const medianInterval = intervals[Math.floor(intervals.length / 2)]

    // BPM = 60 / 间隔秒数
    const rawBPM = 60 / medianInterval

    // 将 BPM 归一化到合理范围 (60-200)
    let normalizedBPM = rawBPM
    while (normalizedBPM < 60) normalizedBPM *= 2
    while (normalizedBPM > 200) normalizedBPM /= 2

    return Math.round(normalizedBPM)
  }

  return {
    beats,
    isAnalyzing,
    progress,
    bpm,
    analyzeBeats,
  }
}
