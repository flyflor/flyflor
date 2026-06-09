import { FCortex, Inject, Logger, Service, type AgentSignal, type FLogger } from '@/core';
import { type FAgentProfileConfiguration } from '@/config';
import { Observable } from 'rxjs';
import { Intelligence, type AgentMemory } from './intelligence';

/**
 * The brain: one cortical reflex that turns assembled mental input into a stream of model signals.
 *
 * `Brain` is pure inference — it owns no conversation context and never mutates memory. It maps the
 * agent's `AgentMemory[]` mental input into a cold `Observable<AgentSignal>`, the seam a future
 * reflection loop will extend.
 */
@Service()
export class Brain extends FCortex<AgentMemory[], AgentSignal> {
    @Inject()
    public intelligence!: Intelligence;

    @Logger(Brain.name)
    public readonly log!: FLogger;

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    public transform(messages: AgentMemory[]): Observable<AgentSignal> {
        return new Observable<AgentSignal>((subscriber) => {
            this.log.debug('reflex.start', { messages });
            const reader = this.intelligence.reader(messages);
            (async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            this.log.debug('reflex.delta', value);
                            subscriber.next({ type: 'delta', text: value });
                        }
                    }
                    this.log.debug('reflex.done');
                    subscriber.next({ type: 'done' });
                    subscriber.complete();
                } catch (error) {
                    this.log.error('reflex.error', error);
                    subscriber.error(error);
                } finally {
                    reader.releaseLock();
                }
            })();
            // Teardown on unsubscribe (caller stopped early): cancel the provider read, never complete.
            return () => {
                this.log.debug('reflex.cancel');
                void reader.cancel().catch(() => undefined);
            };
        });
    }
}
