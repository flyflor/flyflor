import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import type { RuntimeEvent, GatewayMessage, GatewayReply, RuntimeContext } from "../../protocol/contracts/index.ts";
import { Channel, ChatType } from "../../protocol/contracts/index.ts";
import { RuntimeEventType, RuntimeEventBus, type EventSink } from "../../protocol/events/index.ts";
import type { RuntimeModule } from "../../agent/runtime/index.ts";
import type { McpToolCallRequest } from "../../agent/mcp/index.ts";

/* ─── Types ─────────────────────────────────────────── */

interface McpTrace {
    server: string;
    tool: string;
    ok: boolean;
    resultText: string;
}

interface Turn {
    id: string;
    userMessage: string;
    assistantText: string;
    completedAt: string | null;
    metadata: GatewayReply["metadata"] | null;
    mcpCalls: McpTrace[];
    skills: string[];
    blackboardStarted: boolean;
    blackboardText: string;
}

type Phase = "idle" | "blackboard" | "thinking" | "mcp" | "skill" | "streaming";
type Section = "blackboard" | "skills" | "mcp";
type SectionMap = Record<Section, boolean>;

/* ─── Phase animation definitions ───────────────────── */

const PHASE_DEF: Record<Phase, { frames: string[]; label: string; doneIcon: string; color: string }> = {
    idle:       { frames: [""],                label: "",            doneIcon: "",   color: "gray" },
    blackboard: { frames: ["🔍","🔎","🔍","🔎"], label: "Researching", doneIcon: "📋", color: "yellow" },
    thinking:   { frames: ["🧠","💭","🧠","💭"], label: "Thinking",    doneIcon: "💡", color: "cyan" },
    mcp:        { frames: ["🔗","🔌","🔗","🔌"], label: "Tool call",   doneIcon: "🔧", color: "blue" },
    skill:      { frames: ["⚡","📋","⚡","📋"], label: "Skill",       doneIcon: "✅", color: "green" },
    streaming:  { frames: ["✨","💫","✨","💫"], label: "Generating",  doneIcon: "✨", color: "white" },
};

/* ─── Hooks ─────────────────────────────────────────── */

/** Cycles through frames at intervalMs. Returns the current frame. */
function useAnim(active: boolean, frames: string[], intervalMs = 240): string {
    const [i, setI] = useState(0);
    useEffect(() => {
        if (!active || frames.length <= 1) { setI(0); return; }
        const t = setInterval(() => setI((x) => (x + 1) % frames.length), intervalMs);
        return () => clearInterval(t);
    }, [active, frames.length, intervalMs]);
    return frames[i % frames.length] ?? frames[0] ?? "";
}

function useTermSize(): { rows: number; cols: number } {
    const { stdout } = useStdout();
    const [sz, setSz] = useState({ rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 });
    useEffect(() => {
        const up = (): void => setSz({ rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 });
        stdout.on("resize", up);
        return () => { stdout.off("resize", up); };
    }, [stdout]);
    return sz;
}

/* ─── Helpers ───────────────────────────────────────── */

function emptySections(): SectionMap {
    return { blackboard: false, skills: false, mcp: false };
}

function fmtTime(iso: string): string {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
}

/** Return last ~2 visual lines of text (rough wrap at cols). */
function preview2(text: string, cols: number): string {
    if (!text) return "";
    const wrapped: string[] = [];
    for (const p of text.split("\n")) {
        const w = Math.max(1, Math.ceil((p.length || 1) / Math.max(1, cols)));
        for (let i = 0; i < w; i++) wrapped.push(p.slice(i * cols, (i + 1) * cols));
    }
    return wrapped.slice(-2).join(" ").trim();
}

/** Colour-safe cast for Ink Text color prop. */
function c(name: string): "yellow" | "cyan" | "blue" | "green" | "white" | "gray" | "red" {
    return name as "yellow" | "cyan" | "blue" | "green" | "white" | "gray" | "red";
}

/* ─── Section Card (collapsible) ────────────────────── */

interface CardProps {
    icon: string;
    label: string;
    preview: string;
    open: boolean;
    color: string;
    children?: React.ReactNode;
}

