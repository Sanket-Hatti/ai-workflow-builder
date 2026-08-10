const { Client } = require('pg')
const { executeWorkflow } = require('./lib/workflowExecutor')

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

  const stepRunId = input?.step_run_id

  const userId =
    session_variables?.['x-hasura-user-id']

  if (!stepRunId || !userId) {
    return res.status(400).json({
      message:
        'step_run_id and authenticated user are required',
    })
  }

  const client = await getClient()

  try {
    /*
     * Find the paused approval step.
     */
    const result = await client.query(
      `
      SELECT
        sr.id AS step_run_id,
        sr.status,
        sr.step_id,
        sr.workflow_run_id,
        wr.workflow_id,
        w.org_id
      FROM step_runs sr
      JOIN workflow_runs wr
        ON wr.id = sr.workflow_run_id
      JOIN workflows w
        ON w.id = wr.workflow_id
      WHERE sr.id = $1
      `,
      [stepRunId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: 'Step run not found',
      })
    }

    const row = result.rows[0]

    /*
     * Must actually be waiting for approval.
     */
    if (row.status !== 'awaiting_approval') {
      return res.status(400).json({
        message:
          'This step is not awaiting approval',
      })
    }

    /*
     * Verify approver belongs to the same organization.
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
        row.org_id,
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
          'You are not authorized to approve this step',
      })
    }

    /*
     * Mark approval.
     */
    await client.query(
      `
      UPDATE step_runs
      SET
        status = 'succeeded',
        approved_by = $2,
        approved_at = now(),
        ended_at = now()
      WHERE id = $1
      `,
      [
        stepRunId,
        userId,
      ]
    )

    /*
     * Resume workflow.
     */
    await client.query(
      `
      UPDATE workflow_runs
      SET status = 'running'
      WHERE id = $1
      `,
      [row.workflow_run_id]
    )

    /*
     * Continue with the SAME workflow executor.
     */
    const executionResult =
      await executeWorkflow({
        client,
        workflowId: row.workflow_id,
        runId: row.workflow_run_id,
        startAfterStepId: row.step_id,
      })

    /*
     * If workflow finished successfully,
     * increment quota.
     *
     * NOTE:
     * We'll later make quota accounting atomic.
     */
    if (executionResult.status === 'succeeded') {
      await client.query(
        `
        UPDATE organizations
        SET quota_calls_used = quota_calls_used + 1
        WHERE id = $1
        `,
        [row.org_id]
      )
    }

    return res.json({
      step_run_id: stepRunId,
      status: executionResult.status,
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