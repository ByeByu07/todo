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

### Create label (if it doesn't exist)
```bash
gh label create symphony --repo <owner>/<repo> --color "0052CC" --description "Issues for Symphony orchestrator"
```

### Create issue with label
```bash
# Step 1: Ensure label exists first
gh label create symphony --repo <owner>/<repo> --color "0052CC" --description "Issues for Symphony orchestrator" || true

# Step 2: Create issue with label
gh issue create --repo <owner>/<repo> --title "feat: ..." --body "..." --label symphony
```

### Edit issue (add/remove labels)
```bash
# Add label
gh issue edit <number> --repo <owner>/<repo> --add-label symphony

# Remove label
gh issue edit <number> --repo <owner>/<repo> --remove-label symphony
```

### Close issue
```bash
gh issue close <number>
```
