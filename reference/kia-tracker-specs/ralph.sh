#!/usr/bin/env bash
# Ralph System — Kia Deal Tracker
# Usage: bash ralph.sh <command>
# Commands: verify, status, next, init, guard

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Convert Git Bash path (/c/Users/...) to Windows path (C:/Users/...) for Node.js
NODE_ROOT="$PROJECT_ROOT"
if [[ "$NODE_ROOT" =~ ^/([a-zA-Z])/ ]]; then
  NODE_ROOT="${BASH_REMATCH[1]^}:${NODE_ROOT:2}"
fi

# Colors (ANSI — no tput for Git Bash compatibility)
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── VERIFY ──────────────────────────────────────────────────────────────────
verify() {
  local failures=0
  local skipped=0

  echo -e "${CYAN}=== RALPH VERIFY — $(date) ===${NC}"
  echo ""

  # 1. Lint client
  if [ -f "$PROJECT_ROOT/client/eslint.config.js" ] || [ -f "$PROJECT_ROOT/client/.eslintrc.cjs" ] || [ -f "$PROJECT_ROOT/client/.eslintrc.json" ]; then
    echo -e "[1/5] Linting client..."
    if (cd "$PROJECT_ROOT/client" && npx eslint . --max-warnings 0 2>&1); then
      echo -e "  ${GREEN}PASS${NC}"
    else
      echo -e "  ${RED}FAIL${NC}"
      failures=$((failures + 1))
    fi
  else
    echo -e "[1/5] Linting client... ${YELLOW}SKIP${NC} (ESLint not configured — complete Story F-001)"
    skipped=$((skipped + 1))
  fi

  # 2. Lint server
  if [ -f "$PROJECT_ROOT/server/eslint.config.js" ] || [ -f "$PROJECT_ROOT/server/.eslintrc.cjs" ] || [ -f "$PROJECT_ROOT/server/.eslintrc.json" ]; then
    echo -e "[2/5] Linting server..."
    if (cd "$PROJECT_ROOT/server" && npx eslint . --max-warnings 0 2>&1); then
      echo -e "  ${GREEN}PASS${NC}"
    else
      echo -e "  ${RED}FAIL${NC}"
      failures=$((failures + 1))
    fi
  else
    echo -e "[2/5] Linting server... ${YELLOW}SKIP${NC} (ESLint not configured — complete Story F-001)"
    skipped=$((skipped + 1))
  fi

  # 3. Test client
  if [ -d "$PROJECT_ROOT/client/node_modules/vitest" ]; then
    echo -e "[3/5] Testing client..."
    if (cd "$PROJECT_ROOT/client" && npx vitest run --reporter=verbose 2>&1); then
      echo -e "  ${GREEN}PASS${NC}"
    else
      echo -e "  ${RED}FAIL${NC}"
      failures=$((failures + 1))
    fi
  else
    echo -e "[3/5] Testing client... ${YELLOW}SKIP${NC} (Vitest not installed — complete Story F-001)"
    skipped=$((skipped + 1))
  fi

  # 4. Test server
  if [ -d "$PROJECT_ROOT/server/node_modules/vitest" ]; then
    echo -e "[4/5] Testing server..."
    if (cd "$PROJECT_ROOT/server" && npx vitest run --reporter=verbose 2>&1); then
      echo -e "  ${GREEN}PASS${NC}"
    else
      echo -e "  ${RED}FAIL${NC}"
      failures=$((failures + 1))
    fi
  else
    echo -e "[4/5] Testing server... ${YELLOW}SKIP${NC} (Vitest not installed — complete Story F-001)"
    skipped=$((skipped + 1))
  fi

  # 5. Build client
  echo -e "[5/5] Building client..."
  if (cd "$PROJECT_ROOT/client" && npx vite build 2>&1); then
    echo -e "  ${GREEN}PASS${NC}"
  else
    echo -e "  ${RED}FAIL${NC}"
    failures=$((failures + 1))
  fi

  echo ""
  echo "─────────────────────────────"
  if [ $failures -eq 0 ]; then
    echo -e "${GREEN}RALPH VERIFY: ALL PASSED${NC} ($skipped skipped)"
    return 0
  else
    echo -e "${RED}RALPH VERIFY: $failures FAILED${NC} ($skipped skipped)"
    return 1
  fi
}

