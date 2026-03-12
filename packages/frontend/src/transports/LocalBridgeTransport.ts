/**
 * 本地桥接传输层适配器 (WebSocket -> Go Bridge -> UDP)
 */

import {
    TransportType,
    type ConnectionConfig,
    type ITransportAdapter
} from '@shared/types/transport.types';

export class LocalBridgeTransport implements ITransportAdapter {
    readonly type = TransportType.BRIDGE;

    private ws: WebSocket | null = null;
    private _isConnected = false;
    private targetIp = '127.0.0.1';
    private targetPort = 47808;

    private dataCallback: ((data: Uint8Array) => void) | null = null;
    private errorCallback: ((error: Error) => void) | null = null;
    private stateChangeCallback: ((connected: boolean) => void) | null = null;

    get isConnected(): boolean {
        return this._isConnected;
    }

    setTarget(ip: string, port: number = 47808) {
        this.targetIp = ip;
        this.targetPort = port;
    }

    async connect(config: ConnectionConfig): Promise<void> {
        const cfg = config as any;
        if (cfg?.tcpTarget?.ip) {
            this.setTarget(cfg.tcpTarget.ip, cfg.tcpTarget.port || 47808);
        }

        return new Promise((resolve, reject) => {
            try {
                // 默认连接本地桥接程序
                this.ws = new WebSocket('ws://127.0.0.1:8081/ws');
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    this._isConnected = true;
                    this.stateChangeCallback?.(true);
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'rx' && msg.payload) {
                            const hex = msg.payload as string;
                            const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
                            this.dataCallback?.(bytes);
                        }
                    } catch (e) {
                        console.error('Bridge message parse error:', e);
                    }
                };

                this.ws.onerror = (_event) => {
                    const err = new Error('WebSocket connection error');
                    this.errorCallback?.(err);
                    if (!this._isConnected) reject(err);
                };

                this.ws.onclose = () => {
                    this._isConnected = false;
                    this.stateChangeCallback?.(false);
                };
            } catch (e) {
                reject(e);
            }
        });
    }

    async disconnect(): Promise<void> {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._isConnected = false;
        this.stateChangeCallback?.(false);
    }

    async send(data: Uint8Array): Promise<void> {
        if (!this.ws || !this._isConnected) {
            throw new Error('Bridge not connected');
        }

        const hex = Array.from(data)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        const msg = {
            type: 'tx',
            target: `${this.targetIp}:${this.targetPort}`,
            payload: hex
        };

        this.ws.send(JSON.stringify(msg));
    }

    onData(callback: (data: Uint8Array) => void): void {
        this.dataCallback = callback;
    }

    onError(callback: (error: Error) => void): void {
        this.errorCallback = callback;
    }

    onStateChange(callback: (connected: boolean) => void): void {
        this.stateChangeCallback = callback;
    }
}
