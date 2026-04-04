import { lstatSync, existsSync, readlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getProviders } from "../providers/registry.js";
import type {
	ProviderInstallSpec,
	ResolveContext,
	ResolvedCommand,
} from "../providers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = resolve(__dirname, "..", "..");
export const MANAGED_TOOLS_ROOT = join(homedir(), ".pi", "brainstorm", "tools");
export const MACHINE_CONFIG_PATH = join(homedir(), ".pi", "brainstorm", "config.json");
export const SYMLINK_PATH = join(homedir(), ".pi", "agent", "extensions", "pi-brainstorm");

export interface EnvironmentReport {
	prerequisites: {
		node: { ok: boolean; version?: string };
		npm: { ok: boolean; version?: string };
		git: { ok: boolean; version?: string };
		pi: { ok: boolean; version?: string };
	};
	configs: {
		machineConfigPath: string;
		machineConfigExists: boolean;
		projectConfigPath: string;
		projectConfigExists: boolean;
	};
	extension: {
		symlinkPath: string;
		symlinked: boolean;
		targetOk: boolean;
		target?: string;
	};
	providers: Record<string, {
		supported: boolean;
		resolved?: ResolvedCommand;
		installed: boolean;
		authenticated: boolean;
		authError?: string;
		installSpec?: ProviderInstallSpec | null;
		loginCommand?: string;
	}>;
}

function quoteArg(arg: string): string {
	return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args].map(quoteArg).join(" ");
}

function resolveVersion(command: string, args: string[] = ["--version"]): { ok: boolean; version?: string } {
	const result = spawnSync(command, args, {
		encoding: "utf-8",
		timeout: 10_000,
	});

	if (result.status !== 0) {
		return { ok: false };
	}

	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
		.trim()
		.split(/\r?\n/)
		.find(Boolean);

	if (!output) {
		return { ok: true };
	}

	return { ok: true, version: output };
}

function scanExtension(packageRoot: string): EnvironmentReport["extension"] {
	if (!existsSync(SYMLINK_PATH)) {
		return {
			symlinkPath: SYMLINK_PATH,
			symlinked: false,
			targetOk: false,
		};
	}

	try {
		const stat = lstatSync(SYMLINK_PATH);
		if (!stat.isSymbolicLink()) {
			return {
				symlinkPath: SYMLINK_PATH,
				symlinked: false,
				targetOk: false,
			};
		}

		const target = resolve(dirname(SYMLINK_PATH), readlinkSync(SYMLINK_PATH));
		return {
			symlinkPath: SYMLINK_PATH,
			symlinked: true,
			targetOk: resolve(target) === resolve(packageRoot),
			target,
		};
	} catch {
		return {
			symlinkPath: SYMLINK_PATH,
			symlinked: false,
			targetOk: false,
		};
	}
}

export function createResolveContext(overrides?: Partial<ResolveContext>): ResolveContext {
	return {
		packageRoot: overrides?.packageRoot ?? PACKAGE_ROOT,
		managedToolsRoot: overrides?.managedToolsRoot ?? MANAGED_TOOLS_ROOT,
	};
}

export async function scanEnvironment(options?: {
	cwd?: string;
	packageRoot?: string;
	managedToolsRoot?: string;
}): Promise<EnvironmentReport> {
	const cwd = options?.cwd ?? process.cwd();
	const context = createResolveContext({
		packageRoot: options?.packageRoot,
		managedToolsRoot: options?.managedToolsRoot,
	});

	const report: EnvironmentReport = {
		prerequisites: {
			node: resolveVersion("node"),
			npm: resolveVersion("npm"),
			git: resolveVersion("git"),
			pi: resolveVersion("pi"),
		},
		configs: {
			machineConfigPath: MACHINE_CONFIG_PATH,
			machineConfigExists: existsSync(MACHINE_CONFIG_PATH),
			projectConfigPath: join(cwd, "brainstorm.config.json"),
			projectConfigExists: existsSync(join(cwd, "brainstorm.config.json")),
		},
		extension: scanExtension(context.packageRoot),
		providers: {},
	};

	for (const provider of getProviders()) {
		const supported = provider.supportedPlatforms().includes(process.platform);
		const installSpec = supported ? provider.getInstallSpec(process.platform, context) : null;

		if (!supported) {
			report.providers[provider.name] = {
				supported: false,
				installed: false,
				authenticated: false,
				installSpec,
			};
			continue;
		}

		const resolved = await provider.resolveCommand(context);
		if (!resolved) {
			report.providers[provider.name] = {
				supported: true,
				installed: false,
				authenticated: false,
				installSpec,
			};
			continue;
		}

		const authCommand = provider.getAuthCommand(resolved.path);
		try {
			const auth = await provider.checkAuth(resolved.path);
			report.providers[provider.name] = {
				supported: true,
				resolved,
				installed: true,
				authenticated: auth.ok,
				authError: auth.error,
				installSpec,
				loginCommand: formatCommand(authCommand.command, authCommand.args),
			};
		} catch (err) {
			report.providers[provider.name] = {
				supported: true,
				resolved,
				installed: true,
				authenticated: false,
				authError: err instanceof Error ? err.message : String(err),
				installSpec,
				loginCommand: formatCommand(authCommand.command, authCommand.args),
			};
		}
	}

	return report;
}
