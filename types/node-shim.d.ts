declare const __dirname: string;
declare const process: {
  argv: string[];
  execPath: string;
  cwd(): string;
  on(event: string, listener: (...args: any[]) => void): void;
  exit(code?: number): never;
};

type Buffer = any;

declare module 'node:http' {
  const http: any;
  export default http;
}

declare module 'node:fs' {
  const fs: any;
  export default fs;
}

declare module 'node:os' {
  const os: any;
  export default os;
}

declare module 'node:path' {
  const path: any;
  export default path;
}

declare module 'node:url' {
  export const URL: any;
}

declare module 'node:crypto' {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string };
    digest(encoding: string): string;
  };
}

declare module 'node:child_process' {
  export function execFile(command: string, args?: string[], options?: any): any;
  export function spawn(command: string, args?: string[], options?: any): any;
}

declare module 'node:util' {
  export function promisify(fn: any): any;
}

declare module 'node:process' {
  const process: {
    argv: string[];
    execPath: string;
    cwd(): string;
    on(event: string, listener: (...args: any[]) => void): void;
    exit(code?: number): never;
  };
  export default process;
}
