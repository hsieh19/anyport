<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';

const deviceStore = useDeviceStore();

const MODE_NAMES: Record<number, string> = {
  0: 'MQTT网关',
  1: '从站模拟器',
  2: 'USB透传',
  3: '协议互转',
  4: '总线监听诊断',
  5: '以太网桥接',
  6: '双主站中继',
};

const MODE_DESCS: Record<number, string> = {
  0: '连接现场 Modbus 仪表总线并上报至云端 IoT 平台',
  1: '在内存中虚拟 Modbus 寄存器，提供 Web 端实时联调',
  2: 'USB 与 RS485 之间纯粹的高速数据透传',
  3: 'Modbus TCP 网络客户端与 RTU 串口从站协议无缝互转',
  4: '纯被动高阻态嗅探 RS485 总线报文，自动配对主从应答并分析丢包率、CRC 误码与响应延时',
  5: '跨物理介质（WiFi ↔ W5500 硬以太网）的 TCP / UDP 网络流量双向中转桥接',
  6: '两路物理 485 硬件隔离，实现防碰撞的双主站调度',
};

// 连接配置与代理状态
const STORAGE_KEY_API_BASE = 'anyport_gw_api_base';
const STORAGE_KEY_BRIDGE_PORT = 'anyport_bridge_port';

