import { qaQueue, connection } from '../src/lib/queue';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

/**
 * Test script to verify the BullMQ queue system.
 * Adds a 'test' job, waits, and checks its status.
 */
async function testQueue() {
  logger.info('Starting Queue Test...');

  // 1. Handle Redis Connection Errors
  connection.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
    process.exit(1);
  });

  try {
    // 2. Add a 'test' job to the queue
    logger.info('Adding "test" job to the queue...');
    const job = await qaQueue.add('test', { 
      message: 'Hello World',
      sentAt: new Date().toISOString() 
    });

    logger.info({ jobId: job.id }, 'Job added successfully');

    // 3. Wait 2 seconds for the worker to pick it up
    logger.info('Waiting 2 seconds for processing...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 4. Check if it was processed
    const updatedJob = await qaQueue.getJob(job.id!);
    
    if (!updatedJob) {
      logger.error('Job not found in queue after waiting');
    } else {
      const state = await updatedJob.getState();
      logger.info({ 
        jobId: updatedJob.id, 
        state,
        returnValue: updatedJob.returnvalue 
      }, `Job status: ${state}`);

      if (state === 'completed') {
        logger.info('✅ Success: Job was processed by the worker');
      } else if (state === 'failed') {
        logger.error({ reason: updatedJob.failedReason }, '❌ Failure: Job failed during processing');
      } else {
        logger.warn({ state }, `Wait: Job is currently in state: ${state}. Is the worker running?`);
      }
    }

  } catch (error: any) {
    logger.error({ error: error.message }, 'Unexpected error during queue test');
  } finally {
    // Clean up connections
    logger.info('Cleaning up connections...');
    await qaQueue.close();
    await connection.quit();
    logger.info('Test script finished');
    process.exit(0);
  }
}

testQueue().catch((err) => {
  logger.error(err, 'Critical test script failure');
  process.exit(1);
});
