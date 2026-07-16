import { describe, expect, test } from 'bun:test';
import { CheckRules } from './check.script';

const POSITIVE_CLASS = `
/** ZH: 持有一个 fixture 值。 EN: Owns one fixture value. */
class Fixture {
    private value: number;
    /** ZH: 初始化 fixture 值。 EN: Initializes the fixture value. */
    public constructor() { this.value = 1; }
    /** ZH: 返回 fixture 值。 EN: Returns the fixture value. */
    public read(): number { return this.value; }
}
`;

const POSITIVE_OBSERVABLE = `
/** ZH: 持有一条精确 fixture 回路。 EN: Owns one exact fixture circuit. */
class Observable {
    private state: unknown;
    /** ZH: 初始化回路状态。 EN: Initializes circuit state. */
    public constructor() { this.state = undefined; }
    /** ZH: 安装一个变换。 EN: Installs a transform. */
    public pipe(): void {}
    /** ZH: 安装分支。 EN: Installs branches. */
    public switch(): void {}
    /** ZH: 添加订阅者。 EN: Adds a subscriber. */
    public subscribe(): void {}
    /** ZH: 发出一个值。 EN: Emits a value. */
    public next(): void {}
    /** ZH: 执行私有工作。 EN: Runs private work. */
    private fire(): void {}
}
`;

describe('architecture checker fixtures', () => {
    test('accepts constructor-owned state and the exact Observable surface', () => {
        expect(CheckRules.inspect('src/core/fixture.ts', POSITIVE_CLASS)).toEqual([]);
        expect(CheckRules.inspect('src/core/observable/service.ts', POSITIVE_OBSERVABLE)).toEqual([]);
        expect(CheckRules.inspect('src/core/index.ts', "export * from './fixture';\n")).toEqual([]);
    });

    test('rejects every newly guarded architecture regression', () => {
        const state = CheckRules.inspect('src/core/state.ts', `
            /** ZH: 无效 fixture。 EN: Invalid fixture. */
            class Invalid {
                public value = 1;
                /** ZH: 未持有状态。 EN: Does not own state. */
                public constructor() {}
            }
        `);
        const documentation = CheckRules.inspect('src/core/documentation.ts', `
            /** EN: Missing Chinese ownership. */
            class Invalid {
                /** EN: Missing Chinese lifecycle. */
                public constructor() {}
            }
        `);
        const observable = CheckRules.inspect('src/core/observable/service.ts', POSITIVE_OBSERVABLE.replace('private fire()', 'public branch()'));
        const decorator = CheckRules.inspect('src/core/decorator-fixture.ts', `
            /** ZH: 无效装饰 fixture。 EN: Invalid decorated fixture. */
            @Memo()
            class Invalid {
                /** ZH: 创建 fixture。 EN: Creates the fixture. */
                public constructor() {}
            }
        `);
        const barrel = CheckRules.inspect('src/core/index.ts', 'export const value = 1;\n');
        const importBoundary = CheckRules.inspect('src/core/import-fixture.ts', "import '../model/service';\n");
        const dynamicImportBoundary = CheckRules.inspect('src/core/dynamic-import-fixture.ts', "const dependency = import('../model/service');\n");

        expect(state.some((error) => error.includes('instance properties'))).toBe(true);
        expect(state.some((error) => error.includes('constructor must initialize'))).toBe(true);
        expect(documentation.some((error) => error.includes('EN/ZH JSDoc'))).toBe(true);
        expect(observable.some((error) => error.includes('public methods must be exactly'))).toBe(true);
        expect(decorator.some((error) => error.includes('decorator is not allowed'))).toBe(true);
        expect(barrel.some((error) => error.includes('re-export declarations'))).toBe(true);
        expect(importBoundary.some((error) => error.includes('cross-domain imports'))).toBe(true);
        expect(dynamicImportBoundary.some((error) => error.includes('cross-domain imports'))).toBe(true);
    });
});