const rawSavedBase = localStorage.getItem(STORAGE_KEY_API_BASE) || 'http://192.168.4.1';
let initProto: 'http://' | 'https://' = 'http://';
let initHost = '192.168.4.1';
if (rawSavedBase.startsWith('https://')) {
  initProto = 'https://';
  initHost = rawSavedBase.replace(/^https:\/\//, '');
} else if (rawSavedBase.startsWith('http://')) {
  initProto = 'http://';
  initHost = rawSavedBase.replace(/^http:\/\//, '');
} else {
  initHost = rawSavedBase;
}
const gwProtocol = ref<'http://' | 'https://'>(initProto);
const gwHost = ref<string>(initHost);
const bridgePort = ref(Number(localStorage.getItem(STORAGE_KEY_BRIDGE_PORT)) || 8081);
const isHttpsPage = window.location.protocol === 'https:';
const useBridgeProxy = ref(isHttpsPage);
const isOnline = ref(false);
const isConnecting = ref(false);
const netLatencyMs = ref<number | string>('--');
const lastSyncTime = ref('--');

// 导航 Tab 状态
const mainTab = ref<'network' | 'mode' | 'ota'>('network');
const netTab = ref<'wifi' | 'w5500' | 'rs485'>('wifi');

// 诊断弹窗
const showTelemetryModal = ref(false);
const isRetestingTel = ref(false);

// Toast 提示
const toastState = reactive({
  show: false,
  msg: '',
  ok: true,
  timer: 0 as any,
});

function showToast(msg: string, ok = true) {
  toastState.msg = msg;
  toastState.ok = ok;
  toastState.show = true;
  if (toastState.timer) clearTimeout(toastState.timer);
  toastState.timer = setTimeout(() => {
    toastState.show = false;
  }, 3200);
}

// 网关实时状态遥测 (/api/sys/status)
const sysStatus = reactive({
  version: '--',
  mode: 0,
  rs485Channel: 0,
  gatewayName: 'AnyPort 网关',
  wifiConnected: false,
  wifiIp: '0.0.0.0',
  wifiMask: '',
  wifiGw: '',
  wifiDns: '',
  wifiIsStatic: false,
  ethLink: false,
  ethIp: '0.0.0.0',
  ethMask: '',
  ethGw: '',
  ethDns: '',
  rssi: 0,
  chipTemp: null as number | null,
  ram: 0,
  flash: 0,
  uptime: 0,
  busLatencyMs: 0,
  master1Frames: 0,
  master2Frames: 0,
  busCrcErrors: 0,
});

// 全量配置表单 (/api/config)
const form = reactive({
  gatewayName: 'AnyPort 网关',
  workMode: 0,
  rs485Channel: 0,
  otaApi: '',
  savedOtaApi: '',
  wifiIpMode: 'dhcp' as 'dhcp' | 'static',
  wifi: {
    ssid: '',
    password: '',
    ip: '',
    mask: '',
    gateway: '',
    dns: '',
  },
  eth: {
    ip: '',
    mask: '',
    gateway: '',
    dns: '',
  },
  rs485_1: {
    baud: 9600,
    dataBits: 8,
    parity: 0,
    stopBits: 1,
  },
  rs485_2: {
    baud: 9600,
    dataBits: 8,
    parity: 0,
    stopBits: 1,
  },
  mqtt: {
    host: '',
    port: 443,
    path: '/',
    topicPrefix: '',
    username: '',
    password: '',
    siteId: '',
    gatewayId: '',
  },
  bridge: {
    direction: 0,
    mode: 0,
    slaveId: 1,
    netInterface: 0,
    tcpPort: 502,
    targetIp: '',
    targetPort: 502,
  },
  ethWifi: {
    direction: 0,
    protocol: 0,
    listenPort: 502,
    targetIp: '',
    targetPort: 502,
  },
  dualMaster: {
    wifiPort: 9502,
    masterTimeout: 1000,
    heartbeatInterval: 30,
  },
});

// 从站模拟器配置与寄存器表 (/api/simConfig & /api/registers)
interface SimRegisterItem {
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

const simConfig = reactive({
  rtuEnabled: true,
  unitId: 1,
  tcpEnabled: true,
  tcpUnitId: 1,
  tcpPort: 502,
  netInterface: 0,
});

const simRegisters = ref<SimRegisterItem[]>([]);

// 总线监听与质量诊断 (/api/monitor)
interface MonitorLogItem {
  t: number;
  meta: number;
  uid: number;
  fc: number;
  rtt: number;
  hex: string;
}

const monitorStats = reactive({
  totalFrames: 0,
  reqCount: 0,
  respCount: 0,
  timeoutCount: 0,
  crcErrorCount: 0,
  exceptionCount: 0,
  lastRttMs: 0,
  minRttMs: 0,
  maxRttMs: 0,
  avgRttMs: 0,
});

const monitorFilter = reactive({
  filterSlaveId: 0,
  filterFuncCode: 0,
  timeoutMs: 1000,
});

const monitorLogs = ref<MonitorLogItem[]>([]);
const monitorAutoRefresh = ref(true);
const monitorBoxRef = ref<HTMLDivElement | null>(null);

// 云端 MQTT 提取状态
const syncCode = ref('');
const syncLoading = ref(false);
const syncMsg = ref('');
const syncOk = ref(true);

// OTA 检查状态
const otaFound = ref(false);
const otaVersion = ref('');
const otaChangelog = ref('');
const otaStatusHtml = ref('');

// 从 deviceStore 已发现的 MQTT 网关中提取可用局域网 IP 供快捷填入
const discoveredGatewayIps = computed(() => {
  const list: { label: string; url: string }[] = [];
  for (const gw of deviceStore.gateways || []) {
    const wifiIp = gw.config?.wifiIp;
    const ethIp = gw.config?.ethIp;
    if (wifiIp && wifiIp !== '0.0.0.0') {
      list.push({
        label: `${gw.siteId}/${gw.gatewayId} (WiFi: ${wifiIp})`,
        url: `http://${wifiIp}`,
      });
    }
    if (ethIp && ethIp !== '0.0.0.0') {
      list.push({
        label: `${gw.siteId}/${gw.gatewayId} (ETH: ${ethIp})`,
        url: `http://${ethIp}`,
      });
    }
  }
  return list;
});

function normalizedBase(): string {
  let host = gwHost.value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!host) host = '192.168.4.1';
  return `${gwProtocol.value}${host}`;
}

function onSelectDiscoveredGateway(e: Event) {
  const target = e.target as HTMLSelectElement;
  const val = target.value;
  if (!val) return;
  if (val.startsWith('https://')) {
    gwProtocol.value = 'https://';
    gwHost.value = val.replace(/^https:\/\//, '');
  } else {
    gwProtocol.value = 'http://';
    gwHost.value = val.replace(/^http:\/\//, '');
  }
  connectDevice();
}

// 智能 HTTP 请求引擎：
// - HTTP 页面 (localhost / 局域网部署)：100% 浏览器局域网直连网关 API
// - HTTPS 页面 (Cloudflare Pages 公网部署)：通过本机 anyport-bridge (127.0.0.1:8081/proxy) 穿透 Mixed Content 限制
async function gwFetch(path: string, options: RequestInit = {}): Promise<any> {
  const targetUrl = normalizedBase() + path;
  localStorage.setItem(STORAGE_KEY_API_BASE, normalizedBase());

  if (isHttpsPage) {
    useBridgeProxy.value = true;
    const proxyUrl = `http://127.0.0.1:${bridgePort.value}/proxy?url=${encodeURIComponent(targetUrl)}`;
    try {
      const r = await fetch(proxyUrl, options);
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
      return data;
    } catch (proxyErr: any) {
      throw new Error(
        proxyErr?.message?.includes('Failed to fetch')
          ? `无法连接本地 Bridge 代理 (127.0.0.1:${bridgePort.value})，请确认已启动 anyport-bridge.exe`
          : proxyErr.message
      );
    }
  }

  useBridgeProxy.value = false;
  const r = await fetch(targetUrl, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return data;
}

async function apiGet(path: string) {
  return gwFetch(path, { method: 'GET' });
}

async function apiPost(path: string, body: any = {}) {
  return gwFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formatUptime(sec: number): string {
  const s = Number(sec) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (d > 0) return `${d}天 ${h}小时 ${m}分`;
  if (h > 0) return `${h}小时 ${m}分 ${rem}秒`;
  if (m > 0) return `${m}分 ${rem}秒`;
  return `${rem}秒`;
}

const activeChannelLabel = computed(() => {
  if (sysStatus.mode === 6) return '双通道(485-1+485-2)';
  if (sysStatus.mode === 5) return '无(纯网络桥接)';
  return sysStatus.rs485Channel === 1 ? '485-2(从站)' : '485-1(主站)';
});

const qualitySuccessRate = computed(() => {
  const closed = (monitorStats.respCount || 0) + (monitorStats.timeoutCount || 0);
  if (closed <= 0) return { text: '--', color: '#10b981' };
  const rate = (monitorStats.respCount / closed) * 100;
  const color = rate >= 98 ? '#10b981' : rate >= 90 ? '#f59e0b' : '#ef4444';
  return { text: `${rate.toFixed(1)}%`, color };
});

function applyStatusPayload(s: any, latMs: number) {
  isOnline.value = true;
  netLatencyMs.value = latMs;
  lastSyncTime.value = new Date().toLocaleString('zh-CN', { hour12: false });

  sysStatus.version = s.version || '--';
  sysStatus.mode = s.mode ?? 0;
  sysStatus.rs485Channel = s.rs485Channel ?? 0;
  sysStatus.gatewayName = s.gatewayName || 'AnyPort 网关';
  sysStatus.wifiConnected = !!s.wifiConnected;
  sysStatus.wifiIp = s.wifiIp || '0.0.0.0';
  sysStatus.wifiMask = s.wifiMask || '';
  sysStatus.wifiGw = s.wifiGw || '';
  sysStatus.wifiDns = s.wifiDns || '';
  sysStatus.wifiIsStatic = !!s.wifiIsStatic;
  sysStatus.ethLink = !!s.ethLink;
  sysStatus.ethIp = s.ethIp || '0.0.0.0';
  sysStatus.ethMask = s.ethMask || '';
  sysStatus.ethGw = s.ethGw || '';
  sysStatus.ethDns = s.ethDns || '';
  sysStatus.rssi = s.rssi || 0;
  sysStatus.chipTemp = s.chipTemp !== undefined ? s.chipTemp : null;
  sysStatus.ram = s.ram || 0;
  sysStatus.flash = s.flash || 0;
  sysStatus.uptime = s.uptime || 0;
  sysStatus.busLatencyMs = s.busLatencyMs || 0;
  sysStatus.master1Frames = s.master1Frames || 0;
  sysStatus.master2Frames = s.master2Frames || 0;
  sysStatus.busCrcErrors = s.busCrcErrors || 0;
}

async function refreshStatus() {
  try {
    const t0 = performance.now();
    const s = await apiGet('/api/sys/status');
    const lat = Math.max(1, Math.round(performance.now() - t0));
    applyStatusPayload(s, lat);
  } catch {
    isOnline.value = false;
  }
}

async function connectDevice() {
  isConnecting.value = true;
  try {
    const t0 = performance.now();
    const s = await apiGet('/api/sys/status');
    const lat = Math.max(1, Math.round(performance.now() - t0));
    applyStatusPayload(s, lat);

    const c = await apiGet('/api/config');
    form.gatewayName = c.gatewayName || c.dualMaster?.gatewayName || 'AnyPort 网关';
    form.workMode = c.workMode !== undefined ? c.workMode : 0;
    form.rs485Channel = c.rs485Channel === 1 ? 1 : 0;

    const rawOta =
      c.otaApi && !c.otaApi.includes('your-firmware-worker.workers.dev') ? c.otaApi : '';
    form.otaApi = rawOta;
    form.savedOtaApi = rawOta;

    if (c.rs485_1) {
      form.rs485_1.baud = c.rs485_1.baud || 9600;
      form.rs485_1.dataBits = c.rs485_1.dataBits || 8;
      form.rs485_1.parity = c.rs485_1.parity || 0;
      form.rs485_1.stopBits = c.rs485_1.stopBits || 1;
    } else if (c.transparent) {
      form.rs485_1.baud = c.transparent.baud || 9600;
      form.rs485_1.dataBits = c.transparent.dataBits || 8;
      form.rs485_1.parity = c.transparent.parity || 0;
      form.rs485_1.stopBits = c.transparent.stopBits || 1;
    }

    if (c.rs485_2) {
      form.rs485_2.baud = c.rs485_2.baud || 9600;
      form.rs485_2.dataBits = c.rs485_2.dataBits || 8;
      form.rs485_2.parity = c.rs485_2.parity || 0;
      form.rs485_2.stopBits = c.rs485_2.stopBits || 1;
    }

    form.wifi.ssid = c.wifi?.ssid || '';
    form.wifi.password = c.wifi?.password || '';
    const isStatic = !!(c.wifi?.ip && c.wifi?.mask) || !!s.wifiIsStatic;
    form.wifiIpMode = isStatic ? 'static' : 'dhcp';
    form.wifi.ip = s.wifiIp && s.wifiIp !== '0.0.0.0' ? s.wifiIp : c.wifi?.ip || '';
    form.wifi.mask = s.wifiMask || c.wifi?.mask || '';
    form.wifi.gateway = s.wifiGw || c.wifi?.gateway || '';
    form.wifi.dns = s.wifiDns && s.wifiDns !== '0.0.0.0' ? s.wifiDns : c.wifi?.dns || '';

    form.eth.ip = s.ethIp && s.ethIp !== '0.0.0.0' ? s.ethIp : c.eth?.ip || '';
    form.eth.mask = s.ethMask && s.ethMask !== '0.0.0.0' ? s.ethMask : c.eth?.mask || '';
    form.eth.gateway = s.ethGw && s.ethGw !== '0.0.0.0' ? s.ethGw : c.eth?.gateway || '';
    form.eth.dns = s.ethDns && s.ethDns !== '0.0.0.0' ? s.ethDns : c.eth?.dns || '';

    form.mqtt.host = c.mqtt?.host || '';
    form.mqtt.port = c.mqtt?.port || 443;
    form.mqtt.path = c.mqtt?.path || '/';
    form.mqtt.username = c.mqtt?.username || '';
    form.mqtt.password = c.mqtt?.password || '';
    form.mqtt.topicPrefix = c.mqtt?.topicPrefix || '';
    form.mqtt.siteId = c.mqtt?.siteId || '';
    form.mqtt.gatewayId = c.mqtt?.gatewayId || '';

    form.bridge.direction = c.bridge?.direction || 0;
    form.bridge.mode = c.bridge?.mode || 0;
    form.bridge.slaveId = c.bridge?.slaveId || 1;
    form.bridge.netInterface = c.bridge?.netInterface || 0;
    form.bridge.tcpPort = c.bridge?.tcpPort || 502;
    form.bridge.targetIp = c.bridge?.targetIp || '';
    form.bridge.targetPort = c.bridge?.targetPort || 502;

    form.ethWifi.direction = c.ethWifi?.direction || 0;
    form.ethWifi.protocol = c.ethWifi?.protocol || 0;
    form.ethWifi.listenPort = c.ethWifi?.listenPort || 502;
    form.ethWifi.targetIp = c.ethWifi?.targetIp || '';
    form.ethWifi.targetPort = c.ethWifi?.targetPort || 502;

    form.dualMaster.wifiPort = c.dualMaster?.wifiPort || 9502;
    form.dualMaster.masterTimeout = c.dualMaster?.masterTimeout || 1000;
    form.dualMaster.heartbeatInterval = c.dualMaster?.heartbeatInterval || 30;

    const sc = await apiGet('/api/simConfig');
    simConfig.rtuEnabled = !!sc.rtuEnabled;
    simConfig.unitId = sc.unitId ?? 1;
    simConfig.tcpEnabled = !!sc.tcpEnabled;
    simConfig.tcpUnitId = sc.tcpUnitId ?? 1;
    simConfig.tcpPort = sc.tcpPort ?? 502;
    simConfig.netInterface = sc.netInterface ?? 0;

    const regs = await apiGet('/api/registers');
    simRegisters.value = (Array.isArray(regs) ? regs : []).map((r: any) => ({
      addr: r.addr ?? 40001,
      name: r.name ?? 'Var',
      type: r.type ?? 0,
      endian: [2, 3, 4].includes(r.type ?? 0) ? r.endian ?? 0 : 0,
      targetVal: r.targetVal ?? 0,
      val: r.val ?? 0,
      isDyn: !!r.isDyn,
      range: `${r.min ?? 0}~${r.max ?? 100}`,
      dynInterval: r.dynInterval ?? 1,
      dynMode: r.dynMode ?? 0,
    }));

    if (form.workMode === 4) {
      await fetchMonitor(true);
    }
    showToast('已同步网关最新参数');
  } catch (e: any) {
    isOnline.value = false;
    showToast('连接失败: ' + e.message, false);
  } finally {
    isConnecting.value = false;
  }
}

async function openTelemetry() {
  showTelemetryModal.value = true;
  await retestTelemetry();
}

async function retestTelemetry() {
  isRetestingTel.value = true;
  await refreshStatus();
  isRetestingTel.value = false;
}

// 寄存器表格辅助
function is32BitType(t: number): boolean {
  return t === 2 || t === 3 || t === 4;
}

function onRegTypeChange(reg: SimRegisterItem) {
  if (!is32BitType(reg.type)) {
    reg.endian = 0;
  }
}

function addRegRow() {
  simRegisters.value.push({
    addr: 40001,
    name: 'Var',
    type: 0,
    endian: 0,
    targetVal: 0,
    val: 0,
    isDyn: false,
    range: '0~100',
    dynInterval: 1,
    dynMode: 0,
  });
}

function removeRegRow(idx: number) {
  simRegisters.value.splice(idx, 1);
}

async function saveSimAll() {
  try {
    const payloadRegs = simRegisters.value.map((r) => {
      const rng = String(r.range || '0~100').split('~');
      return {
        addr: Number(r.addr) || 40001,
        name: r.name || 'Var',
        type: Number(r.type) || 0,
        endian: is32BitType(Number(r.type)) ? Number(r.endian) || 0 : 0,
        targetVal: parseFloat(String(r.targetVal || 0)),
        val: parseFloat(String(r.targetVal || 0)),
        isDyn: !!r.isDyn,
        min: parseFloat(rng[0] || '0'),
        max: parseFloat(rng[1] || '100'),
        dynInterval: Number(r.dynInterval) || 1,
        dynMode: Number(r.dynMode) || 0,
      };
    });
    await apiPost('/api/registers', payloadRegs);

    const actRs = form.rs485Channel === 1 ? form.rs485_2 : form.rs485_1;
    await apiPost('/api/simConfig', {
      rtuEnabled: !!simConfig.rtuEnabled,
      unitId: Number(simConfig.unitId) || 1,
      baud: actRs.baud,
      dataBits: actRs.dataBits,
      parity: actRs.parity,
      stopBits: actRs.stopBits,
      tcpEnabled: !!simConfig.tcpEnabled,
      tcpUnitId: Number(simConfig.tcpUnitId) || 1,
      tcpPort: Number(simConfig.tcpPort) || 502,
      netInterface: Number(simConfig.netInterface) || 0,
    });
    showToast('模拟器配置已保存');
  } catch (e: any) {
    showToast('保存模拟器失败: ' + e.message, false);
  }
}

// 总线监听与质量诊断
async function fetchMonitor(syncConfig = false) {
  try {
    const d = await apiGet('/api/monitor');
    const logs = Array.isArray(d) ? d : d.logs || [];
    if (d.stats) {
      Object.assign(monitorStats, d.stats);
    }
    if (syncConfig && d.config) {
      monitorFilter.filterSlaveId = d.config.filterSlaveId ?? 0;
      monitorFilter.filterFuncCode = d.config.filterFuncCode ?? 0;
      monitorFilter.timeoutMs = d.config.timeoutMs ?? 1000;
    }
    const box = monitorBoxRef.value;
    const atBottom = box ? box.scrollHeight - box.scrollTop - box.clientHeight < 30 : true;
    monitorLogs.value = logs;
    if (atBottom && box && logs.length) {
      setTimeout(() => {
        if (monitorBoxRef.value) {
          monitorBoxRef.value.scrollTop = monitorBoxRef.value.scrollHeight;
        }
      }, 20);
    }
  } catch {
    // 轮询期间静默忽略偶发抖动
  }
}

async function applyMonitorFilter() {
  try {
    await apiPost('/api/monitor/config', {
      filterSlaveId: Number(monitorFilter.filterSlaveId) || 0,
      filterFuncCode: Number(monitorFilter.filterFuncCode) || 0,
      timeoutMs: Number(monitorFilter.timeoutMs) || 1000,
    });
    showToast('监听过滤与超时参数已实时生效');
  } catch (e: any) {
    showToast('设置过滤失败: ' + e.message, false);
  }
}

async function clearMonitor() {
  try {
    await apiPost('/api/monitor/clear');
    monitorLogs.value = [];
    await fetchMonitor();
    showToast('统计指标与报文记录已重置');
  } catch (e: any) {
    showToast('清空失败: ' + e.message, false);
  }
}

// 云端一键拉取 MQTT 参数
async function doCloudSync() {
  const pwd = syncCode.value.trim();
  if (!pwd) {
    syncOk.value = false;
    syncMsg.value = '⚠️ 请输入提取密码';
    return;
  }
  syncLoading.value = true;
  syncOk.value = true;
  syncMsg.value = '⏳ 正在拉取...';
  try {
    const res = await fetch('https://update.anyport.one/anyport/mqtt-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pwd }),
    });
    if (!res.ok) throw new Error(`请求错误 (${res.status})`);
    const data = await res.json();
    const urlStr = data.brokerUrl || '';
    if (urlStr) {
      try {
        let norm = urlStr.replace(/^(mqtt|mqtts|ws|wss):\/\//i, 'http://');
        if (!norm.startsWith('http://') && !norm.startsWith('https://')) {
          norm = 'http://' + norm;
        }
        const u = new URL(norm);
        form.mqtt.host = u.hostname;
        const p =
          u.port ||
          (urlStr.startsWith('wss:') || urlStr.startsWith('mqtts:') ? '8883' : '1883');
        form.mqtt.port = Number(p) || 443;
        form.mqtt.path = u.pathname;
      } catch {
        form.mqtt.host = urlStr;
      }
    }
    if (data.username !== undefined) form.mqtt.username = data.username;
    if (data.password !== undefined) form.mqtt.password = data.password;
    if (data.topicPrefix !== undefined) form.mqtt.topicPrefix = data.topicPrefix;
    if (data.siteId !== undefined) form.mqtt.siteId = data.siteId;
    if (data.gatewayId !== undefined) form.mqtt.gatewayId = data.gatewayId;

    syncOk.value = true;
    syncMsg.value = '✨ 提取成功，已填充！';
    showToast('提取成功');
    setTimeout(() => {
      syncCode.value = '';
      syncMsg.value = '';
    }, 3500);
  } catch (err: any) {
    syncOk.value = false;
    syncMsg.value = '⚠️ 失败: ' + err.message;
    showToast('拉取失败: ' + err.message, false);
  } finally {
    syncLoading.value = false;
  }
}

// 保存全量配置并重启网关
async function saveConfig() {
  try {
    if (form.workMode === 1) {
      await saveSimAll();
    }
    const ch = Number(form.rs485Channel) || 0;
    const rs1 = {
      baud: Number(form.rs485_1.baud) || 9600,
      dataBits: Number(form.rs485_1.dataBits) || 8,
      parity: Number(form.rs485_1.parity) || 0,
      stopBits: Number(form.rs485_1.stopBits) || 1,
    };
    const rs2 = {
      baud: Number(form.rs485_2.baud) || 9600,
      dataBits: Number(form.rs485_2.dataBits) || 8,
      parity: Number(form.rs485_2.parity) || 0,
      stopBits: Number(form.rs485_2.stopBits) || 1,
    };
    const actRs = ch === 1 ? rs2 : rs1;
    const gwName = form.gatewayName.trim() || 'AnyPort 网关';
    const isDhcp = form.wifiIpMode === 'dhcp';

    const payload = {
      gatewayName: gwName,
      workMode: Number(form.workMode),
      rs485Channel: ch,
      otaApi: form.otaApi.trim(),
      rs485_1: rs1,
      rs485_2: rs2,
      wifi: {
        ssid: form.wifi.ssid.trim(),
        password: form.wifi.password,
        ip: isDhcp ? '' : form.wifi.ip.trim(),
        mask: isDhcp ? '' : form.wifi.mask.trim(),
        gateway: isDhcp ? '' : form.wifi.gateway.trim(),
        dns: isDhcp ? '' : form.wifi.dns.trim(),
      },
      eth: {
        ip: form.eth.ip.trim(),
        mask: form.eth.mask.trim(),
        gateway: form.eth.gateway.trim(),
        dns: form.eth.dns.trim(),
      },
      mqtt: {
        host: form.mqtt.host.trim(),
        port: Number(form.mqtt.port) || 443,
        path: form.mqtt.path.trim(),
        username: form.mqtt.username.trim(),
        password: form.mqtt.password,
        topicPrefix: form.mqtt.topicPrefix.trim(),
        siteId: form.mqtt.siteId.trim(),
        gatewayId: form.mqtt.gatewayId.trim(),
      },
      transparent: {
        baud: actRs.baud,
        dataBits: actRs.dataBits,
        parity: actRs.parity,
        stopBits: actRs.stopBits,
      },
      bridge: {
        direction: Number(form.bridge.direction),
        mode: Number(form.bridge.mode),
        slaveId: Number(form.bridge.slaveId) || 1,
        netInterface: Number(form.bridge.netInterface),
        tcpPort: Number(form.bridge.tcpPort) || 502,
        targetIp: form.bridge.targetIp.trim(),
        targetPort: Number(form.bridge.targetPort) || 502,
        baud: actRs.baud,
        dataBits: actRs.dataBits,
        parity: actRs.parity,
        stopBits: actRs.stopBits,
      },
      ethWifi: {
        direction: Number(form.ethWifi.direction),
        protocol: Number(form.ethWifi.protocol),
        listenPort: Number(form.ethWifi.listenPort) || 502,
        targetIp: form.ethWifi.targetIp.trim(),
        targetPort: Number(form.ethWifi.targetPort) || 502,
      },
      dualMaster: {
        gatewayName: gwName,
        baud: rs1.baud,
        dataBits: rs1.dataBits,
        parity: rs1.parity,
        stopBits: rs1.stopBits,
        wifiPort: Number(form.dualMaster.wifiPort) || 9502,
        masterTimeout: Number(form.dualMaster.masterTimeout) || 1000,
        heartbeatInterval: Number(form.dualMaster.heartbeatInterval) || 30,
      },
    };

    await apiPost('/api/config', payload);
    showToast('配置已提交，网关正在重启 (3.5秒后自动重连)');
    setTimeout(connectDevice, 3500);
  } catch (e: any) {
    showToast('保存失败: ' + e.message, false);
  }
}

// OTA 更新与回滚
async function checkOta() {
  const inputUrl = form.otaApi.trim();
  otaFound.value = false;
  if (
    !inputUrl ||
    inputUrl.includes('your-firmware-worker.workers.dev') ||
    !inputUrl.startsWith('http')
  ) {
    otaStatusHtml.value =
      '<span style="color:#ef4444;font-weight:600">⚠️ 请先填写有效的 OTA 更新服务地址 (Base URL)</span>';
    showToast('请先配置有效的 OTA 更新服务地址', false);
    return;
  }
  if (inputUrl !== form.savedOtaApi) {
    otaStatusHtml.value =
      '<span style="color:#f59e0b;font-weight:600">⚠️ 检测到 OTA 服务地址已修改但尚未保存，请先点击底部「保存全量配置并重启网关」</span>';
    showToast('请先保存新填写的 OTA 服务地址', false);
    return;
  }

  otaStatusHtml.value = '<span>⏳ 正在连接 OTA 服务器检查更新...</span>';
  try {
    const d = await apiGet('/api/ota/check');
    if (d.found) {
      otaFound.value = true;
      otaVersion.value = d.version || '';
      otaChangelog.value = d.changelog || '';
      otaStatusHtml.value = `<b style="color:#10b981">🎉 发现新固件 v${d.version}</b>`;
    } else {
      otaStatusHtml.value = `<span style="color:#10b981;font-weight:600">✅ 已是最新版本 (${d.version || sysStatus.version})</span>`;
    }
  } catch (e: any) {
    otaStatusHtml.value = `<span style="color:#ef4444;font-weight:600">❌ 检查失败: ${e.message}</span>`;
    showToast('检查失败: ' + e.message, false);
  }
}

async function doOta() {
  if (!confirm('确认立即升级固件？升级期间请勿断电')) return;
  try {
    await apiPost('/api/ota/do');
    showToast('升级指令已下发，请稍候');
  } catch (e: any) {
    showToast('升级失败: ' + e.message, false);
  }
}

async function doRollback() {
  if (!confirm('确认回滚至备用分区固件？')) return;
  try {
    await apiPost('/api/ota/rollback');
    showToast('正在回滚并重启...');
  } catch (e: any) {
    showToast('回滚失败: ' + e.message, false);
  }
}

let statusTimer: any = null;
let monitorTimer: any = null;

onMounted(() => {
  connectDevice();
  statusTimer = setInterval(refreshStatus, 5000);
  monitorTimer = setInterval(() => {
    if (
      isOnline.value &&
      monitorAutoRefresh.value &&
      mainTab.value === 'mode' &&
      form.workMode === 4
    ) {
      fetchMonitor();
    }
  }, 1500);
});

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer);
  if (monitorTimer) clearInterval(monitorTimer);
});
</script>

<template>
  <div class="gw-console">
    <!-- 1. 顶部全局硬件与连接遥测栏 -->
    <div class="topbar">
      <div class="topbar-header">
        <div class="brand-title">
          <span class="dot-status" :class="{ 'dot-online': isOnline }"></span>
          <span>{{ sysStatus.gatewayName }}</span>
          <span class="status-pill">
            {{ isOnline ? `v${sysStatus.version} · ${MODE_NAMES[sysStatus.mode] || sysStatus.mode}` : '未连接' }}
          </span>
          <span
            class="status-pill"
            :title="useBridgeProxy ? '通过本机 anyport-bridge (127.0.0.1:8081/proxy) 穿透访问局域网网关' : '浏览器直接访问局域网网关 HTTP API'"
          >
            {{ useBridgeProxy ? '🔗 Bridge代理' : '⚡ 局域网直连' }}
          </span>
        </div>

        <div class="topbar-conn">
          <select
            v-if="discoveredGatewayIps.length > 0"
            class="quick-ip-select"
            @change="onSelectDiscoveredGateway"
          >
            <option value="">⚡ 已发现网关快捷选择...</option>
            <option v-for="item in discoveredGatewayIps" :key="item.url" :value="item.url">
              {{ item.label }}
            </option>
          </select>

          <span class="conn-label">网关地址:</span>
          <div class="gw-addr-composite">
            <select v-model="gwProtocol" class="gw-proto-select">
              <option value="http://">http://</option>
              <option value="https://">https://</option>
            </select>
            <input
              v-model="gwHost"
              class="gw-host-input"
              placeholder="192.168.4.1 或 域名:端口"
              @keydown.enter="connectDevice"
            />
          </div>
          <button class="btn-primary" :disabled="isConnecting" @click="connectDevice">
            {{ isConnecting ? '连接中...' : '连接 / 刷新' }}
          </button>
          <button class="btn-diag" @click="openTelemetry">📊 状态诊断</button>
        </div>
      </div>

      <div class="topbar-stats">
        <template v-if="isOnline">
          <span>模式: <b>{{ MODE_NAMES[sysStatus.mode] || sysStatus.mode }}</b></span>
          <span>485通道: <b>{{ activeChannelLabel }}</b></span>
          <span>
            WiFi: <b>{{ sysStatus.wifiIp }}</b>
            ({{ sysStatus.wifiConnected ? 'STA' : 'AP' }}{{ sysStatus.rssi ? ` · ${sysStatus.rssi}dBm` : '' }})
          </span>
          <span>
            以太网: <b>{{ sysStatus.ethIp }}</b>
            ({{ sysStatus.ethLink ? 'LinkUP' : 'NoLink' }})
          </span>
          <span>结温: <b>{{ sysStatus.chipTemp !== null ? `${sysStatus.chipTemp}℃` : '--' }}</b></span>
          <span>RAM/Flash: <b>{{ sysStatus.ram }}% / {{ sysStatus.flash }}%</b></span>
          <span>运行: <b>{{ formatUptime(sysStatus.uptime) }}</b></span>
        </template>
        <span v-else>正在等待连接网关设备 ({{ isHttpsPage ? 'HTTPS 模式已自动启用本地 Bridge 代理穿透' : '支持局域网直连或本地 Bridge 代理' }})...</span>
      </div>
    </div>

    <!-- 2. 一级导航栏 -->
    <div class="main-nav">
      <button
        class="main-tab-btn"
        :class="{ active: mainTab === 'network' }"
        @click="mainTab = 'network'"
      >
        🌐 基础与端口配置
      </button>
      <button
        class="main-tab-btn"
        :class="{ active: mainTab === 'mode' }"
        @click="mainTab = 'mode'"
      >
        ⚡ 业务工作模式
      </button>
      <button
        class="main-tab-btn"
        :class="{ active: mainTab === 'ota' }"
        @click="mainTab = 'ota'"
      >
        🚀 固件维护与 OTA
      </button>
    </div>

    <!-- ================= 主面板 1: 基础与端口配置 ================= -->
    <div v-show="mainTab === 'network'">
      <div class="sub-nav-row">
        <div class="sub-nav">
          <button
            class="sub-tab-btn"
            :class="{ active: netTab === 'wifi' }"
            @click="netTab = 'wifi'"
          >
            📶 WiFi 无线网络
          </button>
          <button
            class="sub-tab-btn"
            :class="{ active: netTab === 'w5500' }"
            @click="netTab = 'w5500'"
          >
            🔌 W5500 硬以太网
          </button>
          <button
            class="sub-tab-btn"
            :class="{ active: netTab === 'rs485' }"
            @click="netTab = 'rs485'"
          >
            🎛️ RS485 端口参数
          </button>
        </div>

        <div class="gw-name-box">
          <label>🏷️ 网关设备名称:</label>
          <input v-model="form.gatewayName" placeholder="AnyPort 网关" />
        </div>
      </div>

      <!-- WiFi 设置 -->
      <div v-show="netTab === 'wifi'" class="gw-card">
        <div class="gw-card-title">
          <span>WiFi 设置</span>
          <span class="title-hint">局域网 STA / AP 配网</span>
        </div>
        <div class="grid-4" style="margin-bottom: 12px">
          <div class="form-item">
            <label>SSID 名称</label>
            <input v-model="form.wifi.ssid" placeholder="路由器无线网络名称" />
          </div>
          <div class="form-item">
            <label>WiFi 密码</label>
            <input v-model="form.wifi.password" type="password" placeholder="********" />
          </div>
          <div class="form-item">
            <label>IP 分配方式</label>
            <select v-model="form.wifiIpMode">
              <option value="dhcp">DHCP (自动获取)</option>
              <option value="static">静态 IP (手动指定)</option>
            </select>
          </div>
        </div>
        <div class="gw-card-subtitle">
          <span>IP 地址与网络参数</span>
          <span :style="{ color: form.wifiIpMode === 'dhcp' ? '#0ea5e9' : '#10b981' }">
            {{ form.wifiIpMode === 'dhcp' ? '实时读取自硬件当前网络 (只读)' : '已启用静态 IP 手动配置' }}
          </span>
        </div>
        <div class="grid-4">
          <div class="form-item">
            <label>IP 地址</label>
            <input v-model="form.wifi.ip" :readonly="form.wifiIpMode === 'dhcp'" placeholder="例如 192.168.1.150" />
          </div>
          <div class="form-item">
            <label>子网掩码</label>
            <input v-model="form.wifi.mask" :readonly="form.wifiIpMode === 'dhcp'" placeholder="255.255.255.0" />
          </div>
          <div class="form-item">
            <label>默认网关</label>
            <input v-model="form.wifi.gateway" :readonly="form.wifiIpMode === 'dhcp'" placeholder="192.168.1.1" />
          </div>
          <div class="form-item">
            <label>DNS 服务器</label>
            <input v-model="form.wifi.dns" :readonly="form.wifiIpMode === 'dhcp'" placeholder="8.8.8.8" />
          </div>
        </div>
      </div>

      <!-- W5500 以太网 -->
      <div v-show="netTab === 'w5500'" class="gw-card">
        <div class="gw-card-title">
          <span>W5500 硬以太网配置</span>
          <span class="title-hint">SPI 高速工业以太网 (全留空则不启用静态 IP)</span>
        </div>
        <div class="grid-4">
          <div class="form-item"><label>IP 地址</label><input v-model="form.eth.ip" placeholder="192.168.1.200" /></div>
          <div class="form-item"><label>子网掩码</label><input v-model="form.eth.mask" placeholder="255.255.255.0" /></div>
          <div class="form-item"><label>默认网关</label><input v-model="form.eth.gateway" placeholder="192.168.1.1" /></div>
          <div class="form-item"><label>DNS 服务器</label><input v-model="form.eth.dns" placeholder="8.8.8.8" /></div>
        </div>
      </div>

      <!-- RS485 全局端口配置 -->
      <div v-show="netTab === 'rs485'">
        <div class="notice-box notice-info">
          💡 <b>全局端口参数说明：</b>485-1 与 485-2 的物理通信参数在此全局定义。业务工作模式将直接复用此处设定的波特率与校验位，无需在各模式中重复配置。
        </div>

        <div class="gw-card">
          <div class="gw-card-title">
            <span>485-1 物理端口参数 (主站侧端子 · GPIO 2/3)</span>
            <span class="title-hint">J1 接口 · 硬件 UART1/UART0 复用</span>
          </div>
          <div class="grid-4">
            <div class="form-item">
              <label>波特率 (Baud Rate)</label>
              <select v-model.number="form.rs485_1.baud">
                <option v-for="b in [1200,2400,4800,9600,19200,38400,57600,115200,230400,460800,921600]" :key="b" :value="b">{{ b }}</option>
              </select>
            </div>
            <div class="form-item">
              <label>数据位 (Data Bits)</label>
              <select v-model.number="form.rs485_1.dataBits">
                <option :value="8">8</option>
                <option :value="7">7</option>
              </select>
            </div>
            <div class="form-item">
              <label>校验位 (Parity)</label>
              <select v-model.number="form.rs485_1.parity">
                <option :value="0">无 (None)</option>
                <option :value="1">偶校验 (Even)</option>
                <option :value="2">奇校验 (Odd)</option>
              </select>
            </div>
            <div class="form-item">
              <label>停止位 (Stop Bits)</label>
              <select v-model.number="form.rs485_1.stopBits">
                <option :value="1">1</option>
                <option :value="2">2</option>
              </select>
            </div>
          </div>
        </div>

        <div class="gw-card">
          <div class="gw-card-title">
            <span>485-2 物理端口参数 (从站侧端子 · GPIO 5/4)</span>
            <span class="title-hint">J3 接口 · 硬件 UART1 复用</span>
          </div>
          <div class="grid-4">
            <div class="form-item">
              <label>波特率 (Baud Rate)</label>
              <select v-model.number="form.rs485_2.baud">
                <option v-for="b in [1200,2400,4800,9600,19200,38400,57600,115200,230400,460800,921600]" :key="b" :value="b">{{ b }}</option>
              </select>
            </div>
            <div class="form-item">
              <label>数据位 (Data Bits)</label>
              <select v-model.number="form.rs485_2.dataBits">
                <option :value="8">8</option>
                <option :value="7">7</option>
              </select>
            </div>
            <div class="form-item">
              <label>校验位 (Parity)</label>
              <select v-model.number="form.rs485_2.parity">
                <option :value="0">无 (None)</option>
                <option :value="1">偶校验 (Even)</option>
                <option :value="2">奇校验 (Odd)</option>
              </select>
            </div>
            <div class="form-item">
              <label>停止位 (Stop Bits)</label>
              <select v-model.number="form.rs485_2.stopBits">
                <option :value="1">1</option>
                <option :value="2">2</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= 主面板 2: 业务工作模式配置 ================= -->
    <div v-show="mainTab === 'mode'">
      <div class="mode-header-card">
        <div class="header-grid">
          <div class="form-item">
            <label class="mode-top-label">当前工作模式:</label>
            <select v-model.number="form.workMode">
              <option :value="0">0 - MQTT 网关模式 (工业总线上云)</option>
              <option :value="1">1 - 从站模拟器模式 (现场联调)</option>
              <option :value="2">2 - USB 转 RS485 透传模式 (串口调试)</option>
              <option :value="3">3 - Modbus 协议互转模式 (TCP ↔ RTU)</option>
              <option :value="4">4 - 总线监听与质量诊断 (被动嗅探)</option>
              <option :value="5">5 - 以太网-WiFi 桥接模式 (网段中转)</option>
              <option :value="6">6 - 双主站中继网关模式 (硬件防碰撞)</option>
            </select>
          </div>
          <div class="form-item">
            <label class="mode-top-label">生效 RS485 物理通道:</label>
            <select
              v-model.number="form.rs485Channel"
              :disabled="form.workMode === 5 || form.workMode === 6"
            >
              <option :value="0">485-1 (主站侧端子 GPIO 2/3)</option>
              <option :value="1">485-2 (从站侧端子 GPIO 5/4)</option>
            </select>
          </div>
        </div>
        <div class="mode-desc-text">
          <template v-if="form.workMode === 6">
            <b>双主站模式：</b>两路 485 全部启用 (485-1 接主站，485-2 接从站)，无需选择单通道。
          </template>
          <template v-else-if="form.workMode === 5">
            <b>跨网段桥接模式：</b>纯网络介质（WiFi ↔ W5500 硬以太网）数据中转，不占用 RS485 串口通道。
          </template>
          <template v-else>
            {{ MODE_DESCS[form.workMode] }}
          </template>
        </div>
      </div>

      <!-- 模式 0: MQTT 网关 -->
      <div v-show="form.workMode === 0" class="gw-card">
        <div class="gw-card-title"><span>☁️ MQTT 平台接入参数</span></div>
        <div class="sync-bar">
          <span style="font-weight: 600">⚡ 远端提取:</span>
          <input
            v-model="syncCode"
            placeholder="输入 6 位提取码"
            @keydown.enter="doCloudSync"
          />
          <button :disabled="syncLoading" @click="doCloudSync">一键拉取并填入</button>
          <span v-if="syncMsg" :style="{ color: syncOk ? '#10b981' : '#ef4444', fontSize: '12px' }">
            {{ syncMsg }}
          </span>
        </div>
        <div class="grid-4" style="margin-bottom: 8px">
          <div class="form-item"><label>Broker 主机</label><input v-model="form.mqtt.host" /></div>
          <div class="form-item"><label>端口</label><input v-model.number="form.mqtt.port" type="number" /></div>
          <div class="form-item"><label>WebSocket 路径</label><input v-model="form.mqtt.path" /></div>
          <div class="form-item"><label>Topic 前缀</label><input v-model="form.mqtt.topicPrefix" /></div>
        </div>
        <div class="grid-4">
          <div class="form-item"><label>用户名</label><input v-model="form.mqtt.username" /></div>
          <div class="form-item"><label>密码</label><input v-model="form.mqtt.password" type="password" placeholder="********" /></div>
          <div class="form-item"><label>Site ID</label><input v-model="form.mqtt.siteId" /></div>
          <div class="form-item"><label>Gateway ID</label><input v-model="form.mqtt.gatewayId" /></div>
        </div>
      </div>

      <!-- 模式 1: 从站模拟器 -->
      <div v-show="form.workMode === 1" class="gw-card">
        <div class="gw-card-title">
          <span>🧪 Modbus 从站模拟器</span>
          <span class="title-hint">串口参数已套用选定 485 通道的全局配置</span>
        </div>
        <div class="grid-4" style="margin-bottom: 10px">
          <div class="form-item">
            <label>RTU 从站使能</label>
            <select v-model="simConfig.rtuEnabled">
              <option :value="true">启用</option>
              <option :value="false">禁用</option>
            </select>
          </div>
          <div class="form-item">
            <label>RTU 从站 ID</label>
            <input v-model.number="simConfig.unitId" type="number" min="1" max="247" />
          </div>
        </div>
        <div class="grid-4">
          <div class="form-item">
            <label>TCP 从站使能</label>
            <select v-model="simConfig.tcpEnabled">
              <option :value="true">启用</option>
              <option :value="false">禁用</option>
            </select>
          </div>
          <div class="form-item">
            <label>TCP 从站 ID</label>
            <input v-model.number="simConfig.tcpUnitId" type="number" min="1" max="247" />
          </div>
          <div class="form-item">
            <label>TCP 监听端口</label>
            <input v-model.number="simConfig.tcpPort" type="number" min="1" max="65535" />
          </div>
          <div class="form-item">
            <label>网络链路</label>
            <select v-model.number="simConfig.netInterface">
              <option :value="0">自动 (WiFi + W5500)</option>
              <option :value="1">仅以太网 (W5500)</option>
              <option :value="2">仅 WiFi</option>
            </select>
          </div>
        </div>

        <div style="margin-top: 14px; display: flex; gap: 8px">
          <button class="btn-sm" @click="addRegRow">+ 新增寄存器</button>
          <button class="btn-sm btn-success" @click="saveSimAll">仅保存模拟器数据</button>
        </div>

        <div class="table-wrap">
          <table class="sim-table">
            <colgroup>
              <col style="width: 9%" />
              <col style="width: 13%" />
              <col style="width: 10.5%" />
              <col style="width: 8.5%" />
              <col style="width: 9.5%" />
              <col style="width: 9.5%" />
              <col style="width: 5%" />
              <col style="width: 12%" />
              <col style="width: 7.5%" />
              <col style="width: 8.5%" />
              <col style="width: 7%" />
            </colgroup>
            <thead>
              <tr>
                <th>地址</th>
                <th>名称</th>
                <th>类型</th>
                <th>字节序</th>
                <th>设定值</th>
                <th>当前值</th>
                <th>动态</th>
                <th>范围(min~max)</th>
                <th>周期(s)</th>
                <th>模式</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(reg, idx) in simRegisters" :key="idx">
                <td><input v-model.number="reg.addr" type="number" /></td>
                <td><input v-model="reg.name" /></td>
                <td>
                  <select v-model.number="reg.type" @change="onRegTypeChange(reg)">
                    <option :value="0">INT16</option>
                    <option :value="1">UINT16</option>
                    <option :value="2">INT32</option>
                    <option :value="3">UINT32</option>
                    <option :value="4">FLOAT32</option>
                    <option :value="6">BIT</option>
                  </select>
                </td>
                <td>
                  <select v-model.number="reg.endian" :disabled="!is32BitType(reg.type)">
                    <option :value="0">ABCD</option>
                    <option :value="1">DCBA</option>
                    <option :value="2">BADC</option>
                    <option :value="3">CDAB</option>
                  </select>
                </td>
                <td><input v-model.number="reg.targetVal" type="number" step="any" /></td>
                <td><input :value="reg.val" type="number" step="any" readonly /></td>
                <td><input v-model="reg.isDyn" type="checkbox" /></td>
                <td><input v-model="reg.range" :disabled="!reg.isDyn" /></td>
                <td><input v-model.number="reg.dynInterval" type="number" :disabled="!reg.isDyn" /></td>
                <td>
                  <select v-model.number="reg.dynMode" :disabled="!reg.isDyn">
                    <option :value="0">随机</option>
                    <option :value="1">递增</option>
                    <option :value="2">递减</option>
                  </select>
                </td>
                <td>
                  <button class="btn-sm btn-danger" @click="removeRegRow(idx)">删</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 模式 2: USB 透传 -->
      <div v-show="form.workMode === 2" class="gw-card">
        <div class="gw-card-title"><span>🔌 USB 转 RS485 高速透传</span></div>
        <div class="notice-box notice-info">
          ⚡ <b>全速硬件透传已就绪：</b>网关将把 USB 虚拟串口的数据透明转发至所选的 RS485 通道。串口通信波特率、数据位、校验位与停止位均由基础设置中选定通道的参数统一控制。
        </div>
      </div>

      <!-- 模式 3: 协议互转 -->
      <div v-show="form.workMode === 3" class="gw-card">
        <div class="gw-card-title">
          <span>🔄 Modbus TCP / RTU 协议互转</span>
          <span class="title-hint">RTU 串口参数由全局 485 统一提供</span>
        </div>
        <div class="notice-box notice-info font-mono" style="margin-bottom: 12px">
          <template v-if="form.bridge.direction === 0">
            <b>当前流向 (TCP → RTU · 网关作为 TCP Server)：</b><br />
            💻 上位机 / 网络 TCP 主站 ──(Modbus TCP)──▶ <b>[ 🌐 网关本地监听端口 ]</b> ──(Modbus RTU)──▶ 🔌 RS485 串口从站
          </template>
          <template v-else>
            <b>当前流向 (RTU → TCP · 网关作为 TCP Client)：</b><br />
            🎛️ PLC / RS485 串口主站 ──(Modbus RTU)──▶ <b>[ 🔌 网关 RS485 端口 ]</b> ──(Modbus TCP)──▶ <b>[ 🌐 远端目标从站 IP : 端口 ]</b>
          </template>
        </div>
        <div class="grid-4" style="margin-bottom: 10px">
          <div class="form-item">
            <label>转换方向 (数据流向)</label>
            <select v-model.number="form.bridge.direction">
              <option :value="0">TCP → RTU (网络主站访串口从站)</option>
              <option :value="1">RTU → TCP (串口主站访网络从站)</option>
            </select>
          </div>
          <div class="form-item">
            <label>寻址模式</label>
            <select v-model.number="form.bridge.mode">
              <option :value="0">总线级 (按报头 ID 透传)</option>
              <option :value="1">单设备固定从站 ID</option>
            </select>
          </div>
          <div class="form-item">
            <label>固定从站 ID (单设备模式)</label>
            <input
              v-model.number="form.bridge.slaveId"
              type="number"
              min="1"
              max="247"
              :disabled="form.bridge.mode !== 1"
            />
          </div>
          <div class="form-item">
            <label>网络链路</label>
            <select v-model.number="form.bridge.netInterface">
              <option :value="0">自动 (WiFi + W5500)</option>
              <option :value="1">仅以太网 (W5500)</option>
              <option :value="2">仅 WiFi</option>
            </select>
          </div>
        </div>
        <div class="grid-4">
          <div class="form-item">
            <label :class="{ 'muted-label': form.bridge.direction === 1 }">
              网关本地监听端口 (TCP→RTU 生效)
            </label>
            <input
              v-model.number="form.bridge.tcpPort"
              type="number"
              min="1"
              max="65535"
              :disabled="form.bridge.direction === 1"
            />
          </div>
          <div class="form-item">
            <label :class="{ 'muted-label': form.bridge.direction === 0 }">
              远端目标从站 IP (RTU→TCP 生效)
            </label>
            <input
              v-model="form.bridge.targetIp"
              placeholder="例如 192.168.1.100"
              :disabled="form.bridge.direction === 0"
            />
          </div>
          <div class="form-item">
            <label :class="{ 'muted-label': form.bridge.direction === 0 }">
              远端目标从站端口 (RTU→TCP 生效)
            </label>
            <input
              v-model.number="form.bridge.targetPort"
              type="number"
              min="1"
              max="65535"
              :disabled="form.bridge.direction === 0"
            />
          </div>
        </div>
      </div>

      <!-- 模式 4: 总线监听与质量诊断 -->
      <div v-show="form.workMode === 4" class="gw-card">
        <div class="gw-card-title">
          <span>📡 RS485 总线监听与通讯质量诊断</span>
          <span style="font-size: 12px; font-weight: normal; color: #10b981">
            🛡️ 纯被动高阻态只听不发 · 零总线冲突风险
          </span>
        </div>

        <div class="q-grid">
          <div class="q-card">
            <div class="q-label">🎯 主从应答成功率</div>
            <div class="q-val" :style="{ color: qualitySuccessRate.color }">
              {{ qualitySuccessRate.text }}
            </div>
            <div class="q-sub">
              应答: {{ monitorStats.respCount }} / 请求: {{ monitorStats.reqCount }}
            </div>
          </div>
          <div class="q-card">
            <div class="q-label">⏱️ 从站响应耗时 (RTT)</div>
            <div class="q-val" style="color: #0284c7">
              {{ monitorStats.respCount > 0 ? `${monitorStats.lastRttMs} ms` : '-- ms' }}
            </div>
            <div class="q-sub">
              {{
                monitorStats.respCount > 0
                  ? `均值: ${monitorStats.avgRttMs} ms | 峰值: ${monitorStats.maxRttMs} ms`
                  : '均值: -- ms | 峰值: -- ms'
              }}
            </div>
          </div>
          <div class="q-card">
            <div class="q-label">⚠️ 超时无应答 / 异常码</div>
            <div
              class="q-val"
              :style="{ color: monitorStats.timeoutCount > 0 ? '#f59e0b' : '#10b981' }"
            >
              {{ monitorStats.timeoutCount }}
            </div>
            <div class="q-sub">Modbus 异常响应: {{ monitorStats.exceptionCount }}</div>
          </div>
          <div class="q-card">
            <div class="q-label">⚡ CRC 错帧 / 总捕获帧</div>
            <div
              class="q-val"
              :style="{ color: monitorStats.crcErrorCount > 0 ? '#ef4444' : '#10b981' }"
            >
              {{ monitorStats.crcErrorCount }}
            </div>
            <div class="q-sub">总线总物理帧: {{ monitorStats.totalFrames }}</div>
          </div>
        </div>

        <div class="grid-4" style="align-items: end; margin-bottom: 10px">
          <div class="form-item">
            <label>过滤从站 ID (0 = 全部从站)</label>
            <input
              v-model.number="monitorFilter.filterSlaveId"
              type="number"
              min="0"
              max="247"
              @change="applyMonitorFilter"
            />
          </div>
          <div class="form-item">
            <label>过滤功能码</label>
            <select v-model.number="monitorFilter.filterFuncCode" @change="applyMonitorFilter">
              <option :value="0">0 - 全部功能码</option>
              <option :value="1">01 - 读线圈 (0x01)</option>
              <option :value="2">02 - 读离散输入 (0x02)</option>
              <option :value="3">03 - 读保持寄存器 (0x03)</option>
              <option :value="4">04 - 读输入寄存器 (0x04)</option>
              <option :value="5">05 - 写单个线圈 (0x05)</option>
              <option :value="6">06 - 写单个寄存器 (0x06)</option>
              <option :value="15">15 - 写多个线圈 (0x0F)</option>
              <option :value="16">16 - 写多个寄存器 (0x10)</option>
            </select>
          </div>
          <div class="form-item">
            <label>超时判定阈值 (ms, 100~5000)</label>
            <input
              v-model.number="monitorFilter.timeoutMs"
              type="number"
              min="100"
              max="5000"
              @change="applyMonitorFilter"
            />
          </div>
          <div class="form-item" style="display: flex; gap: 6px; align-items: center">
            <button
              class="btn-sm"
              :style="{ background: monitorAutoRefresh ? '#0284c7' : '#10b981' }"
              @click="monitorAutoRefresh = !monitorAutoRefresh"
            >
              {{ monitorAutoRefresh ? '⏸ 暂停实时刷新' : '▶ 恢复实时刷新' }}
            </button>
            <button class="btn-sm btn-secondary" @click="fetchMonitor(false)">刷新</button>
            <button class="btn-sm btn-danger" @click="clearMonitor">清空重置</button>
          </div>
        </div>

        <div>
          <div class="monitor-head">
            <b>实时总线报文嗅探流 (最近 100 帧 · 自动标注主从身份与从站应答耗时)</b>
            <span>串口参数复用顶部所选 485 通道</span>
          </div>
          <div ref="monitorBoxRef" class="monitor-box">
            <div v-if="monitorLogs.length === 0">暂无报文，等待总线数据...</div>
            <div v-for="(l, idx) in monitorLogs" :key="idx" class="log-row">
              <span class="log-ts">[{{ l.t }}ms]</span>
              <span v-if="l.meta === 2" class="tag-resp">
                RESP 从站应答{{ l.rtt ? ` · ${l.rtt}ms` : '' }}
              </span>
              <span v-else-if="l.meta === 3" class="tag-exc">
                EXC 异常应答{{ l.rtt ? ` · ${l.rtt}ms` : '' }}
              </span>
              <span v-else-if="l.meta === 4" class="tag-crc">CRC 校验错帧</span>
              <span v-else class="tag-req">REQ 主站请求</span>
              <span class="log-meta">
                [ID:{{ l.uid ?? 0 }} FC:0x{{ (l.fc ?? 0).toString(16).toUpperCase().padStart(2, '0') }}]
              </span>
              <span class="log-hex">{{ l.hex }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 模式 5: 以太网-WiFi 桥接 -->
      <div v-show="form.workMode === 5" class="gw-card">
        <div class="gw-card-title">
          <span>🌉 以太网 ↔ WiFi 跨网段数据桥接</span>
          <span class="title-hint">支持 TCP / UDP 跨物理网卡双向透明转发</span>
        </div>
        <div class="notice-box notice-info font-mono" style="margin-bottom: 12px">
          <template v-if="form.ethWifi.direction === 0">
            <b>当前流向 (WiFi → W5500 以太网 · {{ form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }} 无线访问有线内网)：</b><br />
            💻 WiFi 上位机 / 客户端 ──({{ form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }})──▶ <b>[ 📶 网关 WiFi 监听端口 ]</b> ──(跨网段双向转发)──▶ <b>[ 🔌 W5500 有线网段目标 IP : 端口 ]</b>
          </template>
          <template v-else>
            <b>当前流向 (W5500 以太网 → WiFi · {{ form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }} 有线访问无线网段)：</b><br />
            🔌 有线网段主站 / 客户端 ──({{ form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }})──▶ <b>[ 🌐 网关 W5500 监听端口 ]</b> ──(跨网段双向转发)──▶ <b>[ 📶 WiFi 无线网段目标 IP : 端口 ]</b>
          </template>
        </div>
        <div class="grid-4" style="margin-bottom: 10px">
          <div class="form-item">
            <label>桥接方向 (数据流向)</label>
            <select v-model.number="form.ethWifi.direction">
              <option :value="0">WiFi → W5500 (无线访有线设备)</option>
              <option :value="1">W5500 → WiFi (有线访无线设备)</option>
            </select>
          </div>
          <div class="form-item">
            <label>传输层协议</label>
            <select v-model.number="form.ethWifi.protocol">
              <option :value="0">TCP 协议 (面向连接可靠流)</option>
              <option :value="1">UDP 协议 (无连接高速报文)</option>
            </select>
          </div>
        </div>
        <div class="grid-4">
          <div class="form-item">
            <label>
              {{
                form.ethWifi.direction === 1
                  ? `网关 W5500 监听 ${form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (有线入口)`
                  : `网关 WiFi 监听 ${form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (无线入口)`
              }}
            </label>
            <input v-model.number="form.ethWifi.listenPort" type="number" min="1" max="65535" />
          </div>
          <div class="form-item">
            <label>
              {{
                form.ethWifi.direction === 1
                  ? '无线网段目标 IP (WiFi 侧出口)'
                  : '有线网段目标 IP (W5500 侧出口)'
              }}
            </label>
            <input v-model="form.ethWifi.targetIp" placeholder="例如 192.168.1.100" />
          </div>
          <div class="form-item">
            <label>
              {{
                form.ethWifi.direction === 1
                  ? `无线网段目标 ${form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (WiFi 侧)`
                  : `有线网段目标 ${form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (W5500 侧)`
              }}
            </label>
            <input v-model.number="form.ethWifi.targetPort" type="number" min="1" max="65535" />
          </div>
        </div>
      </div>

      <!-- 模式 6: 双主站中继 -->
      <div v-show="form.workMode === 6" class="gw-card">
        <div class="gw-card-title">
          <span>⚡ 双主站防碰撞中继 (AnyControl 硬件复用模式)</span>
        </div>
        <div class="notice-box">
          💡 <b>硬件双通道绑定运行 (Dual485-Controller-V1)：</b>此模式下两路 485 均全速启用。<b>485-1 接口 (UART0 · GPIO 2/3)</b> 固定连接原物理主站/触摸屏并按 485-1 全局参数运行；<b>485-2 接口 (UART1 · GPIO 5/4)</b> 固定连接现场从站总线并按 485-2 全局参数运行。网关在底层执行互斥防碰撞调度，并原生兼容 <b>AnyControl</b> 平台在线配置下发与状态遥测。
        </div>
        <div class="grid-4">
          <div class="form-item">
            <label>WiFi Modbus TCP 监听端口 (第 2 主站)</label>
            <input v-model.number="form.dualMaster.wifiPort" type="number" placeholder="默认 9502" />
          </div>
          <div class="form-item">
            <label>从站响应超时 (ms, 100~3000)</label>
            <input v-model.number="form.dualMaster.masterTimeout" type="number" min="100" max="3000" />
          </div>
          <div class="form-item">
            <label>心跳保活周期 (秒)</label>
            <input v-model.number="form.dualMaster.heartbeatInterval" type="number" min="5" max="86400" />
          </div>
        </div>
      </div>
    </div>

    <!-- ================= 主面板 3: 固件维护与 OTA ================= -->
    <div v-show="mainTab === 'ota'">
      <div class="gw-card">
        <div class="gw-card-title">
          <span>🚀 远程固件更新 (OTA) 与分区容灾</span>
          <span class="title-hint">ESP32 双 OTA 分区安全升级</span>
        </div>
        <div class="notice-box notice-info">
          🛡️ <b>双分区容灾机制：</b>网关内置 A/B 两个独立固件分区。OTA 升级将写入备用分区；若升级后出现异常，随时可点击一键回滚恢复到上一个稳定固件。
        </div>
        <div class="grid-2" style="margin-bottom: 12px">
          <div class="form-item">
            <label>OTA 更新服务地址 (Base URL)</label>
            <input v-model="form.otaApi" placeholder="https://your-firmware-worker.workers.dev" />
          </div>
          <div class="form-item" style="display: flex; align-items: flex-end; gap: 8px">
            <button class="btn-sm" @click="checkOta">检查固件更新</button>
            <button v-if="otaFound" class="btn-sm btn-success" @click="doOta">立即升级固件</button>
            <button class="btn-sm btn-danger" @click="doRollback">一键回滚备用固件</button>
          </div>
        </div>
        <div class="ota-msg" v-html="otaStatusHtml"></div>
        <pre v-if="otaFound && otaChangelog" class="ota-changelog">{{ otaChangelog }}</pre>
      </div>
    </div>

    <!-- 3. 底部全量保存按钮 -->
    <button class="btn-save-main" @click="saveConfig">保存全量配置并重启网关</button>

    <!-- 4. 全局状态诊断弹窗 -->
    <Teleport to="body">
      <div v-if="showTelemetryModal" class="tel-overlay" @click.self="showTelemetryModal = false">
        <div class="tel-modal">
          <div class="tel-modal-head">
            <span>📊 网关硬件状态与通讯延迟诊断</span>
            <button class="tel-close" @click="showTelemetryModal = false">✕</button>
          </div>
          <div class="tel-body">
            <div class="tel-header-card">
              <div class="tel-gw-row">
                <span class="tel-gw-name">
                  {{ sysStatus.gatewayName }} ({{ MODE_NAMES[sysStatus.mode] || sysStatus.mode }})
                </span>
                <span class="tel-fw-badge">固件 {{ sysStatus.version }}</span>
              </div>
              <div class="tel-ip-row">
                WiFi IP: {{ sysStatus.wifiIp }} | ETH IP: {{ sysStatus.ethIp }} | 最新同步: {{ lastSyncTime }}
              </div>
            </div>

            <div class="tel-grid">
              <div class="tel-card">
                <div class="tel-label">📶 网络往返延迟</div>
                <div class="tel-val tel-emerald">
                  <span>{{ netLatencyMs }}</span><span class="tel-unit">ms</span>
                </div>
                <div class="tel-tip">上位机至网关 HTTP 通信耗时</div>
              </div>
              <div class="tel-card">
                <div class="tel-label">⚡ RS485 总线应答延迟</div>
                <div class="tel-val tel-cyan">
                  <span>{{ sysStatus.busLatencyMs }}</span><span class="tel-unit">ms</span>
                </div>
                <div class="tel-tip">网关与物理从站通信耗时</div>
              </div>

              <div class="tel-card tel-card-full">
                <div class="tel-label">
                  🔄 {{ sysStatus.mode === 6 ? '双主站中继调度与错误统计' : `${MODE_NAMES[sysStatus.mode] || '总线'}通信吞吐与错误统计` }}
                </div>
                <div class="tel-dual-row">
                  <span>
                    {{ sysStatus.mode === 6 ? '物理主站 (485-1)' : 'RS485 串口通道' }}:
                    <b class="tel-cyan">{{ sysStatus.master1Frames }}</b> 帧
                  </span>
                  <span>
                    {{ sysStatus.mode === 6 ? 'WiFi 主站 (Master 2)' : '网络通道 (TCP/MQTT)' }}:
                    <b class="tel-emerald">{{ sysStatus.master2Frames }}</b> 帧
                  </span>
                  <span>
                    CRC 错误:
                    <b :class="sysStatus.busCrcErrors > 0 ? 'tel-rose' : 'tel-emerald'">
                      {{ sysStatus.busCrcErrors }}
                    </b>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="tel-footer">
            <button class="btn-tel-retest" :disabled="isRetestingTel" @click="retestTelemetry">
              {{ isRetestingTel ? '⏳ 正在检测...' : '🔄 重新检测网关' }}
            </button>
            <button class="btn-sm" @click="showTelemetryModal = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <div
      v-if="toastState.show"
      class="gw-toast"
      :style="{ background: toastState.ok ? '#10b981' : '#ef4444' }"
    >
      {{ toastState.msg }}
    </div>
  </div>
</template>

<style scoped>
.gw-console {
  width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 14px;
  color: var(--color-text);
  padding-bottom: 24px;
}

/* 顶栏 Header */
.topbar {
  background: #0f172a;
  color: #f8fafc;
  border: 1px solid #1e293b;
  border-radius: var(--radius-lg, 12px);
  padding: 16px 24px;
  margin-bottom: 18px;
  box-shadow: var(--shadow-sm);
}
.topbar-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1e293b;
}
.brand-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 700;
}
.dot-status {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  display: inline-block;
}
.dot-online {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
}
.status-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background: #1e293b;
  color: #94a3b8;
}
.topbar-conn {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.conn-label {
  font-size: 13px;
  color: #94a3b8;
}
.quick-ip-select {
  background: #1e293b;
  border: 1px solid #334155;
  color: #38bdf8;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  height: 36px;
}
.gw-addr-composite {
  display: flex;
  align-items: center;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 6px;
  overflow: hidden;
  height: 36px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.gw-addr-composite:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}
.gw-proto-select {
  background: #0f172a;
  border: none;
  border-right: 1px solid #334155;
  color: #38bdf8;
  font-weight: 600;
  padding: 0 8px;
  height: 100%;
  font-size: 13px;
  outline: none;
  cursor: pointer;
}
.gw-proto-select:focus {
  background: #1e293b;
}
.gw-host-input {
  background: transparent !important;
  border: none !important;
  color: #fff !important;
  padding: 0 10px !important;
  font-size: 13px !important;
  width: 190px !important;
  height: 100% !important;
  outline: none !important;
}
.gw-host-input::placeholder {
  color: #64748b;
  font-size: 12px;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
  border: none;
  padding: 0 18px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  height: 36px;
}
.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}
.btn-diag {
  background: #0284c7;
  color: #fff;
  border: none;
  padding: 0 18px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  height: 36px;
}
.btn-diag:hover {
  background: #0369a1;
}
.topbar-stats {
  padding-top: 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  font-size: 13px;
  color: #94a3b8;
}
.topbar-stats span b {
  color: #38bdf8;
  font-weight: 600;
}

/* 一级导航栏 */
.main-nav {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  border-bottom: 2px solid var(--color-border);
  padding-bottom: 4px;
}
.main-tab-btn {
  padding: 10px 22px;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-bottom: 3px solid transparent;
  margin-bottom: -6px;
  border-radius: 6px 6px 0 0;
}
.main-tab-btn:hover {
  color: var(--color-primary);
  background: transparent;
}
.main-tab-btn.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  background: rgba(102, 126, 234, 0.1);
}

