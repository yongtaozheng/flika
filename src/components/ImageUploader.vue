<script setup lang="ts">
import { ref } from 'vue'
import type { UploadedImage } from '../types'
import { isTauri, pickImageFiles } from '../utils/filePicker'
import { v4 as uuidv4 } from 'uuid';

const props = defineProps<{ images: UploadedImage[] }>()

const emit = defineEmits<{
  add: [images: UploadedImage[]]
  remove: [id: string]
  reorder: [images: UploadedImage[]]
}>()

const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer?.types.includes('Files')) isDragging.value = true
}

function handleDragLeave() { isDragging.value = false }

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files) processFiles(Array.from(files))
}

function handleFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) { processFiles(Array.from(target.files)); target.value = '' }
}

function processFiles(files: File[]) {
  const imageFiles = files.filter((f) => f.type.startsWith('image/'))
  if (!imageFiles.length) { alert('请选择图片文件'); return }
  emit('add', imageFiles.map((file) => ({
    id: uuidv4(), file, url: URL.createObjectURL(file), name: file.name,
  })))
}

async function triggerFileInput() {
  if (isTauri()) {
    const files = await pickImageFiles()
    if (files.length) processFiles(files)
  } else {
    fileInputRef.value?.click()
  }
}

function removeImage(id: string) { emit('remove', id) }

function onSortDragStart(index: number) { dragIndex.value = index }
function onSortDragOver(e: DragEvent, index: number) { e.preventDefault(); dragOverIndex.value = index }
function onSortDrop(index: number) {
  if (dragIndex.value === null || dragIndex.value === index) return
  const imgs = [...props.images]
  const [moved] = imgs.splice(dragIndex.value, 1)
  imgs.splice(index, 0, moved)
  emit('reorder', imgs)
  dragIndex.value = null; dragOverIndex.value = null
}
function onSortDragEnd() { dragIndex.value = null; dragOverIndex.value = null }
</script>

<template>
  <div class="image-uploader">
    <input ref="fileInputRef" type="file" accept="image/*" multiple class="hidden" @change="handleFileInput" />

    <!-- Grid with images -->
    <div v-if="images.length" class="image-grid">
      <div
        v-for="(img, index) in images"
        :key="img.id"
        class="img-tile"
        :class="{ sorting: dragIndex === index, over: dragOverIndex === index }"
        draggable="true"
        @dragstart="onSortDragStart(index)"
        @dragover="(e) => onSortDragOver(e, index)"
        @drop.stop="onSortDrop(index)"
        @dragend="onSortDragEnd"
      >
        <img :src="img.url" :alt="img.name" />
        <div class="tile-overlay">
          <span class="tile-num">{{ index + 1 }}</span>
          <button class="tile-del" @click.stop="removeImage(img.id)" title="删除">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Add more -->
      <div class="img-tile add-tile" @click="triggerFileInput" title="添加更多">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
    </div>

    <!-- Empty drop zone -->
    <div
      v-else
      class="drop-zone"
      :class="{ dragging: isDragging }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="triggerFileInput"
    >
      <div class="drop-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
      </div>
      <p class="drop-label">拖放图片到此处</p>
      <p class="drop-hint">或点击选择（可多选）· JPG / PNG / GIF / WebP</p>
    </div>
  </div>
</template>

<style scoped>
.hidden { display: none; }

/* ── Grid ── */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px;
}

.img-tile {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--r-md);
  overflow: hidden;
  cursor: grab;
  border: 1.5px solid transparent;
  transition: border-color 0.15s, opacity 0.15s, transform 0.15s;
  background: var(--surface-2);
}

.img-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.img-tile:hover { border-color: var(--border-hover); }
.img-tile.sorting { opacity: 0.35; }
.img-tile.over { border-color: var(--accent); transform: scale(1.04); }

/* Overlay */
.tile-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, rgba(0,0,0,0.6) 0%, transparent 50%, rgba(0,0,0,0.4) 100%);
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 5px;
}

.img-tile:hover .tile-overlay { opacity: 1; }

.tile-num {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255,255,255,0.9);
  background: rgba(0,0,0,0.5);
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tile-del {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: rgba(220, 50, 80, 0.85);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.tile-del:hover { background: rgba(220, 50, 80, 1); }

/* Add tile */
.add-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px dashed var(--border);
  color: var(--text-4);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.add-tile:hover {
  border-color: var(--border-hover);
  color: var(--text-3);
  background: var(--hover-bg);
}

/* ── Drop zone ── */
.drop-zone {
  border: 1.5px dashed var(--border-hover);
  border-radius: var(--r-md);
  padding: 24px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.drop-zone:hover {
  border-color: rgba(112, 96, 255, 0.4);
  background: var(--accent-dim);
}

.drop-zone.dragging {
  border-color: var(--accent);
  background: var(--accent-dim);
}

.drop-icon { color: var(--text-3); margin-bottom: 2px; transition: color 0.2s; }
.drop-zone:hover .drop-icon,
.drop-zone.dragging .drop-icon { color: var(--accent-light); }

.drop-label { font-size: 13.5px; font-weight: 500; color: var(--text-2); }
.drop-hint { font-size: 11.5px; color: var(--text-3); }
</style>
