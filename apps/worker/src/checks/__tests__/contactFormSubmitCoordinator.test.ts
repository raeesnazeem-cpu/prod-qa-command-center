import {
  claimContactFormSubmit,
  markContactFormHomepageDone,
  releaseContactFormSubmit,
  resetContactFormSubmit,
} from "../preReleaseSuite"

// The coordinator reads homepageInRun/homepageDone from its per-run state; the
// check sets them. Here we drive them through the same claim/release API plus
// the homepage "done" transition the check performs in its finally block.
const RUN = "run-test"
beforeEach(() => resetContactFormSubmit(RUN))

describe("contact form submit coordinator", () => {
  it("homepage takes the first slot; other pages wait for it", () => {
    expect(claimContactFormSubmit(RUN, false)).toBe(false) // homepage not done yet
    expect(claimContactFormSubmit(RUN, true)).toBe(true)
    expect(claimContactFormSubmit(RUN, true)).toBe(false) // in flight
  })

  it("a confirmed submission stops every further attempt", () => {
    expect(claimContactFormSubmit(RUN, true)).toBe(true)
    releaseContactFormSubmit(RUN, true)
    expect(claimContactFormSubmit(RUN, true)).toBe(false)
    expect(claimContactFormSubmit(RUN, false)).toBe(false)
  })

  it("homepage fails → up to 2 fallback pages, then stop", () => {
    expect(claimContactFormSubmit(RUN, true)).toBe(true)
    releaseContactFormSubmit(RUN, false)
    markContactFormHomepageDone(RUN)
    expect(claimContactFormSubmit(RUN, false)).toBe(true)
    releaseContactFormSubmit(RUN, false)
    expect(claimContactFormSubmit(RUN, false)).toBe(true)
    releaseContactFormSubmit(RUN, false)
    expect(claimContactFormSubmit(RUN, false)).toBe(false)
  })

  it("homepage has no form → first page with a form submits once", () => {
    markContactFormHomepageDone(RUN)
    expect(claimContactFormSubmit(RUN, false)).toBe(true)
    releaseContactFormSubmit(RUN, true)
    expect(claimContactFormSubmit(RUN, false)).toBe(false)
  })

  it("caps at 3 attempts total even if all fail", () => {
    let granted = 0
    for (let i = 0; i < 200; i++) {
      if (claimContactFormSubmit(RUN, true)) {
        granted++
        releaseContactFormSubmit(RUN, false)
      }
    }
    expect(granted).toBe(3)
  })
})
