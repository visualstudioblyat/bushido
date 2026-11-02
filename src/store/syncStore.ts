import { create } from "zustand";

interface SyncState {
  syncToast: "syncing" | "success" | "error" | null;
  syncTabReceived: { from_device: string; url: string; title: string } | null;
  syncPairedDevices: { device_id: string; name: string }[];

  setSyncToast: (v: "syncing" | "success" | "error" | null) => void;
  setSyncTabReceived: (v: { from_device: string; url: string; title: string } | null) => void;
  setSyncPairedDevices: (v: { device_id: string; name: string }[]) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  syncToast: null,
  syncTabReceived: null,
  syncPairedDevices: [],

  setSyncToast: (v) => set({ syncToast: v }),
  setSyncTabReceived: (v) => set({ syncTabReceived: v }),
  setSyncPairedDevices: (v) => set({ syncPairedDevices: v }),
}));
