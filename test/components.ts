// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { createRunner } from '@well-known-components/test-helpers'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createMetricsComponent } from '@well-known-components/metrics'
import { ISubgraphComponent } from '../src'
import { createSubgraphComponent, metricDeclarations } from '../src'

export type TestComponents = createSubgraphComponent.NeededComponents & ISubgraphComponent.Composable

export const SUBGRAPH_URL = 'https://mock-subgraph.url.com'

function createTestConsoleLogComponent(): ILoggerComponent {
  return {
    getLogger: () => {
      return {
        log: () => {},
        debug: () => {},
        error: () => {},
        warn: () => {},
        info: () => {}
      }
    }
  }
}
/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  async main({ startComponents }) {
    await startComponents()
  },
  async initComponents(): Promise<TestComponents> {
    const config = createConfigComponent(process.env, {
      // To avoid open timeout handles, we keep the retry timeouts at bay
      SUBGRAPH_COMPONENT_QUERY_TIMEOUT: '2000',
      SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT: '1'
    })

    const logs = createTestConsoleLogComponent()
    const metrics = await createMetricsComponent(metricDeclarations, { config })

    // test fetch, to hit our local server
    const subgraphFetch: IFetchComponent = {
      async fetch() {
        return {} as any
      }
    }

    const subgraph = await createSubgraphComponent({ config, logs, metrics, fetch: subgraphFetch }, SUBGRAPH_URL)

    return {
      config,
      logs,
      metrics,
      fetch: subgraphFetch,
      subgraph
    }
  }
})
