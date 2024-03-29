import { setTimeout } from 'timers/promises'
import { SubgraphProvider } from './types'

export const UNKNOWN_SUBGRAPH_PROVIDER: SubgraphProvider = 'UNKNOWN'

export async function withTimeout<T>(
  callback: (abortController: AbortController) => Promise<T>,
  timeout: number
): Promise<T> {
  const callbackAbortController = new AbortController()
  const timeoutAbortController = new AbortController()

  const request = callback(callbackAbortController).finally(() => {
    timeoutAbortController.abort()
  })

  setTimeout(timeout, 'Timeout', { signal: timeoutAbortController.signal })
    .then(() => {
      callbackAbortController.abort()
    })
    .catch(() => {})

  return request
}
