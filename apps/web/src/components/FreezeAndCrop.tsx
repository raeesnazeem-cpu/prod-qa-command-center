import React, { useState, useRef, useEffect, useLayoutEffect } from "react"
import {
  Camera,
  Check,
  X,
  Loader2,
  Scan,
  Square,
  ArrowUpRight,
  Type,
  MousePointer2,
  Trash2,
} from "lucide-react"
import { useAuthAxios } from "../lib/useAuthAxios"
import toast from "react-hot-toast"
import html2canvas from "html2canvas"

interface FreezeAndCropProps {
  url: string
  onCapture: (base64: string) => void
  onCancel: () => void
  viewport: "desktop" | "laptop" | "tablet" | "mobile"
}

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

export const FreezeAndCrop: React.FC<FreezeAndCropProps> = ({
  url,
  onCapture,
  onCancel,
  viewport,
}) => {
  const axios = useAuthAxios()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [iframeUrl, setIframeUrl] = useState<string>("")
  const [isFrozen, setIsFrozen] = useState(false)
  const [snapshotImg, setSnapshotImg] = useState<HTMLImageElement | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingProxy, setIsLoadingProxy] = useState(false)

  // Canvas annotation state
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
  const [selectedColor, setSelectedColor] = useState("#ef4444")
  const [activeTextId, setActiveTextId] = useState<string | null>(null)
  const [textInput, setTextInput] = useState("")
  const [typingPos, setTypingPos] = useState<{ x: number; y: number } | null>(
    null,
  )

  // Load proxied content into iframe
  useEffect(() => {
    const loadProxy = async () => {
      if (!url) return
      setIsLoadingProxy(true)
      try {
        let response
        const cloudflareProxy = import.meta.env.VITE_CLOUDFLARE_PROXY_URL
        if (cloudflareProxy) {
          response = await axios.get(
            `${cloudflareProxy}/?url=${encodeURIComponent(url)}`,
            { responseType: "blob" },
          )
        } else {
          response = await axios.post(
            "/api/proxy-browser",
            { url },
            { responseType: "blob" },
          )
        }

        const blob = new Blob([response.data], { type: "text/html" })
        const dataUrl = URL.createObjectURL(blob)
        setIframeUrl(dataUrl)
      } catch (err) {
        console.error("Failed to load proxy in FreezeAndCrop:", err)
      } finally {
        setIsLoadingProxy(false)
      }
    }
    loadProxy()
    return () => {
      if (iframeUrl) URL.revokeObjectURL(iframeUrl)
    }
  }, [url])

  // Text focus
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
      if (!textareaRef.current?.contains(e.target as Node))
        finishTextRef.current()
    }
    const t = setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    )
    return () => {
      clearTimeout(t)
      document.removeEventListener("mousedown", handler)
    }
  }, [activeTextId])

  // Canvas draw
  const drawCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas || !snapshotImg) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    canvas.width = snapshotImg.naturalWidth
    canvas.height = snapshotImg.naturalHeight

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(snapshotImg, 0, 0)

    annotations.forEach((ann) => {
      if (ann.id !== activeTextId) drawAnnotation(ctx, ann)
    })
    if (currentAnnotation && isDrawing)
      drawAnnotation(ctx, currentAnnotation as Annotation)

    if (selection) {
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 3
      ctx.setLineDash([10, 5])
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h)
      ctx.setLineDash([])
      ctx.fillStyle = "rgba(0,0,0,0.35)"
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
  }, [snapshotImg, annotations, currentAnnotation, selection, isDrawing])

  const getMousePos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTextId) {
      finishText()
      return
    }
    const pos = getMousePos(e)
    if (tool === "text") {
      const id = Math.random().toString(36).substr(2, 9)
      setAnnotations((prev) => [
        ...prev,
        {
          id,
          type: "text",
          x: pos.x,
          y: pos.y,
          text: "",
          color: selectedColor,
        },
      ])
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

  // Freeze: call backend, load snapshot into Image
  // const handleFreeze = async () => {
  //   if (!url) return
  //   setIsProcessing(true)
  //   try {
  //     const resolutions = {
  //       desktop: { width: 1920, height: 1080 },
  //       laptop: { width: 1366, height: 768 },
  //       tablet: { width: 768, height: 1024 },
  //       mobile: { width: 375, height: 667 },
  //     }
  //     const res = resolutions[viewport]
  //     const response = await axios.post("/api/proxy-browser/capture", {
  //       url,
  //       fullPage: true,
  //       viewportWidth: res.width,
  //       viewportHeight: res.height,
  //     })
  //     if (response.data?.imageUrl) {
  //       const img = new Image()
  //       img.crossOrigin = "anonymous"
  //       img.src = response.data.imageUrl
  //       img.onload = () => {
  //         setSnapshotImg(img)
  //         setIsFrozen(true)
  //         setAnnotations([])
  //         setSelection(null)
  //         setTool("select")
  //       }
  //       img.onerror = () => {
  //         toast.error("Failed to load captured snapshot image")
  //       }
  //     } else {
  //       toast.error("Freeze failed: no image returned from API")
  //     }
  //   } catch (err: any) {
  //     console.error("Failed to freeze view using API:", err)
  //     toast.error(
  //       `Freeze failed: ${err?.response?.data?.error || err.message || "Unknown error"}`,
  //     )
  //   } finally {
  //     setIsProcessing(false)
  //   }
  // }

  // Freeze: call backend, load snapshot into Image
  const handleFreeze = async () => {
    if (!url) return
    setIsProcessing(true)

    const fallbackToPlaywright = async () => {
      try {
        const resolutions = {
          desktop: { width: 1920, height: 1080 },
          laptop: { width: 1366, height: 768 },
          tablet: { width: 768, height: 1024 },
          mobile: { width: 375, height: 667 },
        }
        const res = resolutions[viewport]
        const response = await axios.post("/api/proxy-browser/capture", {
          url,
          fullPage: true,
          viewportWidth: res.width,
          viewportHeight: res.height,
        })
        if (response.data?.imageUrl) {
          const img = new Image()
          img.crossOrigin = "anonymous"
          img.src = response.data.imageUrl
          img.onload = () => {
            setSnapshotImg(img)
            setIsFrozen(true)
            setAnnotations([])
            setSelection(null)
            setTool("select")
          }
          img.onerror = () => {
            toast.error("Failed to load captured snapshot image")
          }
        } else {
          toast.error("Freeze failed: no image returned from API")
        }
      } catch (err: any) {
        console.error("Failed to freeze view using API:", err)
        toast.error(
          `Freeze failed: ${err?.response?.data?.error || err.message || "Unknown error"}`,
        )
      } finally {
        setIsProcessing(false)
      }
    }

    const iframe = iframeRef.current
    if (iframe?.contentDocument?.body) {
      try {
        const canvas = await html2canvas(iframe.contentDocument.body, {
          useCORS: true,
          allowTaint: false,
          proxy: import.meta.env.VITE_CLOUDFLARE_PROXY_URL,
          scale: 1,
          width: iframe.contentDocument.body.scrollWidth,
          height: iframe.contentDocument.body.scrollHeight,
          windowWidth: iframe.contentDocument.body.scrollWidth,
          windowHeight: iframe.contentDocument.body.scrollHeight,
        })
        const img = new Image()
        img.src = canvas.toDataURL("image/png")
        img.onload = () => {
          setSnapshotImg(img)
          setIsFrozen(true)
          setAnnotations([])
          setSelection(null)
          setTool("select")
          setIsProcessing(false)
        }
        img.onerror = () => {
          toast.error("Client-side capture failed, trying server...")
          fallbackToPlaywright()
        }
        return // Exit early so we don't run Playwright if this succeeded
      } catch (clientErr) {
        console.warn(
          "[FreezeAndCrop] Client-side capture failed, falling back to Playwright:",
          clientErr,
        )
      }
    }

    // If html2canvas failed or iframe wasn't ready, automatically fallback to Playwright
    await fallbackToPlaywright()
  }

  // Confirm: crop the selection from canvas (with annotations baked in)
  const handleConfirm = () => {
    if (!canvasRef.current || !selection) return

    const sourceX = selection.w > 0 ? selection.x : selection.x + selection.w
    const sourceY = selection.h > 0 ? selection.y : selection.y + selection.h
    const sourceW = Math.abs(selection.w)
    const sourceH = Math.abs(selection.h)

    if (sourceW < 5 || sourceH < 5) {
      toast.error("Selection too small. Draw a larger area.")
      return
    }

    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = sourceW
    tempCanvas.height = sourceH
    const tempCtx = tempCanvas.getContext("2d")
    if (!tempCtx) return

    tempCtx.drawImage(
      canvasRef.current,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      0,
      0,
      sourceW,
      sourceH,
    )
    const base64 = tempCanvas.toDataURL("image/png")
    onCapture(base64)

    // Clear only the selection — stay frozen so user can crop more areas
    setSelection(null)
  }

  const handleCancelFreeze = () => {
    setIsFrozen(false)
    setSnapshotImg(null)
    setAnnotations([])
    setSelection(null)
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-900 dark:bg-[#131d22] rounded-sm overflow-hidden border border-slate-200 dark:border-slate-700">
      {/* Controls Header */}
      <div className="h-12 bg-slate-50 dark:bg-[#1d2a31] border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${isFrozen ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`}
          />
          <span className="text-[10px] font-bold text-slate-900 dark:text-white uppercase tracking-widest">
            {isFrozen ? "Frozen — Annotate & Crop" : "Live Browser"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!isFrozen ? (
            <button
              onClick={handleFreeze}
              disabled={isProcessing || isLoadingProxy}
              className="flex items-center gap-2 px-4 py-1.5 bg-black text-white rounded-sm hover:bg-accent hover:text-black transition-all disabled:opacity-30"
            >
              {isProcessing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Camera size={14} />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest">
                Freeze View
              </span>
            </button>
          ) : (
            <>
              <button
                onClick={handleCancelFreeze}
                className="flex items-center gap-2 px-4 py-1.5 bg-slate-100 dark:bg-[#131d22] text-slate-600 dark:text-slate-300 rounded-sm hover:bg-slate-200 dark:hover:bg-[#1d2a31] transition-all"
              >
                <X size={14} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Unfreeze
                </span>
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selection || Math.abs(selection.w) < 5}
                className="flex items-center gap-2 px-4 py-1.5 bg-accent text-black rounded-sm hover:bg-black hover:text-white transition-all disabled:opacity-30"
              >
                <Check size={14} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Confirm Crop
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Annotation Toolbar — separate bar, only shown when frozen, never overlaps canvas */}
      {isFrozen && (
        <div className="shrink-0 bg-slate-50 dark:bg-[#1d2a31] border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 px-4 py-2">
          <div className="flex items-center bg-slate-100 dark:bg-[#131d22] rounded-lg p-0.5 gap-0.5">
            {[
              {
                id: "select",
                icon: <MousePointer2 size={13} />,
                label: "Crop",
              },
              { id: "rect", icon: <Square size={13} />, label: "Box" },
              { id: "arrow", icon: <ArrowUpRight size={13} />, label: "Arrow" },
              { id: "text", icon: <Type size={13} />, label: "Text" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all text-[9px] font-bold uppercase tracking-widest ${
                  tool === t.id
                    ? "bg-slate-50 dark:bg-[#1d2a31] shadow-sm text-blue-600 dark:text-blue-400"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

          <div className="flex items-center gap-1">
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
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  selectedColor === c
                    ? "border-blue-500 scale-110"
                    : "border-transparent opacity-50 hover:opacity-100"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

          <button
            onClick={() => setAnnotations([])}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#1d2a31] text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-md transition-all"
            title="Clear annotations"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 relative bg-slate-100 dark:bg-[#131d22] overflow-auto">
        {isLoadingProxy && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-50/80 dark:bg-[#131d22]/80 backdrop-blur-sm">
            <Loader2 className="w-8 h-8 text-accent animate-spin mb-2" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Loading Live Page...
            </p>
          </div>
        )}

        {isProcessing && !isFrozen && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <Loader2 className="w-10 h-10 text-white animate-spin mb-3" />
            <p className="text-sm font-bold text-white uppercase tracking-widest">
              Capturing full page...
            </p>
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-1">
              This may take ~15 seconds
            </p>
          </div>
        )}

        {!isFrozen ? (
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            className="w-full h-full border-none bg-slate-50 dark:bg-[#131d22]"
            title="Live Proxy"
          />
        ) : (
          <div className="relative w-full flex justify-center p-4">
            <div className="relative inline-block shadow-2xl">
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                className={`block max-w-full ${tool === "select" ? "cursor-crosshair" : tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
                style={{ maxWidth: "100%" }}
              />

              {/* Text input overlay */}
              {activeTextId && typingPos && (
                <textarea
                  ref={textareaRef}
                  className="absolute bg-slate-50 dark:bg-[#1d2a31] border-2 border-blue-600 shadow-2xl p-2 resize-none font-bold overflow-hidden rounded-lg outline-none text-slate-900 dark:text-white ring-4 ring-blue-500/20"
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
                    minWidth: "200px",
                    minHeight: "48px",
                    lineHeight: "24px",
                    zIndex: 1000,
                    pointerEvents: "auto",
                  }}
                />
              )}

              {/* Selection hint when no selection drawn yet */}
              {!selection && tool === "select" && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="bg-black/60 backdrop-blur-sm px-6 py-4 rounded-xl border border-white/10 flex flex-col items-center gap-3">
                    <Scan className="text-accent animate-pulse" size={32} />
                    <p className="text-xs font-bold text-white uppercase tracking-widest text-center">
                      Draw a box to select crop area
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
