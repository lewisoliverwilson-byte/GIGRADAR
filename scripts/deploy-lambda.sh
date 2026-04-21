#!/usr/bin/env bash
# GigRadar Lambda Deploy
#
# Builds a zip of lambda/api/ and deploys to AWS, then updates env vars.
#
# Usage:
#   bash scripts/deploy-lambda.sh             # deploy code + env vars
#   bash scripts/deploy-lambda.sh --env-only  # update env vars only
#   bash scripts/deploy-lambda.sh --code-only # update code only

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAMBDA_DIR="$ROOT/lambda/api"
ZIP="$LAMBDA_DIR/deploy.zip"
FUNCTION="gigradar-api"
REGION="us-east-1"

ENV_ONLY=false
CODE_ONLY=false
[[ "$1" == "--env-only"  ]] && ENV_ONLY=true
[[ "$1" == "--code-only" ]] && CODE_ONLY=true

echo "=== GigRadar Lambda Deploy ==="
echo "Function : $FUNCTION ($REGION)"
echo ""

# ── 1. Build zip ──────────────────────────────────────────────────────────────
if ! $ENV_ONLY; then
  echo "▶ Building zip..."
  rm -f "$ZIP"
  node "$ROOT/scripts/build-lambda-zip.cjs"
  SIZE=$(wc -c < "$ZIP" | tr -d ' ')
  echo "  Built: $(( SIZE / 1024 / 1024 ))MB ($SIZE bytes)"
  echo ""

  # ── 2. Upload code ──────────────────────────────────────────────────────────
  # Convert to Windows path for AWS CLI on Git Bash
  WIN_ZIP=$(cygpath -w "$ZIP" 2>/dev/null || echo "$ZIP")
  echo "▶ Uploading to AWS Lambda..."
  aws lambda update-function-code \
    --function-name "$FUNCTION" \
    --zip-file "fileb://$WIN_ZIP" \
    --region "$REGION" \
    --query "{CodeSize:CodeSize,LastModified:LastModified}" \
    --output table
  echo ""

  echo "▶ Waiting for deployment to complete..."
  aws lambda wait function-updated \
    --function-name "$FUNCTION" \
    --region "$REGION"
  echo "  Ready."
  echo ""
fi

# ── 3. Environment variables ──────────────────────────────────────────────────
if ! $CODE_ONLY; then
  echo "▶ Updating environment variables..."
  aws lambda update-function-configuration \
    --function-name "$FUNCTION" \
    --region "$REGION" \
    --environment "Variables={SETLISTFM_KEY=LLwRhC7w4JhTvH-8tqOmnGz5SV18W-8wurAw,SPOTIFY_CLIENT_ID=9f4abb0eac5a45019b8d9a492daa41fc,SPOTIFY_CLIENT_SECRET=130c12d419064803bec3126cb3d4e411}" \
    --query "{LastModified:LastModified}" \
    --output table
  echo ""
fi

echo "=== Deploy complete ==="
echo ""
echo "Smoke test:"
echo "  curl https://api.gigradar.co.uk/trending | head -c 200"
