import { existsSync, accessSync, constants } from "node:fs";
import { join, delimiter } from "node:path";

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
		const candidate = join(dir, cmd);
		try {
			if (existsSync(candidate)) {
				accessSync(candidate, constants.X_OK);
				return candidate;
			}
		} catch {
			// Not executable or no access — skip
		}
	}
	return null;
}
