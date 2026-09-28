/**
 * Shared GitHub repo helpers for the theme-type peek (scan start) and the AI-fix
 * clone, so both read the repo name and pick the push/read token the same way.
 */

/**
 * owner/repo from a GitHub URL. Repo names can contain dots (e.g.
 * nuvoaestheticsclinic.gogroth.com), so we must NOT stop the repo capture at the
 * first dot — only strip a trailing `.git` and any trailing slash / query / fragment.
 */
export function ownerRepoFromUrl(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?(?:[?#].*)?$/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

// Per-project token override. Some clients' GitHub repos live under
// a GitHub org/account the shared GIT_FIX_TOKEN cannot access (e.g. TED client
// 1534 → G99agency/nuvoaestheticsclinic.gogroth.com, which has its own
// repo-scoped PAT). This maps a repo (owner/repo) to the env var holding
// its dedicated token, so the correct token is used ONLY for that one repo and
// falls back to GIT_FIX_TOKEN everywhere else.
//
// Config, never per-project code — GIT_FIX_TOKEN_OVERRIDES is a comma-separated
// list of `owner/repo=ENV_VAR_NAME`. Add a new project by adding one line:
//   GIT_FIX_TOKEN_OVERRIDES=G99agency/nuvoaestheticsclinic.gogroth.com=GH_TOKEN_NUVO
export function resolveGitFixToken(
  ownerRepo: { owner: string; repo: string } | null,
): string | undefined {
  if (!ownerRepo) return undefined
  const raw = process.env.GIT_FIX_TOKEN_OVERRIDES
  if (!raw) return undefined
  const key = `${ownerRepo.owner}/${ownerRepo.repo}`.toLowerCase()
  for (const entry of raw.split(",")) {
    const [repoKey, envVar] = entry.split("=").map((s) => s.trim())
    if (!repoKey || !envVar) continue
    if (repoKey.toLowerCase() === key) {
      const val = process.env[envVar]
      if (val) return val
    }
  }
  return undefined
}
