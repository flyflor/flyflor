#!/usr/bin/env bun

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type BrowserUrlSafetyLookup = (hostname: string) => Promise<readonly string[]>;

const BLOCKED_URL_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:"]);
const ALWAYS_BLOCKED_BROWSER_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);
const ALWAYS_BLOCKED_BROWSER_IPS = new Set([
    "100.100.100.200",
    "169.254.169.253",
    "169.254.169.254",
    "169.254.170.2",
    "fd00:ec2::254",
    "::ffff:100.100.100.200",
    "::ffff:169.254.169.253",
    "::ffff:169.254.169.254",
    "::ffff:169.254.170.2",
]);

export class BrowserUrlSafetyError extends Error {
    public constructor(message: string) {
        super(message);
    }
}

export class BrowserUrlSafetyPolicy {
    public constructor(private readonly lookupHost: BrowserUrlSafetyLookup = defaultLookupHost) {}

    public async requiredUrl(value: unknown, path: string): Promise<string> {
        const raw = this.requiredString(value, path);
        const url = new URL(raw);
        const protocol = url.protocol.toLowerCase();
        if (BLOCKED_URL_PROTOCOLS.has(protocol)) {
            throw new BrowserUrlSafetyError(`${path} uses blocked protocol: ${url.protocol}`);
        }
        const blocked = await this.alwaysBlockedUrlReason(url);
        if (blocked) {
            throw new BrowserUrlSafetyError(`${path} targets always-blocked browser URL: ${blocked}`);
        }
        return url.toString();
    }

    public async alwaysBlockedUrlReason(url: URL): Promise<string | undefined> {
        const host = normalizeBrowserHost(url.hostname);
        if (!host) return undefined;
        const literal = alwaysBlockedBrowserAddressReason(host);
        if (literal) return literal;
        if (isIP(host) !== 0) return undefined;
        const resolved = await this.lookupHost(host).catch(() => []);
        for (const address of resolved) {
            const reason = alwaysBlockedBrowserAddressReason(address);
            if (reason) return `${host} -> ${reason}`;
        }
        return undefined;
    }

    private requiredString(value: unknown, path: string): string {
        if (typeof value !== "string" || value.trim().length === 0) {
            throw new Error(`${path} must be a non-empty string`);
        }
        return value.trim();
    }
}

async function defaultLookupHost(hostname: string): Promise<readonly string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
}

function alwaysBlockedBrowserAddressReason(value: string): string | undefined {
    const host = normalizeBrowserHost(value);
    if (!host) return undefined;
    if (ALWAYS_BLOCKED_BROWSER_HOSTNAMES.has(host)) return host;
    if (ALWAYS_BLOCKED_BROWSER_IPS.has(host)) return host;
    if (isIP(host) === 4 && host.startsWith("169.254.")) return "169.254.0.0/16";
    if (host.startsWith("::ffff:169.254.")) return "::ffff:169.254.0.0/112";
    return undefined;
}

function normalizeBrowserHost(value: string): string {
    return value.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "").replace(/\.$/u, "");
}
