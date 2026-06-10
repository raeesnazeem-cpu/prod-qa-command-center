import React, { useState } from "react"
import { Eye } from "lucide-react"
import { ImageViewer } from "./ImageViewer"
import { QAFinding } from "../api/runs.api"

interface FindingCardWithScreenshotProps {
  finding: QAFinding
  pageScreenshots?: {
    desktop?: string | null
    tablet?: string | null
    mobile?: string | null
  }
  hideTabs?: boolean
}

export const FindingCardWithScreenshot: React.FC<
  FindingCardWithScreenshotProps
> = ({ finding, pageScreenshots, hideTabs = false }) => {
  const [isViewerOpen, setIsViewerOpen] = useState(false)

  const screenshotUrl = finding.screenshot_url || pageScreenshots?.desktop

  if (!screenshotUrl) return null

  return (
    <>
      <div
        className="relative group cursor-pointer w-[100px] h-[70px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#1d2a31] shadow-sm hover:shadow-md transition-all active:scale-95"
        onClick={() => setIsViewerOpen(true)}
      >
        <img
          src={screenshotUrl}
          alt="Finding evidence"
          className="w-full h-full object-cover object-top transition-transform group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Eye size={16} className="text-white" />
        </div>
      </div>

      <ImageViewer
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        screenshots={{
          desktop: screenshotUrl,
          tablet: pageScreenshots?.tablet,
          mobile: pageScreenshots?.mobile,
        }}
        initialTab="desktop"
        hideTabs={hideTabs}
      />
    </>
  )
}
