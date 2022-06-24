import { ILoggerComponent } from "@well-known-components/interfaces"
import { IFetchComponent } from "@well-known-components/http-server"
import { randomUUID } from "crypto"
import { setTimeout } from "timers/promises"
import { ISubgraphComponent } from "../src/types"
import { createSubgraphComponent } from "../src"
import { SUBGRAPH_URL, test } from "./components"

type Response = Awaited<ReturnType<IFetchComponent["fetch"]>>

jest.mock("crypto")
jest.mock("timers/promises")

test("subgraph component", function ({ components, stubComponents }) {
  beforeEach(() => {
    ;(setTimeout as jest.Mock).mockImplementation((_time: number, name: string) => {
      if (name === "Timeout") {
        return new Promise(() => {})
      } else {
        return Promise.resolve()
      }
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe("when querying a subgraph", () => {
    let fetchMock: jest.SpyInstance
    let response: Response

    beforeEach(() => {
      const { metrics } = stubComponents
      jest.spyOn(metrics, "increment")
    })

    describe("and the request is ok", () => {
      let okResponseData: { data: any }

      beforeEach(() => {
        const { fetch } = components

        okResponseData = {
          data: {
            elements: [1, 3, 4],
            someOther: "data",
          },
        }
        response = {
          ok: true,
          status: 200,
          json: async () => okResponseData,
        } as Response

        fetchMock = jest.spyOn(fetch, "fetch").mockImplementationOnce(async () => response)
      })

      it("should return the response data's data property", async () => {
        const { subgraph } = components
        const result = await subgraph.query("query")

        expect(result).toEqual(okResponseData.data)
      })

      it("should forward the variables and query to fetch the subgraph", async () => {
        const { subgraph } = components
        const query = "query ThisIsAQuery() {}"
        const variables = { some: "very interesting", variables: ["we have", "here"] }
        await subgraph.query(query, variables)

        expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: expect.any(AbortSignal),
        })
      })
    })

    describe("when the request errors out", () => {
      let errorResponseData: { errors: string[] }

      describe("and the server has an internal error", () => {
        beforeEach(() => {
          const { fetch } = components

          response = {
            ok: false,
            status: 500,
          } as Response

          fetchMock = jest.spyOn(fetch, "fetch").mockImplementationOnce(async () => response)
        })

        it("should throw the appropiate error", async () => {
          const { subgraph } = components
          await expect(subgraph.query("query", {}, 0)).rejects.toThrow(`Invalid request. Status: ${response.status}`)
        })

        it("should increment the metric", async () => {
          const { subgraph } = components
          const { metrics } = stubComponents

          try {
            await subgraph.query("query", {}, 0) // no retires
          } catch (error) {}

          expect(metrics.increment).toHaveBeenCalledWith("subgraph_errors_total", {
            url: SUBGRAPH_URL,
            errorMessage: `Invalid request. Status: ${response.status}`,
          })
        })

        describe("and data is logged", () => {
          const queryId = "2b37f834-9c39-4eb3-b716-8e7b3a3f6b3c"
          let logger: ILoggerComponent.ILogger
          let subgraph: ISubgraphComponent

          beforeEach(async () => {
            const { logs } = components

            logger = logs.getLogger("thegraph-port")

            jest.spyOn(logger, "debug")
            jest.spyOn(logs, "getLogger").mockImplementationOnce(() => logger)
            ;(randomUUID as jest.Mock).mockReturnValue(queryId)

            subgraph = await createSubgraphComponent(components, SUBGRAPH_URL)
          })

          it("should create a thegraph-port logger", async () => {
            const { logs } = components

            try {
              await subgraph.query("query", {}, 0)
            } catch (error) {}

            expect(logs.getLogger).toBeCalledWith("thegraph-port")
          })

          it("should append the correct verb to the log", async () => {
            try {
              await subgraph.query("query", {}, 3)
            } catch (error) {}

            const logData = {
              queryId,
              currentAttempt: 1,
              attempts: 4,
              timeoutWait: 2000,
              url: SUBGRAPH_URL,
            }

            expect(logger.debug).toHaveBeenCalledTimes(4)
            expect(logger.debug).toBeCalledWith("Querying:", logData)
            expect(logger.debug).toBeCalledWith("Querying:", { ...logData, currentAttempt: 2, timeoutWait: 2001 })
            expect(logger.debug).toBeCalledWith("Querying:", { ...logData, currentAttempt: 3, timeoutWait: 2002 })
            expect(logger.debug).toBeCalledWith("Querying:", { ...logData, currentAttempt: 4, timeoutWait: 2003 })
          })
        })
      })

      describe("when the query is incorrect", () => {
        beforeEach(() => {
          const { fetch } = components

          errorResponseData = { errors: [] }
          response = {
            ok: true,
            status: 400,
            json: async () => errorResponseData,
          } as Response

          fetchMock = jest.spyOn(fetch, "fetch").mockImplementationOnce(async () => response)
        })

        it("should increment the metric", async () => {
          const { subgraph } = components
          const { metrics } = stubComponents

          try {
            await subgraph.query("query", {}, 0) // no retires
          } catch (error) {}

          expect(metrics.increment).toHaveBeenCalledWith("subgraph_errors_total", {
            url: SUBGRAPH_URL,
            errorMessage: "GraphQL Error: Invalid response",
          })
        })

        describe("and there's an empty errors prop", () => {
          it("should throw an Invalid Response error", async () => {
            const { subgraph } = components
            await expect(subgraph.query("query", {}, 0)).rejects.toThrow("GraphQL Error: Invalid response")
          })
        })

        describe("and there's multiple errors", () => {
          beforeEach(() => {
            errorResponseData = {
              errors: ["some error", "happened"],
            }
          })

          it("should throw them all", async () => {
            const { subgraph } = components
            await expect(subgraph.query("query", {}, 0)).rejects.toThrow(
              "There was a total of 2. GraphQL errors:\n- some error\n- happened"
            )
          })
        })

        describe("when the retries is supplied", () => {
          const retries = 2

          beforeEach(() => {
            const { fetch } = components

            fetchMock.mockReset()
            fetchMock = jest.spyOn(fetch, "fetch").mockImplementation(async () => response)
          })

          it("should retry the supplied amount of times", async () => {
            const { subgraph } = components

            try {
              await subgraph.query("query", {}, retries)
            } catch (error) {}

            expect(fetchMock).toHaveBeenCalledTimes(retries + 1)
          })

          it("should increment the metric each time", async () => {
            const { subgraph } = components
            const { metrics } = stubComponents

            try {
              await subgraph.query("query", {}, retries)
            } catch (error) {}

            expect(metrics.increment).toHaveBeenCalledTimes(retries + 1)
            expect(metrics.increment).toHaveBeenCalledWith("subgraph_errors_total", {
              url: SUBGRAPH_URL,
              errorMessage: "GraphQL Error: Invalid response",
            })
          })
        })

        describe("when the retries is not supplied", () => {
          const retries = 4
          let subgraph: ISubgraphComponent

          beforeEach(async () => {
            const { config } = components
            jest.spyOn(config, "getNumber").mockImplementation(async (name: string) => {
              switch (name) {
                case "SUBGRAPH_COMPONENT_QUERY_TIMEOUT":
                  return 500
                case "SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT":
                  return 1
                case "SUBGRAPH_COMPONENT_RETRIES":
                  return retries
                default:
                  return 0
              }
            })

            subgraph = await createSubgraphComponent(components, SUBGRAPH_URL)
          })

          it("should retry the supplied amount of times", async () => {
            fetchMock.mockReset().mockImplementation()

            try {
              await subgraph.query("query")
            } catch (error) {}

            expect(fetchMock).toHaveBeenCalledTimes(retries + 1)
          })
        })
      })

      describe("when the timeout is reached", () => {
        let subgraph: ISubgraphComponent

        const errorMessage = "Query timed out"

        beforeEach(async () => {
          const { fetch } = components

          let reject: Function
          const fetchPromise = new Promise((_resolve, rej) => {
            reject = rej
          })
          fetchMock = jest.spyOn(fetch, "fetch").mockImplementation(() => fetchPromise as any)
          ;(setTimeout as jest.Mock).mockReset().mockImplementation(() => {
            reject(new Error(errorMessage))
            return Promise.resolve()
          })

          subgraph = await createSubgraphComponent(components, SUBGRAPH_URL)
        })

        it("should throw the appropiate error", async () => {
          await expect(subgraph.query("query")).rejects.toThrow(errorMessage)
        })

        it("should increment the metric", async () => {
          const { metrics } = stubComponents

          try {
            await subgraph.query("query")
          } catch (error) {}

          expect(metrics.increment).toHaveBeenCalledWith("subgraph_errors_total", {
            url: SUBGRAPH_URL,
            errorMessage,
          })
        })
      })
    })
  })
})
