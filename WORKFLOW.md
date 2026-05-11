---
tracker:
  kind: github
  token: $GITHUB_TOKEN
  repo: ByeByu07/todo
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
  comment_on_start: true
  comment_on_complete: true
  comment_on_retry: true

codex:
  command: "opencode"
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
7. If review feedback is provided (see "Previous Comments" below), address it in your next iteration.
8. On retry, update the existing PR branch rather than creating a new one.

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
