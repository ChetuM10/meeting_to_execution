# CLAUDE.md — Meeting-to-Execution Copilot

This file is the single source of truth for how this project is built.
Every architectural decision, schema, API, and build rule is locked here.
Do not deviate from anything in this file without explicit user approval.

---

## 1. What This Project Does

Takes a raw meeting transcript → extracts structured **decisions / action items / open questions** using an LLM → checks new info against previously-open questions from earlier meetings in the same project → requires **human review and approval** before any external action → creates a **Jira ticket** for approved action items.

The key insight: the project has two hard constraints that make it non-trivial.

1. The **retry-with-repair loop** (schema validation fails → re-prompt with exact error → cap at 2 retries → flag for manual entry).
2. The **interrupt/resume** pattern (graph pauses for human approval, survives server restarts, resumes days later from persisted state).

These two constraints justify LangGraph.js. Without them, a single LLM call would be enough.

---

## 2. Locked-In Tech Stack

> **Do not substitute, add to, or remove from this list without asking first.**

| Layer           | Choice                         | Reasoning (locked)                                                                        |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| Frontend        | React + TypeScript             | Human interaction with extracted output is required — this is not optional                |
| Backend         | Node.js + TypeScript + Express | Fits existing skills; NestJS DI overhead not justified for a solo project                 |
| Database        | PostgreSQL (plain SQL)         | Data is relational; no pgvector, no vector DB at MVP scale                                |
| LLM             | OpenAI or Gemini API           | Needed for extraction                                                                     |
| Workflow engine | LangGraph.js                   | Justified by retry loop + interrupt/resume — not because agents are trendy                |
| External tool   | Jira only, MCP-wrapped         | Build as plain function first, wrap as MCP tool once working end-to-end                   |
| Processing      | Synchronous                    | LLM calls take seconds; a queue adds real operational cost for a problem you do not have  |
| Auth scope      | Single workspace               | Isolation hooks exist in schema (workspace_id on every table) but no multi-tenant billing |

**Explicitly excluded — do not add even as "nice to have":**

- Notion / Confluence integration
- Semantic / vector search
- Redis / BullMQ / background job queues
- WebSockets / real-time updates
- Audio transcription pipeline
- Multi-tenant billing

---

## 3. Database Schema (locked)

Every mutating action must be traceable back to a `workflow_run_id`.

### `users`

| Column        | Type        | Notes |
| ------------- | ----------- | ----- |
| id            | UUID PK     |       |
| email         | text unique |       |
| password_hash | text        |       |
| created_at    | timestamp   |       |

### `workspaces`

| Column     | Type       | Notes |
| ---------- | ---------- | ----- |
| id         | UUID PK    |       |
| name       | text       |       |
| owner_id   | FK → users |       |
| created_at | timestamp  |       |

### `projects`

| Column       | Type            | Notes               |
| ------------ | --------------- | ------------------- |
| id           | UUID PK         |                     |
| workspace_id | FK → workspaces | Data isolation unit |
| name         | text            |                     |
| created_at   | timestamp       |                     |

### `meetings`

| Column          | Type          | Notes                                              |
| --------------- | ------------- | -------------------------------------------------- |
| id              | UUID PK       |                                                    |
| project_id      | FK → projects |                                                    |
| raw_transcript  | text          |                                                    |
| transcript_hash | text          | Unique per project — prevents duplicate submission |
| created_at      | timestamp     |                                                    |

### `decisions`

| Column          | Type                                | Notes                                           |
| --------------- | ----------------------------------- | ----------------------------------------------- |
| id              | UUID PK                             |                                                 |
| project_id      | FK → projects                       |                                                 |
| meeting_id      | FK → meetings                       | Source meeting                                  |
| content         | text                                |                                                 |
| status          | enum: active / superseded           | Never delete old decisions — audit trail        |
| superseded_by   | FK → decisions (nullable, self-ref) | Links to later decision that overrides this one |
| confidence      | numeric (0-1)                       |                                                 |
| source_quote    | text                                | Exact phrase from transcript                    |
| workflow_run_id | FK → workflow_runs                  |                                                 |
| created_at      | timestamp                           |                                                 |

### `action_items`

