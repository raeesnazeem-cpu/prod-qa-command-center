// Mint an HS256 JWT for PostgREST, e.g. the service key:
//   node infra/db/make-jwt.mjs "$PGRST_JWT_SECRET" service_role
import { createHmac } from "node:crypto";
const [secret, role = "service_role"] = process.argv.slice(2);
if (!secret) { console.error("usage: make-jwt.mjs <secret> [role]"); process.exit(1); }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iss: "qacc", iat: Math.floor(Date.now() / 1000) })}`;
console.log(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`);
