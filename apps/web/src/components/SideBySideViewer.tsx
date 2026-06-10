import React, { useRef, useEffect, useState } from "react"
import { Maximize2, Minimize2, ZoomIn, ZoomOut, Move } from "lucide-react"

interface SideBySideViewerProps {
  figmaUrl: string
  siteUrl: string
}

export const SideBySideViewer: React.FC<SideBySideViewerProps> = ({
  figmaUrl,
  siteUrl,
}) => {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [sliderPos, setSliderPos] = useState(50)
  const [viewMode, setViewMode] = useState<"side-by-side" | "split">(
    "side-by-side",
  )

  // Synchronized scroll
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const handleLeftScroll = () => {
      if (viewMode === "side-by-side") {
        right.scrollTop = left.scrollTop
        right.scrollLeft = left.scrollLeft
      }
    }

    const handleRightScroll = () => {
      if (viewMode === "side-by-side") {
        left.scrollTop = right.scrollTop
        left.scrollLeft = right.scrollLeft
      }
    }

    left.addEventListener("scroll", handleLeftScroll)
    right.addEventListener("scroll", handleRightScroll)

    return () => {
      left.removeEventListener("scroll", handleLeftScroll)
      right.removeEventListener("scroll", handleRightScroll)
    }
  }, [viewMode])

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.max(0.1, Math.min(5, prev + delta)))
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden relative group/viewer">
      {/* Controls Overlay */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-2 bg-black/80 backdrop-blur-md rounded-md border border-white/10 shadow-2xl opacity-0 group-hover/viewer:opacity-100 transition-all duration-300 translate-y-2 group-hover/viewer:translate-y-0">
        <div className="flex items-center gap-1 border-r border-white/10 pr-2">
          <button
            onClick={() => handleZoom(-0.1)}
            className="p-1.5 text-white/60 hover:text-white hover:bg-slate-50/10 rounded-lg transition-colors"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-[10px] font-bold text-white min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => handleZoom(0.1)}
            className="p-1.5 text-white/60 hover:text-white hover:bg-slate-50/10 rounded-lg transition-colors"
          >
            <ZoomIn size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 pl-1">
          <button
            onClick={() =>
              setViewMode(
                viewMode === "side-by-side" ? "split" : "side-by-side",
              )
            }
            className={`p-1.5 rounded-lg transition-colors flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 ${
              viewMode === "split"
                ? "bg-slate-50 text-black"
                : "text-white/60 hover:text-white hover:bg-slate-50/10"
            }`}
          >
            {viewMode === "split" ? (
              <Minimize2 size={14} />
            ) : (
              <Maximize2 size={14} />
            )}
            {viewMode === "split" ? "Side-by-Side" : "Split View"}
          </button>
        </div>

        <button
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
          className="p-1.5 text-white/60 hover:text-white hover:bg-slate-50/10 rounded-lg transition-colors text-[10px] font-bold uppercase tracking-widest px-3 border-l border-white/10 ml-1"
        >
          Reset
        </button>
      </div>

      <div className="flex-1 flex min-h-0 relative">
        {viewMode === "side-by-side" ? (
          <>
            {/* Figma Panel */}
            <div className="flex-1 flex flex-col border-r border-white/10 relative">
              <div className="absolute top-4 left-4 z-20 px-3 py-1 bg-black/60 backdrop-blur-sm rounded-full border border-white/10">
                <span className="text-[10px] font-bold text-white uppercase tracking-widest">
                  Figma Design
                </span>
              </div>
              <div
                ref={leftRef}
                className="flex-1 overflow-auto cursor-grab active:cursor-grabbing bg-slate-950/50"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <div
                  className="inline-block transition-transform duration-75"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <img
                    src={figmaUrl}
                    alt="Figma Design"
                    className="max-w-none shadow-2xl"
                  />
                </div>
              </div>
            </div>

            {/* Site Panel */}
            <div className="flex-1 flex flex-col relative">
              <div className="absolute top-4 left-4 z-20 px-3 py-1 bg-black/60 backdrop-blur-sm rounded-full border border-white/10">
                <span className="text-[10px] font-bold text-white uppercase tracking-widest">
                  Live Site
                </span>
              </div>
              <div
                ref={rightRef}
                className="flex-1 overflow-auto bg-slate-950/50"
              >
                <div
                  className="inline-block transition-transform duration-75"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <img
                    src={siteUrl}
                    alt="Live Site"
                    className="max-w-none shadow-2xl"
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Split Slider Mode */
          <div className="flex-1 relative overflow-hidden bg-slate-950">
            <div
              className="absolute inset-0 flex items-center justify-center cursor-ew-resize"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setSliderPos(((e.clientX - rect.left) / rect.width) * 100)
              }}
            >
              <div className="absolute inset-0 z-10">
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <img
                    src={siteUrl}
                    alt="Live Site"
                    className="max-w-none h-full w-auto"
                  />
                </div>
                <div
                  className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none border-r-2 border-white/50 shadow-[4px_0_24px_rgba(0,0,0,0.5)]"
                  style={{
                    width: `${sliderPos}%`,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      transform: `scale(${1 / zoom})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <img
                      src={figmaUrl}
                      alt="Figma Design"
                      className="max-w-none h-full w-auto"
                    />
                  </div>
                </div>
              </div>

              {/* Slider Handle */}
              <div
                className="absolute inset-y-0 z-20 group/handle"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-slate-50 rounded-full shadow-2xl flex items-center justify-center group-hover/handle:scale-110 transition-transform">
                  <Move size={16} className="text-black" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