function Card({ icon, label, preview, open, color, children }: CardProps): React.ReactElement {
    return (
        <Box flexDirection="column">
            <Box>
                <Text>{icon}</Text>
                <Box marginLeft={1}>
                    <Text dimColor>{open ? "▼" : "▶"}</Text>
                </Box>
                <Box marginLeft={1}>
                    <Text color={c(color)} bold>{label}</Text>
                </Box>
                {!open && preview ? (
                    <Box marginLeft={1}>
                        <Text dimColor italic>{preview.slice(0, 70)}{preview.length > 70 ? "…" : ""}</Text>
                    </Box>
                ) : null}
            </Box>
            {open && children ? (
                <Box marginLeft={2} marginTop={0}>
                    {children}
                </Box>
            ) : null}
        </Box>
    );
}

/* ─── Finished Turn ─────────────────────────────────── */

interface TurnProps {
    turn: Turn;
    expanded: SectionMap;
}

function TurnView({ turn, expanded }: TurnProps): React.ReactElement {
    const { cols } = useTermSize();
    const meta = turn.metadata;
    const metaSkills: string[] = (meta && Array.isArray(meta.skills) ? meta.skills as string[] : []);
    const metaMcpN: number = (meta && typeof meta.mcpToolCalls === "number" ? meta.mcpToolCalls : 0);
    const metaBb: Record<string, unknown> | undefined =
        meta && typeof meta.blackboard === "object" && meta.blackboard !== null
            ? (meta.blackboard as Record<string, unknown>) : undefined;

    const hBb = turn.blackboardStarted || !!metaBb;
    const hSk = turn.skills.length > 0 || metaSkills.length > 0;
    const hMcp = turn.mcpCalls.length > 0 || metaMcpN > 0;
    const sep = "─".repeat(Math.max(0, cols - 2));

    return (
        <Box flexDirection="column">
            {/* User */}
            <Box><Text color="cyan">┃</Text><Box paddingLeft={1}><Text color="cyan" bold>You</Text></Box></Box>
            <Box><Text color="cyan">┃</Text><Box paddingLeft={1} flexGrow={1} paddingRight={1}><Text>{turn.userMessage}</Text></Box></Box>

            {/* Status cards */}
            {hBb ? (
                <Box><Text color="cyan">┃</Text><Box paddingLeft={1} flexGrow={1}>
                    <Card icon={PHASE_DEF.blackboard.doneIcon} label="Blackboard"
                        preview={preview2(turn.blackboardText, cols - 20)}
                        open={expanded.blackboard} color="yellow">
                        <Box flexDirection="column">
                            {turn.blackboardText.split("\n").slice(0, 20).map((l, i) => (
                                <Text key={i} dimColor>{l || " "}</Text>
                            ))}
                            {turn.blackboardText.split("\n").length > 20 ? <Text dimColor>… (truncated)</Text> : null}
                        </Box>
                    </Card>
                </Box></Box>
            ) : null}

            {hSk && !hBb ? (
                <Box><Text color="cyan">┃</Text><Box paddingLeft={1} flexGrow={1}>
                    <Card icon={PHASE_DEF.skill.doneIcon} label="Skills"
                        preview={[...turn.skills, ...metaSkills].join(", ")}
                        open={expanded.skills} color="green">
                        <Box flexDirection="column">
                            {[...turn.skills, ...metaSkills].map((n) => (
                                <Text key={n} dimColor>• {n}</Text>
                            ))}
                        </Box>
                    </Card>
                </Box></Box>
            ) : null}

            {hMcp ? (
                <Box><Text color="cyan">┃</Text><Box paddingLeft={1} flexGrow={1}>
                    <Card icon={PHASE_DEF.mcp.doneIcon} label="MCP Tools"
                        preview={`${turn.mcpCalls.length || metaMcpN} call(s)`}
                        open={expanded.mcp} color="blue">
                        <Box flexDirection="column">
                            {turn.mcpCalls.map((c, i) => (
                                <Box key={i} flexDirection="column" marginBottom={1}>
                                    <Text>{c.ok ? "✓" : "✗"} {c.server}.{c.tool}</Text>
                                    {c.resultText ? <Box marginLeft={2}><Text dimColor>{c.resultText.slice(0, 300)}</Text></Box> : null}
                                </Box>
                            ))}
                            {turn.mcpCalls.length === 0 && metaMcpN > 0 ? <Text dimColor>  {metaMcpN} tool(s) executed</Text> : null}
                        </Box>
                    </Card>
                </Box></Box>
            ) : null}

            {/* Separator */}
            <Text dimColor>{sep}</Text>

            {/* Assistant */}
            <Box><Text color="green">┃</Text><Box paddingLeft={1}>
                <Text color="green" bold>Flyflor</Text>
                {turn.completedAt ? <Text dimColor>  {fmtTime(turn.completedAt)}</Text> : null}
            </Box></Box>
            <Box><Text color="green">┃</Text><Box paddingLeft={1} flexGrow={1} paddingRight={1}><Text>{turn.assistantText || " "}</Text></Box></Box>
        </Box>
    );
}

