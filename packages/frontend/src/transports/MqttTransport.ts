import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import {
  TransportType,
  type ConnectionConfig,
  type ITransportAdapter
} from '@shared/types/transport.types';

export class MqttTransport implements ITransportAdapter {
  readonly type = TransportType.MQTT;

  private client: MqttClient | null = null;
  private _isConnected = false;
  private connectTimeoutId: number | null = null;

  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private stateChangeCallback: ((connected: boolean) => void) | null = null;
  private gatewayStatusCallback:
    | ((info: {
      siteId: string;
      gatewayId: string;
      online: boolean;
      timestamp: number;
      config?: { version?: string; baud?: number; parity?: string; stopBits?: number; ethIp?: string; wifiIp?: string };
    }) => void)
    | null = null;

  private currentConfig: ConnectionConfig | null = null;
  private currentSessionId: string | null = null;

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (this._isConnected) {
      throw new Error('已经连接，请先断开');
    }

    const mqttConfig = config.mqtt;
    if (!mqttConfig) {
      throw new Error('缺少 MQTT 配置');
    }

    const { brokerUrl, username, password, clientId, siteId, gatewayId, topicPrefix } = mqttConfig;

    if (!brokerUrl) {
      throw new Error('缺少 MQTT brokerUrl');
    }
    if (!siteId || !gatewayId) {
      throw new Error('缺少 siteId 或 gatewayId');
    }

    this.currentConfig = config;

    const options: IClientOptions = {
      username,
      password,
      clientId: clientId ?? this.createClientId(),
      reconnectPeriod: 5000,
      clean: true,
      connectTimeout: 10000
    };

    const client = mqtt.connect(brokerUrl, options);
    this.client = client;

