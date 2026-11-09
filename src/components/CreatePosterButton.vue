<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { writePosterStorage } from '../utils/posterStorage'

const props = defineProps<{ canvas: HTMLCanvasElement | null; disabled?: boolean }>()
const router = useRouter()
const capturing = ref(false)
const error = ref('')
async function capture() {
  if (!props.canvas || capturing.value) return
  capturing.value = true
  error.value = ''
  try {
    const blob = await new Promise<Blob>((resolve, reject) =>
      props.canvas!.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('无法截取当前画面，请重试'))),
        'image/png',
      ),
    )
    const file = new File([blob], '作品截图.png', { type: 'image/png' })
    await writePosterStorage('incoming-media', file)
    await router.push({ path: '/poster', query: { source: 'capture' } })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '截取失败，请重试'
  } finally {
    capturing.value = false
  }
}
</script>

<template>
  <div class="poster-capture">
    <button :disabled="disabled || !canvas || capturing" @click="capture">
      {{ capturing ? '正在截取…' : '用当前画面制作封面 ↗' }}
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.poster-capture {
  width: 100%;
}
.poster-capture button {
  width: 100%;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--border-hover);
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: 12px;
}
.poster-capture button:hover:not(:disabled) {
  color: var(--accent-light);
  border-color: var(--accent);
}
.poster-capture button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.poster-capture button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.poster-capture p {
  color: var(--amber);
  font-size: 11px;
  margin-top: 6px;
}
</style>
