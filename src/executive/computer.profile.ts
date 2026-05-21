import { ToolPermission, ToolCategory } from "../protocol/contracts/index.ts";
import {
    ComputerControlAction,
    type ComputerControlProfile,
    type ToolDescriptor,
} from "./types.ts";

/**
 * Executive-owned normalization for computer-control capabilities.
 *
 * Computer control is a stable exoskeleton contract, not a transport detail.
 * Different sources (MCP / plugin / user tool) may expose these capabilities,
 * but they all normalize through the same profile so Trust / Sandbox can apply
 * one approval surface.
 */
export class ComputerProfileComponent {
    public profileFor(descriptor: ToolDescriptor): ComputerControlProfile | undefined {
        if (descriptor.computer) {
            return descriptor.computer;
        }
        if (descriptor.category !== ToolCategory.Computer && descriptor.permission !== ToolPermission.Computer) {
            return undefined;
        }
        return {
            action: this.actionFor(descriptor),
            observationOnly: descriptor.readOnly,
            requiresFocusTarget: this.requiresFocusTarget(descriptor),
        };
    }

    public isComputerControlled(descriptor: ToolDescriptor): boolean {
        return this.profileFor(descriptor) !== undefined;
    }

    private actionFor(descriptor: ToolDescriptor): ComputerControlAction {
        return descriptor.readOnly ? ComputerControlAction.Screen : ComputerControlAction.Browser;
    }

    private requiresFocusTarget(descriptor: ToolDescriptor): boolean {
        if (descriptor.readOnly) {
            return false;
        }
        return descriptor.exclusive || descriptor.permission === ToolPermission.Computer;
    }
}

const defaultComputerProfile = new ComputerProfileComponent();

export function profileComputerControlledTool(
    descriptor: ToolDescriptor,
): ComputerControlProfile | undefined {
    return defaultComputerProfile.profileFor(descriptor);
}
