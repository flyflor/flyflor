import { closeSync, existsSync, openSync, readSync, statSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { FPlugin, Plugin } from '@/core';
import { ROOT_PATH } from '@/config';
import type { InvestigationObservation, InvestigationObserveContext, InvestigationObserveRequest, InvestigationSourcePlugin, InvestigationToolDefinition, WorkspaceToolInput } from './tool.types';

const DEFAULT_MAX_BYTES = 32768;

@Plugin()
export class ReadFilePlugin extends FPlugin implements InvestigationSourcePlugin {
    public readonly definition: InvestigationToolDefinition = {
        name: 'read_file',
        description: 'Read one UTF-8 text file inside the workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                maxBytes: { type: 'number' },
            },
            required: ['path'],
        },
    };

    public canObserve(request: InvestigationObserveRequest): boolean {
        return request.kind === 'file';
    }

    public async observe(request: InvestigationObserveRequest, context: InvestigationObserveContext = { rootPath: ROOT_PATH }): Promise<InvestigationObservation> {
        if (typeof request.path !== 'string' || request.path.trim().length === 0) {
            return this.failure('invalid_input', 'read_file requires a non-empty path');
        }

        try {
            this.next({ type: 'start', plugin: this.definition.name, data: { path: request.path } });
            const path = this.workspacePath(context.rootPath, request.path);
            if (!existsSync(path)) return this.failure('not_found', `File not found: ${request.path}`);
            const stat = statSync(path);
            if (!stat.isFile()) return this.failure('not_file', `Path is not a file: ${request.path}`);
            const maxBytes = this.maxBytes(request.maxBytes);
            const content = this.read(path, stat.size, maxBytes);
            const relativePath = relative(context.rootPath, path);
            const observation = {
                ok: true,
                source: this.definition.name,
                pipes: [],
                code: 'ok',
                summary: `Read ${relativePath}${content.truncated ? ' (truncated)' : ''}`,
                evidence: [content.value],
                data: {
                    path: relativePath,
                    content: content.value,
                },
                truncated: content.truncated,
            };
            this.next({ type: 'end', plugin: this.definition.name, data: observation });
            return observation;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.next({ type: 'error', plugin: this.definition.name, error: error instanceof Error ? error : Error(message) });
            return this.failure('read_failed', message);
        }
    }

    public async execute(input: unknown): Promise<InvestigationObservation> {
        const payload = this.payload(input);
        return this.observe({
            goal: 'read file',
            kind: 'file',
            path: typeof payload.path === 'string' ? payload.path : undefined,
            maxBytes: typeof payload.maxBytes === 'number' ? payload.maxBytes : undefined,
        });
    }

    private payload(input: unknown): WorkspaceToolInput {
        return typeof input === 'object' && input !== null ? input as WorkspaceToolInput : {};
    }

    private workspacePath(rootPath: string, path: string): string {
        const root = resolve(rootPath);
        const absolute = resolve(root, path);
        const relativePath = relative(root, absolute);
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
            throw Error(`Path escapes workspace: ${path}`);
        }
        return absolute;
    }

    private maxBytes(value: unknown): number {
        return typeof value === 'number' && value > 0 ? Math.min(value, DEFAULT_MAX_BYTES) : DEFAULT_MAX_BYTES;
    }

    private read(path: string, size: number, maxBytes: number): { value: string; truncated: boolean } {
        const bytesToRead = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(bytesToRead);
        const fd = openSync(path, 'r');
        try {
            const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
            const view = buffer.subarray(0, bytesRead);
            if (view.includes(0)) {
                throw Error('File appears to be binary');
            }
            return {
                value: view.toString('utf8'),
                truncated: size > maxBytes,
            };
        } finally {
            closeSync(fd);
        }
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
