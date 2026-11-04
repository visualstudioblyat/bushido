<script setup lang="ts">
import type { DividerInfo } from "../../src/types";

// Vue port of src/components/SplitOverlay.tsx.
defineProps<{ dividers: DividerInfo[]; draggingDiv: number | null }>();
const emit = defineEmits<{ dividerDown: [idx: number, e: MouseEvent] }>();
</script>

<template>
  <div class="split-overlay">
    <div
      v-for="(d, i) in dividers"
      :key="`${d.path.join('-')}-${d.childIdx}`"
      class="split-divider"
      :class="[d.dir, { dragging: draggingDiv === i }]"
      :style="{ left: `${d.x}px`, top: `${d.y}px`, width: `${d.w}px`, height: `${d.h}px` }"
      @mousedown="emit('dividerDown', i, $event)"
    />
  </div>
</template>
