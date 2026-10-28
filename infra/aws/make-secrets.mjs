// Builds infra/terraform/prod.secrets.tfvars.json from infra/aws/secrets.env
// plus generated values. Generated values are kept on re-run (read back from the
// existing file), so running it again never changes passwords by surprise.
// Run through 02-make-secrets.sh. Never prints secret values.
import { createHmac, randomBytes } from "node:crypto"
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs"

const [envFile, outFile] = process.argv.slice(2)
const given = {}
for (const raw of readFileSync(envFile, "utf8").split("\n")) {
  const line = raw.trim()
  if (!line || line.startsWith("#") || !line.includes("=")) continue
  const i = line.indexOf("=")
  let v = line.slice(i + 1).trim()
  if (v.length >= 2 && v[0] === v.at(-1) && `"'`.includes(v[0])) v = v.slice(1, -1)
  if (v) given[line.slice(0, i).trim()] = v
}

const old = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")).app_secrets || {} : {}
const rand = (n) => randomBytes(n).toString("hex")
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
const jwt = (secret, payload) => {
  const head = b64url({ alg: "HS256", typ: "JWT" })
  const body = b64url(payload)
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")
  return `${head}.${body}.${sig}`
}

const generated = {}
generated.PGRST_JWT_SECRET = old.PGRST_JWT_SECRET || rand(32)
generated.SUPABASE_SERVICE_ROLE_KEY =
  old.PGRST_JWT_SECRET === generated.PGRST_JWT_SECRET && old.SUPABASE_SERVICE_ROLE_KEY
    ? old.SUPABASE_SERVICE_ROLE_KEY
    : jwt(generated.PGRST_JWT_SECRET, { role: "service_role", iss: "qacc", iat: Math.floor(Date.now() / 1000) })
generated.QACC_SESSION_SECRET = old.QACC_SESSION_SECRET || rand(32)
generated.RECORDING_TRIGGER_TOKEN = old.RECORDING_TRIGGER_TOKEN || rand(24)
generated.AUTHENTICATOR_PASSWORD = old.AUTHENTICATOR_PASSWORD || rand(24)

const required = ["TED_SSO_SECRET", "TED_WEBHOOK_SECRET", "TED_API_TOKEN", "X_API_KEY", "ENCRYPTION_SECRET"]
const missing = required.filter((k) => !given[k])
for (const k of Object.keys(generated)) delete given[k]

writeFileSync(outFile, JSON.stringify({ app_secrets: { ...given, ...generated } }, null, 2) + "\n")
chmodSync(outFile, 0o600)
console.log(`wrote ${outFile.replace(/^\/repo\//, "")}`)
console.log("from secrets.env:", Object.keys(given).sort().join(", ") || "(none)")
console.log("generated:", Object.keys(generated).join(", "))
if (missing.length) {
  console.log(`\nMISSING (fill these in secrets.env, then run again): ${missing.join(", ")}`)
  process.exit(2)
}
