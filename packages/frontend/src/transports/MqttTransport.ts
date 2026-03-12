import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import {
  TransportType,
  type ConnectionConfig,
  type ITransportAdapter
} from '@shared/types/transport.types';
import { bytesToHexCompact, hexToBytes } from '@/utils/hex';

export class MqttTransport implements ITransportAdapter {
  readonly type = TransportType.MQTT;

  private client: MqttClient | null = null;
  private _isConnected = false;

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

  private get topicPrefix(): string {
    const prefix = this.currentConfig?.mqtt?.topicPrefix;
    return prefix && prefix.trim().length > 0 ? prefix : 'anyport';
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (this._isConnected) {
      throw new Error('已经连接，请先断开');
    }

    const mqttConfig = config.mqtt;
    if (!mqttConfig) {
      throw new Error('缺少 MQTT 配置');
    }

    const { brokerUrl, username, password, clientId } = mqttConfig;

    if (!brokerUrl) {
      throw new Error('缺少 MQTT brokerUrl');
    }

    this.currentConfig = config;

    const safeClientId = (typeof clientId === 'string' && clientId.trim().length > 0)
      ? clientId.trim()
      : this.createClientId();

    console.log('[MQTT] Connecting with clientId:', safeClientId);

    const options: any = {
      username,
      password,
      clientId: safeClientId,
      clean: true,
      connectTimeout: 10000,
      keepalive: 60,
      reconnectPeriod: 10000, // 初始阶段将重连间隔设得很长，防止干扰
    };

    const client = mqtt.connect(brokerUrl, options as IClientOptions);
    this.client = client;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (err) {
          console.error('[MQTT] Connection attempt failed:', err.message);
          client.end(true);
          reject(err);
        } else {
          // 握手成功后，才将重连时间恢复正常
          (client as any).options.reconnectPeriod = 4000;
          resolve();
        }
      };

      const timer = window.setTimeout(() => finish(new Error('MQTT 连接超时')), 15000);

      client.once('connect', () => {
        this._isConnected = true;
        this.stateChangeCallback?.(true);

        const prefix = this.topicPrefix;
        // 第一次连接只订阅发现网关的主题，确保握手最轻量化
        const discoveryTopic = `${prefix}/+/+/status`;

        console.log('[MQTT] Connected. Subscribing to discovery topic:', discoveryTopic);
        client.subscribe([discoveryTopic], (err) => {
          if (err) {
            console.warn('[MQTT] Discovery subscription failed:', err);
            finish(err instanceof Error ? err : new Error('订阅失败'));
          } else {
            console.log('[MQTT] Ready.');
            finish();
          }
        });
      });

      client.once('error', (err) => {
        finish(err instanceof Error ? err : new Error(String(err)));
      });

