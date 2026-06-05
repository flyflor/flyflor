import { Inject, FService, Service, useContainer, Init } from '@/core';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { ConfigComponent } from '@/config';
import type { UnixSocketListener } from 'bun';
import { join } from 'path';
import { ROOT_PATH } from '@/config/config.constants';
import { FSocket } from './socket';

/** Windows named-pipe prefix used internally while the public endpoint remains `./flyflor.sock`. */
const WINDOWS_NAMED_PIPE_PREFIX = '\\\\.\\pipe\\';

/** Relative prefix used by the public socket endpoint. */
const RELATIVE_PATH_PREFIX = './';

/**
 * The IPC module: external↔kernel boundary.
 *
 * Exposes one socket transport over the shared `IPCService` brain. The public endpoint is always
 * `./flyflor.sock`; platform-specific listen details stay encapsulated inside this module.
 */
@Service()
export class IPCService extends FService {
    @Inject()
    public readonly config!: ConfigComponent;

    public socketServer?: UnixSocketListener<any>;

    public toListenEndpoint(endpoint: string): string {
        if (process.platform !== 'win32') {
            return endpoint;
        }
        return WINDOWS_NAMED_PIPE_PREFIX + endpoint.replace(RELATIVE_PATH_PREFIX, '');
    }

    @Init()
    public async init() {
        const endpoint = join(ROOT_PATH, this.config.socket);
        const listenEndpoint = this.toListenEndpoint(endpoint);
        const { socket } = await useContainer().getAsync(FSocket);

        if (existsSync(listenEndpoint)) await unlink(listenEndpoint);
        this.socketServer = Bun.listen({ unix: listenEndpoint, socket: socket });
        console.log(`[IPC] Socket listening at ${endpoint}`);
    }
}
