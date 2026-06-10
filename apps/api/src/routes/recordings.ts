import { Router } from 'express'
import { JobsClient } from '@google-cloud/run'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'

const router = Router()
const jobsClient = new JobsClient()

router.post('/start', async (req, res) => {
  const { runId, pageId } = req.body

  if (!runId || !pageId) {
    return res.status(400).json({ error: 'Missing runId or pageId' })
  }

  try {
    // 1. Fetch the finding to get the URL
    const { data: finding, error: findingError } = await supabase
      .from('findings')
      .select('url')
      .match({ run_id: runId, page_id: pageId })
      .limit(1)
      .single()

    if (findingError || !finding) {
      logger.error({ findingError, runId, pageId }, 'Finding not found for recording')
      return res.status(404).json({ error: 'Finding not found' })
    }

    const targetUrl = finding.url
    const viewports = ['desktop', 'laptop', 'tablet', 'mobile']
    const jobName = process.env.GCP_RECORDING_JOB_NAME || 'recording-worker'
    const projectId = process.env.GCP_PROJECT_ID
    const location = process.env.GCP_LOCATION || 'us-central1'

    if (!projectId) {
      throw new Error('GCP_PROJECT_ID is not set')
    }

    const jobPath = `projects/${projectId}/locations/${location}/jobs/${jobName}`

    // 2. Trigger Cloud Run Jobs for each viewport
    const triggerPromises = viewports.map(async (viewportType) => {
      logger.info({ runId, pageId, viewportType }, `Triggering recording job for ${viewportType}`)
      
      try {
        const [operation] = await jobsClient.runJob({
          name: jobPath,
          overrides: {
            containerOverrides: [
              {
                env: [
                  { name: 'TARGET_URL', value: targetUrl },
                  { name: 'VIEWPORT_TYPE', value: viewportType },
                  { name: 'RUN_ID', value: runId },
                  { name: 'PAGE_ID', value: pageId },
                  { name: 'SUPABASE_URL', value: process.env.SUPABASE_URL || '' },
                  { name: 'SUPABASE_SERVICE_ROLE_KEY', value: process.env.SUPABASE_SERVICE_ROLE_KEY || '' },
                ],
              },
            ],
          },
        })
        return operation
      } catch (err: any) {
        logger.error({ err: err.message, viewportType }, 'Failed to trigger Cloud Run Job')
        throw err
      }
    })

    await Promise.all(triggerPromises)

    res.json({ message: 'Recording jobs initiated', viewports })
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Error starting recording jobs')
    res.status(500).json({ error: 'Failed to start recording jobs' })
  }
})

export { router as recordingsRouter }
