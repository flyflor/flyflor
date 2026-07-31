// reflect-metadata must load before any decorated class is imported,
// so this side-effect import stays at the very top of the entry file.
import 'reflect-metadata';

import { Factory } from '@/core';
import { AppModule } from './app.module';

const app = await Factory.create(AppModule);
await app.population();
