import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"

// Standalone, chrome-free before/after carousel for AI Fix image enhancement.
// Rendered OUTSIDE AppLayout so it shows nothing of QACC — a plain hosted page
// the TED "AI Fix" link opens. All data comes from a PUBLIC storage manifest
// (public_evidence/fix-preview/<id>.json), so the page needs no auth.

type Slide = { file?: string; before: string; after: string }
type Manifest = {
  page?: string
  site?: string
  recipe?: string
  disclaimer?: string
  fixedCount?: number
  pageTotal?: number
  slides: Slide[]
}

const STYLE = `
.fixprev {
  --bg:#eef1f5; --surface:#fff; --surface-2:#e6eaf0; --ink:#17202e; --ink-soft:#566072;
  --line:#d3dae3; --accent:#0e7c86; --warn:#b45309;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  position:fixed; inset:0; overflow:auto; background:var(--bg); color:var(--ink);
  font-family:var(--sans); line-height:1.5; -webkit-font-smoothing:antialiased; z-index:0;
}
@media (prefers-color-scheme: dark) {
  .fixprev { --bg:#0e131a; --surface:#161d27; --surface-2:#1d2732; --ink:#e7ecf3;
    --ink-soft:#93a1b3; --line:#29333f; --accent:#35b9c5; --warn:#e0a33a; }
}
.fixprev * { box-sizing:border-box; }
.fixprev .wrap { max-width:1000px; margin:0 auto; padding:32px 20px 56px; }
.fixprev .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin:0 0 12px; }
.fixprev h1 { margin:0 0 14px; font-size:clamp(22px,4vw,30px); font-weight:650; letter-spacing:-.01em; }
.fixprev .meta { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:22px; }
.fixprev .chip { display:inline-flex; align-items:center; gap:7px; padding:5px 11px; border-radius:999px; font-size:13px; background:var(--surface); border:1px solid var(--line); color:var(--ink-soft); font-family:var(--mono); }
.fixprev .chip a { color:inherit; }
.fixprev .pill-fixed { background:color-mix(in srgb,var(--accent) 14%,var(--surface)); border-color:color-mix(in srgb,var(--accent) 40%,var(--line)); color:var(--accent); font-weight:600; }
.fixprev .stage { background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:0 8px 24px rgba(20,30,45,.08); }
.fixprev .compare { position:relative; width:100%; user-select:none; touch-action:none; cursor:ew-resize; background:var(--surface-2); }
.fixprev .compare img { display:block; width:100%; height:auto; pointer-events:none; }
.fixprev .compare .after { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.fixprev .tag { position:absolute; top:12px; z-index:3; font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; padding:4px 9px; border-radius:6px; color:#fff; }
.fixprev .tag.a { left:12px; background:color-mix(in srgb,var(--accent) 88%,black); }
.fixprev .tag.b { right:12px; background:color-mix(in srgb,var(--warn) 88%,black); }
.fixprev .handle { position:absolute; top:0; bottom:0; z-index:2; width:2px; transform:translateX(-1px); background:#fff; box-shadow:0 0 0 1px rgba(0,0,0,.25); }
.fixprev .handle::after { content:""; position:absolute; top:50%; left:50%; width:38px; height:38px; transform:translate(-50%,-50%); border-radius:50%; background:#fff; box-shadow:0 2px 8px rgba(0,0,0,.3); }
.fixprev .range-row { padding:14px 16px; }
.fixprev input[type=range] { width:100%; accent-color:var(--accent); }
.fixprev .filename { padding:12px 16px; border-top:1px solid var(--line); font-family:var(--mono); font-size:12.5px; color:var(--ink-soft); word-break:break-all; }
.fixprev .controls { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-top:1px solid var(--line); }
.fixprev .counter { font-family:var(--mono); font-size:13px; color:var(--ink-soft); font-variant-numeric:tabular-nums; }
.fixprev .nav { display:flex; gap:8px; }
.fixprev button.nav-btn { font:inherit; font-size:14px; cursor:pointer; background:var(--surface-2); color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:7px 14px; }
.fixprev button.nav-btn:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
.fixprev button.nav-btn:disabled { opacity:.4; cursor:default; }
.fixprev .dots { display:flex; gap:6px; flex-wrap:wrap; }
.fixprev .dot { width:9px; height:9px; border-radius:50%; background:var(--line); border:none; padding:0; cursor:pointer; }
.fixprev .dot[data-cur=true] { background:var(--accent); }
.fixprev footer { margin-top:22px; color:var(--ink-soft); font-size:13px; }
.fixprev .recipe { font-family:var(--mono); font-size:12px; background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
.fixprev .center { display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; text-align:center; color:var(--ink-soft); }
@media (prefers-reduced-motion: reduce) { .fixprev * { transition:none !important; } }
`

