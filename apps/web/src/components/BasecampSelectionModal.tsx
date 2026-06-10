import { useState } from "react"
import { ExternalLink, Loader2, CheckCircle2, X } from "lucide-react"
import { useBasecampTodoLists, useBasecampTodos } from "../hooks/useBasecamp"

interface BasecampSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (todolistId: string, todoId?: string) => void
  isPushing: boolean
  projectId: string
  title?: string
  description?: string
}

export const BasecampSelectionModal = ({
  isOpen,
  onClose,
  onConfirm,
  isPushing,
  projectId,
  title = "Basecamp Destination",
  description = "Select where to push these tasks",
}: BasecampSelectionModalProps) => {
  const [selectedTodolistId, setSelectedTodolistId] = useState<string>("")
  const [selectedTodoId, setSelectedTodoId] = useState<string>("")

  const { data: todolists, isLoading: isLoadingLists } =
    useBasecampTodoLists(projectId)
  const { data: todos, isLoading: isLoadingTodos } = useBasecampTodos(
    projectId,
    selectedTodolistId,
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="absolute inset-0"
        onClick={() => !isPushing && onClose()}
      />
      <div className="relative w-full max-w-md bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-800 rounded-[12px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131d22]/50 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-lg tracking-tight">
              {title}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-0.5">
              {description}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isPushing}
            className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 ml-1">
                To-do List
              </label>
              <select
                value={selectedTodolistId}
                onChange={(e) => {
                  setSelectedTodolistId(e.target.value)
                  setSelectedTodoId("")
                }}
                disabled={isPushing || isLoadingLists}
                className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none transition-all disabled:opacity-50"
              >
                <option value="">Select a list...</option>
                {todolists?.map((list: any) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedTodolistId && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 ml-1">
                  Specific To-do (Optional)
                </label>
                <select
                  value={selectedTodoId}
                  onChange={(e) => setSelectedTodoId(e.target.value)}
                  disabled={isPushing || isLoadingTodos}
                  className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none transition-all disabled:opacity-50"
                >
                  <option value="">Create New / Use "QA Findings"</option>
                  {todos?.map((todo: any) => (
                    <option key={todo.id} value={todo.id}>
                      {todo.content}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() =>
                onConfirm(selectedTodolistId, selectedTodoId || undefined)
              }
              disabled={isPushing || !selectedTodolistId}
              className="w-full btn-unified flex items-center justify-center space-x-2 py-3"
            >
              {isPushing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Pushing to Basecamp...</span>
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4" />
                  <span>Confirm Push</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              disabled={isPushing}
              className="w-full py-2 text-xs font-bold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
