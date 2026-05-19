/**
 * Deprecated first-party command surface.
 *
 * R7 开始该目录进入退役剥离期：允许薄兼容层、删减、协议适配和测试护栏，
 * 不再承载新的长期产品能力。后续目标是迁到根级 `abandon/`、外部套件仓库，
 * 或被 Rust 新实现替代。
 */
export * from "./command.ts";
