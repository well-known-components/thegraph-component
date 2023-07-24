import { IFetchComponent, Lifecycle } from '@well-known-components/interfaces'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createSubgraphComponent, metricDeclarations } from '../src'
import { fetch as undici } from 'undici'

Lifecycle.run({
  async initComponents() {
    const config = createConfigComponent(process.env)
    const logs = await createLogComponent({ config })
    const fetch: IFetchComponent = {
      fetch: undici as any
    }
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    const thegraph = await createSubgraphComponent(
      {
        config,
        fetch,
        logs,
        metrics
      },
      'https://api.thegraph.com/subgraphs/name/decentraland/collections-matic-mainnet'
    )

    return { thegraph }
  },
  async main(program) {
    await program.startComponents()

    console.log(
      await program.components.thegraph.query(
        `
        query getNftItemsForBlock($block: Int!, $ethAddress: String!, $urnList: [String!]) {
          items: nfts(
            block: {number: $block}
            where: {owner: $ethAddress, searchItemType_in: ["wearable_v1", "wearable_v2", "smart_wearable_v1", "emote_v1"] urn_in: $urnList}
            first: 1000
          ) {
            urn
          }
        }
      `,
        {
          block: 31452893,
          urnList: [
            'urn:decentraland:matic:collections-v2:0x7e553ede9b6ad437262d28d4fe9ab77e63089b8a:3',
            'urn:decentraland:matic:collections-v2:0x84a1d84f183fa0fd9b6b9cb1ed0ff1b7f5409ebb:10'
          ],
          ethAddress: '0x8f20c5acaf44ec084cb1936d116601d99d2e8704'
        }
      )
    )
  }
})
