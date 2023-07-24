import { IMetricsComponent } from '@well-known-components/interfaces'

/**
 * Metrics declarations, needed for your IMetricsComponent
 * @public
 */
export const metricDeclarations: IMetricsComponent.MetricsRecordDefinition<string> = {
  subgraph_ok_total: {
    help: 'Subgraph request counter',
    type: IMetricsComponent.CounterType,
    labelNames: ['url']
  },
  subgraph_errors_total: {
    help: 'Subgraph error counter',
    type: IMetricsComponent.CounterType,
    labelNames: ['url', 'kind']
  },
  subgraph_query_duration_seconds: {
    type: IMetricsComponent.HistogramType,
    help: 'Request duration in seconds.',
    labelNames: ['url']
  }
}
