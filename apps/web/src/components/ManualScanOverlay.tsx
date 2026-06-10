import React, { useState, useRef, useEffect, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  X,
  Monitor,
  Laptop,
  Smartphone,
  Tablet,
  Plus,
  UserPlus,
  Check,
  Loader2,
  Search,
  Users,
  ChevronDown,
  Image as ImageIcon,
  Type,
  MousePointer2,
} from "lucide-react"
import { QAPage, QARun } from "../api/runs.api"
import { useCreateTask, useTasks } from "../hooks/useTasks"
import { useProject } from "../hooks/useProjects"
import { useCreateFinding, useUpdateFinding } from "../hooks/useRuns"
import { supabase } from "../lib/supabase"
import { useAuthAxios } from "../lib/useAuthAxios"
import toast from "react-hot-toast"
import { FreezeAndCrop } from "./FreezeAndCrop"

interface ManualScanOverlayProps {
  run: QARun
  isOpen: boolean
  onClose: () => void
  initialPageId?: string | null
}

const ISSUE_TYPES = [
  { id: "visual_diff", label: "Visual/Alignment", icon: ImageIcon },
  { id: "spelling", label: "Spelling/Content", icon: Type },
  { id: "performance", label: "Performance", icon: ImageIcon },
  { id: "functionality", label: "Functionality", icon: MousePointer2 },
]

type Viewport = "desktop" | "laptop" | "tablet" | "mobile"

