import { processCrawlPageJob } from "./src/jobs/crawlPageJob";
import { Job } from "bullmq";
async function run() {
  const job = {
    data: {
      runId: "6a1f5ff6-d4b8-45e3-a691-dea982d5b17f",
      pageId: "f392bb39-41d1-47be-83ad-5fddebe93768",
      url: "https://auriacademy.gogroth.com/",
      projectId: "38b6de98-4450-4e97-ad46-efb8457bf7a5",
      enabledChecks: ["learn_more_buttons"]
    }
  } as unknown as Job;
  try {
    await processCrawlPageJob(job);
  } catch (e) {
    console.error("TEST FAILED:", e);
  }
}
run();
