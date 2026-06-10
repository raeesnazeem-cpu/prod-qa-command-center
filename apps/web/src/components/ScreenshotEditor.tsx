import React, { useState, useRef, useEffect, useLayoutEffect } from "react"
import {
  X,
  Check,
  Square,
  ArrowUpRight,
  Type,
  MousePointer2,
  Trash2,
  Plus,
  Loader2,
} from "lucide-react"
import { useAuthAxios } from "../lib/useAuthAxios"

interface Annotation {
  id: string
  type: "rect" | "arrow" | "text"
  x: number
  y: number
  width?: number
  height?: number
  text?: string
  color: string
}

interface ScreenshotEditorProps {
  imageUrl: string
  onClose: () => void
  onSave: (clips: string[]) => void
  maxClips: number
  findingId?: string
}

export const ScreenshotEditor: React.FC<ScreenshotEditorProps> = ({
  imageUrl,
  onClose,
  onSave,
  maxClips,
  findingId,
}) => {
  const axios = useAuthAxios()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<"select" | "rect" | "arrow" | "text">(
    "select",
  )
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [currentAnnotation, setCurrentAnnotation] =
    useState<Partial<Annotation> | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [selection, setSelection] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [clips, setClips] = useState<string[]>([])
  const [zoom, setZoom] = useState(1)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedColor, setSelectedColor] = useState("#ef4444")
  const [activeTextId, setActiveTextId] = useState<string | null>(null)
  const [textInput, setTextInput] = useState("")
  const [typingPos, setTypingPos] = useState<{ x: number; y: number } | null>(
    null,
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    if (activeTextId && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [activeTextId])

  const finishText = () => {
    if (!activeTextId) {
      setTypingPos(null)
      return
    }
    const text = textInput.trim()
    if (text === "") {
      setAnnotations((prev) => prev.filter((a) => a.id !== activeTextId))
    } else {
      setAnnotations((prev) =>
        prev.map((a) => (a.id === activeTextId ? { ...a, text } : a)),
      )
    }
    setActiveTextId(null)
    setTypingPos(null)
    setTextInput("")
  }

  const finishTextRef = useRef(finishText)
  finishTextRef.current = finishText

  useEffect(() => {
    if (!activeTextId) return
    const handler = (e: MouseEvent) => {
      if (!textareaRef.current?.contains(e.target as Node)) {
        finishTextRef.current()
      }
    }
    const timerId = setTimeout(() => {
      document.addEventListener("mousedown", handler)
    }, 0)
    return () => {
      clearTimeout(timerId)
      document.removeEventListener("mousedown", handler)
    }
  }, [activeTextId])

  useEffect(() => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.src = imageUrl
    image.onload = () => {
      setImg(image)
      // Initial selection: middle 400x400 or something reasonable
      setSelection({ x: 100, y: 100, w: 800, h: 600 })
    }
  }, [imageUrl])

  const drawCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    canvas.width = img.width
    canvas.height = img.height

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)

    // Draw annotations
    annotations.forEach((ann) => {
      if (ann.id !== activeTextId) {
        drawAnnotation(ctx, ann)
      }
    })
    if (currentAnnotation && isDrawing) {
      drawAnnotation(ctx, currentAnnotation as Annotation)
    }

    // Draw selection overlay
    if (selection) {
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 4 / zoom
      ctx.setLineDash([10, 5])
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h)
      ctx.setLineDash([])

      // Darken outside
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)"
      ctx.beginPath()
      ctx.rect(0, 0, canvas.width, canvas.height)
      ctx.rect(selection.x, selection.y, selection.w, selection.h)
      ctx.fill("evenodd")
    }
  }

  const drawAnnotation = (ctx: CanvasRenderingContext2D, ann: Annotation) => {
    ctx.strokeStyle = ann.color
    ctx.fillStyle = ann.color
    ctx.lineWidth = 5

    if (ann.type === "rect" && ann.width && ann.height) {
      ctx.strokeRect(ann.x, ann.y, ann.width, ann.height)
    } else if (ann.type === "arrow" && ann.width && ann.height) {
      const headlen = 20
      const tox = ann.x + ann.width
      const toy = ann.y + ann.height
      const angle = Math.atan2(ann.height, ann.width)
      ctx.beginPath()
      ctx.moveTo(ann.x, ann.y)
      ctx.lineTo(tox, toy)
      ctx.lineTo(
        tox - headlen * Math.cos(angle - Math.PI / 6),
        toy - headlen * Math.sin(angle - Math.PI / 6),
      )
      ctx.moveTo(tox, toy)
      ctx.lineTo(
        tox - headlen * Math.cos(angle + Math.PI / 6),
        toy - headlen * Math.sin(angle + Math.PI / 6),
      )
      ctx.stroke()
    } else if (ann.type === "text" && ann.text) {
      ctx.font = "bold 24px Outfit, sans-serif"
      ctx.textBaseline = "top"
      ctx.fillText(ann.text, ann.x, ann.y)
    }
  }

  useEffect(() => {
    drawCanvas()
  }, [img, annotations, currentAnnotation, selection, zoom])

  const getMousePos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTextId) {
      finishText()
    }

    const pos = getMousePos(e)

    if (tool === "text") {
      const id = Math.random().toString(36).substr(2, 9)
      const newAnn: Annotation = {
        id,
        type: "text",
        x: pos.x,
        y: pos.y,
        text: "",
        color: selectedColor,
      }
      setAnnotations((prev) => [...prev, newAnn])
      setActiveTextId(id)
      const rect = canvasRef.current!.getBoundingClientRect()
      setTypingPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      setTextInput("")
      return
    }

    setIsDrawing(true)

    if (tool === "select") {
      setSelection({ x: pos.x, y: pos.y, w: 0, h: 0 })
    } else {
      setCurrentAnnotation({
        id: Math.random().toString(36).substr(2, 9),
        type: tool,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color: selectedColor,
      })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return
    const pos = getMousePos(e)

    if (tool === "select" && selection) {
      setSelection({
        ...selection,
        w: pos.x - selection.x,
        h: pos.y - selection.y,
      })
    } else if (currentAnnotation) {
      setCurrentAnnotation({
        ...currentAnnotation,
        width: pos.x - currentAnnotation.x!,
        height: pos.y - currentAnnotation.y!,
      })
    }
  }

  const handleMouseUp = () => {
    setIsDrawing(false)
    if (currentAnnotation && currentAnnotation.width !== 0) {
      setAnnotations((prev) => [...prev, currentAnnotation as Annotation])
    }
    setCurrentAnnotation(null)
  }

  const handleCaptureClip = async () => {
    if (!canvasRef.current || !selection || isUploading) return
    setIsUploading(true)
    try {
      const tempCanvas = document.createElement("canvas")
      tempCanvas.width = Math.abs(selection.w)
      tempCanvas.height = Math.abs(selection.h)
      const tempCtx = tempCanvas.getContext("2d")
      if (!tempCtx) return

      // Draw the image + annotations within the selection
      const sourceX = selection.w > 0 ? selection.x : selection.x + selection.w
      const sourceY = selection.h > 0 ? selection.y : selection.y + selection.h

      tempCtx.drawImage(
        canvasRef.current,
        sourceX,
        sourceY,
        Math.abs(selection.w),
        Math.abs(selection.h),
        0,
        0,
        Math.abs(selection.w),
        Math.abs(selection.h),
      )

      const base64 = tempCanvas.toDataURL("image/jpeg", 0.9)

      // Upload to API
      const response = await axios.post("/api/proxy-browser/upload-clip", {
        base64,
        findingId,
      })

      if (response.data?.imageUrl) {
        const clipUrl = response.data.imageUrl
        setClips([...clips, clipUrl])

        if (clips.length + 1 >= maxClips) {
          onSave([...clips, clipUrl])
        }
      }
    } catch (err) {
      console.error("[ScreenshotEditor] Upload failed:", err)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900 flex flex-col animate-in fade-in zoom-in-95 duration-300">
      {/* Editor Header */}
      <div className="h-16 bg-slate-50 border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-widest leading-none">
              Annotation Tool
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
              Select area and highlight issues
            </p>
          </div>

          <div className="h-8 w-px bg-slate-200" />

          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
            <ToolButton
              active={tool === "select"}
              onClick={() => setTool("select")}
              icon={<MousePointer2 size={16} />}
              label="Select Area"
            />
            <ToolButton
              active={tool === "rect"}
              onClick={() => setTool("rect")}
              icon={<Square size={16} />}
              label="Box"
            />
            <ToolButton
              active={tool === "arrow"}
              onClick={() => setTool("arrow")}
              icon={<ArrowUpRight size={16} />}
              label="Arrow"
            />
            <ToolButton
              active={tool === "text"}
              onClick={() => setTool("text")}
              icon={<Type size={16} />}
              label="Text"
            />
          </div>

          <div className="h-8 w-px bg-slate-200" />

          <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1.5">
            {[
              "#ef4444",
              "#3b82f6",
              "#22c55e",
              "#eab308",
              "#000000",
              "#ffffff",
            ].map((c) => (
              <button
                key={c}
                onClick={() => setSelectedColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${
                  selectedColor === c
                    ? "border-white ring-2 ring-blue-500 scale-110 shadow-sm"
                    : "border-transparent opacity-50 hover:opacity-100"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>

          <button
            onClick={() => setAnnotations([])}
            className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-lg transition-all"
            title="Clear Annotations"
          >
            <Trash2 size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right mr-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase">
              Clips Ready
            </p>
            <p className="text-xs font-bold text-slate-900">
              {clips.length} / {maxClips}
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-900 uppercase tracking-widest transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCaptureClip}
            disabled={!selection || clips.length >= maxClips || isUploading}
            className="btn-unified flex items-center gap-2 px-6 py-2 bg-black text-white rounded-md hover:bg-accent hover:text-black transition-all active:scale-95 disabled:opacity-30"
          >
            {isUploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {isUploading ? "Uploading..." : "Capture Clip"}
            </span>
          </button>
          <button
            onClick={() => onSave(clips)}
            disabled={clips.length === 0}
            className="btn-unified flex items-center gap-2 px-6 py-2 bg-black text-white rounded-md hover:bg-accent hover:text-black transition-all active:scale-95 disabled:opacity-30"
          >
            <Check size={16} />
            <span className="text-[10px] font-bold uppercase tracking-widest">
              Finish & Save
            </span>
          </button>
        </div>
      </div>

      {/* Editor Canvas Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-slate-200 p-12 flex items-start justify-center"
      >
        <div
          className="relative shadow-[0_32px_64px_rgba(0,0,0,0.2)] bg-slate-50 transition-transform duration-200"
          style={{
            width: img?.width,
            height: img?.height,
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
          }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="cursor-crosshair block"
          />
          {activeTextId && typingPos && (
            <textarea
              ref={textareaRef}
              className="absolute bg-slate-50 border-2 border-slate-600 shadow-2xl p-2 m-0 resize-none font-bold overflow-hidden rounded-lg outline-none text-slate-900 ring-4 ring-slate-500/20"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Type here..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  finishText()
                }
              }}
              style={{
                left: `${typingPos.x}px`,
                top: `${typingPos.y}px`,
                color: selectedColor,
                fontSize: "24px",
                fontFamily: "Outfit, sans-serif",
                minWidth: "250px",
                height: "auto",
                minHeight: "48px",
                lineHeight: "24px",
                zIndex: 1000,
                pointerEvents: "auto",
              }}
            />
          )}
        </div>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-8 right-8 flex items-center bg-slate-50/80 backdrop-blur-md border border-white shadow-xl rounded-md p-2 gap-2">
        <button
          onClick={() => setZoom(Math.max(0.1, zoom - 0.1))}
          className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-xl transition-all"
        >
          <X className="rotate-45" size={16} />
        </button>
        <span className="text-[10px] font-bold text-slate-900 w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(Math.min(2, zoom + 0.1))}
          className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-xl transition-all"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

const ToolButton: React.FC<{
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
      active
        ? "bg-slate-50 shadow-sm text-blue-600"
        : "text-slate-400 hover:text-slate-600"
    }`}
  >
    {icon}
    <span className="text-[10px] font-bold uppercase tracking-widest">
      {label}
    </span>
  </button>
)
