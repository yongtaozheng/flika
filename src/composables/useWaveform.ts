import { ref } from 'vue'

/** 波形数据 */
export interface WaveformData {
  /** 归一化峰值 (0-1)，每个元素对应一根柱条 */
  peaks: number[]
  /** 音频时长（秒） */
  duration: number
}

/**
 * 波形提取 composable
 * 使用 Web Audio API 解码音频，下采样为固定数量的峰值柱条
 */
export function useWaveform() {
  const waveformData = ref<WaveformData | null>(null)
  const isProcessing = ref(false)

  /**
   * 从音频文件提取波形峰值
   * @param file 音频文件
   * @param barCount 柱条数量，默认 300
   */
  async function extractWaveform(file: File, barCount: number = 300): Promise<WaveformData> {
    isProcessing.value = true
    try {
      const arrayBuffer = await file.arrayBuffer()
      const audioContext = new AudioContext()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      await audioContext.close()

      // 取第一个声道（单声道）
      const channelData = audioBuffer.getChannelData(0)
      const samplesPerBar = Math.floor(channelData.length / barCount)
      const peaks: number[] = []

      for (let i = 0; i < barCount; i++) {
        let max = 0
        const start = i * samplesPerBar
        const end = Math.min(start + samplesPerBar, channelData.length)
        for (let j = start; j < end; j++) {
          const abs = Math.abs(channelData[j])
          if (abs > max) max = abs
        }
        peaks.push(max)
      }

      // 归一化到 0-1
      const globalMax = Math.max(...peaks, 0.001)
      const normalized = peaks.map(p => p / globalMax)

      const data: WaveformData = {
        peaks: normalized,
        duration: audioBuffer.duration,
      }
      waveformData.value = data
      return data
    } finally {
      isProcessing.value = false
    }
  }

  function clear() {
    waveformData.value = null
  }

  return {
    waveformData,
    isProcessing,
    extractWaveform,
    clear,
  }
}
