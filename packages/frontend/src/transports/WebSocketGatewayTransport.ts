import type { GatewayConfig } from '@/stores/deviceStore';

export class WebSocketGatewayTransport {
    private ws: WebSocket | null = null;
    private config: GatewayConfig | null = null;

    private dataCallback: ((data: Uint8Array) => void) | null = null;
    private errorCallback: ((error: Error) => void) | null = null;
    private stateCallback: ((connected: boolean) => void) | null = null;

    get isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    async connect(options: GatewayConfig): Promise<void> {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            throw new Error('WebSocket 已连接或正在连接');
        }

        this.config = options;

        const port = options.wsPort ?? 81;
        const hasSchema = options.address.startsWith('ws://') || options.address.startsWith('wss://');
        const url = hasSchema ? options.address : `ws://${options.address}:${port}`;

        return await new Promise<void>((resolve, reject) => {
            try {
                const ws = new WebSocket(url);
                this.ws = ws;

                let timeoutId: number | null = window.setTimeout(() => {
                    timeoutId = null;
                    ws.close();
                    this.ws = null;
                    this.stateCallback?.(false);
                    const error = new Error('连接网关超时');
                    this.errorCallback?.(error);
                    reject(error);
                }, 5000);

                const clearTimeoutIfNeeded = (): void => {
                    if (timeoutId !== null) {
                        window.clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                };

                ws.onopen = () => {
                    clearTimeoutIfNeeded();
                    this.stateCallback?.(true);
                    resolve();
                };

                ws.onclose = () => {
                    clearTimeoutIfNeeded();
                    this.ws = null;
                    this.stateCallback?.(false);
                };

                ws.onerror = () => {
                    const error = new Error('WebSocket 连接错误');
                    this.errorCallback?.(error);
                };

                ws.onmessage = event => {
                    this.handleMessage(event);
                };
            } catch (error) {
                this.ws = null;
                this.stateCallback?.(false);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    async disconnect(): Promise<void> {
        if (!this.ws) {
            return;
        }

        try {
            this.ws.close();
        } catch (error) {
            this.errorCallback?.(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.ws = null;
            this.stateCallback?.(false);
        }
    }

    async send(data: Uint8Array): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket 未连接');
        }

        if (!this.config) {
            throw new Error('缺少网关配置');
        }

        const { protocol, tcpTarget, rtuTarget } = this.config;
        const hex = this.bytesToHex(data);

        const payload =
            protocol === 'tcp'
                ? {
                      transport: protocol,
                      tcpTarget: {
                          ip: tcpTarget.ip,
                          port: tcpTarget.port,
                          unitId: tcpTarget.unitId
                      },
                      hex
                  }
                : {
                      transport: protocol,
                      rtuTarget: {
                          slaveId: rtuTarget.slaveId,
                          baudRate: rtuTarget.baudRate,
                          dataBits: rtuTarget.dataBits,
                          stopBits: rtuTarget.stopBits,
                          parity: rtuTarget.parity
                      },
                      hex
                  };

        const json = JSON.stringify(payload);
        this.ws.send(json);
    }

    onData(callback: (data: Uint8Array) => void): void {
        this.dataCallback = callback;
    }

    onError(callback: (error: Error) => void): void {
        this.errorCallback = callback;
    }

    onStateChange(callback: (connected: boolean) => void): void {
        this.stateCallback = callback;
    }

    private handleMessage(event: MessageEvent): void {
        try {
            let text: string;

            if (typeof event.data === 'string') {
                text = event.data;
            } else if (event.data instanceof ArrayBuffer) {
                text = new TextDecoder().decode(event.data);
            } else {
                throw new Error('不支持的 WebSocket 消息类型');
            }

            const message = JSON.parse(text) as {
                status?: string;
                data?: number[];
                msg?: string;
                message?: string;
            };

            if (message.status === 'ok' && Array.isArray(message.data)) {
                const buffer = new Uint8Array(message.data);
                this.dataCallback?.(buffer);
            } else if (message.status === 'error') {
                const errorMessage = message.message ?? message.msg ?? '网关返回错误';
                this.errorCallback?.(new Error(errorMessage));
            }
        } catch (error) {
            this.errorCallback?.(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private bytesToHex(data: Uint8Array): string {
        return Array.from(data)
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join('');
    }
}
