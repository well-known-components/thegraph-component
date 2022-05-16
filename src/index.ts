import { IFetchComponent } from "@well-known-components/http-server"
import { IConfigComponent, ILoggerComponent, IMetricsComponent } from "@well-known-components/interfaces"
import { setTimeout } from "timers/promises"
import { ISubgraphComponent, SubgraphResponse, Variables } from "./types"
import { withTimeout } from "./utils"

export * from "./types"
export { withTimeout } from "./utils"

/**
 * Query thegraph's (https://thegraph.com) subgraphs via HTTP.
 * Connections will be retried and dropped after a timeout.
 * For the connection to be properly aborted, the fetch component supplied via IFetchComponent should support AbortController signals
 * @public
 */
export async function createSubgraphComponent(
  url: string,
  components: createSubgraphComponent.NeededComponents
): Promise<ISubgraphComponent> {
  const { logs, metrics, config, fetch } = components

  const logger = logs.getLogger("thegraph-port")

  const RETRIES = (await config.getNumber("SUBGRAPH_COMPONENT_RETRIES")) || 3
  const TIMEOUT = (await config.getNumber("SUBGRAPH_COMPONENT_QUERY_TIMEOUT")) || 5000
  const BACKOFF = (await config.getNumber("SUBGRAPH_COMPONENT_BACKOFF")) || 500

  async function executeQuery<T>(
    query: string,
    variables: Variables = {},
    remainingAttempts: number = RETRIES
  ): Promise<T> {
    logger.info(remainingAttempts === RETRIES ? `Querying subgraph ${url}` : `Retrying query to subgraph ${url}`)

    try {
      const { data, errors } = await withTimeout(
        (abortController) => postQuery<T>(query, variables, abortController),
        TIMEOUT
      )

      const hasInvalidData = !data || Object.keys(data).length === 0
      const hasMultipleErrors = errors && errors.length > 1

      if (hasInvalidData || hasMultipleErrors) {
        throw new Error(
          hasMultipleErrors
            ? `There was a total of ${errors.length}. GraphQL errors:\n- ${errors.join("\n- ")}`
            : "GraphQL Error: Invalid response"
        )
      }

      return data
    } catch (error) {
      const errorMessage = (error as Error).message

      logger.error(`Error querying subgraph ${url}: ${errorMessage}`)
      metrics.increment("subgraph_errors_total", { url, errorMessage })

      if (remainingAttempts > 0) {
        await setTimeout(BACKOFF)
        return executeQuery<T>(query, variables, remainingAttempts - 1)
      } else {
        throw error // bubble up
      }
    }
  }

  async function postQuery<T>(
    query: string,
    variables: Variables,
    abortController: AbortController
  ): Promise<SubgraphResponse<T>> {
    const response = await fetch.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`Invalid request. Status: ${response.status}`)
    }

    return (await response.json()) as SubgraphResponse<T>
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
  subgraph_errors_total: {
    help: "Subgrpah error counter",
    type: IMetricsComponent.CounterType,
    labelNames: ["url", "errorMessage"],
  },
}
