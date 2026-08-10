const GROQ_API_URL =
  'https://api.groq.com/openai/v1/chat/completions'

/**
 * Execute an LLM step using Groq.
 */
async function runLlmCall(config) {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured')
  }

  const prompt = config?.prompt || ''

  if (!prompt) {
    throw new Error('llm_call requires a prompt')
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: config.temperature ?? 0.2,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `LLM request failed (${response.status}): ${errorText}`
    )
  }

  const data = await response.json()

  const text =
    data?.choices?.[0]?.message?.content || ''

  return {
    text,
    model: config.model || 'llama-3.1-8b-instant',
  }
}


/**
 * Execute an HTTP request step.
 */
async function runHttpRequest(config) {
  if (!config?.url) {
    throw new Error('http_request requires a URL')
  }

  const method = config.method || 'GET'

  const headers = config.headers || {}

  const options = {
    method,
    headers,
  }

  if (
    config.body !== undefined &&
    !['GET', 'HEAD'].includes(method.toUpperCase())
  ) {
    options.body =
      typeof config.body === 'string'
        ? config.body
        : JSON.stringify(config.body)

    if (!headers['Content-Type']) {
      options.headers = {
        ...headers,
        'Content-Type': 'application/json',
      }
    }
  }

  const response = await fetch(
    config.url,
    options
  )

  const text = await response.text()

  let body = text

  try {
    body = JSON.parse(text)
  } catch {
    // Keep response as plain text.
  }

  if (!response.ok) {
    throw new Error(
      `HTTP request failed (${response.status})`
    )
  }

  return {
    status: response.status,
    body,
  }
}


/**
 * Execute a DB write step.
 *
 * The actual workflow output is persisted into workflow_data.
 * The config can optionally provide additional data.
 */
async function runDbWrite(
  client,
  runId,
  step,
  previousOutput
) {
  const data =
    step.config?.data !== undefined
      ? step.config.data
      : previousOutput

  await client.query(
    `
    INSERT INTO workflow_data
      (
        workflow_run_id,
        step_id,
        data
      )
    VALUES
      ($1, $2, $3)
    `,
    [
      runId,
      step.id,
      JSON.stringify(data ?? null),
    ]
  )

  return {
    saved: true,
    data,
  }
}


/**
 * Execute a notification step.
 *
 * For the assignment we persist the notification event.
 */
async function runNotify(
  client,
  runId,
  step,
  previousOutput
) {
  const message =
    step.config?.message ||
    'Workflow notification'

  const notification = {
    type: 'notification',
    message,
    input: previousOutput,
  }

  await client.query(
    `
    INSERT INTO workflow_data
      (
        workflow_run_id,
        step_id,
        data
      )
    VALUES
      ($1, $2, $3)
    `,
    [
      runId,
      step.id,
      JSON.stringify(notification),
    ]
  )

  return {
    notified: true,
    message,
  }
}


/**
 * Evaluate a conditional branch.
 */
function evaluateCondition(config, previousOutput) {
  const field = config?.field
  const op = config?.operator || 'contains'
  const expected = config?.value

  let actual = previousOutput

  if (field) {
    actual = field
      .split('.')
      .reduce(
        (value, key) => value?.[key],
        previousOutput
      )
  }

  if (op === 'contains') {
    return String(actual ?? '').includes(
      String(expected)
    )
  }

  if (op === 'not_contains') {
    return !String(actual ?? '').includes(
      String(expected)
    )
  }

  if (op === 'equals') {
    return actual === expected
  }

  if (op === 'not_equals') {
    return actual !== expected
  }

  if (op === 'exists') {
    return actual !== undefined &&
      actual !== null
  }

  if (op === 'truthy') {
    return Boolean(actual)
  }

  return false
}


/**
 * Retry a step.
 */
async function withRetry(
  fn,
  maxAttempts = 2
) {
  let lastError

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      const result = await fn()

      return {
        result,
        attemptCount: attempt,
      }
    } catch (error) {
      lastError = error

      if (attempt === maxAttempts) {
        break
      }
    }
  }

  return {
    error:
      lastError?.message ||
      'Step execution failed',
    attemptCount: maxAttempts,
  }
}


/**
 * Execute one workflow step.
 */
