# SDD ledger — plan: docs/superpowers/plans/2026-10-03-hermes-vendas.md

Spec: docs/superpowers/specs/2026-10-03-hermes-vendas-design.md (approved).
Execution: native, explicitly approved by user.
Ruling: no Git/worktree because this workspace has no Git repository; edit local files and preserve prior server/UI copies in /tmp.
Pre-flight: tasks 1/2 share store/API; 2/3 share send result and outbox; 2/4 share conversation version; 1/5 share settings/context; 5/6 share API state. Keep named interfaces from plan.
Ruling: commercial activation remains paused until administrator configures channels, caps and enrolment; implementation never sends to existing leads automatically.
Ruling: free-form model text cannot safely be certified as non-commercial by regex. Automatic messages will use server-owned qualification/response templates and verified placeholders; free-form drafts require approval. This preserves automatic outreach/follow-up while preventing proposal bypass.
Task 1: complete — API/config/enrolment tests RED → GREEN (4).

Task 2: complete — flow tests RED → GREEN (16); versioned approval, concurrency and reservations.
Task 3: complete — wacli tests RED → GREEN (4), pinned 0.20.0 SHA256 verified.
Task 4: complete — inbound/email tests RED → GREEN (5), rowid/WAL recovery and chronological e-mail import.
Task 5: complete — AI/worker tests RED → GREEN (6), isolated profile generated.
Task 6: complete — UI test RED → GREEN; docs updated, 99 tests passed, syntax checked, CRM reloaded and paused worker heartbeat verified.
Ruling: main Hermes model authentication copied privately into isolated profile, not linked; no tools or MCP. Cost if wrong: reauthenticate that isolated profile.
Ruling: ignore unrelated inbound mailbox content instead of reading private messages for review; only enrolled senders in configured mailbox are recovered. Manual unknown inbound remains reviewable. Cost if wrong: unmatched replies require operator association.
Ruling: use read-only rowid cursor for wacli because time-only CLI pagination can lose same-timestamp batches. Cost if wrong: schema incompatibility pauses recovery until adapter updated.
Ruling: corrected Jev endpoint and noul field in existing integration after verifying official OpenRouter reference. Cost if wrong: provider calls fail explicitly, never fallback silently.
Final review dispatched fresh context as required by executing-plans.

Final review was unavailable due to account usage limit; local review fixed follow-up counting, Reply-To requirement, cost settlement on canceled tasks and pre-dispatch validation.
Runtime ruling: Hermes rewrites config.yaml as YAML, so profile loader accepts JSON or safe-loaded YAML. Dedicated custom HERMES_HOME avoids host multiplexer attachment; generated API_SERVER_ENABLED=true, localhost only. Isolated runtime installed and original global launcher runtime restored. No paid inference performed.

User correction: native TypeSafe key, not OpenRouter. Official /v1/systemone contract verified and native GET /v1/models authenticated HTTP 200. Migrated saved key to TYPESAFE_API_KEY without output. Native usage lacks USD cost, preserve reservation; allow sequential different-service reserve only within total budget, no active parallel or same-service unresolved retry. RED/GREEN tests; full 103 pass. User authorized $3 test only on mlluiz39; other conversation paused, module disabled after test.

User billing correction: only Jev has usage charges for this setup; $3 is monthly. Added opt-in hermesIncluded (default false for existing metered setups), budgetPeriod/monthlyBudgetUsd and dailyLimit=0. Pinned Jev1.13.0 and official token tariff checked; estimated amounts marked calculated, never invoiced. Historical Hermes reserves preserved but excluded when included. 115 tests passed. Activated only current enrolled test lead, 24h. Worker active; actual inbound refusal paused conversation (not module), confidence .93 and 1226 tokens. No further contact after refusal.
