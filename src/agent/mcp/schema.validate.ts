/**
 * Lightweight JSON-Schema validator for MCP tool inputs.
 *
 * Supports a deliberately small subset: type (single string or array),
 * required, properties (recursive), items, enum, additionalProperties:false.
 * Unsupported schema shapes are reported as validation errors instead of being
 * skipped, so malformed tool schemas do not silently loosen the sandbox.
 */

export interface SchemaValidationResult {
    ok: boolean;
    errors: string[];
}

type JsonSchema = Record<string, unknown>;

const PRIMITIVE_TYPES = new Set(["string", "number", "integer", "boolean", "null"]);

export function validateAgainstInputSchema(schema: unknown, input: unknown): SchemaValidationResult {
    if (!isObject(schema)) {
        return { ok: true, errors: [] };
    }
    const errors: string[] = [];
    walk(schema as JsonSchema, input, "", errors);
    return { ok: errors.length === 0, errors };
}

function walk(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
    const declared = schema.type;
    const types = normalizeTypes(declared);
    if (types.length > 0 && !types.some((t) => matchesType(t, value))) {
        errors.push(`${path || "input"} expected ${types.join("|")}, got ${describe(value)}`);
        return;
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        if (!schema.enum.some((candidate) => deepEqual(candidate, value))) {
            errors.push(`${path || "input"} must be one of ${JSON.stringify(schema.enum)}`);
            return;
        }
    }

    if (matchesType("object", value) && isObject(value)) {
        const required = Array.isArray(schema.required) ? (schema.required as unknown[]).filter(isString) : [];
        for (const key of required) {
            if (!(key in (value as Record<string, unknown>))) {
                errors.push(`${path ? `${path}.` : ""}${key} is required`);
            }
        }
        const properties = isObject(schema.properties) ? (schema.properties as Record<string, unknown>) : undefined;
        if (properties) {
            for (const [key, childSchema] of Object.entries(properties)) {
                if (!(key in (value as Record<string, unknown>))) continue;
                if (!isObject(childSchema)) {
                    errors.push(`${path ? `${path}.` : ""}${key} schema must be an object`);
                    continue;
                }
                walk(
                    childSchema as JsonSchema,
                    (value as Record<string, unknown>)[key],
                    path ? `${path}.${key}` : key,
                    errors,
                );
            }
        }
        if (schema.additionalProperties === false && properties) {
            for (const key of Object.keys(value as Record<string, unknown>)) {
                if (!(key in properties)) {
                    errors.push(`${path ? `${path}.` : ""}${key} is not allowed`);
                }
            }
        }
    }

    if (matchesType("array", value) && Array.isArray(value) && schema.items !== undefined && !isObject(schema.items)) {
        errors.push(`${path || "input"} items schema must be an object`);
        return;
    }

    if (matchesType("array", value) && Array.isArray(value) && isObject(schema.items)) {
        const itemSchema = schema.items as JsonSchema;
        for (let index = 0; index < value.length; index += 1) {
            walk(itemSchema, value[index], `${path || "input"}[${index}]`, errors);
        }
    }
}

function normalizeTypes(declared: unknown): string[] {
    if (typeof declared === "string") return [declared];
    if (Array.isArray(declared)) return declared.filter(isString);
    return [];
}

function matchesType(type: string, value: unknown): boolean {
    if (type === "object") return isObject(value);
    if (type === "array") return Array.isArray(value);
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "null") return value === null;
    if (PRIMITIVE_TYPES.has(type)) return typeof value === type;
    return false;
}

function describe(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, idx) => deepEqual(item, b[idx]));
    }
    if (isObject(a) && isObject(b)) {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every((key) => deepEqual(a[key], b[key]));
    }
    return false;
}