    const prefix = topicPrefix && topicPrefix.trim().length > 0 ? topicPrefix : 'anyport';
    const responseTopicFilter = `${prefix}/${siteId}/${gatewayId}/response/+`;
    const statusTopic = `${prefix}/${siteId}/${gatewayId}/status`;
    const statusWildcardTopic = `${prefix}/+/+/status`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      this.connectTimeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.connectTimeoutId = null;
        const error = new Error('MQTT 连接超时，请检查 Broker 地址或网络');
        this.errorCallback?.(error);
        try {
          client.removeAllListeners();
          client.end(true);
        } catch {
        }
        reject(error);
      }, 10000);
      const timeoutId = this.connectTimeoutId;

      const settleResolve = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };

      const settleReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        this.errorCallback?.(error);
        reject(error);
      };

      const handleConnect = (): void => {
        this._isConnected = true;
        this.stateChangeCallback?.(true);

        client.subscribe(
          [responseTopicFilter, statusTopic, statusWildcardTopic],
          {},
          (err: Error | null) => {
            if (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              settleReject(error);
              return;
            }

            settleResolve();
          }
        );
      };

      const handleError = (err: unknown): void => {
        const error = err instanceof Error ? err : new Error(String(err));
        settleReject(error);
      };

      const handleOfflineOrEnd = (): void => {
        if (!this._isConnected && !settled) {
          const error = new Error('MQTT 连接失败，请检查 Broker 地址或网络');
          settleReject(error);
          return;
        }

        if (this._isConnected) {
          this._isConnected = false;
          this.stateChangeCallback?.(false);
        }
      };

      client.on('connect', handleConnect);
      client.on('reconnect', () => {
        if (this._isConnected) {
          this._isConnected = false;
          this.stateChangeCallback?.(false);
        }
      });
      client.on('offline', handleOfflineOrEnd);
      client.on('end', handleOfflineOrEnd);
      client.on('close', handleOfflineOrEnd);
      client.on('error', handleError);
      client.on('message', (topic: string, payload: Buffer) => {
        this.handleMessage(topic, new Uint8Array(payload));
      });
    });
  }

  async disconnect(): Promise<void> {
    // 清除可能残留的连接超时定时器
    if (this.connectTimeoutId !== null) {
      window.clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }

    const client = this.client;
    this.client = null;
    this.currentConfig = null;
    this.currentSessionId = null;

    if (!client) {
      if (this._isConnected) {
        this._isConnected = false;
        this.stateChangeCallback?.(false);
      }
      return;
    }

    // 移除所有事件监听器，防止游离回调
    client.removeAllListeners();

    await new Promise<void>(resolve => {
      client.end(true, {}, () => {
        resolve();
      });
    });

    if (this._isConnected) {
      this._isConnected = false;
      this.stateChangeCallback?.(false);
    }
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.client || !this.currentConfig || !this.currentConfig.mqtt) {
      throw new Error('MQTT 未连接或缺少配置');
    }
    if (!this._isConnected) {
      throw new Error('MQTT 未连接，无法发送数据');
    }

    const { siteId, gatewayId, topicPrefix } = this.currentConfig.mqtt;
    const sessionId = this.createSessionId();
    this.currentSessionId = sessionId;

    const prefix = topicPrefix && topicPrefix.trim().length > 0 ? topicPrefix : 'anyport';
    const topic = `${prefix}/${siteId}/${gatewayId}/request/${sessionId}`;

    const payload = {
      sessionId,
      data: Array.from(data)
    };

    const json = JSON.stringify(payload);

    await new Promise<void>((resolve, reject) => {
      this.client!.publish(topic, json, { qos: 1 }, (err?: Error) => {
        if (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.errorCallback?.(error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async sendWithTarget(
    data: Uint8Array,
    target: {
      protocol: 'tcp' | 'rtu';
      tcpTarget: { ip: string; port: number };
      rtuTarget: {
        baudRate: number;
        dataBits: 8;
        stopBits: 1 | 2;
        parity: 'none' | 'even' | 'odd';
      };
    }
  ): Promise<void> {
    if (!this.client || !this.currentConfig || !this.currentConfig.mqtt) {
      throw new Error('MQTT 未连接或缺少配置');
    }
    if (!this._isConnected) {
      throw new Error('MQTT 未连接，无法发送数据');
    }

    const { siteId, gatewayId, topicPrefix } = this.currentConfig.mqtt;
    const sessionId = this.createSessionId();
    this.currentSessionId = sessionId;

    const prefix = topicPrefix && topicPrefix.trim().length > 0 ? topicPrefix : 'anyport';
    const topic = `${prefix}/${siteId}/${gatewayId}/request/${sessionId}`;

    const hex = this.bytesToHex(data);

    const payload =
      target.protocol === 'tcp'
        ? {
          sessionId,
          transport: target.protocol,
          tcpTarget: {
            ip: target.tcpTarget.ip,
            port: target.tcpTarget.port
          },
          payloadHex: hex
        }
        : {
          sessionId,
          transport: target.protocol,
          rtuTarget: {
            baudRate: target.rtuTarget.baudRate,
            dataBits: target.rtuTarget.dataBits,
            stopBits: target.rtuTarget.stopBits,
            parity: target.rtuTarget.parity
          },
          payloadHex: hex
        };

    const json = JSON.stringify(payload);

    await new Promise<void>((resolve, reject) => {
      this.client!.publish(topic, json, { qos: 1 }, (err?: Error) => {
        if (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.errorCallback?.(error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
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

  onGatewayStatus(
    callback: (info: {
      siteId: string;
      gatewayId: string;
      online: boolean;
      timestamp: number;
      config?: { version?: string; baud?: number; parity?: string; stopBits?: number; ethIp?: string; wifiIp?: string };
    }) => void
  ): void {
    this.gatewayStatusCallback = callback;
  }

  private handleMessage(topic: string, payload: Uint8Array): void {
    try {
      const text = this.payloadToString(payload);
      const message = JSON.parse(text) as {
        sessionId?: string;
        data?: number[];
        payloadHex?: string;
        success?: boolean;
        error?: string;
        status?: string;
      };

      const segments = topic.split('/');
      const isStatusTopic = segments.length >= 4 && segments[segments.length - 1] === 'status';

      if (isStatusTopic) {
        const siteId = segments[segments.length - 3] ?? '';
        const gatewayId = segments[segments.length - 2] ?? '';
        if (!siteId || !gatewayId || !this.gatewayStatusCallback) return;

        const statusValue = typeof message.status === 'string' ? message.status : '';
        const online = statusValue === 'online';
        const raw = message as Record<string, unknown>;
        const config: { version?: string; baud?: number; parity?: string; stopBits?: number; ethIp?: string; wifiIp?: string } = {};
        if (typeof raw.version === 'string') config.version = raw.version;
        if (typeof raw.baud === 'number') config.baud = raw.baud;
        if (typeof raw.parity === 'string') config.parity = raw.parity;
        if (typeof raw.stopBits === 'number') config.stopBits = raw.stopBits;
        if (typeof raw.ethIp === 'string') config.ethIp = raw.ethIp;
        if (typeof raw.wifiIp === 'string') config.wifiIp = raw.wifiIp;

        this.gatewayStatusCallback({
          siteId,
          gatewayId,
          online,
          timestamp: Date.now(),
          config: Object.keys(config).length > 0 ? config : undefined
        });
        return;
      }

      const sessionId = message.sessionId;
      if (!sessionId || (this.currentSessionId && sessionId !== this.currentSessionId)) {
        return;
      }

      if (message.success === false && message.error) {
        this.errorCallback?.(new Error(message.error));
        return;
      }

      let buffer: Uint8Array | null = null;

      if (Array.isArray(message.data)) {
        buffer = new Uint8Array(message.data);
      } else if (typeof message.payloadHex === 'string') {
        buffer = this.hexToBytes(message.payloadHex);
      }

      if (buffer && this.dataCallback) {
        this.dataCallback(buffer);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.errorCallback?.(error);
    }
  }

  private payloadToString(payload: Uint8Array): string {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(payload);
    }
    let result = '';
    for (let i = 0; i < payload.length; i++) {
      result += String.fromCharCode(payload[i]!);
    }
    return result;
  }

  private hexToBytes(hex: string): Uint8Array {
    const normalized = hex.replace(/[^0-9a-fA-F]/g, '');
    const length = Math.floor(normalized.length / 2);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      const byte = normalized.slice(i * 2, i * 2 + 2);
      bytes[i] = Number.parseInt(byte, 16);
    }
    return bytes;
  }

  private bytesToHex(data: Uint8Array): string {
    return Array.from(data)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join('');
  }

  private createClientId(): string {
    return `anyport-web-${Math.random().toString(16).slice(2)}`;
  }

  private createSessionId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
}

