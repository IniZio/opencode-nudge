# Nexus Workspace Handoff Plugin Design

## Overview

Design a new OpenCode plugin that keeps plugin logic thin while delegating workspace orchestration to Nexus tooling and handoff behavior to reusable skill-driven templates.

The plugin should make it natural to move from a current session into an OpenCode session running inside a Nexus workspace, while enforcing a safety rule: the new session must wait for explicit user confirmation before making edits.

## Goals

1. Add a handoff flow that can transfer work into an OpenCode instance in a prepared Nexus workspace.
2. Use semi-automatic suggestion behavior by default, with explicit command fallback.
3. Keep plugin logic minimal and portable by moving core behavior to Nexus + skills.
4. Preserve a cross-agent contract so Codex and Claude adapters can be added later without rewriting core logic.

## Non-Goals

- Re-implement Nexus workspace creation logic inside the plugin.
- Hardcode deep orchestration heuristics in OpenCode-only plugin code.
- Automatically modify files during handoff.

## Confirmed Decisions

- Handoff target behavior: handoff to OpenCode inside the workspace.
- Safety requirement: handoff prompt must instruct the target session to wait for user confirmation before edits.
- Trigger model: B (semi-automatic suggestion) with A (explicit command) fallback.
- Command name: `/handoff`.
- Workspace creation strategy: A, delegated to external Nexus tooling.
- Architecture preference: option 3, skill-first driver with minimal plugin triggers.

## Architecture

### Components

1. `opencode-nexus-handoff` plugin (thin OpenCode adapter)
   - Registers `/handoff` command.
   - Listens for selected session/chat events to suggest handoff opportunities.
   - Exposes minimal tools for workspace prep and session transfer.
2. Nexus tooling (external)
   - Owns workspace creation and provisioning behavior.
   - May internally manage subtree/template sync and bootstrap policy.
3. Handoff skill/prompt templates
   - Own prompt construction policy.
   - Own confirmation-gate language and portability-safe framing.
4. Portable handoff core contract
   - Shared payload schema and reason codes.
   - Reused by future Codex and Claude adapters.

### Thin-Plugin Boundary

Plugin responsibilities:
- Translate OpenCode events/commands into core contract calls.
- Call Nexus prepare API/CLI.
- Trigger handoff session creation with generated prompt payload.

Plugin explicitly does not own:
- Workspace provisioning semantics.
- Complex orchestration policy and branching logic.
- Agent-specific handoff prompt strategy beyond adapter plumbing.

## Flow Design

### Default Semi-Automatic Flow (B)

1. Plugin detects a candidate handoff moment.
2. Assistant asks user to confirm handoff.
3. On confirmation, plugin calls Nexus tooling to prepare workspace.
4. Plugin/skill generates handoff prompt using portable template contract.
5. Prompt is transferred to a new OpenCode session in workspace.
6. Transferred prompt begins with confirmation gate language requiring user approval before edits.

### Explicit Fallback Flow (A)

1. User runs `/handoff <goal>`.
2. Plugin runs the same prepare + generate + transfer pipeline.
3. Same confirmation gate is mandatory in transferred prompt.

### Decline Behavior

- If user declines suggestion, plugin does not auto-retry in that session unless user later invokes `/handoff`.

## Portable Contract

Define an agent-neutral handoff contract with stable shape:

- `goal`
- `sourceSessionId`
- `workspacePath`
- `workspaceMeta`
- `confirmationRequired`
- `handoffPrompt`
- `fileRefs`
- `safetyGuards`

Core operations:

- `detect_candidate(context) -> HandoffCandidate | null`
- `prepare_workspace(request) -> WorkspaceResult`
- `build_handoff_prompt(input) -> HandoffDraft`
- `transfer_to_workspace(draft, workspace) -> TransferResult`

OpenCode plugin is one adapter implementation of this contract.

## Safety and Error Handling

### Safety Rules

- `/handoff` never writes project files directly.
- Transferred prompt always includes explicit wait-for-confirmation instruction.
- Confirmation requirement is contract-level (`confirmationRequired: true`), not optional plugin text.

### Failure Handling

- Nexus unavailable or version mismatch:
  - Return actionable diagnostic.
  - Offer draft-only handoff output as safe fallback.
- Workspace creation failure:
  - Abort transfer.
  - Preserve diagnostics and retry payload.
- Transfer/session creation failure:
  - Preserve draft and workspace metadata for retry.
- Template/skill failure:
  - Fall back to minimal safe template with confirmation gate.

### Reason Codes

- `SUGGESTED`
- `USER_CONFIRMED`
- `USER_DECLINED`
- `WORKSPACE_READY`
- `TRANSFERRED`
- `NEXUS_UNAVAILABLE`
- `WORKSPACE_PREP_FAILED`
- `TRANSFER_FAILED`
- `FALLBACK_DRAFT_ONLY`

## Verification Strategy

1. Unit tests
   - Candidate detection and decline behavior.
   - `/handoff` command argument handling.
   - Portable payload schema validation.
2. Integration tests
   - Happy path: suggestion -> confirm -> workspace prep -> transfer.
   - Explicit path: `/handoff <goal>`.
3. Safety tests
   - Transferred prompt includes confirmation gate instruction.
   - No file writes occur before confirmation.
4. Failure-path tests
   - Nexus missing/unavailable.
   - Workspace prep failure.
   - Transfer creation failure.
5. Portability tests
   - Contract test suite runs independently from OpenCode adapter internals.

## Rollout Plan

Phase 1:
- Implement OpenCode thin adapter plugin and `/handoff` command.
- Add suggestion + confirm flow and explicit fallback.
- Integrate Nexus prepare call and transferred prompt confirmation gate.

Phase 2:
- Study `obra/superpowers` subtree and skill composition patterns for pre-handoff preparation behavior.
- Define and validate a reusable pre-handoff skill bundle for OpenCode Nexus flow.
- Keep implementation OpenCode-focused while capturing portability constraints as non-blocking notes.

Phase 3:
- Extract/solidify portable handoff contract package from validated OpenCode + skill flow.
- Add adapter test harness to validate cross-agent compatibility.

Phase 4:
- Implement Codex/Claude adapters against the same core contract.

## Risks and Mitigations

1. Command collision with existing `/handoff` plugin
   - Mitigation: document replacement/precedence behavior and adapter registration strategy.
2. Nexus dependency drift
   - Mitigation: version checks and explicit diagnostic reason codes.
3. Portability regressions from OpenCode-specific assumptions
   - Mitigation: keep contract tests agent-neutral and adapter-specific tests separate.
