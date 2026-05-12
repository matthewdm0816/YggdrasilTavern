import { create } from "zustand";

type AppState = {
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
};

export const useAppStore = create<AppState>((set) => ({
  selectedSessionId: null,
  setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId })
}));
