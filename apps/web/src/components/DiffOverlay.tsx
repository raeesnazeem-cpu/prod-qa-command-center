import React, { useState } from "react"
import { Layers, Box } from "lucide-react"

interface DiffOverlayProps {
  figmaUrl: string
  siteUrl: string
  viewMode: "side-by-side" | "overlay"
  onToggleMode: () => void
}

export const DiffOverlay: React.FC<DiffOverlayProps> = ({
  figmaUrl,
  siteUrl,
  viewMode,
  onToggleMode,
}) => {
  const [opacity, setOpacity] = useState(0.5)

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden relative group/overlay">
      {/* Controls Overlay */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 px-4 py-2 bg-black/80 backdrop-blur-md rounded-md border border-white/10 shadow-2xl transition-all duration-300">
        <button
          onClick={onToggleMode}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-black text-[10px] font-bold uppercase tracking-widest rounded-md transition-all active:scale-95"
        >
          {viewMode === "overlay" ? <Box size={14} /> : <Layers size={14} />}
          {viewMode === "overlay" ? "Side by Side" : "Overlay Mode"}
        </button>

        {viewMode === "overlay" && (
          <div className="flex items-center gap-3 pl-4 border-l border-white/10">
            <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">
              Opacity
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-32 h-1 bg-slate-50/20 rounded-lg appearance-none cursor-pointer accent-white"
            />
            <span className="text-[10px] font-bold text-white min-w-[2rem]">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 relative overflow-auto bg-slate-950 flex items-center justify-center p-8">
        <div className="relative inline-block shadow-2xl">
          {/* Site Image (Base) */}
          <img src={siteUrl} alt="Live Site" className="max-w-none" />

          {/* Figma Image (Overlay) */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-200"
            style={{
              opacity: viewMode === "overlay" ? opacity : 0,
              mixBlendMode: "difference",
            }}
          >
            <img
              src={figmaUrl}
              alt="Figma Design"
              className="max-w-none w-full h-full object-top object-cover invert"
            />
          </div>
        </div>
      </div>

      {/* Legend */}
      {viewMode === "overlay" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-black/60 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-slate-50" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wider">
              Perfect Match = Black
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wider">
              Difference = Visible Colors
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
