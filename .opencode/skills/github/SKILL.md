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
