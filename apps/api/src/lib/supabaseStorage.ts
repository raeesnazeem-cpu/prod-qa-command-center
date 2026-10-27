import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { supabase } from "./supabase"
import { logger } from "./logger"

const DEFAULT_BUCKET = "public_evidence"

// STORAGE_BACKEND=s3 (AWS): every Supabase bucket becomes a prefix in one S3 bucket,
// key = `<bucket>/<path>`. Public objects get a stable URL under
// STORAGE_PUBLIC_BASE_URL (CloudFront on AWS, floci's S3 endpoint locally).
// Unset = Supabase Storage, unchanged.
const useS3 = process.env.STORAGE_BACKEND === "s3"
const s3Bucket = process.env.AWS_S3_BUCKET_NAME || ""
const publicBaseUrl = (process.env.STORAGE_PUBLIC_BASE_URL || "").replace(/\/+$/, "")

let s3: S3Client | null = null
function s3Client(): S3Client {
  // The SDK picks up AWS_ENDPOINT_URL (floci) by itself; path-style for local endpoints.
  s3 ??= new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
  })
  return s3
}

const s3Key = (bucket: string, path: string) => `${bucket}/${path.replace(/^\/+/, "")}`
const encodePath = (key: string) => key.split("/").map(encodeURIComponent).join("/")

/**
 * Ensures a bucket exists with specified privacy.
 */
async function ensureBucketExists(
  bucketName: string,
  isPublic: boolean = false,
) {
  const { data: buckets, error: listError } =
    await supabase.storage.listBuckets()

  if (listError) {
    logger.error({ error: listError.message }, "Failed to list buckets")
    return
  }

  const exists = buckets.some((b) => b.name === bucketName)

  if (!exists) {
    logger.info({ bucket: bucketName, isPublic }, "Creating storage bucket")
    const { error: createError } = await supabase.storage.createBucket(
      bucketName,
      {
        public: isPublic,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/jpg"],
      },
    )

    if (createError) {
      logger.error({ error: createError.message }, "Failed to create bucket")
    }
  }
}

async function uploadToS3(
  buffer: Buffer,
  bucketName: string,
  path: string,
  isPublic: boolean,
): Promise<string> {
  const key = s3Key(bucketName, path)
  try {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: path.endsWith(".jpg") ? "image/jpeg" : "image/png",
      }),
    )
  } catch (err: any) {
    logger.error({ path, error: err?.message }, "Failed to upload screenshot")
    throw new Error(`Upload failed: ${err?.message}`)
  }

  if (isPublic) return `${publicBaseUrl}/${encodePath(key)}`

  // Private objects: 1 hour signed URL, same as the Supabase path
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: s3Bucket, Key: key }),
    { expiresIn: 3600 },
  )
}

/**
 * Uploads a screenshot buffer to Supabase Storage (or S3 with STORAGE_BACKEND=s3).
 * Returns a permanent public URL if isPublic is true, otherwise a signed URL.
 */
export async function uploadScreenshot(
  buffer: Buffer,
  path: string,
  options: { bucket?: string; isPublic?: boolean } = {},
): Promise<string> {
  const bucketName = options.bucket || DEFAULT_BUCKET
  const isPublic = options.isPublic ?? true

  logger.info({ path, bucketName }, "Uploading screenshot to storage")

  if (useS3) return uploadToS3(buffer, bucketName, path, isPublic)

  await ensureBucketExists(bucketName, isPublic)

  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(path, buffer, {
      contentType: path.endsWith(".jpg") ? "image/jpeg" : "image/png",
      upsert: true,
    })

  if (uploadError) {
    logger.error(
      { path, error: uploadError.message },
      "Failed to upload screenshot",
    )
    throw new Error(`Upload failed: ${uploadError.message}`)
  }

  if (isPublic) {
    const { data } = supabase.storage.from(bucketName).getPublicUrl(path)

    return data.publicUrl
  }

  // Generate signed URL (1 hour expiry) for private buckets
  const { data, error: signedUrlError } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(path, 3600)

  if (signedUrlError || !data?.signedUrl) {
    logger.error(
      { path, error: signedUrlError?.message },
      "Failed to generate signed URL",
    )
    throw new Error(`Failed to generate signed URL: ${signedUrlError?.message}`)
  }

  return data.signedUrl
}

/**
 * Finds the storage bucket + object path in a stored media URL. Understands
 * Supabase URLs (/storage/v1/object/{public|sign|authenticated}/<bucket>/<path>)
 * and S3 URLs (STORAGE_PUBLIC_BASE_URL, path-style or virtual-host, signed or not).
 * Returns null for anything else (e.g. a third-party image URL).
 */
