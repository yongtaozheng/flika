import type { PosterConfig, PosterRatio, PosterTextLayer } from '../types'

export const POSTER_DIMS: Record<PosterRatio, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
}
export const POSTER_FONTS = [
  { name: '现代黑体', value: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { name: '人文宋体', value: '"Songti SC", "Noto Serif CJK SC", "SimSun", serif' },
  { name: '几何黑体', value: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif' },
]
export interface PosterTemplate {
  id: string
  name: string
  category: NonNullable<PosterConfig['layout']>
  caption: string
  composition: NonNullable<PosterConfig['composition']>
  paper: string
  ink: string
  accent: string
  serif?: boolean
}
export const POSTER_CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'cinematic', name: '影像叙事' },
  { id: 'album', name: '音乐专辑' },
  { id: 'editorial', name: '杂志编辑' },
  { id: 'bold', name: '高对比大字' },
]
export const POSTER_TEMPLATES: PosterTemplate[] = [
  {
    id: 'coast',
    name: '旷野宽银幕',
    category: 'cinematic',
    caption: '宽幅影像 · 巨幅期号 · 底片边框',
    composition: 'panorama',
    paper: '#e7e3d8',
    ink: '#f7f2df',
    accent: '#ef5f35',
    serif: true,
  },
  {
    id: 'film',
    name: '未剪辑的夏天',
    category: 'cinematic',
    caption: '胶片齿孔 · 接触印样 · 连续切片',
    composition: 'contact',
    paper: '#191b17',
    ink: '#f4f0d9',
    accent: '#f49b38',
  },
  {
    id: 'afterhours',
    name: '晚风 33⅓',
    category: 'album',
    caption: '黑胶圆盘 · 密纹唱片 · 中心标签',
    composition: 'record',
    paper: '#dedcd0',
    ink: '#22251e',
    accent: '#f15b36',
  },
  {
    id: 'vinyl',
    name: '声音的形状',
    category: 'album',
    caption: '拼色唱片套 · 几何视窗 · 撞色字',
    composition: 'sleeve',
    paper: '#ed582d',
    ink: '#321d56',
    accent: '#e8f3a0',
    serif: true,
  },
  {
    id: 'journal',
    name: '公路观察档案',
    category: 'editorial',
    caption: '档案网格 · 路线轨迹 · 圆形取景',
    composition: 'archive',
    paper: '#e9e4d8',
    ink: '#233e33',
    accent: '#d84c31',
    serif: true,
  },
  {
    id: 'fieldnotes',
    name: '把风景贴起来',
    category: 'editorial',
    caption: '撕纸边缘 · 胶带拼贴 · 纸张叠层',
    composition: 'collage',
    paper: '#ede5d2',
    ink: '#28362a',
    accent: '#b74932',
    serif: true,
  },
  {
    id: 'headline',
    name: '让文字越界',
    category: 'bold',
    caption: '巨幅字形 · 半圆视窗 · 编辑拼版',
    composition: 'type',
    paper: '#e8ed4f',
    ink: '#182d2b',
    accent: '#ed6543',
  },
  {
    id: 'electric',
    name: '引力之外',
    category: 'bold',
    caption: '轨道切片 · 电蓝银灰 · 星形标记',
    composition: 'orbit',
    paper: '#254bdf',
    ink: '#f2f1e8',
    accent: '#d5f07e',
  },
]

function textLayer(overrides: Partial<PosterTextLayer>): PosterTextLayer {
  return {
    text: '',
    fontSize: 100,
    fontWeight: 'bold',
    fontStyle: 'normal',
    fontFamily: POSTER_FONTS[0].value,
    width: 0.85,
    maxHeight: 0.3,
    autoFit: true,
    lineHeight: 1.18,
    color: '#ffffff',
    x: 0.075,
    y: 0.7,
    textAlign: 'left',
    shadowColor: '#000000',
    shadowBlur: 0,
    strokeColor: '#000000',
    strokeWidth: 0,
    highlight: '',
    highlightColor: '#e7c898',
    ...overrides,
  }
}

