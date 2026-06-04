import { join } from 'path';

export const ROOT_PATH = join(__dirname, '..');

/**
 * The locales Flyflor recognizes.
 *
 * Note: per AGENTS.md red line 5, prompt files are ALWAYS read as the English `.md` source at runtime.
 * The `.zh.cn.md` mirrors exist for human readers and are never opened by code. `Locale` is therefore
 * reserved for future agent-response-language negotiation; it does NOT participate in prompt file selection.
 */
export enum Locale {
    En = 'en',
    ZhCn = 'zh-CN',
}
