'use client'

import {
  gql,
  useMutation,
  useQuery,
  useSubscription,
} from '@apollo/client'
import {
  useAuthenticationStatus,
  useSignOut,
  useUserData,
} from '@nhost/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const GET_WORKFLOWS = gql`
  query GetWorkflows {
    workflows(order_by: { created_at: desc }) {
      id
      name
      org_id
      created_by
      created_at
    }
  }
`

const GET_MY_ORG_INFO = gql`
  query GetMyOrgInfo {
    org_members {
      role
      organization {
        id
        name
        quota_calls_used
        quota_calls_allowed
      }
    }
  }
`

const GET_WORKFLOW_DETAILS = gql`
  query GetWorkflowDetails($workflow_id: uuid!) {
    workflow_steps(
      where: { workflow_id: { _eq: $workflow_id } }
      order_by: { created_at: asc }
    ) {
      id
      workflow_id
      type
      config
      created_at
    }

    workflow_triggers(
      where: { workflow_id: { _eq: $workflow_id } }
    ) {
      id
      workflow_id
      type
      config
    }
  }
`

const TRIGGER_WORKFLOW = gql`
  mutation TriggerWorkflowRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      workflow_run_id
      status
    }
  }
`

const STEP_RUNS_SUBSCRIPTION = gql`
  subscription StepRuns($workflow_run_id: uuid!) {
    step_runs(
      where: {
        workflow_run_id: {
          _eq: $workflow_run_id
        }
      }
      order_by: {
        created_at: asc
      }
    ) {
      id
      step_id
      status
      attempt_count
      input
      output
      error
      created_at
      ended_at
    }
  }
`

const APPROVE_STEP = gql`
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      step_run_id
      status
    }
  }
`

const INSERT_STEP = gql`
  mutation InsertStep(
    $workflow_id: uuid!
    $type: step_type!
    $config: jsonb!
    $step_order: Int!
  ) {
    insert_workflow_steps_one(
      object: {
        workflow_id: $workflow_id
        type: $type
        config: $config
        step_order: $step_order
      }
    ) {
      id
      workflow_id
      type
      config
      step_order
    }
  }
`

const UPDATE_STEP = gql`
  mutation UpdateStep(
    $id: uuid!
    $type: String!
    $config: jsonb!
  ) {
    update_workflow_steps_by_pk(
      pk_columns: { id: $id }
      _set: {
        type: $type
        config: $config
      }
    ) {
      id
      workflow_id
      type
      config
    }
  }
`

const DELETE_STEP = gql`
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`

const INSERT_TRIGGER = gql`
  mutation InsertTrigger(
    $workflow_id: uuid!
    $type: String!
    $config: jsonb!
  ) {
    insert_workflow_triggers_one(
      object: {
        workflow_id: $workflow_id
        type: $type
        config: $config
      }
    ) {
      id
      workflow_id
      type
      config
    }
  }