export function parseStorageUrl(
  url: string,
): { bucket: string; path: string } | null {
  if (!url) return null
  let pathname: string
  let host: string
  try {
    const u = new URL(url)
    pathname = u.pathname
    host = u.host
  } catch {
    return null
  }

  let rest: string | null = null
  const sb = pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/)
  if (sb) {
    rest = sb[1]
  } else if (publicBaseUrl && url.startsWith(publicBaseUrl + "/")) {
    rest = new URL(url).pathname.slice(new URL(publicBaseUrl + "/").pathname.length)
  } else if (s3Bucket && host.startsWith(`${s3Bucket}.s3`)) {
    rest = pathname.slice(1)
  } else if (s3Bucket && pathname.startsWith(`/${s3Bucket}/`)) {
    rest = pathname.slice(s3Bucket.length + 2)
  }
  if (!rest) return null

  const [bucket, ...parts] = rest.split("/")
  if (!bucket || parts.length === 0) return null
  return { bucket, path: decodeURIComponent(parts.join("/")) }
}

/**
 * Downloads a stored media object by its URL with service credentials (no expiry
 * problems). Returns null when the URL is not one of ours, so callers can fall
 * back to a plain HTTP fetch.
 */
export async function downloadStoredObject(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const loc = parseStorageUrl(url)
  if (!loc) return null

  if (useS3) {
    const out = await s3Client().send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: s3Key(loc.bucket, loc.path) }),
    )
    const bytes = await out.Body!.transformToByteArray()
    return { buffer: Buffer.from(bytes), contentType: out.ContentType || "image/png" }
  }

  const { data, error } = await supabase.storage.from(loc.bucket).download(loc.path)
  if (error) throw error
  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || "image/png",
  }
}

/** Deletes specific objects from one bucket. */
export async function removeStoredObjects(bucket: string, paths: string[]) {
  if (paths.length === 0) return
  if (!useS3) {
    await supabase.storage.from(bucket).remove(paths)
    return
  }
  for (let i = 0; i < paths.length; i += 1000) {
    await s3Client().send(
      new DeleteObjectsCommand({
        Bucket: s3Bucket,
        Delete: {
          Objects: paths.slice(i, i + 1000).map((p) => ({ Key: s3Key(bucket, p) })),
          Quiet: true,
        },
      }),
    )
  }
}

/**
 * Deletes every object in `bucket` whose path starts with `prefix`
 * (e.g. a run id folder, or "privacy_policy/<runId>" for prefixed files).
 */
export async function removeStoredPrefix(bucket: string, prefix: string) {
  if (useS3) {
    let token: string | undefined
    do {
      const page = await s3Client().send(
        new ListObjectsV2Command({
          Bucket: s3Bucket,
          Prefix: s3Key(bucket, prefix),
          ContinuationToken: token,
        }),
      )
      const keys = (page.Contents || []).map((o) => o.Key!).filter(Boolean)
      if (keys.length > 0) {
        await s3Client().send(
          new DeleteObjectsCommand({
            Bucket: s3Bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        )
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return
  }

  // Supabase lists one folder level at a time. A prefix ending in a folder name
  // is walked recursively; otherwise it filters files in the parent folder.
  const slash = prefix.lastIndexOf("/")
  const parent = slash === -1 ? "" : prefix.slice(0, slash)
  const namePrefix = prefix.slice(slash + 1)

  const deleteFolderRecursive = async (folderPath: string) => {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folderPath, { limit: 1000 })
    if (error || !data || data.length === 0) return

    const filesToRemove: string[] = []
    for (const item of data) {
      if (!item.name || item.name === ".emptyFolderPlaceholder") continue
      const itemPath = `${folderPath}/${item.name}`
      if (!item.id) {
        await deleteFolderRecursive(itemPath)
      } else {
        filesToRemove.push(itemPath)
      }
    }
    if (filesToRemove.length > 0) {
      await supabase.storage.from(bucket).remove(filesToRemove)
    }
  }

  const { data } = await supabase.storage
    .from(bucket)
    .list(parent, { limit: 1000, search: namePrefix })
  for (const item of data || []) {
    if (!item.name || !item.name.startsWith(namePrefix)) continue
    const itemPath = parent ? `${parent}/${item.name}` : item.name
    if (!item.id) await deleteFolderRecursive(itemPath)
    else await supabase.storage.from(bucket).remove([itemPath])
  }
}
