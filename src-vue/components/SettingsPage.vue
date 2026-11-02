<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import type { DigidawSettings, VaultEntry } from "../../src/types";
import { DEFAULT_SETTINGS } from "../../src/types";
import { useUiStore } from "../stores/ui";
import SettingsToggle from "./settings/SettingsToggle.vue";
import SettingsSelect from "./settings/SettingsSelect.vue";
import PairingWizard from "./PairingWizard.vue";

// Vue port of src/components/SettingsPage.tsx. All 12 tabs are rendered in a
// single SFC with v-if per tab (same shape as React's switch(activeTab)).
// Callback props mirror the React Props exactly; store access goes through
// Pinia (useUiStore) replacing React zustand's .getState().

interface ImportedBookmark { title: string; url: string; folder: string }
interface ImportedHistory { title: string; url: string; visit_count: number; last_visit: number }
interface BrowserInfo { name: string; has_bookmarks: boolean; has_history: boolean }

const props = defineProps<{
  settings: DigidawSettings;
  onUpdate: (patch: Partial<DigidawSettings>) => void;
  onReloadAllTabs: () => void;
  onThemeChange: (accent: string, mode: "dark" | "light") => void;
  onOpenUrl: (url: string) => void;
  onImportBookmarks?: (bookmarks: ImportedBookmark[]) => void;
  onImportHistory?: (history: ImportedHistory[]) => void;
}>();

const ui = useUiStore();

const SEARCH_ENGINES: { value: DigidawSettings["searchEngine"]; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "brave", label: "Brave Search" },
  { value: "bing", label: "Bing" },
  { value: "custom", label: "Custom" },
];
const BANDWIDTH_OPTIONS = [
  { value: 0, label: "Unlimited" },
  { value: 512 * 1024, label: "512 KB/s" },
  { value: 1024 * 1024, label: "1 MB/s" },
  { value: 2 * 1024 * 1024, label: "2 MB/s" },
  { value: 5 * 1024 * 1024, label: "5 MB/s" },
  { value: 10 * 1024 * 1024, label: "10 MB/s" },
];
const SUSPEND_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 0, label: "Never" },
];
const ZOOM_OPTIONS = [
  { value: 80, label: "80%" }, { value: 90, label: "90%" }, { value: 100, label: "100%" },
  { value: 110, label: "110%" }, { value: 125, label: "125%" }, { value: 150, label: "150%" },
];
const TOP_SITE_ROW_OPTIONS = [
  { value: 1, label: "1 row" }, { value: 2, label: "2 rows" }, { value: 3, label: "3 rows" },
];
const AUTOPLAY_OPTIONS: { value: DigidawSettings["autoplayPolicy"]; label: string }[] = [
  { value: "block-all", label: "Block all media" },
  { value: "block-audio", label: "Block audio only" },
  { value: "allow", label: "Allow" },
];
const ON_STARTUP_OPTIONS: { value: DigidawSettings["onStartup"]; label: string }[] = [
  { value: "restore", label: "Restore previous session" },
  { value: "newtab", label: "Open new tab" },
  { value: "custom", label: "Open specific page" },
];
const DNS_OPTIONS: { value: DigidawSettings["dnsLevel"]; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "strict", label: "Strict (recommended)" },
  { value: "maximum", label: "Maximum" },
];
const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const VAULT_TIMEOUT_OPTIONS = [
  { value: 0, label: "On app close" }, { value: 5, label: "5 minutes" }, { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" }, { value: 60, label: "1 hour" },
];

const SHORTCUT_GROUPS = [
  { group: "Tab Management", items: [
    { action: "new-tab", desc: "New tab" },
    { action: "close-tab", desc: "Close tab" },
    { action: "reopen-tab", desc: "Reopen closed tab" },
  ]},
  { group: "Navigation", items: [
    { action: "focus-url", desc: "Focus address bar" },
    { action: "find", desc: "Find in page" },
    { action: "command-palette", desc: "Command palette" },
    { action: "reload", desc: "Reload page" },
    { action: "fullscreen", desc: "Toggle fullscreen" },
  ]},
  { group: "Features", items: [
    { action: "bookmark", desc: "Bookmark page" },
    { action: "history", desc: "History" },
    { action: "downloads", desc: "Downloads" },
    { action: "toggle-sidebar", desc: "Toggle sidebar" },
    { action: "toggle-compact", desc: "Compact mode" },
    { action: "reader-mode", desc: "Reader mode" },
    { action: "devtools", desc: "Developer tools" },
    { action: "split-view", desc: "Split view" },
    { action: "print", desc: "Print page" },
    { action: "screenshot", desc: "Screenshot" },
  ]},
  { group: "Zoom", items: [
    { action: "zoom-in", desc: "Zoom in" },
    { action: "zoom-out", desc: "Zoom out" },
    { action: "zoom-reset", desc: "Reset zoom" },
  ]},
];

function comboFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key === "Escape") return null;
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

const TABS = [
  { id: "general", label: "General" },
  { id: "newtab", label: "New Tab" },
  { id: "downloads", label: "Downloads" },
  { id: "tabs", label: "Tabs" },
  { id: "privacy", label: "Privacy" },
  { id: "security", label: "Security" },
  { id: "permissions", label: "Permissions" },
  { id: "appearance", label: "Appearance" },
  { id: "sync", label: "Sync" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "passwords", label: "Passwords" },
  { id: "about", label: "About" },
] as const;
type TabId = typeof TABS[number]["id"];

const ACCENT_COLORS = [
  "#6366f1", "#f43f5e", "#22c55e", "#f59e0b",
  "#06b6d4", "#a855f7", "#ec4899", "#14b8a6",
];
const SECURITY_KEYS: (keyof DigidawSettings)[] = [
  "disableDevTools", "disableAutofill", "disablePasswordSave",
  "blockServiceWorkers", "blockFontEnumeration", "spoofHardwareConcurrency",
];

interface SyncPeer {
  device_id: string; name: string; fingerprint: string; addresses: string[]; port: number;
}
interface SyncInfo {
  enabled: boolean; device_id: string; device_name: string; fingerprint: string;
  status: string | { Error: { message: string } };
  peers: SyncPeer[];
  paired_devices: { device_id: string; name: string; fingerprint: string; paired_at: number }[];
}

