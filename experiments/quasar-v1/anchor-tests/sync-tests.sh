#!/usr/bin/env bash
# Copies the Anchor program's V1 test files and points them at the Quasar binary.
# Nothing else in the files is changed here; see README.md for the few
# assertions adjusted afterwards by adjust-tests.patch.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
for name in test_escrow test_registry test_token_escrow test_token2022_escrow; do
  sed 's#include_bytes!("../../../target/deploy/escrow.so")#include_bytes!("../../target/deploy/rap_quasar_v1.so")#' \
    "../../../programs/escrow/tests/${name}.rs" > "tests/${name}.rs"
done
# The real PYUSD mint bytes are read from the Anchor test fixtures in place.
sed -i 's#include_bytes!("fixtures/#include_bytes!("../../../../programs/escrow/tests/fixtures/#' tests/test_token2022_escrow.rs
if [ -f adjust-tests.patch ]; then
  patch -p1 --no-backup-if-mismatch < adjust-tests.patch
fi
