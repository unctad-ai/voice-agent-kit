#!/usr/bin/env bash
set -euo pipefail

DOMAIN="singlewindow.dev"
API_URL="https://api.godaddy.com/v1/domains/${DOMAIN}/records"

# Prompt for credentials
read -rp "GoDaddy API Key: " API_KEY
read -rsp "GoDaddy API Secret: " API_SECRET
echo

AUTH="sso-key ${API_KEY}:${API_SECRET}"

set_record() {
  local type="$1" name="$2" value="$3"
  echo -n "Setting ${type} ${name} → ${value} ... "
  response=$(curl -s -w "\n%{http_code}" --max-time 15 -X PUT "${API_URL}/${type}/${name}" \
    -H "Authorization: ${AUTH}" \
    -H "Content-Type: application/json" \
    -d "[{\"data\": \"${value}\", \"ttl\": 600}]")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    echo "OK (${http_code})"
  else
    echo "FAILED (${http_code})"
    echo "  ${body}"
  fi
}

set_record "A"    "@" "157.180.127.65"
set_record "AAAA" "@" "2a01:4f9:c013:f8af::1"
set_record "A"    "*" "157.180.127.65"
set_record "AAAA" "*" "2a01:4f9:c013:f8af::1"

echo ""
echo "Verifying..."
curl -s --max-time 15 "${API_URL}" \
  -H "Authorization: ${AUTH}" | python3 -m json.tool
