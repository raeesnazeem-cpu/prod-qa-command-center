// Nov 19-20, 2026: post-release runs with 4-13 failed checks closed "Complete QA
// post-release testing" Completed; TED read that as "site is live" and moved six
// clients to Client Base. A post-release run now always leaves the parent open.
let runType: string | null = "post_release"
const upserts: any[] = []
const chain: any = {
  select: () => chain,
  eq: () => chain,
  in: () => chain,
  like: () => chain,
  limit: () => Promise.resolve({ data: [], error: null }),
  order: () => chain,
  maybeSingle: () => Promise.resolve({ data: runType ? { run_type: runType } : null, error: null }),
  single: () => Promise.resolve({ data: { project_id: "p1" }, error: null }),
  upsert: (row: any) => { upserts.push(row); return Promise.resolve({ data: null, error: null }) },
  then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
}
jest.mock("../supabase", () => ({ supabase: { from: () => chain } }))
jest.mock("../queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })
process.env.TED_PREVIEW_ONLY = "true"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parentHeldOpen, runNeedsPersonSignOff } = require("../tedSync")

describe("runNeedsPersonSignOff", () => {
  it("post-release runs need a person", () => expect(runNeedsPersonSignOff("post_release")).toBe(true))
  it("other runs do not", () => {
    expect(runNeedsPersonSignOff("pre_release")).toBe(false)
    expect(runNeedsPersonSignOff("internal_qa")).toBe(false)
    expect(runNeedsPersonSignOff(null)).toBe(false)
  })
})

describe("parentHeldOpen for a post-release run", () => {
  it("holds the parent open even when every check passed", async () => {
    runType = "post_release"
    await expect(parentHeldOpen("run1", "9966")).resolves.toBe(true)
  })
  it("a pre-release run with nothing open still closes", async () => {
    runType = "pre_release"
    await expect(parentHeldOpen("run2", "9960")).resolves.toBe(false)
  })
})
