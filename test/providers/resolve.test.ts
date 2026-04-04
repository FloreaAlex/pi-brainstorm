import { describe, expect, it } from "vitest";
import { commandCandidates } from "../../src/providers/resolve.js";

describe("commandCandidates", () => {
	it("adds PATHEXT variants on Windows", () => {
		expect(commandCandidates("gemini", "win32", ".EXE;.CMD")).toEqual([
			"gemini",
			"gemini.exe",
			"gemini.cmd",
		]);
	});

	it("does not duplicate extensions when the command already has one", () => {
		expect(commandCandidates("gemini.cmd", "win32", ".EXE;.CMD")).toEqual(["gemini.cmd"]);
	});

	it("leaves POSIX commands unchanged", () => {
		expect(commandCandidates("gemini", "linux")).toEqual(["gemini"]);
	});
});
