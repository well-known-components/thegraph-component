import { IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { randomUUID } from 'crypto'
import { setTimeout } from 'timers/promises'
import { ISubgraphComponent, SubgraphResponse, Variables } from '../src'
import { createSubgraphComponent } from '../src'
import { UNKNOWN_SUBGRAPH_PROVIDER } from '../src/utils'
import { SUBGRAPH_URL, test } from './components'

type Response = Awaited<ReturnType<IFetchComponent['fetch']>>

jest.mock('crypto')
jest.mock('timers/promises')

test('subgraph component', function ({ components, stubComponents }) {
  const randomUUIMock: jest.Mock = randomUUID as any
  const setTimeoutMock: jest.Mock = setTimeout as any

  beforeEach(() => {
    setTimeoutMock.mockImplementation((_time: number, name: string) => {
      if (name === 'Timeout') {
        return new Promise(() => {})
      } else {
        return Promise.resolve()
      }
    })
    jest.spyOn(stubComponents.metrics, 'startTimer').mockReturnValue({ end: jest.fn() })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('when querying a subgraph', () => {
    let fetchMock: jest.SpyInstance
    let response: Response
    const query = 'query ThisIsAQuery() {}'
    let variables: Variables

    beforeEach(() => {
      const { metrics } = stubComponents
      jest.spyOn(metrics, 'increment')
    })

    describe('and the request is ok', () => {
      let okResponseData: { data: any }

      beforeEach(() => {
        const { fetch } = components

        okResponseData = {
          data: {
            elements: [1, 3, 4],
            someOther: 'data'
          }
        }

        response = {
          ok: true,
          status: 200,
          json: async () => okResponseData,
          headers: new Map()
        } as unknown as Response

        variables = { some: 'very interesting', variables: ['we have', 'here'] }

        fetchMock = jest.spyOn(fetch, 'fetch').mockImplementationOnce(async () => response)
      })

      it("should return the response data's data property", async () => {
        const { subgraph } = components
        const { metrics } = stubComponents

        const result = await subgraph.query('query')

        expect(result).toEqual(okResponseData.data)
        expect(metrics.increment).toHaveBeenCalledWith('subgraph_ok_total', {
          url: SUBGRAPH_URL
        })
      })

      it('should forward the variables and query to fetch the subgraph', async () => {
        const { subgraph } = components
        await subgraph.query(query, variables)

        expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-agent': 'Subgraph component / Unknown sender' },
          body: JSON.stringify({ query, variables }),
          abortController: expect.any(AbortController)
        })
      })

      describe('and the agent name is provided', () => {
        let subgraph: ISubgraphComponent

        beforeEach(async () => {
          const { config } = components
          jest.spyOn(config, 'getString').mockImplementation(async (name: string) => {
            switch (name) {
              case 'SUBGRAPH_COMPONENT_AGENT_NAME':
                return 'An agent'
              default:
                return ''
            }
          })
          subgraph = await createSubgraphComponent(components, SUBGRAPH_URL)
        })

        it('should perform the fetch to the subgraph with the provided user agent', async () => {
          await subgraph.query(query, variables)

          expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-agent': 'Subgraph component / An agent' },
            body: JSON.stringify({ query, variables }),
            abortController: expect.any(AbortController)
          })
        })
      })

      describe('and the agent name is not provided', () => {
        it('should perform the fetch to the subgraph with the provided user agent', async () => {
          const { subgraph } = components
          await subgraph.query(query, variables)

          expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-agent': 'Subgraph component / Unknown sender' },
            body: JSON.stringify({ query, variables }),
            abortController: expect.any(AbortController)
          })
        })
      })
    })

    describe('when the request errors out', () => {
      let errorResponseData: SubgraphResponse<any>

      describe('and the server has an internal error', () => {
        beforeEach(() => {
          const { fetch } = components

          response = {
            ok: false,
            status: 500,
            headers: new Map()
          } as unknown as Response

          fetchMock = jest.spyOn(fetch, 'fetch').mockImplementationOnce(async () => response)
        })

        it('should throw the appropriate error', async () => {
          const { subgraph } = components
          await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
            `Invalid request. Status: ${response.status}. Provider: ${UNKNOWN_SUBGRAPH_PROVIDER}`
          )
        })

        it('should increment the metric', async () => {
          const { subgraph } = components
          const { metrics } = stubComponents

          try {
            await subgraph.query('query', {}, 0) // no retires
          } catch (error) {}

          expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', {
            url: SUBGRAPH_URL
          })
        })

        describe('and the response has a subgraph provider header', () => {
          beforeEach(() => {
            response.headers.set('X-Subgraph-Provider', 'SubgraphProvider')
          })

          it('should have the subgraph provider in the error message', async () => {
            const { subgraph } = components

            await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
              `Invalid request. Status: ${response.status}. Provider: SubgraphProvider`
            )
          })
        })

        describe('and data is logged', () => {
          const queryId = '2b37f834-9c39-4eb3-b716-8e7b3a3f6b3c'
          let logger: ILoggerComponent.ILogger
          let subgraph: ISubgraphComponent

          beforeEach(async () => {
            const { logs } = components

            logger = logs.getLogger('thegraph-port')

            jest.spyOn(logger, 'debug')
            jest.spyOn(logs, 'getLogger').mockImplementationOnce(() => logger)
            randomUUIMock.mockReturnValue(queryId)

            subgraph = await createSubgraphComponent(components, SUBGRAPH_URL)
          })

          it('should create a thegraph-port logger', async () => {
            const { logs } = components

            try {
              await subgraph.query('query', {}, 0)
            } catch (error) {}

            expect(logs.getLogger).toBeCalledWith('thegraph-port')
          })
        })
      })

      describe('when the query is incorrect', () => {
        const errorMessage = 'No suitable indexer found for subgraph deployment'

        beforeEach(() => {
          const { fetch } = components

          errorResponseData = {
            data: undefined,
            errors: { message: errorMessage }
          }
          response = {
            ok: true,
            status: 400,
            json: async () => errorResponseData,
            headers: new Map()
          } as unknown as Response

          fetchMock = jest.spyOn(fetch, 'fetch').mockImplementationOnce(async () => response)
        })

        it('should increment the metric', async () => {
          const { subgraph } = components
          const { metrics } = stubComponents

          try {
            await subgraph.query('query', {}, 0) // no retires
          } catch (error) {}

          expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', {
            url: SUBGRAPH_URL
          })
        })

        describe("and there's an empty errors prop", () => {
          beforeEach(() => {
            errorResponseData = {
              data: {},
              errors: undefined
            }
          })

          it('should throw an Invalid Response error', async () => {
            const { subgraph } = components
            await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
              `GraphQL Error: Invalid response. Provider: ${UNKNOWN_SUBGRAPH_PROVIDER}`
            )
          })

          describe('and the response has a subgraph provider header', () => {
            beforeEach(() => {
              response.headers.set('X-Subgraph-Provider', 'SubgraphProvider')
            })

            it('should have the subgraph provider in the error message', async () => {
              const { subgraph } = components

              await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
                `GraphQL Error: Invalid response. Provider: SubgraphProvider`
              )
            })
          })
        })

        describe("and there's multiple errors", () => {
          beforeEach(() => {
            errorResponseData = {
              data: undefined,
              errors: [{ message: 'some error' }, { message: 'happened' }]
            }
          })

          it('should throw them all', async () => {
            const { subgraph } = components
            await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
              `GraphQL Error: Invalid response. Errors:\n- some error\n- happened. Provider: ${UNKNOWN_SUBGRAPH_PROVIDER}`
            )
          })

          describe('and the response has a subgraph provider header', () => {
            beforeEach(() => {
              response.headers.set('X-Subgraph-Provider', 'SubgraphProvider')
            })

            it('should have the subgraph provider in the error message', async () => {
              const { subgraph } = components

              await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
                `GraphQL Error: Invalid response. Errors:\n- some error\n- happened. Provider: SubgraphProvider`
              )
            })
          })
        })

        describe('when the retries is supplied', () => {
          const retries = 2

          beforeEach(() => {
            const { fetch } = components

            fetchMock.mockReset()
            fetchMock = jest.spyOn(fetch, 'fetch').mockImplementation(async () => response)
          })

          it('should retry the supplied amount of times', async () => {
            const { subgraph } = components

            try {
              await subgraph.query('query', {}, retries)
            } catch (error) {}

            expect(fetchMock).toHaveBeenCalledTimes(retries + 1)
          })

          it('should increment the metric each time', async () => {
            const { subgraph } = components
            const { metrics } = stubComponents

            try {
              await subgraph.query('query', {}, retries)
            } catch (error) {}

            expect(metrics.increment).toHaveBeenCalledTimes(retries + 1)
            expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', {
              url: SUBGRAPH_URL
            })
          })
        })

        describe('when the retries is not supplied', () => {
          const retries = 4
          let subgraph: ISubgraphComponent

          beforeEach(async () => {
            const { config } = components
            jest.spyOn(config, 'getNumber').mockImplementation(async (name: string) => {
              switch (name) {
                case 'SUBGRAPH_COMPONENT_QUERY_TIMEOUT':
                  return 500
                case 'SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT':
                  return 1
                case 'SUBGRAPH_COMPONENT_RETRIES':
                  return retries
                default:
                  return 0
              }
            })

            subgraph = await createSubgraphComponent(components, SUBGRAPH_URL)
          })

          it('should retry the supplied amount of times', async () => {
            fetchMock.mockReset().mockImplementation()

            try {
              await subgraph.query('query')
            } catch (error) {}

            expect(fetchMock).toHaveBeenCalledTimes(retries + 1)
          })
        })
      })

      describe('when the timeout is reached', () => {
        let subgraph: ISubgraphComponent

        const errorMessage = 'Query timed out'

        beforeEach(async () => {
          const { fetch } = components

          let reject: Function
          const fetchPromise = new Promise((_resolve, rej) => {
            reject = rej
          })
          fetchMock = jest.spyOn(fetch, 'fetch').mockImplementation(() => fetchPromise as any)
          setTimeoutMock.mockReset().mockImplementation(() => {
            reject(new Error(errorMessage))
            return Promise.resolve()
          })

          subgraph = await createSubgraphComponent(components, SUBGRAPH_URL)
        })

        it('should throw the appropiate error', async () => {
          await expect(subgraph.query('query')).rejects.toThrow(errorMessage)
        })

        it('should increment the metric', async () => {
          const { metrics } = stubComponents

          try {
            await subgraph.query('query')
          } catch (error) {}

          expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', {
            url: SUBGRAPH_URL
          })
        })
      })
    })
  })
})
