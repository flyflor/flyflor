import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ROOT_PATH } from '@/config';
import { FService, Service } from '@/core';
import type { ToolExecutionContext } from '@/core';

@Service()
export class ToolBoundary extends FService {
    private readonly baseRoots = [
        realpathSync(ROOT_PATH),
        realpathSync(resolve(ROOT_PATH, '..', 'reference')),
    ];

    public resolve(path: string, context?: ToolExecutionContext): string {
        const detail = this.describe(path, context);
        const resolved = detail.resolved;
        if (!this.isAllowed(resolved, context)) {
            throw Object.assign(Error('Tool path is outside allowed research roots'), { detail });
        }
        return resolved;
    }

    public describe(path: string, context?: ToolExecutionContext): ToolBoundaryDescription {
        const workingDirectory = this.workingDirectory(context);
        const base = workingDirectory ?? realpathSync(ROOT_PATH);
        const resolved = isAbsolute(path) ? resolve(path) : resolve(base, path);
        return {
            path,
            resolved,
            workingDirectory,
            roots: this.roots(workingDirectory),
        };
    }

    public allowedRoots(context?: ToolExecutionContext): string[] {
        return this.roots(this.workingDirectory(context));
    }

    public isAllowed(path: string, context?: ToolExecutionContext): boolean {
        const normalized = existsSync(path) ? realpathSync(path) : resolve(path);
        return this.allowedRoots(context).some((root) => normalized === root || normalized.startsWith(root + '/'));
    }

    public repoRelative(path: string): string {
        const resolved = resolve(path);
        const root = realpathSync(ROOT_PATH);
        if (resolved === root) return '.';
        if (resolved.startsWith(root + '/')) return resolved.slice(root.length + 1);
        return resolved;
    }

    public referencePiRoot(): string {
        return join(realpathSync(resolve(ROOT_PATH, '..', 'reference')), 'pi');
    }

    public isFile(path: string): boolean {
        return existsSync(path) && statSync(path).isFile();
    }

    private workingDirectory(context?: ToolExecutionContext): string | undefined {
        const path = context?.workingDirectory;
        if (typeof path !== 'string' || path.trim().length === 0) {
            return undefined;
        }
        const resolved = isAbsolute(path) ? resolve(path) : resolve(ROOT_PATH, path);
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
            throw Object.assign(Error('Working directory is not a directory'), { detail: { path, resolved } });
        }
        return realpathSync(resolved);
    }

    private roots(workingDirectory?: string): string[] {
        return workingDirectory === undefined ? [...this.baseRoots] : [...this.baseRoots, workingDirectory];
    }
}

export interface ToolBoundaryDescription {
    path: string;
    resolved: string;
    workingDirectory?: string;
    roots: string[];
}
