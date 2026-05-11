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
