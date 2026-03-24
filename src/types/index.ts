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

/** 开场动画类型 */
export type IntroAnimation =
  | 'none'
  | 'fadeIn'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'typewriter'
  | 'zoomIn'
  | 'glitch'
  | 'textReveal'  // 文字镂空：视频/图片只在文字形状内可见，文字从小放大揭示画面

/** 开场文字图层 */
export interface IntroTextLayer {
  text: string
  fontSize: number        // px
  fontWeight: string      // 'normal' | 'bold'
  color: string
  x: number               // 0-1 normalized (0.5=居中)
  y: number               // 0-1 normalized
  animation: IntroAnimation
  delay: number           // seconds, when animation starts
  animDuration: number    // seconds, how long animation takes
}

/** 开场图片图层 */
export interface IntroImageLayer {
  file: File | null
  url: string
  size: number            // 0-1 normalized canvas width
  x: number
  y: number
  animation: IntroAnimation
  delay: number
  animDuration: number
}

/** 海报宽高比 */
export type PosterRatio = '16:9' | '9:16' | '1:1' | '4:3'

/** 海报文字图层 */
export interface PosterTextLayer {
  text: string
  fontSize: number
  fontWeight: string        // 'normal' | 'bold' | '100'-'900'
  fontStyle: 'normal' | 'italic'
  color: string
  x: number                 // 0-1 normalized
  y: number                 // 0-1 normalized
  textAlign: 'left' | 'center' | 'right'
  shadowColor: string
  shadowBlur: number        // 0 = off
  strokeColor: string
  strokeWidth: number       // 0 = off
}

/** 海报图片图层 */
export interface PosterImageLayer {
  file: File | null
  url: string
  size: number              // fraction of canvas width
  x: number
  y: number
  opacity: number           // 0-1
  rounded: boolean          // circular clip
}

/** 海报/封面配置 */
export interface PosterConfig {
  ratio: PosterRatio
  bgType: 'color' | 'image' | 'video'
  bgFile: File | null
  bgUrl: string
  bgOverlayOpacity: number
  bgColor: string
  bgColorEnd: string
  bgVideoTime: number       // which second to capture from video bg
  title: PosterTextLayer
  subtitle: PosterTextLayer
  logo: PosterImageLayer
}

/** 开场配置 */
export interface IntroConfig {
  duration: number        // total intro duration in seconds (2-10)
  bgType: 'color' | 'image' | 'video'
  bgFile: File | null     // image or video file
  bgUrl: string           // object URL for bgFile
  bgOverlayOpacity: number // 0-1, dark overlay on image/video bg for legibility
  bgColor: string
  bgColorEnd: string      // gradient end (same as bgColor = solid)
  title: IntroTextLayer
  subtitle: IntroTextLayer
  logo: IntroImageLayer
  syncToBeats: boolean    // trigger title animation on first beat
}

/** 扩散着色 — 扩散点 */
export interface DiffusionPoint {
  /** 归一化 X 坐标 (0-1) */
  x: number
  /** 归一化 Y 坐标 (0-1) */
  y: number
  id: string
}

/** 扩散着色 — 带扩散点的图片 */
export interface DiffusionImage {
  id: string
  file: File
  url: string
  name: string
  /** 用户放置的扩散点（归一化坐标） */
  points: DiffusionPoint[]
  /** 单张图片扩散完成时长 (ms) */
  spreadDuration: number
  /** 单张图片停留时间 (ms) */
  pauseDuration: number
}

/** 扩散着色 — 动画配置 */
export interface DiffusionConfig {
  /** 扩散完成时长 (ms) */
  spreadDuration: number
  /** 图片间停留时间 (ms) */
  pauseDuration: number
  /** 是否循环播放 */
  loop: boolean
  /** 涟漪边缘柔和宽度 (px) */
  edgeWidth: number
  /** 是否开启涟漪光波效果 */
  rippleEnabled: boolean
  /** 是否启用踩点模式（根据音乐节拍切换图片） */
  beatSyncEnabled: boolean
}
