import { Queue } from "bullmq"
import { connection } from "./lib/queue"

async function run() {
  const queue = new Queue("qa-jobs", { connection })
  const targetRunId = "c48e18fe-2261-4f7e-832b-76df9bb4162e"

  console.log(`Checking failed jobs for run: ${targetRunId}...`)

  const failed = await queue.getFailed()
  let found = false
  for (const j of failed) {
    if (JSON.stringify(j.data).includes(targetRunId)) {
      found = true
      console.log(`Failed Job: ID ${j.id}, Name: ${j.name}`)
      console.log(`- Reason: ${j.failedReason}`)
      console.log(`- Data: ${JSON.stringify(j.data)}`)
      console.log(`- Stack: ${j.stacktrace}`)
    }
  }

  if (!found) {
    console.log("No failed jobs found in BullMQ for this run ID.")
  }

  // Check completed jobs
  console.log(`\nChecking completed jobs for run: ${targetRunId}...`)
  const completed = await queue.getCompleted()
  let foundComp = false
  for (const j of completed) {
    if (JSON.stringify(j.data).includes(targetRunId)) {
      foundComp = true
      console.log(`Completed Job: ID ${j.id}, Name: ${j.name}, Data: ${JSON.stringify(j.data)}`)
    }
  }

  if (!foundComp) {
    console.log("No completed jobs found in BullMQ for this run ID.")
  }

  await queue.close()
  await connection.quit()
}

run().catch(console.error)
