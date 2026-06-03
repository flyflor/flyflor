// reflect-metadata must load before any decorated class is imported,
// so this side-effect import stays at the very top of the entry file.
import "reflect-metadata";

import { Factory, useContainer } from "@/core";
import { AppModule } from "@/module.ts";

const socketUrl = await Factory.create(AppModule);
console.log(`Flyflor socket listening at ${socketUrl}`);