| Column          | Type               | Notes                                       |
| --------------- | ------------------ | ------------------------------------------- |
| id              | UUID PK            |                                             |
| project_id      | FK → projects      |                                             |
| meeting_id      | FK → meetings      |                                             |
| task            | text               |                                             |
| owner           | text (nullable)    |                                             |
| deadline        | date (nullable)    |                                             |
| status          | enum: open / done  |                                             |
| confidence      | numeric (0-1)      | LLM own confidence score                    |
| ambiguity_flags | text[]             | e.g. ["owner not confirmed", "no deadline"] |
| workflow_run_id | FK → workflow_runs |                                             |
| created_at      | timestamp          |                                             |

### `open_questions`

| Column                  | Type                      | Notes                             |
| ----------------------- | ------------------------- | --------------------------------- |
| id                      | UUID PK                   |                                   |
| project_id              | FK → projects             |                                   |
| meeting_id              | FK → meetings             | Meeting where question was raised |
| question                | text                      |                                   |
| status                  | enum: open / resolved     |                                   |
| resolved_by_decision_id | FK → decisions (nullable) | Traceability: why was it resolved |
| workflow_run_id         | FK → workflow_runs        |                                   |
| created_at              | timestamp                 |                                   |

### `integration_connections`

| Column          | Type            | Notes                                                      |
| --------------- | --------------- | ---------------------------------------------------------- |
| id              | UUID PK         |                                                            |
| workspace_id    | FK → workspaces |                                                            |
| provider        | enum: jira      | Phase 2 will add notion                                    |
| encrypted_token | text            | Never logged, never returned to client                     |
| expires_at      | timestamp       | Checked before use; block with reconnect prompt if expired |
| created_at      | timestamp       |                                                            |

### `workflow_runs`

| Column     | Type                                                                          | Notes                                                     |
| ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| id         | UUID PK                                                                       |                                                           |
| meeting_id | FK → meetings                                                                 |                                                           |
| state_json | jsonb                                                                         | Full LangGraph state object — makes interrupt/resume safe |
| status     | enum: processing / pending_review / executing / completed / rejected / failed |                                                           |
| created_at | timestamp                                                                     |                                                           |
| updated_at | timestamp                                                                     |                                                           |

### `proposed_actions`

| Column          | Type                                           | Notes                                    |
| --------------- | ---------------------------------------------- | ---------------------------------------- |
| id              | UUID PK                                        |                                          |
| workflow_run_id | FK → workflow_runs                             |                                          |
| type            | enum: create_jira_issue                        |                                          |
| payload_json    | jsonb                                          | The exact data that will be sent to Jira |
| status          | enum: pending / approved / rejected / executed |                                          |
| created_at      | timestamp                                      |                                          |

### `execution_logs`

| Column             | Type                   | Notes                                                                  |
| ------------------ | ---------------------- | ---------------------------------------------------------------------- |
| id                 | UUID PK                |                                                                        |
| proposed_action_id | FK → proposed_actions  |                                                                        |
| external_id        | text                   | e.g. Jira issue key PROJ-42                                            |
| idempotency_key    | text UNIQUE            | Hash of workflow_run_id + action_type + payload — duplicate prevention |
| status             | enum: success / failed |                                                                        |
| error_message      | text (nullable)        |                                                                        |
| executed_at        | timestamp              |                                                                        |

### Key Indexes

```sql
CREATE INDEX ON open_questions(project_id, status);
CREATE INDEX ON decisions(project_id, status);
CREATE UNIQUE INDEX ON execution_logs(idempotency_key);
CREATE UNIQUE INDEX ON meetings(project_id, transcript_hash);
```

### Relationships

```
users → 1:N → workspaces → 1:N → projects → 1:N → meetings
meetings → 1:1 → workflow_runs → 1:N → proposed_actions → 1:1 → execution_logs
projects → 1:N → decisions (superseded_by self-ref)
projects → 1:N → action_items
projects → 1:N → open_questions (resolved_by_decision_id)
workspaces → 1:N → integration_connections
```

---

## 4. LangGraph Workflow (locked)

