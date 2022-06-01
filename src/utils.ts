import { setTimeout } from "timers/promises"

export async function withTimeout<T>(
  callback: (abortController: AbortController) => Promise<T>,
  timeout: number
): Promise<T> {
  const callbackAbortController = new AbortController()
  const timeoutAbortController = new AbortController()

  const request = callback(callbackAbortController)
    .then((result) => result)
    .finally(() => {
      timeoutAbortController.abort()
    })

  setTimeout(timeout, "Timeout", { signal: timeoutAbortController.signal })
    .then(() => {
      callbackAbortController.abort()
    })
    .catch(() => {})

  return request
}
