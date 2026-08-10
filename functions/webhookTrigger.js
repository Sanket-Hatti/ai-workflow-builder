const { Client } = require('pg')
const { executeWorkflow } = require('../shared/workflowExecutor')

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.HASURA_GRAPHQL_DATABASE_URL ||
  process.env.POSTGRES_URL

async function getClient() {
  if (!DATABASE_URL) {
    throw new Error('Database connection string is not configured')
  }

  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  return client
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      message: 'Method not allowed',
    })
  }

  const { workflow_id, secret } = req.body || {}
  if (!workflow_id || !secret) {
    return res.status(400).json({
      message: 'workflow_id and secret are required',
    })
  }

  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({
      message: 'Invalid webhook secret',
    })
  }

  const client = await getClient()

  try {
    const workflowResult = await client.query(
      `
      SELECT
        w.id,
        w.org_id,
        o.quota_calls_allowed,
        o.quota_calls_used
      FROM workflows w
      JOIN organizations o ON o.id = w.org_id
      WHERE w.id = $1
      `,
      [workflow_id]
    )

    if (workflowResult.rowCount === 0) {
      return res.status(404).json({
        message: 'Workflow not found',
      })
    }

    const workflow = workflowResult.rows[0]

    if (
      workflow.quota_calls_used >=
      workflow.quota_calls_allowed
    ) {
      return res.status(429).json({
        message: 'Organization quota exceeded',
      })
    }

    const runResult = await client.query(
      `
      INSERT INTO workflow_runs
        (workflow_id, status, started_at)
      VALUES
        ($1, 'running', now())
      RETURNING id
      `,
      [workflow_id]
    )

    const runId = runResult.rows[0].id

    const result = await executeWorkflow({
      client,
      workflowId: workflow_id,
      runId,
    })

    if (result.status === 'succeeded') {
      await client.query(
        `
        UPDATE organizations
        SET quota_calls_used = quota_calls_used + 1
        WHERE id = $1
        `,
        [workflow.org_id]
      )
    }

    return res.json({
      workflow_run_id: runId,
      status: result.status,
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      message: error.message || 'Internal server error',
    })
  } finally {
    await client.end()
  }
}