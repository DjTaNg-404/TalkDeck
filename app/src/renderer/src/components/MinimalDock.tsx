import { Home, Mic, FileText, Layout, Settings } from 'lucide-react'

interface MinimalDockProps {
  currentView: string
  onViewChange: (view: 'gallery' | 'recording' | 'editor' | 'canvas') => void | Promise<void>
  onBackToGallery?: () => void
  onOpenSettings?: () => void
}

export function MinimalDock({
  currentView,
  onViewChange,
  onBackToGallery,
  onOpenSettings
}: MinimalDockProps): React.JSX.Element {
  const dockItems = [
    { id: 'gallery', icon: Home, label: '项目' },
    { id: 'recording', icon: Mic, label: '录制' },
    { id: 'editor', icon: FileText, label: '编辑' },
    { id: 'canvas', icon: Layout, label: '预览' }
  ]

  return (
    <>
      {/* 顶部空白栏：给 macOS 红绿灯留空 + 窗口拖拽 */}
      <div
        className="fixed top-0 left-0 right-0 z-50 h-11"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* 第二行：Logo + 设置 */}
      <div className="fixed top-11 left-0 right-0 z-50 h-10 flex items-center justify-between px-6 pointer-events-none">
        <div className="text-sm font-medium text-gray-900 pointer-events-auto">讲城</div>
        <button
          onClick={onOpenSettings}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors pointer-events-auto"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* 底部极简 Dock */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
        <div className="bg-white border border-gray-200 rounded-full px-2 py-2 shadow-sm">
          <div className="flex items-center gap-1">
            {dockItems.map((item) => {
              const isGallery = currentView === 'gallery'
              const disabled = isGallery && item.id !== 'gallery'
              return (
                <button
                  key={item.id}
                  disabled={disabled}
                  onClick={() =>
                    item.id === 'gallery' && onBackToGallery
                      ? onBackToGallery()
                      : onViewChange(item.id as 'gallery' | 'recording' | 'editor' | 'canvas')
                  }
                  className={`group relative p-3 rounded-full transition-all ${
                    currentView === item.id
                      ? 'bg-gray-900 text-white'
                      : disabled
                        ? 'text-gray-200 cursor-not-allowed'
                        : 'text-gray-400 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  title={item.label}
                >
                  <item.icon className="w-5 h-5" />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
