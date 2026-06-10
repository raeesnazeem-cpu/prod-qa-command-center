import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CreateRunSchema, CreateRunInput } from "@qacc/shared"
import {
  useCreateRun,
  useUpdateRunStatus,
  useStartRun,
  useFetchUrls,
} from "../hooks/useRuns"
import { Project } from "../api/projects.api"
import {
  AlertCircle,
  X,
  Loader2,
  Globe,
  PlayCircle,
  Layout,
  ChevronDown,
  ChevronRight,
  Square,
  CheckSquare,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { createPortal } from "react-dom"

interface StartRunModalProps {
  project: Project
  isOpen: boolean
  onClose: () => void
}

export const StartRunModal = ({
  project,
  isOpen,
  onClose,
}: StartRunModalProps) => {
  const navigate = useNavigate()
  const { mutate: createRun, isPending: isCreating } = useCreateRun()
  const { mutate: startRun, isPending: isStarting } = useStartRun()
  const { isPending: isUpdating } = useUpdateRunStatus()
  const [isUrlsExpanded, setIsUrlsExpanded] = useState(false)
  const [selectedUrls, setSelectedUrls] = useState<string[]>([])
  const [liveSiteUrl, setLiveSiteUrl] = useState("")

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<CreateRunInput>({
    resolver: zodResolver(CreateRunSchema),
    defaultValues: {
      project_id: project.id,
      run_type: "pre_release",
      site_url: project.site_url,
      figma_url: "",
      enabled_checks: [],
      is_woocommerce: project.is_woocommerce,
      device_matrix: ["desktop"],
      selected_urls: [],
      live_site_url: "",
    },
  })

  const enabledChecks = useWatch({ control, name: "enabled_checks" }) || []
  const PASSWORD_REQUIRED_CHECKS = ["callnow_links", "verify_plugin_updates"]
  const requiresPassword = enabledChecks.some((c) =>
    PASSWORD_REQUIRED_CHECKS.includes(c),
  )
  const requiresLiveSiteUrl = enabledChecks.includes("url_tab_compare")

  const isGeneralOnly = enabledChecks.every(
    (c) =>
      c === "project_plan" ||
      c === "dead_links" ||
      c === "learn_more_buttons" ||
      c === "url_tab_compare",
  )

  const siteUrl = useWatch({ control, name: "site_url" })
  const { data: fetchedUrls, isLoading: isFetchingUrls } = useFetchUrls(siteUrl)

  useEffect(() => {
    if (fetchedUrls) {
      setSelectedUrls(fetchedUrls)
      setValue("selected_urls", fetchedUrls)
    }
  }, [fetchedUrls, setValue])

  const toggleUrl = (url: string) => {
    const newSelection = selectedUrls.includes(url)
      ? selectedUrls.filter((u) => u !== url)
      : [...selectedUrls, url]
    setSelectedUrls(newSelection)
    setValue("selected_urls", newSelection)
  }

  const selectAll = () => {
    if (fetchedUrls) {
      setSelectedUrls(fetchedUrls)
      setValue("selected_urls", fetchedUrls)
    }
  }

  const deselectAll = () => {
    setSelectedUrls([])
    setValue("selected_urls", [])
  }

  const onSubmit = (data: CreateRunInput) => {
    // 1. First, list down all factors that require looking at real website pages
    const PAGE_CHECKS = [
      "visual_regression",
      "accessibility",
      "console_errors",
      "performance",
      "seo",
      "spelling",
      "broken_links",
      "dummy_content",
      "image_compliance",
      "ai_content_audit",
      "hero_media",
      "dead_links",
      "learn_more_buttons",
    ]
    // 2. Check if any of these page scan checks are selected by the user
    const requiresPageScan = data.enabled_checks.some((c) =>
      PAGE_CHECKS.includes(c),
    )

    // 3. If a page scan check is enabled but the user unchecked all page URLs, block submission!
    if (requiresPageScan && selectedUrls.length === 0) {
      return
    }

    // 4. If we are ONLY doing general checks (like Project Plan select), we don't need any page URLs!
    // const urlsToSubmit = requiresPageScan ? selectedUrls : []
    const requiresUrls = data.enabled_checks.some(
      (c) =>
        c !== "project_plan" &&
        c !== "dead_links" &&
        c !== "learn_more_buttons" &&
        c !== "url_tab_compare",
    )
    if (requiresUrls && selectedUrls.length === 0) {
      return
    }

    if (
      data.enabled_checks.includes("url_tab_compare") &&
      !liveSiteUrl.trim()
    ) {
      alert(
        "Client's Live Site URL is required for the URL & Tab Compare check.",
      )
      return
    }

    // 5. Construct the payload safely

    const payload = {
      ...data,
      figma_url: data.figma_url === "" ? null : data.figma_url,
      selected_urls: requiresUrls ? selectedUrls : [],
      live_site_url: liveSiteUrl || undefined,
    }

    createRun(payload, {
      onSuccess: (newRun) => {
        // Correctly enqueue the job using startRun mutation with the password
        startRun(
          {
            runId: newRun.id,
            wp_password: requiresPassword ? data.wp_password : undefined,
          },
          {
            onSuccess: () => {
              onClose()
              // Redirect to detail page to see live progress
              navigate(`/projects/${project.id}/runs/${newRun.id}`)
            },
          },
        )
      },
    })
  }

  const isPending = isCreating || isStarting || isUpdating

  if (!isOpen) return null

  const checkOptions = [
    {
      id: "visual_regression",
      label: "Visual Regression",
      description: "Compare layout against baseline or Figma",
    },
    {
      id: "accessibility",
      label: "Accessibility (a11y)",
      description: "Check for WCAG compliance issues",
    },
    {
      id: "console_errors",
      label: "Console Errors",
      description: "Detect JS errors and failed network requests",
    },
    {
      id: "performance",
      label: "Performance",
      description: "Basic Lighthouse performance metrics",
    },
    {
      id: "project_plan",
      label: "Project Plan",
      description: "Fetch project plan from Basecamp",
    },
    {
      id: "hero_media",
      label: "Hero Video & Image Load",
      description:
        "Verify that the hero section video and fallback image load immediately on page load",
    },
    {
      id: "dead_links",
      label: "Dead Link & Anchor Checker",
      description:
        "Detect dead links and broken anchors (#hash) using a super-fast native Playwright + Got hybrid approach",
    },
    {
      id: "learn_more_buttons",
      label: "Learn More Buttons Check",
      description:
        "Scan all pages for generic CTA texts like 'Learn More' or 'Read More'.",
      category: "general",
      enabled: true,
    },

    {
      id: "paid_media",
      label: "Paid Media Check",
      description:
        "Verify Google and Facebook Ads campaigns are started in Basecamp for this project",
    },
    {
      id: "privacy_policy",
      label: "Privacy Policy Check",
      description:
        "Check if Privacy Policy page is added on the footer and WooCommerce checkout page",
    },
    {
      id: "footer_logo",
      label: "Footer Logo Check",
      description:
        "Ensure footer logo is the brand-new logo with no tagline text across all views",
    },
    {
      id: "single_script",
      label: "Single Script Features",
      description:
        "Verify single script tag is injected and widgets are configured and displayed",
    },
    {
      id: "url_tab_compare",
      label: "URL & Tab Name Comparison",
      description:
        "Compare all dev site URLs and tab titles against the client's live website. Enter live site URL below when selected.",
    },
    {
      id: "top_bar_sticky",
      label: "Top Bar & Sticky Header Check",
      description:
        "Verify phone, email, social links in top bar, and ensure header remains sticky on scroll",
    },
    {
      id: "favicon",
      label: "Favicon Check",
      description: "Verify favicon link is present in head and loads correctly",
    },
    {
      id: "contact_form",
      label: "Growth99 Contact Form Check",
      description:
        "Test responsive rendering and mock submission of contact forms on all pages",
    },
    {
      id: "chatbot_consultation",
      label: "Chatbot & Virtual Consultation Check",
      description:
        "Verify that chatbot and virtual consultation modals open and function correctly",
    },
    {
      id: "logo_chatbot",
      label: "Logo on chatbot check",
      description: "Verify that logo on the chatbot is the actual brand logo",
    },
    {
      id: "callnow_links",
      label: "Callnow & Links Check",
      description: "Verify Call Now plugin installation and homepage links",
    },
    {
      id: "verify_plugin_updates",
      label: "Verify Plugin Updates",
      description:
        "Verify if all plugins are in updated state except All-in-Migration, Litespeed Cache, Wp-Rocket, ELEMENTOR, WOO-COMMERCE",
    },
    {
      id: "social_share_heading",
      label: "Social Share Heading Check",
      description:
        "Scan the homepage for social sharing previews on Facebook, X, and LinkedIn.",
      category: "general",
    },
  ]

  const FUNCTIONAL_CHECK_IDS = [
    "visual_regression",
    "accessibility",
    "console_errors",
    "performance",
  ]
  const functionalChecks = checkOptions.filter((c) =>
    FUNCTIONAL_CHECK_IDS.includes(c.id),
  )
  const generalChecks = checkOptions.filter(
    (c) => !FUNCTIONAL_CHECK_IDS.includes(c.id),
  )
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-slate-50 dark:bg-[#0B151B] border border-slate-200 dark:border-slate-800 rounded-md shadow-sm overflow-hidden transition-all duration-200 max-h-[90vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131d22]/50">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <PlayCircle className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-200">
              Start New QA Run
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col min-h-0"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            {/* Run Type */}
            <div>
              <label className="block text-[9px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Run Type
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="relative cursor-pointer">
                  <input
                    type="radio"
                    {...register("run_type")}
                    value="pre_release"
                    className="sr-only peer"
                  />
                  <div className="p-1 border border-slate-200 dark:border-slate-700 rounded-md text-center peer-checked:border-accent peer-checked:bg-accent/5 dark:peer-checked:bg-accent/10 transition-all">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 peer-checked:text-accent">
                      Pre-Release
                    </span>
                  </div>
                </label>
                <label className="relative cursor-not-allowed opacity-50">
                  <input
                    type="radio"
                    {...register("run_type")}
                    value="post_release"
                    className="sr-only peer"
                    disabled
                  />
                  <div className="p-1 border border-slate-200 dark:border-slate-700 rounded-md text-center peer-checked:border-accent peer-checked:bg-accent/5 dark:peer-checked:bg-accent/10 transition-all">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 peer-checked:text-accent">
                      Post-Release
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Site URL */}
            <div>
              <label className="block text-[9px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Target URL
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-slate-400" />
                <input
                  {...register("site_url")}
                  className="w-full bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] border border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent rounded-md pl-8 pr-4 py-1.5 text-[13px] text-slate-900 dark:text-slate-200 focus:outline-none focus:bg-[#fcfcfc] dark:focus:bg-[#131d22] focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
              {errors.site_url && (
                <p className="mt-1.5 text-xs text-red-500 font-medium">
                  {errors.site_url.message}
                </p>
              )}
            </div>

            {/* Figma URL */}
            <div>
              <label className="block text-[9px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Figma Design URL{" "}
                <span className="text-slate-400 text-[8px] uppercase ml-1">
                  (Optional)
                </span>
              </label>
              <div className="relative opacity-50 cursor-not-allowed">
                <Layout className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-slate-400" />
                <input
                  {...register("figma_url")}
                  disabled
                  placeholder="https://figma.com/file/..."
                  className="w-full bg-[#F2F6FC] dark:bg-[#131d22] border border-slate-300 dark:border-slate-700 rounded-md pl-7 pr-4 py-1.5 text-[13px] text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 cursor-not-allowed transition-all"
                />
              </div>

              {errors.figma_url && (
                <p className="mt-1.5 text-xs text-red-500 font-medium">
                  {errors.figma_url.message}
                </p>
              )}
            </div>

            {/* URL Selection Accordion */}
            <div className="border border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent transition-all rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setIsUrlsExpanded(!isUrlsExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Globe className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Select Pages to Test ({selectedUrls.length}/
                    {fetchedUrls?.length || 0})
                  </span>
                  {isFetchingUrls && (
                    <Loader2 className="w-3 h-3 animate-spin text-accent" />
                  )}
                </div>
                {isUrlsExpanded ? (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {isUrlsExpanded && (
                <div className="p-4 bg-[#fcfcfc] dark:bg-[#131d22] border-t border-slate-300 dark:border-slate-700 space-y-3">
                  <div className="flex items-center space-x-4 pb-2 border-b border-slate-100 dark:border-slate-700/50">
                    <button
                      type="button"
                      onClick={selectAll}
                      className="text-[10px] font-bold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={deselectAll}
                      className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors"
                    >
                      Deselect All
                    </button>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
                    {!fetchedUrls && !isFetchingUrls && (
                      <p className="text-xs text-slate-500 italic py-2">
                        Enter a URL to fetch pages
                      </p>
                    )}
                    {isFetchingUrls && (
                      <div className="flex items-center justify-center py-4 space-x-2">
                        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        <span className="text-xs text-slate-500">
                          Fetching pages...
                        </span>
                      </div>
                    )}
                    {fetchedUrls?.map((url) => (
                      <div
                        key={url}
                        onClick={() => toggleUrl(url)}
                        className="flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-[#1d2a31]/50 cursor-pointer transition-colors group"
                      >
                        {selectedUrls.includes(url) ? (
                          <CheckSquare className="w-4 h-4 text-accent" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />
                        )}
                        <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
                          {url}
                        </span>
                      </div>
                    ))}
                  </div>
                  {selectedUrls.length === 0 &&
                    !isGeneralOnly &&
                    !isFetchingUrls &&
                    fetchedUrls && (
                      <p className="text-[10px] text-red-500 font-medium italic">
                        * At least one page must be selected
                      </p>
                    )}
                </div>
              )}
            </div>

            {/* Enabled Checks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                  Checks to Run
                </label>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() =>
                      setValue(
                        "enabled_checks",
                        checkOptions.map((c) => c.id),
                      )
                    }
                    className="text-[9px] font-bold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => setValue("enabled_checks", [])}
                    className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-4 max-h-[45vh] bg-transparent overflow-y-auto pr-2 custom-scrollbar">
                {/* Functional Tests Group */}
                <details className="group space-y-2" open>
                  <summary className="text-sm font-bold text-slate-800 dark:text-slate-200 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center outline-none group/summary hover:text-accent transition-colors bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] p-3 rounded-md border border-slate-300 dark:border-slate-700">
                    <span className="mr-3 text-[12px] text-slate-400 transition-transform duration-300 -rotate-90 group-open:rotate-0">
                      ▼
                    </span>
                    <span className="flex-1 uppercase tracking-wider text-xs">
                      Functional Tests
                    </span>
                    <div
                      className="flex items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={functionalChecks.every((c) =>
                          enabledChecks.includes(c.id),
                        )}
                        onChange={(e) => {
                          const isChecked = e.target.checked
                          if (isChecked) {
                            const newChecks = Array.from(
                              new Set([
                                ...enabledChecks,
                                ...functionalChecks.map((c) => c.id),
                              ]),
                            )
                            setValue("enabled_checks", newChecks)
                          } else {
                            const newChecks = enabledChecks.filter(
                              (id) =>
                                !functionalChecks.find((c) => c.id === id),
                            )
                            setValue("enabled_checks", newChecks)
                          }
                        }}
                        className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent"
                      />
                    </div>
                  </summary>
                  <div className="space-y-2 pt-1 pl-4">
                    {functionalChecks.map((check) => (
                      <label
                        key={check.id}
                        className="flex items-start p-3 border border-slate-100 dark:border-slate-700 rounded-md bg-slate-50/50 dark:bg-[#1d2a31]/30 hover:bg-slate-50 dark:hover:bg-[#1d2a31]/50 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center h-5 mr-3">
                          <input
                            type="checkbox"
                            {...register("enabled_checks")}
                            value={check.id}
                            className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">
                            {check.label}
                          </div>
                          <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                            {check.description}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </details>

                {/* General Checks Group */}
                <details className="group space-y-2" open>
                  <summary className="text-sm font-bold text-slate-800 dark:text-slate-200 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center outline-none group/summary hover:text-accent transition-colors bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] p-3 rounded-md border border-slate-300 dark:border-slate-700">
                    <span className="mr-3 text-[12px] text-slate-400 transition-transform duration-300 -rotate-90 group-open:rotate-0">
                      ▼
                    </span>
                    <span className="flex-1 uppercase tracking-wider text-xs">
                      General Checks
                    </span>
                    <div
                      className="flex items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={
                          generalChecks.every((c) =>
                            enabledChecks.includes(c.id),
                          ) && generalChecks.length > 0
                        }
                        onChange={(e) => {
                          const isChecked = e.target.checked
                          if (isChecked) {
                            const newChecks = Array.from(
                              new Set([
                                ...enabledChecks,
                                ...generalChecks.map((c) => c.id),
                              ]),
                            )
                            setValue("enabled_checks", newChecks)
                          } else {
                            const newChecks = enabledChecks.filter(
                              (id) => !generalChecks.find((c) => c.id === id),
                            )
                            setValue("enabled_checks", newChecks)
                          }
                        }}
                        className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent"
                      />
                    </div>
                  </summary>
                  <div className="space-y-2 pt-1 pl-4">
                    {generalChecks.map((check) => (
                      <label
                        key={check.id}
                        className="flex items-start p-3 border border-slate-100 dark:border-slate-700 rounded-md bg-slate-50/50 dark:bg-[#1d2a31]/30 hover:bg-slate-50 dark:hover:bg-[#1d2a31]/50 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center h-5 mr-3">
                          <input
                            type="checkbox"
                            {...register("enabled_checks")}
                            value={check.id}
                            className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">
                            {check.label}
                          </div>
                          <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                            {check.description}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131d22]/50">
            {(requiresPassword || requiresLiveSiteUrl) && (
              <div className="p-4 px-6 space-y-4 border-b border-slate-100 dark:border-slate-800">
                {requiresPassword && (
                  <div className="p-4 bg-white dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      WordPress Admin Password Required
                    </label>
                    <p className="text-[10px] text-slate-500 mb-3 font-medium">
                      One or more selected checks require access to the
                      WordPress backend. Username will be set to
                      onboarding.india@growth99.com
                    </p>
                    <input
                      type="password"
                      {...register("wp_password")}
                      placeholder="Enter today's WP password..."
                      className="w-full bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] border border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent rounded-md px-4 py-1.5 text-[13px] text-slate-900 dark:text-slate-200 focus:outline-none focus:bg-[#fcfcfc] dark:focus:bg-[#131d22] focus:border-accent transition-all"
                    />
                  </div>
                )}

                {requiresLiveSiteUrl && (
                  <div className="p-4 bg-white dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Client's Live Site URL — Required
                    </label>
                    <p className="text-[10px] text-slate-500 mb-3 font-medium">
                      Enter the client's CURRENT live website URL. We will
                      compare all pages from this site against our dev site.
                    </p>
                    <input
                      type="url"
                      value={liveSiteUrl}
                      onChange={(e) => setLiveSiteUrl(e.target.value)}
                      placeholder="https://www.clientlivesite.com"
                      className="w-full bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] border border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent rounded-md px-4 py-1.5 text-[13px] text-slate-900 dark:text-slate-200 focus:outline-none focus:bg-[#fcfcfc] dark:focus:bg-[#131d22] focus:border-accent transition-all"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 p-4 px-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131d22]/50 flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-unified-secondary flex-1 dark:bg-[#1D2A31] dark:border-slate-800 dark:hover:bg-[#1d2a31] dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isPending || (selectedUrls.length === 0 && !isGeneralOnly)
              }
              className="btn-unified flex-[2] flex items-center justify-center space-x-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <PlayCircle className="w-4 h-4" />
                  <span>Start Run</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
