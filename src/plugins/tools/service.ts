import { FService, Service } from '@/core';
import type { AgentToolCall } from '@/agent/memory';
import type { IntelligenceToolDefinition } from '@/agent/brain/intelligence/types';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

@Service()
export class Tools extends FService {
    public list(): IntelligenceToolDefinition[] {
        return [
            { name: 'read_file', description: 'Read a text file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
            { name: 'write_file', description: 'Write a text file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
            { name: 'edit_file', description: 'Replace text in a file once.', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } },
            { name: 'remove_file', description: 'Remove a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
            { name: 'shell', description: 'Run a shell command.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
            { name: 'ask', description: 'Ask the user an open question.', parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array' } }, required: ['question', 'options'] } },
            { name: 'confirm', description: 'Ask the user for yes/no confirmation.', parameters: { type: 'object', properties: { question: { type: 'string' }, recommended: { type: 'boolean' } }, required: ['question', 'recommended'] } },
        ];
    }

    public async run(call: AgentToolCall): Promise<{ ok: boolean; name: string; data?: unknown; error?: string }> {
        try {
            let data: unknown;
            if (call.name === 'read_file') data = this.read(call.arguments);
            else if (call.name === 'write_file') data = this.write(call.arguments);
            else if (call.name === 'edit_file') data = this.edit(call.arguments);
            else if (call.name === 'remove_file') data = this.remove(call.arguments);
            else if (call.name === 'shell') data = await this.shell(call.arguments);
            else if (call.name === 'ask') data = this.ask(call.arguments);
            else if (call.name === 'confirm') data = this.confirm(call.arguments);
            else throw Error(`Unknown tool: ${call.name}`);
            return { ok: true, name: call.name, data };
        } catch (error) {
            return { ok: false, name: call.name, error: error instanceof Error ? error.message : String(error) };
        }
    }

    public read(input: Record<string, unknown>): string {
        return readFileSync(this.text(input.path, 'path'), 'utf-8');
    }

    public write(input: Record<string, unknown>): { path: string; bytes: number } {
        const path = this.text(input.path, 'path');
        const content = this.text(input.content, 'content');
        writeFileSync(path, content, 'utf-8');
        return { path, bytes: Buffer.byteLength(content) };
    }

    public edit(input: Record<string, unknown>): { path: string } {
        const path = this.text(input.path, 'path');
        const oldText = this.text(input.oldText, 'oldText');
        const content = readFileSync(path, 'utf-8');
        if (!content.includes(oldText)) throw Error('oldText not found');
        writeFileSync(path, content.replace(oldText, this.text(input.newText, 'newText')), 'utf-8');
        return { path };
    }

    public remove(input: Record<string, unknown>): { path: string; removed: boolean } {
        const path = this.text(input.path, 'path');
        if (!existsSync(path)) return { path, removed: false };
        rmSync(path);
        return { path, removed: true };
    }

    public async shell(input: Record<string, unknown>): Promise<{ stdout: string; stderr: string; code: number | null }> {
        const proc = Bun.spawn(['sh', '-lc', this.text(input.command, 'command')], { stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        return { stdout, stderr, code };
    }

    public ask(input: Record<string, unknown>): unknown {
        return { kind: 'ask', question: this.text(input.question, 'question'), options: input.options };
    }

    public confirm(input: Record<string, unknown>): unknown {
        if (typeof input.recommended !== 'boolean') throw Error('recommended is required');
        return { kind: 'confirm', question: this.text(input.question, 'question'), recommended: input.recommended };
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }
}
