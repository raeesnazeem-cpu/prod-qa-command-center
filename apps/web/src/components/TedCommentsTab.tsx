import { useState, useRef, useEffect, useCallback } from "react"
import { ProjectWithMembers } from "../api/projects.api"
import {
  useTedComments,
  useCreateTedComment,
  useDeleteTedComment,
  useDeleteAllTedComments,
} from "../hooks/useTedComments"
import { TedComment, TedCommentRun } from "../api/tedComments.api"
import { MessageSquare, Trash2, Send, Info, Loader2 } from "lucide-react"

interface TedCommentsTabProps {
  project: ProjectWithMembers
}

const RUN_KIND: Record<string, string> = {
  pre_release: "Pre-Release",
  post_release: "Post-Release",
  internal_qa: "Internal QA",
}

// Fidelity stylesheet: TED strips inline style and renders plain
// <p>/<strong>/<ul>/<li>/<a>/<img> with near-default styling. We mirror that so
// the preview matches what TED actually shows. `allow-same-origin` (WITHOUT
// allow-scripts) lets us measure height while keeping any script inert.
const FRAME_CSS = `
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;background:#ffffff;padding:12px;word-break:break-word}
  p{margin:0 0 8px}
  strong{font-weight:600}
  ul{margin:0 0 8px 20px;padding:0}
  li{margin:2px 0}
  a{color:#2563eb;text-decoration:underline}
  img{max-width:100%;height:auto;vertical-align:middle;margin:2px}
  small{color:#6b7280}
  code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:13px}
  em{color:#6b7280}
`

// Render one comment body exactly as TED would, isolated in a sandboxed iframe.
function TedRenderFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(60)

  const resize = useCallback(() => {
    const doc = ref.current?.contentWindow?.document
    if (doc?.body) setHeight(doc.body.scrollHeight + 4)
  }, [])

  useEffect(() => {
    // Images (remote fallback links / late layout) can grow the body after the
    // initial load event; remeasure a couple of times to settle.
    const t1 = setTimeout(resize, 150)
    const t2 = setTimeout(resize, 600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [html, resize])

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`

  return (
    <iframe
      ref={ref}
      title="TED comment preview"
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={resize}
      style={{ width: "100%", height, border: "none", display: "block" }}
      className="rounded-md bg-white"
    />
  )
}

function SourceBadge({ source }: { source: TedComment["source"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    report: {
      label: "Client copy",
      cls: "bg-accent/10 text-accent border-accent/20",
    },
    // The QACC-internal raw duplicate: real scan URL + real push status.
    report_raw: {
      label: "Raw (QACC)",
      cls: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    },
    status: {
      label: "Status",
      cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    },
    manual: {
      label: "Manual",
      cls: "bg-slate-500/10 text-slate-500 border-slate-500/20",
    },
  }
  const s = map[source || "report"] || map.report
  return (
    <span
      className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${s.cls}`}
    >
      {s.label}
    </span>
  )
}

function CommentCard({
  comment,
  onDelete,
  deleting,
}: {
  comment: TedComment
  onDelete: (id: string) => void
  deleting: boolean
}) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-900/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {comment.author || "QACC"}
          </span>
          <SourceBadge source={comment.source} />
          {comment.check_factor && (
            <span className="text-slate-400">· {comment.check_factor}</span>
          )}
          <span className="text-slate-400">
            · {new Date(comment.created_at).toLocaleString()}
          </span>
        </div>
        <button
          onClick={() => onDelete(comment.id)}
          disabled={deleting}
          title="Delete from preview (does not touch TED)"
          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
      <TedRenderFrame html={comment.body_html} />
    </div>
  )
}

function RunGroupHeader({ run }: { run: TedCommentRun }) {
  const kind = run.run_type ? RUN_KIND[run.run_type] || run.run_type : "Run"
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-slate-900 dark:text-slate-200">
        {run.custom_name || kind}
      </span>
      {run.run_type && !run.custom_name ? null : (
        <span className="text-slate-400 text-xs">{kind}</span>
      )}
      {run.site_url && (
        <span className="text-slate-400 text-xs truncate max-w-xs">
          {run.site_url}
        </span>
      )}
      {run.status && (
        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
          {run.status}
        </span>
      )}
      {run.created_at && (
        <span className="text-slate-400 text-xs">
          {new Date(run.created_at).toLocaleString()}
        </span>
      )}
    </div>
  )
}

