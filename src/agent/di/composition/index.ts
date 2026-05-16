export {
    isComponentKind,
    readComponentMetadata,
    registerComponentMetadata,
    type ComponentCompatibility,
    type ComponentDecoratorOptions,
    type ComponentMetadata,
    type ComponentProviderMetadata,
    type ComponentProviderOptions,
    type ComponentConstructor,
    type FpcComponentConstructor,
} from "./component.metadata.ts";
export { readInjectionMetadata, registerInjectionMetadata, type InjectionMetadata } from "./injection.metadata.ts";
export {
    readEventMetadata,
    registerEventMetadata,
    type EventHandler,
    type EventHandlerMetadata,
    type EventHandlerSelector,
} from "./event.metadata.ts";
export {
    assertModuleMetadata,
    readModuleMetadata,
    registerModuleMetadata,
    type ModuleDecoratorOptions,
    type ModuleMetadata,
    type ModuleProviderToken,
} from "./module.metadata.ts";
