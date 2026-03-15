<script setup lang="ts">
import { ref } from 'vue'
import type { UploadedImage } from '../types'

const props = defineProps<{
  images: UploadedImage[]
}>()

const emit = defineEmits<{
  add: [images: UploadedImage[]]
  remove: [id: string]
  reorder: [images: UploadedImage[]]
}>()

const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

// 拖拽排序
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer?.types.includes('Files')) {
    isDragging.value = true
  }
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files) {
    processFiles(Array.from(files))
  }
}

function handleFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) {
    processFiles(Array.from(target.files))
    target.value = '' // 重置以允许再次选择相同文件
  }
}

function processFiles(files: File[]) {
  const imageFiles = files.filter((f) => f.type.startsWith('image/'))
  if (imageFiles.length === 0) {
    alert('请选择图片文件')
    return
  }

  const newImages: UploadedImage[] = imageFiles.map((file) => ({
    id: crypto.randomUUID(),
    file,
    url: URL.createObjectURL(file),
    name: file.name,
  }))

  emit('add', newImages)
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

function removeImage(id: string) {
  emit('remove', id)
}

// 拖拽排序
function onSortDragStart(index: number) {
  dragIndex.value = index
}

function onSortDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  dragOverIndex.value = index
}

function onSortDrop(index: number) {
  if (dragIndex.value === null || dragIndex.value === index) return

  const newImages = [...props.images]
  const [moved] = newImages.splice(dragIndex.value, 1)
  newImages.splice(index, 0, moved)
  emit('reorder', newImages)

  dragIndex.value = null
  dragOverIndex.value = null
}

function onSortDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div class="image-uploader">
    <!-- 已上传的图片列表 -->
    <div class="image-grid" v-if="images.length > 0">
      <div
        v-for="(img, index) in images"
        :key="img.id"
        class="image-item"
        :class="{
          dragging: dragIndex === index,
          'drag-over': dragOverIndex === index,
        }"
        draggable="true"
        @dragstart="onSortDragStart(index)"
        @dragover="(e) => onSortDragOver(e, index)"
        @drop.stop="onSortDrop(index)"
        @dragend="onSortDragEnd"
      >
        <img :src="img.url" :alt="img.name" class="thumbnail" />
        <div class="image-overlay">
          <span class="image-index">{{ index + 1 }}</span>
          <button class="remove-btn" @click.stop="removeImage(img.id)" title="删除">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 添加更多按钮 -->
      <div class="image-item add-more" @click="triggerFileInput">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="drop-zone"
      :class="{ dragging: isDragging }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="triggerFileInput"
    >
      <div class="drop-content">
        <div class="icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <p class="label">拖放图片到此处</p>
        <p class="hint">或点击选择图片（可多选）</p>
        <p class="formats">支持 JPG, PNG, GIF, WebP</p>
      </div>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      class="hidden-input"
      @change="handleFileInput"
    />
  </div>
</template>

<style scoped>
.image-uploader {
  width: 100%;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
}

.image-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  cursor: grab;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.image-item:hover {
  border-color: rgba(255, 255, 255, 0.3);
}

.image-item.dragging {
  opacity: 0.4;
}

.image-item.drag-over {
  border-color: #646cff;
  transform: scale(1.05);
}

.thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.6) 0%, transparent 40%, transparent 60%, rgba(0, 0, 0, 0.4) 100%);
  opacity: 0;
  transition: opacity 0.2s;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 6px;
}

.image-item:hover .image-overlay {
  opacity: 1;
}

.image-index {
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 12px;
  font-weight: 600;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remove-btn {
  background: rgba(255, 59, 48, 0.8);
  border: none;
  color: white;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.2s;
}

.remove-btn:hover {
  background: rgba(255, 59, 48, 1);
}

.add-more {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed rgba(255, 255, 255, 0.15);
  cursor: pointer;
  color: rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.add-more:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.05);
}

.drop-zone {
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 32px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.03);
}

.drop-zone:hover {
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.06);
}

.drop-zone.dragging {
  border-color: #646cff;
  background: rgba(100, 108, 255, 0.1);
  transform: scale(1.02);
}

.hidden-input {
  display: none;
}

.drop-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.icon {
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 8px;
}

.label {
  font-size: 16px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  margin: 0;
}

.hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
}

.formats {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.25);
  margin: 4px 0 0 0;
}
</style>
