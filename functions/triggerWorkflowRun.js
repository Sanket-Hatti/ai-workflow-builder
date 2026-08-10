const { Client } = require('pg')
const { executeWorkflow } = require('./workflowExecutor')

const DATABASE_URL =
  process.env.HASURA_GRAPHQL_DATABASE_URL ||
  process.env.POSTGRES_URL

async function getClient() {
  if (!DATABASE_URL) {
    throw new Error('Database connection string is not configured')
  }

  const client = new Client({
    connectionString: DATABASE_URL,
  })

  await client.connect()

  return client
}


module.exports = async (req, res) => {
  const { input, session_variables } = req.body

  const workflowId = input?.workflow_id
  const userId =
    session_variables?.['x-hasura-user-id']

  if (!workflowId || !userId) {
    return res.status(400).json({
      message: 'workflow_id and authenticated user are required',
    })
  }

  const client = await getClient()

  try {
    /*
     * 1. Load workflow + organization.
     */
    const workflowResult = await client.query(
      `
      SELECT
        w.id,
        w.org_id,
        o.quota_calls_allowed,
        o.quota_calls_used
      FROM workflows w
      JOIN organizations o
        ON o.id = w.org_id
      WHERE w.id = $1
      `,
      [workflowId]
    )

    if (workflowResult.rowCount === 0) {
      return res.status(404).json({
        message: 'Workflow not found',
      })
    }

    const workflow = workflowResult.rows[0]

    /*
     * 2. Check organization membership + role.
     */
    const memberResult = await client.query(
      `
      SELECT role
      FROM org_members
      WHERE user_id = $1
        AND org_id = $2
      `,
      [
        userId,
        workflow.org_id,
      ]
    )

    if (
      memberResult.rowCount === 0 ||
      !['owner', 'editor'].includes(
        memberResult.rows[0].role
      )
    ) {
      return res.status(403).json({
        message:
          'You are not authorized to trigger this workflow',
      })
    }

    /*
     * 3. Check quota.
     */
    if (
      workflow.quota_calls_used >=
      workflow.quota_calls_allowed
    ) {
      return res.status(429).json({
        message: 'Organization quota exceeded',
      })
    }

    /*
     * 4. Create workflow run.
     */
    const runResult = await client.query(
      `
      INSERT INTO workflow_runs
        (
          workflow_id,
          status,
          triggered_by,
          started_at
        )
      VALUES
        ($1, 'running', $2, now())
      RETURNING id
      `,
      [
        workflowId,
        userId,
      ]
    )

    const runId = runResult.rows[0].id

    /*
     * 5. Execute workflow.
     */
    const result = await executeWorkflow({
      client,
      workflowId,
      runId,
    })

    /*
     * 6. Increment quota only after a
     * successfully completed workflow.
     */
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
      message:
        error.message || 'Internal server error',
    })
  } finally {
    await client.end()
  }
}