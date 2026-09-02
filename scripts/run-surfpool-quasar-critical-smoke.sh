#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT_DIR"

exec node ./scripts/run-surfpool-sdk-critical-smoke.mjs --target quasar "$@"
