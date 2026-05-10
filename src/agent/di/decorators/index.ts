export { Channel } from "./channel.ts";
export { Component } from "./component.ts";
export { Inject } from "./inject.ts";
export { Module } from "./module.ts";
export { Plugin } from "./plugin.ts";
export { Provide, type ProvideDecoratorOptions } from "./provide.ts";
export { Service } from "./service.ts";
export { Worker } from "./worker.ts";
export {
    readComponentMetadata as getComponentMetadata,
    readModuleMetadata as getModuleMetadata,
    type ComponentDecoratorOptions,
    type ComponentMetadata,
    type ModuleDecoratorOptions,
    type ModuleMetadata,
} from "../composition/index.ts";
