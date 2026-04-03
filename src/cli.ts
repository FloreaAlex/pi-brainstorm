#!/usr/bin/env node
import { runSetup } from "./setup/wizard.js";
import { runDoctor } from "./setup/doctor.js";

const command = process.argv[2];

switch (command) {
	case "setup":
		await runSetup();
		break;
	case "doctor":
		await runDoctor({ json: process.argv.includes("--json") });
		break;
	default:
		console.log("pi-brainstorm CLI");
		console.log("");
		console.log("Usage:");
		console.log("  npm run setup     Setup extension, detect providers, write config");
		console.log("  npm run doctor    Run diagnostics");
		console.log("");
		console.log("Or directly:");
		console.log("  node dist/cli.js setup");
		console.log("  node dist/cli.js doctor");
		console.log("  node dist/cli.js doctor --json");
		process.exit(command ? 1 : 0);
}
