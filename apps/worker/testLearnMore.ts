import { checkLearnMoreButtons } from "./src/checks/learnMoreButtonsCheck";
async function run() {
  const findings = await checkLearnMoreButtons("https://auriacademy.gogroth.com/", "test-run", "test-page");
  console.log(JSON.stringify(findings, null, 2));
}
run();
