/** 节拍信息 */
export interface Beat {
  /** 节拍时间点（秒） */
  time: number
  /** 节拍强度 0-1 */
  strength: number
}

/** 动画效果类型 */
export type AnimationEffect =
  | 'switch'      // 切换图片
  | 'zoom'        // 缩放脉冲
  | 'rotate'      // 旋转
  | 'shake'       // 抖动
  | 'flash'       // 闪白
  | 'blur'        // 模糊过渡
  | 'slide'       // 滑入滑出

/** 动画效果配置 */
export interface EffectConfig {
  type: AnimationEffect
  label: string
  description: string
  enabled: boolean
}

/** 上传的图片 */
export interface UploadedImage {
  id: string
  file: File
  url: string
  name: string
}

/** 音频状态 */
export interface AudioState {
  file: File | null
  url: string
  duration: number
  currentTime: number
  isPlaying: boolean
  isAnalyzing: boolean
  isAnalyzed: boolean
}

/** 动画配置 */
export interface AnimationConfig {
  /** BPM 灵敏度阈值 (0-1) */
  sensitivity: number
  /** 动画效果持续时间（ms） */
  effectDuration: number
  /** 启用的效果 */
  effects: EffectConfig[]
  /** 背景颜色 */
  backgroundColor: string
  /** 画布宽度 */
  width: number
  /** 画布高度 */
  height: number
}

/** 导出配置 */
export interface ExportConfig {
  format: 'webm' | 'gif'
  quality: number
  fps: number
}