export const TedCommentsTab = ({ project }: TedCommentsTabProps) => {
  const { data, isLoading, isError } = useTedComments(project.id)
  const { mutate: createComment, isPending: isPosting } = useCreateTedComment()
  const { mutate: deleteComment, isPending: isDeleting, variables: deletingId } =
    useDeleteTedComment(project.id)
  const { mutate: deleteAllComments, isPending: isDeletingAll } =
    useDeleteAllTedComments(project.id)
  const [draft, setDraft] = useState("")

  const handleDeleteAll = () => {
    const total =
      groups.reduce((n, g) => n + g.comments.length, 0) + unlinked.length
    if (total === 0) return
    if (
      !window.confirm(
        `Delete all ${total} comment${total === 1 ? "" : "s"} from the preview? This is local only and cannot be undone.`,
      )
    )
      return
    deleteAllComments()
  }

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

  const handlePost = () => {
    const text = draft.trim()
    if (!text) return
    const body_html = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
    createComment(
      { project_id: project.id, body_html },
      { onSuccess: () => setDraft("") },
    )
  }

  const groups = data?.groups || []
  const unlinked = data?.unlinked || []
  const isEmpty = !isLoading && groups.length === 0 && unlinked.length === 0

  return (
    <div className="space-y-6">
      {/* Header: preview-mode notice + bulk delete */}
      <div className="flex items-start gap-3">
        <div className="flex items-start gap-3 p-4 rounded-md bg-accent/5 border border-accent/20 text-sm text-slate-600 dark:text-slate-300 flex-1">
          <Info className="w-4 h-4 mt-0.5 text-accent shrink-0" />
          <p>
            This is a <strong>local preview</strong> of what QACC would post to
            TED — rendered exactly as TED displays it. Comments and deletions
            here are local only and never reach TED.
          </p>
        </div>
        {!isEmpty && (
          <button
            onClick={handleDeleteAll}
            disabled={isDeletingAll}
            title="Delete all comments from the preview (does not touch TED)"
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-red-200 dark:border-red-900/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
          >
            {isDeletingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete all
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-md p-3 bg-slate-50 dark:bg-slate-800/30">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment to the preview thread…"
          rows={3}
          className="w-full resize-y rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handlePost}
            disabled={isPosting || !draft.trim()}
            className="btn-unified-primary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {isPosting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Post comment
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading TED
          comments…
        </div>
      )}

      {isError && (
        <div className="py-8 text-center text-red-500 text-sm">
          Failed to load TED comments.
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <MessageSquare className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">No TED comments yet.</p>
          <p className="text-xs mt-1">
            Run a scan — the report QACC would send to TED will appear here.
          </p>
        </div>
      )}

      {/* Grouped by run — each run is a collapsible section so separate runs
          stay separable and the thread never reads as one continuous block.
          The most recent run (first group) is open by default. */}
      {groups.map((g, i) => (
        <details
          key={g.run.id}
          open={i === 0}
          className="group border border-slate-200 dark:border-slate-700 rounded-md"
        >
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none bg-slate-50 dark:bg-slate-800/40 rounded-md">
            <span className="text-slate-400 text-xs transition-transform group-open:rotate-90">
              ▶
            </span>
            <RunGroupHeader run={g.run} />
            <span className="ml-auto text-slate-400 text-xs">
              {g.comments.length} comment{g.comments.length === 1 ? "" : "s"}
            </span>
          </summary>
          <div className="space-y-3 p-3">
            {g.comments.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                onDelete={deleteComment}
                deleting={isDeleting && deletingId === c.id}
              />
            ))}
          </div>
        </details>
      ))}

      {/* Manual / unlinked comments */}
      {unlinked.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">
            Other comments
          </div>
          <div className="space-y-3 pl-1">
            {unlinked.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                onDelete={deleteComment}
                deleting={isDeleting && deletingId === c.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
