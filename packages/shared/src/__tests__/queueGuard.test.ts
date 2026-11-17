import { LOCAL_REDIS_URL, isLocalRedisUrl, isRunningInContainer, resolveQueueRedisUrl } from "../queueGuard"

const PROD = "rediss://default:secret@engaging-troll-84120.upstash.io:6379"

describe("resolveQueueRedisUrl", () => {
  it("a deployed container (prod) keeps the Upstash URL", () => {
    expect(resolveQueueRedisUrl(PROD, { inContainer: true })).toEqual({ url: PROD })
  })
  it("any local machine with the prod URL is moved to local Redis, with a warning", () => {
    const r = resolveQueueRedisUrl(PROD, { inContainer: false })
    expect(r.url).toBe(LOCAL_REDIS_URL)
    expect(r.warning).toMatch(/not a deployed container/)
    expect(r.warning).not.toContain("secret")
  })
  it("a local Redis URL is always unchanged", () => {
    expect(resolveQueueRedisUrl("redis://127.0.0.1:6379", { inContainer: false })).toEqual({ url: "redis://127.0.0.1:6379" })
  })
  it("this test machine is not a container, so the real check blocks the prod URL", () => {
    if (isRunningInContainer()) return // running the tests inside Docker
    expect(resolveQueueRedisUrl(PROD).url).toBe(LOCAL_REDIS_URL)
  })
})

describe("isLocalRedisUrl", () => {
  it.each(["redis://localhost:6379", "redis://127.0.0.1:6379", "redis://[::1]:6379", "redis://redis:6379"])("%s is local", (u) => {
    expect(isLocalRedisUrl(u)).toBe(true)
  })
  it("Upstash and garbage are not local", () => {
    expect(isLocalRedisUrl(PROD)).toBe(false)
    expect(isLocalRedisUrl("not a url")).toBe(false)
  })
})