export function FixPreviewPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [i, setI] = useState(0)
  const [pos, setPos] = useState(50)
  const compareRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const base = import.meta.env.VITE_SUPABASE_URL || ""
    const url = `${base}/storage/v1/object/public/public_evidence/fix-preview/${id}.json`
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Preview not found (${r.status})`)
        return r.json()
      })
      .then((m: Manifest) => setData(m))
      .catch((e) => setError(e.message))
  }, [id])

  useEffect(() => {
    document.title = "AI Fix — Image Enhance Review"
  }, [])

  const setPosClamped = (p: number) => setPos(Math.max(0, Math.min(100, p)))
  const posFromEvent = (clientX: number) => {
    const el = compareRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPosClamped(((clientX - r.left) / r.width) * 100)
  }

  useEffect(() => setPos(50), [i])

  const slides = data?.slides || []
  const s = slides[i]

  return (
    <div className="fixprev">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      {error && <div className="center">Couldn’t load this preview.<br />{error}</div>}
      {!error && !data && <div className="center">Loading…</div>}
      {!error && data && s && (
        <div className="wrap">
          <p className="eyebrow">Internal QA · AI Fix</p>
          <h1>Image Enhance — Before / After</h1>
          <div className="meta">
            {data.page && (
              <span className="chip">
                Page: <a href={data.page} target="_blank" rel="noreferrer">{data.page}</a>
              </span>
            )}
            <span className="chip pill-fixed">
              AI Fix · {data.fixedCount ?? slides.length} of {data.pageTotal ?? slides.length} enhanced
            </span>
            {data.site && <span className="chip">{data.site}</span>}
          </div>

          <div className="stage">
            <div
              className="compare"
              ref={compareRef}
              style={{ ["--pos" as any]: `${pos}%` }}
              onPointerDown={(e) => {
                dragging.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                posFromEvent(e.clientX)
              }}
              onPointerMove={(e) => dragging.current && posFromEvent(e.clientX)}
              onPointerUp={() => (dragging.current = false)}
            >
              <span className="tag a">After · webp</span>
              <span className="tag b">Before · flagged</span>
              <img className="before" src={s.before} alt="before (flagged as blurry)" />
              <img
                className="after"
                src={s.after}
                alt="after (AI-enhanced webp)"
                style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
              />
              <div className="handle" style={{ left: `${pos}%` }} />
            </div>

            <div className="range-row">
              <input
                type="range"
                min={0}
                max={100}
                value={pos}
                aria-label="Reveal before / after"
                onChange={(e) => setPosClamped(+e.target.value)}
              />
            </div>

            {s.file && <div className="filename">{s.file}</div>}

            <div className="controls">
              <div className="dots">
                {slides.map((_, k) => (
                  <button
                    key={k}
                    className="dot"
                    data-cur={k === i}
                    aria-label={`Image ${k + 1}`}
                    onClick={() => setI(k)}
                  />
                ))}
              </div>
              <span className="counter">{i + 1} / {slides.length}</span>
              <div className="nav">
                <button className="nav-btn" disabled={i === 0} onClick={() => setI((v) => Math.max(0, v - 1))}>← Prev</button>
                <button className="nav-btn" disabled={i === slides.length - 1} onClick={() => setI((v) => Math.min(slides.length - 1, v + 1))}>Next →</button>
              </div>
            </div>
          </div>

          <footer>
            {data.recipe && <div className="recipe">{data.recipe}</div>}
            {data.disclaimer && <p>{data.disclaimer}</p>}
          </footer>
        </div>
      )}
    </div>
  )
}

export default FixPreviewPage
