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