export function applyPosterTemplate(
  base: PosterConfig,
  template: PosterTemplate,
  ratio = base.ratio,
): PosterConfig {
  const next: PosterConfig = {
    ...base,
    ratio,
    templateId: template.id,
    layout: template.category,
    composition: template.composition,
    bgColor: template.paper,
    bgColorEnd: template.paper,
    accentColor: template.accent,
    title: { ...base.title },
    subtitle: { ...base.subtitle },
    logo: { ...base.logo },
  }
  const portrait = POSTER_DIMS[ratio][1] > POSTER_DIMS[ratio][0]
  const square = ratio === '1:1'
  const [w] = POSTER_DIMS[ratio]
  const fontSize = w * (portrait ? 0.105 : 0.072)
  Object.assign(next.title, {
    fontFamily: POSTER_FONTS[template.serif ? 1 : 0].value,
    fontSize: Math.round(fontSize),
    fontWeight: 'bold',
    fontStyle: 'normal',
    width: 0.84,
    maxHeight: 0.28,
    autoFit: true,
    lineHeight: 1.2,
    textAlign: 'left',
    x: 0.08,
    y: 0.73,
    color: template.ink,
    highlightColor: template.accent,
    shadowBlur: 0,
    strokeWidth: 0,
  })
  Object.assign(next.subtitle, {
    fontFamily: POSTER_FONTS[0].value,
    fontSize: Math.round(w * (portrait ? 0.029 : 0.018)),
    fontWeight: 'normal',
    x: 0.08,
    y: 0.91,
    textAlign: 'left',
    color: template.ink,
    width: 0.84,
    maxHeight: 0.08,
    autoFit: true,
    shadowBlur: 0,
  })
  const tall = portrait || square
  const positions = {
    panorama: {
      x: 0.075,
      y: tall ? 0.68 : 0.72,
      width: 0.82,
      maxHeight: tall ? 0.26 : 0.32,
      fontSize: w * (tall ? 0.13 : 0.09),
    },
    contact: {
      x: 0.08,
      y: tall ? 0.17 : 0.32,
      width: tall ? 0.84 : 0.36,
      maxHeight: tall ? 0.23 : 0.36,
      fontSize: w * (tall ? 0.095 : 0.064),
    },
    record: {
      x: 0.08,
      y: tall ? 0.2 : 0.43,
      width: tall ? 0.84 : 0.35,
      maxHeight: tall ? 0.25 : 0.42,
      fontSize: w * (tall ? 0.1 : 0.075),
    },
    sleeve: {
      x: 0.075,
      y: tall ? 0.18 : 0.34,
      width: tall ? 0.85 : 0.4,
      maxHeight: tall ? 0.24 : 0.38,
      fontSize: w * (tall ? 0.105 : 0.074),
    },
    archive: {
      x: 0.075,
      y: tall ? 0.2 : 0.4,
      width: tall ? 0.84 : 0.4,
      maxHeight: tall ? 0.23 : 0.38,
      fontSize: w * (tall ? 0.103 : 0.072),
    },
    collage: {
      x: 0.08,
      y: tall ? 0.77 : 0.36,
      width: tall ? 0.84 : 0.4,
      maxHeight: tall ? 0.26 : 0.4,
      fontSize: w * (tall ? 0.1 : 0.072),
    },
    type: {
      x: 0.065,
      y: tall ? 0.27 : 0.41,
      width: tall ? 0.88 : 0.62,
      maxHeight: tall ? 0.38 : 0.58,
      fontSize: w * (tall ? 0.17 : 0.125),
    },
    orbit: {
      x: 0.08,
      y: tall ? 0.19 : 0.36,
      width: tall ? 0.84 : 0.43,
      maxHeight: tall ? 0.24 : 0.4,
      fontSize: w * (tall ? 0.11 : 0.078),
    },
  }[template.composition]
  Object.assign(next.title, positions, {
    fontSize: Math.round(positions.fontSize),
    lineHeight: template.composition === 'type' ? 1.02 : 1.12,
  })
  const subtitleY = {
    panorama: tall ? 0.88 : 0.91,
    contact: tall ? 0.9 : 0.73,
    record: tall ? 0.91 : 0.77,
    sleeve: tall ? 0.91 : 0.79,
    archive: tall ? 0.91 : 0.78,
    collage: tall ? 0.93 : 0.78,
    type: tall ? 0.9 : 0.87,
    orbit: tall ? 0.91 : 0.8,
  }[template.composition]
  Object.assign(next.subtitle, {
    x: next.title.x,
    y: subtitleY,
    width: tall ? 0.84 : template.composition === 'panorama' ? 0.84 : 0.38,
    maxHeight: 0.07,
  })
  // Put the brand mark in the outer margin, away from the artwork.
  Object.assign(next.logo, { x: 0.91, y: 0.06, size: 0.035 })
  return next
}

export function createPosterConfig(): PosterConfig {
  return applyPosterTemplate(
    {
      ratio: '16:9',
      edition: '01',
      bgType: 'image',
      bgFile: null,
      bgUrl: '',
      bgColor: '#182c2b',
      bgColorEnd: '#182c2b',
      bgOverlayOpacity: 0.22,
      bgVideoTime: 0,
      bgFit: 'cover',
      bgZoom: 1,
      bgPositionX: 0.5,
      bgPositionY: 0.5,
      eyebrow: 'TRAVEL JOURNAL / 01',
      footer: '把日常，拍成值得收藏的片段',
      title: textLayer({ text: '把生活\n交给旷野' }),
      subtitle: textLayer({ text: '沿着海岸，找回自己的节奏', fontSize: 34 }),
      logo: { file: null, url: '', size: 0.07, x: 0.88, y: 0.12, opacity: 1, rounded: false },
    },
    POSTER_TEMPLATES[0],
  )
}
