import { defineStore } from "pinia";
import { ref } from "vue";
import type { PermissionRequest } from "../types";

// Pinia port of src/store/vaultStore.ts.
// All setters were trivial, so call sites mutate the refs directly.
export const useVaultStore = defineStore("vault", () => {
  const vaultSavePrompt = ref<{ domain: string; username: string; password: string } | null>(null);
  const vaultMasterModal = ref<"setup" | "unlock" | null>(null);
  const vaultUnlocked = ref(false);
  const permReq = ref<PermissionRequest | null>(null);
  const permRemember = ref(true);

  return { vaultSavePrompt, vaultMasterModal, vaultUnlocked, permReq, permRemember };
});
