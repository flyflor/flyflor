import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    getFlyflorConfigPath,
    getFlyflorChannelBinding,
    listFlyflorChannelBindings,
    removeFlyflorChannelBinding,
} from "../src/command/cli/config.ts";

const configPath = getFlyflorConfigPath();
const backupPath = `${configPath}.crud-test-backup`;
let hadOriginal = false;

afterEach(async () => {
    if (hadOriginal) {
        await writeFile(configPath, await readFile(backupPath, "utf8"), "utf8");
        await rm(backupPath, { force: true });
    } else {
        await rm(configPath, { force: true });
    }
});

describe("channel config CRUD helpers", () => {
    test("lists, shows, and removes one iLink profile without deleting sibling profiles", async () => {
        await backupConfig();
        await writeConfig({
            gateway: {
                allowedChannels: ["api", "webhook", "stdio", "weixin-ilink"],
                channelReplyUrls: {},
                channels: {
                    weixinIlink: {
                        apiBaseUrl: "https://ilinkai.weixin.qq.com",
                        defaultProfile: "bot-a",
                        pollIntervalMs: 1500,
                        profiles: {
                            "bot-a": {
                                accountId: "bot-a",
                                apiBaseUrl: "https://ilinkai.weixin.qq.com",
                                pollIntervalMs: 1500,
                                token: "token-a",
                            },
                            "bot-b": {
                                accountId: "bot-b",
                                apiBaseUrl: "https://ilinkai.weixin.qq.com",
                                pollIntervalMs: 1500,
                                token: "token-b",
                            },
                        },
                    },
                },
            },
        });

        const before = await listFlyflorChannelBindings();
        const shown = await getFlyflorChannelBinding("weixin-ilink", "bot-a");
        const removed = await removeFlyflorChannelBinding("weixin-ilink", "bot-a");
        const after = await listFlyflorChannelBindings();
        const config = await readJsoncConfig();

        expect(before.filter((binding) => binding.channel === "weixinIlink")).toHaveLength(2);
        expect(shown?.fields.token).toBe("toke...-a");
        expect(removed.removed).toBe(true);
        expect(removed.remainingProfiles).toEqual(["bot-b"]);
        expect(after.find((binding) => binding.profile === "bot-a")).toBeUndefined();
        expect(after.find((binding) => binding.profile === "bot-b")?.configured).toBe(true);
        expect(config.gateway.allowedChannels).toContain("weixin-ilink");
        expect(config.gateway.channels.weixinIlink.profiles["bot-b"].token).toBe("token-b");
    });

    test("removing the last profile disables the channel binding", async () => {
        await backupConfig();
        await writeConfig({
            gateway: {
                allowedChannels: ["api", "webhook", "stdio", "weixin-ilink"],
                channelReplyUrls: {},
                channels: {
                    weixinIlink: {
                        defaultProfile: "bot-a",
                        pollIntervalMs: 1500,
                        profiles: {
                            "bot-a": {
                                apiBaseUrl: "https://ilinkai.weixin.qq.com",
                                pollIntervalMs: 1500,
                                token: "token-a",
                            },
                        },
                    },
                },
            },
        });

        const removed = await removeFlyflorChannelBinding("weixin-ilink", "bot-a");
        const config = await readJsoncConfig();

        expect(removed.removed).toBe(true);
        expect(removed.remainingProfiles).toEqual([]);
        expect(config.gateway.allowedChannels).not.toContain("weixin-ilink");
        expect(config.gateway.channels.weixinIlink).toEqual({});
    });
});

async function backupConfig(): Promise<void> {
    await mkdir(join(configPath, ".."), { recursive: true });
    try {
        await writeFile(backupPath, await readFile(configPath, "utf8"), "utf8");
        hadOriginal = true;
    } catch {
        hadOriginal = false;
    }
}

async function writeConfig(config: Record<string, unknown>): Promise<void> {
    await mkdir(join(configPath, ".."), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 4), "utf8");
}

async function readJsoncConfig(): Promise<Record<string, any>> {
    const text = await readFile(configPath, "utf8");
    return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}
