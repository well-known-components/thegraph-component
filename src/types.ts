/**
 * @public
 */
export type Variables = Record<string, string[] | string | number | boolean | undefined>

/**
 * @public
 */
export type SubgraphResponse<T> = { data: T; errors?: { message: string }[] }

/**
 * @public
 */
export interface ISubgraphComponent {
  /**
   * Query the subgraph using GraphQL
   * @param query String version of a GraphQL query
   * @param variables Any variables present on the query, if any
   * @param remainingAttempts Overwrite the default retries value, configurable via ENV var
   * @returns Query result
   */
  query: <T>(query: string, variables?: Variables, remainingAttempts?: number) => Promise<T>
}

/**
 * @public
 */
export namespace ISubgraphComponent {
  /**
   * @public
   */
  export type Composable = {
    subgraph: ISubgraphComponent
  }
}
