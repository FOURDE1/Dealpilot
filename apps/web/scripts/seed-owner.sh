#!/usr/bin/env bash
# Re-creates the owner test account + org + store on the LOCAL dev stack.
# Run after every `db:reset`. Idempotent-ish: sign-up fails silently if the
# user exists; org/store creation is skipped if the org list is non-empty.
set -euo pipefail
API="${API:-http://localhost:3001}"
ORIGIN="http://localhost:5173"
EMAIL="hassan-test@1dealer.ca"
PASS="Test-Dealpilot-2026!"
JAR="$(mktemp)"
curl -s -c "$JAR" -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Hassan\"}" \
  "$API/api/auth/sign-up/email" > /dev/null || true
rm -f "$JAR"; JAR="$(mktemp)"
curl -s -c "$JAR" -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$API/api/auth/sign-in/email" > /dev/null
ME=$(curl -s -b "$JAR" "$API/api/v1/me")
echo "signed in: $(echo "$ME" | grep -o '"email":"[^"]*"' | head -1)"
ORGS=$(curl -s -b "$JAR" "$API/api/v1/organizations?limit=1")
if echo "$ORGS" | grep -q '"items":\[\]'; then
  ORG_ID=$(curl -s -b "$JAR" -H 'Content-Type: application/json' -H "Origin: $ORIGIN" -X POST \
    -d '{"name":"Groupe Hassan","slug":"groupe-hassan"}' "$API/api/v1/organizations" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  curl -s -b "$JAR" -H 'Content-Type: application/json' -H "Origin: $ORIGIN" -X POST \
    -d "{\"organization_id\":\"$ORG_ID\",\"name\":\"Kia Mont-Laurier\",\"code\":\"KML\",\"province\":\"QC\",\"city\":\"Mont-Laurier\"}" \
    "$API/api/v1/stores" > /dev/null
  echo "seeded: Groupe Hassan + Kia Mont-Laurier"
else
  echo "org already present — nothing to seed"
fi
rm -f "$JAR"
