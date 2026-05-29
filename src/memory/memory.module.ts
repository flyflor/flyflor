import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { MemoryComponent } from "./memory.component";
import { SqliteVecLoader } from "./sqlite-vec-loader";

/**
 * Assembles the local memory database and recall component.
 *
 * @usage Runtime imports this module when no-session memory is required.
 */
@Module({
  imports: [ConfigModule],
  providers: [MemoryComponent, SqliteVecLoader],
  exports: [MemoryComponent, SqliteVecLoader],
})
export class MemoryModule {}
