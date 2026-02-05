/**
 * Web Serial API 传输层适配器
 * 实现本地串口直连功能
 */

import {
    TransportType,
    type ConnectionConfig,
    type ITransportAdapter
} from '@shared/types/transport.types';

/**
 * Web Serial 传输层实现
 */
export class WebSerialTransport implements ITransportAdapter {
    readonly type = TransportType.WEB_SERIAL;

    private port: SerialPort | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private readLoopPromise: Promise<void> | null = null;
    private isReading = false;

    private dataCallback: ((data: Uint8Array) => void) | null = null;
    private errorCallback: ((error: Error) => void) | null = null;
    private stateChangeCallback: ((connected: boolean) => void) | null = null;

    private _isConnected = false;

    get isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * 检查浏览器是否支持 Web Serial API
     */
    static isSupported(): boolean {
        return 'serial' in navigator;
    }

    /**
     * 获取可用的串口列表
     */
    static async getPorts(): Promise<SerialPort[]> {
        if (!WebSerialTransport.isSupported()) {
            throw new Error('当前浏览器不支持 Web Serial API，请使用 Chrome 89+ 或 Edge 89+');
        }
        return await navigator.serial.getPorts();
    }

    /**
     * 请求用户选择串口
     */
    static async requestPort(): Promise<SerialPort> {
        if (!WebSerialTransport.isSupported()) {
            throw new Error('当前浏览器不支持 Web Serial API，请使用 Chrome 89+ 或 Edge 89+');
        }
        return await navigator.serial.requestPort();
    }

    /**
     * 建立连接
     */
    async connect(config: ConnectionConfig): Promise<void> {
        if (!WebSerialTransport.isSupported()) {
            throw new Error('当前浏览器不支持 Web Serial API');
        }

        if (this._isConnected) {
            throw new Error('已经连接，请先断开');
        }

        const serialConfig = config.serial;
        if (!serialConfig) {
            throw new Error('缺少串口配置');
        }

        try {
            // 请求用户选择串口
            this.port = await navigator.serial.requestPort();

            // 打开串口
            await this.port.open({
                baudRate: serialConfig.baudRate,
                dataBits: serialConfig.dataBits ?? 8,
                stopBits: serialConfig.stopBits ?? 1,
                parity: serialConfig.parity ?? 'none',
                flowControl: serialConfig.flowControl ?? 'none'
            });

            // 获取读写流
            if (this.port.readable) {
                this.reader = this.port.readable.getReader();
            }
            if (this.port.writable) {
                this.writer = this.port.writable.getWriter();
            }

            this._isConnected = true;
            this.stateChangeCallback?.(true);

            // 启动读取循环
            this.startReadLoop();
        } catch (error) {
            this._isConnected = false;
            this.stateChangeCallback?.(false);
            throw error;
        }
    }

    /**
     * 断开连接
     */
    async disconnect(): Promise<void> {
        this.isReading = false;

        // 1. 先取消读取器，这会让 readLoop 中的 await reader.read() 立即返回
        if (this.reader) {
            try {
                await this.reader.cancel();
            } catch (err) {
                console.warn('取消读取器失败:', err);
            }
        }

        // 2. 现在可以安全地等待读取循环结束
        if (this.readLoopPromise) {
            try {
                await this.readLoopPromise;
            } catch (err) {
                // 忽略错误
            }
            this.readLoopPromise = null;
        }

        // 3. 释放读取器锁
        if (this.reader) {
            try {
                this.reader.releaseLock();
            } catch (err) {
                console.warn('释放读取器锁失败:', err);
            }
            this.reader = null;
        }

        // 4. 释放写入器
        if (this.writer) {
            try {
                // 写操作可能正在进行，close 会等待它完成
                await this.writer.close();
                this.writer.releaseLock();
            } catch (err) {
                console.warn('关闭写入器失败:', err);
            }
            this.writer = null;
        }

        // 5. 最后关闭端口
        if (this.port) {
            try {
                await this.port.close();
            } catch (err) {
                console.error('关闭串口失败:', err);
            }
            this.port = null;
        }

        this._isConnected = false;
        this.stateChangeCallback?.(false);
    }

    /**
     * 发送数据
     */
    async send(data: Uint8Array): Promise<void> {
        if (!this._isConnected || !this.writer) {
            throw new Error('未连接，无法发送数据');
        }

        await this.writer.write(data);
    }

    /**
     * 注册数据接收回调
     */
    onData(callback: (data: Uint8Array) => void): void {
        this.dataCallback = callback;
    }

    /**
     * 注册错误回调
     */
    onError(callback: (error: Error) => void): void {
        this.errorCallback = callback;
    }

    /**
     * 注册连接状态变化回调
     */
    onStateChange(callback: (connected: boolean) => void): void {
        this.stateChangeCallback = callback;
    }

    /**
     * 启动读取循环
     */
    private startReadLoop(): void {
        this.isReading = true;
        this.readLoopPromise = this.readLoop();
    }

    /**
     * 读取循环
     */
    private async readLoop(): Promise<void> {
        while (this.isReading && this.reader) {
            try {
                const { value, done } = await this.reader.read();

                if (done) {
                    break;
                }

                if (value && this.dataCallback) {
                    this.dataCallback(value);
                }
            } catch (error) {
                if (this.isReading) {
                    this.errorCallback?.(error instanceof Error ? error : new Error(String(error)));
                }
                break;
            }
        }

        // 读取结束，更新状态
        if (this._isConnected) {
            this._isConnected = false;
            this.stateChangeCallback?.(false);
        }
    }
}
