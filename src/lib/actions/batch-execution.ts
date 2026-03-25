export interface BatchAction<TParameters extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  type: string
  title: string
  description: string
  parameters: TParameters
}

export interface BatchExecutionSuccess<TOutput extends Record<string, unknown> = Record<string, unknown>> {
  details: string
  output: TOutput
}

export interface BatchExecutionFailure<TParameters extends Record<string, unknown> = Record<string, unknown>> {
  action: BatchAction<TParameters>
  effectiveParameters: TParameters
  error: string
}

export interface BatchBlockedAction<TParameters extends Record<string, unknown> = Record<string, unknown>> {
  action: BatchAction<TParameters>
  effectiveParameters: TParameters
}

export interface CompletedBatchAction<
  TParameters extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  action: BatchAction<TParameters>
  effectiveParameters: TParameters
  execution: BatchExecutionSuccess<TOutput>
}

export interface BatchExecutionResult<
  TParameters extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  completed: Array<CompletedBatchAction<TParameters, TOutput>>
  failed: BatchExecutionFailure<TParameters> | null
  blocked: Array<BatchBlockedAction<TParameters>>
}

export async function executeBatch<
  TParameters extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(params: {
  actions: Array<BatchAction<TParameters>>
  resolveParameters: (
    parameters: TParameters,
    priorOutputs: TOutput[],
    action: BatchAction<TParameters>
  ) => TParameters
  execute: (
    action: BatchAction<TParameters>,
    effectiveParameters: TParameters
  ) => Promise<BatchExecutionSuccess<TOutput>>
  onBeforeExecute?: (action: BatchAction<TParameters>, effectiveParameters: TParameters) => Promise<void> | void
  onSuccess?: (
    action: BatchAction<TParameters>,
    effectiveParameters: TParameters,
    execution: BatchExecutionSuccess<TOutput>
  ) => Promise<void> | void
  onFailure?: (
    action: BatchAction<TParameters>,
    effectiveParameters: TParameters,
    error: string
  ) => Promise<void> | void
  onBlocked?: (action: BatchAction<TParameters>, effectiveParameters: TParameters, error: string) => Promise<void> | void
}) {
  const priorOutputs: TOutput[] = []
  const completed: Array<CompletedBatchAction<TParameters, TOutput>> = []

  for (let index = 0; index < params.actions.length; index += 1) {
    const action = params.actions[index]
    let effectiveParameters: TParameters = action.parameters

    try {
      effectiveParameters = params.resolveParameters(action.parameters, priorOutputs, action)
      await params.onBeforeExecute?.(action, effectiveParameters)
      const execution = await params.execute(action, effectiveParameters)
      priorOutputs.push(execution.output)
      completed.push({
        action,
        effectiveParameters,
        execution,
      })
      await params.onSuccess?.(action, effectiveParameters, execution)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown execution error.'
      await params.onFailure?.(action, effectiveParameters, message)

      const blocked = params.actions.slice(index + 1).map((blockedAction) => ({
        action: blockedAction,
        effectiveParameters: params.resolveParameters(blockedAction.parameters, priorOutputs, blockedAction),
      }))

      for (const blockedAction of blocked) {
        await params.onBlocked?.(blockedAction.action, blockedAction.effectiveParameters, message)
      }

      return {
        completed,
        failed: {
          action,
          effectiveParameters,
          error: message,
        },
        blocked,
      } satisfies BatchExecutionResult<TParameters, TOutput>
    }
  }

  return {
    completed,
    failed: null,
    blocked: [],
  } satisfies BatchExecutionResult<TParameters, TOutput>
}