// --- state ---
const activeTab = ref<TabId>("general");
const securityDirty = ref(false);
const syncInfo = ref<SyncInfo | null>(null);
const syncLoading = ref(false);
const pairingWizard = ref<{ mode: "initiator" | "responder"; peerDeviceId: string; peerDeviceName: string; code?: string } | null>(null);
const simulateCode = ref<string | null>(null);
const recordingAction = ref<string | null>(null);
const vaultEntries = ref<VaultEntry[]>([]);
const vaultUnlocked = ref(false);
const vaultSearch = ref("");
const vaultRevealId = ref<string | null>(null);
const vaultGenLen = ref(20);
const vaultGenResult = ref("");
const vaultHasMaster = ref(false);
const importBrowsers = ref<BrowserInfo[]>([]);
const importSelected = ref<string | null>(null);
const importStatus = ref<string | null>(null);
const importLoading = ref(false);
const backups = ref<{ num: number; date: string }[]>([]);
const backupStatus = ref<string | null>(null);
const savedPerms = ref<{ domain: string; permission: string; allowed: boolean }[]>([]);
const permsLoaded = ref(false);
const appVersion = ref("...");
const selectedBackupNum = ref<string>("");

const syncTypes = computed(() => props.settings.syncDataTypes || { bookmarks: true, history: true, settings: true, tabs: true });
function setSyncTypes(next: typeof syncTypes.value) { set("syncDataTypes", next); }

function set<K extends keyof DigidawSettings>(key: K, value: DigidawSettings[K]) {
  props.onUpdate({ [key]: value } as Partial<DigidawSettings>);
  if (SECURITY_KEYS.includes(key)) securityDirty.value = true;
}

// --- lifecycle: initial loads ---
onMounted(() => {
  invoke<[number, string][]>("list_session_backups").then(list => {
    backups.value = list.map(([num, ms]) => {
      const d = new Date(parseInt(ms, 10));
      return { num, date: d.toLocaleString() };
    });
  }).catch(e => console.warn("[digidaw]", e));
  getVersion().then(v => appVersion.value = v).catch(() => appVersion.value = "unknown");
});

watch(() => props.settings.syncEnabled, () => {
  invoke<SyncInfo>("get_sync_status").then(v => syncInfo.value = v).catch(e => console.warn("[digidaw]", e));
}, { immediate: true });

// Tauri sync event listeners
let syncUnlistens: (() => void)[] = [];
onMounted(async () => {
  const subs = await Promise.all([
    listen<SyncPeer>("peer-discovered", () => {
      invoke<SyncInfo>("get_sync_status").then(v => syncInfo.value = v).catch(e => console.warn("[digidaw]", e));
    }),
    listen<string>("peer-removed", () => {
      invoke<SyncInfo>("get_sync_status").then(v => syncInfo.value = v).catch(e => console.warn("[digidaw]", e));
    }),
    listen<{ device_id: string; device_name: string }>("pair-request-received", e => {
      pairingWizard.value = { mode: "responder", peerDeviceId: e.payload.device_id, peerDeviceName: e.payload.device_name };
    }),
    listen("pair-complete", () => {
      invoke<SyncInfo>("get_sync_status").then(v => syncInfo.value = v).catch(e => console.warn("[digidaw]", e));
      simulateCode.value = null;
    }),
  ]);
  syncUnlistens = subs;
});
onUnmounted(() => syncUnlistens.forEach(fn => fn()));

// Shortcut recording
watch(recordingAction, (act, _old, onCleanup) => {
  if (!act) return;
  const handler = (e: KeyboardEvent) => {
    e.preventDefault(); e.stopPropagation();
    const combo = comboFromEvent(e);
    if (!combo) { if (e.key === "Escape") recordingAction.value = null; return; }
    const kb = props.settings.keybindings;
    const conflicting = Object.entries(kb).find(
      ([a, c]) => a !== act && (c as string).toLowerCase() === combo.toLowerCase()
    );
    if (conflicting) { recordingAction.value = null; return; }
    const oldCombo = kb[act];
    const newBindings = { ...kb, [act]: combo };
    invoke("rebind_shortcut", { action: act, oldCombo, newCombo: combo })
      .catch(err => console.error("Rebind failed:", err));
    props.onUpdate({ keybindings: newBindings });
    recordingAction.value = null;
  };
  window.addEventListener("keydown", handler, true);
  onCleanup(() => window.removeEventListener("keydown", handler, true));
});

// Permissions tab lazy load
function loadPerms() {
  invoke<{ domain: string; permission: string; allowed: boolean }[]>("get_permissions").then(p => {
    savedPerms.value = p; permsLoaded.value = true;
  }).catch(() => permsLoaded.value = true);
}
watch(activeTab, (t) => {
  if (t === "permissions" && !permsLoaded.value) loadPerms();
  if (t === "passwords") {
    invoke<boolean>("vault_has_master_password").then(v => vaultHasMaster.value = v).catch(e => console.warn("[digidaw]", e));
    invoke<boolean>("vault_is_unlocked").then(u => {
      vaultUnlocked.value = u;
      if (u) invoke<VaultEntry[]>("vault_get_entries", {}).then(v => vaultEntries.value = v).catch(e => console.warn("[digidaw]", e));
    }).catch(e => console.warn("[digidaw]", e));
  }
});

function revokePermission(domain: string, permission: string) {
  invoke("revoke_permission", { domain, permission }).then(() => {
    savedPerms.value = savedPerms.value.filter(p => !(p.domain === domain && p.permission === permission));
  });
}

async function detectBrowsers() {
  try {
    const list = await invoke<BrowserInfo[]>("detect_browsers");
    importBrowsers.value = list;
    if (list.length > 0) importSelected.value = list[0].name;
    else importStatus.value = "No browsers detected";
  } catch { importStatus.value = "Failed to detect browsers"; }
}

