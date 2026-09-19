<!-- lp-unify-context: generated 2026-09-12. Edit .agent/CONTEXT.md, not this file — regenerate with `python3 bin/lp-unify-context.py`. -->
# Gmap_Lead_Gen — Antigravity IDE

Part of the unified agent environment under `/Users/viveksharma/Documents/GitHub/`.
**All development happens in this folder and nowhere else.**

Shared brain: [HEADROOM.md](file:///Users/viveksharma/Documents/GitHub/HEADROOM.md) — the project registry,
**Deployment Doctrine**, and **Behavioral Doctrine**.
Workspace overrides to agent defaults: [AGENTS.md](file:///Users/viveksharma/Documents/GitHub/AGENTS.md).

<!-- lane:start -->
## Your lane

**Release Engineer.** Deployments are yours when the user says so — either agent may ship. Before any deploy state
**which account, domain, mechanism, artifact** — see `HEADROOM.md` → Deployment
Doctrine. If you cannot say all four, stop and ask.

<!-- lane:end -->

---

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- headroom:learn:start -->
## Headroom Learned Patterns
*Merged 2026-09-05 from CLAUDE.md (2026-09-04) + AGENTS.md (2026-08-19) — every agent's learnings, one block.*
*Regenerate: `headroom learn --apply` then `python3 bin/lp-unify-context.py`.*

### Environment
*~45,000 tokens/session saved*
- Do not use the GNU `timeout` command in bash commands (fails with command not found on macOS); use Python script wrappers, asyncio, or node timeouts instead.
- When running TypeScript compilation checks, use `npx tsc --noEmit 2>&1 | grep -v "^\.next/types"` to ignore noisy Next.js auto-generated type declarations.

### Commands & Tool Paths
- macOS Environment limitations: GNU `timeout` is not available. Use Python/Node native timeout mechanisms, `curl --max-time`, or Python script limits instead of the shell `timeout` command.
- MacPorts dependency: `httrack` is located at `/opt/local/bin/httrack`. Invoke it using this absolute path if standard path resolution fails.

### Server Ports & Execution
- Next.js dev server runs on port 3000. Clear conflicts with `pkill -f "next"` before running `npm run dev`.
- Python scraper engine runs on port 8000 (`PYTHON_ENGINE_URL = http://127.0.0.1:8000`). Start it inside `python_engine/` using `./venv/bin/python -m uvicorn main:app` after killing existing instances with `pkill -f "uvicorn"`.

### Excel Export & Dependencies
- Use `exceljs` for generating all Lead sheets, specifically to preserve the 28-column template and Excel data validations.
- Do not import, install, or reference the deprecated `xlsx` (SheetJS) library, which has been completely uninstalled and removed from package dependencies.
- `exportLeadsToExcel()` in `src/lib/exportExcel.ts` is async — always await it at call sites (ScraperView, CRMView).

### File Editing Strategy
- Read exact surrounding line context before editing large core files (`ScraperView.tsx`, `nim.ts`, `src/app/api/scrape/route.ts`, `src/app/settings/SettingsView.tsx`) to avoid `String to replace not found` edit failures.

### Environment & CLI Tools
- Run Python scripts using `python_engine/venv/bin/python` or `./venv/bin/python` inside `python_engine/`.
- Do not use the Linux `timeout` CLI utility on macOS (it will fail with command not found / exit code 127). Use native language timers or `curl -m` instead.
- Always `cd` into `python_engine/` before running python tests or commands that import local modules to prevent `module_not_found` errors.

### Server Management
- Terminate background processes with `pkill -f "next"` and `pkill -f "uvicorn"` before launching local servers to prevent `EADDRINUSE` port conflicts.

### Scraper Dependencies
- Run `./venv/bin/python -m playwright install chromium` inside `python_engine/` whenever setting up or testing Playwright SERP/stealth scrapers.
- Verify `httrack` is installed locally via MacPorts/Homebrew (`/opt/local/bin/httrack` or `which httrack`) before invoking the website-mirroring scraper module.

### Build & Type Verification
- Verify TypeScript status using `npx tsc --noEmit 2>&1 | grep -v "^.next/types"` to filter Next.js framework type noise.
<!-- headroom:learn:end -->
