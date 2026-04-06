#!/usr/bin/env node
import { runSetup } from "./setup/wizard.js";
import { runDoctor } from "./setup/doctor.js";
import { runWizard } from "./setup/run-wizard.js";

const command = process.argv[2];

try {
	switch (command) {
		case "wizard":
			await runWizard();
			break;
		case "setup":
			await runSetup();
			break;
		case "doctor": {
			const result = await runDoctor({ json: process.argv.includes("--json") });
			if (!result.ok) process.exit(1);
			break;
		}
		default:
			console.log("pi-brainstorm CLI");
			console.log("");
			console.log("Usage:");
			console.log("  npm run wizard    Full provisioning flow");
			console.log("  npm run setup     Setup extension, detect providers, write config");
			console.log("  npm run doctor    Run diagnostics");
			console.log("");
			console.log("Or directly:");
			console.log("  node dist/cli.js wizard");
			console.log("  node dist/cli.js setup");
			console.log("  node dist/cli.js doctor");
			console.log("  node dist/cli.js doctor --json");
			process.exit(command ? 1 : 0);
	}
	process.exit(0);
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
}
