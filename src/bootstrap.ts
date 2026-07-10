// reflect-metadata must load before any decorated application class.
import 'reflect-metadata';

import { AppModule } from './app';
import { Factory } from './core';

await Factory.create(AppModule);
