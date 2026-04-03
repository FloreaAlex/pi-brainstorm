import { describe, expect, it } from "vitest";
import { getProviders, getProvider } from "../../src/providers/registry.js";

describe("provider registry", () => {
	it("returns all three built-in providers", () => {
		const providers = getProviders();
		const names = providers.map((p) => p.name);
		expect(names).toContain("claude");
		expect(names).toContain("codex");
		expect(names).toContain("gemini");
		expect(providers).toHaveLength(3);
	});

	it("getProvider returns a provider by name", () => {
		const claude = getProvider("claude");
		expect(claude).toBeDefined();
		expect(claude!.name).toBe("claude");
	});

	it("getProvider returns undefined for unknown name", () => {
		expect(getProvider("unknown")).toBeUndefined();
	});
});
