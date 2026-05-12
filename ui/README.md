# Flyflor CLI / Chat TUI UI 重设计提案

本目录产出的是一套“可落地”的终端 UI 设计方案，目标覆盖两类入口：

1. `flyflor tui` 的运维/总览型 TUI
2. `flyflor chat` 以及 `docker exec -it flyflor-dev flyflor` 进入后的聊天 TUI

设计原则：
- 先尊重当前代码能力，再做增强设计
- UI 只使用 Ink 现有可稳定支持的终端交互能力：文本、颜色、边框、布局、键盘输入、定时刷新、有限滚动
- 不依赖鼠标 hover、复杂弹层、像素级排版、真实图层叠加、不可控 Unicode 艺术字
- 对 docker exec 低配终端、窄宽度、中文输入、滚动历史都要友好

建议先阅读：
- `ui/01.product-and-code-constraints.md`
- `ui/02.information-architecture.md`
- `ui/03.chat-tui-redesign.md`
- `ui/04.ops-tui-redesign.md`
- `ui/05.interaction-flows.md`
- `ui/06.implementation-mapping.md`
- `ui/07.visual-spec.md`
- `ui/08.high-fidelity-mockups.html`
- `ui/09.excalidraw-ui-flow.excalidraw`
- `ui/10.feihua-brand-extraction.md`

产物说明：
- Markdown：产品定义、信息架构、交互与工程映射
- HTML：高保真终端风格交互图与界面稿
- Excalidraw：流程图/状态图，方便二次讨论

建议评审顺序：
1. 先看 HTML 视觉稿
2. 再看 information architecture 与 interaction flows
3. 最后看 implementation mapping，确认分阶段落地
