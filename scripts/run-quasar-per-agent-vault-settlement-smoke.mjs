#!/usr/bin/env node

console.error(
  "[quasar-operator] DISABLED: this historical Quasar operator entrypoint is frozen and cannot load SDKs, access signers, contact RPC endpoints, or create transactions. No argument, environment variable, or approval artifact enables it. See docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md.",
);
process.exitCode = 1;
