<script setup lang="ts">
// Vue port of the inline <Toggle> in src/components/SettingsPage.tsx.
defineProps<{ checked: boolean; disabled?: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
</script>

<template>
  <button
    class="settings-toggle"
    :class="{ on: checked }"
    role="switch"
    :aria-checked="checked"
    :style="disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined"
    @click="!disabled && emit('change', !checked)"
  >
    <span class="settings-toggle-thumb" />
  </button>
</template>
