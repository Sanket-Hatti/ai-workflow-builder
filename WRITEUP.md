# Write-up: AI Agent Workflow Builder

## Schema reasoning

The schema follows the relationship chain the assignment specifies: `organizations → org_members → workflows → workflow_steps / workflow_triggers → workflow_runs → step_runs`.

`org_members` is a separate join table (rather than a `role` column on `organizations` or `workflows`) because a single user can belong to multiple organizations with different roles in each, and because it's the one table every permission rule needs to join back to. Keeping it as its own table with a `(user_id, org_id)` unique constraint means every other table only needs one relationship — either directly to an org (`workflows.org_id`) or transitively through a workflow (`workflow_steps.workflow_id → workflows.org_id`) — to reach `org_members` and resolve "does this caller belong to this row's org, and with what role."

`step_runs` is deliberately separate from `workflow_runs` rather than storing per-step status as JSON on the run, because the assignment requires a live subscription filtered by `workflow_run_id` that reflects step-by-step progress — that's naturally a one-row-per-step table Hasura can subscribe to directly, with its own `status`, `input`, `output`, `error`, `attempt_count`, and `approved_by`/`approved_at` for the approval-gate case.

Enums (`org_role`, `step_type`, `trigger_type`, `run_status`, `step_run_status`) constrain values at the database level, so an invalid role or status can't be inserted even by a bug in application code, not just by convention.

## How the two permission layers are enforced differently

**Layer 1 (org + role scoping)** is enforced entirely in Hasura's declarative row-level permissions. Every table's `select`/`insert`/`update`/`delete` permission for `owner`/`editor`/`viewer` includes a relationship-based filter back to `org_members`, checking `user_id = X-Hasura-User-Id` and the row's org matches the caller's org via that relationship. Because this is a database-level filter (not application code), it's enforced identically no matter which client or API path is used to reach the data — there's no way to bypass it by hitting the GraphQL API a different way.

**Layer 2 (step-level gating)** is enforced two different ways depending on what kind of check it is:

- The parts of Layer 2 that are still a simple row check — "only an owner can insert a `db_write`/`notify` step, or a `webhook` trigger" — are still expressed as Hasura permissions, using an insert/update `check` expression that combines the org/role filter with `type NOT IN (...)` for the `editor` role. This is a static rule about the shape of the row being written, so it fits the same declarative model as Layer 1.
- Approving a paused `approval_gate` step is not a simple row read/write — it's a mid-execution decision that also has to resume the workflow's remaining steps. That logic can't live in a Hasura permission (permissions can't drive execution), so it's enforced explicitly in code inside the `approveStep` Action handler: the handler loads the step, confirms it's actually `awaiting_approval`, looks up the caller's `org_members` role for that step's org, and only proceeds if the role is `owner` or `editor` — otherwise it returns 403 before touching the database. `workflow_runs` and `step_runs` also have no direct insert/update permission for any non-admin role in Hasura, specifically so the only way to create a run or resume one is through this checked Action logic, not a raw mutation.

## Approval-gate pause/resume implementation

`triggerWorkflowRun` executes steps in order inside the Action handler. On hitting an `approval_gate` step, it inserts a `step_runs` row with `status = 'awaiting_approval'`, sets the `workflow_runs.status` to `'paused'`, and stops the loop — it does not continue to later steps.

`approveStep` is a second Action. After the authorization check described above, it marks that step's row `succeeded` with `approved_by`/`approved_at` set, flips the run back to `'running'`, and then calls the same step-execution logic (`workflowExecutor.js`) starting from the step immediately after the one that was just approved — so any remaining steps (another `llm_call`, `http_request`, etc.) actually execute for real, rather than being marked complete without running. If a later step in that remaining sequence is itself another `approval_gate`, the run pauses again the same way.

Because both `workflow_runs.status` and `step_runs.status` are updated at each stage, the frontend's Hasura subscription on `step_runs` (filtered by `workflow_run_id`) reflects `running → awaiting_approval → succeeded` live with no page refresh, including the paused state while waiting for approval.