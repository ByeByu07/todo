# Symphony with OpenCode: Complete Setup Guide

> **Purpose:** Turn project work into isolated, autonomous implementation runs. The orchestrator polls GitHub Issues, spawns OpenCode agents in isolated git worktrees, and manages the full trunk-based development lifecycle.
>
> **Stack:** Turborepo monorepo + Node.js/TypeScript orchestrator + OpenCode CLI agent + GitHub Issues tracker + GitHub CLI + Playwright CLI skills
>
> **Workflow:** Trunk-based development — `main` is the only long-lived branch, short-lived feature branches per issue.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Step 0: Validate Your Environment](#step-0-validate-your-environment)
4. [Step 1: Project Structure](#step-1-project-structure)
5. [Step 2: Install & Configure GH CLI](#step-2-install--configure-gh-cli)
6. [Step 3: Install & Configure OpenCode](#step-3-install--configure-opencode)
7. [Step 4: Install Playwright CLI Skills](#step-4-install-playwright-cli-skills)
8. [Step 5: Create Configuration Files](#step-5-create-configuration-files)
9. [Step 6: Create Agent Skills](#step-6-create-agent-skills)
10. [Step 7: Create Workspace Bootstrap Script](#step-7-create-workspace-bootstrap-script)
11. [Step 8: Create the Orchestrator](#step-8-create-the-orchestrator)
12. [Step 9: Create Shared Packages](#step-9-create-shared-packages)
13. [Step 10: Wire Up the Monorepo](#step-10-wire-up-the-monorepo)
14. [Trunk-Based Development Rules](#trunk-based-development-rules)
15. [Running the System](#running-the-system)
16. [Dashboard](#dashboard)
17. [How It Works (Lifecycle)](#how-it-works-lifecycle)
18. [Troubleshooting Matrix](#troubleshooting-matrix)
19. [Environment Variables Reference](#environment-variables-reference)

---

## Architecture Overview

```
Your Repo (Turborepo)
├── apps/
│   ├── orchestrator/          # Node.js daemon: polls GH Issues, dispatches agents
│   │   ├── src/               # Orchestrator source code
│   │   ├── test/              # Orchestrator unit/integration tests
│   │   ├── dashboard/         # Static HTML dashboard served by orchestrator HTTP API
│   │   └── package.json
│   └── web/                   # Your existing Next.js app (kept as-is)
├── packages/
│   ├── github-client/         # GitHub CLI wrapper + API adapter
│   ├── symphony-config/       # WORKFLOW.md parser, typed config, dynamic reload
│   ├── worktree-manager/      # Git worktree lifecycle per issue
│   ├── agent-runner/          # OpenCode CLI spawner + output streaming
│   ├── ui/                    # Shared UI components (existing)
│   ├── eslint-config/         # Shared ESLint config (existing)
│   └── typescript-config/     # Shared TS config (existing)
├── .opencode/                 # OpenCode configuration & agent skills
│   ├── skills/
│   │   ├── commit/SKILL.md
│   │   ├── push/SKILL.md
│   │   ├── pull/SKILL.md
│   │   ├── land/SKILL.md
│   │   └── github/SKILL.md
│   └── worktree_init.sh
├── WORKFLOW.md                # Repo-owned orchestration policy (YAML front matter + prompt)
├── AGENTS.md                  # Project conventions for coding agents
├── docs/                      # This documentation
├── symphony.db                # SQLite run history (auto-created)
└── package.json               # Root Turborepo manifest
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Orchestrator** | Polls GitHub Issues every 30s, maintains dispatch queue, manages agent lifecycle, handles retries + reconciliation |
| **GitHub Client** | Wraps `gh` CLI: list issues, check auth, create PRs, check CI status, normalize issue data |
| **Symphony Config** | Parses `WORKFLOW.md` (YAML front matter + Markdown prompt), watches for changes, resolves `$VAR` env indirection |
| **Worktree Manager** | Creates/reuses git worktrees per issue, runs lifecycle hooks, enforces path safety invariants |
| **Agent Runner** | Spawns `opencode` in worktree with rendered prompt, streams stdout/stderr, handles timeouts |
| **Dashboard** | Static HTML served by orchestrator HTTP API (`GET /`) showing active runs, queue, logs |

---

## Prerequisites

### Required Software

| Tool | Minimum Version | Purpose | Install Command |
|------|----------------|---------|-----------------|
| Node.js | 22.x | Orchestrator runtime | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| npm | 11.x | Package manager | Comes with Node.js |
| Git | 2.34+ | Worktree support | [git-scm.com](https://git-scm.com) |
| GitHub CLI (`gh`) | 2.60+ | Issue tracking, PR creation | See Step 2 |
| OpenCode (`opencode`) | Latest | AI coding agent | See Step 3 |
| Playwright CLI | Latest | Browser testing skills | See Step 4 |
| Turborepo | Latest | Monorepo orchestration | `npm install -g turbo` |

### Required Accounts & Tokens

- **GitHub account** with push access to the target repository
- **OpenCode provider API key** (OpenAI, Anthropic, Google, etc.)

---

## Step 0: Validate Your Environment

Before doing anything, verify each tool is installed and working.

### 0.1 Check Node.js

```bash
node --version
# Expected: v22.x.x or higher

npm --version
# Expected: 11.x.x or higher
```

**If missing:** Install from [nodejs.org](https://nodejs.org) or use nvm:
```bash
nvm install 22
nvm use 22
```

### 0.2 Check Git

```bash
git --version
# Expected: 2.34.0 or higher (worktree support required)
```

**If version < 2.34:** Update Git. On macOS: `brew install git`. On Windows: download from git-scm.com.

### 0.3 Check GitHub CLI

```bash
gh --version
# Expected: gh version 2.60+ (or any version)
```

**If missing:** See Step 2 for installation.

### 0.4 Check OpenCode

```bash
opencode --version
# Expected: opencode version x.x.x
```

**If missing:** See Step 3 for installation.

### 0.5 Check GitHub Auth

```bash
gh auth status
```

**Expected output:**
```
✓ Logged in to github.com as YOUR_USERNAME (GH_TOKEN)
✓ Git operations for github.com configured to use https protocol.
✓ Token: gho_************************************
✓ Token scopes: repo, read:org, gist
```

**If not authenticated:** See Step 2.3.

### 0.6 Check Repository

```bash
git status
```

**If not in a git repo:** Initialize one:
```bash
git init
git remote add origin https://github.com/OWNER/REPO.git
```

---

## Step 1: Project Structure

This guide assumes a **Turborepo** monorepo initialized with `npx create-turbo@latest` or similar. The default Turborepo creates:

```
todo/
├── apps/
│   ├── docs/          # REMOVE THIS (we use root docs/ instead)
│   └── web/           # KEEP AS-IS (your existing Next.js app)
├── packages/
│   ├── eslint-config/
│   ├── typescript-config/
│   └── ui/
├── package.json
└── turbo.json
```

### 1.1 Remove `apps/docs/`

We remove the Turborepo starter `apps/docs/` because project documentation lives in the root `docs/` folder.

```bash
rm -rf apps/docs
```

Update root `package.json` workspaces if needed:
```json
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

### 1.2 Keep `apps/web/`

Do **not** modify `apps/web/`. It remains your independent Next.js application. The Symphony dashboard is served by the orchestrator itself, not by a separate Next.js app.

---

## Step 2: Install & Configure GH CLI

### 2.1 Install GH CLI

**macOS (Homebrew):**
```bash
brew install gh
```

**Windows (winget):**
```bash
winget install --id GitHub.cli
```

**Windows (Scoop):**
```bash
scoop install gh
```

**Linux (various):**
```bash
# Debian/Ubuntu
sudo apt install gh

# Fedora
sudo dnf install gh

# Arch
sudo pacman -S github-cli
```

**Verify installation:**
```bash
gh --version
```

**If `command not found` after install:**
- macOS: `brew doctor` or restart terminal
- Windows: Restart terminal or add to PATH manually
- Linux: Ensure `/usr/local/bin` is in PATH

### 2.2 Authenticate GH CLI

```bash
gh auth login
```

**Interactive prompts:**
1. **What account do you want to log into?** → `GitHub.com`
2. **What is your preferred protocol for Git operations on this host?** → `HTTPS` (recommended) or `SSH`
3. **Authenticate Git with your GitHub credentials?** → `Yes`
4. **How would you like to authenticate?** → `Login with a web browser` (easiest)

**Browser flow:**
- A one-time code will appear in your terminal (e.g., `ABCD-1234`)
- Press Enter to open the browser
- Paste the code at github.com/login/device
- Authorize the GitHub CLI app

**Verify auth:**
```bash
gh auth status
```

**Expected:**
```
✓ Logged in to github.com as YOUR_USERNAME
```

### 2.3 Troubleshoot Auth Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `gh auth status` shows "not logged in" | Never authenticated | Run `gh auth login` |
| `gh auth status` shows expired token | Token expired | Run `gh auth login` again |
| `gh auth status` shows wrong user | Logged into wrong account | Run `gh auth logout` then `gh auth login` |
| `gh: HTTP 401` on API calls | Bad credentials | Re-authenticate with `gh auth login` |
| `gh: HTTP 403` on API calls | Token lacks scopes | Re-authenticate and ensure `repo` scope is granted |
| Browser flow fails | Corporate firewall/proxy | Use `gh auth login --with-token` and paste a PAT |

**Manual token alternative:**
```bash
# Create a Personal Access Token at https://github.com/settings/tokens
# Required scopes: repo, read:org, gist

echo "ghp_YOUR_TOKEN_HERE" | gh auth login --with-token
```

### 2.4 Verify Repository Access

```bash
gh repo view OWNER/REPO
```

**Expected:** Metadata about your repo.

**If "HTTP 404":**
- Check the repo name is correct
- Ensure you have access (private repos need `repo` scope)
- Verify you're authenticated to github.com (not GitHub Enterprise)

---

## Step 3: Install & Configure OpenCode

### 3.1 Install OpenCode

**Recommended (Homebrew):**
```bash
brew install anomalyco/tap/opencode
```

**npm (cross-platform):**
```bash
npm install -g opencode-ai@latest
```

**Bun:**
```bash
bun install -g opencode-ai@latest
```

**Windows (Scoop):**
```bash
scoop install opencode
```

**Windows (Chocolatey):**
```bash
choco install opencode
```

**Verify installation:**
```bash
opencode --version
```

**If `command not found`:**
- Check the installation directory is in PATH
- npm global: `npm bin -g` shows the path
- Restart terminal after install

### 3.2 Configure OpenCode Providers

Create `.opencode/opencode.jsonc` in your project root:

```json
{
  "providers": {
    "openai": {
      "apiKey": "$OPENAI_API_KEY",
      "disabled": false
    },
    "anthropic": {
      "apiKey": "$ANTHROPIC_API_KEY",
      "disabled": false
    }
  },
  "agents": {
    "build": {
      "model": "claude-3.7-sonnet",
      "maxTokens": 5000
    },
    "plan": {
      "model": "claude-3.7-sonnet",
      "maxTokens": 5000
    }
  },
  "permission": {
    "skill": {
      "*": "allow",
      "experimental-*": "ask"
    }
  }
}
```

**Set environment variables:**
```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, or ~/.bash_profile)
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Reload shell:**
```bash
source ~/.bashrc  # or ~/.zshrc
```

### 3.3 Verify OpenCode Works

```bash
# Run a single non-interactive prompt
opencode -p "Say hello" -q
```

**Expected:** "Hello" printed to stdout.

**If "API key not found":**
- Verify env vars are set: `echo $OPENAI_API_KEY`
- Verify `.opencode/opencode.jsonc` references correct env var names
- Try setting key directly in config (not recommended for security)

**If "model not available":**
- Check your API key has access to the model
- Try a different model in config

---

## Step 4: Install Playwright CLI Skills

### 4.1 Install Playwright CLI

```bash
npm install -g @playwright/cli
```

**Verify:**
```bash
playwright-cli --version
```

### 4.2 Install Skill Files

```bash
playwright-cli install --skills
```

**What this does:**
- Downloads skill reference files to `~/.playwright/skills/`
- Agents can reference these for browser automation commands

### 4.3 Verify Skills

```bash
ls ~/.playwright/skills/
```

**Expected:** Directories with skill files.

**If skills don't show up in agent:**
- Ensure Playwright CLI is in PATH
- The agent references skills via the `skill` tool; verify permissions in `opencode.jsonc`

---

## Step 5: Create Configuration Files

### 5.1 WORKFLOW.md

This is the **core repository contract**. It defines tracker settings, workspace rules, hooks, agent limits, and the prompt template.

Create `WORKFLOW.md` at project root:

```markdown
---
tracker:
  kind: github
  token: $GITHUB_TOKEN
  repo: owner/repo
  labels:
    - symphony
  active_states:
    - open
  terminal_states:
    - closed

polling:
  interval_ms: 30000

workspace:
  root: ./.symphony/workspaces

hooks:
  after_create: |
    # Clone repo into fresh worktree
    git clone --depth 1 https://github.com/{{ tracker.repo }}.git .
    # Install dependencies
    if [ -f "package.json" ]; then
      npm install
    fi
    # Copy environment files if they exist in parent
    cp ../.env .env 2>/dev/null || true
    cp ../.env.local .env.local 2>/dev/null || true
  before_run: |
    git fetch origin main
  after_run: |
    echo "Run completed for {{ issue.identifier }}"
  before_remove: |
    echo "Cleaning up workspace for {{ issue.identifier }}"
  timeout_ms: 120000

agent:
  max_concurrent_agents: 3
  max_turns: 10
  max_retry_backoff_ms: 300000

codex:
  command: "opencode -p"
  turn_timeout_ms: 1800000
  stall_timeout_ms: 600000
---

You are working on GitHub Issue #{{ issue.number }}: {{ issue.title }}

Repository: {{ tracker.repo }}
Branch: symphony/{{ issue.number }}-{{ issue.title | slugify }}
Base: main

## Context

Issue URL: {{ issue.url }}
State: {{ issue.state }}
Labels: {{ issue.labels }}

{% if issue.description %}
Description:
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

{% if attempt %}
Continuation context:
- This is retry attempt #{{ attempt }} because the issue is still in an active state.
- Resume from the current workspace state instead of restarting from scratch.
- Do not repeat already-completed investigation or validation unless needed for new code changes.
{% endif %}

## Instructions

1. Read the issue description carefully.
2. Create a focused, minimal change following trunk-based development.
3. Keep commits small and logical.
4. When complete:
   - Commit with a conventional commit message: `feat:`, `fix:`, `docs:`, etc.
   - Push to origin: `git push origin symphony/{{ issue.number }}-{{ issue.title | slugify }}`
   - Open a PR using `gh pr create --title "..." --body "Fixes #{{ issue.number }}"`
   - Ensure PR has label `symphony`
5. Run validation before finishing: `npm test`, `npm run check-types`, `npm run lint`
6. If changes affect UI, capture screenshots with Playwright as proof of work.

## Available Tools

- `git` for version control
- `gh` for GitHub operations (PRs, issues, checks)
- `opencode` skills: `commit`, `push`, `pull`, `land`, `github`
- `playwright-cli` for browser testing
- `bash` for shell commands

## Guardrails

- Work ONLY in the provided workspace directory.
- Do NOT touch any other path on the filesystem.
- Do NOT ask humans to perform follow-up actions.
- If blocked by missing auth/tools, document in a workpad comment and stop.
- If a PR already exists for this branch and is closed/merged, create a fresh branch from `origin/main`.
```

**Key configuration fields:**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `tracker.kind` | Yes | — | `github` (we adapted from `linear`) |
| `tracker.repo` | Yes | — | `owner/repo` format |
| `tracker.labels` | No | `["symphony"]` | Issues with these labels are picked up |
| `tracker.active_states` | No | `["open"]` | States that trigger dispatch |
| `tracker.terminal_states` | No | `["closed"]` | States that trigger cleanup |
| `polling.interval_ms` | No | `30000` | Poll interval in milliseconds |
| `workspace.root` | No | `./.symphony/workspaces` | Where worktrees are created |
| `hooks.after_create` | No | — | Runs when workspace is first created |
| `hooks.before_run` | No | — | Runs before each agent attempt |
| `hooks.after_run` | No | — | Runs after agent completes |
| `hooks.before_remove` | No | — | Runs before workspace deletion |
| `hooks.timeout_ms` | No | `60000` | Hook execution timeout |
| `agent.max_concurrent_agents` | No | `10` | Global concurrency limit |
| `agent.max_turns` | No | `20` | Max back-to-back turns per session |
| `agent.max_retry_backoff_ms` | No | `300000` | Max retry backoff (5 min) |
| `codex.command` | No | `opencode -p` | Agent executable command |
| `codex.turn_timeout_ms` | No | `3600000` | Single turn timeout (1 hour) |
| `codex.stall_timeout_ms` | No | `300000` | Stall detection timeout (5 min) |

### 5.2 AGENTS.md

Project conventions for coding agents. Create at project root:

```markdown
# Project Agent Conventions

## Environment

- Node.js: 22.x
- Package manager: npm 11.x
- Monorepo tool: Turborepo
- Git workflow: Trunk-based development

## Codebase Conventions

- Runtime config is loaded from `WORKFLOW.md` front matter.
- Workspace safety is critical: never run agent outside the per-issue worktree.
- Workspaces are created under `.symphony/workspaces/<sanitized-issue-id>/`.
- Prefer `npm` for scripts; respect existing `turbo.json` tasks.
- Follow existing code style in each package/app.

## Testing Requirements

Before considering work complete:

1. Run `npm run check-types` (TypeScript type checking)
2. Run `npm run lint` (ESLint)
3. Run `npm test` (if test suite exists)
4. If UI changes: run Playwright validation and capture screenshots

## PR Requirements

- Use conventional commit messages
- PR title should be clear and descriptive
- PR body must include "Fixes #<issue-number>"
- Add `symphony` label to PR
- Ensure CI checks pass before moving to Human Review

## Docs Update Policy

If behavior or config changes, update docs in the same PR:
- `WORKFLOW.md` for workflow/config contract changes
- `AGENTS.md` for agent convention changes
- `docs/` for setup/operation guide changes
```

---

## Step 6: Create Agent Skills

OpenCode skills follow a standard format. Each skill is a directory with a `SKILL.md` file containing YAML front matter.

### 6.1 Directory Structure

```
.opencode/
└── skills/
    ├── commit/
    │   └── SKILL.md
    ├── push/
    │   └── SKILL.md
    ├── pull/
    │   └── SKILL.md
    ├── land/
    │   └── SKILL.md
    └── github/
        └── SKILL.md
```

### 6.2 Skill: commit

`.opencode/skills/commit/SKILL.md`:

```markdown
---
name: commit
description: Produce clean, logical commits following conventional commits
---

## Guidelines

- Use conventional commit format: `<type>: <description>`
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- Keep commits small and focused on a single concern
- Write descriptive commit messages in present tense
- Example: `feat: add dark mode toggle`
- Example: `fix: resolve race condition in useEffect`

## Steps

1. Stage only related changes: `git add <files>`
2. Write commit message: `git commit -m "type: description"`
3. If you need to amend: `git commit --amend --no-edit`
```

### 6.3 Skill: push

`.opencode/skills/push/SKILL.md`:

```markdown
---
name: push
description: Push branch to remote and handle conflicts
---

## Guidelines

- Always check current branch before pushing
- Use `git push -u origin <branch>` for first push
- If push rejected, pull latest changes first
- Resolve conflicts manually if they occur

## Steps

1. Check branch: `git branch --show-current`
2. Push: `git push origin $(git branch --show-current)`
3. If rejected:
   - `git pull origin main --rebase`
   - Resolve conflicts
   - `git push origin $(git branch --show-current)`
```

### 6.4 Skill: pull

`.opencode/skills/pull/SKILL.md`:

```markdown
---
name: pull
description: Sync branch with latest origin/main before work
---

## Guidelines

- Always pull latest `origin/main` before starting new work
- Use rebase to keep linear history: `git pull --rebase origin main`
- If conflicts occur, resolve them before continuing

## Steps

1. Fetch latest: `git fetch origin main`
2. Rebase: `git pull --rebase origin main`
3. If conflicts:
   - Open conflicted files and resolve
   - `git add <files>`
   - `git rebase --continue`
4. Verify: `git log --oneline -5`
```

### 6.5 Skill: land

`.opencode/skills/land/SKILL.md`:

```markdown
---
name: land
description: Safely merge an approved PR following trunk-based workflow
---

## Guidelines

- ONLY run this when PR is approved and issue is in "Merging" state
- Do NOT call `gh pr merge` directly — follow this skill's steps
- Ensure CI is green before merging
- Use squash merge for clean history

## Steps

1. Verify PR checks are passing: `gh pr checks`
2. Verify PR is approved: `gh pr view --json reviews`
3. Merge with squash: `gh pr merge --squash --delete-branch`
4. Verify merge succeeded: `gh pr view`
5. Move issue to "Done" state
```

### 6.6 Skill: github

`.opencode/skills/github/SKILL.md`:

```markdown
---
name: github
description: Interact with GitHub Issues and PRs via gh CLI
---

## Available Operations

### List open issues
```bash
gh issue list --state open --label symphony
```

### View issue details
```bash
gh issue view <number> --json number,title,body,state,labels
```

### Create PR
```bash
gh pr create --title "feat: ..." --body "Fixes #<issue-number>" --label symphony
```

### View PR status
```bash
gh pr view <number> --json state,checks,reviewDecision
```

### Check CI status
```bash
gh pr checks <number>
```

### Add PR comment
```bash
gh pr comment <number> --body "..."
```

### Close issue
```bash
gh issue close <number>
```
```

---

## Step 7: Create Workspace Bootstrap Script

Create `.opencode/worktree_init.sh`:

```bash
#!/bin/bash
set -e

# Symphony Workspace Bootstrap Script
# Runs in hooks.after_create when a new worktree is created

echo "[symphony] Bootstrapping workspace: $(pwd)"

# 1. Clone the repository (if not already present)
if [ ! -d ".git" ]; then
  echo "[symphony] Cloning repository..."
  REPO_URL="${SOURCE_REPO_URL:-https://github.com/${GITHUB_REPO}.git}"
  git clone --depth 1 "$REPO_URL" .
fi

# 2. Install dependencies
if [ -f "package.json" ]; then
  echo "[symphony] Installing dependencies..."
  npm install
fi

# 3. Copy environment files from parent workspace root
if [ -f "../.env" ]; then
  echo "[symphony] Copying .env..."
  cp ../.env .env
fi

if [ -f "../.env.local" ]; then
  echo "[symphony] Copying .env.local..."
  cp ../.env.local .env.local
fi

# 4. Run any project-specific setup
if [ -f "setup.sh" ]; then
  echo "[symphony] Running project setup.sh..."
  bash setup.sh
fi

echo "[symphony] Workspace ready: $(pwd)"
```

Make it executable:
```bash
chmod +x .opencode/worktree_init.sh
```

---

## Step 8: Create the Orchestrator

The orchestrator is a Node.js daemon. For brevity, this guide describes the key modules. Full implementation code would be in `apps/orchestrator/src/`.

### 8.1 Package Setup

`apps/orchestrator/package.json`:

```json
{
  "name": "@repo/orchestrator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@repo/github-client": "*",
    "@repo/symphony-config": "*",
    "@repo/worktree-manager": "*",
    "@repo/agent-runner": "*",
    "better-sqlite3": "^12.0.0",
    "chokidar": "^4.0.0",
    "express": "^5.0.0",
    "liquidjs": "^10.0.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "5.9.2",
    "vitest": "^3.0.0"
  }
}
```

### 8.2 Core Modules

| Module | File | Purpose |
|--------|------|---------|
| Entry | `src/index.ts` | Startup validation, signal handling, start orchestrator |
| Orchestrator | `src/orchestrator.ts` | Poll loop, dispatch, retry queue, reconciliation |
| State | `src/state.ts` | In-memory runtime state (running, claimed, retry) |
| Database | `src/database.ts` | SQLite schema & queries |
| Logger | `src/logger.ts` | Structured JSON logging |
| Server | `src/server.ts` | Express HTTP API + static dashboard |

### 8.3 Orchestrator State Machine

```
Unclaimed → Claimed → Running → Succeeded/Failed/TimedOut/Stalled
                    ↘ RetryQueued ─┘
```

### 8.4 Poll Tick Sequence (every 30s)

1. Reconcile running issues (check GitHub state, stall detection)
2. Validate config (`WORKFLOW.md` parseable, GH auth, opencode found)
3. Fetch candidate issues (`label:symphony`, `state:open`)
4. Sort by priority/created_at
5. Dispatch while slots available

---

## Step 9: Create Shared Packages

### 9.1 github-client

`packages/github-client/package.json`:

```json
{
  "name": "@repo/github-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "5.9.2"
  }
}
```

Key exports:
- `isAuthenticated()` — check `gh auth status`
- `listIssues({ labels, state })` — fetch open issues
- `getIssue(id)` — fetch single issue
- `normalizeIssue(ghIssue)` — convert to Symphony Issue model

### 9.2 symphony-config

`packages/symphony-config/package.json`:

```json
{
  "name": "@repo/symphony-config",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "liquidjs": "^10.0.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "5.9.2"
  }
}
```

Key exports:
- `loadWorkflow(path)` — parse YAML front matter + Markdown body
- `watchWorkflow(path, callback)` — fs.watch for dynamic reload
- `resolveEnvVars(config)` — replace `$VAR_NAME` with env values
- `renderPrompt(template, variables)` — Liquid template rendering

### 9.3 worktree-manager

`packages/worktree-manager/package.json`:

```json
{
  "name": "@repo/worktree-manager",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "5.9.2"
  }
}
```

Key exports:
- `create(identifier, branch, baseBranch)` — git worktree add
- `remove(identifier)` — git worktree remove + cleanup
- `runHook(script, cwd, timeoutMs)` — execute shell hook
- `sanitizeIdentifier(id)` — replace illegal chars with `_`

### 9.4 agent-runner

`packages/agent-runner/package.json`:

```json
{
  "name": "@repo/agent-runner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "5.9.2"
  }
}
```

Key exports:
- `spawn(prompt, workspacePath)` — run `opencode -p "..." -c <path>`
- `kill(pid)` — SIGTERM/SIGKILL agent process
- `streamOutput(childProcess, onData)` — pipe stdout/stderr to logger

---

## Step 10: Wire Up the Monorepo

### 10.1 Root package.json

Ensure workspaces include the new packages:

```json
{
  "name": "todo",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\"",
    "check-types": "turbo run check-types"
  },
  "devDependencies": {
    "prettier": "^3.7.4",
    "turbo": "^2.9.12",
    "typescript": "5.9.2"
  },
  "engines": {
    "node": ">=22"
  },
  "packageManager": "npm@11.11.0",
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

### 10.2 turbo.json

Add orchestrator tasks:

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "check-types": {
      "dependsOn": ["^check-types"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### 10.3 Install Dependencies

```bash
npm install
```

### 10.4 Build Packages

```bash
npm run build
```

---

## Trunk-Based Development Rules

### Branch Naming Convention

```
symphony/<issue-number>-<slugified-title>
```

Examples:
- `symphony/42-add-dark-mode`
- `symphony/156-fix-login-redirect`

### Workflow States (GitHub Issues)

| State | Meaning | Orchestrator Action |
|-------|---------|---------------------|
| `open` + label `symphony` | Ready for agent | Dispatch agent |
| `closed` | Done/merged | Clean up worktree |

### PR Requirements

1. Branch from latest `origin/main`
2. Small, focused commits
3. Push frequently
4. Open PR with `gh pr create`
5. Include "Fixes #<issue-number>" in PR body
6. Add `symphony` label
7. Wait for CI to pass
8. Human review → merge via `land` skill

---

## Running the System

### Development Mode

```bash
# Terminal 1: Run orchestrator with dashboard
cd apps/orchestrator
npm run dev

# Terminal 2: Run your web app (optional)
cd apps/web
npm run dev
```

### Production Mode

```bash
# Build everything
npm run build

# Start orchestrator
cd apps/orchestrator
npm start

# Or from root
npx turbo run start --filter=@repo/orchestrator
```

### Environment Variables

Create `.env` at project root:

```bash
# Required
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx        # Only if not using gh CLI auth
GITHUB_REPO=owner/repo                        # Target repository

# Optional
SYMPHONY_WORKFLOW_PATH=./WORKFLOW.md
SYMPHONY_WORKSPACE_ROOT=./.symphony/workspaces
SYMPHONY_DB_PATH=./symphony.db
SYMPHONY_LOG_LEVEL=info                      # debug | info | warn | error
SYMPHONY_DASHBOARD_PORT=3456                 # HTTP dashboard port

# OpenCode (passed to agent environment)
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# Playwright (optional)
PLAYWRIGHT_BROWSERS_PATH=0
```

---

## Dashboard

The orchestrator serves a lightweight dashboard at:

```
http://localhost:3456/
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Human-readable dashboard (HTML) |
| `/api/v1/state` | GET | Runtime state JSON |
| `/api/v1/:issue_identifier` | GET | Issue-specific details |
| `/api/v1/refresh` | POST | Trigger immediate poll/reconcile |

### Dashboard Features

- Active agent runs (issue, branch, status, duration)
- Issue queue (open symphony-labeled issues)
- Run history (success/fail/timeout outcomes)
- Live logs (stdout/stderr from agents)
- Token usage estimates
- Manual actions (retry, cancel)

---

## How It Works (Lifecycle)

### Step-by-Step Agent Lifecycle

```
+---------------------------------------------------------------------+
| 1. ORCHESTRATOR detects GitHub Issue #42 "Add dark mode"            |
|    (label: symphony, state: open)                                   |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
| 2. SANITY CHECKS                                                    |
|    gh auth status        -> If FAIL, log error, skip dispatch       |
|    opencode --version    -> If FAIL, log error, skip dispatch       |
|    git status            -> If dirty, log warning, proceed          |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
| 3. WORKSPACE CREATION                                               |
|    - Sanitize: "42-add-dark-mode" -> "42_add_dark_mode"             |
|    - Create worktree:                                               |
|      git worktree add .symphony/42_add_dark_mode                    |
|        -b symphony/42-add-dark-mode                                 |
|    - Run hooks.after_create:                                        |
|      -> clone repo, npm install, copy .env                          |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
| 4. PROMPT BUILDING                                                  |
|    - Parse WORKFLOW.md front matter                                 |
|    - Render prompt template with issue data (Liquid)                |
|    - Inject trunk-based rules and available skills                  |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
| 5. AGENT EXECUTION                                                  |
|    - Spawn: opencode -p "<rendered_prompt>" -c <worktree_path>     |
|    - Stream stdout/stderr to dashboard + logs                       |
|    - Agent has access to: bash, gh, git, playwright-cli, skills     |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
| 6. AGENT COMPLETES                                                  |
|    - Commits: git commit -m "feat: add dark mode"                   |
|    - Pushes: git push origin symphony/42-add-dark-mode              |
|    - Opens PR: gh pr create --title "..." --body "Fixes #42"       |
|    - Labels PR: gh pr edit --add-label symphony                     |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
| 7. POST-RUN                                                         |
|    - Run hooks.after_run                                            |
|    - Log outcome to symphony.db                                     |
|    - Schedule 1s retry to check if issue still active               |
|    - If issue closed -> run hooks.before_remove -> delete worktree  |
+---------------------------------------------------------------------+
```

---

## Troubleshooting Matrix

### GH CLI Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `gh: command not found` | Not installed | Install per Step 2.1 |
| `gh auth status` -> "not logged in" | Never authenticated | `gh auth login` |
| `gh auth status` -> expired | Token expired | `gh auth login` again |
| `gh auth status` -> wrong user | Wrong account | `gh auth logout && gh auth login` |
| `gh: HTTP 401` | Bad token | Re-authenticate |
| `gh: HTTP 403` | Insufficient scopes | Re-authenticate with `repo` scope |
| `gh: HTTP 404` on repo | Wrong repo name or no access | Verify `OWNER/REPO` and permissions |
| Browser auth fails | Firewall/proxy | Use `gh auth login --with-token` |
| `command not found` after install | PATH issue | Restart terminal or add to PATH |

### OpenCode Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `opencode: command not found` | Not installed or not in PATH | Install per Step 3.1, check PATH |
| "API key not found" | Env var missing | Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` |
| "Model not available" | Key lacks model access | Check subscription/plan |
| "Permission denied" on skill | Skill permission set to deny | Update `opencode.jsonc` permission.skill |
| Agent hangs | Prompt too complex or model slow | Increase `codex.turn_timeout_ms` |
| Agent exits immediately | Bad prompt or missing cwd | Check `-c <path>` is valid |

### Orchestrator Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `WORKFLOW.md not found` | File missing | Create at project root |
| `workflow_parse_error` | Invalid YAML front matter | Validate YAML syntax |
| `template_render_error` | Unknown Liquid variable | Check template variables match issue fields |
| No issues dispatched | No matching issues | Check GH issue has `symphony` label and state `open` |
| Workspace creation fails | Git worktree error | Ensure git >= 2.34, check branch name is valid |
| Agent killed immediately | Hook timeout or failure | Check hook scripts, increase `hooks.timeout_ms` |
| Dashboard not accessible | Port conflict | Change `SYMPHONY_DASHBOARD_PORT` |
| SQLite error | Permission or corrupt DB | Delete `symphony.db` to recreate |

### Git / Worktree Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `git worktree add` fails | Branch already exists | Delete existing branch or use unique name |
| `git worktree add` fails | Dirty working tree | Commit or stash changes in main repo |
| Worktree not cleaned up | before_remove hook failed | Manual cleanup: `git worktree remove <path>` |
| Path escape attempt | Malicious identifier | Check sanitizeIdentifier replaces all illegal chars |
| Workspace outside root | Config error | Verify `workspace.root` is absolute or relative to WORKFLOW.md |

### Playwright Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `playwright-cli: command not found` | Not installed | `npm install -g @playwright/cli` |
| Skills not loaded | `install --skills` not run | `playwright-cli install --skills` |
| Browser launch fails | Browsers not installed | `playwright-cli install` (without --skills) |
| Screenshot fails | Page not loaded | Ensure `navigate` before `screenshot` |

### General Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `npm install` fails in worktree | Network or registry issue | Check `.npmrc`, try `npm install --registry https://registry.npmjs.org` |
| Env vars not resolved | `$VAR` not set | Export variables or set in `.env` |
| Rate limited by GitHub | Too many API calls | Orchestrator will backoff; check `polling.interval_ms` |
| Concurrent runs conflict | max_concurrent_agents too high | Lower in `WORKFLOW.md` or check resource limits |

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | No* | — | GitHub PAT (only if not using `gh auth login`) |
| `GITHUB_REPO` | Yes | — | Target repo in `owner/repo` format |
| `SYMPHONY_WORKFLOW_PATH` | No | `./WORKFLOW.md` | Path to workflow config |
| `SYMPHONY_WORKSPACE_ROOT` | No | `./.symphony/workspaces` | Worktree directory |
| `SYMPHONY_DB_PATH` | No | `./symphony.db` | SQLite database path |
| `SYMPHONY_LOG_LEVEL` | No | `info` | Log verbosity |
| `SYMPHONY_DASHBOARD_PORT` | No | `3456` | HTTP dashboard port |
| `OPENAI_API_KEY` | No** | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | No** | — | Anthropic API key |
| `PLAYWRIGHT_BROWSERS_PATH` | No | — | Playwright browser install path |

*Required only if `gh` is not authenticated via `gh auth login`
**At least one provider key required for OpenCode to function

---

## Quick Start Checklist

- [ ] Node.js 22+ installed
- [ ] Git 2.34+ installed
- [ ] GitHub CLI installed and authenticated (`gh auth status`)
- [ ] OpenCode installed and working (`opencode --version`)
- [ ] Playwright CLI installed (`playwright-cli install --skills`)
- [ ] `WORKFLOW.md` created at project root
- [ ] `AGENTS.md` created at project root
- [ ] `.opencode/skills/` created with 5 skills
- [ ] `.opencode/worktree_init.sh` created and executable
- [ ] `apps/docs/` removed (if using Turborepo starter)
- [ ] `apps/web/` kept as-is
- [ ] Orchestrator package created in `apps/orchestrator/`
- [ ] Shared packages created in `packages/`
- [ ] Root `package.json` workspaces configured
- [ ] `npm install` run at root
- [ ] `npm run build` succeeds
- [ ] Environment variables set (`.env` or shell profile)
- [ ] Orchestrator starts without errors (`npm run dev` in orchestrator)
- [ ] Dashboard accessible at `http://localhost:3456`
- [ ] Create a test GitHub Issue with label `symphony`
- [ ] Verify orchestrator picks up the issue
- [ ] Verify worktree is created
- [ ] Verify agent runs and completes

---

## Notes for Other Projects

To adapt this setup for another repository:

1. **Change `tracker.repo`** in `WORKFLOW.md` to your `owner/repo`
2. **Update `hooks.after_create`** to match your project's setup (e.g., `pnpm install`, `yarn`, `pip install`)
3. **Update `AGENTS.md`** conventions to match your stack (Python, Go, etc.)
4. **Update `.opencode/skills/`** if your workflow differs (e.g., different merge strategy)
5. **Adjust branch naming** in `WORKFLOW.md` prompt template if needed
6. **Update environment variables** in `.env` for your providers

The core architecture (orchestrator -> worktree -> agent -> PR) remains the same regardless of language or framework.

---

*Generated from Symphony SPEC + OpenCode skill standard + trunk-based development practices.*