`

const DELETE_TRIGGER = gql`
  mutation DeleteTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`

type Workflow = {
  id: string
  name: string
  org_id: string
  created_by: string
  created_at: string
}

type WorkflowStep = {
  id: string
  workflow_id: string
  type: string
  config: Record<string, any>
  created_at: string
}

type WorkflowTrigger = {
  id: string
  workflow_id: string
  type: string
  config: Record<string, any>
}

type TriggerResult = {
  triggerWorkflowRun: {
    workflow_run_id: string
    status: string
  }
}

type OrgInfo = {
  org_members: {
    role: string
    organization: {
      id: string
      name: string
      quota_calls_used: number
      quota_calls_allowed: number
    }
  }[]
}

export default function Home() {
  const router = useRouter()

  const {
    isAuthenticated,
    isLoading: authLoading,
  } = useAuthenticationStatus()

  const user = useUserData()
  const { signOut } = useSignOut()

  const [selectedWorkflow, setSelectedWorkflow] =
    useState('')

  const [runResult, setRunResult] =
    useState<TriggerResult | null>(null)

  const [newStepType, setNewStepType] =
    useState('llm_call')

  const [newStepConfig, setNewStepConfig] =
    useState('{}')

  const [editingStep, setEditingStep] =
    useState<string | null>(null)

  const [editingType, setEditingType] =
    useState('llm_call')

  const [editingConfig, setEditingConfig] =
    useState('{}')

  const [message, setMessage] =
    useState('')

  const {
    data,
    loading: workflowsLoading,
    error: workflowsError,
    refetch: refetchWorkflows,
  } = useQuery<{ workflows: Workflow[] }>(
    GET_WORKFLOWS,
    {
      skip: !isAuthenticated,
      fetchPolicy: 'network-only',
    }
  )

  const { data: orgData } =
    useQuery<OrgInfo>(
      GET_MY_ORG_INFO,
      {
        skip: !isAuthenticated,
        fetchPolicy: 'network-only',
      }
    )

  const {
    data: workflowDetails,
    refetch: refetchDetails,
  } =
    useQuery(
      GET_WORKFLOW_DETAILS,
      {
        variables: {
          workflow_id: selectedWorkflow,
        },
        skip: !selectedWorkflow,
        fetchPolicy: 'network-only',
      }
    )

  const myMembership =
    orgData?.org_members?.[0]

  const myRole =
    myMembership?.role

  const org =
    myMembership?.organization

  const [
    triggerWorkflow,
    { loading: triggerLoading },
  ] =
    useMutation<TriggerResult>(
      TRIGGER_WORKFLOW
    )

  const [
    insertStep,
    { loading: insertLoading },
  ] =
    useMutation(INSERT_STEP)

  const [
    updateStep,
    { loading: updateLoading },
  ] =
    useMutation(UPDATE_STEP)

  const [
    deleteStep,
    { loading: deleteLoading },
  ] =
    useMutation(DELETE_STEP)

  const [
    insertTrigger,
    { loading: triggerInsertLoading },
  ] =
    useMutation(INSERT_TRIGGER)

  const [
    deleteTrigger,
    { loading: triggerDeleteLoading },
  ] =
    useMutation(DELETE_TRIGGER)

  const { data: stepRunsData } =
    useSubscription(
      STEP_RUNS_SUBSCRIPTION,
      {
        variables: {
          workflow_run_id:
            runResult?.triggerWorkflowRun
              .workflow_run_id ?? '',
        },
        skip:
          !runResult?.triggerWorkflowRun
            .workflow_run_id,
      }
    )

  const [
    approveStep,
    { loading: approveLoading },
  ] =
    useMutation(APPROVE_STEP)

  useEffect(() => {
    if (
      !authLoading &&
      !isAuthenticated
    ) {
      router.push('/login')
    }
  }, [
    authLoading,
    isAuthenticated,
    router,
  ])

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <p className="text-slate-400">
          Checking authentication...
        </p>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <p className="text-slate-400">
          Redirecting to login...
        </p>
      </main>
    )
  }

  const workflows =
    data?.workflows ?? []

  const steps: WorkflowStep[] =
    workflowDetails?.workflow_steps ?? []

  const triggers: WorkflowTrigger[] =
    workflowDetails?.workflow_triggers ?? []

  const selectedWorkflowObject =
    workflows.find(
      (workflow) =>
        workflow.id === selectedWorkflow
    )

  const usagePercentage =
    org &&
    org.quota_calls_allowed > 0
      ? Math.min(
          100,
          Math.round(
            (org.quota_calls_used /
              org.quota_calls_allowed) *
              100
          )
        )
      : 0

  async function handleRun() {
    if (!selectedWorkflow) return

    setMessage('')
    setRunResult(null)

    try {
      const result =
        await triggerWorkflow({
          variables: {
            workflow_id:
              selectedWorkflow,
          },
        })

      if (result.data) {
        setRunResult(result.data)
      }

      await refetchWorkflows()
    } catch (error: any) {
      console.error(error)
      setMessage(
        error?.message ||
          'Failed to run workflow'
      )
    }
  }

  async function handleApprove(
    stepRunId: string
  ) {
    try {
      const result =
        await approveStep({
          variables: {
            step_run_id:
              stepRunId,
          },
        })

      if (
        result.data?.approveStep
      ) {
        setRunResult({
          triggerWorkflowRun: {
            workflow_run_id:
              runResult!
                .triggerWorkflowRun
                .workflow_run_id,
            status:
              result.data
                .approveStep
                .status,
          },
        })
      }
    } catch (error: any) {
      console.error(error)
      setMessage(
        error?.message ||
          'Approval failed'
      )
    }
  }

  async function handleAddStep() {
    if (!selectedWorkflow) return

    try {
      let parsedConfig = {}

      try {
        parsedConfig =
          JSON.parse(newStepConfig)
      } catch {
        setMessage(
          'Invalid JSON configuration'
        )
        return
      }

      await insertStep({
        variables: {
          workflow_id: selectedWorkflow,
          type: newStepType,
          config: parsedConfig,
          step_order:
          (workflowDetails?.workflow_steps?.length ?? 0) + 1,
        },
      })

      setNewStepConfig('{}')
      setMessage(
        'Step added successfully'
      )

      await refetchDetails()
    } catch (error: any) {
      console.error(error)
      setMessage(
        error?.message ||
          'Failed to add step'
      )
    }
  }

  function startEditStep(
    step: WorkflowStep
  ) {
    setEditingStep(step.id)
    setEditingType(step.type)
    setEditingConfig(
      JSON.stringify(
        step.config ?? {},
        null,
        2
      )
    )
    setMessage('')
  }

  async function saveStep() {
    if (!editingStep) return

    try {
      let parsedConfig = {}

      try {
        parsedConfig =
          JSON.parse(editingConfig)
      } catch {
        setMessage(
          'Invalid JSON configuration'
        )
        return
      }

      await updateStep({
        variables: {
          id: editingStep,
          type: editingType,
          config: parsedConfig,
        },
      })

      setEditingStep(null)
      setMessage(
        'Step updated successfully'
      )

      await refetchDetails()
    } catch (error: any) {
      console.error(error)
      setMessage(
        error?.message ||
          'Failed to update step'
      )
    }
  }

  async function handleDeleteStep(
    id: string
  ) {
    if (
      !confirm(
        'Delete this workflow step?'
      )
    ) {
      return
    }

    try {
      await deleteStep({
        variables: { id },
      })

      setMessage(
        'Step deleted successfully'
      )

      await refetchDetails()
    } catch (error: any) {
      console.error(error)
      setMessage(
        error?.message ||
          'Failed to delete step'
      )
    }
  }

  async function handleAddWebhook() {
    if (!selectedWorkflow) return

    if (myRole !== 'owner') {
      setMessage(
        'Only an owner can add a webhook trigger.'
      )
      return
    }

    try {
      await insertTrigger({
        variables: {
          workflow_id:
            selectedWorkflow,
          type: 'webhook',
          config: {},
        },
      })

      setMessage(
        'Webhook trigger attached'
      )

      await refetchDetails()
    } catch (error: any) {
      console.error(error)
      setMessage(
        error?.message ||
          'Failed to add webhook'
      )
    }
  }

  async function handleDeleteTrigger(
    id: string
  ) {
    if (
      myRole !== 'owner'
    ) {
      setMessage(
        'Only an owner can remove triggers.'
      )
      return
    }

    try {
      await deleteTrigger({
        variables: { id },
      })

      setMessage(
        'Trigger removed'
      )

      await refetchDetails()
    } catch (error: any) {
      console.error(error)
      setMessage(
        error?.message ||
          'Failed to remove trigger'
      )
    }
  }

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">

      {/* HEADER */}

      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">

          <div>
            <h1 className="text-xl font-bold">
              AI Workflow Builder
            </h1>

            <p className="text-sm text-slate-400">
              Workflow automation platform
            </p>
          </div>

          <div className="flex items-center gap-5">

            {org && (
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium">
                  {org.name}
                </p>

                <p className="text-xs text-slate-500">
                  {myRole?.toUpperCase()}
                </p>
              </div>
            )}

            <div className="text-right">
              <p className="text-sm font-medium">
                {user?.email}
              </p>

              <p className="text-xs text-slate-500">
                Authenticated user
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
            >
              Logout
            </button>

          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">

        {/* TOP STATS */}

        <div className="mb-6 grid gap-4 md:grid-cols-3">

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Organization
            </p>

            <p className="mt-2 text-lg font-semibold">
              {org?.name ?? 'Loading...'}
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Role: {myRole ?? 'unknown'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Usage
              </p>

              <p className="text-sm text-slate-300">
                {org?.quota_calls_used ?? 0} /{' '}
                {org?.quota_calls_allowed ?? 0}
              </p>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{
                  width: `${usagePercentage}%`,
                }}
              />
            </div>

            <p className="mt-2 text-xs text-slate-500">
              {usagePercentage}% quota used
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Workflows
            </p>

            <p className="mt-2 text-2xl font-bold">
              {workflows.length}
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Available in your organization
            </p>
          </div>

        </div>

        {message && (
          <div className="mb-6 rounded-lg border border-blue-900 bg-blue-950/40 p-4 text-sm text-blue-300">
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">

          {/* SIDEBAR */}

          <aside className="rounded-xl border border-slate-800 bg-slate-900 p-5">

            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-semibold">
                Workflows
              </h2>

              <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-400">
                {workflows.length}
              </span>
            </div>

            {workflowsLoading && (
              <p className="text-sm text-slate-500">
                Loading workflows...
              </p>
            )}

            {workflowsError && (
              <div className="rounded-lg border border-red-900 bg-red-950/40 p-3">
                <p className="text-sm text-red-400">
                  Failed to load workflows.
                </p>

                <p className="mt-1 text-xs text-red-500">
                  {workflowsError.message}
                </p>
              </div>
            )}

            <div className="space-y-2">
              {workflows.map(
                (workflow) => (
                  <button
                    key={workflow.id}
                    onClick={() => {
                      setSelectedWorkflow(
                        workflow.id
                      )
                      setRunResult(null)
                      setMessage('')
                    }}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      selectedWorkflow ===
                      workflow.id
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-slate-800 bg-slate-950 hover:bg-slate-800'
                    }`}
                  >
                    <p className="font-medium">
                      {workflow.name}
                    </p>

                    <p className="mt-1 truncate text-xs text-slate-500">
                      {workflow.id}
                    </p>
                  </button>
                )
              )}
            </div>

          </aside>

          {/* WORKSPACE */}

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">

            {!selectedWorkflow ? (
              <div className="flex min-h-[600px] items-center justify-center">
                <div className="text-center">

                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-3xl">
                    ⚡
                  </div>

                  <h2 className="text-xl font-semibold">
                    Select a workflow
                  </h2>

                  <p className="mt-2 text-sm text-slate-500">
                    Choose a workflow from the sidebar.
                  </p>

                </div>
              </div>
            ) : (
              <>

                {/* WORKFLOW HEADER */}

                <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">

                  <div>
                    <p className="text-sm text-slate-500">
                      Selected workflow
                    </p>

                    <h2 className="mt-1 text-2xl font-bold">
                      {
                        selectedWorkflowObject?.name
                      }
                    </h2>

                    <p className="mt-1 text-xs text-slate-600">
                      {selectedWorkflow}
                    </p>
                  </div>

                  {myRole !== 'viewer' && (
                    <button
                      onClick={handleRun}
                      disabled={triggerLoading}
                      className="rounded-lg bg-blue-600 px-6 py-3 font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {triggerLoading
                        ? 'Running...'
                        : '▶ Run Workflow'}
                    </button>
                  )}

                </div>

                {/* BUILDER */}

                <div className="mt-8">

                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">
                        Workflow Builder
                      </h3>

                      <p className="text-sm text-slate-500">
                        Configure the steps executed by this workflow.
                      </p>
                    </div>
                  </div>

                  {/* EXISTING STEPS */}

                  <div className="space-y-3">

                    {steps.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
                        No steps configured.
                        Add your first step below.
                      </div>
                    )}

                    {steps.map(
                      (
                        step,
                        index
                      ) => (
                        <div
                          key={step.id}
                          className="rounded-xl border border-slate-800 bg-slate-950 p-5"
                        >

                          {editingStep ===
                          step.id ? (
                            <div>

                              <div className="mb-4 flex items-center justify-between">
                                <p className="font-semibold">
                                  Edit Step {index + 1}
                                </p>
                              </div>

                              <select
                                value={
                                  editingType
                                }
                                onChange={(e) =>
                                  setEditingType(
                                    e.target.value
                                  )
                                }
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm"
                              >
                                <option value="llm_call">
                                  LLM Call
                                </option>

                                <option value="http_request">
                                  HTTP Request
                                </option>

                                <option value="conditional_branch">
                                  Conditional Branch
                                </option>

                                <option value="approval_gate">
                                  Approval Gate
                                </option>

                                <option value="db_write">
                                  DB Write
                                </option>

                                <option value="notify">
                                  Notify
                                </option>
                              </select>

                              <textarea
                                value={
                                  editingConfig
                                }
                                onChange={(e) =>
                                  setEditingConfig(
                                    e.target.value
                                  )
                                }
                                rows={7}
                                className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-xs"
                              />

                              <div className="mt-3 flex gap-2">

                                <button
                                  onClick={
                                    saveStep
                                  }
                                  disabled={
                                    updateLoading
                                  }
                                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
                                >
                                  {updateLoading
                                    ? 'Saving...'
                                    : 'Save'}
                                </button>

                                <button
                                  onClick={() =>
                                    setEditingStep(
                                      null
                                    )
                                  }
                                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
                                >
                                  Cancel
                                </button>

                              </div>

                            </div>
                          ) : (
                            <div>

                              <div className="flex items-center justify-between gap-4">

                                <div className="flex items-center gap-3">

                                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-sm">
                                    {index + 1}
                                  </div>

                                  <div>
                                    <p className="font-medium">
                                      {step.type}
                                    </p>

                                    <p className="text-xs text-slate-500">
                                      Step {index + 1}
                                    </p>
                                  </div>

                                </div>

                                {myRole !== 'viewer' && (
                                  <div className="flex gap-2">

                                    <button
                                      onClick={() =>
                                        startEditStep(
                                          step
                                        )
                                      }
                                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800"
                                    >
                                      Edit
                                    </button>

                                    <button
                                      onClick={() =>
                                        handleDeleteStep(
                                          step.id
                                        )
                                      }
                                      disabled={
                                        deleteLoading
                                      }
                                      className="rounded-lg border border-red-900 px-3 py-2 text-xs text-red-400 hover:bg-red-950/40"
                                    >
                                      Delete
                                    </button>

                                  </div>
                                )}

                              </div>

                              <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-400">
                                {JSON.stringify(
                                  step.config ?? {},
                                  null,
                                  2
                                )}
                              </pre>

                            </div>
                          )}

                        </div>
                      )
                    )}

                  </div>

                  {/* ADD STEP */}

                  {myRole !== 'viewer' && (
                    <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950 p-5">

                      <h4 className="font-semibold">
                        + Add Step
                      </h4>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">

                        <select
                          value={
                            newStepType
                          }
                          onChange={(e) =>
                            setNewStepType(
                              e.target.value
                            )
                          }
                          className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm"
                        >
                          <option value="llm_call">
                            LLM Call
                          </option>

                          <option value="http_request">
                            HTTP Request
                          </option>

                          <option value="conditional_branch">
                            Conditional Branch
                          </option>

                          <option value="approval_gate">
                            Approval Gate
                          </option>

                          <option value="db_write">
                            DB Write
                          </option>

                          <option value="notify">
                            Notify
                          </option>
                        </select>

                        <button
                          onClick={
                            handleAddStep
                          }
                          disabled={
                            insertLoading
                          }
                          className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                        >
                          {insertLoading
                            ? 'Adding...'
                            : 'Add Step'}
                        </button>

                      </div>

                      <textarea
                        value={
                          newStepConfig
                        }
                        onChange={(e) =>
                          setNewStepConfig(
                            e.target.value
                          )
                        }
                        rows={6}
                        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-xs"
                        placeholder='{"prompt":"Analyze the input"}'
                      />

                      <p className="mt-2 text-xs text-slate-500">
                        Configuration is stored as JSONB.
                      </p>

                    </div>
                  )}

                </div>

                {/* TRIGGERS */}

                <div className="mt-8 rounded-xl border border-slate-800 bg-slate-950 p-5">

                  <div className="flex items-center justify-between">

                    <div>
                      <h3 className="font-semibold">
                        Triggers
                      </h3>

                      <p className="text-sm text-slate-500">
                        Start this workflow manually or externally.
                      </p>
                    </div>

                    {myRole === 'owner' && (
                      <button
                        onClick={
                          handleAddWebhook
                        }
                        disabled={
                          triggerInsertLoading
                        }
                        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium hover:bg-purple-500"
                      >
                        + Webhook
                      </button>
                    )}

                  </div>

                  <div className="mt-4 space-y-2">

                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">

                      <div className="flex items-center justify-between">

                        <div>
                          <p className="font-medium">
                            Manual
                          </p>

                          <p className="text-xs text-slate-500">
                            Run button
                          </p>
                        </div>

                        <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
                          Enabled
                        </span>

                      </div>

                    </div>

                    {triggers.map(
                      (trigger) => (
                        <div
                          key={
                            trigger.id
                          }
                          className="rounded-lg border border-slate-800 bg-slate-900 p-4"
                        >

                          <div className="flex items-center justify-between">

                            <div>
                              <p className="font-medium">
                                {trigger.type}
                              </p>

                              <p className="text-xs text-slate-500">
                                External trigger
                              </p>
                            </div>

                            {myRole ===
                              'owner' && (
                              <button
                                onClick={() =>
                                  handleDeleteTrigger(
                                    trigger.id
                                  )
                                }
                                disabled={
                                  triggerDeleteLoading
                                }
                                className="rounded-lg border border-red-900 px-3 py-2 text-xs text-red-400 hover:bg-red-950/40"
                              >
                                Remove
                              </button>
                            )}

                          </div>

                          {trigger.type ===
                            'webhook' && (
                            <div className="mt-3 rounded-lg bg-slate-950 p-3">

                              <p className="text-xs text-slate-500">
                                Webhook endpoint
                              </p>

                              <p className="mt-1 break-all font-mono text-xs text-slate-300">
                                /webhookTrigger
                              </p>

                              <p className="mt-2 text-xs text-slate-500">
                                Protected by the configured webhook secret.
                              </p>

                            </div>
                          )}

                        </div>
                      )
                    )}

                  </div>

                </div>

                {/* EXECUTION GRAPH */}

                <div className="mt-8">

                  <h3 className="mb-3 font-semibold">
                    Execution
                  </h3>

                  <div className="space-y-3">

                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
                      <div className="flex items-center gap-4">

                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                          🧠
                        </div>

                        <div>
                          <p className="font-medium">
                            Workflow
                          </p>

                          <p className="text-sm text-slate-500">
                            Execute configured workflow steps
                          </p>
                        </div>

                      </div>
                    </div>

                    <div className="mx-auto h-5 w-px bg-slate-700" />

                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
                      <div className="flex items-center gap-4">

                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                          ▶
                        </div>

                        <div>
                          <p className="font-medium">
                            Execute
                          </p>

                          <p className="text-sm text-slate-500">
                            Run workflow through the backend executor
                          </p>
                        </div>

                      </div>
                    </div>

                  </div>

                </div>

                {/* RUN RESULT */}

                {runResult && (
                  <div className="mt-8 rounded-xl border border-slate-700 bg-slate-950 p-5">

                    <div className="flex items-center justify-between">

                      <h3 className="font-semibold">
                        Latest Run
                      </h3>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          runResult
                            .triggerWorkflowRun
                            .status ===
                          'succeeded'
                            ? 'bg-green-500/10 text-green-400'
                            : runResult
                                .triggerWorkflowRun
                                .status ===
                              'paused'
                              ? 'bg-yellow-500/10 text-yellow-400'
                              : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {
                          runResult
                            .triggerWorkflowRun
                            .status
                        }
                      </span>

                    </div>

                    <div className="mt-4">

                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Workflow Run ID
                      </p>

                      <p className="mt-1 break-all font-mono text-sm text-slate-300">
                        {
                          runResult
                            .triggerWorkflowRun
                            .workflow_run_id
                        }
                      </p>

                    </div>

                    {stepRunsData?.step_runs?.map(
                      (
                        stepRun: any,
                        index: number
                      ) => (
                        <div
                          key={
                            stepRun.id
                          }
                          className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4"
                        >

                          <div className="flex items-center justify-between gap-4">

                            <div>
                              <p className="text-sm font-medium">
                                Step {index + 1}
                              </p>

                              <p className="mt-1 text-xs text-slate-500">
                                {stepRun.status}
                              </p>

                              {stepRun.attempt_count >
                                0 && (
                                <p className="mt-1 text-xs text-slate-600">
                                  Attempts:{' '}
                                  {
                                    stepRun.attempt_count
                                  }
                                </p>
                              )}
                            </div>

                            {stepRun.status ===
                              'awaiting_approval' &&
                              myRole !==
                                'viewer' && (
                                <button
                                  onClick={() =>
                                    handleApprove(
                                      stepRun.id
                                    )
                                  }
                                  disabled={
                                    approveLoading
                                  }
                                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-500 disabled:opacity-50"
                                >
                                  {approveLoading
                                    ? 'Approving...'
                                    : '✓ Approve Step'}
                                </button>
                              )}

                          </div>

                        </div>
                      )
                    )}

                  </div>
                )}

              </>
            )}

          </section>

        </div>

      </div>

    </main>
  )
}