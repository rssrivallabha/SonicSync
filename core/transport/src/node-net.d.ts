declare module "node:net" {
  export interface AddressInfo { address: string; family: string; port: number; }
  export interface Socket {
    setNoDelay(noDelay?: boolean): this;
    on(event: "connect", listener: () => void): this;
    on(event: "data", listener: (data: Uint8Array) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "drain", listener: () => void): this;
    write(data: Uint8Array): boolean;
    end(): void;
    destroy(): void;
  }
  export interface Server {
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "connection", listener: (socket: Socket) => void): this;
    address(): AddressInfo | string | null;
    listen(port: number, host: string, callback: () => void): this;
    close(callback?: (error?: Error) => void): this;
  }
  export function createConnection(options: { host: string; port: number }): Socket;
  export function createServer(): Server;
}
