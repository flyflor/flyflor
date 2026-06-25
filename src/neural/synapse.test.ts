import { describe, expect, test } from 'bun:test';
import { SynapseSignalType } from './types';

describe('SynapseSignalType', () => {
    test('exposes pause and resume as control signals', () => {
        expect(String(SynapseSignalType.Pause)).toBe('pause');
        expect(String(SynapseSignalType.Resume)).toBe('resume');
        expect(String(SynapseSignalType.Ask)).toBe('ask');
        expect(String(SynapseSignalType.Confirm)).toBe('confirm');
    });
});