# ─── STATUS ──────────────────────────────────────────────────────────────────
show_status() {
  echo -e "${CYAN}=== RALPH STATUS ===${NC}"
  echo ""

  node -e "
    const prd = require('$NODE_ROOT/prd.json');
    for (const tier of prd.tiers) {
      const total = tier.stories.length;
      const done = tier.stories.filter(s => s.status === 'completed').length;
      const active = tier.stories.filter(s => s.status === 'in_progress').length;
      const blocked = tier.status === 'blocked' ? ' [BLOCKED]' : '';
      console.log('');
      console.log(tier.name + blocked);
      console.log('  ' + done + '/' + total + ' completed, ' + active + ' in progress');
      console.log('');
      for (const s of tier.stories) {
        const icon = s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '→' : '·';
        const existing = s.existingCompletion ? ' (' + s.existingCompletion + ' existing)' : '';
        console.log('  ' + icon + ' ' + s.id + ': ' + s.title + existing);
      }
    }
  "
}

# ─── NEXT ────────────────────────────────────────────────────────────────────
show_next() {
  echo -e "${CYAN}=== NEXT STORY ===${NC}"
  echo ""

  node -e "
    const prd = require('$NODE_ROOT/prd.json');
    for (const tier of prd.tiers) {
      if (tier.status === 'blocked') continue;
      for (const s of tier.stories) {
        if (s.status === 'not_started') {
          console.log('Tier: ' + tier.name);
          console.log('Story: ' + s.id + ' — ' + s.title);
          console.log('Priority: ' + s.priority);
          console.log('Effort: ' + s.effort);
          if (s.specFile) console.log('Spec: ' + s.specFile);
          console.log('');
          console.log('Acceptance Criteria:');
          if (s.acceptanceCriteria) {
            s.acceptanceCriteria.forEach((c, i) => console.log('  ' + (i+1) + '. ' + c));
          }
          process.exit(0);
        }
      }
    }
    console.log('All stories in active tiers are completed!');
    console.log('Check if blocked tiers can be activated.');
  "
}

# ─── INIT ────────────────────────────────────────────────────────────────────
init_ralph() {
  echo -e "${CYAN}=== RALPH INIT ===${NC}"
  echo ""

  # Create audit directory
  mkdir -p "$PROJECT_ROOT/audit/reports"
  echo -e "  ${GREEN}✓${NC} audit/ directory created"

  # Compute protected file hashes
  echo -e "  Computing protected file hashes..."
  local protected_files=(
    "server/routes/deals.js"
    "server/services/dispatch.js"
    "server/services/reportGenerator.js"
    "server/services/email.js"
    "client/src/index.css"
    "client/tailwind.config.js"
    "client/src/supabaseClient.js"
    "server/middleware/supabase.js"
  )

  local hashes="{"
  local first=true
  for f in "${protected_files[@]}"; do
    local full_path="$PROJECT_ROOT/$f"
    if [ -f "$full_path" ]; then
      local hash
      hash=$(sha256sum "$full_path" | cut -d' ' -f1)
      if [ "$first" = true ]; then
        first=false
      else
        hashes+=","
      fi
      hashes+="\"$f\":\"$hash\""
    fi
  done
  hashes+="}"

  # Write audit.json with hashes
  node -e "
    const hashes = $hashes;
    const audit = {
      projectId: 'kia-deal-tracker',
      lastAuditDate: null,
      lastAuditBy: null,
      stories: {},
      protectedFileHashes: hashes,
      items: []
    };
    const prd = require('$NODE_ROOT/prd.json');
    for (const tier of prd.tiers) {
      for (const s of tier.stories) {
        audit.stories[s.id] = {
          status: 'not_audited',
          criteria: {},
          notes: '',
          auditedAt: null
        };
      }
    }
    console.log(JSON.stringify(audit, null, 2));
  " > "$PROJECT_ROOT/audit/audit.json"
  echo -e "  ${GREEN}✓${NC} audit/audit.json created with $(echo "$hashes" | node -e "process.stdin.on('data',d=>console.log(Object.keys(JSON.parse(d)).length))") protected file hashes"

  # Check if develop branch exists
  local current_branch
  current_branch=$(git -C "$PROJECT_ROOT" branch --show-current)
  if git -C "$PROJECT_ROOT" rev-parse --verify develop >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} develop branch already exists"
  else
    echo -e "  Creating develop branch from master..."
    git -C "$PROJECT_ROOT" checkout -b develop master
    echo -e "  ${GREEN}✓${NC} develop branch created"
  fi

  echo ""
  echo -e "${GREEN}Ralph initialized!${NC}"
  echo "  Next: run 'bash ralph.sh status' to see all stories"
  echo "  Then: run 'bash ralph.sh next' to see what to build first"
}

