import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { KernelModule } from "../kernel";
import { SocketServerService } from "./socket-server.service";

/**
 * Assembles external WebSocket transport adapters.
 *
 * @usage Keep socket classes as adapters only; kernel behavior belongs under `src/kernel`.
 */
@Module({
  imports: [ConfigModule, KernelModule],
  providers: [SocketServerService],
  exports: [SocketServerService],
})
export class SocketModule {}
