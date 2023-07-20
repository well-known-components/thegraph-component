import {
  IConfigComponent,
  IFetchComponent,
  ILoggerComponent,
  IMetricsComponent,
} from "@well-known-components/interfaces"
import { randomUUID } from "crypto"
import { setTimeout } from "timers/promises"
import { ISubgraphComponent, PostQueryResponse, SubgraphResponse, Variables } from "./types"
import { UNKNOWN_SUBGRAPH_PROVIDER, withTimeout } from "./utils"

export * from "./types"

/**
 * Query thegraph's (https://thegraph.com) subgraphs via HTTP.
 * Connections will be retried and dropped after a timeout.
 * For the connection to be properly aborted, the fetch component supplied via IFetchComponent should support AbortController signals
 * @public
 */
export async function createSubgraphComponent(
  components: createSubgraphComponent.NeededComponents,
  url: string
): Promise<ISubgraphComponent> {
  const { logs, metrics, config, fetch } = components

  const logger = logs.getLogger("thegraph-port")

  const RETRIES = (await config.getNumber("SUBGRAPH_COMPONENT_RETRIES")) ?? 3
  const TIMEOUT = (await config.getNumber("SUBGRAPH_COMPONENT_QUERY_TIMEOUT")) ?? 10000
  const TIMEOUT_INCREMENT = (await config.getNumber("SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT")) ?? 10000
  const BACKOFF = (await config.getNumber("SUBGRAPH_COMPONENT_BACKOFF")) ?? 500
  const USER_AGENT = `Subgraph component / ${(await config.getString("SUBGRAPH_COMPONENT_AGENT_NAME")) ?? "Unknown sender"
    }`

  async function executeQuery<T>(
    query: string,
    variables: Variables = {},
    remainingAttempts: number = RETRIES
  ): Promise<T> {
    const attempt = RETRIES - remainingAttempts
    const attempts = RETRIES + 1
    const currentAttempt = attempt + 1

    const timeoutWait = TIMEOUT + attempt * TIMEOUT_INCREMENT
    const queryId = randomUUID()
    const logData = { queryId, currentAttempt, attempts, timeoutWait, url }

    const { end } = metrics.startTimer('subgraph_query_duration_seconds', { url })
    try {
      const [provider, response] = await withTimeout(
        (abortController) => postQuery<T>(query, variables, abortController),
        timeoutWait
      )

      const { data, errors } = response

      const hasErrors = errors !== undefined
      if (hasErrors) {
        const errorMessages = Array.isArray(errors) ? errors.map((error) => error.message) : [errors.message]
        throw new Error(
          `GraphQL Error: Invalid response. Errors:\n- ${errorMessages.join("\n- ")}. Provider: ${provider}`
        )
      }

      const hasInvalidData = !data || Object.keys(data).length === 0
      if (hasInvalidData) {
        logger.error("Invalid response", { query, variables, response } as any)
        throw new Error(`GraphQL Error: Invalid response. Provider: ${provider}`)
      }

      metrics.increment("subgraph_ok_total", { url })

      return data
    } catch (error) {
      const errorMessage = (error as Error).message

      logger.error("Error:", { ...logData, errorMessage, query, variables: JSON.stringify(variables) })
      metrics.increment("subgraph_errors_total", { url })

      if (remainingAttempts > 0) {
        await setTimeout(BACKOFF)
        return executeQuery<T>(query, variables, remainingAttempts - 1)
      } else {
        throw error // bubble up
      }
    } finally {
      end({ url })
    }
  }

  async function postQuery<T>(
    query: string,
    variables: Variables,
    abortController: AbortController
  ): Promise<PostQueryResponse<T>> {
    const response = await fetch.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-agent": USER_AGENT },
      body: JSON.stringify({ query, variables }),
      signal: abortController.signal,
    })

    const provider = response.headers.get("X-Subgraph-Provider") ?? UNKNOWN_SUBGRAPH_PROVIDER

    if (!response.ok) {
      throw new Error(`Invalid request. Status: ${response.status}. Provider: ${provider}.`)
    }

    return [provider, (await response.json()) as SubgraphResponse<T>]
  }

  return {
    query: executeQuery,
  }
}

/**
 * @public
 */
export namespace createSubgraphComponent {
  export type NeededComponents = {
    logs: ILoggerComponent
    config: IConfigComponent
    fetch: IFetchComponent
    metrics: IMetricsComponent<keyof typeof metricDeclarations>
  }
}

/**
 * Metrics declarations, needed for your IMetricsComponent
 * @public
 */
export const metricDeclarations: IMetricsComponent.MetricsRecordDefinition<string> = {
  subgraph_ok_total: {
    help: "Subgraph request counter",
    type: IMetricsComponent.CounterType,
    labelNames: ["url"],
  },
  subgraph_errors_total: {
    help: "Subgraph error counter",
    type: IMetricsComponent.CounterType,
    labelNames: ["url"],
  },
  subgraph_query_duration_seconds: {
    type: IMetricsComponent.HistogramType,
    help: "Request duration in seconds.",
    labelNames: ["url"],
  },
}
