import { create } from 'zustand';
import { QAFinding } from '../api/runs.api';

interface TaskStageState {
  stagedFindings: QAFinding[];
  isOpen: boolean;
  addToStage: (findings: QAFinding[]) => void;
  removeFromStage: (id: string) => void;
  updateStagedFinding: (id: string, updates: Partial<QAFinding>) => void;
  clearStage: () => void;
  setIsOpen: (isOpen: boolean) => void;
}

export const useTaskStageStore = create<TaskStageState>((set) => ({
  stagedFindings: [],
  isOpen: false,
  addToStage: (findings) => set((state) => {
    const existingIds = new Set(state.stagedFindings.map(f => f.id));
    const newFindings = findings.filter(f => !existingIds.has(f.id));
    return { 
      stagedFindings: [...state.stagedFindings, ...newFindings],
      isOpen: true
    };
  }),
  removeFromStage: (id) => set((state) => ({
    stagedFindings: state.stagedFindings.filter(f => f.id !== id),
    isOpen: state.stagedFindings.length > 1 ? state.isOpen : false
  })),
  updateStagedFinding: (id, updates) => set((state) => ({
    stagedFindings: state.stagedFindings.map(f => f.id === id ? { ...f, ...updates } : f)
  })),
  clearStage: () => set({ stagedFindings: [], isOpen: false }),
  setIsOpen: (isOpen) => set({ isOpen })
}));
