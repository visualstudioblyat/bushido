import { create } from "zustand";
import { PermissionRequest } from "../types";

interface VaultState {
  vaultSavePrompt: { domain: string; username: string; password: string } | null;
  vaultMasterModal: "setup" | "unlock" | null;
  vaultUnlocked: boolean;
  permReq: PermissionRequest | null;
  permRemember: boolean;

  setVaultSavePrompt: (v: { domain: string; username: string; password: string } | null) => void;
  setVaultMasterModal: (v: "setup" | "unlock" | null) => void;
  setVaultUnlocked: (v: boolean) => void;
  setPermReq: (v: PermissionRequest | null) => void;
  setPermRemember: (v: boolean) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  vaultSavePrompt: null,
  vaultMasterModal: null,
  vaultUnlocked: false,
  permReq: null,
  permRemember: true,

  setVaultSavePrompt: (v) => set({ vaultSavePrompt: v }),
  setVaultMasterModal: (v) => set({ vaultMasterModal: v }),
  setVaultUnlocked: (v) => set({ vaultUnlocked: v }),
  setPermReq: (v) => set({ permReq: v }),
  setPermRemember: (v) => set({ permRemember: v }),
}));
