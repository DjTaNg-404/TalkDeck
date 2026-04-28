import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Project } from '../../../shared/types'

interface AppContextValue {
  projects: Project[]
  currentProject: Project | null
  setCurrentProject: (p: Project | null) => void
  refreshProjects: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)

  const refreshProjects = useCallback(async () => {
    const result = await window.api.projects.getAll()
    if (result.success && result.data) {
      setProjects(result.data)
    }
  }, [])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  return (
    <AppContext.Provider value={{ projects, currentProject, setCurrentProject, refreshProjects }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