async function runImport() {
  if (!importSelected.value || importLoading.value) return;
  importLoading.value = true;
  importStatus.value = "Importing...";
  try {
    const bm = await invoke<ImportedBookmark[]>("import_bookmarks", { browser: importSelected.value });
    props.onImportBookmarks?.(bm);
    const hist = await invoke<ImportedHistory[]>("import_history", { browser: importSelected.value });
    props.onImportHistory?.(hist);
    importStatus.value = `Imported ${bm.length} bookmarks and ${hist.length} history entries`;
  } catch (e: any) {
    importStatus.value = `Import failed: ${e?.message || e}`;
  }
  importLoading.value = false;
}

async function restoreBackup() {
  if (!selectedBackupNum.value) return;
  try {
    backupStatus.value = "Restoring...";
    await invoke("restore_backup", { backupNum: parseInt(selectedBackupNum.value, 10) });
    backupStatus.value = "Restored. Reloading...";
    setTimeout(() => window.location.reload(), 800);
  } catch (e: any) {
    backupStatus.value = `Restore failed: ${e?.message || e}`;
  }
}

function setBandwidth(v: number) {
  set("bandwidthLimit", v);
  invoke("set_bandwidth_limit", { limit: v });
}

function updateMimeRoute(i: number, folder: string) {
  const updated = [...(props.settings.mimeRouting || [])];
  updated[i] = { ...updated[i], folder };
  set("mimeRouting", updated);
}

function onMaxTabsBlur() {
  const clamped = Math.max(10, Math.min(200, props.settings.maxTabs));
  if (clamped !== props.settings.maxTabs) set("maxTabs", clamped);
}

async function toggleSync(v: boolean) {
  if (syncLoading.value) return;
  syncLoading.value = true;
  try {
    if (v) {
      const name = props.settings.syncDeviceName || (await invoke<SyncInfo>("get_sync_status").catch(() => null))?.device_name || "My PC";
      const info = await invoke<SyncInfo>("enable_sync", { deviceName: name });
      syncInfo.value = info;
      props.onUpdate({ syncEnabled: true, syncDeviceName: name });
    } else {
      await invoke("disable_sync");
      props.onUpdate({ syncEnabled: false });
      syncInfo.value = null;
    }
  } catch (e) { console.error("Sync toggle failed:", e); }
  syncLoading.value = false;
}

function updateDeviceName(e: Event) {
  const name = (e.target as HTMLInputElement).value;
  props.onUpdate({ syncDeviceName: name });
  invoke("set_device_name", { name }).catch(err => console.warn("[digidaw]", err));
}

async function startPair(peer: SyncPeer) {
  try {
    const code = await invoke<string>("start_pairing", { peerId: peer.device_id });
    pairingWizard.value = { mode: "initiator", peerDeviceId: peer.device_id, peerDeviceName: peer.name, code };
  } catch (e) { console.error("Failed to start pairing:", e); }
}

async function removeDevice(deviceId: string) {
  try {
    await invoke("remove_device", { deviceId });
    invoke<SyncInfo>("get_sync_status").then(v => syncInfo.value = v).catch(e => console.warn("[digidaw]", e));
  } catch (e) { console.error("Failed to remove device:", e); }
}

async function resetSyncData() {
  if (!confirm("Reset all sync data? Your local bookmarks and history are preserved, but sync state will start fresh.")) return;
  try {
    await invoke("reset_sync_data");
    invoke<SyncInfo>("get_sync_status").then(v => syncInfo.value = v).catch(e => console.warn("[digidaw]", e));
  } catch (e) { console.error("Reset failed:", e); }
}

async function simulatePair() {
  try {
    simulateCode.value = null;
    const result = await invoke<{ device_id: string; device_name: string; code: string }>("simulate_pairing");
    simulateCode.value = result.code;
  } catch (e) { console.error("Simulate failed:", e); }
}
async function simulateSync() {
  try {
    simulateCode.value = null;
    const result = await invoke<{ device_id: string; device_name: string; code: string; info: string }>("simulate_sync");
    simulateCode.value = result.code;
  } catch (e) { console.error("Simulate sync failed:", e); }
}

function updateSyncType(key: keyof typeof syncTypes.value, v: boolean) {
  const next = { ...syncTypes.value, [key]: v };
  setSyncTypes(next);
  invoke("sync_set_data_types", next).catch(e => console.warn("[digidaw]", e));
}

async function resetShortcutsToDefaults() {
  const defaults = DEFAULT_SETTINGS.keybindings;
  for (const [action, combo] of Object.entries(defaults)) {
    const oldCombo = props.settings.keybindings[action];
    if (oldCombo && oldCombo !== combo) {
      await invoke("rebind_shortcut", { action, oldCombo, newCombo: combo }).catch(() => {
        ui.showError("Failed to rebind shortcut");
      });
    }
  }
  props.onUpdate({ keybindings: { ...defaults } });
}

const shortcutsIsDefault = computed(() =>
  JSON.stringify(props.settings.keybindings) === JSON.stringify(DEFAULT_SETTINGS.keybindings)
);

// vault
async function vaultUnlock(pw: string) {
  try {
    await invoke("vault_unlock", { masterPassword: pw });
    vaultUnlocked.value = true;
    invoke<VaultEntry[]>("vault_get_entries", {}).then(v => vaultEntries.value = v).catch(e => console.warn("[digidaw]", e));
  } catch (e) { ui.showError(String(e)); }
}
async function vaultSetup(pw: string) {
  try {
    await invoke("vault_setup", { masterPassword: pw });
    vaultUnlocked.value = true;
    vaultHasMaster.value = true;
  } catch (e) { ui.showError(String(e)); }
}
function lockVault() {
  invoke("vault_lock").catch(() => {});
  vaultUnlocked.value = false;
  vaultEntries.value = [];
}
async function deleteVaultEntry(id: string) {
  try {
    await invoke("vault_delete_entry", { id });
    vaultEntries.value = vaultEntries.value.filter(e => e.id !== id);
  } catch { ui.showError("Failed to delete password"); }
}
async function generatePassword() {
  const pw = await invoke<string>("vault_generate_password", { length: vaultGenLen.value });
  vaultGenResult.value = pw;
}

