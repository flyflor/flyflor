export type OperatingSystemName = 'macos' | 'linux' | 'windows' | 'unknown';

export interface EnvironmentSummary {
    platform: NodeJS.Platform;
    os: OperatingSystemName;
    arch: string;
    cwd: string;
    pathSeparator: string;
    defaultShell: string;
    commandStyle: 'posix' | 'windows-cmd';
}
