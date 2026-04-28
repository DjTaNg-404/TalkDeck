import { useState, useCallback } from 'react'
import { MinimalDock } from './components/MinimalDock'
import { MinimalGallery } from './components/MinimalGallery'
import { MinimalRecording } from './components/MinimalRecording'
import { MinimalEditor } from './components/MinimalEditor'
import { MinimalPreview } from './components/MinimalPreview'
import { SettingsModal } from './components/SettingsModal'
import { useAppContext } from './context/AppContext'
import type { Project, ProjectStage } from '../../shared/types'

type ViewType = 'gallery' | 'recording' | 'editor' | 'canvas'

export default function App(): React.JSX.Element {
  const { currentProject, setCurrentProject, refreshProjects } = useAppContext()
  const [currentView, setCurrentView] = useState<ViewType>('gallery')
  const [currentStep, setCurrentStep] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 切换视图时同步更新项目阶段
  const changeView = useCallback(
    async (view: ViewType) => {
      setCurrentView(view)
      if (currentProject && view !== 'gallery') {
        const stage = view as ProjectStage
        await window.api.projects.updateStage(currentProject.id, stage)
        // 同步内存中的 currentProject 与 projects 列表，避免返回首页后卡片阶段陈旧
        setCurrentProject({ ...currentProject, stage })
        await refreshProjects()
      }
    },
    [currentProject, setCurrentProject, refreshProjects]
  )

  // 新建项目 → 进入录音
  const handleCreateNew = useCallback(async () => {
    const result = await window.api.projects.create()
    if (result.success && result.data) {
      setCurrentProject(result.data)
      await refreshProjects()
      setCurrentStep(0)
      setCurrentView('recording')
    }
  }, [setCurrentProject, refreshProjects])

  // 返回首页
  const handleBackToGallery = useCallback(() => {
    setCurrentProject(null)
    setCurrentView('gallery')
  }, [setCurrentProject])

  // 打开已有项目
  const handleOpenProject = useCallback(
    (project: Project) => {
      setCurrentProject(project)
      setCurrentView(project.stage as ViewType)
    },
    [setCurrentProject]
  )

  return (
    <div className="size-full bg-white text-gray-900 overflow-hidden">
      {/* 主舞台区域 */}
      <main className="size-full relative">
        <div key={currentView} className="size-full animate-in fade-in duration-300">
          {currentView === 'gallery' && (
            <MinimalGallery
              onCreateNew={handleCreateNew}
              onOpenProject={handleOpenProject}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
          {currentView === 'recording' && currentProject && (
            <MinimalRecording
              onComplete={() => changeView('editor')}
              currentStep={currentStep}
              onStepChange={setCurrentStep}
              projectId={currentProject.id}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
          {currentView === 'editor' && currentProject && (
            <MinimalEditor projectId={currentProject.id} onNext={() => changeView('canvas')} />
          )}
          {currentView === 'canvas' && currentProject && (
            <MinimalPreview
              projectId={currentProject.id}
              projectName={currentProject.name}
              onBackToEditor={() => changeView('editor')}
            />
          )}
        </div>
      </main>

      {/* 底部浮动 Dock 栏 */}
      <MinimalDock
        currentView={currentView}
        onViewChange={changeView}
        onBackToGallery={handleBackToGallery}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
