/**
 * AnyPort 网关控制台领域类型与常量定义
 */

export const MODE_NAMES: Record<number, string> = {
  0: 'MQTT网关',
  1: '从站模拟器',
  2: 'USB透传',
  3: '协议互转',
  4: '总线监听诊断',
  5: '以太网桥接',
  6: '双主站中继',
};

export const MODE_DESCS: Record<number, string> = {
  0: '连接现场 Modbus 仪表总线并上报至云端 IoT 平台',
  1: '在内存中虚拟 Modbus 寄存器，提供 Web 端实时联调',
  2: 'USB 与 RS485 之间纯粹的高速数据透传',
  3: 'Modbus TCP 网络客户端与 RTU 串口从站协议无缝互转',
  4: '纯被动高阻态嗅探 RS485 总线报文，自动配对主从应答并分析丢包率、CRC 误码与响应延时',
  5: '跨物理介质（WiFi ↔ W5500 硬以太网）的 TCP / UDP 网络流量双向中转桥接',
  6: '两路物理 485 硬件隔离，实现防碰撞的双主站调度',
};

export const BAUD_RATES = [
  1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const;

export interface SimRegisterItem {
  addr: number;
  name: string;
  type: number;
  endian: number;
  targetVal: number;
  val: number;
  isDyn: boolean;
  range: string;
  dynInterval: number;
  dynMode: number;
}

export interface MonitorLogItem {
  t: number;
  meta: number;
  uid: number;
  fc: number;
  rtt: number;
  hex: string;
}

export interface GatewaySysStatus {
  version: string;
  mode: number;
  rs485Channel: number;
  gatewayName: string;
  wifiConnected: boolean;
  mqttConnected: boolean | null;
  wifiIp: string;
  wifiMask: string;
  wifiGw: string;
  wifiDns: string;
  wifiIsStatic: boolean;
  ethLink: boolean;
  ethIp: string;
  ethMask: string;
  ethGw: string;
  ethDns: string;
  rssi: number;
  chipTemp: number | null;
  ram: number;
  flash: number;
  uptime: number;
  busLatencyMs: number;
  master1Frames: number;
  master2Frames: number;
  busCrcErrors: number;
}