# ─── GUARD ───────────────────────────────────────────────────────────────────
check_guard() {
  echo -e "${CYAN}=== RALPH GUARD ===${NC}"
  echo ""

  local issues=0

  # Check staged files against protected list
  local protected_files=(
    "server/routes/deals.js"
    "server/services/dispatch.js"
    "server/services/reportGenerator.js"
    "server/services/email.js"
    "client/src/index.css"
    "client/tailwind.config.js"
    "client/src/supabaseClient.js"
    "server/middleware/supabase.js"
    "supabase-migration.sql"
    "supabase/schema.sql"
  )

  local staged_files
  staged_files=$(git -C "$PROJECT_ROOT" diff --cached --name-only 2>/dev/null || echo "")

  for f in "${protected_files[@]}"; do
    if echo "$staged_files" | grep -q "^$f$"; then
      echo -e "  ${RED}BLOCKED${NC} Protected file staged: $f"
      issues=$((issues + 1))
    fi
  done

  # Check for .env files
  if echo "$staged_files" | grep -qi '\.env'; then
    echo -e "  ${RED}BLOCKED${NC} .env file staged — secrets must not be committed"
    issues=$((issues + 1))
  fi

  # Check for console.log in staged JS/JSX files
  local debug_count
  debug_count=$(git -C "$PROJECT_ROOT" diff --cached -G 'console\.(log|debug)' --name-only -- '*.js' '*.jsx' 2>/dev/null | wc -l || echo 0)
  if [ "$debug_count" -gt 0 ]; then
    echo -e "  ${YELLOW}WARNING${NC} console.log/debug found in $debug_count staged file(s)"
    git -C "$PROJECT_ROOT" diff --cached -G 'console\.(log|debug)' --name-only -- '*.js' '*.jsx' 2>/dev/null | while read -r line; do
      echo "    → $line"
    done
  fi

  # Check for conflict markers
  local conflict_count
  conflict_count=$(git -C "$PROJECT_ROOT" diff --cached -G '<<<<<<<|=======|>>>>>>>' --name-only 2>/dev/null | wc -l || echo 0)
  if [ "$conflict_count" -gt 0 ]; then
    echo -e "  ${RED}BLOCKED${NC} Conflict markers found in $conflict_count file(s)"
    issues=$((issues + 1))
  fi

  echo ""
  if [ $issues -eq 0 ]; then
    echo -e "${GREEN}GUARD: All clear${NC}"
    return 0
  else
    echo -e "${RED}GUARD: $issues issue(s) found — fix before committing${NC}"
    return 1
  fi
}

# ─── INTEGRITY ───────────────────────────────────────────────────────────────
check_integrity() {
  echo -e "${CYAN}=== PROTECTED FILE INTEGRITY ===${NC}"
  echo ""

  if [ ! -f "$PROJECT_ROOT/audit/audit.json" ]; then
    echo -e "  ${YELLOW}Run 'bash ralph.sh init' first to compute baseline hashes${NC}"
    return 1
  fi

  local issues=0
  node -e "
    const audit = require('$NODE_ROOT/audit/audit.json');
    const crypto = require('crypto');
    const fs = require('fs');
    const path = require('path');
    const root = '$NODE_ROOT';

    for (const [file, expectedHash] of Object.entries(audit.protectedFileHashes)) {
      const fullPath = path.join(root, file);
      if (!fs.existsSync(fullPath)) {
        console.log('MISSING: ' + file);
        continue;
      }
      const content = fs.readFileSync(fullPath);
      const actualHash = crypto.createHash('sha256').update(content).digest('hex');
      if (actualHash !== expectedHash) {
        console.log('CHANGED: ' + file);
      } else {
        console.log('OK: ' + file);
      }
    }
  "
}

# ─── MAIN ────────────────────────────────────────────────────────────────────
case "${1:-help}" in
  verify)    verify ;;
  status)    show_status ;;
  next)      show_next ;;
  init)      init_ralph ;;
  guard)     check_guard ;;
  integrity) check_integrity ;;
  *)
    echo "Ralph System — Kia Deal Tracker"
    echo ""
    echo "Usage: bash ralph.sh <command>"
    echo ""
    echo "Commands:"
    echo "  verify     Run lint + test + build (skips unconfigured tools)"
    echo "  status     Show story completion across all tiers"
    echo "  next       Show the next story to work on"
    echo "  init       First-time setup (audit dir, develop branch, file hashes)"
    echo "  guard      Pre-commit check (protected files, secrets, debug code)"
    echo "  integrity  Check protected files against baseline hashes"
    ;;
esac