/* 二级导航栏 */
.sub-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.sub-nav {
  display: flex;
  gap: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 5px;
  border-radius: 8px;
}
.sub-tab-btn {
  padding: 7px 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: 6px;
}
.sub-tab-btn.active {
  background: var(--color-primary);
  color: #ffffff;
}
.gw-name-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-surface);
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
}
.gw-name-box label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
  white-space: nowrap;
}
.gw-name-box input {
  width: 220px;
  height: 32px;
  padding: 4px 10px;
  font-size: 14px;
}

/* 卡片与表单 */
.gw-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 12px);
  padding: 22px 26px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.gw-card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-primary);
  margin: 0 0 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title-hint {
  font-size: 13px;
  font-weight: normal;
  color: var(--color-text-secondary);
}
.gw-card-subtitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 14px 0 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px 18px;
}
.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px 22px;
}
@media (max-width: 1100px) {
  .grid-4 {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 640px) {
  .grid-4,
  .grid-2 {
    grid-template-columns: 1fr;
  }
}

.form-item label {
  display: block;
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  font-weight: 500;
}
.form-item label.muted-label {
  opacity: 0.45;
}
.form-item input,
.form-item select {
  width: 100%;
  height: 38px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
}
.form-item input[readonly],
.form-item input:disabled,
.form-item select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 工作模式总控卡片 */
.mode-header-card {
  background: rgba(102, 126, 234, 0.08);
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-radius: var(--radius-lg, 12px);
  padding: 18px 24px;
  margin-bottom: 16px;
}
.mode-header-card .header-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: center;
}
@media (max-width: 720px) {
  .mode-header-card .header-grid {
    grid-template-columns: 1fr;
  }
}
.mode-top-label {
  font-weight: 700 !important;
  color: var(--color-primary) !important;
  font-size: 14px !important;
}
.mode-header-card select {
  height: 40px;
  font-size: 14px;
  font-weight: 700;
}
.mode-desc-text {
  margin-top: 10px;
  font-size: 13px;
  color: var(--color-primary);
  font-weight: 500;
}

