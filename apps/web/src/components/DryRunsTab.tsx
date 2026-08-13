import React from "react"
import { format } from "date-fns"
import { XCircle, Zap, ExternalLink } from "lucide-react"
import { useAiFixRuns, useAiFixRun } from "../hooks/useAiFixRuns"
import { AiFixFinding } from "../api/aiFixRuns.api"

interface Props {
  project: { id: string }
}

const CATEGORY_LABEL: Record<string, string> = {
  fully_ai: "✅ Fully AI-fixed",
  partial_ai: "🟡 Partially AI",
  manual: "🟡 AI-corrected",
  not_possible: "🔧 Code correction",
}

const FRIENDLY: Record<string, string> = {
  dead_links: "Dead Links",
  image_quality: "Image Quality",
  hero_media: "Hero Media",
  false_breakpoint: "False Breaking Points",
  backend_check: "Backend / WordPress",
  review_reputation_check: "Review & Reputation",
  functionality_check: "Website Functionality",
  gbp_check: "Google Business Profile",
  contact_form: "Contact Form",
  footer_logo: "Footer Logo",
  single_script: "Single Script",
  favicon: "Favicon",
  privacy_policy: "Privacy Policy",
}
const labelFor = (f: string) =>
  FRIENDLY[f] || (f || "other").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

const DryRunModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { data, isLoading } = useAiFixRun(id)

  // Group findings by check → page.
  const grouped = React.useMemo(() => {
    const g = new Map<string, Map<string, AiFixFinding[]>>()
    for (const f of data?.data?.findings || []) {
      if (!g.has(f.check_factor)) g.set(f.check_factor, new Map())
      const byPage = g.get(f.check_factor)!
      const key = f.pageUrl || "(site-wide)"
      if (!byPage.has(key)) byPage.set(key, [])
      byPage.get(key)!.push(f)
    }
    return g
  }, [data])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-[#131d22]/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-[90vw] max-w-4xl bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              AI Fix Dry-run Data
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-600">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {data && (
            <>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-3">
                <span>Run: {data.run_id}</span>
                <span>Type: {data.run_type || "—"}</span>
                <span>Committed: {data.committed}</span>
                {data.commit_url && (
                  <a href={data.commit_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-1">
                    <ExternalLink size={11} /> commits
                  </a>
                )}
                {data.data?.repoUrl && (
                  <a href={data.data.repoUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                    repo
                  </a>
                )}
              </div>
              {[...grouped.entries()].map(([factor, byPage]) => (
                <div key={factor}>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 mb-2">
                    {labelFor(factor)}
                  </h3>
                  {[...byPage.entries()].map(([pageUrl, findings]) => (
                    <div key={pageUrl} className="mb-3 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
                      <a href={pageUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-500 hover:underline break-all">
                        {pageUrl}
                      </a>
                      <table className="w-full text-[11px] mt-1">
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                          {findings.map((f, i) => (
                            <tr key={i}>
                              <td className="py-1.5 pr-3 align-top whitespace-nowrap">
                                {f.applied ? "✔ fixed" : CATEGORY_LABEL[f.category] || f.category}
                              </td>
                              <td className="py-1.5 pr-3 align-top font-medium text-slate-700 dark:text-slate-300">
                                {f.title}
                              </td>
                              <td className="py-1.5 align-top text-slate-500 dark:text-slate-400">
                                {f.fix}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ))}
              {grouped.size === 0 && (
                <p className="text-sm text-slate-500">No findings recorded for this run.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export const DryRunsTab: React.FC<Props> = ({ project }) => {
  const [page, setPage] = React.useState(1)
  const { data, isLoading } = useAiFixRuns(project.id, page)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const rows = data?.data || []
  const total = data?.pagination?.total || 0
  const limit = data?.pagination?.limit || 20

  return (
    <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700">
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Zap size={16} className="text-accent" /> AI Fix Dry-run Data
      </h3>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No AI-fix runs yet.</p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-md">
          <table className="w-full text-[12px] text-left">
            <thead className="bg-slate-100 dark:bg-[#131d22] text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-bold uppercase tracking-wider">Run Date</th>
                <th className="px-4 py-2 font-bold uppercase tracking-wider">Run ID</th>
                <th className="px-4 py-2 font-bold uppercase tracking-wider">Type</th>
                <th className="px-4 py-2 font-bold uppercase tracking-wider">Fixes</th>
                <th className="px-4 py-2 font-bold uppercase tracking-wider">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-slate-700 dark:text-slate-300">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-[#1d2a31]">
                  <td className="px-4 py-2">{format(new Date(r.created_at), "MMM d, HH:mm")}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-400">{r.run_id?.slice(0, 8)}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${r.run_type === "post_release" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                      {r.run_type === "post_release" ? "post" : "pre"}
                    </span>
                  </td>
                  <td className="px-4 py-2">{r.committed}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => setSelectedId(r.id)} className="text-accent hover:underline font-bold">
                      View dry-run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-end gap-2 mt-4 text-xs">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-unified disabled:opacity-40">
            Prev
          </button>
          <span className="text-slate-500">Page {page}</span>
          <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)} className="btn-unified disabled:opacity-40">
            Next
          </button>
        </div>
      )}

      {selectedId && <DryRunModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
