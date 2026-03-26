import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  team: any | null
  setToken: (token: string, team?: any) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      team: null,
      setToken: (token, team) => set({ token, team }),
      logout: () => set({ token: null, team: null }),
    }),
    {
      name: 'clawlens-auth',
    }
  )
)
