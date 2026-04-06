import { describe, expect, it } from "vitest";
import { getProvider } from "../../src/providers/registry.js";

describe("provider registry", () => {
	it("getProvider returns undefined for unknown name", () => {
		expect(getProvider("unknown")).toBeUndefined();
	});
});
