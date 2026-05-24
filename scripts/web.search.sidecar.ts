#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

interface SidecarRequest {
    readonly config?: unknown;
    readonly configDir?: unknown;
    readonly cwd?: unknown;
    readonly input?: unknown;
    readonly projectDir?: unknown;
    readonly tool?: unknown;
}

interface SearchProvider {
    readonly id: string;
    readonly kind: "brave" | "tavily" | "serpapi" | "bing" | "generic";
    readonly apiKey?: string;
    readonly endpoint?: string;
    readonly enabled: boolean;
}

interface SearchResult {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
    readonly sourceProvider: string;
    readonly rank: number;
    readonly score: number;
    readonly summary?: string;
    readonly fetchedAt?: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const CACHE = new Map<string, { at: number; value: JsonObject }>();

try {
    const raw = await new Response(Bun.stdin.stream()).text();
    const request = parseRequest(raw);
    const input = objectInput(request.input);
    const config = objectInput(request.config ?? {});
    const result = await dispatch(requiredString(request.tool, "request.tool"), input, config, request);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

async function dispatch(tool: string, input: JsonObject, config: JsonObject, request: SidecarRequest): Promise<JsonObject> {
    switch (tool) {
        case "web.fetch":
            return fetchUrl(requiredString(input.url, "input.url"), input);
        case "web.extract":
            return extractUrl(requiredString(input.url, "input.url"), input);
        case "web.download":
            return downloadUrl(requiredString(input.url, "input.url"), requiredString(input.path, "input.path"), input, request);
        case "web.search":
            return searchWeb(input, config);
        default:
            throw new Error(`unsupported web sidecar tool: ${tool}`);
    }
}

async function searchWeb(input: JsonObject, config: JsonObject): Promise<JsonObject> {
    const query = requiredString(input.query, "input.query");
    const limit = boundedInt(input.limit, 10, 1, 20);
    const includeFetch = input.includeFetch === true;
    const ttlMs = boundedInt(config.cacheTtlMs, 600_000, 0, 86_400_000);
    const providers = configuredProviders(config);
    if (providers.length === 0) {
        throw new Error("web.search has no configured provider");
    }
    const cacheKey = JSON.stringify({ query, limit, includeFetch, providers: providers.map((provider) => provider.id) });
    const cached = CACHE.get(cacheKey);
    if (cached && ttlMs > 0 && Date.now() - cached.at <= ttlMs) {
        return { ...cached.value, cacheHit: true };
    }

    const warnings: string[] = [];
    const settled = await Promise.all(
        providers.slice(0, 3).map(async (provider) => {
            try {
                return { provider, results: await searchProvider(provider, input, limit) };
            } catch (err) {
                warnings.push(`${provider.id}: ${err instanceof Error ? err.message : String(err)}`);
                return { provider, results: [] as SearchResult[] };
            }
        }),
    );
    const results = dedupeResults(settled.flatMap((entry) => entry.results)).slice(0, limit);
    if (results.length === 0) {
        throw new Error(`web.search failed: ${warnings.join("; ") || "no results"}`);
    }
    const enriched = includeFetch ? await enrichResults(results, boundedInt(input.fetchLimit, 3, 0, 5), warnings) : results;
    const payload = {
        query,
        results: enriched,
        sources: enriched.map((result) => ({ title: result.title, url: result.url, provider: result.sourceProvider })),
        providerStats: settled.map((entry) => ({ id: entry.provider.id, count: entry.results.length })),
        cacheHit: false,
        warnings,
    };
    CACHE.set(cacheKey, { at: Date.now(), value: payload });
    return payload;
}

async function searchProvider(provider: SearchProvider, input: JsonObject, limit: number): Promise<SearchResult[]> {
    const query = requiredString(input.query, "input.query");
    if (provider.kind === "generic") {
        const endpoint = requiredString(provider.endpoint, `provider.${provider.id}.endpoint`);
        const url = new URL(endpoint);
        url.searchParams.set("q", query);
        url.searchParams.set("limit", String(limit));
        const json = await fetchJson(url, provider.apiKey);
        return normalizeResults(json, provider.id, limit);
    }
    if (!provider.apiKey) {
        throw new Error("provider apiKey is missing");
    }
    if (provider.kind === "brave") {
        const url = new URL(provider.endpoint ?? "https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(limit));
        const json = await fetchJson(url, provider.apiKey, "X-Subscription-Token");
        return normalizeResults((json.web as JsonObject | undefined)?.results ?? [], provider.id, limit);
    }
    if (provider.kind === "tavily") {
        const response = await fetch(provider.endpoint ?? "https://api.tavily.com/search", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ api_key: provider.apiKey, query, max_results: limit }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return normalizeResults(((await response.json()) as JsonObject).results ?? [], provider.id, limit);
    }
    const url = new URL(provider.endpoint ?? (provider.kind === "serpapi" ? "https://serpapi.com/search.json" : "https://api.bing.microsoft.com/v7.0/search"));
    url.searchParams.set(provider.kind === "serpapi" ? "q" : "q", query);
    const json = await fetchJson(url, provider.apiKey, provider.kind === "bing" ? "Ocp-Apim-Subscription-Key" : undefined);
    return normalizeResults(provider.kind === "bing" ? (json.webPages as JsonObject | undefined)?.value ?? [] : json.organic_results ?? [], provider.id, limit);
}

async function fetchUrl(url: string, input: JsonObject): Promise<JsonObject> {
    const response = await fetchWithTimeout(url, boundedInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000));
    const text = await response.text();
    return {
        status: response.status,
        url: response.url,
        contentType: response.headers.get("content-type") ?? "",
        text: text.slice(0, boundedInt(input.maxChars, 16_000, 1, 100_000)),
        truncated: text.length > boundedInt(input.maxChars, 16_000, 1, 100_000),
    };
}

async function extractUrl(url: string, input: JsonObject): Promise<JsonObject> {
    const fetched = await fetchUrl(url, input);
    const text = stripHtml(String(fetched.text ?? ""));
    return { ...fetched, text, title: titleFromHtml(String(fetched.text ?? "")) };
}

async function downloadUrl(url: string, path: string, input: JsonObject, request: SidecarRequest): Promise<JsonObject> {
    const projectDir = readString(request.projectDir) ?? process.cwd();
    const output = isAbsolute(path) ? path : join(projectDir, path);
    const resolved = resolve(output);
    if (!resolved.startsWith(resolve(projectDir))) {
        throw new Error("web.download path must stay under projectDir");
    }
    const response = await fetchWithTimeout(url, boundedInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000));
    const bytes = new Uint8Array(await response.arrayBuffer());
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, bytes);
    return { status: response.status, url: response.url, path: resolved, bytes: bytes.byteLength };
}