```
START
  |
  v
validate_transcript --(invalid/empty)--> END (error surfaced to user)
  | (valid)
  v
fetch_historical_context    [SELECT open_questions, decisions WHERE project_id = X AND status = open]
  |
  v
extract_structured_info     [LLM call -> draft JSON]
  |
  v
validate_schema --(invalid)--> repair_or_retry --(retry <= 2)--> back to extract_structured_info
  | (valid)                         | (exceeded retries)
  |                                 v
  |                          flag_for_manual_entry --> human_review
  v
compare_against_history     [LLM proposes match; backend code applies the DB update — not the LLM]
  |
  v
detect_ambiguity            ["Rahul should probably..." -> low confidence, flagged]
  |
  v
generate_proposed_actions   [draft Jira issues — hard cap: max N proposed actions per run]
  |
  v
human_review  <-- INTERRUPT (graph pauses; full state written to workflow_runs.state_json)
  |
  |-- reject --> status = rejected, no external call, END
  |-- approve (with optional edits applied first)
        v
      execute_approved_actions
        | [check idempotency_key in execution_logs BEFORE calling Jira]
        | [atomically flip workflow_runs.status: pending_review -> executing]
        v
      verify_results          [re-fetch Jira ticket to confirm it exists before marking complete]
        |
        v
      store_final_state
        |
        v
       END
```

**State object** (passed between nodes, never discarded):

```typescript
type WorkflowState = {
  transcript: string;
  project_id: string;
  workflow_run_id: string;
  historical_context: { open_questions: OQ[]; decisions: Decision[] };
  draft_extraction: RawLLMOutput | null;
  validated_extraction: ValidatedExtraction | null;
  retry_count: number;
  ambiguity_flags: AmbiguityFlag[];
  proposed_actions: ProposedAction[];
  review_status: "pending" | "approved" | "rejected";
  edited_actions: ProposedAction[] | null;
  execution_results: ExecutionResult[];
};
```

**Conditional edges:**

- `validate_schema` → `repair_or_retry` if Zod fails; → `compare_against_history` if valid
- `repair_or_retry` → back to `extract_structured_info` if retry_count < 2; → `flag_for_manual_entry` if retry_count >= 2
- `human_review` → `execute_approved_actions` if approved; → END if rejected

---

## 5. Structured Output Schema (locked)

Zod enforces this shape on every LLM response before it enters graph state.
A malformed response is never silently accepted.

```typescript
const DecisionSchema = z.object({
  content: z.string(),
  confidence: z.number().min(0).max(1),
  source_quote: z.string(),
});

const ActionItemSchema = z.object({
  task: z.string(),
  owner: z.string().nullable(),
  deadline: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  ambiguity_flags: z.array(z.string()),
});

const OpenQuestionSchema = z.object({
  question: z.string(),
  status: z.enum(["open"]),
});

const ExtractionSchema = z.object({
  decisions: z.array(DecisionSchema),
  action_items: z.array(ActionItemSchema),
  open_questions: z.array(OpenQuestionSchema),
});
```

**Certainty language rules (baked into the extraction prompt):**

- Hedged: "Rahul should probably look into it" → confidence < 0.5, ambiguity_flags populated — never auto-proposed as a Jira action
- Firm: "Rahul will complete it by Friday" → confidence > 0.8, no flags — eligible for proposed Jira action
- Repair loop: on Zod failure, re-prompt with the exact error appended. Cap at 2 retries. Third failure → flag_for_manual_entry.

---

## 6. Idempotency Design (locked)

**Two lines of defense against duplicate Jira tickets:**

**Line 1 — workflow_runs.status conditional update:**
Before any Jira call, atomically flip status from `pending_review` → `executing` using:

```sql
UPDATE workflow_runs SET status = 'executing' WHERE id = $1 AND status = 'pending_review'
```

Check rows affected. If 0, another process already flipped it — no-op.

**Line 2 — execution_logs.idempotency_key unique index:**
Key = sha256(workflow_run_id + action_type + JSON.stringify(sorted payload)).
Before calling Jira API, attempt INSERT into execution_logs with this key.
If unique constraint fires, return existing result — do not call Jira.

**Duplicate transcript prevention:**
On `POST /meetings`, hash the raw transcript. If `(project_id, transcript_hash)` already exists, return 409 with a warning.

---

## 7. API Endpoints (locked)

| Method | Path                             | Purpose                              | Notes                                                         |
| ------ | -------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| POST   | /auth/register                   | Create user account                  |                                                               |
| POST   | /auth/login                      | Login, return JWT                    |                                                               |
| POST   | /projects                        | Create project                       | Scoped to workspace from JWT                                  |
| GET    | /projects/:id                    | Get project details                  |                                                               |
| GET    | /projects/:id/open-questions     | List open questions                  | WHERE status = open                                           |
| GET    | /projects/:id/decisions          | List decisions with superseded chain |                                                               |
| POST   | /meetings                        | Submit transcript                    | Returns { meeting_id, workflow_run_id, status: "processing" } |
| GET    | /workflow-runs/:id               | Poll workflow status                 | Returns extraction + proposed_actions when pending_review     |
| POST   | /workflow-runs/:id/approve       | Approve with optional edits          | Body: { edited_action_items?: [...] }                         |
| POST   | /workflow-runs/:id/reject        | Reject                               | No external action fires                                      |
| GET    | /workflow-runs/:id/execution-log | View Jira action result              |                                                               |
| POST   | /integrations/jira/connect       | Store Jira OAuth token (encrypted)   |                                                               |

