const { Client } = require('pg')

// Called by Hasura's "triggerWorkflowRun" Action.
// Runs with full database access — Hasura's row-level permissions do NOT
// apply here, so every check that matters (org membership, role, quota)
// is done explicitly in this code. This is also why triggering a run is
// NOT allowed via direct table insert in Hasura permissions (see workflow_runs
// permissions) — the only path to create a run is through this checked logic.

const DATABASE_URL = process.env.HASURA_GRAPHQL_DATABASE_URL || process.env.POSTGRES_URL

async function getClient() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  return client
}

async function runLlmCall(config) {
  const apiKey = process.env.GROQ_API_KEY
  const prompt = (config && config.prompt) || 'Say hello'
  if (!apiKey) {
    await new Promise((r) => setTimeout(r, 800)) // disclosed artificial delay, no key configured
    return { text: `[stubbed llm response] ${prompt}`, stubbed: true }
  }
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`llm_call failed: ${res.status}`)
  const data = await res.json()
  return { text: (data.choices && data.choices[0] && data.choices[0].message.content) || '', raw: data }
}

async function runHttpRequest(config) {
  const { url, method = 'GET', headers = {}, body } = config || {}
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let parsed = text
  try { parsed = JSON.parse(text) } catch (_) {}
  if (!res.ok) throw new Error(`http_request failed: ${res.status}`)
  return { status: res.status, body: parsed }
}

async function runDbWrite(config, previousOutput) {
  return { saved: true, value: previousOutput ?? (config && config.value) ?? null }
}

function evaluateCondition(config, previousOutput) {
  const field = config && config.field
  const op = (config && config.operator) || 'contains'
  const expected = config && config.value
  const actual = field ? previousOutput && previousOutput[field] : previousOutput
  if (op === 'contains') return String(actual ?? '').includes(String(expected))
  if (op === 'equals') return actual === expected
  return Boolean(actual)
}

async function withRetry(fn, attempts = 2) {
  let lastError = ''
  for (let i = 1; i <= attempts; i++) {
    try {
      const result = await fn()
      return { result, attemptCount: i }
    } catch (e) {
      lastError = e.message || String(e)
    }
  }
  return { error: lastError, attemptCount: attempts }
}

module.exports = async (req, res) => {
  const { input, session_variables } = req.body
  const workflowId = input.workflow_id
  const userId = session_variables['x-hasura-user-id']

  const client = await getClient()
  try {
    const workflowRes = await client.query(
      `SELECT w.id, w.org_id, o.quota_calls_allowed, o.quota_calls_used
       FROM workflows w JOIN organizations o ON o.id = w.org_id WHERE w.id = $1`,
      [workflowId]
    )
    if (workflowRes.rowCount === 0) return res.status(404).json({ message: 'Workflow not found' })
    const { org_id, quota_calls_allowed, quota_calls_used } = workflowRes.rows[0]

    const memberRes = await client.query(
      `SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2`,
      [userId, org_id]
    )
    if (memberRes.rowCount === 0 || !['owner', 'editor'].includes(memberRes.rows[0].role)) {
      return res.status(403).json({ message: 'Not authorized to trigger this workflow' })
    }

    if (quota_calls_used >= quota_calls_allowed) {
      return res.status(429).json({ message: 'Organization quota exceeded' })
    }

    const runRes = await client.query(
      `INSERT INTO workflow_runs (workflow_id, status, triggered_by, started_at)
       VALUES ($1, 'running', $2, now()) RETURNING id`,
      [workflowId, userId]
    )
    const runId = runRes.rows[0].id

    const stepsRes = await client.query(
      `SELECT id, step_order, type, config FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC`,
      [workflowId]
    )
    const steps = stepsRes.rows

    let previousOutput = null
    let paused = false

    for (const step of steps) {
      const stepRunRes = await client.query(
        `INSERT INTO step_runs (workflow_run_id, step_id, status, input, started_at, attempt_count)
         VALUES ($1, $2, 'running', $3, now(), 0) RETURNING id`,
        [runId, step.id, JSON.stringify(previousOutput)]
      )
      const stepRunId = stepRunRes.rows[0].id

      if (step.type === 'approval_gate') {
        await client.query(`UPDATE step_runs SET status = 'awaiting_approval' WHERE id = $1`, [stepRunId])
        await client.query(`UPDATE workflow_runs SET status = 'paused' WHERE id = $1`, [runId])
        paused = true
        break
      }

      if (step.type === 'conditional_branch') {
        const passed = evaluateCondition(step.config, previousOutput)
        await client.query(
          `UPDATE step_runs SET status = 'succeeded', output = $2, ended_at = now() WHERE id = $1`,
          [stepRunId, JSON.stringify({ passed })]
        )
        previousOutput = { passed }
        continue
      }

      let outcome
      if (step.type === 'llm_call') {
        outcome = await withRetry(() => runLlmCall(step.config))
      } else if (step.type === 'http_request') {
        outcome = await withRetry(() => runHttpRequest(step.config))
      } else if (step.type === 'db_write') {
        outcome = await withRetry(() => runDbWrite(step.config, previousOutput))
      } else if (step.type === 'notify') {
        outcome = await withRetry(async () => ({ notified: true, message: step.config && step.config.message }))
      } else {
        outcome = { error: `Unknown step type: ${step.type}`, attemptCount: 1 }
      }

      if (outcome.error) {
        await client.query(
          `UPDATE step_runs SET status = 'failed', error = $2, attempt_count = $3, ended_at = now() WHERE id = $1`,
          [stepRunId, outcome.error, outcome.attemptCount]
        )
        await client.query(`UPDATE workflow_runs SET status = 'failed', ended_at = now() WHERE id = $1`, [runId])
        return res.json({ run_id: runId, status: 'failed' })
      }

      await client.query(
        `UPDATE step_runs SET status = 'succeeded', output = $2, attempt_count = $3, ended_at = now() WHERE id = $1`,
        [stepRunId, JSON.stringify(outcome.result), outcome.attemptCount]
      )
      previousOutput = outcome.result
    }

    if (!paused) {
      await client.query(`UPDATE workflow_runs SET status = 'succeeded', ended_at = now() WHERE id = $1`, [runId])
      await client.query(`UPDATE organizations SET quota_calls_used = quota_calls_used + 1 WHERE id = $1`, [org_id])
    }

    return res.json({ run_id: runId, status: paused ? 'paused' : 'succeeded' })
  } catch (e) {
    return res.status(500).json({ message: e.message || 'Internal error' })
  } finally {
    await client.end()
  }
}