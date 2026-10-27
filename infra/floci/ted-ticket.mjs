// Mint a local TED SSO ticket (same HMAC scheme TED uses; see
// apps/api/src/middleware/tedSso.ts) so the TED-only login can be tested
// without TED. Uses TED_SSO_SECRET from the env (infra/floci/dev-env.sh).
//   node infra/floci/ted-ticket.mjs you@example.com ["Your Name"]
import { createHmac } from "node:crypto";
const secret = process.env.TED_SSO_SECRET;
const [email, name = "Local Tester"] = process.argv.slice(2);
if (!secret || !email) {
  console.error("usage: TED_SSO_SECRET=... node ted-ticket.mjs <email> [name]");
  process.exit(1);
}
const payload = JSON.stringify({ email, name, photo: "", exp: Math.floor(Date.now() / 1000) + 300 });
const sig = createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
console.log(`${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`);
