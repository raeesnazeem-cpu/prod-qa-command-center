import { supabase } from "./supabase"
import { logger } from "./logger"

const DEFAULT_BUCKET = "public_evidence"

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

/**
 * Uploads a screenshot buffer to Supabase Storage.
 * Returns a permanent public URL if isPublic is true, otherwise a signed URL.
 */
export async function uploadScreenshot(
  buffer: Buffer,
  path: string,
  options: { bucket?: string; isPublic?: boolean } = {},
): Promise<string> {
  const bucketName = options.bucket || DEFAULT_BUCKET
  const isPublic = options.isPublic ?? true

  await ensureBucketExists(bucketName, isPublic)

  logger.info({ path, bucketName }, "Uploading screenshot to storage")

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
