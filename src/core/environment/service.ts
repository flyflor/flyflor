import { sep } from 'path';
import { ROOT_PATH } from '@/config';
import { Service } from '@/core/decorator';
import { FService } from '@/core/ioc';
import { LINUX_PLATFORM, MACOS_PLATFORM, WINDOWS_PLATFORM } from './constants';
import type { EnvironmentSummary, OperatingSystemName } from './types';

@Service()
export class EnvironmentService extends FService {
    public summary(cwd = ROOT_PATH): EnvironmentSummary {
        return {
            platform: process.platform,
            os: this.osName(process.platform),
            arch: process.arch,
            cwd,
            pathSeparator: sep,
            defaultShell: this.defaultShell(process.platform),
            commandStyle: process.platform === WINDOWS_PLATFORM ? 'windows-cmd' : 'posix',
        };
    }

    public render(summary = this.summary()): string {
        return [
            `platform: ${summary.platform}`,
            `os: ${summary.os}`,
            `arch: ${summary.arch}`,
            `cwd: ${summary.cwd}`,
            `path_separator: ${summary.pathSeparator}`,
            `default_shell: ${summary.defaultShell}`,
            `command_style: ${summary.commandStyle}`,
        ].join('\n');
    }

    private osName(platform: NodeJS.Platform): OperatingSystemName {
        if (platform === MACOS_PLATFORM) return 'macos';
        if (platform === LINUX_PLATFORM) return 'linux';
        if (platform === WINDOWS_PLATFORM) return 'windows';
        return 'unknown';
    }

    private defaultShell(platform: NodeJS.Platform): string {
        if (platform === WINDOWS_PLATFORM) return process.env.ComSpec ?? 'cmd.exe';
        return process.env.SHELL ?? '/bin/sh';
    }
}