async function executeStep({
  client,
  runId,
  step,
  previousOutput,
}) {
  /*
   * Approval gates are handled by the executor.
   * The workflow is paused and the approval action
   * resumes it later.
   */
  if (step.type === 'approval_gate') {
    const stepRunResult = await client.query(
      `
      INSERT INTO step_runs
        (
          workflow_run_id,
          step_id,
          status,
          input,
          started_at,
          attempt_count
        )
      VALUES
        (
          $1,
          $2,
          'awaiting_approval',
          $3,
          now(),
          0
        )
      RETURNING id
      `,
      [
        runId,
        step.id,
        JSON.stringify(previousOutput),
      ]
    )

    await client.query(
      `
      UPDATE workflow_runs
      SET status = 'paused'
      WHERE id = $1
      `,
      [runId]
    )

    return {
      status: 'paused',
      stepRunId:
        stepRunResult.rows[0].id,
    }
  }


  /*
   * Create step run.
   */
  const stepRunResult = await client.query(
    `
    INSERT INTO step_runs
      (
        workflow_run_id,
        step_id,
        status,
        input,
        started_at,
        attempt_count
      )
    VALUES
      (
        $1,
        $2,
        'running',
        $3,
        now(),
        0
      )
    RETURNING id
    `,
    [
      runId,
      step.id,
      JSON.stringify(previousOutput),
    ]
  )

  const stepRunId =
    stepRunResult.rows[0].id


  /*
   * Conditional branch.
   */
  if (step.type === 'conditional_branch') {
    const passed =
      evaluateCondition(
        step.config,
        previousOutput
      )

    const output = {
      passed,
    }

    await client.query(
      `
      UPDATE step_runs
      SET
        status = 'succeeded',
        output = $2,
        attempt_count = 1,
        ended_at = now()
      WHERE id = $1
      `,
      [
        stepRunId,
        JSON.stringify(output),
      ]
    )

    await client.query(
      `
      INSERT INTO workflow_data
        (
          workflow_run_id,
          step_id,
          data
        )
      VALUES
        ($1, $2, $3)
      `,
      [
        runId,
        step.id,
        JSON.stringify(output),
      ]
    )

    return {
      status: 'succeeded',
      output,
    }
  }


  /*
   * Execute normal step types.
   */
  let operation

  switch (step.type) {
    case 'llm_call':
      operation = () =>
        runLlmCall(step.config)
      break

    case 'http_request':
      operation = () =>
        runHttpRequest(step.config)
      break

    case 'db_write':
      operation = () =>
        runDbWrite(
          client,
          runId,
          step,
          previousOutput
        )
      break

    case 'notify':
      operation = () =>
        runNotify(
          client,
          runId,
          step,
          previousOutput
        )
      break

    default:
      throw new Error(
        `Unsupported step type: ${step.type}`
      )
  }


  const maxAttempts =
    Number(step.config?.max_attempts) || 2

  const outcome = await withRetry(
    operation,
    maxAttempts
  )


  /*
   * Step failed.
   */
  if (outcome.error) {
    await client.query(
      `
      UPDATE step_runs
      SET
        status = 'failed',
        error = $2,
        attempt_count = $3,
        ended_at = now()
      WHERE id = $1
      `,
      [
        stepRunId,
        outcome.error,
        outcome.attemptCount,
      ]
    )

    return {
      status: 'failed',
      error: outcome.error,
    }
  }


  /*
   * Step succeeded.
   */
  await client.query(
    `
    UPDATE step_runs
    SET
      status = 'succeeded',
      output = $2,
      attempt_count = $3,
      ended_at = now()
    WHERE id = $1
    `,
    [
      stepRunId,
      JSON.stringify(outcome.result),
      outcome.attemptCount,
    ]
  )


  /*
   * Persist output to workflow_data.
   */
  await client.query(
    `
    INSERT INTO workflow_data
      (
        workflow_run_id,
        step_id,
        data
      )
    VALUES
      ($1, $2, $3)
    `,
    [
      runId,
      step.id,
      JSON.stringify(outcome.result),
    ]
  )


  return {
    status: 'succeeded',
    output: outcome.result,
    attemptCount:
      outcome.attemptCount,
  }
}


/**
 * Execute an entire workflow.
 */
async function executeWorkflow({
  client,
  workflowId,
  runId,
  startAfterStepId = null,
}) {
  try {
    /*
     * Load workflow steps in execution order.
     */
    const stepsResult = await client.query(
      `
      SELECT
        id,
        step_order,
        type,
        config
      FROM workflow_steps
      WHERE workflow_id = $1
      ORDER BY step_order ASC
      `,
      [workflowId]
    )

    const steps =
      stepsResult.rows

    if (steps.length === 0) {
      throw new Error(
        'Workflow has no steps'
      )
    }


    let previousOutput = null

/*
 * When resuming after an approval gate,
 * start after that approval step rather than
 * restarting the workflow from the beginning.
 */
let startIndex = 0

if (startAfterStepId) {
  const approvedIndex = steps.findIndex(
    (step) => step.id === startAfterStepId
  )

  if (approvedIndex === -1) {
    throw new Error(
      'Approved step does not belong to this workflow'
    )
  }

  /*
   * The approval step's input contains the output
   * of the step immediately before it.
   *
   * We use that as the starting previousOutput
   * when resuming.
   */
  const approvalStepRun = await client.query(
    `
    SELECT input
    FROM step_runs
    WHERE id = (
      SELECT id
      FROM step_runs
      WHERE workflow_run_id = $1
        AND step_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    )
    `,
    [
      runId,
      startAfterStepId,
    ]
  )

  if (approvalStepRun.rows[0]?.input) {
    previousOutput =
      approvalStepRun.rows[0].input
  }

  startIndex = approvedIndex + 1
}

/*
 * Execute remaining steps sequentially.
 */
for (
  let index = startIndex;
  index < steps.length;
  index++
) {
  const step = steps[index]
      const result =
        await executeStep({
          client,
          runId,
          step,
          previousOutput,
        })


      /*
       * Approval gate pauses the workflow.
       */
      if (result.status === 'paused') {
        return {
          status: 'paused',
          stepRunId:
            result.stepRunId,
        }
      }


      /*
       * Failed step fails the workflow.
       */
      if (result.status === 'failed') {
        await client.query(
          `
          UPDATE workflow_runs
          SET
            status = 'failed',
            ended_at = now()
          WHERE id = $1
          `,
          [runId]
        )

        return {
          status: 'failed',
          error: result.error,
        }
      }


      previousOutput =
        result.output
    }


    /*
     * Everything succeeded.
     */
    await client.query(
      `
      UPDATE workflow_runs
      SET
        status = 'succeeded',
        ended_at = now()
      WHERE id = $1
      `,
      [runId]
    )


    return {
      status: 'succeeded',
      output: previousOutput,
    }

  } catch (error) {
    /*
     * Make sure a thrown error does not
     * leave the workflow stuck as "running".
     */
    await client.query(
      `
      UPDATE workflow_runs
      SET
        status = 'failed',
        ended_at = now()
      WHERE id = $1
      `,
      [runId]
    )

    throw error
  }
}


module.exports = {
  executeWorkflow,
  executeStep,
  evaluateCondition,
}