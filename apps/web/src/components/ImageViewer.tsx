import React, { useState } from "react"
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Monitor,
  Tablet,
  Smartphone,
  Move,
} from "lucide-react"

interface ImageViewerProps {
  isOpen: boolean
  onClose: () => void
  screenshots: {
    desktop?: string | null
    tablet?: string | null
    mobile?: string | null
  }
  initialTab?: "desktop" | "tablet" | "mobile"
  hideTabs?: boolean
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  isOpen,
  onClose,
  screenshots,
  initialTab = "desktop",
  hideTabs = false,
}) => {
  const [activeTab, setActiveTab] = useState<"desktop" | "tablet" | "mobile">(
    initialTab,
  )
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const currentImage = screenshots[activeTab]

  // Helpers
  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.2, 4))
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.2, 0.5))
  const handleReset = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => setIsDragging(false)

  // Effects
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }
    return () => {
      document.body.style.overflow = "unset"
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 dark:bg-[#131d22]/95 backdrop-blur-md select-none overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="absolute top-0 left-0 right-0 p-6 flex flex-col md:flex-row items-center justify-between gap-6 z-50 bg-gradient-to-b from-slate-950/80 dark:from-[#131d22]/80 to-transparent">
        <div className="flex items-center gap-3">DETAILED SCREENSHOT</div>

        {/* Viewport Tabs */}
        {!hideTabs && (
          <div className="flex items-center gap-1.5 bg-slate-50/5 dark:bg-[#1d2a31]/50 p-1.5 rounded-md border border-white/10 backdrop-blur-xl">
            <button
              onClick={() => {
                setActiveTab("desktop")
                handleReset()
              }}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${
                activeTab === "desktop"
                  ? "bg-slate-50 dark:bg-[#1d2a31] text-black dark:text-white shadow-xl scale-105"
                  : "text-slate-400 hover:text-white hover:bg-slate-50/5 dark:hover:bg-[#1d2a31]/50"
              }`}
            >
              <Monitor size={14} />
              Desktop
            </button>
            <button
              onClick={() => {
                setActiveTab("tablet")
                handleReset()
              }}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${
                activeTab === "tablet"
                  ? "bg-slate-50 dark:bg-[#1d2a31] text-black dark:text-white shadow-xl scale-105"
                  : "text-slate-400 hover:text-white hover:bg-slate-50/5 dark:hover:bg-[#1d2a31]/50"
              }`}
            >
              <Tablet size={14} />
              Tablet
            </button>
            <button
              onClick={() => {
                setActiveTab("mobile")
                handleReset()
              }}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${
                activeTab === "mobile"
                  ? "bg-slate-50 dark:bg-[#1d2a31] text-black dark:text-white shadow-xl scale-105"
                  : "text-slate-400 hover:text-white hover:bg-slate-50/5 dark:hover:bg-[#1d2a31]/50"
              }`}
            >
              <Smartphone size={14} />
              Mobile
            </button>
          </div>
        )}
        {/* Controls */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-slate-50/5 dark:bg-[#1d2a31]/50 p-1.5 rounded-md border border-white/10 backdrop-blur-xl">
            <button
              onClick={handleZoomOut}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-50/10 dark:hover:bg-[#1d2a31]/80 rounded-lg transition-all"
              title="Zoom Out"
            >
              <ZoomOut size={18} />
            </button>
            <div className="px-3 min-w-[60px] text-center">
              <span className="text-white text-[10px] font-bold tabular-nums">
                {Math.round(scale * 100)}%
              </span>
            </div>
            <button
              onClick={handleZoomIn}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-50/10 dark:hover:bg-[#1d2a31]/80 rounded-lg transition-all"
              title="Zoom In"
            >
              <ZoomIn size={18} />
            </button>
            <div className="w-px h-4 bg-slate-50/10 mx-1" />
            <button
              onClick={handleReset}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-50/10 dark:hover:bg-[#1d2a31]/80 rounded-lg transition-all"
              title="Reset View"
            >
              <RotateCcw size={18} />
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-3 bg-slate-50/5 dark:bg-[#1d2a31]/50 hover:bg-red-500 text-slate-400 hover:text-white rounded-md border border-white/10 backdrop-blur-xl transition-all group active:scale-95"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Image Container */}
      <div
        className={`w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing ${
          isDragging ? "cursor-grabbing" : ""
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {currentImage ? (
          <div
            className="relative transition-transform duration-75 ease-out"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            }}
          >
            <img
              src={currentImage}
              alt={`${activeTab} screenshot`}
              className="max-w-[90vw] max-h-[85vh] object-contain shadow-[0_0_100px_rgba(0,0,0,0.5)] rounded-sm pointer-events-none border border-white/5"
              draggable={false}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 opacity-20">
            <div className="w-32 h-32 rounded-full bg-slate-50/5 dark:bg-[#1d2a31]/50 border border-white/10 flex items-center justify-center">
              <Monitor size={64} className="text-white" />
            </div>
            <p className="text-white font-bold text-sm uppercase tracking-[0.3em]">
              No Capture Data Available
            </p>
          </div>
        )}
      </div>

      {/* Bottom Shortcuts Info */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-8 px-8 py-3 bg-slate-900/50 dark:bg-[#131d22]/80 backdrop-blur-2xl border border-white/5 rounded-full z-50">
        {!hideTabs && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                {activeTab === "desktop"
                  ? "1440 × Auto"
                  : activeTab === "tablet"
                    ? "768 × Auto"
                    : "375 × Auto"}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-50/10" />
          </>
        )}
        <div className="h-4 w-px bg-slate-50/10" />
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em]">
          Hold & Drag to Pan <span className="mx-2 text-white/10">•</span> Use
          Controls to Zoom
        </p>
      </div>
    </div>
  )
}
