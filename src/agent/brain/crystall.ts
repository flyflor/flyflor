import { FService, Service } from '@/core';
import { AgentChatRole, type AgentMemory } from './intelligence';

// 晶体智力
@Service()
export class Crystall extends FService {
    public prepareTurn(messages: AgentMemory[]): AgentMemory[] {
        return messages;
    }

    public commitTurn(context: AgentMemory[], user: string, assistant: string): void {
        context.push({ role: AgentChatRole.User, content: user });
        context.push({ role: AgentChatRole.Assistant, content: assistant });
    }
}
