import { existsSync, statSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';

type StringRecord = Record<string, unknown>;

export class WorkspaceTool {
    public static inputRecord(input: unknown): StringRecord {
        return typeof input === 'object' && input !== null ? input as StringRecord : {};
    }

    public static workspacePath(rootPath: string, path: unknown): string {
        if (typeof path !== 'string' || path.trim().length === 0) {
            throw Error('path must be a non-empty string');
        }
        const root = resolve(rootPath);
        const absolute = resolve(root, path);
        const relativePath = relative(root, absolute);
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
            throw Error(`Path escapes workspace: ${path}`);
        }
        return absolute;
    }

    public static workspaceRelative(rootPath: string, path: string): string {
        return relative(resolve(rootPath), resolve(path));
    }

    public static isWorkspaceFile(rootPath: string, path: string): boolean {
        const root = resolve(rootPath);
        const absolute = resolve(path);
        const relativePath = relative(root, absolute);
        return !relativePath.startsWith('..') && !isAbsolute(relativePath) && existsSync(absolute) && statSync(absolute).isFile();
    }

    public static boundedNumber(value: unknown, fallback: number, max: number): number {
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
    }
}
