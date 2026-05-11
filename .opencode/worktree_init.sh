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
