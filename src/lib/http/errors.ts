export function getErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error'

  if (message === 'Unauthorized') {
    return {
      status: 401,
      message,
    }
  }

  if (
    message === 'Workspace not found.' ||
    message === 'Action not found.' ||
    message === 'Integration not found.' ||
    message === 'Tool not found.' ||
    message.startsWith('Unknown tool "')
  ) {
    return {
      status: 404,
      message,
    }
  }

  if (message.startsWith('Role "') && message.includes('is not allowed to execute')) {
    return {
      status: 403,
      message,
    }
  }

  if (
    message === 'Action is no longer pending.' ||
    message === 'Action group is no longer pending.' ||
    message === 'Action execution requires manual review.'
  ) {
    return {
      status: 409,
      message,
    }
  }

  return {
    status: 500,
    message,
  }
}
