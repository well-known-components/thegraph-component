import { setTimeout } from "timers/promises"
import { withTimeout } from "../src/utils"

describe("withTimeout", () => {
  describe("when running the supplied callback", () => {
    let abortController: AbortController

    it("should supply an abortable controller", async () => {
      await withTimeout(async (_abortController) => {
        abortController = _abortController
      }, 100000)
      expect(abortController).toBeInstanceOf(AbortController)
    })

    it("should abort the controller if the timeout is reached", async () => {
      let abortController: AbortController
      const timeout = 300
      try {
        await withTimeout(async (_abortController) => {
          abortController = _abortController
          jest.spyOn(abortController, "abort")
          return setTimeout(timeout + 300, "Timeoutable", { signal: _abortController.signal })
        }, timeout)
      } catch (error) {
        expect(abortController.abort).toHaveBeenCalled()
      }
    })
  })
})
