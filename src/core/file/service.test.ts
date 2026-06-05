import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { useContainer, type FileService } from '@/core';
import { FileService as CoreFileService } from './service';

let tempPaths: string[] = [];

function tempPath(): string {
    const path = mkdtempSync(join(tmpdir(), 'flyflor-file-'));
    tempPaths.push(path);
    return path;
}

function useFile<T>(path: string): FileService<T> {
    return useContainer().create(CoreFileService, path) as FileService<T>;
}

afterEach(() => {
    for (const path of tempPaths) {
        rmSync(path, { recursive: true, force: true });
    }
    tempPaths = [];
});

describe('FileService', () => {
    test('loads prompt directories into data and prompt protocol blocks', () => {
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

        expect(file.data.SOUL).toBe('You are Flyflor.');
        expect(file.data.nested.USER).toBe('User rules.');
        expect(file.blocks.ask_policy?.payload.maxQuestions).toBe(3);
        expect(file.blocks.ask_policy?.body).toBe('Prefer concrete choices.');
        expect('SOUL.copy' in file.data).toBe(false);
    });

    test('throws when a prompt block is malformed', () => {
        const root = tempPath();
        writeFileSync(
            join(root, 'SOUL.md'),
            [
                'Before',
                '<flyflor:broken>',
                '{ version: }',
                '</flyflor:broken>',
                'After',
            ].join('\n'),
            'utf-8',
        );

        expect(() => useFile(root).reload()).toThrow("Prompt block 'broken' payload is invalid JSONC");
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
});
