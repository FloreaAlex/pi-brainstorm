import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

export interface SmokeTestOptions {
	command: string;
	args: string[];
	env: Record<string, string>;
	timeoutMs?: number;
}

function killProc(proc: ChildProcess): void {
	try { proc.kill("SIGKILL"); } catch {}
	try { proc.stdin?.destroy(); } catch {}
	try { proc.stdout?.destroy(); } catch {}
	try { proc.stderr?.destroy(); } catch {}
}

export async function acpSmokeTest(options: SmokeTestOptions): Promise<{ ok: boolean; error?: string }> {
	const { command, args, env, timeoutMs = 30_000 } = options;
	let proc: ChildProcess | null = null;
	const origErr = console.error;

	try {
		proc = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...env },
		});
		proc.stderr?.resume();

		// Detach so the child doesn't keep node alive
		proc.unref();

		const input = Writable.toWeb(proc.stdin!);
		const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
		const stream = acp.ndJsonStream(input, output);

		// Suppress ACP SDK noise (validation errors, non-JSON debug lines from bridges)
		console.error = (...a: unknown[]) => {
			const msg = String(a[0] ?? "");
			if (
				msg.includes("Error handling notification") ||
				msg.includes("Invalid params") ||
				msg.includes("Failed to parse JSON") ||
				msg.includes("is not valid JSON") ||
				msg.includes("ACP write error")
			) return;
			origErr(...a);
		};

		const connection = new acp.ClientSideConnection(
			() => ({
				requestPermission: async (params: any) => {
					const opts = params.options ?? [];
					return { outcome: { outcome: "selected", optionId: opts[0]?.id ?? "allow" } };
				},
				sessionUpdate: async () => {},
			}),
			stream,
		);

		const timeout = <T>(p: Promise<T>): Promise<T> =>
			Promise.race([
				p,
				new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Smoke test timed out")), timeoutMs)),
			]);

		const initResult = await timeout(
			connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
			}),
		);

		if (initResult.authMethods && initResult.authMethods.length > 0) {
			await timeout(connection.authenticate({ methodId: initResult.authMethods[0].id }));
		}

		const session = await timeout(connection.newSession({ cwd: process.cwd(), mcpServers: [] }));

		await timeout(
			connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text" as const, text: "reply OK" }],
			}),
		);

		return { ok: true };
	} catch (err) {
		let message: string;
		if (err instanceof Error) {
			message = err.message;
		} else if (typeof err === "string") {
			message = err;
		} else {
			try { message = JSON.stringify(err); } catch { message = "Unknown error"; }
		}
		return { ok: false, error: message };
	} finally {
		console.error = origErr;
		if (proc) killProc(proc);
	}
}