/* ─── Processing overlay ────────────────────────────── */

function ProcessingView({ phase, userMsg }: { phase: Phase; userMsg: string }): React.ReactElement {
    const def = PHASE_DEF[phase];
    const icon = useAnim(phase !== "idle", def.frames, 250);
    return (
        <Box flexDirection="column">
            <Box><Text color="cyan">┃</Text><Box paddingLeft={1}><Text color="cyan" bold>You</Text></Box></Box>
            <Box><Text color="cyan">┃</Text><Box paddingLeft={1}><Text>{userMsg}</Text></Box></Box>
            <Box marginTop={1}>
                <Text color={c(def.color)}>{icon || def.frames[0]} {def.label}</Text>
            </Box>
        </Box>
    );
}

/* ─── ChatTui ───────────────────────────────────────── */

interface ChatTuiProps {
    runtime: RuntimeModule;
    eventBus?: RuntimeEventBus;
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    agentName?: string;
    userId?: string;
}

export function ChatTui({
    runtime,
    eventBus,
    approveMcpToolCall,
    agentName = "flyflor",
    userId = "human",
}: ChatTuiProps): React.ReactElement {
    const { exit } = useApp();
    const { rows: termRows, cols: termCols } = useTermSize();

    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [cursor, setCursor] = useState(0);
    const [processing, setProcessing] = useState(false);
    const [phase, setPhase] = useState<Phase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Map<string, SectionMap>>(new Map());
    const [scrollOfs, setScrollOfs] = useState(0);

    const curTurnRef = useRef<Turn | null>(null);
    const procRef = useRef(false);
    const unsubRef = useRef<(() => void) | null>(null);

    /* ── Event subscription ── */
    useEffect(() => {
        if (!eventBus) return;
        const sink: EventSink = {
            publish: (ev: RuntimeEvent) => {
                if (ev.type === RuntimeEventType.BlackboardTurnStart) {
                    setPhase("blackboard");
                    if (curTurnRef.current) curTurnRef.current.blackboardStarted = true;
                } else if (ev.type === RuntimeEventType.McpToolCallExecuted) {
                    const p = ev.payload as Record<string, unknown> | undefined;
                    if (p && curTurnRef.current) {
                        curTurnRef.current.mcpCalls.push({
                            server: String(p.server ?? ""), tool: String(p.tool ?? ""),
                            ok: p.ok === true, resultText: String(p.resultSummary ?? ""),
                        });
                    }
                } else if (ev.type === RuntimeEventType.SkillContextBuilt) {
                    const p = ev.payload as Record<string, unknown> | undefined;
                    if (p?.skillNames && Array.isArray(p.skillNames)) {
                        for (const n of p.skillNames) {
                            if (typeof n === "string" && curTurnRef.current && !curTurnRef.current.skills.includes(n)) {
                                curTurnRef.current.skills.push(n);
                            }
                        }
                    }
                    setPhase("skill");
                } else if (ev.type === RuntimeEventType.BlackboardTurnEnd || ev.type === RuntimeEventType.AgentTurnEnd) {
                    setPhase("streaming");
                }
            },
        };
        unsubRef.current = eventBus.subscribe(sink);
        return () => { unsubRef.current?.(); unsubRef.current = null; };
    }, [eventBus]);

    /* ── Viewport calc ── */
    const HEADER_H = 1;
    const SEP_H = 2; // two separators (header-sep, sep-input)
    const INPUT_H = 1;
    const avail = termRows - HEADER_H - SEP_H - INPUT_H;
    const maxTurns = Math.max(1, Math.floor(avail / 5));

    const visibleTurns = (() => {
        if (turns.length === 0) return [];
        const clamped = Math.min(scrollOfs, Math.max(0, turns.length - 1));
        const start = Math.max(0, turns.length - maxTurns - clamped);
        const end = Math.min(turns.length, start + maxTurns + Math.min(clamped, maxTurns));
        return turns.slice(start, end);
    })();

    /* ── Submit ── */
    const submit = useCallback(async () => {
        const text = input.trim();
        if (!text || procRef.current) return;
        setInput("");
        setCursor(0);
        setError(null);
        procRef.current = true;
        setProcessing(true);
        setScrollOfs(0);

        const turn: Turn = {
            id: crypto.randomUUID(), userMessage: text, assistantText: "",
            completedAt: null, metadata: null,
            mcpCalls: [], skills: [],
            blackboardStarted: false, blackboardText: "",
        };
        curTurnRef.current = turn;
        setPhase("thinking");
        setTurns((prev) => [...prev, turn]);

        const ctx: RuntimeContext = { requestId: crypto.randomUUID(), now: new Date().toISOString() };
        const msg: GatewayMessage = {
            id: crypto.randomUUID(),
            route: { channel: Channel.Stdio, chatId: "chat-tui", chatType: ChatType.Direct },
            user: { id: userId }, text, receivedAt: ctx.now,
        };

        try {
            let acc = "";
            let bb = "";
            const reply = await runtime.handleMessage(msg, ctx, {
                approveMcpToolCall: approveMcpToolCall ?? (async () => true),
                onTextDelta: (chunk: string) => {
                    acc += chunk;
                    if (chunk.includes(">") || bb.length > 0) { bb += chunk; setPhase("blackboard"); }
                    else { setPhase("streaming"); }
                    setTurns((prev) => {
                        const u = [...prev]; const l = u[u.length - 1];
                        if (l) { l.assistantText = acc; l.blackboardText = bb; }
                        return u;
                    });
                },
            });

            const allSkills = [...turn.skills];
            const metaSk: string[] = (reply.metadata && Array.isArray(reply.metadata.skills) ? reply.metadata.skills as string[] : []);
            for (const n of metaSk) { if (!allSkills.includes(n)) allSkills.push(n); }

            setTurns((prev) => {
                const u = [...prev]; const l = u[u.length - 1];
                if (l) {
                    l.assistantText = reply.text; l.completedAt = new Date().toISOString();
                    l.metadata = reply.metadata; l.skills = allSkills;
                    l.mcpCalls = curTurnRef.current?.mcpCalls ?? []; l.blackboardText = bb;
                }
                return u;
            });
        } catch (err) {
            const et = err instanceof Error ? err.message : String(err);
            setError(et);
            setTurns((prev) => {
                const u = [...prev]; const l = u[u.length - 1];
                if (l) { l.assistantText = l.assistantText || `Error: ${et}`; l.completedAt = new Date().toISOString(); }
                return u;
            });
        } finally {
            curTurnRef.current = null; procRef.current = false;
            setProcessing(false); setPhase("idle");
        }
    }, [input, runtime, approveMcpToolCall, userId]);

    /* ── Toggle expand ── */
    const toggle = useCallback((id: string, s: Section) => {
        setExpanded((prev) => {
            const n = new Map(prev);
            const cur = n.get(id) ?? emptySections();
            n.set(id, { ...cur, [s]: !cur[s] });
            return n;
        });
    }, []);

    /* ── Keyboard ── */
    useInput(
        (ch, key) => {
            // Global shortcuts always fire
            if (key.escape || (key.ctrl && ch === "c")) { exit(); return; }
            if (key.ctrl && ch === "l") { setTurns([]); setError(null); setScrollOfs(0); return; }

            // Submit
            if (key.return && !processing) { void submit(); return; }

            // Scroll: Up/Down/Page/Home/End only
            if (key.upArrow) { setScrollOfs((s) => Math.min(s + 1, Math.max(0, turns.length - 1))); return; }
            if (key.downArrow) { setScrollOfs((s) => Math.max(0, s - 1)); return; }
            if (key.pageUp) { setScrollOfs((s) => Math.min(s + maxTurns, Math.max(0, turns.length - 1))); return; }
            if (key.pageDown) { setScrollOfs((s) => Math.max(0, s - maxTurns)); return; }
            if (key.home) { setScrollOfs(turns.length - 1); return; }
            if (key.end) { setScrollOfs(0); return; }

            // Text input — only when not processing
            if (!processing) {
                if (key.backspace || key.delete) {
                    if (cursor > 0) { setInput((p) => p.slice(0, cursor - 1) + p.slice(cursor)); setCursor((c) => c - 1); }
                    return;
                }
                // Left/Right move cursor in input — NOT scroll
                if (key.leftArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
                if (key.rightArrow) { setCursor((c) => Math.min(input.length, c + 1)); return; }
                if (key.ctrl && ch === "u") { setInput(""); setCursor(0); return; }
                if (key.ctrl && ch === "w") {
                    setInput((p) => {
                        const be = p.lastIndexOf(" ", cursor - 1);
                        const a = p.slice(cursor);
                        const b = be >= 0 ? p.slice(0, be + 1) : "";
                        setCursor(b.length); return b + a;
                    }); return;
                }
                // Printable character
                if (ch.length === 1 && ch.charCodeAt(0) >= 32) {
                    setInput((p) => p.slice(0, cursor) + ch + p.slice(cursor));
                    setCursor((c) => c + 1); return;
                }
            }
        },
        { isActive: true },
    );

    const sep = "─".repeat(Math.max(0, termCols - 1));
    // Keep input visible text short enough to fit one line
    const maxInputLen = Math.max(10, termCols - 6);
    const displayInput = input.length > maxInputLen ? input.slice(0, maxInputLen - 1) + "…" : input;

    return (
        <Box flexDirection="column" height={termRows} overflow="hidden">
            {/* Header — 1 line */}
            <Box marginLeft={1} marginRight={1} minHeight={1}>
                <Text bold color="cyan">{agentName}</Text>
                <Text dimColor>  • chat</Text>
                <Box flexGrow={1} />
                {scrollOfs > 0 ? <Text color="yellow">↑ {scrollOfs} more  </Text> : null}
                <Text dimColor>↑↓ scroll ↵ send ^C quit ^L clear</Text>
            </Box>

            {/* Header separator */}
            <Box minHeight={1}><Text dimColor>{sep}</Text></Box>

            {/* Conversation — fills remaining space */}
            <Box flexGrow={1} flexDirection="column" overflow="hidden" marginLeft={1} marginRight={1}>
                {turns.length === 0 && !processing ? (
                    <Box flexGrow={1} justifyContent="center" alignItems="center">
                        <Box flexDirection="column" alignItems="center">
                            <Text dimColor>Start a conversation</Text>
                            <Text dimColor>Type a message and press Enter</Text>
                        </Box>
                    </Box>
                ) : (
                    <Box flexDirection="column" overflow="hidden">
                        {visibleTurns.map((turn, i) => (
                            <Box key={turn.id} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
                                <TurnView turn={turn} expanded={expanded.get(turn.id) ?? emptySections()} />
                                {i < visibleTurns.length - 1 ? <Box minHeight={1}><Text dimColor>{sep}</Text></Box> : null}
                            </Box>
                        ))}

                        {processing && (
                            <Box marginTop={1}>
                                <ProcessingView phase={phase} userMsg={curTurnRef.current?.userMessage ?? ""} />
                            </Box>
                        )}

                        {error ? (
                            <Box marginTop={1}>
                                <Text color="red">✗ {error}</Text>
                            </Box>
                        ) : null}
                    </Box>
                )}
            </Box>

            {/* Bottom separator */}
            <Box minHeight={1}><Text dimColor>{sep}</Text></Box>

            {/* Input bar — fixed at bottom */}
            <Box minHeight={1} marginLeft={1} marginRight={1} marginBottom={1}>
                <Text color="cyan">❯</Text>
                <Box paddingLeft={1} flexGrow={1}>
                    {displayInput.length > 0 ? (
                        <Text>{displayInput}</Text>
                    ) : (
                        <Text dimColor>{processing ? "Waiting..." : "Type a message..."}</Text>
                    )}
                </Box>
                {processing ? (
                    <Box marginRight={1}>
                        <Text color={c(PHASE_DEF[phase].color)}>{PHASE_DEF[phase].frames[0]}</Text>
                    </Box>
                ) : null}
                {!processing ? (
                    <Text color="cyan">▎</Text>
                ) : null}
            </Box>
        </Box>
    );
}

/* ─── Entry ─────────────────────────────────────────── */

export function startChatTui(
    runtime: RuntimeModule,
    options: {
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
        eventBus?: RuntimeEventBus;
        agentName?: string;
        userId?: string;
    } = {},
): void {
    render(
        <ChatTui
            runtime={runtime}
            eventBus={options.eventBus}
            approveMcpToolCall={options.approveMcpToolCall}
            agentName={options.agentName}
            userId={options.userId}
        />,
    ).waitUntilExit().catch(() => {});
}
