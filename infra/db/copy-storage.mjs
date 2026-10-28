// Copy every file from the OLD Supabase Storage into the new S3 media bucket
// (plan §8 step 4). Key layout matches the app: s3://<MEDIA_BUCKET>/<bucket>/<path>.
//
// Resumable: files already in S3 are skipped, so it can be re-run after a
// failure or again right before cutover to pick up new files.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (OLD project), MEDIA_BUCKET,
//      AWS_REGION; optional COPY_CONCURRENCY (default 8), COPY_BUCKETS (comma list).
// Uses the aws CLI for uploads (in the qacc-dbtools image), no npm packages.
import { spawn, execFileSync } from "node:child_process"

const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "")
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const target = process.env.MEDIA_BUCKET
if (!base || !key || !target) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (old project) and MEDIA_BUCKET")
  process.exit(1)
}
const headers = { Authorization: `Bearer ${key}`, apikey: key }
const concurrency = Math.max(1, Number(process.env.COPY_CONCURRENCY || 8))

async function json(url, init) {
  const r = await fetch(url, { ...init, headers: { ...headers, "Content-Type": "application/json" } })
  if (!r.ok) throw new Error(`${url} → ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

// Supabase lists one folder level at a time; folders come back with id null.
async function listAll(bucket, prefix = "") {
  const files = []
  for (let offset = 0; ; offset += 1000) {
    const page = await json(`${base}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    })
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) files.push(...(await listAll(bucket, path)))
      else files.push({ path, type: item.metadata?.mimetype || "application/octet-stream" })
    }
    if (page.length < 1000) break
  }
  return files
}

function existingKeys() {
  const out = execFileSync("aws", ["s3", "ls", `s3://${target}/`, "--recursive"], {
    maxBuffer: 1 << 30,
    encoding: "utf8",
  })
  // "2026-10-28 08:00:00   12345 public_evidence/run/x.png" → key
  return new Set(out.split("\n").map((l) => l.trim().split(/\s+/).slice(3).join(" ")).filter(Boolean))
}

function upload(s3Key, body, type) {
  return new Promise((resolve, reject) => {
    const p = spawn("aws", ["s3", "cp", "-", `s3://${target}/${s3Key}`, "--content-type", type, "--only-show-errors"], {
      stdio: ["pipe", "inherit", "inherit"],
    })
    p.on("error", reject)
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`aws s3 cp exited ${code}`))))
    p.stdin.end(body)
  })
}

const only = (process.env.COPY_BUCKETS || "").split(",").map((s) => s.trim()).filter(Boolean)
const buckets = (await json(`${base}/storage/v1/bucket`)).map((b) => b.name).filter((b) => !only.length || only.includes(b))
const have = existingKeys()
let copied = 0, skipped = 0, failed = 0

for (const bucket of buckets) {
  const files = await listAll(bucket)
  console.log(`${bucket}: ${files.length} files`)
  const todo = files.filter((f) => {
    if (have.has(`${bucket}/${f.path}`)) return skipped++, false
    return true
  })
  let i = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < todo.length) {
        const f = todo[i++]
        try {
          const r = await fetch(`${base}/storage/v1/object/${bucket}/${encodeURI(f.path)}`, { headers })
          if (!r.ok) throw new Error(`download ${r.status}`)
          await upload(`${bucket}/${f.path}`, Buffer.from(await r.arrayBuffer()), f.type)
          if (++copied % 200 === 0) console.log(`  copied ${copied}…`)
        } catch (e) {
          failed++
          console.error(`  FAILED ${bucket}/${f.path}: ${e.message}`)
        }
      }
    }),
  )
}

console.log(`done: copied ${copied}, already there ${skipped}, failed ${failed}`)
process.exit(failed ? 2 : 0)
