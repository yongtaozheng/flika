<div align="center">

# Flika

**音乐可视化动画创作工具**

基于 Vue 3 + TypeScript + Tauri 2 构建，将图片与音乐节拍融合，创作令人惊艳的动态视觉作品。

[![Vue 3](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-4-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white)](https://tauri.app/)

[在线体验](http://jyeontu.xyz/flika) · [功能介绍](#功能展示) · [快速开始](#快速开始)

</div>

---

## 功能展示

Flika 提供 **15 种** 动画创作模式，涵盖节拍驱动、图像特效、粒子系统、视觉合成等多个方向。

### 节拍驱动类

#### 踩点动画

经典音乐踩点视频制作，根据音乐节拍自动切换图片并叠加丰富的视觉特效。

- 18 种特效：缩放、旋转、抖动、闪白、模糊、滑动、弹跳、故障、翻转、像素化、反色、漩涡、色散、波浪、分裂、霓虹、心跳等
- 智能节拍检测，自动分析音乐节奏
- 多特效自由组合叠加
- 导出 MP4 / WebM 视频

#### 扩散着色

独特的图像扩散着色效果，从中心向外扩散上色，配合音乐节奏呈现渐进式视觉体验。

- 多种扩散过渡动画
- 支持自定义扩散参数
- Web Worker 加速渲染
- 音乐同步着色节奏

#### 涟漪拼接

以涟漪波纹形式进行图片间的过渡拼接，水波纹从中心扩散，带来流畅的视觉切换体验。

- 涟漪波纹过渡动画
- 自定义波纹参数
- 音乐同步切换

### 图像特效类

#### 水墨渲染

模拟中国水墨画的渲染效果，图像以墨迹晕染的方式逐步展现，配合音乐节拍呈现东方美学。

- 水墨晕染扩散动画
- 自定义渲染参数
- 音乐节拍驱动渲染节奏

#### 碎片拼贴

将图像拆解为碎片，以拼贴方式重新组合，配合音乐节拍驱动碎片运动。

- 碎片化分割与重组动画
- 自定义碎片数量与运动轨迹
- 节拍驱动碎片聚散

#### 像素瀑布

像素化风格的瀑布流动画，图像以像素块的方式如瀑布般倾泻展现。

- 像素化瀑布流效果
- 自定义像素粒度
- 音乐同步流速控制

#### 调色重绘

对图像进行色调重映射，以全新的调色方案重新绘制画面，配合音乐节奏渐进变化。

- 多种调色方案
- 渐进式色彩变换
- 音乐同步色彩节奏

#### 雨滴侵蚀

模拟雨滴落在画布上的侵蚀效果，水滴逐步揭开图像内容，营造独特的揭幕体验。

- 雨滴侵蚀扩散动画
- 自定义侵蚀参数
- 音乐驱动雨滴节奏

### 粒子与光效类

#### 径向光束

从中心向外发射径向光束，光线扫过之处展现图像内容，打造炫酷的光效展示。

- 径向光束扫描动画
- 自定义光束参数
- 音乐节拍触发光效

#### 粒子重塑

将图像分解为粒子，通过物理模拟让粒子重新聚合成目标图像，配合音乐呈现聚散效果。

- 粒子分解与重组动画
- 物理引力模拟
- 音乐节拍驱动粒子运动

#### 万花筒

将图像以万花筒方式进行对称旋转变换，呈现绚丽的万花筒视觉效果。

- 万花筒对称变换
- 自定义对称参数与旋转速度
- 音乐同步旋转节奏

#### 音乐球

3D 音乐可视化球体，音频频谱驱动球体形变与粒子运动，呈现沉浸式视听体验。

- 3D 球体频谱可视化
- 音频频谱实时分析
- 动态粒子效果

### 视频合成类

#### 胶片放映

复古胶片风格动画，支持多列胶片同步滚动，配合音乐节拍触发闪烁等效果，还原经典胶片放映机质感。

- 1 / 2 / 3 列布局自由切换
- 每列可独立配置图片或视频
- 胶片颗粒噪点、划痕、节拍闪烁、复古色调等可选效果
- 音乐同步驱动滚动加速

#### 视频开场

制作专业级视频开场动画，支持标题、副标题、Logo 三层元素独立动画编排。

- 多种入场动画：淡入、上滑、缩放、打字机、故障风、镂空揭幕等
- 背景支持纯色渐变、图片、视频三种模式
- 每层元素可独立调节位置、延迟、时长
- 音频节拍同步：标题自动对齐第一个节拍

#### 封面海报

将图片与音乐结合，生成带有动态效果的封面海报动画。

- 多种视觉效果叠加
- 音乐节拍驱动动画节奏
- 导出视频分享

---

## 通用特性

| 特性 | 说明 |
| --- | --- |
| 双平台支持 | Web 端在线使用 + Tauri 2 桌面端原生体验 |
| 明暗主题 | 支持亮色 / 暗色主题切换，跟随系统偏好 |
| 拖拽上传 | 音频、图片、视频素材均支持拖拽导入 |
| 实时预览 | 所见即所得，参数调整即时生效 |
| 智能节拍检测 | 自动分析音乐节拍，驱动动画节奏 |
| 视频导出 | 支持导出 MP4 / WebM 格式视频 |

---

## 技术架构

```
src/
├── views/                  # 页面组件（15 种动画模式）
├── components/             # 通用组件
│   ├── AnimationPreview    # 动画预览画布
│   ├── AnimationControls   # 播放控制与特效面板
│   ├── AudioUploader       # 音频上传
│   ├── ImageUploader       # 图片上传
│   └── OrientationSelector # 方向选择器
├── composables/            # 组合式函数
│   ├── use*Engine.ts       # 各动画模式的渲染引擎
│   ├── useBeatDetector.ts  # 音乐节拍检测
│   ├── useAudioPlayer.ts   # 音频播放控制
│   └── useTheme.ts         # 主题管理
├── utils/                  # 工具函数
│   └── filePicker.ts       # 文件选择（Web / Tauri 兼容）
├── workers/                # Web Worker
│   └── diffusionRender     # 扩散渲染 Worker
├── router/                 # 路由配置
└── types/                  # TypeScript 类型定义

src-tauri/                  # Tauri 2 桌面端
├── src/                    # Rust 后端
├── capabilities/           # 权限配置
└── icons/                  # 应用图标
```

### 技术栈

| 类别 | 技术 |
| --- | --- |
| 前端框架 | Vue 3 (Composition API) |
| 构建工具 | Vite 4 |
| 语言 | TypeScript 5.4 |
| 桌面端 | Tauri 2 (Rust) |
| 路由 | Vue Router 4 |
| 渲染 | Canvas 2D / Web Worker |
| 视频编码 | MediaBunny |

---

## 快速开始

### 环境要求

- Node.js >= 16
- npm >= 8
- Rust（仅桌面端需要）

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/jyeontu/tracking-point-image-animation.git
cd tracking-point-image-animation

# 安装依赖
npm install

# 启动 Web 开发服务器（端口 1420）
npm run dev

# 构建生产版本
npm run build
```

### 桌面端（Tauri）

```bash
# 启动桌面端开发模式
npm run tauri:dev

# 构建桌面端安装包
npm run tauri:build
```

---

## 交流

欢迎加入微信交流群，一起探讨前端可视化与创意开发：

<img src="http://jyeontu.xyz:3003/viewImage/qrcode.png" width="200" alt="微信交流群" />

关注微信公众号获取更多前端创意内容：**前端也能这么有趣**

---

## License

MIT
