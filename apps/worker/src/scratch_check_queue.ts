import { Queue } from "bullmq"
import { connection } from "./lib/queue"

async function run() {
  const queue = new Queue("qa-jobs", { connection })

  console.log("Checking BullMQ qa-jobs queue...")

  const counts = await queue.getJobCounts()
  console.log("Job Counts:", counts)

  const active = await queue.getActive()
  console.log(`Active jobs count: ${active.length}`)
  for (const j of active) {
    console.log(`- ID: ${j.id}, Name: ${j.name}, Data: ${JSON.stringify(j.data)}`)
  }

  const waiting = await queue.getWaiting()
  console.log(`Waiting jobs count: ${waiting.length}`)
  for (const j of waiting) {
    console.log(`- ID: ${j.id}, Name: ${j.name}, Data: ${JSON.stringify(j.data)}`)
  }

  const failed = await queue.getFailed()
  console.log(`Failed jobs count: ${failed.length}`)
  for (const j of failed.slice(0, 5)) {
    console.log(`- ID: ${j.id}, Name: ${j.name}, Reason: ${j.failedReason}, Data: ${JSON.stringify(j.data)}`)
  }

  await queue.close()
  await connection.quit()
}

run().catch(console.error)
