# CLAUDE.md — Meeting-to-Execution Copilot

---

## Status vs Spec

> **Note on Project Status:**  
> This file originally served as the locked build specification. As implementation progressed, several architectural adjustments, schema additions, and integration refinements were made. **The codebase is now the authoritative source of truth where the implementation and this specification differ.**
>
> For setup instructions, quick-start guides, end-to-end API documentation, and known limitations, refer to the [`README.md`](file:///c:/Users/cheta/OneDrive/Desktop/PROJECTS/M2E/Meeting-to-Execution/README.md).

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

| Layer           | Choice                          | Reasoning / Actual Implementation                                                                                          |
| --------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Frontend        | React + TypeScript              | **Planned, not built.** Only a static HTML preview exists.                                                                 |
| Backend         | Node.js + TypeScript + Express  | Fits existing skills; NestJS DI overhead not justified for a solo project                                                  |
| Database        | PostgreSQL (plain SQL via `pg`) | Data is relational; no ORM, no pgvector at current scale                                                                   |
| LLM             | Gemini API                      | Gemini API (`@google/genai`), with `responseSchema` plus Zod re-validation                                                 |
| Workflow engine | LangGraph.js                    | StateGraph with `@langchain/langgraph-checkpoint-postgres` for durable interrupt/resume                                    |
| External tool   | Jira Cloud REST API v3          | Plain client function first, wrapped as an MCP-compliant tool (`src/integrations/jira/`)                                   |
| Processing      | Asynchronous background run     | Background run started by `POST /api/meetings` (fire-and-forget), client polls `GET /api/workflow-runs/:id`. No job queue. |
| Auth scope      | Single workspace per user       | Each user's first workspace is auto-provisioned/used. Ownership is enforced through joins on `workspaces.owner_id`.        |

**Explicitly excluded — do not add even as "nice to have":**

- Notion / Confluence integration
- Semantic / vector search
- Redis / BullMQ / background job queues
- WebSockets / real-time updates
- Audio transcription pipeline
- Multi-tenant billing

---

## 3. Database Schema

Every mutating action must be traceable back to a `workflow_run_id`.

### Implementation Differences vs Initial Spec

1. **`users`**: Includes `full_name TEXT`.
2. **`projects`**: Includes `description TEXT`, `jira_project_key TEXT`, and `created_by UUID REFERENCES users(id)`.
3. **`integration_connections`**: No `UNIQUE (workspace_id, provider)` constraint in `schema.sql`. The `/connect` route enforces a 1:1 connection per workspace by executing a `DELETE` before the `INSERT`.
4. **`workflow_runs.state_json`**: In the implementation, active graph state during interrupt/resume lives in the `@langchain/langgraph-checkpoint-postgres` checkpoint tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`). `workflow_runs.state_json` is updated with a final state snapshot by `store_final_state` upon completion.
5. **`proposed_actions`**: In `schema.sql`, the columns are `(id, workflow_run_id, type, payload_json, status, created_at)`. `confidence` is stored inside `payload_json` and defined on the TypeScript `proposedAction` interface, not as a standalone database column.

---

### `users`

| Column        | Type        | Notes                   |
| ------------- | ----------- | ----------------------- |
| id            | UUID PK     | `gen_random_uuid()`     |
| email         | text unique |                         |
| password_hash | text        | Bcrypt (cost factor 12) |
| full_name     | text        | Optional display name   |
| created_at    | timestamp   | `DEFAULT NOW()`         |

### `workspaces`

| Column     | Type       | Notes                                      |
| ---------- | ---------- | ------------------------------------------ |
| id         | UUID PK    | `gen_random_uuid()`                        |
| name       | text       | Defaults to "My Workspace" on JIT creation |
| owner_id   | FK → users | `ON DELETE CASCADE`                        |
| created_at | timestamp  | `DEFAULT NOW()`                            |

### `projects`

| Column           | Type            | Notes                               |
| ---------------- | --------------- | ----------------------------------- |
| id               | UUID PK         | `gen_random_uuid()`                 |
| workspace_id     | FK → workspaces | `ON DELETE CASCADE`                 |
| name             | text            | Mandatory                           |
| description      | text            | Optional (normalized to NULL)       |
| jira_project_key | text            | Target Jira board key (e.g. 'PROJ') |
| created_by       | FK → users      | User who created project            |
| created_at       | timestamp       | `DEFAULT NOW()`                     |

### `meetings`

| Column          | Type          | Notes                                                                     |
| --------------- | ------------- | ------------------------------------------------------------------------- |
| id              | UUID PK       | `gen_random_uuid()`                                                       |
| project_id      | FK → projects | `ON DELETE CASCADE`                                                       |
| raw_transcript  | text          | Trimmed meeting text                                                      |
| transcript_hash | text          | SHA-256 digest; `UNIQUE(project_id, transcript_hash)` prevents duplicates |
| created_at      | timestamp     | `DEFAULT NOW()`                                                           |

### `decisions`

| Column          | Type                                   | Notes                                           |
| --------------- | -------------------------------------- | ----------------------------------------------- |
| id              | UUID PK                                | `gen_random_uuid()`                             |
| project_id      | FK → projects                          | `ON DELETE CASCADE`                             |
| meeting_id      | FK → meetings                          | `ON DELETE CASCADE`                             |
| workflow_run_id | FK → workflow_runs                     | `ON DELETE CASCADE`                             |
| content         | text                                   |                                                 |
| status          | text CHECK in ('active', 'superseded') | Default 'active'                                |
| superseded_by   | FK → decisions (nullable, self-ref)    | Links to later decision that overrides this one |
| confidence      | numeric(4,3)                           | CHECK 0 <= confidence <= 1                      |
| source_quote    | text                                   | Exact phrase from transcript                    |
| created_at      | timestamp                              | `DEFAULT NOW()`                                 |

### `action_items`

| Column          | Type                           | Notes                                     |
| --------------- | ------------------------------ | ----------------------------------------- |
| id              | UUID PK                        | `gen_random_uuid()`                       |
| project_id      | FK → projects                  | `ON DELETE CASCADE`                       |
| meeting_id      | FK → meetings                  | `ON DELETE CASCADE`                       |
| workflow_run_id | FK → workflow_runs             | `ON DELETE CASCADE`                       |
| task            | text                           | Action summary                            |
| owner           | text (nullable)                | Unassigned if null                        |
| deadline        | date (nullable)                | ISO Date                                  |
| status          | text CHECK in ('open', 'done') | Default 'open'                            |
| confidence      | numeric(4,3)                   | CHECK 0 <= confidence <= 1                |
| ambiguity_flags | text[]                         | `DEFAULT '{}'` (e.g. `["Missing owner"]`) |
| created_at      | timestamp                      | `DEFAULT NOW()`                           |

### `open_questions`

| Column                  | Type                               | Notes                             |
| ----------------------- | ---------------------------------- | --------------------------------- |
| id                      | UUID PK                            | `gen_random_uuid()`               |
| project_id              | FK → projects                      | `ON DELETE CASCADE`               |
| meeting_id              | FK → meetings                      | `ON DELETE CASCADE`               |
| workflow_run_id         | FK → workflow_runs                 | `ON DELETE CASCADE`               |
| question                | text                               | Unresolved inquiry                |
| status                  | text CHECK in ('open', 'resolved') | Default 'open'                    |
| resolved_by_decision_id | FK → decisions (nullable)          | Traceability: why was it resolved |
| created_at              | timestamp                          | `DEFAULT NOW()`                   |

### `integration_connections`

| Column          | Type            | Notes                                                    |
| --------------- | --------------- | -------------------------------------------------------- |
| id              | UUID PK         | `gen_random_uuid()`                                      |
| workspace_id    | FK → workspaces | `ON DELETE CASCADE`                                      |
| provider        | text            | `CHECK (provider IN ('jira'))`                           |
| encrypted_token | text            | AES-256-GCM formatted as `iv:authTag:ciphertext`         |
| expires_at      | timestamp       | Verified prior to execution; blocks execution if expired |
| created_at      | timestamp       | `DEFAULT NOW()`                                          |

### `workflow_runs`

| Column     | Type                                                                                           | Notes                                                                |
| ---------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| id         | UUID PK                                                                                        | `gen_random_uuid()`                                                  |
| meeting_id | FK → meetings                                                                                  | `ON DELETE CASCADE`                                                  |
| state_json | jsonb                                                                                          | Final state snapshot written by `store_final_state` (`DEFAULT '{}'`) |
| status     | text CHECK in ('processing', 'pending_review', 'executing', 'completed', 'rejected', 'failed') | Default 'processing'                                                 |
| created_at | timestamp                                                                                      | `DEFAULT NOW()`                                                      |
| updated_at | timestamp                                                                                      | `DEFAULT NOW()`                                                      |

### `proposed_actions`

| Column          | Type                                                          | Notes                                                     |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| id              | UUID PK                                                       | `gen_random_uuid()`                                       |
| workflow_run_id | FK → workflow_runs                                            | `ON DELETE CASCADE`                                       |
| type            | text CHECK (type IN ('create_jira_issue'))                    | Extensible to other integrations                          |
| payload_json    | jsonb                                                         | JSON payload containing task, owner, deadline, confidence |
| status          | text CHECK in ('pending', 'approved', 'rejected', 'executed') | Default 'pending'                                         |
| created_at      | timestamp                                                     | `DEFAULT NOW()`                                           |

### `execution_logs`

| Column             | Type                                | Notes                                                   |
| ------------------ | ----------------------------------- | ------------------------------------------------------- |
| id                 | UUID PK                             | `gen_random_uuid()`                                     |
| proposed_action_id | FK → proposed_actions               | `ON DELETE CASCADE`                                     |
| external_id        | text                                | Jira issue key (e.g. `PROJ-42`)                         |
| idempotency_key    | text NOT NULL                       | SHA-256 hash of run ID, action type, and sorted payload |
| status             | text CHECK in ('success', 'failed') | Logged after execution attempt                          |
| error_message      | text (nullable)                     | Detailed error on failure                               |
| executed_at        | timestamp                           | `DEFAULT NOW()`                                         |

### Key Indexes in `schema.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_open_questions_project_status ON open_questions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_project_status ON decisions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_meeting ON workflow_runs(meeting_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_logs_idempotency ON execution_logs(idempotency_key);
-- Unique transcript constraint defined at table level:
-- UNIQUE (project_id, transcript_hash) on meetings
```

---

## 4. LangGraph Workflow

```
START
  │
  ▼
validate_transcript ──(invalid / error)──► END (status = 'failed') [Early Exit 1]
  │ (valid)
  ▼
fetch_historical_context    [SELECT open_questions, decisions WHERE project_id = X]
  │
  ▼
extract_structured_info ──(LLM provider error)──► END (status = 'failed') [Early Exit 2]
  │ (valid draft JSON)
  ▼
validate_schema ──(invalid & retries < 2)──► repair_or_retry ──► back to extract_structured_info
  │ (valid)                                       │ (retries >= 2)
  │                                               ▼
  │                                        flag_for_manual_entry ──► human_review
  ▼
compare_against_history     [LLM matches decisions to open questions; code updates DB]
  │
  ▼
detect_ambiguity            [Flags confidence < 0.7, missing owner, missing deadline]
  │
  ▼
generate_proposed_actions   [Filters confidence >= 0.7, caps at 10, stores 'pending']
  │
  ▼
human_review                [Calls interrupt(); checkpointer persists state; status = 'pending_review']
  │
  ├── rejected ──► status = 'rejected', no external calls ──► END
  │
  └── approved (POST /api/workflow-runs/:id/approve flips status to 'executing' BEFORE resuming)
        │
        ▼
      execute_approved_actions
        │ [SELECT idempotency_key FROM execution_logs BEFORE calling Jira]
        │ [Calls Jira REST API v3 in ADF format; writes execution_logs after]
        ▼
      verify_results          [Verifies state.execution_result status and ticket keys]
        │
        ▼
      store_final_state       [Persists decisions, actions, questions; status = 'completed']
        │
        ▼
       END
```

### State Object (`backend/src/workflow/state.ts`)

```typescript
export interface AmbiguityFlag {
  field: string;
  issue: string;
  confidence: string;
}

export interface proposedAction {
  id: string;
  task: string;
  owner: string;
  deadline: string;
  confidence: number;
  jira_project_key?: string;
  issue_type?: string;
}

export interface ExecutionResult {
  action_id: string;
  status: "success" | "failed" | "skipped";
  jira_issue_key?: string;
  error?: string;
}

export type WorkflowState = {
  transcript: string;
  project_id: string;
  workflow_id: string;
  historical_context: HistoricalContext | null;
  draft_extraction: any | null;
  validated_extraction: ExtractionResult | null;
  validation_error: string | null;
  retry_count: number;
  needs_manual_entry: boolean;
  resolved_question: ResolvedQuestion[];
  ambiguity_flags: AmbiguityFlag[];
  proposed_action: proposedAction[];
  review_status: "pending" | "approved" | "rejected";
  edited_actions: proposedAction[] | null;
  execution_result: ExecutionResult[];
  error: string | null;
};
```

### Node Details & Real Implementations:

1. **Early Exits:**
   - `routeAfterTranscriptValidation`: Returns `END` if `state.error` is populated (e.g. transcript under 50 characters).
   - `routeAfterExtraction`: Returns `END` if `state.error` is populated (LLM call or network failure).
2. **`execute_approved_actions` Ordering:**
   - The status flip (`pending_review` → `executing`) is performed atomically inside the `POST /api/workflow-runs/:id/approve` route **before** `resumeWorkflow()` is called.
3. **Idempotency Check:**
   - Code executes `SELECT external_id, status FROM execution_logs WHERE idempotency_key = $1` _before_ the Jira API call. If found, it skips Jira and reuses the existing issue key. It writes the `INSERT INTO execution_logs` _after_ Jira successfully returns.
4. **`verify_results` Behavior:**
   - Inspects `state.execution_result` in memory to confirm that each result has `status === 'success'` and a valid `jira_issue_key`. `verifyJiraIssue` exists in `client.ts` but the graph does not call it over the network during the verify step.
5. **`human_review` Interrupt/Resume:**
   - Calls LangGraph `interrupt()`. The state is saved into PostgreSQL via `@langchain/langgraph-checkpoint-postgres`.
   - On resumption, `resumeWorkflow()` passes `new Command({ resume: { decision, edited_actions } })`. The node re-runs from its top upon resume, capturing the decision.

---

## 5. Structured Output Schema

Zod validates this shape on every LLM response before it enters graph state (`backend/src/extraction/schema.ts`):

```typescript
export const DecisionSchema = z.object({
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source_quote: z.string().min(1),
});

export const ActionItemSchema = z.object({
  task: z.string().min(1),
  owner: z.string().nullable(),
  deadline: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  ambiguity_flags: z.array(z.string()).default([]),
});

export const OpenQuestionSchema = z.object({
  question: z.string().min(1),
  status: z.literal("open").default("open"),
});

export const ExtractionSchema = z.object({
  decisions: z.array(DecisionSchema),
  action_items: z.array(ActionItemSchema),
  open_questions: z.array(OpenQuestionSchema),
});
```

### Extraction Rules:

- **Confidence Filtering:** `generate_proposed_actions` filters for action items with `confidence >= 0.7` and caps at **10 proposed actions** per run.
- **Hedged Language:** Tests show hedged commitments (e.g. _"Ravi said he'll probably take care of the backend changes"_) can still receive scores around ~0.8 from Gemini. Do not assume hedged language always falls below 0.5; ambiguity detection flags missing owners and vague deadlines regardless of confidence.
- **Low-Confidence Items:** Items with confidence < 0.7 are flagged by `detect_ambiguity` and persisted into the `action_items` table upon completion, but are **never proposed as candidate Jira tickets**.
- **Repair Loop:** `repair_or_retry.ts` verifies `state.validation_error` and appends a `--- SYSTEM REPAIR NOTE ---` containing the exact Zod issue paths and messages to the transcript. The loop allows up to 2 retries before routing to `flag_for_manual_entry`.

---

## 6. Idempotency Design

### Three Lines of Defense Against Duplicates:

1. **Duplicate Transcript Prevention:**
   - `POST /api/meetings` calculates `createHash('sha256').update(transcript.trim()).digest('hex')`.
   - If PostgreSQL throws constraint error `23505` on `UNIQUE (project_id, transcript_hash)`, the API returns `409 Conflict`.

2. **Atomic Approval Guard:**
   - When approving via `POST /api/workflow-runs/:id/approve`:
     ```sql
     UPDATE workflow_runs
     SET status = 'executing', updated_at = NOW()
     WHERE id = $1 AND status = 'pending_review'
     ```
   - If `rowCount === 0`, the endpoint immediately returns `409 Conflict`, preventing duplicate approvals from triggering concurrent executions.

3. **Execution Idempotency Key (`backend/src/utils/idempotency.ts`):**
   - The key is computed as:
     ```typescript
     const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());
     const raw = `${workflowRunId}:${actionType}:${sortedPayload}`;
     return createHash("sha256").update(raw).digest("hex");
     ```
   - Before calling Jira, `execute_approved_actions` queries `SELECT external_id FROM execution_logs WHERE idempotency_key = $1`.
   - If found, it skips the external Jira API call and reuses the existing issue key.
   - **Known Production Gap:** If the Node process crashes after Jira successfully creates a ticket but before the `INSERT INTO execution_logs` commits, a subsequent retry will not find the key and will create a duplicate ticket in Jira.

---

## 7. API Endpoints

All endpoints are mounted under `/api` (configured in `backend/src/index.ts`). Every route except `/api/auth/register`, `/api/auth/login`, and `/health` requires `Authorization: Bearer <token>`.

| Method | Path                                         | Auth | Purpose                                                                                                                       | Status               |
| :----- | :------------------------------------------- | :--- | :---------------------------------------------------------------------------------------------------------------------------- | :------------------- |
| `POST` | `/api/auth/register`                         | No   | Body: `email`, `password` (8+ chars), optional `full_name`.                                                                   | **Implemented**      |
| `POST` | `/api/auth/login`                            | No   | Body: `email`, `password`. Returns JWT and user.                                                                              | **Implemented**      |
| `POST` | `/api/projects`                              | Yes  | Body: `name`, optional `description`, `jira_project_key`. Auto-provisions workspace.                                          | **Implemented**      |
| `GET`  | `/api/projects/:id`                          | Yes  | Returns project details if owned by caller (`created_by = userId`).                                                           | **Implemented**      |
| `GET`  | `/api/projects/:id/open-questions`           | Yes  | List open questions for a project.                                                                                            | _Planned, not built_ |
| `GET`  | `/api/projects/:id/decisions`                | Yes  | List decisions with superseded chain.                                                                                         | _Planned, not built_ |
| `POST` | `/api/integrations/jira/connect`             | Yes  | Body: `workspaceId`, `domain`, `email`, `apiToken`, optional `expiresAt`. Encrypts credentials (Basic auth).                  | **Implemented**      |
| `GET`  | `/api/integrations/jira/status?workspaceId=` | Yes  | Returns `{ connected, isExpired, expiresAt, connectedAt }`.                                                                   | **Implemented**      |
| `POST` | `/api/meetings`                              | Yes  | Body: `project_id`, `transcript`. Returns 201 with `meeting_id`, `workflow_run_id`, `status: "processing"`. 409 on duplicate. | **Implemented**      |
| `GET`  | `/api/workflow-runs/:id`                     | Yes  | Poll workflow status. Returns proposed actions and ambiguities when `pending_review`.                                         | **Implemented**      |
| `POST` | `/api/workflow-runs/:id/approve`             | Yes  | Body: optional `{ edited_actions?: [...] }`. Flips status to `executing` and resumes graph. 409 if not `pending_review`.      | **Implemented**      |
| `POST` | `/api/workflow-runs/:id/reject`              | Yes  | Flips status to `rejected`. Graph terminates without Jira calls.                                                              | **Implemented**      |
| `GET`  | `/api/workflow-runs/:id/execution-log`       | Yes  | View Jira action execution results.                                                                                           | _Planned, not built_ |
| `GET`  | `/health`                                    | No   | Returns `{ status: 'ok' }`.                                                                                                   | **Implemented**      |

> **Authorization Rule:** Scoped by ownership joins from the JWT user (`workspaces.owner_id = userId`), not by a `workspace_id` supplied in the client request body. Non-existent and unauthorized resources both return `404 Not Found`.

---

## 8. Frontend Screens

> **Status:** **Planned, not built.**  
> A static HTML/CSS mock exists in `frontend/`, but there is no active React application connected to the backend.

1. **Dashboard** — list of projects, recent meetings, count of pending-review workflows.
2. **Project page** — meetings list, open questions timeline, decision history.
3. **Submit transcript** — textarea + submit button; triggers polling.
4. **Review screen** — editable action items, ambiguity flags, Approve/Reject buttons.
5. **Execution status** — Jira issue links once created, or error state with retry.

---

## 9. Build Order (Milestones)

| #   | Milestone                                                                             | Status          | Notes                                                                                             |
| --- | ------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Postgres schema + auth + workspace/project/meeting CRUD (no AI yet)                   | **DONE**        | Verified end-to-end against PostgreSQL                                                            |
| 2   | Extraction function in isolation (LLM call + Zod validation, no graph yet)            | **DONE**        | Tested via `src/test-extraction.ts`                                                               |
| 3   | Cross-meeting memory: historical context fetch + open-question resolution logic       | **DONE**        | Implemented in `history.ts` & `resolver.ts`                                                       |
| 4   | Wrap in LangGraph.js — full graph with retry loop + interrupt node                    | **DONE**        | 13 nodes, checkpointer, and graph compiling                                                       |
| 5   | Human review screen + genuine interrupt/resume                                        | **PARTIAL**     | Backend interrupt/resume and checkpointer complete; UI not built; cross-restart resume unverified |
| 6   | Jira tool (plain function first, MCP-wrapped after) + idempotency key logic           | **DONE**        | Tested against real Jira Cloud instance (`src/test-jira.ts`)                                      |
| 7   | Verify step + failure-state UI                                                        | **PARTIAL**     | Node 12 verifies execution results in memory, but does not re-fetch from Jira; no UI built        |
| 8   | Frontend polish — React Query polling, loading/error states, review-screen validation | **NOT STARTED** | No frontend client built                                                                          |

---

## 10. Project Structure

```text
Meeting-to-Execution/
├── CLAUDE.md
├── README.md
├── .gitignore
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── sample_transcript.txt
│   ├── scripts/
│   │   └── seed-jira.ts              <- Seeds Jira credentials into DB
│   └── src/
│       ├── index.ts                  <- Express app entry & checkpointer initialization
│       ├── test-extraction.ts        <- Test script for Gemini extraction
│       ├── test-jira.ts              <- Test script for Jira client
│       ├── test-execution-node.ts    <- Test script for Node 11 idempotency
│       ├── test-workflow.ts          <- Test script for end-to-end graph run
│       ├── test-mcp-tool.ts          <- Test script for MCP tool handlers
│       ├── db/
│       │   ├── connection.ts         <- PostgreSQL pg pool & query helper
│       │   └── schema.sql            <- 11 relational tables & indexes
│       ├── auth/
│       │   └── routes.ts             <- User registration, login, JWT issuance
│       ├── projects/
│       │   └── routes.ts             <- Project CRUD & JIT workspace provisioning
│       ├── meetings/
│       │   └── routes.ts             <- Submit transcript & trigger background workflow
│       ├── workflow/
│       │   ├── graph.ts              <- StateGraph definition, runWorkflow, resumeWorkflow
│       │   ├── state.ts              <- WorkflowState TypeScript interface & annotations
│       │   ├── checkpointer.ts       <- PostgresSaver setup
│       │   ├── routes.ts             <- Workflow polling, approve, and reject routes
│       │   └── nodes/                <- 13 distinct workflow nodes
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
│       │   ├── llm.ts                <- Gemini SDK call wrapper with responseSchema
│       │   ├── schema.ts             <- Zod extraction & validation schemas
│       │   ├── history.ts            <- Past decisions & open questions query helpers
│       │   └── resolver.ts           <- Second LLM call: matches decisions to open questions
│       ├── integrations/
│       │   ├── routes.ts             <- Jira connect & status check routes
│       │   └── jira/
│       │       ├── client.ts         <- createJiraIssue (ADF format) & verifyJiraIssue
│       │       └── mcp_tool.ts       <- MCP-compliant tool definitions and handlers
│       ├── middleware/
│       │   └── auth.ts               <- Express JWT authentication middleware
│       └── utils/
│           ├── crypto.ts             <- AES-256-GCM encryption and decryption helpers
│           └── idempotency.ts        <- Canonical JSON SHA-256 idempotency key generator
└── frontend/                         <- Planned, not built (static mock preview only)
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

**What:** One or two sentences. What is this file, in plain terms. Define any technical term the first time you use it.  
**Why:** What problem does this file solve, or what need does it meet? Why does it need to exist at all?  
**How:** How does it actually work — the logic or approach in plain English. Not a line-by-line walkthrough.  
**File location:** Exact path in the project structure (e.g. `backend/src/workflow/nodes/validate_transcript.ts`).  
**Which layer it belongs to:** Database, Backend – Auth, Backend – API Route, Backend – Workflow Node, Backend – Extraction, Backend – Integration, Backend – Utility, Frontend, Config/Setup.  
**Before → After:** What the project could and could not do before this file existed, versus what it can do now.  
**What it connects to:** Imports from, Imported by, DB tables touched, External calls.  
**What would break without it:** One sentence — what fails or becomes impossible if this file does not exist.

---

### 11b. Code Explanation (required AFTER every code block)

**Plain English (no jargon):** Explain what the code does as if the reader has never seen this kind of file before.  
**Technical summary:** Two to four sentences covering approach, edge cases handled, and deliberate constraints.

---

### 11c. Project Impact (required after every file)

> **Project state after this file:** [what the project can now do end-to-end that it could not before]

---

## 12. Failure Scenarios (Actual Code Behavior)

| Failure                                   | Actual Implementation Behavior                                                                                                                                                                                     |
| :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LLM API fails**                         | The code does not retry with exponential backoff. A network or provider exception sets `state.error` and immediately terminates the workflow via early exit as `status = 'failed'`.                                |
| **Zod validation fails**                  | Routes to `repair_or_retry` (up to 2 times), appending `state.validation_error` to the transcript. If retries are exhausted, transitions to `flag_for_manual_entry`.                                               |
| **Graph crashes mid-run**                 | LangGraph checkpoints are saved in PostgreSQL, but there is no supervisor process or job queue. A crashed run remains in `status = 'processing'` indefinitely and is not auto-resumed.                             |
| **User does not approve for days**        | State sits safely in PostgreSQL checkpoints under `status = 'pending_review'` indefinitely without timing out.                                                                                                     |
| **Jira API fails after approval**         | `execute_approved_actions` logs `status = 'failed'` and records the error string in `execution_logs`. There is no retry UI button.                                                                                 |
| **Jira ticket created but response lost** | Unhandled. `verify_results` checks in-memory execution results only; it does not re-query Jira over the network.                                                                                                   |
| **DB temporarily fails**                  | API queries fail with standard `500 Internal Server Error`. No 503 backoff or connection pooling retry is implemented.                                                                                             |
| **Jira credentials expire**               | `GET /api/integrations/jira/status` dynamically reports `isExpired: true`. Node 11 (`execute_approved_actions`) checks `expires_at` before decryption and blocks execution with an error if the token has expired. |
| **Prompt injection in transcript**        | Mitigated: Node 10 mandates human approval before any external Jira call, and Node 9 caps proposed actions at a maximum of 10.                                                                                     |

---

## 13. Security Rules (Enforced)

- **JWT Authentication:** Every API route that accesses or mutates data requires a valid Bearer token validated by `authenticateToken`.
- **Tenant Isolation:** Every database query verifies resource ownership through joins on `workspaces.owner_id = req.user.userId`. Scoping is strictly derived from the caller's authenticated JWT, never from untrusted client request bodies.
- **Secrets Encryption at Rest:** Jira API credentials are encrypted with AES-256-GCM (`crypto.ts`) and stored as `iv:authTag:ciphertext`. Tokens are decrypted in memory only at execution time, never logged, and never returned to the frontend.
- **Zero Autonomous Side-Effects:** LLM output can never directly trigger an Atlassian API call. Execution physically halts at Node 10 until an authenticated human calls the approve route.
- **Proposed Action Cap:** A hard limit of 10 proposed actions per run and the cap limits how many tickets one transcript can propose. against prompt injection.
- **Jira Project Scoping:** The workflow graph automatically scopes tickets to the project's configured `jira_project_key`. The standalone MCP tool wrapper (`mcp_tool.ts`) accepts any arbitrary `projectKey` parameter supplied to it.

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
