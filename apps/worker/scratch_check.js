const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

const redisUrl = process.env.UPSTASH_REDIS_URL;
if (!redisUrl) {
  console.error('Missing UPSTASH_REDIS_URL');
  process.exit(1);
}

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  const queue = new Queue('qa-jobs', { connection });

  console.log('Fetching check_project_plan jobs...');
  // Get all job counts
  const counts = await queue.getJobCounts();
  console.log('Job counts:', counts);

  // Get completed and failed jobs
  const completedJobs = await queue.getJobs(['completed'], 0, 20, false);
  const failedJobs = await queue.getJobs(['failed'], 0, 20, false);

  console.log(`\nCompleted jobs count: ${completedJobs.length}`);
  completedJobs.forEach(job => {
    if (job.name === 'check_project_plan' || job.data?.runId) {
      console.log(`  - Job ID: ${job.id}, Name: ${job.name}, Status: Completed, Data:`, job.data);
    }
  });

  console.log(`\nFailed jobs count: ${failedJobs.length}`);
  failedJobs.forEach(job => {
    console.log(`  - Job ID: ${job.id}, Name: ${job.name}, Status: Failed, Error: ${job.failedReason}, Data:`, job.data);
  });

  await queue.close();
  await connection.quit();
}

main().catch(err => console.error(err));