      client.on('message', (topic: string, payload: Buffer) => {
        this.handleMessage(topic, new Uint8Array(payload));
      });
    });

    // 绑定后续维护连接用的事件
    client.on('offline', () => {
      if (this._isConnected) {
        this._isConnected = false;
        this.stateChangeCallback?.(false);
      }
    });

    client.on('connect', () => {
      if (!this._isConnected) {
        this._isConnected = true;
        this.stateChangeCallback?.(true);
      }
    });

    client.on('error', (err) => {
      if (this._isConnected) {
        this.errorCallback?.(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private createClientId(): string {
    return `anyport-web-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  }
  async disconnect(): Promise<void> {
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
  private prevGatewayTopics: string[] = [];

  async selectGateway(siteId: string, gatewayId: string): Promise<void> {
    if (this.currentConfig && this.currentConfig.mqtt) {
      this.currentConfig.mqtt.siteId = siteId;
      this.currentConfig.mqtt.gatewayId = gatewayId;

      const prefix = this.topicPrefix;
      const responseTopic = `${prefix}/${siteId}/${gatewayId}/response/+`;
      const statusTopic = `${prefix}/${siteId}/${gatewayId}/status`;
      const nextTopics = [responseTopic, statusTopic];

      if (this.client && this._isConnected) {
        // 退订旧的主题
        if (this.prevGatewayTopics.length > 0) {
          console.log('[MQTT] Unsubscribing previous gateway topics:', this.prevGatewayTopics);
          this.client.unsubscribe(this.prevGatewayTopics);
        }
        // 订阅新的主题
        console.log('[MQTT] Subscribing to new gateway topics:', nextTopics);
        this.client.subscribe(nextTopics);
        this.prevGatewayTopics = nextTopics;
      }
    }
  }

  async startDiscovery(): Promise<void> {
    if (!this.client || !this._isConnected || !this.currentConfig || !this.currentConfig.mqtt) return;

    const { siteId, gatewayId } = this.currentConfig.mqtt;
    const prefix = this.topicPrefix;

    // MQTT 规范严禁在 PUBLISH 主题中使用通配符（+ 或 #）
    // 如果没有具体的 ID，我们应该发布到公共发现主题，或者仅靠订阅 status 等待上报
    const topic = (siteId && gatewayId)
      ? `${prefix}/${siteId}/${gatewayId}/discovery/request`
      : `${prefix}/discovery/request`;

    console.log('[MQTT] Requesting discovery on topic:', topic);
    this.client.publish(topic, JSON.stringify({ action: 'discovery' }), { qos: 0 });
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.client || !this.currentConfig || !this.currentConfig.mqtt) {
      throw new Error('MQTT 未连接或缺少配置');
    }
    if (!this._isConnected) {
      throw new Error('MQTT 未连接，无法发送数据');
    }

    const { siteId, gatewayId } = this.currentConfig.mqtt;
    const sessionId = this.createSessionId();
    this.currentSessionId = sessionId;

    const prefix = this.topicPrefix;
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

    const { siteId, gatewayId } = this.currentConfig.mqtt;
    const sessionId = this.createSessionId();
    this.currentSessionId = sessionId;

    const prefix = this.topicPrefix;
    const topic = `${prefix}/${siteId}/${gatewayId}/request/${sessionId}`;

    const hex = bytesToHexCompact(data);

    // 确保使用纯对象并转换类型，避免 Vue Proxy 导致的问题
    const payload =
      target.protocol === 'tcp'
        ? {
          sessionId,
          transport: 'tcp',
          tcpTarget: {
            ip: String(target.tcpTarget.ip),
            port: Number(target.tcpTarget.port)
          },
          payloadHex: hex
        }
        : {
          sessionId,
          transport: 'rtu',
          rtuTarget: {
            baudRate: Number(target.rtuTarget.baudRate),
            dataBits: Number(target.rtuTarget.dataBits || 8),
            stopBits: Number(target.rtuTarget.stopBits),
            parity: String(target.rtuTarget.parity)
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

  private pingCallback: ((result: Record<string, any>) => void) | null = null;

  private handleMessage(topic: string, payload: Uint8Array): void {
    try {
      if (!this._isConnected) {
        this._isConnected = true;
        this.stateChangeCallback?.(true);
      }
      const text = this.payloadToString(payload);
      const message = JSON.parse(text) as {
        sessionId?: string;
        data?: number[];
        payloadHex?: string;
        success?: boolean;
        error?: string;
        status?: string;
        type?: string;
        ip?: string;
        port?: number;
        latency?: number;
        seq?: number;
        localIp?: string;
        link?: string;
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

      if (message.type === 'ping') {
        if (this.pingCallback) {
          this.pingCallback(message);
        }
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
        buffer = hexToBytes(message.payloadHex);
      }

      if (buffer && this.dataCallback) {
        this.dataCallback(buffer);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.errorCallback?.(error);
    }
  }

  onPingResult(callback: (result: Record<string, any>) => void): void {
    this.pingCallback = callback;
  }

  async sendPing(ip: string, port: number, seq: number): Promise<void> {
    if (!this.client || !this.currentConfig || !this.currentConfig.mqtt) {
      throw new Error('MQTT 未连接或缺少配置');
    }
    if (!this._isConnected) {
      throw new Error('MQTT 未连接，无法发送数据');
    }

    const { siteId, gatewayId } = this.currentConfig.mqtt;
    const sessionId = this.createSessionId();
    this.currentSessionId = sessionId;

    const prefix = this.topicPrefix;
    const topic = `${prefix}/${siteId}/${gatewayId}/request/${sessionId}`;

    const payload = {
      sessionId,
      transport: 'ping',
      pingTarget: { ip, port },
      seq
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



  private createSessionId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
}


