// 临时 IPC 测试客户端：连接 unix socket，发消息，等待 LLM 流式响应
const endpoint = "./flyflor.sock";

const socket = await Bun.connect({
    unix: endpoint,
    socket: {
        data(socket, data) {
            const text = Buffer.from(data).toString("utf8").trim();
            for (const line of text.split("\n")) {
                if (!line) continue;
                try {
                    const msg = JSON.parse(line);
                    console.log(`[${msg.kind}] ${msg.content}`);
                } catch {
                    console.log(`[raw] ${line}`);
                }
            }
        },
        open() {
            console.log("✓ Connected to flyflor.sock");
        },
        error(_s, e) {
            console.error("Socket error:", e);
        },
    },
});

// 等欢迎消息
await Bun.sleep(500);

// 发送测试消息
const userMsg = process.argv[2] ?? "你好，用一句话介绍你自己";
console.log(`\n→ 发送: ${userMsg}\n`);
socket.write(JSON.stringify({ kind: "user", content: userMsg }) + "\n");

// 等 LLM 响应（流式，可能 3-8s）
await Bun.sleep(12000);
socket.end();
console.log("\n✓ 测试结束");
process.exit(0);
