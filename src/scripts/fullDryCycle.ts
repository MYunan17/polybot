import { spawn } from "node:child_process";

const steps = ["dry-run", "seed", "mirofish", "paper"];

async function runStep(scriptName: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", scriptName], {
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

void (async () => {
  const summary: Array<{ step: string; exitCode: number }> = [];
  for (const step of steps) {
    const code = await runStep(step);
    summary.push({ step, exitCode: code });
    if (code !== 0) {
      console.log(`[full-dry-cycle] step '${step}' failed with code ${code}, continuing.`);
    }
  }
  console.log("[full-dry-cycle] summary:");
  for (const item of summary) {
    console.log(`- ${item.step}: ${item.exitCode === 0 ? "ok" : `failed(${item.exitCode})`}`);
  }
})();
