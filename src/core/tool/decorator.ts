import { Plugin } from '@/core/decorator';
import type { ClassType } from '@/core/ioc';
import type { FTool } from './abstracts';

const TOOL_CLASS_TYPES: Array<ClassType<FTool>> = [];

export function Tool(): ClassDecorator {
    return (target) => {
        Plugin()(target);
        const classType = target as unknown as ClassType<FTool>;
        if (!TOOL_CLASS_TYPES.includes(classType)) TOOL_CLASS_TYPES.push(classType);
    };
}

export function toolClassTypes(): Array<ClassType<FTool>> {
    return [...TOOL_CLASS_TYPES];
}
