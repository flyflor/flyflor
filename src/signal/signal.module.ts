import { Module } from "../di";
import { SignalBus } from "./signal.bus.service";

/**
 * Assembles the signal vascular layer for runtime coordination.
 *
 * @usage Future implementation will provide `SignalBus` and guard/confirm adapters through this module.
 */
@Module({
  providers: [SignalBus],
  exports: [SignalBus],
})
export class SignalModule {}
