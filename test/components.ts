// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { ILoggerComponent } from "@well-known-components/interfaces"
import { createRunner } from "@well-known-components/test-helpers"
import { createConfigComponent } from "@well-known-components/env-config-provider"
import { IFetchComponent } from "@well-known-components/http-server"
import { createMetricsComponent } from "@well-known-components/metrics"
import { ISubgraphComponent } from "../src/types"
import { createSubgraphComponent, metricDeclarations } from "../src"

export type GlobalContext = { components: ISubgraphComponent.Composable }

export type TestComponents = createSubgraphComponent.NeededComponents & ISubgraphComponent.Composable

export const SUBGRAPH_URL = "https://mock-subgraph.url.com"

function createTestConsoleLogComponent(): ILoggerComponent {
  return {
    getLogger: () => {
      return {
        log: () => {},
        debug: () => {},
        error: () => {},
        warn: () => {},
        info: () => {},
      }
    },
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
    const config = createConfigComponent(process.env)

    const logs = createTestConsoleLogComponent()
    const metrics = await createMetricsComponent(metricDeclarations, { config })

    // test fetch, to hit our local server
    const subgraphFetch: IFetchComponent = {
      async fetch() {
        return {} as any
      },
    }

    const subgraph = await createSubgraphComponent(SUBGRAPH_URL, { config, logs, metrics, fetch: subgraphFetch })

    return {
      config,
      logs,
      metrics,
      fetch: subgraphFetch,
      subgraph,
    }
  },
})
