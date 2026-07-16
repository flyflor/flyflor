/**
 * ZH: 把一条 LLM 响应解析成带类型的 JSON 值。接受原始字符串(可以有或
 * 没有首尾 ```json 围栏)或已经解析过的值(比如非流式响应)。遇到非法
 * JSON 直接抛错,让调用方的 await 拒绝,把错误传上去游的回合边界。
 * EN: Parses one LLM response into a typed JSON value. Accepts a raw string
 * (with or without a leading/trailing ```json fence) or an already-parsed
 * value (e.g. from a non-streaming response). Throws on malformed JSON so
 * the caller's `await` rejects and the upstream turn boundary sees the error.
 */
export function parse<T>(raw: string | unknown): T {
    if (typeof raw === 'string') {
        const value = raw.trim();
        if (value.startsWith('```json') && value.endsWith('```')) {
            return JSON.parse(value.slice(7, -3).trim()) as T;
        }
        return JSON.parse(value) as T;
    }
    return raw as T;
}