function onVaultSetupSubmit(e: Event) {
  const f = e.target as HTMLFormElement;
  const pw = (f.elements.namedItem("pw") as HTMLInputElement).value;
  const pw2 = (f.elements.namedItem("pw2") as HTMLInputElement).value;
  if (pw !== pw2) { ui.showError("Passwords don't match"); return; }
  vaultSetup(pw);
}
function onVaultUnlockSubmit(e: Event) {
  const pw = ((e.target as HTMLFormElement).elements.namedItem("pw") as HTMLInputElement).value;
  vaultUnlock(pw);
}

const filteredVault = computed(() => {
  const q = vaultSearch.value.toLowerCase();
  return vaultEntries.value.filter(e =>
    e.domain.toLowerCase().includes(q) || e.username.toLowerCase().includes(q)
  );
});

function replayOnboarding() {
  props.onUpdate({ onboardingComplete: false });
  setTimeout(() => window.location.reload(), 600);
}

// --- template helpers ---
function dotString(n: number) { return "•".repeat(n); }
function copyText(t: string) { navigator.clipboard.writeText(t); }
function syncStatusText(s: SyncInfo["status"]): string {
  if (typeof s === "string") return s;
  if (s && (s as { Error: { message: string } }).Error) return `Error: ${(s as { Error: { message: string } }).Error.message}`;
  return "Unknown";
}
function pairedDate(ts: number): string { return new Date(ts * 1000).toLocaleDateString(); }
function isDevMode(): boolean { return import.meta.env.DEV; }
const accentOtherStyle = computed(() => ({
  background: ACCENT_COLORS.includes(props.settings.accentColor)
    ? "conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #a855f7, #ec4899, #f43f5e)"
    : props.settings.accentColor,
  cursor: "pointer",
}));
function accentIsCustom(): boolean {
  return !ACCENT_COLORS.includes(props.settings.accentColor) && !!props.settings.accentColor;
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-header">
      <h1 class="settings-title">Settings</h1>
    </div>
    <div class="settings-layout">
      <nav class="settings-nav">
        <button
          v-for="tab in TABS" :key="tab.id"
          class="settings-nav-item" :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >{{ tab.label }}</button>
      </nav>
      <div class="settings-content">

        <!-- GENERAL -->
        <section v-if="activeTab === 'general'" class="settings-section">
          <h2 class="settings-section-title">General</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>Search engine</span>
              <span class="settings-hint">Used for URL bar searches and suggestions</span>
            </div>
            <SettingsSelect :value="settings.searchEngine" :options="SEARCH_ENGINES" @change="(v: any) => set('searchEngine', v)" />
          </div>
          <div v-if="settings.searchEngine === 'custom'" class="settings-row">
            <div class="settings-label">
              <span>Custom search URL</span>
              <span class="settings-hint">Use %s for the query</span>
            </div>
            <input class="settings-input" :value="settings.customSearchUrl"
              @input="(e: Event) => set('customSearchUrl', (e.target as HTMLInputElement).value)"
              placeholder="https://search.example.com/?q=%s" :spellcheck="false" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Search suggestions</span>
              <span class="settings-hint">Show search suggestions as you type</span>
            </div>
            <SettingsToggle :checked="settings.searchSuggestions" @change="(v: boolean) => set('searchSuggestions', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>On startup</span>
              <span class="settings-hint">What to show when the browser opens</span>
            </div>
            <SettingsSelect :value="settings.onStartup" :options="ON_STARTUP_OPTIONS" @change="(v: any) => set('onStartup', v)" />
          </div>
          <div v-if="settings.onStartup === 'custom'" class="settings-row">
            <div class="settings-label">
              <span>Homepage URL</span>
              <span class="settings-hint">Opens this page on startup</span>
            </div>
            <input class="settings-input" :value="settings.customHomepageUrl"
              @input="(e: Event) => set('customHomepageUrl', (e.target as HTMLInputElement).value)"
              placeholder="https://example.com" :spellcheck="false" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Default zoom level</span>
              <span class="settings-hint">Applied to new tabs</span>
            </div>
            <SettingsSelect :value="settings.defaultZoom" :options="ZOOM_OPTIONS" @change="(v: any) => set('defaultZoom', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Confirm before quitting</span>
              <span class="settings-hint">Show a confirmation dialog when closing the browser</span>
            </div>
            <SettingsToggle :checked="settings.confirmBeforeQuit" @change="(v: boolean) => set('confirmBeforeQuit', v)" />
          </div>
          <div class="settings-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
            <div class="settings-label">
              <span>Import from another browser</span>
              <span class="settings-hint">Import bookmarks and history from Chrome, Edge, or Firefox</span>
            </div>
            <button v-if="importBrowsers.length === 0" class="settings-btn" @click="detectBrowsers">Detect Browsers</button>
            <div v-else style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <select class="settings-input" style="width:auto;min-width:120px" :value="importSelected || ''" @change="(e: Event) => importSelected = (e.target as HTMLSelectElement).value">
                <option v-for="b in importBrowsers" :key="b.name" :value="b.name">{{ b.name }}</option>
              </select>
              <button class="settings-btn" :disabled="importLoading || !importSelected" @click="runImport">
                {{ importLoading ? "Importing..." : "Import" }}
              </button>
            </div>
            <span v-if="importStatus" class="settings-hint" style="margin-top:4px">{{ importStatus }}</span>
          </div>
          <div v-if="backups.length > 0" class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div class="settings-label">
              <span>Restore from backup</span>
              <span class="settings-hint">Restore a previous session. The browser will reload.</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <select class="settings-input" style="width:auto;min-width:240px" v-model="selectedBackupNum">
                <option value="" disabled>Select a backup...</option>
                <option v-for="b in backups" :key="b.num" :value="b.num">Backup #{{ b.num }} - {{ b.date }}</option>
              </select>
              <button class="settings-btn" @click="restoreBackup">Restore</button>
            </div>
            <span v-if="backupStatus" class="settings-hint" style="margin-top:4px">{{ backupStatus }}</span>
          </div>
        </section>

        <!-- NEW TAB -->
        <section v-else-if="activeTab === 'newtab'" class="settings-section">
          <h2 class="settings-section-title">New Tab</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>Show top sites</span>
              <span class="settings-hint">Display your most visited sites as a grid</span>
            </div>
            <SettingsToggle :checked="settings.showTopSites" @change="(v: boolean) => set('showTopSites', v)" />
          </div>
          <div v-if="settings.showTopSites" class="settings-row">
            <div class="settings-label">
              <span>Top sites rows</span>
              <span class="settings-hint">Number of rows shown in the top sites grid</span>
            </div>
            <SettingsSelect :value="settings.topSiteRows" :options="TOP_SITE_ROW_OPTIONS" @change="(v: any) => set('topSiteRows', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Show clock</span>
              <span class="settings-hint">Display the current time on new tab page</span>
            </div>
            <SettingsToggle :checked="settings.showClock" @change="(v: boolean) => set('showClock', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Show greeting</span>
              <span class="settings-hint">Display a time-based greeting message</span>
            </div>
            <SettingsToggle :checked="settings.showGreeting" @change="(v: boolean) => set('showGreeting', v)" />
          </div>
        </section>

        <!-- DOWNLOADS -->
        <section v-else-if="activeTab === 'downloads'" class="settings-section">
          <h2 class="settings-section-title">Downloads</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>Download location</span>
              <span class="settings-hint">Folder where files are saved</span>
            </div>
            <input class="settings-input" :value="settings.downloadLocation"
              @input="(e: Event) => set('downloadLocation', (e.target as HTMLInputElement).value)"
              placeholder="System default" :spellcheck="false" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Ask where to save</span>
              <span class="settings-hint">Prompt for a save location before each download</span>
            </div>
            <SettingsToggle :checked="settings.askDownloadLocation" @change="(v: boolean) => set('askDownloadLocation', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Bandwidth limit</span>
              <span class="settings-hint">Limit total download speed across all active downloads</span>
            </div>
            <SettingsSelect :value="settings.bandwidthLimit" :options="BANDWIDTH_OPTIONS" @change="(v: any) => setBandwidth(v)" />
          </div>
          <h3 class="settings-subsection-title" style="margin-top:16px">MIME auto-sort</h3>
          <p class="settings-info-text" style="margin-bottom:8px">
            Route downloads to different folders based on file type. Leave folder empty to use the default location.
          </p>
          <div v-for="(route, i) in (settings.mimeRouting || [])" :key="i" class="settings-row" style="gap:8px">
            <span class="settings-mime-prefix">{{ route.mimePrefix }}</span>
            <input class="settings-input" :value="route.folder"
              @input="(e: Event) => updateMimeRoute(i, (e.target as HTMLInputElement).value)"
              placeholder="Default location" :spellcheck="false" />
          </div>
        </section>

        <!-- TABS -->
        <section v-else-if="activeTab === 'tabs'" class="settings-section">
          <h2 class="settings-section-title">Tabs</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>Tab suspend timeout</span>
              <span class="settings-hint">Suspend inactive tabs after this time</span>
            </div>
            <SettingsSelect :value="settings.suspendTimeout" :options="SUSPEND_OPTIONS" @change="(v: any) => set('suspendTimeout', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Suspend excluded URLs</span>
              <span class="settings-hint">One URL per line. Tabs matching these won't be suspended.</span>
            </div>
            <textarea class="settings-textarea" :value="settings.suspendExcludedUrls"
              @input="(e: Event) => set('suspendExcludedUrls', (e.target as HTMLTextAreaElement).value)"
              placeholder="mail.google.com&#10;spotify.com" :spellcheck="false" :rows="3" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Select recently used tab on close</span>
              <span class="settings-hint">Switch to the last active tab instead of the adjacent one</span>
            </div>
            <SettingsToggle :checked="settings.selectRecentTabOnClose" @change="(v: boolean) => set('selectRecentTabOnClose', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Confirm before closing multiple tabs</span>
              <span class="settings-hint">Warn when closing a workspace or window with multiple tabs</span>
            </div>
            <SettingsToggle :checked="settings.confirmCloseMultiple" @change="(v: boolean) => set('confirmCloseMultiple', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Maximum open tabs</span>
              <span class="settings-hint">Limit how many tabs can be open at once (10–200)</span>
            </div>
            <input type="number" class="settings-number-input" :min="10" :max="200" :value="settings.maxTabs"
              @input="(e: Event) => { const raw = parseInt((e.target as HTMLInputElement).value); if (!isNaN(raw)) set('maxTabs', raw); }"
              @blur="onMaxTabsBlur" />
          </div>
        </section>

        <!-- PRIVACY -->
        <section v-else-if="activeTab === 'privacy'" class="settings-section">
          <h2 class="settings-section-title">Privacy</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>HTTPS-only mode</span>
              <span class="settings-hint">Upgrade all connections to HTTPS</span>
            </div>
            <SettingsToggle :checked="settings.httpsOnly" @change="(v: boolean) => set('httpsOnly', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Ad blocker</span>
              <span class="settings-hint">Block ads and trackers</span>
            </div>
            <SettingsToggle :checked="settings.adBlocker" @change="(v: boolean) => set('adBlocker', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Cookie banner auto-reject</span>
              <span class="settings-hint">Automatically dismiss cookie consent popups</span>
            </div>
            <SettingsToggle :checked="settings.cookieAutoReject" @change="(v: boolean) => set('cookieAutoReject', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Clear data on exit</span>
              <span class="settings-hint">Clear browsing history, cookies, cache, and local storage on close</span>
            </div>
            <SettingsToggle :checked="settings.clearDataOnExit" @change="(v: boolean) => set('clearDataOnExit', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Block pop-ups</span>
              <span class="settings-hint">Prevent sites from opening new windows</span>
            </div>
            <SettingsToggle :checked="settings.blockPopups" @change="(v: boolean) => set('blockPopups', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Autoplay policy</span>
              <span class="settings-hint">Control media autoplay behavior. Requires restart to apply.</span>
            </div>
            <SettingsSelect :value="settings.autoplayPolicy" :options="AUTOPLAY_OPTIONS" @change="(v: any) => set('autoplayPolicy', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>DNS protection</span>
              <span class="settings-hint">Standard: encrypted DNS. Strict: also detects hidden trackers. Maximum: no fallback, may break some sites.</span>
            </div>
            <SettingsSelect :value="settings.dnsLevel || 'strict'" :options="DNS_OPTIONS" @change="(v: any) => set('dnsLevel', v)" />
          </div>
        </section>

        <!-- SECURITY -->
        <section v-else-if="activeTab === 'security'" class="settings-section">
          <h2 class="settings-section-title">Security</h2>
          <div v-if="securityDirty" class="settings-reload-banner">
            <span>Reload all tabs to apply changes</span>
            <button class="settings-reload-btn" @click="onReloadAllTabs(); securityDirty = false">Reload</button>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Disable DevTools</span>
              <span class="settings-hint">Prevents opening developer tools in tabs</span>
            </div>
            <SettingsToggle :checked="settings.disableDevTools" @change="(v: boolean) => set('disableDevTools', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Disable form autofill</span>
              <span class="settings-hint">Prevents auto-completion of addresses, emails, and other form fields</span>
            </div>
            <SettingsToggle :checked="settings.disableAutofill" @change="(v: boolean) => set('disableAutofill', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Disable password save prompts</span>
              <span class="settings-hint">Never prompt to save or update passwords (vault is unaffected)</span>
            </div>
            <SettingsToggle :checked="settings.disablePasswordSave" @change="(v: boolean) => set('disablePasswordSave', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Block background scripts</span>
              <span class="settings-hint">Prevents sites from running code in the background (disables offline apps and push notifications)</span>
            </div>
            <SettingsToggle :checked="settings.blockServiceWorkers" @change="(v: boolean) => set('blockServiceWorkers', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Block font detection</span>
              <span class="settings-hint">Prevents sites from listing your installed fonts to fingerprint you</span>
            </div>
            <SettingsToggle :checked="settings.blockFontEnumeration" @change="(v: boolean) => set('blockFontEnumeration', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Hide CPU info</span>
              <span class="settings-hint">Reports a generic CPU core count to prevent hardware fingerprinting</span>
            </div>
            <SettingsToggle :checked="settings.spoofHardwareConcurrency" @change="(v: boolean) => set('spoofHardwareConcurrency', v)" />
          </div>
        </section>

        <!-- PERMISSIONS -->
        <section v-else-if="activeTab === 'permissions'" class="settings-section">
          <h2 class="settings-section-title">Permissions</h2>
          <p class="settings-info-text" style="margin-bottom:12px">
            Sites that have been granted or denied access to device features. Click revoke to reset a permission — the site will ask again on next visit.
          </p>
          <p v-if="savedPerms.length === 0" class="settings-info-text" style="opacity:0.5">No saved permissions yet.</p>
          <div v-else class="settings-perm-table">
            <div class="settings-perm-header">
              <span>Site</span><span>Permission</span><span>Decision</span><span></span>
            </div>
            <div v-for="(p, i) in savedPerms" :key="i" class="settings-perm-row">
              <span class="settings-perm-domain">{{ p.domain }}</span>
              <span class="settings-perm-kind">{{ p.permission }}</span>
              <span class="settings-perm-state" :class="p.allowed ? 'allowed' : 'denied'">
                {{ p.allowed ? "Allowed" : "Denied" }}
              </span>
              <button class="settings-perm-revoke" @click="revokePermission(p.domain, p.permission)">Revoke</button>
            </div>
          </div>
        </section>

        <!-- APPEARANCE -->
        <section v-else-if="activeTab === 'appearance'" class="settings-section">
          <h2 class="settings-section-title">Appearance</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>Accent color</span>
              <span class="settings-hint">Applied across the entire UI</span>
            </div>
            <div class="settings-colors">
              <button v-for="c in ACCENT_COLORS" :key="c"
                class="settings-color-dot" :class="{ active: settings.accentColor === c }"
                :style="{ background: c }"
                @click="onThemeChange(c, settings.themeMode)" />
              <label class="settings-color-custom" title="Custom color">
                <input type="color" :value="settings.accentColor || '#6366f1'"
                  @input="(e: Event) => onThemeChange((e.target as HTMLInputElement).value, settings.themeMode)"
                  style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;" />
                <span class="settings-color-dot" :class="{ active: accentIsCustom() }" :style="accentOtherStyle" />
              </label>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Theme</span>
              <span class="settings-hint">Dark or light mode</span>
            </div>
            <SettingsSelect :value="settings.themeMode" :options="THEME_OPTIONS" @change="(v: any) => onThemeChange(settings.accentColor, v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Compact mode</span>
              <span class="settings-hint">Auto-hide sidebar, reveal on hover</span>
            </div>
            <SettingsToggle :checked="settings.compactMode" @change="(v: boolean) => set('compactMode', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Show media controls</span>
              <span class="settings-hint">Display the mini player in the sidebar</span>
            </div>
            <SettingsToggle :checked="settings.showMediaControls" @change="(v: boolean) => set('showMediaControls', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Show domain only in URL bar</span>
              <span class="settings-hint">Hide the full path, show just the domain</span>
            </div>
            <SettingsToggle :checked="settings.showDomainOnly" @change="(v: boolean) => set('showDomainOnly', v)" />
          </div>
          <div class="settings-row">
            <div class="settings-label">
              <span>Show status bar</span>
              <span class="settings-hint">Show URL preview at the bottom when hovering links</span>
            </div>
            <SettingsToggle :checked="!settings.disableStatusBar" @change="(v: boolean) => set('disableStatusBar', !v)" />
          </div>
        </section>

        <!-- SYNC -->
        <section v-else-if="activeTab === 'sync'" class="settings-section">
          <h2 class="settings-section-title">Sync</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>Enable LAN sync</span>
              <span class="settings-hint">Sync bookmarks, history, and settings between devices on your local network</span>
            </div>
            <SettingsToggle :checked="settings.syncEnabled" @change="toggleSync" />
          </div>
          <template v-if="settings.syncEnabled && syncInfo">
            <div class="settings-row">
              <div class="settings-label">
                <span>Device name</span>
                <span class="settings-hint">How this device appears to others</span>
              </div>
              <input class="settings-input" :value="settings.syncDeviceName" @input="updateDeviceName" placeholder="My PC" :spellcheck="false" />
            </div>
            <div class="settings-row">
              <div class="settings-label">
                <span>Device fingerprint</span>
                <span class="settings-hint">Unique identifier for pairing verification</span>
              </div>
              <span class="settings-mono">{{ syncInfo.fingerprint || "—" }}</span>
            </div>
            <div class="settings-row">
              <div class="settings-label"><span>Status</span></div>
              <span class="settings-sync-status">{{ syncStatusText(syncInfo.status) }}</span>
            </div>
            <div v-if="syncInfo.peers.length > 0" class="settings-subsection">
              <h3 class="settings-subsection-title">Discovered Devices</h3>
              <div v-for="p in syncInfo.peers" :key="p.device_id" class="settings-peer-row">
                <div class="settings-peer-info">
                  <span class="settings-peer-name">{{ p.name || "Unknown" }}</span>
                  <span class="settings-peer-fp">{{ p.fingerprint }}</span>
                  <span class="settings-peer-addr">{{ p.addresses[0] }}:{{ p.port }}</span>
                </div>
                <button class="settings-about-btn" @click="startPair(p)">Pair</button>
              </div>
            </div>
            <div v-if="syncInfo.peers.length === 0" class="settings-row">
              <div class="settings-label">
                <span class="settings-hint" style="font-style:italic">
                  {{ syncLoading ? "Starting sync service..." : "Searching for devices on your network..." }}
                </span>
              </div>
            </div>
            <div v-if="syncInfo.paired_devices.length > 0" class="settings-subsection">
              <h3 class="settings-subsection-title">Paired Devices</h3>
              <div v-for="d in syncInfo.paired_devices" :key="d.device_id" class="settings-peer-row">
                <div class="settings-peer-info">
                  <span class="settings-peer-name">{{ d.name }}</span>
                  <span class="settings-peer-fp">{{ d.fingerprint }}</span>
                  <span class="settings-peer-addr">Paired {{ pairedDate(d.paired_at) }}</span>
                </div>
                <button class="settings-remove-btn" @click="removeDevice(d.device_id)">Remove</button>
              </div>
            </div>
            <div class="settings-subsection">
              <h3 class="settings-subsection-title">Data Types</h3>
              <div class="settings-row">
                <div class="settings-label">
                  <span>Sync bookmarks</span>
                  <span class="settings-hint">Share bookmarks and folders across devices</span>
                </div>
                <SettingsToggle :checked="syncTypes.bookmarks" @change="(v: boolean) => updateSyncType('bookmarks', v)" />
              </div>
              <div class="settings-row">
                <div class="settings-label">
                  <span>Sync history</span>
                  <span class="settings-hint">Share browsing history across devices</span>
                </div>
                <SettingsToggle :checked="syncTypes.history" @change="(v: boolean) => updateSyncType('history', v)" />
              </div>
              <div class="settings-row">
                <div class="settings-label">
                  <span>Sync settings</span>
                  <span class="settings-hint">Keep preferences consistent across devices</span>
                </div>
                <SettingsToggle :checked="syncTypes.settings" @change="(v: boolean) => updateSyncType('settings', v)" />
              </div>
              <div class="settings-row">
                <div class="settings-label">
                  <span>Sync open tabs</span>
                  <span class="settings-hint">See tabs open on your other devices</span>
                </div>
                <SettingsToggle :checked="syncTypes.tabs" @change="(v: boolean) => updateSyncType('tabs', v)" />
              </div>
            </div>
            <div class="settings-subsection">
              <h3 class="settings-subsection-title">Danger Zone</h3>
              <div class="settings-row">
                <div class="settings-label">
                  <span>Reset sync data</span>
                  <span class="settings-hint">Backs up current sync data and starts fresh. Bookmarks are preserved locally.</span>
                </div>
                <button class="settings-remove-btn" @click="resetSyncData">Reset</button>
              </div>
            </div>
            <div v-if="isDevMode()" class="settings-subsection">
              <h3 class="settings-subsection-title">Debug</h3>
              <div class="settings-row">
                <div class="settings-label">
                  <span>Loopback pairing test</span>
                  <span class="settings-hint">Spawn a fake device on localhost and run real SPAKE2 pairing</span>
                </div>
                <button class="settings-about-btn" @click="simulatePair">Simulate Peer</button>
              </div>
              <div v-if="simulateCode" class="settings-row">
                <div class="settings-label"><span>Enter this code when prompted</span></div>
                <span class="settings-mono" style="color:var(--accent);font-size:18px;letter-spacing:4px">{{ simulateCode }}</span>
              </div>
              <div class="settings-row">
                <div class="settings-label">
                  <span>Loopback sync test</span>
                  <span class="settings-hint">Pair a ghost device then sync 3 sample bookmarks over Noise + Loro</span>
                </div>
                <button class="settings-about-btn" @click="simulateSync">Simulate Sync</button>
              </div>
            </div>
          </template>
        </section>

        <!-- SHORTCUTS -->
        <section v-else-if="activeTab === 'shortcuts'" class="settings-section">
          <h2 class="settings-section-title">Keyboard Shortcuts</h2>
          <p class="settings-hint" style="margin-bottom:12px">
            Click a shortcut to rebind it. Press Escape to cancel.
          </p>
          <div class="settings-shortcuts">
            <div v-for="{ group, items } in SHORTCUT_GROUPS" :key="group">
              <div class="settings-shortcut-group">{{ group }}</div>
              <div v-for="{ action, desc } in items" :key="action"
                class="settings-shortcut-row settings-shortcut-rebindable"
                :class="{ recording: recordingAction === action }"
                @click="recordingAction = recordingAction === action ? null : action"
              >
                <span class="settings-shortcut-desc">{{ desc }}</span>
                <kbd class="settings-kbd" :class="{ recording: recordingAction === action }">
                  {{ recordingAction === action ? "Press keys..." : (settings.keybindings[action] || "Unset") }}
                </kbd>
              </div>
            </div>
            <div class="settings-shortcut-group">Workspaces</div>
            <div class="settings-shortcut-row">
              <span class="settings-shortcut-desc">Switch workspace</span>
              <kbd class="settings-kbd">Ctrl+1–9</kbd>
            </div>
          </div>
          <button v-if="!shortcutsIsDefault" class="settings-about-btn" style="margin-top:16px" @click="resetShortcutsToDefaults">
            Reset to defaults
          </button>
        </section>

        <!-- PASSWORDS -->
        <section v-else-if="activeTab === 'passwords'" class="settings-section">
          <h2 class="settings-section-title">Passwords</h2>

          <div v-if="!vaultHasMaster" class="settings-row" style="flex-direction:column;gap:8px;align-items:flex-start">
            <p style="opacity:0.6;font-size:13px">Set a master password to enable the vault.</p>
            <form @submit.prevent="onVaultSetupSubmit" style="display:flex;flex-direction:column;gap:8px;width:100%;max-width:300px">
              <input name="pw" type="password" placeholder="Master password" :minlength="8" required class="settings-input" />
              <input name="pw2" type="password" placeholder="Confirm" :minlength="8" required class="settings-input" />
              <button type="submit" class="settings-about-btn">Set Master Password</button>
            </form>
          </div>
          <div v-else-if="!vaultUnlocked" class="settings-row" style="flex-direction:column;gap:8px;align-items:flex-start">
            <p style="opacity:0.6;font-size:13px">Vault is locked. Enter your master password.</p>
            <form @submit.prevent="onVaultUnlockSubmit" style="display:flex;gap:8px;align-items:center">
              <input name="pw" type="password" placeholder="Master password" required class="settings-input" />
              <button type="submit" class="settings-about-btn">Unlock</button>
            </form>
          </div>
          <template v-else>
            <div class="settings-row" style="justify-content:space-between">
              <input type="text" placeholder="Search passwords..." v-model="vaultSearch" class="settings-input" style="max-width:300px" />
              <button class="settings-about-btn" @click="lockVault">Lock Vault</button>
            </div>
            <div class="vault-entries">
              <p v-if="filteredVault.length === 0" style="opacity:0.5;font-size:13px;padding:12px 0">
                No saved passwords{{ vaultSearch ? " matching search" : "" }}.
              </p>
              <div v-for="entry in filteredVault" :key="entry.id" class="vault-entry">
                <div class="vault-entry-domain">{{ entry.domain }}</div>
                <div class="vault-entry-user">{{ entry.username }}</div>
                <div class="vault-entry-pass">
                  <span>{{ vaultRevealId === entry.id ? entry.password : dotString(12) }}</span>
                  <button class="vault-entry-btn" @click="vaultRevealId = vaultRevealId === entry.id ? null : entry.id">
                    {{ vaultRevealId === entry.id ? "Hide" : "Show" }}
                  </button>
                  <button class="vault-entry-btn" @click="copyText(entry.password)">Copy</button>
                </div>
                <button class="vault-entry-btn danger" @click="deleteVaultEntry(entry.id)">Delete</button>
              </div>
            </div>
            <h2 class="settings-section-title" style="margin-top:24px">Password Generator</h2>
            <div class="settings-row" style="gap:12px;flex-wrap:wrap">
              <label style="font-size:13px">
                Length: {{ vaultGenLen }}
                <input type="range" min="8" max="64" v-model.number="vaultGenLen" style="margin-left:8px;vertical-align:middle" />
              </label>
              <button class="settings-about-btn" @click="generatePassword">Generate</button>
            </div>
            <div v-if="vaultGenResult" class="settings-row" style="gap:8px;margin-top:8px">
              <code class="vault-gen-result">{{ vaultGenResult }}</code>
              <button class="vault-entry-btn" @click="copyText(vaultGenResult)">Copy</button>
            </div>
          </template>

          <h2 class="settings-section-title" style="margin-top:24px">Vault Settings</h2>
          <div class="settings-row">
            <div class="settings-label">
              <span>Auto-lock vault</span>
              <span class="settings-hint">Lock the vault automatically when idle</span>
            </div>
            <SettingsToggle :checked="settings.vaultAutoLock" @change="(v: boolean) => set('vaultAutoLock', v)" />
          </div>
          <div v-if="settings.vaultAutoLock" class="settings-row">
            <div class="settings-label">
              <span>Lock timeout</span>
              <span class="settings-hint">Lock after this many minutes of inactivity (0 = on app close)</span>
            </div>
            <SettingsSelect :value="settings.vaultLockTimeout" :options="VAULT_TIMEOUT_OPTIONS" @change="(v: any) => set('vaultLockTimeout', v)" />
          </div>
        </section>

        <!-- ABOUT -->
        <section v-else-if="activeTab === 'about'" class="settings-section">
          <h2 class="settings-section-title">About</h2>
          <div class="settings-about">
            <div class="settings-about-name">Digidaw Space</div>
            <div class="settings-about-version">v{{ appVersion }}</div>
            <div class="settings-about-desc">A fast, private web browser with workspaces, split view, and LAN sync.</div>
            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
              <button class="settings-about-btn" @click="replayOnboarding">Replay Onboarding</button>
            </div>
            <div style="margin-top:20px;font-size:12px;opacity:0.5;line-height:1.8">
              <div>Built with Tauri, Vue, and WebView2</div>
              <div>Licensed under GPL-3.0</div>
              <div style="display:flex;gap:12px;margin-top:4px">
                <span style="color:var(--accent);cursor:pointer" @click="onOpenUrl('https://github.com/Dayuss/bushido')">GitHub</span>
                <span style="color:var(--accent);cursor:pointer" @click="onOpenUrl('https://github.com/Dayuss/bushido/issues')">Report a Bug</span>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>

    <PairingWizard
      v-if="pairingWizard"
      :mode="pairingWizard.mode"
      :peer-device-id="pairingWizard.peerDeviceId"
      :peer-device-name="pairingWizard.peerDeviceName"
      :code="pairingWizard.code"
      @close="pairingWizard = null"
    />
  </div>
</template>
