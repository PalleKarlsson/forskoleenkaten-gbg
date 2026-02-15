/**
 * Full pipeline: crawl → download → parse → export.
 * Run: npm run sync
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function runStep(name: string, script: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Phase: ${name}`);
    console.log(`${"=".repeat(60)}\n`);

    const scriptPath = join(__dirname, script);
    const child = spawn("npx", ["tsx", scriptPath, ...args], {
      cwd: join(__dirname, ".."),
      env: process.env,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${name} exited with code ${code}`));
      } else {
        resolve();
      }
    });

    child.on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const yearArg = args.find((a) => /^\d{4}$/.test(a));
  const passArgs = yearArg ? [yearArg] : [];

  const start = Date.now();

  await runStep("Crawl", "crawler.ts", passArgs);
  await runStep("Download", "downloader.ts", passArgs);
  await runStep("Parse", "parser/index.ts", passArgs);
  await runStep("Export", "export.ts", passArgs);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nPipeline complete in ${elapsed}s`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
