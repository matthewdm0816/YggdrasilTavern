import { create } from "zustand";

type AppState = {
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  drafts: Record<string, string>;
  setDraft: (sessionId: string, value: string) => void;
  edits: Record<string, { messageId: string; value: string } | undefined>;
  setEdit: (sessionId: string, edit?: { messageId: string; value: string }) => void;
};

export const useAppStore = create<AppState>((set) => ({
  selectedSessionId: null,
  setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId }),
  drafts: {},
  setDraft: (sessionId, value) => set((state) => ({ drafts: { ...state.drafts, [sessionId]: value } })),
  edits: {},
  setEdit: (sessionId, edit) => set((state) => ({ edits: { ...state.edits, [sessionId]: edit } }))
}));
