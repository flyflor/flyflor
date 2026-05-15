// Thin compile entrypoint for OpenTUI's TreeSitter worker.
// Bun standalone executables only bundle worker dependencies when the worker is
// listed as a build entrypoint; importing the upstream worker keeps that boundary explicit.
import "../../../../node_modules/@opentui/core/parser.worker.js";