**Authorization rule:** every query must verify the resource belongs to the authenticated user's workspace — derived from JWT, never from client body.

---

## 8. Frontend Screens (locked)

1. **Dashboard** — list of projects, recent meetings, count of pending-review workflows
2. **Project page** — meetings list, open questions timeline (with resolved_by links), decision history (superseded chains visible)
3. **Submit transcript** — textarea + submit; loading state after submit (polling, not WebSocket)
4. **Review screen** — extracted decisions, action items (owner/deadline editable inline), resolved-open-question callouts, proposed Jira action preview, Approve/Reject buttons; required-field validation before allowing Approve
5. **Execution status** — Jira issue link once created, or clear error state with retry button if failed

**State management:** React Query — poll `GET /workflow-runs/:id` every 3-5 seconds while `processing`, stop once `pending_review` or `completed`. No hand-rolled state machines. No WebSockets.

---

## 9. Build Order (Milestones)

| #   | Milestone                                                                             | Status      |
| --- | ------------------------------------------------------------------------------------- | ----------- |
| 1   | Postgres schema + auth + workspace/project/meeting CRUD (no AI yet)                   | NOT STARTED |
| 2   | Extraction function in isolation (LLM call + Zod validation, no graph yet)            | NOT STARTED |
| 3   | Cross-meeting memory: historical context fetch + open-question resolution logic       | NOT STARTED |
| 4   | Wrap in LangGraph.js — full graph with retry loop + interrupt node                    | NOT STARTED |
| 5   | Human review screen + genuine interrupt/resume (close tab, reopen, still there)       | NOT STARTED |
| 6   | Jira tool (plain function first, MCP-wrapped after) + idempotency key logic           | NOT STARTED |
| 7   | Verify step + failure-state UI (simulate Jira failure → clear error + retry button)   | NOT STARTED |
| 8   | Frontend polish — React Query polling, loading/error states, review-screen validation | NOT STARTED |

**Rule:** build and verify each step before starting the next. Stop after each step and report what was built and how to test it.

---

## 10. Project Structure (updated as files are created)

```
Meting-to-Execution/
├── CLAUDE.md
├── .env
├── .gitignore
├── README.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  <- Express app entry
│       ├── db/
│       │   ├── connection.ts
│       │   └── schema.sql
│       ├── auth/
│       │   └── routes.ts
│       ├── projects/
│       │   └── routes.ts
│       ├── meetings/
│       │   └── routes.ts
│       ├── workflow/
│       │   ├── graph.ts              <- LangGraph definition
│       │   ├── state.ts              <- TypeScript type for the state object
│       │   └── nodes/               <- one file per node
│       │       ├── validate_transcript.ts
│       │       ├── fetch_historical_context.ts
│       │       ├── extract_structured_info.ts
│       │       ├── validate_schema.ts
│       │       ├── repair_or_retry.ts
│       │       ├── flag_for_manual_entry.ts
│       │       ├── compare_against_history.ts
│       │       ├── detect_ambiguity.ts
│       │       ├── generate_proposed_actions.ts
│       │       ├── human_review.ts
│       │       ├── execute_approved_actions.ts
│       │       ├── verify_results.ts
│       │       └── store_final_state.ts
│       ├── extraction/
│       │   ├── llm.ts                <- LLM call wrapper
│       │   └── schema.ts             <- Zod schemas
│       ├── integrations/
│       │   └── jira/
│       │       ├── client.ts         <- plain function first
│       │       └── mcp_tool.ts       <- MCP wrapper (added after client works)
│       ├── middleware/
│       │   └── auth.ts               <- JWT verification
│       └── utils/
│           └── idempotency.ts        <- hash generation
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css
        ├── api/
        │   └── client.ts
        ├── types/
        │   └── meeting.ts
        └── components/
            ├── layout/
            │   └── Sidebar.tsx
            ├── dashboard/
            │   └── Dashboard.tsx
            ├── project/
            │   └── ProjectPage.tsx
            ├── submit/
            │   └── SubmitTranscript.tsx
            ├── review/
            │   ├── ReviewScreen.tsx
            │   └── ProposedActionCard.tsx
            └── execution/
                └── ExecutionStatus.tsx
```

