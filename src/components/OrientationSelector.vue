<script setup lang="ts">
import type { Orientation } from '../composables/useOrientation'

defineProps<{
  modelValue: Orientation
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Orientation]
}>()
</script>

<template>
  <div class="orientation-selector">
    <button
      class="orient-btn"
      :class="{ active: modelValue === 'landscape' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'landscape')"
      title="横屏 16:9"
    >
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="0.75" y="0.75" width="14.5" height="10.5" rx="1.5" />
      </svg>
      <span>横屏</span>
    </button>
    <button
      class="orient-btn"
      :class="{ active: modelValue === 'portrait' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'portrait')"
      title="竖屏 9:16"
    >
      <svg width="12" height="16" viewBox="0 0 12 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="0.75" y="0.75" width="10.5" height="14.5" rx="1.5" />
      </svg>
      <span>竖屏</span>
    </button>
  </div>
</template>

<style scoped>
.orientation-selector {
  display: flex;
  gap: 4px;
}

.orient-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
  background: var(--surface-2);
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.orient-btn:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--text-2);
}

.orient-btn.active {
  color: var(--accent);
  background: var(--accent-dim);
  border-color: var(--accent);
}

.orient-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
