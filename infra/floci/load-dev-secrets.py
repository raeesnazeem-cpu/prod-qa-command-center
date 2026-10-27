#!/usr/bin/env python3
"""Copy read-only service keys from the dev .env files into the floci stack.

Writes infra/terraform/dev-secrets.auto.tfvars.json (gitignored) as
{"extra_app_secrets": {...}}; the next `terraform apply` puts them into the
local floci Secrets Manager secret. Values are never printed.

Only the allow-list below is copied. Safety switches (TED_PREVIEW_ONLY,
AI_FIX_MODULE_ENABLED, auth) are NOT secrets and stay forced by Terraform;
push-override tokens (GH_TOKEN_*, GIT_FIX_TOKEN_OVERRIDES) are never copied.

Usage: python3 infra/floci/load-dev-secrets.py
"""
import json
import pathlib
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
ENV_FILES = [REPO / "apps/api/.env", REPO / "apps/worker/.env"]  # later wins
OUT = REPO / "infra/terraform/dev-secrets.auto.tfvars.json"

ALLOW = [
    # TED reads (client page, beta URL, subtasks). Writes stay local: TED_PREVIEW_ONLY.
    "TED_API_TOKEN",
    # AI providers (text + vision fallback chain)
    "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "GEMINI_KEYS", "GROQ_API_KEY",
    "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "COHERE_API_KEY", "CEREBRAS_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN",
    # Check providers
    "SCRAPER_API_KEY", "PAGESPEED_API_KEY", "GOOGLE_PAGESPEED_API_KEY",
    "GOOGLE_PLACES_API_KEY", "HUBSPOT_TOKEN",
    "ENCRYPTION_SECRET",
    # Repo reads for pre/internal/post (AI fix is off, so nothing pushes)
    "GIT_FIX_TOKEN",
]


def parse_env(path: pathlib.Path) -> dict:
    out = {}
    if not path.exists():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        elif " #" in val:  # unquoted inline comment
            val = val.split(" #", 1)[0].rstrip()
        out[key] = val
    return out


def github_status(token: str) -> str:
    req = urllib.request.Request(
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {token}", "User-Agent": "qacc-floci"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return str(r.status)
    except urllib.error.HTTPError as e:
        return str(e.code)
    except Exception as e:  # network
        return f"error ({type(e).__name__})"


merged: dict = {}
for f in ENV_FILES:
    merged.update(parse_env(f))

secrets = {k: merged[k] for k in ALLOW if merged.get(k)}
OUT.write_text(json.dumps({"extra_app_secrets": secrets}, indent=2) + "\n")
OUT.chmod(0o600)

print(f"wrote {OUT.relative_to(REPO)}")
print("copied:", ", ".join(sorted(secrets)) or "(none)")
print("missing:", ", ".join(k for k in ALLOW if k not in secrets) or "(none)")
if "GIT_FIX_TOKEN" in secrets:
    print("GIT_FIX_TOKEN github /user status:", github_status(secrets["GIT_FIX_TOKEN"]))
