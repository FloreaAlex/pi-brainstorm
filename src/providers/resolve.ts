import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import type { ResolveContext, ResolvedCommand } from "./types.js";

function isExecutable(candidate: string, platform: NodeJS.Platform): boolean {
	if (!existsSync(candidate)) {
		return false;
	}

	if (platform === "win32") {
		return true;
	}

	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export function commandCandidates(
	command: string,
	platform: NodeJS.Platform = process.platform,
	pathExt = process.env.PATHEXT,
): string[] {
	if (platform !== "win32" || extname(command) !== "") {
		return [command];
	}

	const extensions = (pathExt ?? ".COM;.EXE;.BAT;.CMD")
		.split(";")
		.map((ext) => ext.trim())
		.filter(Boolean);

	return [command, ...extensions.map((ext) => `${command}${ext.toLowerCase()}`)];
}

export function findInDirectory(
	dir: string,
	command: string,
	platform: NodeJS.Platform = process.platform,
): string | null {
	for (const candidateName of commandCandidates(command, platform)) {
		const candidate = join(dir, candidateName);
		if (isExecutable(candidate, platform)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Find an executable on PATH by searching process.env.PATH directly.
 *
 * This avoids spawning a shell (which may not have the user's full PATH
 * when running inside pi, npm scripts, or non-interactive contexts).
 */
export function findOnPath(cmd: string): string | null {
	const pathEnv = process.env.PATH ?? "";
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue;
		const candidate = findInDirectory(dir, cmd);
		if (candidate) {
			return candidate;
		}
	}
	return null;
}

export function resolveManagedCommand(command: string, context: ResolveContext): ResolvedCommand | null {
	const managedNpmBin = findInDirectory(join(context.managedToolsRoot, "node_modules", ".bin"), command);
	if (managedNpmBin) {
		return { path: managedNpmBin, source: "managed" };
	}

	const managedBin = findInDirectory(join(context.managedToolsRoot, "bin"), command);
	if (managedBin) {
		return { path: managedBin, source: "managed" };
	}

	return null;
}

export function resolvePackageCommand(command: string, context: ResolveContext): ResolvedCommand | null {
	const localBin = findInDirectory(join(context.packageRoot, "node_modules", ".bin"), command);
	if (localBin) {
		return { path: localBin, source: "node_modules" };
	}

	return null;
}
