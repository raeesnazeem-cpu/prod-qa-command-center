import { checkPrivacyPolicy } from "./src/checks/preReleaseSuite";
import { chromium } from "playwright";

async function test() {
  const browser = await chromium.launch({ headless: true });
  try {
    console.log("Running checkPrivacyPolicy...");
    const findings = await checkPrivacyPolicy("https://google.com", "test-run-id", "test-page-id", browser);
    console.log("Findings:", JSON.stringify(findings, null, 2));
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await browser.close();
  }
}

test();
