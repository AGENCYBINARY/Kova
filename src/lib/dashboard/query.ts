export interface DashboardScope {
  workspaceId: string
  userId: string
}

export function buildDashboardScopeWhere(scope: DashboardScope) {
  return {
    workspaceId: scope.workspaceId,
    userId: scope.userId,
  }
}
