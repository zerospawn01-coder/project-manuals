declare module 'ws' {
  class WebSocket {
    readyState: number;
    send(data: unknown): void;
    close(code?: number, data?: unknown): void;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  class WebSocketServer {
    clients: Set<WebSocket>;
    constructor(options?: Record<string, unknown>);
    handleUpgrade(request: unknown, socket: unknown, head: unknown, callback: (ws: WebSocket) => void): void;
    on(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
  }

  export { WebSocket, WebSocketServer };
}