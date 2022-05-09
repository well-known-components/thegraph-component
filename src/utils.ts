import { setTimeout } from "timers/promises"

export async function withTimeout<T>(
  callback: (abortController: AbortController) => Promise<T>,
  timeout: number
): Promise<T> {
  const callbackAbortController = new AbortController()
  const timeoutAbortController = new AbortController()

  return await Promise.race([
    callback(callbackAbortController).then((result) => {
      timeoutAbortController.abort()
      return result
    }),
    setTimeout(timeout, "Timeout", { signal: timeoutAbortController.signal }).then(() => {
      callbackAbortController.abort()
      throw new Error("Query timed-out")
    }),
  ])
}
