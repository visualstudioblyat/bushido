import { defineStore } from "pinia";
import { ref } from "vue";

// Pinia port of src/store/syncStore.ts.
// All setters were trivial, so call sites mutate the refs directly.
export const useSyncStore = defineStore("sync", () => {
  const syncToast = ref<"syncing" | "success" | "error" | null>(null);
  const syncTabReceived = ref<{ from_device: string; url: string; title: string } | null>(null);
  const syncPairedDevices = ref<{ device_id: string; name: string }[]>([]);

  return { syncToast, syncTabReceived, syncPairedDevices };
});
