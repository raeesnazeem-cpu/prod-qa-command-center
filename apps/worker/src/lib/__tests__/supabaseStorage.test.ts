// Storage URLs live in the DB forever, so the parser must understand both the old
// Supabase shape and the S3 shapes (STORAGE_BACKEND=s3 on AWS).
const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STORAGE_BACKEND",
  "AWS_S3_BUCKET_NAME",
  "STORAGE_PUBLIC_BASE_URL",
]

describe("supabaseStorage URLs", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    process.env.SUPABASE_URL = "http://sb.local"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
    process.env.STORAGE_BACKEND = "s3"
    process.env.AWS_S3_BUCKET_NAME = "qacc-media-local"
    process.env.STORAGE_PUBLIC_BASE_URL = "https://media.qacc.example/"
    jest.resetModules()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  const load = () => require("../supabaseStorage")

  it.each([
    [
      "supabase public",
      "https://abc.supabase.co/storage/v1/object/public/screenshots/run1/page%201.png",
      { bucket: "screenshots", path: "run1/page 1.png" },
    ],
    [
      "supabase signed",
      "https://abc.supabase.co/storage/v1/object/sign/evidence/privacy_policy/run1_x.png?token=abc",
      { bucket: "evidence", path: "privacy_policy/run1_x.png" },
    ],
    [
      "public base (CloudFront)",
      "https://media.qacc.example/public_evidence/run1/p/shot.jpg",
      { bucket: "public_evidence", path: "run1/p/shot.jpg" },
    ],
    [
      "path-style presigned (floci)",
      "http://localhost:4566/qacc-media-local/evidence/run1/a.png?X-Amz-Signature=x",
      { bucket: "evidence", path: "run1/a.png" },
    ],
    [
      "virtual-host",
      "https://qacc-media-local.s3.us-east-1.amazonaws.com/recordings/run1/full_project_desktop.webm",
      { bucket: "recordings", path: "run1/full_project_desktop.webm" },
    ],
  ])("parses %s", (_label, url, expected) => {
    expect(load().parseStorageUrl(url)).toEqual(expected)
  })

  it("ignores third-party and malformed URLs", () => {
    const { parseStorageUrl } = load()
    expect(parseStorageUrl("https://example.com/wp-content/uploads/a.png")).toBeNull()
    expect(parseStorageUrl("not a url")).toBeNull()
    expect(parseStorageUrl("")).toBeNull()
  })

  it("returns a stable public URL for S3 uploads", async () => {
    const mod = load()
    const { S3Client } = require("@aws-sdk/client-s3")
    const send = jest.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never)
    const url = await mod.uploadScreenshot(Buffer.from("x"), "run1/page 1.png")
    expect(url).toBe("https://media.qacc.example/public_evidence/run1/page%201.png")
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "qacc-media-local",
      Key: "public_evidence/run1/page 1.png",
      ContentType: "image/png",
    })
    expect(mod.parseStorageUrl(url)).toEqual({ bucket: "public_evidence", path: "run1/page 1.png" })
    send.mockRestore()
  })
})