---

## 11. Builder Rules (enforced)

- Build ONE file at a time
- Update the folder tree in this file after every file creation or change
- Summarize and STOP after every step — wait for user confirmation before the next
- Never modify schema / API / architecture / build order without explicit user approval
- **Never edit files directly** — give the user the code; they make the changes
- Every external side effect (Jira ticket creation) must go through the approval gate — no exceptions; use mock mode for tests, never skip the gate
- If a locked-in decision appears wrong, say so explicitly and explain why — do not quietly work around it

### 11a. File Breakdown (required BEFORE every file)

For every file created or modified — no exceptions, even for small edits — give this breakdown before showing the code:

**What:**
One or two sentences. What is this file, in plain terms. Define any technical term the first time you use it.

**Why:**
What problem does this file solve, or what need does it meet? Why does it need to exist at all?

**How:**
How does it actually work — the logic or approach in plain English. Not a line-by-line walkthrough.

**File location:**
Exact path in the project structure (e.g. `backend/src/workflow/nodes/validate_transcript.ts`). State whether it is a new file or a modification to an existing one.

**Which layer it belongs to:**
One of: Database, Backend – Auth, Backend – API Route, Backend – Workflow Node, Backend – Extraction, Backend – Integration, Backend – Utility, Frontend – Component, Frontend – API Client, Frontend – Types, Config/Setup.

**Before → After:**
What the project could and could not do before this file existed, versus what it can do now. If it is a modification, state what changed in behavior.

**What it connects to:**

- Imports from: (list files this file imports or depends on)
- Imported by: (list files that will import or call this file)
- DB tables touched: (list tables this file reads from or writes to, or "none")
- External calls: (Jira API, LLM API, or "none")

**What would break without it:**
One sentence — what fails or becomes impossible if this file does not exist.

---

### 11b. Code Explanation (required AFTER every code block)

After giving the code, explain it in two layers:

**Plain English (no jargon):**
Explain what the code does as if the reader has never seen this kind of file before. Use analogies if helpful. Every technical term must be explained in parentheses the first time.

**Technical summary:**
Two to four sentences covering: what pattern or approach is used, any edge cases explicitly handled, and any deliberate constraints (e.g. retry cap, idempotency key, atomic update).

---

### 11c. Project Impact (required after every file)

After the code explanation, show a one-line summary of project state:

> **Project state after this file:** [what the project can now do end-to-end that it could not before]

If this file is part of a step that is not yet complete (e.g. one of several files in Step 1), state what is still missing before the step is testable.

---

## 12. Failure Scenarios (reference)

| Failure                               | Recovery                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| LLM API fails                         | Retry with backoff (2-3 attempts); mark workflow failed, let user retry                   |
| Zod validation fails                  | Repair-retry loop (max 2); then flag_for_manual_entry                                     |
| Graph crashes mid-run                 | Resume from last persisted node (state is in workflow_runs.state_json)                    |
| User does not approve for days        | Nothing breaks — state sits in pending_review indefinitely                                |
| Jira API fails after approval         | execution_logs.status = failed; surfaced to user with retry button                        |
| Jira ticket created but response lost | verify_results re-queries Jira before declaring success                                   |
| DB temporarily fails                  | Connection retry/backoff at client level; API returns 503                                 |
| Jira credentials expire               | integration_connections.expires_at checked; block with reconnect prompt                   |
| Prompt injection in transcript        | Human-approval gate is primary defense; hard cap on proposed actions per run is secondary |

---

## 13. Security Rules (enforced)

- JWT-based auth; every request that touches data must have a valid token
- Every DB query scoped by workspace_id derived from JWT — never from client body
- Jira tokens encrypted at rest, never logged, never returned to the client
- LLM output never directly triggers execution — human approval is always in between
- Hard cap on number of proposed actions per run (prompt-injection mitigation)
- Jira tool scoped to the specific Jira project the workspace connected — not arbitrary Jira projects

---

## 14. What NOT to Build (without explicit approval)

- Notion / Confluence integration
- pgvector / semantic search / embeddings
- Redis / BullMQ / job queues
- WebSockets / SSE / real-time updates
- Audio transcription (Whisper etc.)
- Multi-tenant billing / onboarding flows
- Slack notifications
- Real-time collaborative editing of the review screen
