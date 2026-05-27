# User Tool 工作目录边界

`.flyflor/tools.jsonc` 里的 user manifest tools 和 `tools/external.tools.jsonc` 里的 external sidecars 复用同一条 process-json runner，但它们的 `cwd` anchor 必须明确区分。

- User manifest 的 `cwd: "project"` 从 `paths.projectDir` 启动，因此项目相对工具脚本和 workspace-local command 语义一致。
- External sidecar 的 `cwd: "project"` 继续作为 app-root anchor 的兼容别名，因为 `external.tools.jsonc` package entry 已按这个约定封板。
- `cwd: "app"`、`cwd: "config"`、`cwd: "workspace"` 保持各自显式 anchor。

这让项目工具保持易用，同时不改变已封板的 external sidecar 协议。执行仍经过 plugin sandbox gate、approval policy、quota、subprocess JSON bridge 和 runtime events。
