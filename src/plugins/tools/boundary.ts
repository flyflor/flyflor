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
        const absolute = isAbsolute(path);
        const workingDirectory = this.workingDirectory(context, !absolute);
        const base = workingDirectory ?? realpathSync(ROOT_PATH);
        const resolved = isAbsolute(path) ? resolve(path) : resolve(base, path);
        return {
            path,
            resolved,
            ...(workingDirectory !== undefined ? { workingDirectory } : {}),
            roots: this.roots(workingDirectory, context),
        };
    }

    public allowedRoots(context?: ToolExecutionContext): string[] {
        return this.roots(this.workingDirectory(context, false), context);
    }

    public isAllowed(path: string, context?: ToolExecutionContext): boolean {
        const normalized = this.normalizePath(path);
        if (normalized === undefined) return false;
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

    public isDirectory(path: string): boolean {
        return existsSync(path) && statSync(path).isDirectory();
    }

    public workingRoot(context?: ToolExecutionContext): string {
        return this.workingDirectory(context, false) ?? realpathSync(ROOT_PATH);
    }

    public toolRoots(context?: ToolExecutionContext): string[] {
        const roots: string[] = [];
        for (const path of context?.toolRoots ?? []) {
            if (typeof path !== 'string' || path.trim().length === 0) continue;
            const resolved = isAbsolute(path) ? resolve(path) : resolve(ROOT_PATH, path);
            if (!existsSync(resolved)) continue;
            const real = realpathSync(resolved);
            if (!roots.includes(real)) roots.push(real);
        }
        return roots;
    }

    private workingDirectory(context?: ToolExecutionContext, strict = false): string | undefined {
        const path = context?.workingDirectory;
        if (typeof path !== 'string' || path.trim().length === 0) {
            return undefined;
        }
        const resolved = isAbsolute(path) ? resolve(path) : resolve(ROOT_PATH, path);
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
            if (!strict) return undefined;
            throw Object.assign(Error('Working directory is not a directory'), { detail: { path, resolved } });
        }
        return realpathSync(resolved);
    }

    private roots(workingDirectory?: string, context?: ToolExecutionContext): string[] {
        const roots = workingDirectory === undefined ? [...this.baseRoots] : [...this.baseRoots, workingDirectory];
        for (const root of this.toolRoots(context)) {
            if (!roots.includes(root)) roots.push(root);
        }
        return roots;
    }

    private normalizePath(path: string): string | undefined {
        if (!existsSync(path)) return resolve(path);
        try {
            return realpathSync(path);
        } catch {
            return undefined;
        }
    }
}

export interface ToolBoundaryDescription {
    path: string;
    resolved: string;
    workingDirectory?: string;
    roots: string[];
}
