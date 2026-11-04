<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Vue port of src/components/PairingWizard.tsx.
const props = defineProps<{
  mode: "initiator" | "responder";
  peerDeviceId: string;
  peerDeviceName: string;
  code?: string;
}>();
const emit = defineEmits<{ close: [] }>();

type Step = "showing-code" | "entering-code" | "verifying" | "success" | "error";

const step = ref<Step>(props.mode === "initiator" ? "showing-code" : "entering-code");
const inputCode = ref("");
const progress = ref("Waiting for other device...");
const errorMsg = ref("");
const pairedName = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

let unlistens: (() => void)[] = [];

onMounted(async () => {
  if (props.mode === "responder") setTimeout(() => inputRef.value?.focus(), 100);

  const unsubs: Promise<() => void>[] = [];
  unsubs.push(listen<{ step: string }>("pair-progress", e => { progress.value = e.payload.step; }));
  unsubs.push(listen<{ device_id: string; device_name: string }>("pair-complete", e => {
    pairedName.value = e.payload.device_name;
    step.value = "success";
  }));
  unsubs.push(listen<{ message: string }>("pair-error", e => {
    errorMsg.value = e.payload.message;
    step.value = "error";
  }));
  unlistens = await Promise.all(unsubs);
});

onUnmounted(() => unlistens.forEach(fn => fn()));

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

async function submitCode() {
  if (inputCode.value.length !== 6) return;
  step.value = "verifying";
  progress.value = "Verifying code...";
  try {
    await invoke("enter_pairing_code", { peerId: props.peerDeviceId, code: inputCode.value });
  } catch (e: any) {
    errorMsg.value = String(e);
    step.value = "error";
  }
}
</script>

<template>
  <div class="pair-overlay" @click="emit('close')">
    <div class="pair-wizard" @click.stop>
      <div class="pair-header">
        <span class="pair-header-title">
          {{ step === "success" ? "Paired!" : step === "error" ? "Pairing Failed" : "Pair Device" }}
        </span>
        <button class="pair-close-btn" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="pair-body">
        <template v-if="step === 'showing-code'">
          <p class="pair-instruction">
            Enter this code on <strong>{{ peerDeviceName || "the other device" }}</strong>:
          </p>
          <div class="pair-code-display">
            <span v-for="(digit, i) in (code || '').split('')" :key="i" class="pair-code-digit">{{ digit }}</span>
          </div>
          <p class="pair-status">{{ progress }}</p>
        </template>

        <template v-else-if="step === 'entering-code'">
          <p class="pair-instruction">
            <strong>{{ peerDeviceName || "A device" }}</strong> wants to pair.
            Enter the 6-digit code shown on that device:
          </p>
          <input
            ref="inputRef"
            v-model="inputCode"
            class="pair-code-input"
            placeholder="000000"
            maxlength="6"
            spellcheck="false"
            autofocus
            @keydown="e => { if (e.key === 'Enter') submitCode(); }"
          />
          <button class="pair-submit-btn" :disabled="inputCode.length !== 6" @click="submitCode">
            Verify
          </button>
        </template>

        <template v-else-if="step === 'verifying'">
          <div class="pair-spinner" />
          <p class="pair-status">{{ progress }}</p>
        </template>

        <template v-else-if="step === 'success'">
          <div class="pair-success-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="var(--accent)" stroke-width="2.5" />
              <path d="M14 24L21 31L34 18" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <p class="pair-instruction">Successfully paired with <strong>{{ pairedName }}</strong></p>
          <button class="pair-submit-btn" @click="emit('close')">Done</button>
        </template>

        <template v-else>
          <div class="pair-error-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="#ef4444" stroke-width="2.5" />
              <path d="M16 16L32 32M32 16L16 32" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" />
            </svg>
          </div>
          <p class="pair-instruction pair-error-text">{{ errorMsg }}</p>
          <button class="pair-submit-btn" @click="emit('close')">Close</button>
        </template>
      </div>
    </div>
  </div>
</template>
