import { IFetchComponent } from "@well-known-components/http-server"
import { IConfigComponent, ILoggerComponent, IMetricsComponent } from "@well-known-components/interfaces"
import { ISubgraphComponent, SubgraphResponse, Variables } from "./types"
import { sleep } from "./utils"

/**
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

  async function executeQuery<T>(query: string, variables: Variables = {}, remainingAttempts?: number): Promise<T> {
    logger.log(remainingAttempts !== RETRIES ? `Querying subgraph ${url}` : `Retrying query to subgraph ${url}`)
    remainingAttempts = remainingAttempts === undefined ? RETRIES : remainingAttempts

    try {
      const { data, errors } = await withTimeout(() => postQuery<T>(query, variables), TIMEOUT)

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
      logger.log(`Error querying subgraph ${url}: ${errorMessage}`)
      metrics.increment("subgraph_errors_total", { url, errorMessage })

      if (remainingAttempts > 0) {
        await sleep(BACKOFF)
        return executeQuery<T>(query, variables, remainingAttempts - 1)
      } else {
        throw error // bubble up
      }
    }
  }

  async function postQuery<T>(query: string, variables: Variables): Promise<SubgraphResponse<T>> {
    const response = await fetch.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new Error("Invalid request")
    }

    return (await response.json()) as SubgraphResponse<T>
  }

  async function withTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return await Promise.race([
      fn(),
      sleep(timeout).then(() => {
        throw new Error("Query timed-out")
      }),
    ])
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
