<script setup lang="ts">
// Vue port of the inline <Select> in src/components/SettingsPage.tsx.
type OptVal = string | number;
const props = defineProps<{
  value: OptVal;
  options: { value: OptVal; label: string }[];
}>();
const emit = defineEmits<{ change: [value: OptVal] }>();

function onChange(e: Event) {
  const raw = (e.target as HTMLSelectElement).value;
  const opt = props.options.find(o => String(o.value) === raw);
  emit("change", opt ? opt.value : raw);
}
</script>

<template>
  <select class="settings-select" :value="value" @change="onChange">
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>
