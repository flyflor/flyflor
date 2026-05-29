import { Module } from "../di";

/**
 * Assembles external WebSocket transport adapters.
 *
 * @usage Keep socket classes as adapters only; kernel behavior belongs under `src/kernel`.
 */
@Module({})
export class SocketModule {}
