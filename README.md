# AI Agent Workflow Builder

A mini n8n for chaining AI agent steps, built on Next.js + nhost (Postgres + Hasura + Auth + Functions).

**Live app:** https://ai-workflow-builder-bay.vercel.app
**Repo:** https://github.com/Sanket-Hatti/ai-workflow-builder

## Stack

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel
- **Backend:** nhost (managed Postgres + Hasura GraphQL Engine + Auth), deployed on nhost Cloud
- **Action handlers:** nhost Functions (Node.js, in `/functions`), connected directly to Postgres with the service-role connection string
- **LLM:** Groq (`llama-3.1-8b-instant`) for `llm_call` steps. Falls back to a stubbed response with a disclosed artificial delay if `GROQ_API_KEY` is not set.

## Project structure

```
ai-workflow-builder/
├── frontend/          # Next.js app
├── functions/         # nhost Functions — Hasura Action handlers
│   ├── triggerWorkflowRun.js
│   ├── approveStep.js
│   └── shared/
│       └── workflowExecutor.js
├── nhost/             # Exported Hasura metadata (schema, relationships, permissions)
└── README.md
```

## Data model

- `organizations` — tenant boundary, holds usage quota (`quota_calls_used` / `quota_calls_allowed`)
- `org_members` — links a user to an org with a role (`owner` / `editor` / `viewer`) — the backbone of all permission checks
- `workflows` — belongs to an org
- `workflow_steps` — ordered steps (`llm_call`, `http_request`, `db_write`, `notify`, `conditional_branch`, `approval_gate`), `config` as JSONB
- `workflow_triggers` — how a workflow starts (`manual`, `webhook`, `scheduled`, `db_event`)
- `workflow_runs` — one row per execution, supports a `paused` status
- `step_runs` — one row per step per run — status, input, output, error, attempt count, `approved_by` / `approved_at`

## Permissions (two layers)

1. **Org + role scoping** — enforced by Hasura row-level permissions on every table, via a relationship back to `org_members` filtered on `X-Hasura-User-Id`. An `editor` in Org A can never see or touch Org B's rows, even with the same role, because the filter always checks `org_members.org_id` against the row's own org.
2. **Step-level gating** — `owner`-only step types (`db_write`, `notify`, `webhook` triggers) are blocked at the Hasura permission layer via an insert/update `check` expression. Clearing an `approval_gate` is a mid-execution decision, so it's checked in the `approveStep` Action handler itself (not a database permission) before the run is allowed to resume.

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/Sanket-Hatti/ai-workflow-builder.git
cd ai-workflow-builder/frontend
npm install --legacy-peer-deps
```

### 2. Environment variables

Create `frontend/.env.local`:

```
NEXT_PUBLIC_NHOST_SUBDOMAIN=gifwlrjphtvxqqdyocuw
NEXT_PUBLIC_NHOST_REGION=ap-south-1
```

### 3. Run the frontend

```bash
npm run dev
```

Visit `http://localhost:3000`.

### 4. Backend (already deployed)

The Hasura/Postgres backend and the two Action handlers (`triggerWorkflowRun`, `approveStep`) are already deployed on nhost Cloud and don't need to be run locally. If you want to redeploy them yourself:

1. Create a project at [app.nhost.io](https://app.nhost.io)
2. Import the schema from `/nhost/metadata`
3. Connect this GitHub repo under Settings → General → Repository, with base directory `./` — nhost auto-detects and deploys everything under `/functions`
4. Set these environment variables on the nhost project:
   - `POSTGRES_URL` — the project's Postgres connection string
   - `GROQ_API_KEY` — optional; if unset, `llm_call` steps use a stubbed response with a disclosed artificial delay instead of a real API call

## Test accounts

| Email | Org | Role |
|---|---|---|
| ownerA@test.com | Org A | owner |
| editorA@test.com | Org A | editor |
| ownerB@test.com | Org B | owner |
| editorB@test.com | Org B | editor |

Password for all: `Password123!`

## Demonstrating the core flow

1. Log in as `ownerA@test.com`
2. Select **Test LLM Workflow** (steps: `llm_call` → `conditional_branch` → `http_request` → `approval_gate` → `llm_call`)
3. Click **Run Workflow** — watch live step-by-step status via GraphQL subscription
4. When it pauses at the approval gate, click **Approve Step** to resume
5. Log out, log in as `ownerB@test.com` — the workflow above is not visible; attempting to trigger its ID directly (even with a valid auth token) is rejected by the Action handler with a 403