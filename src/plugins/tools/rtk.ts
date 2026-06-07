import { existsSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { FPlugin, Plugin } from '@/core';
import { ROOT_PATH } from '@/config';
import type { InvestigationObservation, InvestigationObserveContext, InvestigationObserveRequest, InvestigationPipePlugin, WorkspaceToolInput } from './tool.types';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30000;
const MAX_ARGS = 32;

@Plugin()
export class RtkPlugin extends FPlugin implements InvestigationPipePlugin {
    public readonly name = 'rtk';

    public canPipe(request: InvestigationObserveRequest): boolean {
        return ['file', 'files', 'search'].includes(request.kind);
    }

    public async pipeObservation(
        next: () => Promise<InvestigationObservation>,
        request: InvestigationObserveRequest,
        context: InvestigationObserveContext,
    ): Promise<InvestigationObservation> {
        const binary = this.binaryPath();
        if (!existsSync(binary)) {
            return this.annotate(await next(), 'pipe_missing', 'RTK binary is not installed under ./plugins/rtk');
        }
        if (!this.canPipe(request)) return next();

        let args: string[];
        try {
            args = this.argsFor(request, context);
        } catch (error) {
            return this.annotate(await next(), 'pipe_rejected', error instanceof Error ? error.message : String(error));
        }

        const result = await this.run(binary, args, this.timeoutMs(request.timeoutMs));
        if (!result.ok) {
            return this.annotate(await next(), 'pipe_failed', result.error ?? result.summary);
        }
        return result;
    }

    public async execute(input: unknown): Promise<InvestigationObservation> {
        const payload = this.payload(input);
        const binary = this.binaryPath();
        if (!existsSync(binary)) {
            return this.failure('not_available', 'RTK binary is not installed under ./plugins/rtk');
        }
        return this.run(binary, this.args(payload.args), this.timeoutMs(payload.timeoutMs));
    }

    protected binaryPath(): string {
        const executable = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
        return join(ROOT_PATH, 'plugins', 'rtk', 'bin', `${process.platform}-${process.arch}`, executable);
    }

    private payload(input: unknown): WorkspaceToolInput {
        return typeof input === 'object' && input !== null ? input as WorkspaceToolInput : {};
    }

    private argsFor(request: InvestigationObserveRequest, context: InvestigationObserveContext): string[] {
        if (request.kind === 'file') {
            if (request.path === undefined) throw Error('rtk read requires path');
            return ['read', this.workspaceRelative(context.rootPath, request.path)];
        }
        if (request.kind === 'files') {
            const pattern = request.query ?? request.path ?? '**/*';
            const root = this.workspaceRelative(context.rootPath, request.path ?? '.');
            return ['find', pattern, root];
        }
        if (request.kind === 'search') {
            if (request.query === undefined) throw Error('rtk grep requires query');
            const root = this.workspaceRelative(context.rootPath, request.path ?? '.');
            return ['grep', request.query, root];
        }
        throw Error(`RTK cannot pipe observation kind: ${request.kind}`);
    }

    private workspaceRelative(rootPath: string, path: string): string {
        const root = resolve(rootPath);
        const absolute = resolve(root, path);
        const relativePath = relative(root, absolute);
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
            throw Error(`Path escapes workspace: ${path}`);
        }
        return relativePath.length === 0 ? '.' : relativePath;
    }

    private args(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is string => typeof item === 'string').slice(0, MAX_ARGS);
    }

    private timeoutMs(value: unknown): number {
        return typeof value === 'number' && value > 0 ? Math.min(value, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    }

    protected async runCommand(binary: string, args: string[], timeoutMs: number): Promise<{ timedOut: boolean; code: number; stdout: string; stderr: string }> {
        const process = Bun.spawn([binary, ...args], {
            cwd: ROOT_PATH,
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

    private async run(binary: string, args: string[], timeoutMs: number): Promise<InvestigationObservation> {
        const result = await this.runCommand(binary, args, timeoutMs);
        const ok = !result.timedOut && result.code === 0;
        return {
            ok,
            source: 'rtk',
            pipes: [this.name],
            code: result.timedOut ? 'timeout' : result.code === 0 ? 'ok' : 'command_failed',
            summary: result.timedOut ? 'RTK command timed out' : `RTK exited with code ${result.code}`,
            evidence: result.stdout.length > 0 ? [result.stdout] : [],
            data: {
                args,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.code,
            },
            error: ok ? undefined : result.stderr || 'RTK command failed',
        };
    }

    private annotate(observation: InvestigationObservation, code: string, message: string): InvestigationObservation {
        return {
            ...observation,
            data: {
                ...(this.isRecord(observation.data) ? observation.data : {}),
                pipe_status: {
                    name: this.name,
                    code,
                    message,
                },
            },
        };
    }

    private failure(code: string, message: string): InvestigationObservation {
        return {
            ok: false,
            source: 'rtk',
            pipes: [],
            code,
            summary: message,
            evidence: [],
            error: message,
        };
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
