import { CttlPermission, CttlToolCategory } from "../protocol/contracts/index.ts";
import {
    CttlComputerControlAction,
    type CttlComputerControlProfile,
    type CttlToolDescriptor,
} from "./types.ts";

/**
 * Executive-owned normalization for computer-control capabilities.
 *
 * Computer control is a stable exoskeleton contract, not a transport detail.
 * Different sources (MCP / plugin / user tool) may expose these capabilities,
 * but they all normalize through the same profile so Trust / Sandbox can apply
 * one approval surface.
 */
export class CttlComputerProfileComponent {
    public profileFor(descriptor: CttlToolDescriptor): CttlComputerControlProfile | undefined {
        if (descriptor.computer) {
            return descriptor.computer;
        }
        if (descriptor.category !== CttlToolCategory.Computer && descriptor.permission !== CttlPermission.Computer) {
            return undefined;
        }
        return {
            action: this.actionFor(descriptor),
            observationOnly: descriptor.readOnly,
            requiresFocusTarget: this.requiresFocusTarget(descriptor),
        };
    }

    public isComputerControlled(descriptor: CttlToolDescriptor): boolean {
        return this.profileFor(descriptor) !== undefined;
    }

    private actionFor(descriptor: CttlToolDescriptor): CttlComputerControlAction {
        return descriptor.readOnly ? CttlComputerControlAction.Screen : CttlComputerControlAction.Browser;
    }

    private requiresFocusTarget(descriptor: CttlToolDescriptor): boolean {
        if (descriptor.readOnly) {
            return false;
        }
        return descriptor.exclusive || descriptor.permission === CttlPermission.Computer;
    }
}

const defaultComputerProfile = new CttlComputerProfileComponent();

export function profileComputerControlledTool(
    descriptor: CttlToolDescriptor,
): CttlComputerControlProfile | undefined {
    return defaultComputerProfile.profileFor(descriptor);
}
