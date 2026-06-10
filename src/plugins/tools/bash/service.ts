import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';
import { DEFAULT_TIMEOUT_MS, MAX_OUTPUT_BYTES, MAX_TIMEOUT_MS } from './constants';
import type { BashShell } from './types';

@Tool()
export class BashTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'bash',
        title: 'Execute command',
        description: 'Execute an operating-system command in the workspace using the current platform shell.',
        capability: 'process.exec',
        destructive: true,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string' },
                cwd: { type: 'string' },
                timeoutMs: { type: 'number' },
                shell: { type: 'string', enum: ['auto', 'bash', 'zsh', 'sh', 'powershell', 'cmd'] },
            },
            required: ['command'],
        },
    };

    public async execute(input: unknown, context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        try {
            this.start(payload);
            if (typeof payload.command !== 'string' || payload.command.trim().length === 0) {
                return this.failure('invalid_input', 'bash requires a non-empty command');
            }
            const cwd = payload.cwd === undefined ? context.rootPath : WorkspaceTool.workspacePath(context.rootPath, payload.cwd);
            if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return this.failure('invalid_cwd', `cwd is not a directory: ${String(payload.cwd)}`);
            const shell = this.shell(payload.shell);
            const timeoutMs = WorkspaceTool.boundedNumber(payload.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
            const result = await this.run(payload.command, cwd, shell, timeoutMs, context);
            const summary = result.timedOut ? `Command timed out after ${timeoutMs}ms` : `Command exited ${result.exitCode}`;
            const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
            const toolResult: ToolOutput = {
                ok: result.exitCode === 0 && !result.timedOut,
                code: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'ok' : 'non_zero_exit',
                summary,
                output,
                data: {
                    command: payload.command,
                    cwd,
                    shell: result.shell,
                    args: result.args,
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    timedOut: result.timedOut,
                    durationMs: result.durationMs,
                    platform: context.environment.platform,
                },
                error: result.exitCode === 0 && !result.timedOut ? undefined : summary,
                truncated: result.truncated,
            };
            this.end(toolResult);
            return toolResult;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.fail(error instanceof Error ? error : Error(message));
            return this.failure('bash_failed', message);
        }
    }

    private shell(value: unknown): BashShell {
        return ['auto', 'bash', 'zsh', 'sh', 'powershell', 'cmd'].includes(String(value)) ? String(value) as BashShell : 'auto';
    }

    private command(shell: BashShell, context: ToolContext, command: string): { file: string; args: string[] } {
        if (context.environment.os === 'windows') {
            if (shell === 'powershell') return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] };
            return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command] };
        }
        if (shell === 'bash') return { file: '/bin/bash', args: ['-lc', command] };
        if (shell === 'zsh') return { file: '/bin/zsh', args: ['-lc', command] };
        if (shell === 'sh') return { file: '/bin/sh', args: ['-lc', command] };
        return { file: context.environment.defaultShell, args: ['-lc', command] };
    }

    private async run(command: string, cwd: string, shell: BashShell, timeoutMs: number, context: ToolContext): Promise<{
        shell: string;
        args: string[];
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
        durationMs: number;
        truncated: boolean;
    }> {
        const resolved = this.command(shell, context, command);
        const started = Date.now();
        return await new Promise((resolve) => {
            const child = spawn(resolved.file, resolved.args, { cwd, windowsHide: true });
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            let stdoutBytes = 0;
            let stderrBytes = 0;
            let truncated = false;
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, timeoutMs);
            child.stdout.on('data', (chunk: Buffer) => {
                const accepted = this.acceptChunk(chunk, stdoutBytes);
                stdoutBytes += accepted.length;
                if (accepted.length < chunk.length) truncated = true;
                if (accepted.length > 0) stdout.push(accepted);
            });
            child.stderr.on('data', (chunk: Buffer) => {
                const accepted = this.acceptChunk(chunk, stderrBytes);
                stderrBytes += accepted.length;
                if (accepted.length < chunk.length) truncated = true;
                if (accepted.length > 0) stderr.push(accepted);
            });
            child.on('error', (error) => {
                clearTimeout(timer);
                resolve({
                    shell: resolved.file,
                    args: resolved.args,
                    exitCode: 1,
                    stdout: Buffer.concat(stdout).toString('utf8'),
                    stderr: error.message,
                    timedOut,
                    durationMs: Date.now() - started,
                    truncated,
                });
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                resolve({
                    shell: resolved.file,
                    args: resolved.args,
                    exitCode: code,
                    stdout: Buffer.concat(stdout).toString('utf8'),
                    stderr: Buffer.concat(stderr).toString('utf8'),
                    timedOut,
                    durationMs: Date.now() - started,
                    truncated,
                });
            });
        });
    }

    private acceptChunk(chunk: Buffer, currentBytes: number): Buffer {
        const remaining = MAX_OUTPUT_BYTES - currentBytes;
        if (remaining <= 0) return Buffer.alloc(0);
        return chunk.subarray(0, remaining);
    }
}
