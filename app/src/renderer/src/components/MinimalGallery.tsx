import { Plus, Clock, Mic, FileText, Layout, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAppContext } from '../context/AppContext'
import type { Project } from '../../../shared/types'
import { SetupBanner } from './SetupBanner'

interface MinimalGalleryProps {
  onCreateNew: () => void
  onOpenProject?: (project: Project) => void
  onOpenSettings: () => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const stageLabel: Record<string, { icon: typeof Mic; text: string }> = {
  recording: { icon: Mic, text: '录制中' },
  editor: { icon: FileText, text: '编辑中' },
  canvas: { icon: Layout, text: '预览中' },
  done: { icon: Sparkles, text: '已完成' }
}

export function MinimalGallery({
  onCreateNew,
  onOpenProject,
  onOpenSettings
}: MinimalGalleryProps): React.JSX.Element {
  const { projects, refreshProjects } = useAppContext()
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const handleDelete = async (id: number): Promise<void> => {
    setDeletingId(id)
    const res = await window.api.projects.delete(id)
    setDeletingId(null)
    setConfirmingId(null)
    if (res.success) {
      await refreshProjects()
    }
  }

  return (
    <div className="size-full flex items-center justify-center p-16">
      <div className="w-full max-w-6xl">
        {/* 首次配置提示 */}
        <SetupBanner onOpenSettings={onOpenSettings} />

        {/* 头部 */}
        <div className="mb-16 text-center">
          <h1 className="text-5xl mb-3 tracking-tight">从想法到演示</h1>
          <p className="text-gray-500">说出你的故事，AI 自动生成演讲稿和 PPT</p>
        </div>

        {/* 创建按钮 */}
        <div className="mb-12 flex justify-center">
          <button
            onClick={onCreateNew}
            className="group flex items-center gap-3 px-6 py-4 bg-gray-900 text-white rounded-full hover:bg-gray-800 transition-all"
          >
            <Plus className="w-5 h-5" />
            <span>新建项目</span>
          </button>
        </div>

        {/* 项目网格 / 空状态 */}
        {projects.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-lg mb-2">还没有项目</p>
            <p className="text-gray-400 text-sm">点击上方按钮，开始你的第一次演示</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {projects.map((project, index) => {
              const stage = stageLabel[project.stage] ?? stageLabel.recording
              const StageIcon = stage.icon
              const isConfirming = confirmingId === project.id
              const isDeleting = deletingId === project.id
              return (
                <div
                  key={project.id}
                  className="group relative animate-in fade-in slide-in-from-bottom-2 duration-500"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <button
                    onClick={() => onOpenProject?.(project)}
                    disabled={isDeleting}
                    className="w-full text-left p-6 border border-gray-200 rounded-lg hover:border-gray-900 transition-all disabled:opacity-50"
                  >
                    {/* 顶部信息 */}
                    <div className="flex items-center justify-between mb-4 text-xs text-gray-400">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(project.updatedAt)}
                      </div>
                      <div className="flex items-center gap-1">
                        <StageIcon className="w-3 h-3" />
                        {stage.text}
                      </div>
                    </div>

                    {/* 标题 */}
                    <h3 className="text-base group-hover:text-gray-900 transition-colors pr-8">
                      {project.name}
                    </h3>
                  </button>

                  {/* 删除按钮 / 二次确认 */}
                  {isConfirming ? (
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-white border border-gray-200 rounded-full shadow-sm">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(project.id)
                        }}
                        disabled={isDeleting}
                        className="px-2.5 py-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        {isDeleting ? '删除中…' : '确认删除'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmingId(null)
                        }}
                        disabled={isDeleting}
                        className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700 disabled:opacity-50"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmingId(project.id)
                      }}
                      title="删除项目"
                      aria-label="删除项目"
                      className="absolute top-3 right-3 p-1.5 rounded-full text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