function configuredProviders(config: JsonObject): SearchProvider[] {
    const providers = Array.isArray(config.providers) ? config.providers : [];
    return providers.map((entry, index) => {
        const object = asObject(entry, `config.providers.${index}`);
        const kind = requiredString(object.kind, `config.providers.${index}.kind`) as SearchProvider["kind"];
        if (!["brave", "tavily", "serpapi", "bing", "generic"].includes(kind)) {
            throw new Error(`unsupported search provider kind: ${kind}`);
        }
        return {
            id: readString(object.id) ?? `${kind}-${index + 1}`,
            kind,
            apiKey: readString(object.apiKey),
            endpoint: readString(object.endpoint),
            enabled: object.enabled !== false,
        };
    }).filter((provider) => provider.enabled);
}

async function fetchJson(url: URL, apiKey?: string, header = "Authorization"): Promise<JsonObject> {
    const headers: Record<string, string> = {};
    if (apiKey) headers[header] = header === "Authorization" ? `Bearer ${apiKey}` : apiKey;
    const response = await fetchWithTimeout(url, DEFAULT_TIMEOUT_MS, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as JsonObject;
}

async function fetchWithTimeout(url: string | URL, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function normalizeResults(value: unknown, provider: string, limit: number): SearchResult[] {
    const items = Array.isArray(value) ? value : [];
    return items.slice(0, limit).map((entry, index) => {
        const object = asObject(entry, `result.${index}`);
        const url = readString(object.url) ?? readString(object.link) ?? readString(object.href) ?? "";
        return {
            title: readString(object.title) ?? readString(object.name) ?? url,
            url,
            snippet: readString(object.snippet) ?? readString(object.content) ?? readString(object.description) ?? "",
            sourceProvider: provider,
            rank: index + 1,
            score: 1 / (index + 1),
        };
    }).filter((result) => result.url.length > 0);
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const result of results) {
        const key = canonicalUrl(result.url);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push({ ...result, rank: deduped.length + 1 });
    }
    return deduped;
}

async function enrichResults(results: SearchResult[], limit: number, warnings: string[]): Promise<SearchResult[]> {
    const copy = [...results];
    await Promise.all(copy.slice(0, limit).map(async (result, index) => {
        try {
            const fetched = await extractUrl(result.url, { maxChars: 2_000 });
            copy[index] = { ...result, summary: String(fetched.text ?? "").slice(0, 600), fetchedAt: new Date().toISOString() };
        } catch (err) {
            warnings.push(`${result.url}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }));
    return copy;
}

function canonicalUrl(value: string): string {
    try {
        const url = new URL(value);
        url.hash = "";
        url.searchParams.sort();
        return url.toString().replace(/\/$/, "");
    } catch {
        return value;
    }
}

function stripHtml(value: string): string {
    return value
        .replace(/<script[\s\S]*?<\/script>/giu, " ")
        .replace(/<style[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}

function titleFromHtml(value: string): string | undefined {
    return value.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1]?.replace(/\s+/gu, " ").trim();
}

function parseRequest(raw: string): SidecarRequest {
    if (raw.trim().length === 0) throw new Error("empty process-json request");
    return JSON.parse(raw) as SidecarRequest;
}

function objectInput(value: unknown): JsonObject {
    if (value === undefined) return {};
    return asObject(value, "input");
}

function asObject(value: unknown, path: string): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as JsonObject;
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
    return value;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}