export const ManualScanOverlay: React.FC<ManualScanOverlayProps> = ({
  run,
  isOpen,
  onClose,
  initialPageId,
}) => {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<Viewport>("desktop")
  const [isUploading, setIsUploading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [isPageDropdownOpen, setIsPageDropdownOpen] = useState(false)
  const [capturedImages, setCapturedImages] = useState<string[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [userSearchQuery, setUserSearchQuery] = useState("")

  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [severity, setSeverity] = useState<"critical" | "high" | "medium" | "low">("medium")
  const [checkFactor, setCheckFactor] = useState("visual_diff")

  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedPage = useMemo(
    () => run.pages?.find((p) => p.id === selectedPageId),
    [run.pages, selectedPageId],
  )

  const filteredPages = useMemo(
    () =>
      run.pages?.filter((p) =>
        p.url.toLowerCase().includes(searchQuery.toLowerCase()),
      ) || [],
    [run.pages, searchQuery],
  )

  const { mutateAsync: createTask } = useCreateTask()
  const { mutateAsync: createFinding } = useCreateFinding(selectedPageId)
  const { mutateAsync: updateFindingStatus } = useUpdateFinding(selectedPageId)
  const { data: project } = useProject(run.project_id)
  const { data: tasksData } = useTasks({ projectId: run.project_id })
  const axios = useAuthAxios()
  const queryClient = useQueryClient()

  const projectMembers = useMemo(() => project?.project_members || [], [project])
  const filteredMembers = useMemo(() => {
    if (!userSearchQuery) return projectMembers
    return projectMembers.filter(m => 
      m.users.full_name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      m.users.email.toLowerCase().includes(userSearchQuery.toLowerCase())
    )
  }, [projectMembers, userSearchQuery])

  useEffect(() => {
    if (isOpen) {
      if (initialPageId) {
        setSelectedPageId(initialPageId)
      } else if (run.pages?.length && !selectedPageId) {
        setSelectedPageId(run.pages[0].id)
      }
    }
  }, [isOpen, run.pages, selectedPageId, initialPageId])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsPageDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const uploadBase64 = async (base64: string): Promise<string | null> => {
    try {
      const response = await axios.post("/api/proxy-browser/upload-clip", {
        base64,
        findingId: `manual-${run.id}`,
      })
      return response.data?.imageUrl ?? null
    } catch (err: any) {
      console.error("Upload error:", err)
      toast.error("Failed to upload crop")
      return null
    }
  }

  const handleCreateTask = async () => {
    if (!title) {
      toast.error("Please add a title")
      return
    }
    if (capturedImages.length === 0) {
      toast.error("Please freeze and crop at least one area first")
      return
    }
    if (!selectedPageId) {
      toast.error("Please select a page")
      return
    }

    if (selectedUserIds.size === 0) {
      toast.error("Please select at least one developer")
      return
    }

    setIsUploading(true)
    try {
      const results = await Promise.all(capturedImages.map((b64) => uploadBase64(b64)))
      const uploadedGallery = results.filter(Boolean) as string[]
      if (uploadedGallery.length === 0) {
        toast.error("Failed to upload crops")
        return
      }

      // Calculate next issue number for the project
      const response = await axios.get(`/api/tasks/count/unique?project_id=${run.project_id}`);
      const nextIssueNum = response.data.count + 1;
      
      const displayTitle = `Issue #${nextIssueNum}: ${title}`
      const fullDescription = `${description}\n\nURL: ${selectedPage?.url || 'N/A'}\nCaptured via Manual Inspector`

      // Create and confirm finding silently to support Basecamp push grouping
      const newFinding = await createFinding({
        page_id: selectedPageId,
        run_id: run.id,
        check_factor: checkFactor,
        severity,
        title: displayTitle,
        description: fullDescription,
        screenshot_url: uploadedGallery[0],
        context_text: "Manual Scan",
        ai_generated: false
      })

      await updateFindingStatus({
        findingId: newFinding.id,
        data: { status: 'confirmed' }
      })

      const userIds = Array.from(selectedUserIds)
      for (const userId of userIds) {
        await createTask({
          project_id: run.project_id,
          finding_id: newFinding.id,
          title: displayTitle,
          description: fullDescription,
          severity,
          assigned_to: userId,
          status: "open",
          gallery_images: uploadedGallery,
        } as any)
      }

      toast.success(`Successfully created ${userIds.length} task(s)`)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['run-findings', run.id] })
      queryClient.invalidateQueries({ queryKey: ['findings', selectedPageId] })
      setTitle("")
      setDescription("")
      setCapturedImages([])
      setSelectedUserIds(new Set())
    } catch (err: any) {
      toast.error("Failed to create task")
    } finally {
      setIsUploading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 animate-in fade-in duration-300 overflow-hidden">
      {/* Floating Close Button */}
      <button
        onClick={onClose}
        className="fixed top-6 right-6 z-[70] p-2 bg-slate-50 border border-slate-200 shadow-sm hover:bg-slate-50 text-slate-400 hover:text-slate-900 rounded-sm transition-all"
      >
        <X size={20} />
      </button>

      <div className="absolute inset-0 flex overflow-hidden">
        {/* Main Viewport Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 relative">
          {/* Viewport Toggles & Page Selector */}
          <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 bg-slate-50 border border-slate-200 rounded-sm z-10 shadow-sm">
            {[
              { id: "desktop", icon: Monitor, label: "Desktop" },
              { id: "laptop", icon: Laptop, label: "Laptop" },
              { id: "tablet", icon: Tablet, label: "Tablet" },
              { id: "mobile", icon: Smartphone, label: "Mobile" },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setViewport(v.id as Viewport)
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all ${
                  viewport === v.id
                    ? "bg-black text-white"
                    : "text-slate-400 hover:bg-accent hover:text-black"
                }`}
              >
                <v.icon size={14} />
                {v.label}
              </button>
            ))}

            <div className="w-px h-4 bg-slate-200 mx-2" />

            {/* Page Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsPageDropdownOpen(!isPageDropdownOpen)}
                className="flex items-center gap-3 px-4 py-2 bg-slate-50 hover:bg-slate-50 text-black border-none rounded-sm transition-all group h-[30px]"
              >
                <div className="max-w-[200px] truncate text-left flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest truncate">
                    {selectedPage?.url || "Select Page"}
                  </span>
                </div>
                <ChevronDown
                  className={`transition-transform ${isPageDropdownOpen ? "rotate-180" : ""}`}
                  size={12}
                />
              </button>

              {isPageDropdownOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[400px] bg-slate-50 border border-slate-200 rounded-sm shadow-2xl overflow-hidden z-50 animate-in slide-in-from-top-2 duration-200">
                  <div className="p-3 border-b border-slate-100 bg-slate-50">
                    <div className="relative">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                        size={14}
                      />
                      <input
                        type="text"
                        placeholder="Search pages..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-sm py-2 pl-9 pr-4 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto py-2">
                    {filteredPages.map((page) => (
                      <button
                        key={page.id}
                        onClick={() => {
                          setSelectedPageId(page.id)
                          setIsPageDropdownOpen(false)
                        }}
                        className={`w-full px-4 py-3 flex flex-col gap-1 text-left hover:bg-slate-50 transition-colors ${selectedPageId === page.id ? "bg-slate-100 border-l-2 border-slate-900" : ""}`}
                      >
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {page.url}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {page.title || "No title"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Screenshot Container */}
          <div
            className="flex-1 overflow-auto p-20 flex justify-center items-start"
            ref={containerRef}
          >
            <div
              className="relative shadow-sm transition-all duration-500"
              style={{
                width:
                  viewport === "mobile"
                    ? "375px"
                    : viewport === "tablet"
                      ? "768px"
                      : "100%",
                maxWidth: viewport === "desktop" ? "1280px" : "none",
              }}
            >
              <div className="w-full aspect-video min-h-[600px]">
                <FreezeAndCrop
                  url={selectedPage?.url || ""}
                  viewport={viewport}
                  onCapture={(base64) => {
                    setCapturedImages((prev) => {
                      if (prev.length >= 3) {
                        toast.error("Max 3 crops per issue")
                        return prev
                      }
                      return [...prev, base64]
                    })
                  }}
                  onCancel={() => setCapturedImages([])}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Sidebar - Form & Staged Issues */}
      {capturedImages.length > 0 && (
        <div className="fixed right-6 top-20 bottom-6 w-[400px] bg-slate-50 border border-slate-200 rounded-sm shadow-2xl flex flex-col overflow-hidden z-[60] animate-in slide-in-from-right duration-300">
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* New Issue Form */}
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Plus className="text-slate-900" size={18} />
                  <h3 className="text-slate-900 font-bold uppercase tracking-widest text-xs">
                    Add New Issue
                  </h3>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                      Issue Title
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Broken image on header"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-sm px-4 py-3 text-xs text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-slate-400 transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                      Description
                    </label>
                    <textarea
                      placeholder="Describe the issue in detail..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full bg-slate-50 border border-slate-200 rounded-sm px-4 py-3 text-xs text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-slate-400 transition-all resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                        Severity
                      </label>
                      <select
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value as any)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-sm px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-slate-400 transition-all appearance-none cursor-pointer"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                        Type
                      </label>
                      <select
                        value={checkFactor}
                        onChange={(e) => setCheckFactor(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-sm px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-slate-400 transition-all appearance-none cursor-pointer"
                      >
                        {ISSUE_TYPES.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Developer Assignment */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                        Assign Developer(s)
                      </label>
                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
                        {selectedUserIds.size} selected
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <input
                        type="text"
                        placeholder="Search team members..."
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-sm py-2.5 pl-9 pr-4 text-xs text-slate-900 focus:outline-none focus:border-slate-400 transition-all"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-sm bg-slate-50 divide-y divide-slate-50">
                      {filteredMembers.length > 0 ? (
                        filteredMembers.map((member) => (
                          <button
                            key={member.user_id}
                            onClick={() => {
                              const newSet = new Set(selectedUserIds)
                              if (newSet.has(member.user_id)) newSet.delete(member.user_id)
                              else newSet.add(member.user_id)
                              setSelectedUserIds(newSet)
                            }}
                            className={`w-full flex items-center gap-3 p-2.5 hover:bg-slate-50 transition-colors ${selectedUserIds.has(member.user_id) ? "bg-slate-50" : ""}`}
                          >
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold transition-colors ${selectedUserIds.has(member.user_id) ? "bg-black text-white" : "bg-slate-100 text-slate-500"}`}>
                              {member.users.full_name.split(' ').map(n => n[0]).join('').toUpperCase()}
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <p className="text-xs font-bold text-slate-900 truncate leading-tight">{member.users.full_name}</p>
                              <p className="text-[9px] text-slate-400 truncate uppercase font-bold tracking-tight mt-0.5">{member.role.replace('_', ' ')}</p>
                            </div>
                            {selectedUserIds.has(member.user_id) && <Check size={14} className="text-black" />}
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-center">
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">No members found</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Captured crops gallery */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                        Crops ({capturedImages.length}/3)
                      </label>
                      <button
                        onClick={() => setCapturedImages([])}
                        className="text-[9px] font-bold text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex gap-2">
                      {capturedImages.map((img, i) => (
                        <div key={i} className="relative group">
                          <img
                            src={img}
                            className="w-20 h-14 object-cover rounded-sm border border-slate-200 bg-slate-100"
                            alt={`Crop ${i + 1}`}
                          />
                          <button
                            onClick={() => setCapturedImages((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={9} />
                          </button>
                        </div>
                      ))}
                      {capturedImages.length < 3 && (
                        <div className="w-20 h-14 rounded-sm border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300">
                          <Plus size={16} />
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleCreateTask}
                    disabled={isUploading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-black text-white text-[10px] font-bold uppercase tracking-widest rounded-sm hover:bg-accent hover:text-black transition-all disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {isUploading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <><Check size={14} /> Create Task</>
                    )}
                  </button>
                  <p className="text-[9px] text-slate-400 text-center uppercase font-bold tracking-tight px-4">
                    Freeze and crop areas, then create task
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
  )
}
