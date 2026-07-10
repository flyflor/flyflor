// reflect-metadata must load before any decorated class is imported,
// so this side-effect import stays at the very top of the entry file.
import 'reflect-metadata';

import { useContainer } from '@/core';
import { Synapse } from '@/neural';
import { AppModule } from './app.module';

const container = useContainer();
await container.getAsync(AppModule);
await container.getAsync(Synapse);
