import {
  IConfigComponent,
  IFetchComponent,
  ILoggerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { randomUUID } from 'crypto'
import { ISubgraphComponent, PostQueryResponse, SubgraphResponse, Variables } from './types'
import { metricDeclarations } from './metrics'
import { UNKNOWN_SUBGRAPH_PROVIDER, withTimeout } from './utils'
import pRetry from 'p-retry'

export * from './types'
export { metricDeclarations } from './metrics'

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

  const logger = logs.getLogger('thegraph-port')

  const RETRIES = (await config.getNumber('SUBGRAPH_COMPONENT_RETRIES')) ?? 3
  const TIMEOUT = (await config.getNumber('SUBGRAPH_COMPONENT_QUERY_TIMEOUT')) ?? 10000
  const TIMEOUT_INCREMENT = (await config.getNumber('SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT')) ?? 10000
  const BACKOFF = (await config.getNumber('SUBGRAPH_COMPONENT_BACKOFF')) ?? 500
  const USER_AGENT = `Subgraph component / ${
    (await config.getString('SUBGRAPH_COMPONENT_AGENT_NAME')) ?? 'Unknown sender'
  }`

  async function executeQuery<T>(query: string, variables: Variables = {}, maxAttempts: number = RETRIES): Promise<T> {
    let timeoutWait = TIMEOUT + (maxAttempts - 1) * TIMEOUT_INCREMENT
    const queryId = randomUUID()

    let run = async (): Promise<T> => await executeQueryNoRetry<T>(query, variables, timeoutWait)

    return await pRetry<T>(run, {
      retries: maxAttempts - 1,
      minTimeout: BACKOFF,
      onFailedAttempt: (error) => {
        logger.warn('Error:', {
          queryId,
          currentAttempt: error.attemptNumber,
          attempts: maxAttempts,
          timeoutWait,
          url,
          errorMessage: error.message,
          query,
          variables: JSON.stringify(variables)
        })
        if (error.retriesLeft === 1) {
          metrics.increment('subgraph_errors_total', { url })
        }
        timeoutWait = TIMEOUT + error.attemptNumber * TIMEOUT_INCREMENT
      }
    })
  }

  async function executeQueryNoRetry<T>(query: string, variables: Variables = {}, timeoutWait: number): Promise<T> {
    const { end } = metrics.startTimer('subgraph_query_duration_seconds', { url })
    try {
      const [provider, response] = await withTimeout(
        (abortController) => postQuery<T>(query, variables, abortController),
        timeoutWait
      )

      const { data, errors } = response

      if (errors === undefined) {
        const hasInvalidData = !data || Object.keys(data).length === 0
        if (hasInvalidData) {
          throw new Error(`GraphQL Error: Invalid response. Provider: ${provider}`)
        }

        metrics.increment('subgraph_ok_total', { url })
        return data
      }

      const errorMessages = Array.isArray(errors) ? errors.map((error) => error.message) : [errors.message]
      throw new Error(
        `GraphQL Error: Invalid response. Errors:\n- ${errorMessages.join('\n- ')}. Provider: ${provider}`
      )
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-agent': USER_AGENT },
      body: JSON.stringify({ query, variables }),
      abortController
    })

    const provider = response.headers.get('X-Subgraph-Provider') ?? UNKNOWN_SUBGRAPH_PROVIDER

    if (!response.ok) {
      throw new Error(`Invalid request. Status: ${response.status}. Provider: ${provider}.`)
    }

    return [provider, (await response.json()) as SubgraphResponse<T>]
  }

  return {
    query: executeQuery
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
