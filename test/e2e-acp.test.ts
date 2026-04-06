import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	scanEnvironmentMock,
	createPrompterMock,
	ensureExtensionSymlinkMock,
	promptPermissionPolicyMock,
	buildMachineConfigMock,
	determineActionsMock,
	promptAndInstallMock,
	runAuthMock,
	writeMachineConfigMock,
	getProvidersMock,
} = vi.hoisted(() => ({
	scanEnvironmentMock: vi.fn(),
	createPrompterMock: vi.fn(),
	ensureExtensionSymlinkMock: vi.fn(),
	promptPermissionPolicyMock: vi.fn(),
	buildMachineConfigMock: vi.fn(),
	determineActionsMock: vi.fn(),
	promptAndInstallMock: vi.fn(),
	runAuthMock: vi.fn(),
	writeMachineConfigMock: vi.fn(),
	getProvidersMock: vi.fn(),
}));

vi.mock("../src/setup/environment.js", () => ({
	PACKAGE_ROOT: "/repo",
	MANAGED_TOOLS_ROOT: "/mock/managed/tools",
	scanEnvironment: scanEnvironmentMock,
}));

vi.mock("../src/setup/primitives.js", () => ({
	createPrompter: createPrompterMock,
	ensureExtensionSymlink: ensureExtensionSymlinkMock,
	promptPermissionPolicy: promptPermissionPolicyMock,
	buildMachineConfig: buildMachineConfigMock,
}));

vi.mock("../src/installer/index.js", () => ({
	determineActions: determineActionsMock,
	promptAndInstall: promptAndInstallMock,
	runAuth: runAuthMock,
}));

vi.mock("../src/config.js", () => ({
	writeMachineConfig: writeMachineConfigMock,
}));

vi.mock("../src/providers/registry.js", () => ({
	getProviders: getProvidersMock,
}));

import { runWizard } from "../src/setup/run-wizard.js";

describe("runWizard orchestration", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		scanEnvironmentMock.mockReset();
		createPrompterMock.mockReset();
		ensureExtensionSymlinkMock.mockReset();
		promptPermissionPolicyMock.mockReset();
		buildMachineConfigMock.mockReset();
		determineActionsMock.mockReset();
		promptAndInstallMock.mockReset();
		runAuthMock.mockReset();
		writeMachineConfigMock.mockReset();
		getProvidersMock.mockReset();
	});

	it("re-scans after install, authenticates, builds config from final live state, and closes the prompter", async () => {
		const logs: string[] = [];
		vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
			logs.push(String(message ?? ""));
		});

		const prompter = {
			ask: vi.fn().mockResolvedValue("n"),
			pause: vi.fn(),
			resume: vi.fn(),
			close: vi.fn(),
		};
		createPrompterMock.mockReturnValue(prompter);
		promptPermissionPolicyMock.mockResolvedValue("full");

		const initialReport = {
			prerequisites: {
				node: { ok: true, version: "v22.0.0" },
				npm: { ok: true, version: "10.0.0" },
				git: { ok: true, version: "2.0.0" },
				pi: { ok: true, version: "1.0.0" },
			},
			configs: {
				machineConfigPath: "/machine/config.json",
				machineConfigExists: false,
				projectConfigPath: "/repo/brainstorm.config.json",
				projectConfigExists: false,
			},
			extension: {
				symlinkPath: "/symlink",
				symlinked: false,
				targetOk: false,
			},
			providers: {
				gemini: {
					supported: true,
					installed: false,
					authenticated: false,
				},
			},
		};

		const postInstallReport = {
			...initialReport,
			providers: {
				gemini: {
					supported: true,
					resolved: { path: "/bin/gemini", source: "managed" as const },
					installed: true,
					authenticated: false,
					loginCommand: "gemini",
				},
			},
		};

		const finalReport = {
			...initialReport,
			extension: {
				symlinkPath: "/symlink",
				symlinked: true,
				targetOk: true,
				target: "/repo",
			},
			providers: {
				gemini: {
					supported: true,
					resolved: { path: "/bin/gemini", source: "managed" as const },
					installed: true,
					authenticated: true,
				},
			},
		};

		scanEnvironmentMock
			.mockResolvedValueOnce(initialReport)
			.mockResolvedValueOnce(postInstallReport)
			.mockResolvedValueOnce(finalReport);

		determineActionsMock
			.mockReturnValueOnce({
				install: [{ name: "gemini", label: "Gemini", spec: { kind: "npm", summary: "install gemini", command: "npm", args: ["install"], autoInstallable: true } }],
				auth: [],
				ready: [],
				unsupported: [],
				manual: [],
			})
			.mockReturnValueOnce({
				install: [],
				auth: [{ name: "gemini", label: "Gemini", loginCommand: "gemini", authCommand: { command: "gemini", args: [] } }],
				ready: [],
				unsupported: [],
				manual: [],
			});

		promptAndInstallMock.mockResolvedValue([{ provider: "gemini", action: "installed" }]);
		runAuthMock.mockReturnValue([{ provider: "gemini", action: "authenticated" }]);
		buildMachineConfigMock.mockReturnValue({
			version: 1,
			permissions: { defaultPolicy: "full" },
			agents: {
				gemini: {
					enabled: true,
					command: "/bin/gemini",
					commandSource: "managed",
					auth: { ok: true, checkedAt: "now" },
				},
			},
		});
		getProvidersMock.mockReturnValue([
			{
				name: "gemini",
				label: "Gemini",
				supportedPlatforms: () => [process.platform],
				getCliDependency: () => null,
				describePermissions: () => ({ notes: ["yolo"] }),
			},
		]);

		await runWizard();

		expect(scanEnvironmentMock).toHaveBeenCalledTimes(3);
		expect(promptAndInstallMock).toHaveBeenCalledTimes(1);
		expect(runAuthMock).toHaveBeenCalledTimes(1);
		expect(buildMachineConfigMock).toHaveBeenCalledWith(finalReport, "full", {});
		expect(writeMachineConfigMock).toHaveBeenCalledTimes(1);
		expect(ensureExtensionSymlinkMock).toHaveBeenCalledWith("/repo");
		expect(prompter.close).toHaveBeenCalledTimes(1);
		expect(logs.some((line) => line.includes("Config written to"))).toBe(true);
	});
});
