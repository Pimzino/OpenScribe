import { create } from "zustand";

interface SettingsPanelState {
    panelOpen: boolean;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>((set) => ({
    panelOpen: false,
    openPanel: () => set({ panelOpen: true }),
    closePanel: () => set({ panelOpen: false }),
    togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
}));
