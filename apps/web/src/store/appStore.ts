import { create } from 'zustand'

export type Role = 'developer' | 'qa_engineer' | 'project_manager' | 'sub_admin' | 'admin' | 'super_admin';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  org_id: string;
}

interface Project {
  id: string
  name: string
  description?: string
}

interface AppState {
  user: User | null
  currentProject: Project | null
  basecampPeople: Record<number, { sgid: string; name: string }>
  setUser: (user: User | null) => void
  setCurrentProject: (project: Project | null) => void
  setBasecampPeople: (people: Record<number, { sgid: string; name: string }>) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  currentProject: null,
  basecampPeople: {},
  setUser: (user) => set({ user }),
  setCurrentProject: (project) => set({ currentProject: project }),
  setBasecampPeople: (people) => set({ basecampPeople: people }),
}))
