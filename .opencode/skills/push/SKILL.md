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
