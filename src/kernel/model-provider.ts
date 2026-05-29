import { Component } from "../di";
import type { ContextMessage } from "../context";
import type { MemoryRecallResult } from "../memory";

/**
 * Describes a model provider request.
 *
 * @property model - Configured model id.
 * @property messages - Fully assembled no-session context messages.
 * @property userInput - Current user input.
 * @property recall - Memory recall diagnostics used by deterministic providers.
 * @usage AgentRuntimeService passes this shape to provider adapters.
 */
export interface ModelRequest {
  readonly model: string;
  readonly messages: readonly ContextMessage[];
  readonly userInput: string;
  readonly recall: readonly MemoryRecallResult[];
}

/**
 * Describes one streamed model event.
 *
 * @property type - Event kind emitted by the provider.
 * @property text - Optional assistant text delta or final text.
 * @usage Runtime turns provider events into SignalBus and socket events.
 */
export interface ModelStreamEvent {
  readonly type: "delta" | "final";
  readonly text: string;
}

/**
 * Describes the model adapter contract.
 *
 * @param request - Model request containing context and current user input.
 * @returns Async stream of model events.
 * @usage Real providers and mock providers implement this interface.
 */
export interface ModelProvider {
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

/**
 * Deterministic provider used by v1 scenario tests and local socket smoke checks.
 *
 * @usage This provider exercises the full runtime path without external LLM credentials.
 */
@Component()
export class MockModelProvider implements ModelProvider {
  /**
   * Streams a deterministic answer based on current input and recalled memory.
   *
   * @param request - Model request containing no-session context and memory recall.
   * @returns Async iterable with delta and final events.
   * @usage Tests assert continuity through this provider while avoiding network calls.
   */
  public async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const recalled = request.recall.map((item) => item.chunk.content).join(" | ");
    const answer = this.answerFor(request.userInput, recalled);
    const midpoint = Math.max(1, Math.floor(answer.length / 2));
    yield { type: "delta", text: answer.slice(0, midpoint) };
    yield { type: "delta", text: answer.slice(midpoint) };
    yield { type: "final", text: answer };
  }

  /**
   * Creates a stable assistant answer for a user input.
   *
   * @param userInput - Current user message.
   * @param recalled - Concatenated memory recall text.
   * @returns Final assistant answer.
   * @usage Keeps scenario assertions deterministic.
   */
  private answerFor(userInput: string, recalled: string): string {
    const projectCode = this.extractProjectCode(userInput) ?? this.extractProjectCode(recalled);
    if (/项目代号|project code|codename/i.test(userInput) && projectCode) {
      return `我记得你的项目代号是 ${projectCode}。`;
    }
    if (recalled.length > 0) {
      return `已结合本地记忆处理：${userInput}\n\n召回：${recalled}`;
    }
    return `已处理：${userInput}`;
  }

  /**
   * Extracts a simple project code fact from text.
   *
   * @param text - User input or recalled memory text.
   * @returns Extracted project code, or undefined when absent.
   * @usage Supports the no-session continuity scenario.
   */
  private extractProjectCode(text: string): string | undefined {
    const match = text.match(/(?:项目代号(?:是|为)?|project code(?: is)?|codename(?: is)?)\s*[:：]?\s*([a-zA-Z0-9_.-]+)/i);
    return match?.[1];
  }
}
