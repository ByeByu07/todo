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