/* 云同步栏 */
.sync-bar {
  background: var(--color-bg);
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 10px 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.sync-bar input {
  height: 34px;
  padding: 4px 10px;
  font-size: 13px;
  width: 180px;
}
.sync-bar button {
  height: 34px;
  background: #0ea5e9;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
}

/* 模拟器寄存器表格 */
.table-wrap {
  width: 100%;
  overflow-x: auto;
  margin-top: 14px;
}
.sim-table {
  width: 100%;
  min-width: 960px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
}
.sim-table th,
.sim-table td {
  border: 1px solid var(--color-border);
  padding: 8px;
  text-align: center;
  white-space: nowrap;
}
.sim-table th {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  font-weight: 600;
}
.sim-table td input:not([type='checkbox']),
.sim-table td select {
  width: 100%;
  height: 34px;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg);
  color: var(--color-text);
}
.sim-table td input[type='checkbox'] {
  width: 17px;
  height: 17px;
  vertical-align: middle;
  cursor: pointer;
}
.sim-table td input[readonly],
.sim-table td input:disabled,
.sim-table td select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 总线质量看板与监控框 */
.q-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
@media (max-width: 900px) {
  .q-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.q-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
}
.q-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
  margin-bottom: 6px;
}
.q-val {
  font-size: 24px;
  font-weight: 700;
  font-family: Consolas, Monaco, monospace;
}
.q-sub {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 4px;
  font-family: Consolas, Monaco, monospace;
}
.monitor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.monitor-box {
  background: #0f172a;
  color: #e2e8f0;
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
  line-height: 1.7;
  height: 360px;
  overflow-y: auto;
  padding: 12px 16px;
  border-radius: 8px;
  margin-top: 10px;
  border: 1px solid #1e293b;
}
.log-row {
  margin-bottom: 4px;
}
.log-ts {
  color: #64748b;
  margin-right: 6px;
}
.log-meta {
  color: #94a3b8;
  margin: 0 6px;
}
.log-hex {
  color: #f8fafc;
}
.tag-req {
  background: #1e3a8a;
  color: #93c5fd;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 600;
}
.tag-resp {
  background: #064e3b;
  color: #6ee7b7;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 600;
}
.tag-exc {
  background: #78350f;
  color: #fcd34d;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 600;
}
.tag-crc {
  background: #7f1d1d;
  color: #fca5a5;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 600;
}

