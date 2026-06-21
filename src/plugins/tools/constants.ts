import type { ToolMetadata } from '@/core';
import { FilesystemAction, ToolName } from './types';

export const ASK_TOOL_METADATA: ToolMetadata = {
    name: ToolName.Ask,
    description: 'Ask the user an open question and pause the current turn.',
    risk: 'interaction',
    parameters: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            options: { type: 'array' },
        },
        required: ['question', 'options'],
    },
};

export const CONFIRM_TOOL_METADATA: ToolMetadata = {
    name: ToolName.Confirm,
    description: 'Ask the user to confirm one yes/no decision and pause the current turn.',
    risk: 'interaction',
    parameters: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            recommended: { type: 'boolean' },
        },
        required: ['question', 'recommended'],
    },
};

export const FILESYSTEM_TOOL_METADATA: ToolMetadata = {
    name: ToolName.Filesystem,
    description: 'List directories, read text files, write full file content, or perform guarded text edits on the filesystem.',
    risk: 'write',
    parameters: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: Object.values(FilesystemAction) },
            cwd: { type: 'string' },
            path: { type: 'string' },
            depth: { type: 'number' },
            offsetLines: { type: 'number' },
            limitLines: { type: 'number' },
            limitBytes: { type: 'number' },
            content: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
        },
        required: ['action', 'cwd', 'path'],
    },
};
