import { create } from "zustand"

interface AiResultsStore {
  aiResultsMap: Record<string, string>
  setAiResult: (findingId: string, resultText: string) => void
}

export const useAiResultsStore = create<AiResultsStore>((set) => ({
  aiResultsMap: {},
  setAiResult: (findingId, resultText) =>
    set((state) => ({
      aiResultsMap: { ...state.aiResultsMap, [findingId]: resultText },
    })),
}))