/* 提示框与按钮 */
.notice-box {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: var(--color-text);
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.6;
}
.notice-info {
  background: rgba(14, 165, 233, 0.1);
  border-color: rgba(14, 165, 233, 0.3);
}
.btn-save-main {
  width: 100%;
  height: 46px;
  background: #10b981;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  margin-top: 12px;
}
.btn-save-main:hover {
  background: #059669;
}
.btn-sm {
  padding: 0 16px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: #2563eb;
  height: 36px;
}
.btn-success {
  background: #10b981;
}
.btn-danger {
  background: #ef4444;
}
.btn-secondary {
  background: #64748b;
}

.ota-msg {
  margin-top: 10px;
  font-size: 13px;
  min-height: 22px;
}
.ota-changelog {
  margin-top: 10px;
  padding: 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 13px;
  white-space: pre-wrap;
}

/* 状态诊断弹窗 */
.tel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
}
.tel-modal {
  width: 100%;
  max-width: 620px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  color: #e2e8f0;
  overflow: hidden;
}
.tel-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #1e293b;
  font-size: 15px;
  font-weight: 700;
  color: #f8fafc;
}
.tel-close {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 18px;
  padding: 2px 6px;
}
.tel-body {
  padding: 18px 20px;
}
.tel-header-card {
  background: #162033;
  border: 1px solid #26354d;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.tel-gw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.tel-gw-name {
  font-size: 16px;
  font-weight: 700;
  color: #22d3ee;
  font-family: Consolas, Monaco, monospace;
}
.tel-fw-badge {
  background: #dcfce7;
  color: #15803d;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: Consolas, Monaco, monospace;
}
.tel-ip-row {
  font-size: 12px;
  color: #94a3b8;
  font-family: Consolas, Monaco, monospace;
}
.tel-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.tel-card {
  background: #131c2e;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 12px 16px;
}
.tel-card-full {
  grid-column: 1 / -1;
}
.tel-label {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 6px;
}
.tel-val {
  font-size: 22px;
  font-weight: 700;
  font-family: Consolas, Monaco, monospace;
  line-height: 1.2;
  margin-bottom: 4px;
}
.tel-unit {
  font-size: 12px;
  font-weight: 500;
  opacity: 0.85;
  margin-left: 3px;
}
.tel-tip {
  font-size: 11px;
  color: #64748b;
}
.tel-emerald {
  color: #10b981;
}
.tel-cyan {
  color: #06b6d4;
}
.tel-rose {
  color: #f43f5e;
}
.tel-dual-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  background: #172136;
  border-radius: 6px;
  padding: 10px 14px;
  margin-top: 6px;
  font-size: 12px;
  font-family: Consolas, Monaco, monospace;
  color: #94a3b8;
}
.tel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid #1e293b;
  background: #0b1120;
}
.btn-tel-retest {
  background: rgba(14, 165, 233, 0.15);
  color: #38bdf8;
  border: 1px solid #0284c7;
  border-radius: 5px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
}

.gw-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 10px 18px;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 3000;
}
</style>
