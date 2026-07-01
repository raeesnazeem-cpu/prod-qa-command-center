import React, { useState, useEffect, useRef } from "react"
import {
  X,
  Camera,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  ExternalLink,
  AlertCircle,
  Monitor,
  Laptop,
  Tablet,
  Smartphone,
  Scan,
} from "lucide-react"
import { useAuthAxios } from "../lib/useAuthAxios"
import { ScreenshotEditor } from "./ScreenshotEditor"

const RESOLUTIONS = {
  desktop: { width: 1920, height: 1080, label: "Desktop" },
  laptop: { width: 1366, height: 768, label: "Laptop" },
  tablet: { width: 1194, height: 834, label: "Tablet" },
  mobile: { width: 390, height: 844, label: "Mobile" },
}

type DeviceMode = keyof typeof RESOLUTIONS

interface BrowserOverlayProps {
  url: string
  isOpen: boolean
  onClose: () => void
  onCapture: (imageUrl: string) => void
  galleryCount: number
  findingId?: string
}

export const BrowserOverlay: React.FC<BrowserOverlayProps> = ({
  url,
  isOpen,
  onClose,
  onCapture,
  galleryCount,
  findingId,
}) => {
  const axios = useAuthAxios()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeUrl, setIframeUrl] = useState<string>("")
  const [currentProxiedUrl, setCurrentProxiedUrl] = useState<string>(url)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop")
  const [capturing, setCapturing] = useState(false)
  const [captureProgress, setCaptureProgress] = useState(0)
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null)

  const loadProxyUrl = async (targetUrl: string = url) => {
    if (!targetUrl) return
    setLoading(true)
    setError(null)
    setCurrentProxiedUrl(targetUrl)
    try {
      // const response = await axios.post(
      //   "/api/proxy-browser",
      //   { url: targetUrl },
      //   {
      //     responseType: "blob",
      //   },
      // )

      // const blob = new Blob([response.data], { type: "text/html" })
      // const dataUrl = URL.createObjectURL(blob)
      // setIframeUrl(dataUrl)
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001"
      setIframeUrl(
        `${apiUrl}/api/proxy-browser?url=${encodeURIComponent(targetUrl)}`,
      )
    } catch (err: any) {
      console.error("[BrowserOverlay] Proxy load failed:", err)
      setError(
        err.response?.data?.error || "Failed to load page through secure proxy",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadProxyUrl(url)
    }

    // Cleanup data URL
    return () => {
      if (iframeUrl && iframeUrl.startsWith("blob:")) {
        URL.revokeObjectURL(iframeUrl)
      }
    }
  }, [url, isOpen])

  if (!isOpen) return null

  const handleRefresh = () => {
    loadProxyUrl(currentProxiedUrl)
  }

  const handleCapture = async () => {
    if (galleryCount >= 3 || error || loading || capturing) return

    setCapturing(true)
    setCaptureProgress(0)

    // Simulate progress over ~18 seconds (conservative estimate)
    const duration = 18000
    const interval = 100
    const step = (interval / duration) * 100
    const timer = setInterval(() => {
      setCaptureProgress((prev) => (prev < 95 ? prev + step : prev))
    }, interval)

    try {
      const res = RESOLUTIONS[deviceMode]

      const response = await axios.post("/api/proxy-browser/capture", {
        url: currentProxiedUrl,
        fullPage: true,
        viewportWidth: res.width,
        viewportHeight: res.height,
      })

      if (response.data?.imageUrl) {
        setCaptureProgress(100)
        setCapturedImageUrl(response.data.imageUrl)
      }
    } catch (err: any) {
      console.error("[BrowserOverlay] Capture failed:", err)
    } finally {
      clearInterval(timer)
      setTimeout(() => {
        setCapturing(false)
        setCaptureProgress(0)
      }, 400)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-[#131d22] flex flex-col animate-in fade-in duration-300">
      {/* Browser Toolbar */}
      <div className="h-14 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#1d2a31] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-1">
            <button className="p-2 hover:bg-slate-200 rounded-md transition-colors text-slate-400">
              <ChevronLeft size={18} />
            </button>
            <button className="p-2 hover:bg-slate-200 rounded-md transition-colors text-slate-400">
              <ChevronRight size={18} />
            </button>
            <button
              onClick={handleRefresh}
              className="p-2 hover:bg-slate-200 rounded-md transition-colors text-slate-400"
            >
              <RotateCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="flex-1 max-w-2xl relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <ExternalLink size={14} />
            </div>
            <input
              type="text"
              value={currentProxiedUrl}
              readOnly
              className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 rounded-lg py-1.5 pl-9 pr-4 text-xs text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>

          <div className="h-8 w-px bg-slate-200 dark:bg-[#1d2a31] mx-2" />

          <div className="flex items-center bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 rounded-xl p-1 gap-1">
            {(Object.keys(RESOLUTIONS) as DeviceMode[]).map((mode) => {
              const Icon = {
                desktop: Monitor,
                laptop: Laptop,
                tablet: Tablet,
                mobile: Smartphone,
              }[mode]
              const active = deviceMode === mode
              return (
                <button
                  key={mode}
                  onClick={() => setDeviceMode(mode)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                    active
                      ? "bg-black dark:bg-[#1d2a31] text-white shadow-sm"
                      : "text-slate-400 hover:bg-slate-50 dark:hover:bg-[#1d2a31] hover:text-slate-600 dark:hover:text-slate-300"
                  }`}
                  title={RESOLUTIONS[mode].label}
                >
                  <Icon size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-tight hidden lg:inline">
                    {RESOLUTIONS[mode].label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <button
          onClick={onClose}
          className="ml-4 p-2 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full transition-all"
        >
          <X size={20} />
        </button>
      </div>

      {/* Browser Content */}
      <div className="flex-1 bg-slate-100 dark:bg-[#131d22] relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50/50 dark:bg-[#131d22]/80 backdrop-blur-sm z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Securing Connection...
              </p>
            </div>
          </div>
        )}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-[#131d22] z-20">
            <div className="max-w-md w-full p-8 text-center flex flex-col items-center gap-4">
              <div className="p-4 bg-red-50 dark:bg-red-900/30 rounded-full text-red-500 dark:text-red-400">
                <AlertCircle size={40} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest mb-2">
                  Proxy Connection Blocked
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                  {error}. For security reasons, some domains cannot be
                  displayed in the in-app browser.
                </p>
              </div>
              <button
                onClick={() => window.open(url, "_blank")}
                className="mt-2 btn-unified flex items-center gap-2 px-6 py-2 bg-black text-white rounded-xl hover:bg-accent hover:text-black transition-all"
              >
                <ExternalLink size={14} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Open in New Tab Instead
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center p-8 overflow-auto">
            <div
              className="bg-slate-50 dark:bg-white shadow-2xl rounded-sm overflow-hidden transition-all duration-500 relative border dark:border-slate-700"
              style={{
                width: RESOLUTIONS[deviceMode].width,
                height: RESOLUTIONS[deviceMode].height,
                maxWidth: "100%",
                maxHeight: "100%",
                aspectRatio: `${RESOLUTIONS[deviceMode].width} / ${RESOLUTIONS[deviceMode].height}`,
              }}
            >
              {capturing && (
                <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center gap-6 text-white animate-in fade-in duration-300">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-white/10 rounded-full" />
                    <Scan
                      className="absolute inset-0 m-auto text-white animate-pulse"
                      size={28}
                    />
                  </div>
                  <div className="text-center max-w-xs w-full px-6">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] mb-1">
                      Full-Page Scan in Progress
                    </p>
                    <p className="text-[10px] text-white/60 font-medium uppercase tracking-widest mb-6">
                      Waking up pixels and widgets...
                    </p>

                    <div className="space-y-3">
                      <div className="w-full h-1.5 bg-slate-50/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all duration-300 ease-out"
                          style={{ width: `${captureProgress}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-[9px] font-bold text-accent uppercase tracking-widest">
                          {Math.round(captureProgress)}% Complete
                        </p>
                        <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest">
                          {captureProgress < 90
                            ? "Processing..."
                            : "Finalizing..."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {iframeUrl && !capturedImageUrl && (
                <iframe
                  ref={iframeRef}
                  src={iframeUrl}
                  className="w-full h-full border-none"
                  onLoad={() => setLoading(false)}
                  title="Proxied Browser"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {capturedImageUrl && (
        <ScreenshotEditor
          imageUrl={capturedImageUrl}
          maxClips={3 - galleryCount}
          findingId={findingId}
          onClose={() => setCapturedImageUrl(null)}
          onSave={(clips) => {
            clips.forEach((clip) => onCapture(clip))
            setCapturedImageUrl(null)
          }}
        />
      )}

      {/* Sticky Bottom Toolbar */}
      <div className="h-16 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#1d2a31]/90 backdrop-blur-md flex items-center justify-between px-6 shrink-0 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-100 dark:bg-[#131d22] rounded-lg flex items-center justify-center border border-slate-200 dark:border-slate-700">
              <ImageIcon
                size={16}
                className="text-slate-400 dark:text-slate-500"
              />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-900 dark:text-white uppercase tracking-widest leading-none">
                Task Gallery
              </p>
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mt-0.5">
                {galleryCount} / 3 Images
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCapture}
            disabled={galleryCount >= 3 || !!error}
            className="btn-unified flex items-center gap-2 text-white rounded-md hover:bg-accent hover:text-black transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Camera size={16} />
            <span className="text-[10px] font-bold uppercase tracking-widest">
              Capture Reference
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
