import { FModule, Module } from "@/core";
import { ConfigComponent } from "./components/config";
import { MemoryComponent } from "./components/memory";
import { ContextComponent } from "./components/context";

@Module({
    providers: [ConfigComponent, MemoryComponent, ContextComponent],
    exports: [ConfigComponent, MemoryComponent, ContextComponent],
})
export class ShardModule extends FModule {}
