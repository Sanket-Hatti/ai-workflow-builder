'use client'

import {
  gql,
  useMutation,
  useQuery,
  useSubscription,
} from '@apollo/client'
import { useAuthenticationStatus, useSignOut, useUserData } from '@nhost/react'
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
        name
        quota_calls_used
        quota_calls_allowed
      }
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

type Workflow = {
  id: string
  name: string
  org_id: string
  created_by: string
  created_at: string
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
      name: string
      quota_calls_used: number
      quota_calls_allowed: number
    }
  }[]
}

export default function Home() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading } =
    useAuthenticationStatus()

  const user = useUserData()
  const { signOut } = useSignOut()

  const [selectedWorkflow, setSelectedWorkflow] = useState('')
  const [runResult, setRunResult] = useState<TriggerResult | null>(null)

  const {
    data,
    loading: workflowsLoading,
    error: workflowsError,
  } = useQuery<{ workflows: Workflow[] }>(GET_WORKFLOWS, {
    skip: !isAuthenticated,
    fetchPolicy: 'network-only',
  })

  const { data: orgData } = useQuery<OrgInfo>(GET_MY_ORG_INFO, {
    skip: !isAuthenticated,
    fetchPolicy: 'network-only',
  })

  const myMembership = orgData?.org_members?.[0]
  const myRole = myMembership?.role
  const org = myMembership?.organization

  const [triggerWorkflow, { loading: triggerLoading }] =
    useMutation<TriggerResult>(TRIGGER_WORKFLOW)
  
  const { data: stepRunsData } = useSubscription(
    STEP_RUNS_SUBSCRIPTION,
    {
      variables: {
        workflow_run_id:
        runResult?.triggerWorkflowRun.workflow_run_id ?? '',
      },
      skip: !runResult?.triggerWorkflowRun.workflow_run_id,
    }
  )

const [approveStep, { loading: approveLoading }] =
  useMutation(APPROVE_STEP)

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [authLoading, isAuthenticated, router])

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <p className="text-slate-400">Checking authentication...</p>
      </main>
    )
  }

  

if (!isAuthenticated) {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <p className="text-slate-400">Redirecting to login...</p>
    </main>
  )
}

  const workflows = data?.workflows ?? []

  async function handleRun() {
    if (!selectedWorkflow) return

    setRunResult(null)

    try {
      const result = await triggerWorkflow({
        variables: {
          workflow_id: selectedWorkflow,
        },
      })

      if (result.data) {
        setRunResult(result.data)
      }
    } catch (error) {
      console.error(error)
    }
  }
  async function handleApprove(stepRunId: string) {
  try {
    const result = await approveStep({
      variables: {
        step_run_id: stepRunId,
      },
    })

    if (result.data?.approveStep) {
      setRunResult({
        triggerWorkflowRun: {
          workflow_run_id:
            runResult!.triggerWorkflowRun.workflow_run_id,
          status: result.data.approveStep.status,
        },
      })

    }
  } catch (error) {
    console.error(error)
  }
}

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
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

          <div className="flex items-center gap-4">
            {org && (
              <div className="text-right">
                <p className="text-sm font-medium">
                  {org.name}
                </p>
                <p className="text-xs text-slate-500">
                  Quota: {org.quota_calls_used} / {org.quota_calls_allowed}
                  {myRole ? ` · ${myRole}` : ''}
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

      {/* Main */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[280px_1fr]">

        {/* Sidebar */}
        <aside className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-semibold">Workflows</h2>

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
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() =>
                  setSelectedWorkflow(workflow.id)
                }
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedWorkflow === workflow.id
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
            ))}
          </div>
        </aside>

        {/* Workspace */}
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">

          {!selectedWorkflow ? (
            <div className="flex min-h-[500px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-3xl">
                  ⚡
                </div>

                <h2 className="text-xl font-semibold">
                  Select a workflow
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Choose a workflow from the sidebar to run it.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm text-slate-500">
                    Selected workflow
                  </p>

                  <h2 className="mt-1 text-2xl font-bold">
                    {
                      workflows.find(
                        (workflow) =>
                          workflow.id === selectedWorkflow
                      )?.name
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

              {/* Workflow visual */}
              <div className="mt-8 space-y-3">

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

              {/* Result */}
              {runResult && (
                <div className="mt-8 rounded-xl border border-slate-700 bg-slate-950 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">
                      Latest Run
                    </h3>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        runResult.triggerWorkflowRun.status ===
                        'succeeded'
                          ? 'bg-green-500/10 text-green-400'
                          : runResult.triggerWorkflowRun.status ===
                              'paused'
                            ? 'bg-yellow-500/10 text-yellow-400'
                            : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {runResult.triggerWorkflowRun.status}
                    </span>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Workflow Run ID
                    </p>

                    <p className="mt-1 break-all font-mono text-sm text-slate-300">
                      {
                        runResult.triggerWorkflowRun
                          .workflow_run_id
                      }
                    </p>
                  </div>
                  {stepRunsData?.step_runs?.map((stepRun: any, index: number) => (
                    <div
                      key={stepRun.id}
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
                        </div>

                        {stepRun.status === 'awaiting_approval' && myRole !== 'viewer' && (
                          <button
                            onClick={() => handleApprove(stepRun.id)}
                            disabled={approveLoading}
                            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-500 disabled:opacity-50"
                          >
                            {approveLoading
                              ? 'Approving...'
                              : '✓ Approve Step'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}