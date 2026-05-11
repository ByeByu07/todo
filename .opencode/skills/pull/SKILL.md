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
