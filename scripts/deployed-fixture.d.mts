/** `deployed-fixture.mjs`, typed for the command-line tests. */
export declare const DEPLOYED_CONFIG: Record<string, unknown>;

export declare const makeDeployedProject: (root: string) => { scratch: string; project: string; config: string };

export declare const SHIPPED: { service: string[]; head: string };

export declare const checkedDeployedProject: (root: string) => Promise<{ scratch: string; project: string; config: string }>;
