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
  | 'fadeIn'      // 淡入效果
  | 'bounce'      // 弹跳缩放
  | 'glitch'      // 故障效果（RGB 通道分离）
  | 'flipX'       // 水平翻转
  | 'pixelate'    // 像素化
  | 'colorInvert' // 颜色反转
  | 'vortex'      // 漩涡旋转
  | 'chromatic'   // 色散（色差偏移）
  | 'wave'        // 波浪扭曲
  | 'split'       // 四象限分裂
  | 'neonGlow'    // 霓虹发光边框
  | 'heartbeat'   // 心跳双脉冲

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

/** 涟漪拼接素材项 */
export interface SpliceItem {
  id: string
  file: File
  url: string
  name: string
  type: 'image' | 'video'
  /** 展示时长（ms） */
  holdDuration: number
}

/** 涟漪过渡参数 */
export interface RippleConfig {
  waveAmplitude: number
  waveCount: number
  waveWidth: number
  /** 过渡动画时长（ms） */
  transitionDuration: number
  /** 像素块大小（性能优化，值越大渲染越快但越粗糙） */
  step: number
}
