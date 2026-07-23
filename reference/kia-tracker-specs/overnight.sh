#!/usr/bin/env bash
# Ralph Overnight Audit — Kia Deal Tracker
# Runs verification, integrity check, dependency audit, and generates a report.
# Usage: bash overnight.sh
# For scheduled runs: Windows Task Scheduler → bash.exe → this script

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPORT_DIR="$PROJECT_ROOT/audit/reports"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REPORT_FILE="$REPORT_DIR/overnight-$TIMESTAMP.md"

mkdir -p "$REPORT_DIR"

{
  echo "# Overnight Audit Report"
  echo "**Date:** $(date)"
  echo "**Branch:** $(git -C "$PROJECT_ROOT" branch --show-current)"
  echo "**Last Commit:** $(git -C "$PROJECT_ROOT" log -1 --oneline)"
  echo ""

  # 1. Story status
  echo "## Story Status"
  echo '```'
  bash "$PROJECT_ROOT/ralph.sh" status 2>&1 || true
  echo '```'
  echo ""

  # 2. Full verify
  echo "## Verification"
  echo '```'
  bash "$PROJECT_ROOT/ralph.sh" verify 2>&1 || true
  echo '```'
  echo ""

  # 3. Protected file integrity
  echo "## Protected File Integrity"
  echo '```'
  bash "$PROJECT_ROOT/ralph.sh" integrity 2>&1 || true
  echo '```'
  echo ""

  # 4. Pre-commit guard check
  echo "## Guard Check"
  echo '```'
  bash "$PROJECT_ROOT/ralph.sh" guard 2>&1 || true
  echo '```'
  echo ""

  # 5. Dependency audit
  echo "## Dependency Audit"
  echo "### Client"
  echo '```'
  (cd "$PROJECT_ROOT/client" && npm audit --audit-level=high 2>&1 | head -30) || echo "npm audit not available"
  echo '```'
  echo "### Server"
  echo '```'
  (cd "$PROJECT_ROOT/server" && npm audit --audit-level=high 2>&1 | head -30) || echo "npm audit not available"
  echo '```'
  echo ""

  # 6. Git status
  echo "## Git Status"
  echo '```'
  git -C "$PROJECT_ROOT" status --short 2>&1
  echo '```'
  echo ""

  # 7. Open branches
  echo "## Open Branches"
  echo '```'
  git -C "$PROJECT_ROOT" branch --list 2>&1
  echo '```'
  echo ""

  # 8. Recent commits
  echo "## Recent Commits (last 20)"
  echo '```'
  git -C "$PROJECT_ROOT" log --oneline -20 2>&1
  echo '```'

} > "$REPORT_FILE" 2>&1

echo "Report written to: $REPORT_FILE"
echo "Review with: cat $REPORT_FILE"
