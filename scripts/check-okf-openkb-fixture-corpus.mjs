#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(root, 'data/okf-openkb-fixtures/okf-openkb-fixture-corpus.v1.json');
const forbiddenPattern = /(api[_-]?key|private[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{12,}|seed phrase\s*[:=]|bearer\s+[A-Za-z0-9_./+=-]{16,}|BEGIN PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}/i;

function fail(message) {
  console.error(`OKF/OpenKB fixture corpus check failed: ${message}`);
  process.exit(1);
}

function requireBoolean(value, expected, pathLabel) {
  if (value !== expected) {
    fail(`${pathLabel} must be ${expected}`);
  }
}

function requireNonEmptyString(value, pathLabel) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${pathLabel} must be a non-empty string`);
  }
}

function scanText(value, pathLabel) {
  if (typeof value === 'string' && forbiddenPattern.test(value)) {
    fail(`${pathLabel} contains credential-shaped content`);
  }
}

function fixtureContentHash(files) {
  const hashInput = JSON.stringify(files.map((file) => ({
    path: file.path,
    type: file.type,
    contentClass: file.contentClass,
    trustBoundary: file.trustBoundary,
    contentPreview: file.contentPreview,
  })), null, 2);

  return createHash('sha256').update(hashInput).digest('hex');
}

const raw = await readFile(corpusPath, 'utf8');
scanText(raw, corpusPath);

let corpus;
try {
  corpus = JSON.parse(raw);
} catch (error) {
  fail(`invalid JSON: ${error.message}`);
}

if (corpus.schemaVersion !== 'reddi.okf-openkb-fixture-corpus.v1') {
  fail('schemaVersion must be reddi.okf-openkb-fixture-corpus.v1');
}

requireBoolean(corpus.staticOnly, true, '$.staticOnly');

const guardrails = corpus.guardrails ?? {};
for (const key of [
  'noOpenKbInstall',
  'noUrlIngest',
  'noLlmProviderCall',
  'noGeneratedSkillInstall',
  'noScriptExecution',
  'noHostedWrite',
  'noMarketplacePublication',
  'noAgentOnboarding',
  'noCredentialRead',
  'noWalletRpc',
  'noPaidCall',
  'noTrustMutation',
  'noReputationMutation',
]) {
  requireBoolean(guardrails[key], true, `$.guardrails.${key}`);
}

if (!Array.isArray(corpus.fixtures) || corpus.fixtures.length < 2) {
  fail('$.fixtures must include at least two fixture classes');
}

const requiredKinds = new Set(['okf_interchange_fixture', 'openkb_style_producer_fixture']);
for (const fixture of corpus.fixtures) {
  requireNonEmptyString(fixture.id, '$.fixtures[].id');
  requiredKinds.delete(fixture.kind);
  requireNonEmptyString(fixture.source?.sourceUrl, `$.fixtures[${fixture.id}].source.sourceUrl`);
  requireNonEmptyString(fixture.source?.checkedRef, `$.fixtures[${fixture.id}].source.checkedRef`);
  requireNonEmptyString(fixture.source?.retrievedAt, `$.fixtures[${fixture.id}].source.retrievedAt`);

  if (!Array.isArray(fixture.files) || fixture.files.length === 0) {
    fail(`$.fixtures[${fixture.id}].files must be non-empty`);
  }
  requireNonEmptyString(fixture.contentSha256, `$.fixtures[${fixture.id}].contentSha256`);

  for (const file of fixture.files) {
    requireNonEmptyString(file.path, `$.fixtures[${fixture.id}].files[].path`);
    requireNonEmptyString(file.type, `$.fixtures[${fixture.id}].files[${file.path}].type`);
    requireNonEmptyString(file.trustBoundary, `$.fixtures[${fixture.id}].files[${file.path}].trustBoundary`);
    scanText(file.contentPreview, `$.fixtures[${fixture.id}].files[${file.path}].contentPreview`);

    if (file.type.startsWith('generated_') && file.trustBoundary !== 'untrusted_generated_instruction') {
      fail(`generated file ${file.path} must use untrusted_generated_instruction boundary`);
    }
  }

  const expectedHash = fixtureContentHash(fixture.files);
  if (fixture.contentSha256 !== expectedHash) {
    fail(`$.fixtures[${fixture.id}].contentSha256 must equal ${expectedHash}`);
  }

  for (const artifact of fixture.generatedArtifacts ?? []) {
    requireBoolean(artifact.trusted, false, `$.fixtures[${fixture.id}].generatedArtifacts[${artifact.path}].trusted`);
    requireBoolean(artifact.installAllowed, false, `$.fixtures[${fixture.id}].generatedArtifacts[${artifact.path}].installAllowed`);
    requireBoolean(artifact.executeAllowed, false, `$.fixtures[${fixture.id}].generatedArtifacts[${artifact.path}].executeAllowed`);
  }
}

if (requiredKinds.size > 0) {
  fail(`missing fixture kinds: ${Array.from(requiredKinds).join(', ')}`);
}

for (const deniedUse of [
  'live_openkb_ingestion',
  'generated_skill_install',
  'generated_agent_onboarding',
  'script_execution',
  'hosted_registry_write',
  'marketplace_publication',
  'payment_activation',
  'trust_or_reputation_mutation',
]) {
  if (!corpus.downstreamDeniedUse?.includes(deniedUse)) {
    fail(`$.downstreamDeniedUse must include ${deniedUse}`);
  }
}

console.log(`OKF/OpenKB fixture corpus check passed: ${corpus.fixtures.length} fixtures`);
