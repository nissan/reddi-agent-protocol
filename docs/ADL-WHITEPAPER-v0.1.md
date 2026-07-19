# Agent Definition Language Whitepaper v0.1

_Status: review draft. Published for comments and implementation feedback._

## Abstract

Agent Definition Language (ADL) is the canonical source-of-truth format for describing an agent before that agent is exported, reviewed, executed, paid, or trusted. In Reddi Agent Protocol (RAP), ADL gives each agent a portable contract for model requirements, harness behavior, tool access, policy boundaries, payment intent, receipts, evaluation gates, runtime posture, observability, recovery, and reputation signals.

The purpose is not to create another agent runtime. ADL is the neutral definition layer that lets agent systems interoperate while preserving the information needed for autonomous agent-to-agent payments: what the buyer asked for, what the seller promised, which policy allowed spend, which receipt proved payment, which evaluator accepted the work, and which reputation signal may safely change.

## Why ADL Exists

Agent commerce fails when capability, policy, payment, and trust live in separate documents. A marketplace listing might say an agent can do research, a runtime might expose a tool endpoint, a payment wrapper might issue a challenge, and an attestor might later judge the result. Without a shared definition, each layer has to infer the rest.

ADL makes those assumptions explicit. A buyer agent can inspect a seller agent before payment. A seller can quote a job against declared capability and policy. An attestor can evaluate the output against the same contract. A protocol adapter can export to another ecosystem while reporting any semantic loss.

## Core Model

An ADL document describes one agent:

- `metadata`: identity, description, ownership, and versioning context.
- `model`: capability, provider preferences, structured-output requirements, modality, context, latency, and cost constraints.
- `harness`: instructions, tools, functions, skills, data sources, memory, policies, eval gates, runtime, deployment, observability, and recovery.
- `extensions`: namespaced fields for payment, reputation, protocol bridges, provider-specific adapters, and future compatibility targets.

RAP treats ADL as the definition layer and treats external formats as target views. Open Agent Specification, Agent Cards, MCP manifests, x402 payment wrappers, provider manifests, and framework-specific templates can be generated from ADL, but they do not replace it. If a target cannot represent a Reddi-specific payment, policy, receipt, or reputation rule, the export must say so.

## Payment Semantics

ADL payment semantics are intentionally policy-first:

1. The buyer declares spend limits and authority constraints.
2. The seller declares capability, price, rail, receipt requirements, and evidence expectations.
3. A payment challenge quotes the exact job.
4. Buyer policy accepts, rejects, or asks for human approval.
5. Payment completion creates a receipt.
6. The work product, receipt, and trace are evaluated together.
7. Reputation changes only after attestation accepts the chain.

This gives autonomous agents room to transact without turning every tool call into an unchecked payment. A live system can use x402, devnet rails, future AUDD/Solana flows, or another compatible rail, but the ADL contract keeps the authority and evidence boundaries stable.

## Review And Improvement Loop

ADL should stay open to review because agent payment semantics will evolve. The public website exposes:

- a readable whitepaper page;
- a structured comment link for GitHub review;
- example use cases with mock responses;
- a live endpoint mode that lets users test against their own agent API address without storing that address in RAP infrastructure.

Reviewers should focus on:

- missing fields needed by real agent systems;
- policy or receipt ambiguity;
- export loss to existing agent manifests;
- payment-rail assumptions;
- places where mock demos could accidentally imply live settlement.

## Demonstrated Use Cases

### Research Agent Buys A Specialist Brief

A coordinating research agent selects a specialist from ADL capability metadata, receives an x402-style quote, pays under a task budget, and sends the result through source-coverage evaluation. ADL fields involved: approved data sources, tool scope, payment intent, receipt requirement, and source eval gates.

### Builder Agent Hires A Code Review Specialist

A builder agent submits a pinned ADL artifact hash to a review specialist. The seller quotes the review. Buyer policy allows one bounded review call. The release gate stays blocked until the review packet and tests are attached. ADL fields involved: policy constraints, receipt binding, eval gates, recovery, and release decision metadata.

### Commerce Agent Pays For Dispute Evidence

A marketplace coordinator pays an evidence specialist to collect order, invoice, and refund-policy evidence. An attestor reviews the chain and keeps reputation changes in preview when the evidence conflicts. ADL fields involved: payment/reputation extensions, observability trace requirements, recovery rules, and attestation gates.

## Safety Boundaries

The public demo defaults to mock mode. Live mode requires the user to provide their own endpoint address and press the live-run button. The site does not need to store API addresses, private keys, credentials, review text, or wallet secrets. Production payment rails, mainnet actions, and automatic paid calls remain outside this whitepaper/demo slice unless a future operator-gated issue explicitly enables them.

## Current Status

ADL v0.1 is a reviewable specification and interoperability contract. It is stable enough to explain, validate, export, and demonstrate. The next improvements should come from real implementer feedback: agent runtimes, payment wrappers, attestors, marketplace builders, and operators trying to map their existing systems into ADL without losing safety or payment semantics.
