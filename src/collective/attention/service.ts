import type { Stimulus } from '@/collective/context';
import type { Spike } from '@/collective/scout';
import type { ConfigService } from '@/configuration';
import { Config, FService, Singleton } from '@/core';
import type { QueuedStimulus } from './types';

/**
 * EN: The collective's attention gate (thalamic relay): a bounded, fair waiting queue.
 * Detection lives in the Scout; the Cortex merges or queues here based on each spike.
 * ZH: 群体的注意力闸门（丘脑接力）：有界且公平的等待队列。检测属于侦察者；
 * 皮层依据每次放电信号在此合并或排队。
 */
@Singleton()
export class Attention extends FService {
    @Config()
    public config!: ConfigService;

    private readonly waiting: QueuedStimulus[] = [];

    /**
     * EN: Queues one stimulus together with the spike that rated it.
     * ZH: 把一条刺激连同评定它的放电信号一起入队。
     */
    public enqueue(stimulus: Stimulus, spike: Spike): void {
        if (this.waiting.length >= this.config.collective.queueLimit) throw Error('Attention queue is full');
        this.waiting.push({
            stimulus: structuredClone(stimulus),
            salience: spike.salience,
            consultants: [...spike.consultants],
            queuedAt: Date.now(),
        });
    }

    /**
     * EN: Picks the next stimulus by salience, waiting age, and speaker fairness.
     * ZH: 按显著性、等待时长与说话者公平性选出下一条刺激。
     */
    public next(lastSpeakerId?: string): QueuedStimulus | undefined {
        if (this.waiting.length === 0) return undefined;
        const now = Date.now();
        let selected = 0;
        let score = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < this.waiting.length; index += 1) {
            const candidate = this.waiting[index]!;
            const age = Math.min(1, (now - candidate.queuedAt) / 30000);
            const fairness = candidate.stimulus.speakerId === lastSpeakerId ? 0 : 0.25;
            const current = candidate.salience + age + fairness;
            if (current > score) {
                selected = index;
                score = current;
            }
        }
        return this.waiting.splice(selected, 1)[0];
    }

    /**
     * EN: Pulls every queued stimulus that explicitly replies into the given chain.
     * ZH: 取出所有显式回复进给定链的排队刺激。
     */
    public takeReplies(messageIds: string[]): QueuedStimulus[] {
        const related: QueuedStimulus[] = [];
        const sources = new Set(messageIds);
        let found = true;
        while (found) {
            found = false;
            for (let index = 0; index < this.waiting.length; index += 1) {
                const candidate = this.waiting[index]!;
                if (!candidate.stimulus.replyTo || !sources.has(candidate.stimulus.replyTo)) continue;
                this.waiting.splice(index, 1);
                related.push(candidate);
                sources.add(candidate.stimulus.messageId);
                found = true;
                index -= 1;
            }
        }
        return related;
    }

    public size(): number {
        return this.waiting.length;
    }

    /**
     * EN: Attaches a reconnected transport to a queued stimulus.
     * ZH: 把重连后的传输附着到排队中的刺激。
     */
    public reconnect(messageId: string, speakerId: string, connectionId: string): void {
        const queued = this.waiting.find((item) => item.stimulus.messageId === messageId && item.stimulus.speakerId === speakerId);
        if (queued) queued.stimulus.connectionId = connectionId;
    }
}
