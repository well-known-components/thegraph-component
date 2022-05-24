# thegraph-component

A port used to query [thegraph](https://thegraph.com/)'s subgraphs.

### API

**Create**

To create the component you'll have to supply the subgraph's url. You can get it from thegraph's site, for example: https://api.thegraph.com/subgraphs/name/decentraland/marketplace

```ts
const url = "https://api.thegraph.com/subgraphs/name/decentraland/marketplace"
await createSubgraphComponent({ config, logs, metrics, fetch }, url)
```

**Query**

The main API is:

```ts
query: <T>(query: string, variables?: Variables) => Promise<T>
```

So you can call it like this:

```ts
type Element = {
  id: string
  count: number
}

function getElementsQuery() {
  return `query getCollection($count: Number!) {
    elements(where: { count_gt: $count }) {
      id
      count
    }
  }`
}

await subgraph.query<{ elements: Element[] }>(getElementsQuery(), { count: 5 })
```

### Configuration

It supports two ENV variables:

- `SUBGRAPH_COMPONENT_RETRIES`: How many retries per subraph query. Defaults to `3`.
- `SUBGRAPH_COMPONENT_QUERY_TIMEOUT`: How long to wait until a connection is timed-out. Defaults to `10000`ms or 10 seconds.
- `SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT`: How much time to add after each retry. The value will be multiplied for the attempt number. For example: if the increment is 10000, it'll wait 10s the first retry, 20s next, 30s, etc. Defaults to `10000`ms or 10 seconds.
- `SUBGRAPH_COMPONENT_BACKOFF`: How long to wait until a new query is tried after an unsuccessfull one (retrying). Defaults to `500`ms.
