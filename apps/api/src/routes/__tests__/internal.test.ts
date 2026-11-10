import express from "express"
import request from "supertest"
import { internalToken, INTERNAL_TOKEN_HEADER } from "@qacc/shared"

const postTedAiComment = jest.fn()
jest.mock("../webhooks", () => ({ postTedAiComment: (...a: any[]) => postTedAiComment(...a) }))

import { internalRouter } from "../internal"

process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test"
const app = express()
app.use(express.json())
app.use("/internal", internalRouter)

describe("POST /internal/ted-comment (worker relay)", () => {
  beforeEach(() => postTedAiComment.mockReset())

  it("posts the worker's comment as TED QA Agent with a valid token", async () => {
    postTedAiComment.mockResolvedValue(true)
    const r = await request(app)
      .post("/internal/ted-comment")
      .set(INTERNAL_TOKEN_HEADER, internalToken("ted-comment")!)
      .send({ taskId: "65011", text: "<p>report</p>", eventKey: "qacc-report:1", aiAssigned: true })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ posted: true })
    expect(postTedAiComment).toHaveBeenCalledWith("65011", "<p>report</p>", "qacc-report:1", { aiAssigned: true })
  })

  it("refuses a missing or wrong token without posting", async () => {
    const none = await request(app).post("/internal/ted-comment").send({ taskId: "1", text: "x" })
    const wrong = await request(app)
      .post("/internal/ted-comment")
      .set(INTERNAL_TOKEN_HEADER, internalToken("ted-comment", "other-key")!)
      .send({ taskId: "1", text: "x" })
    expect(none.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(postTedAiComment).not.toHaveBeenCalled()
  })

  it("says 502 when TED did not take it, so the worker falls back", async () => {
    postTedAiComment.mockResolvedValue(false)
    const r = await request(app)
      .post("/internal/ted-comment")
      .set(INTERNAL_TOKEN_HEADER, internalToken("ted-comment")!)
      .send({ taskId: "65011", text: "x", eventKey: "k" })
    expect(r.status).toBe(502)
    expect(r.body).toEqual({ posted: false })
  })

  it("rejects a non-numeric task id", async () => {
    const r = await request(app)
      .post("/internal/ted-comment")
      .set(INTERNAL_TOKEN_HEADER, internalToken("ted-comment")!)
      .send({ taskId: "../admin", text: "x" })
    expect(r.status).toBe(400)
  })
})
