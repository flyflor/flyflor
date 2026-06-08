import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { useContainer, type FileNode, type FileService } from '@/core';
import { FileService as CoreFileService } from './service';

let tempPaths: string[] = [];

function tempPath(): string {
    const path = mkdtempSync(join(tmpdir(), 'flyflor-file-'));
    tempPaths.push(path);
    return path;
}

function useFile<T>(path: string): FileNode<T> {
    return useContainer().create(CoreFileService, path) as FileNode<T>;
}

afterEach(() => {
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('FileService', () => {
    test('loads canonical markdown files from directories', () => {
        const root = tempPath();
        writeFileSync(
            join(root, 'SOUL.md'),
            [
                '<flyflor:ask_policy>',
                '{',
                '    // JSONC is allowed',
                '    version: 1,',
                '    enabled: true,',
                '    maxQuestions: 3,',
                '}',
                'Prefer concrete choices.',
                '</flyflor:ask_policy>',
                'You are Flyflor.',
            ].join('\n'),
            'utf-8',
        );
        writeFileSync(join(root, 'SOUL.copy.md'), 'human mirror only', 'utf-8');
        mkdirSync(join(root, 'nested'));
        writeFileSync(join(root, 'nested', 'USER.md'), 'User rules.', 'utf-8');

        const file = useFile<{ SOUL: string; nested: { USER: string } }>(root).reload();

        expect(file.SOUL).toBeInstanceOf(CoreFileService);
        expect(file.SOUL.data).toContain('<flyflor:ask_policy>');
        expect(file.SOUL.data).toContain('You are Flyflor.');
        expect(file.nested.USER.data).toBe('User rules.');
        expect(file.children['SOUL.copy']?.data).toBe('human mirror only');
    });

    test('supports create update upsert delete and eager reload for files', () => {
        const root = tempPath();
        const path = join(root, 'runtime.md');
        const file = useFile<string>(path);

        expect(file.exists()).toBe(false);
        file.create('first');
        expect(file.exists()).toBe(true);
        expect(file.data).toBe('first');
        expect(() => file.create('again')).toThrow('File already exists');

        file.update('second');
        expect(file.data).toBe('second');

        file.upsert('third');
        expect(file.data).toBe('third');

        file.delete();
        expect(file.exists()).toBe(false);
        expect(() => file.update('missing')).toThrow('File does not exist');
    });

    test('loads single jsonc files as structured data', () => {
        const root = tempPath();
        const path = join(root, 'config.jsonc');
        writeFileSync(path, '{ version: 1, name: "flyflor" }', 'utf-8');

        const file = useFile<{ version: number; name: string }>(path).reload();

        expect(file.data).toEqual({ version: 1, name: 'flyflor' });
    });

});
