/**
 * EN: Chat roles Flyflor uses when talking to a provider.
 * ZH: Flyflor 与 provider 对话时使用的聊天角色。
 */
export enum ChatRole {
    /** EN: System instruction message. ZH: 系统指令消息。 */
    System = 'system',
    /** EN: User input message. ZH: 用户输入消息。 */
    User = 'user',
    /** EN: Assistant output message. ZH: assistant 输出消息。 */
    Assistant = 'assistant',
}

/**
 * EN: One pure provider message produced by the mind.
 * ZH: 心智生成的一条纯 provider 消息。
 */
export interface MindMessage {
    /** EN: Chat role of the message. ZH: 消息的聊天角色。 */
    role: ChatRole.System | ChatRole.User | ChatRole.Assistant;
    /** EN: Text content of the message. ZH: 消息的文本内容。 */
    content: string;
}

/**
 * EN: One stimulus handed to the brain: what was said, who said it, and the
 * stimulus it grew from. Session-less: identity is only the speaker id.
 * ZH: 交给大脑的一条刺激:说了什么、谁说的、它源自哪条刺激。
 * 无 session:身份只有 speaker id。
 */
export interface BrainInput {
    /** EN: Raw stimulus text. ZH: 原始刺激文本。 */
    text: string;
    /** EN: Identity of the speaker who produced the stimulus. ZH: 产生该刺激的说话者身份。 */
    speakerId: string;
    /** EN: Identifier of the stimulus this input grew from. ZH: 该输入源自的刺激标识。 */
    stimulusId?: string;
    /** EN: Attention relation selected by Thalamus; absent means a new turn. ZH: Thalamus 选出的注意力关系；缺省表示开启新回合。 */
    relation?: 'same' | 'new';
    /** EN: Turn to revise when the relation is `same`. ZH: 关系为 `same` 时要修订的 turn。 */
    targetTurnId?: string;
    /** EN: Cancellation signal for the whole input pipeline. ZH: 整条输入管线的取消信号。 */
    signal?: AbortSignal;
}
