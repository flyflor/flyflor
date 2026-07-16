/**
 * ZH: 进程入口：在任何 application class 前加载 decorator metadata，再启动 AppModule。
 * EN: Process entry that loads decorator metadata before any application class, then boots AppModule.
 */
import 'reflect-metadata';

import { AppModule } from '@/app';
import { Factory } from '@/core';

await Factory.create(AppModule);
