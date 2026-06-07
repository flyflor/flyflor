import { existsSync } from 'fs';
import { join } from 'path';
import { FPlugin, Plugin } from '@/core';
import { ROOT_PATH } from '@/config';
import type { InvestigationObservation, InvestigationObserveContext, InvestigationObserveRequest, InvestigationSourcePlugin, InvestigationToolDefinition, WorkspaceToolInput } from './tool.types';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30000;
const MAX_ARGS = 32;

@Plugin()
export class CodeGraphPlugin extends FPlugin implements InvestigationSourcePlugin {
    public readonly definition: InvestigationToolDefinition = {
        name: 'codegraph',
        description: 'Observe code structure, symbols, relations, and impact through local CodeGraph.',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string' },
                query: { type: 'string' },
                symbol: { type: 'string' },
                relation: { type: 'string' },
                timeoutMs: { type: 'number' },
            },
        },
    };

    public canObserve(request: InvestigationObserveRequest): boolean {
        return ['status', 'code_symbol', 'code_relation', 'code_impact', 'code_affected'].includes(request.kind);
    }

    public async observe(request: InvestigationObserveRequest, context: InvestigationObserveContext = { rootPath: ROOT_PATH }): Promise<InvestigationObservation> {
        const binary = this.binaryPath();
        if (!existsSync(binary)) {
            return this.failure('not_available', 'CodeGraph binary is not installed under ./plugins/codegraph');
        }
        try {
            this.next({ type: 'start', plugin: this.definition.name, data: { kind: request.kind } });
            if (request.kind !== 'status') {
                const initialized = await this.ensureInitialized(binary, context, this.timeoutMs(request.timeoutMs));
                if (!initialized.ok) return initialized;
            }
            const args = this.argsFor(request);
            const observation = await this.run(binary, args, this.timeoutMs(request.timeoutMs), context.rootPath);
            this.next({ type: 'end', plugin: this.definition.name, data: observation });
            return observation;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.next({ type: 'error', plugin: this.definition.name, error: error instanceof Error ? error : Error(message) });
            return this.failure('codegraph_failed', message);
        }
    }

    public async execute(input: unknown): Promise<InvestigationObservation> {
        const payload = this.payload(input);
        const args = this.args(payload.args);
        const binary = this.binaryPath();
        if (!existsSync(binary)) return this.failure('not_available', 'CodeGraph binary is not installed under ./plugins/codegraph');
        return this.run(binary, args, this.timeoutMs(payload.timeoutMs), ROOT_PATH);
    }

    protected binaryPath(): string {
        const executable = process.platform === 'win32' ? 'codegraph.exe' : 'codegraph';
        return join(ROOT_PATH, 'plugins', 'codegraph', 'bin', `${process.platform}-${process.arch}`, executable);
    }

    protected indexPath(context: InvestigationObserveContext): string {
        return join(context.rootPath, '.codegraph');
    }

    private payload(input: unknown): WorkspaceToolInput {
        return typeof input === 'object' && input !== null ? input as WorkspaceToolInput : {};
    }

    private args(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is string => typeof item === 'string').slice(0, MAX_ARGS);
    }

    private argsFor(request: InvestigationObserveRequest): string[] {
        if (request.kind === 'status') return ['status', '--json'];
        if (request.kind === 'code_symbol') return ['query', this.query(request), '--json'];
        if (request.kind === 'code_relation') return [request.relation === 'callees' ? 'callees' : 'callers', this.symbol(request), '--json'];
        if (request.kind === 'code_impact') return ['impact', this.symbol(request), '--json'];
        if (request.kind === 'code_affected') return ['affected', this.query(request), '--json'];
        throw Error(`CodeGraph cannot observe kind: ${request.kind}`);
    }

    private query(request: InvestigationObserveRequest): string {
        const value = request.query ?? request.symbol;
        if (value === undefined || value.trim().length === 0) throw Error(`${request.kind} requires query or symbol`);
        return value;
    }

    private symbol(request: InvestigationObserveRequest): string {
        const value = request.symbol ?? request.query;
        if (value === undefined || value.trim().length === 0) throw Error(`${request.kind} requires symbol`);
        return value;
    }

    private timeoutMs(value: unknown): number {
        return typeof value === 'number' && value > 0 ? Math.min(value, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    }

    private async ensureInitialized(binary: string, context: InvestigationObserveContext, timeoutMs: number): Promise<InvestigationObservation> {
        if (existsSync(this.indexPath(context))) {
            return {
                ok: true,
                source: this.definition.name,
                pipes: [],
                code: 'ok',
                summary: 'CodeGraph index exists',
                evidence: [],
            };
        }
        const result = await this.runCommand(binary, ['init', '-i'], timeoutMs, context.rootPath);
        if (!result.timedOut && result.code === 0) {
            return {
                ok: true,
                source: this.definition.name,
                pipes: [],
                code: 'ok',
                summary: 'CodeGraph initialized workspace index',
                evidence: [result.stdout].filter(Boolean),
                data: { stdout: result.stdout, stderr: result.stderr },
            };
        }
        return this.failure('init_failed', result.timedOut ? 'CodeGraph init timed out' : result.stderr || 'CodeGraph init failed');
    }

    protected async runCommand(binary: string, args: string[], timeoutMs: number, cwd: string): Promise<{ timedOut: boolean; code: number; stdout: string; stderr: string }> {
        const process = Bun.spawn([binary, ...args], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const stdout = new Response(process.stdout).text();
        const stderr = new Response(process.stderr).text();
        const exit = process.exited.then((code) => ({ timedOut: false, code }));
        const timeout = Bun.sleep(timeoutMs).then(() => ({ timedOut: true, code: -1 }));
        const result = await Promise.race([exit, timeout]);
        if (result.timedOut) process.kill();
        const [out, err] = await Promise.all([stdout, stderr]);
        return { timedOut: result.timedOut, code: result.code, stdout: out, stderr: err };
    }

    private async run(binary: string, args: string[], timeoutMs: number, cwd: string): Promise<InvestigationObservation> {
        const result = await this.runCommand(binary, args, timeoutMs, cwd);
        const parsed = this.parseJson(result.stdout);
        const ok = !result.timedOut && result.code === 0;
        return {
            ok,
            source: this.definition.name,
            pipes: [],
            code: result.timedOut ? 'timeout' : result.code === 0 ? 'ok' : 'command_failed',
            summary: result.timedOut ? 'CodeGraph command timed out' : `CodeGraph exited with code ${result.code}`,
            evidence: this.evidence(parsed, result.stdout),
            data: {
                args,
                stdout: result.stdout,
                stderr: result.stderr,
                parsed,
                exitCode: result.code,
            },
            error: ok ? undefined : result.stderr || 'CodeGraph command failed',
        };
    }

    private parseJson(value: string): unknown {
        if (value.trim().length === 0) return undefined;
        try {
            return JSON.parse(value) as unknown;
        } catch {
            return undefined;
        }
    }

    private evidence(parsed: unknown, stdout: string): string[] {
        if (parsed !== undefined) return [JSON.stringify(parsed)];
        return stdout.trim().length > 0 ? [stdout] : [];
    }

    private failure(code: string, message: string): InvestigationObservation {
        return {
            ok: false,
            source: this.definition.name,
            pipes: [],
            code,
            summary: message,
            evidence: [],
            error: message,
        };
    }
}
