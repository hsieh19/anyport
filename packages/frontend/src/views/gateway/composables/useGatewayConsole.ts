import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { fetchCloudMqttConfig } from '@/services/cloudConfigService';
import { renderMarkdown } from '@/utils/markdown';
import type { SimRegisterItem, MonitorLogItem, GatewaySysStatus } from '../types';

const STORAGE_KEY_API_BASE = 'anyport_gw_api_base';
const STORAGE_KEY_BRIDGE_PORT = 'anyport_bridge_port';

export function useGatewayConsole() {
  const deviceStore = useDeviceStore();

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

  // 重启轮询与 DHCP 新 IP 上报弹窗状态
  const isRebooting = ref(false);
  const dhcpReportModal = reactive({
    show: false,
    ssid: '',
    wifiIp: '',
    wifiMask: '',
    wifiGw: '',
    wifiDns: '',
  });

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

  function normalizedBase(): string {
    let host = gwHost.value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host) host = '192.168.4.1';
    return `${gwProtocol.value}${host}`;
  }

  function applyReportedWifiIp(connectNow = false) {
    if (!dhcpReportModal.wifiIp) return;
    gwProtocol.value = 'http://';
    gwHost.value = dhcpReportModal.wifiIp;
    localStorage.setItem(STORAGE_KEY_API_BASE, normalizedBase());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(dhcpReportModal.wifiIp).catch(() => {});
    }
    dhcpReportModal.show = false;
    showToast(`已填入新网关地址 http://${dhcpReportModal.wifiIp} 并复制 IP`);
    if (connectNow) {
      connectDevice();
    }
  }

  // 网关实时状态遥测 (/api/sys/status)
  const sysStatus = reactive<GatewaySysStatus>({
    version: '--',
    mode: 0,
    rs485Channel: 0,
    gatewayName: 'AnyPort 网关',
    wifiConnected: false,
    mqttConnected: null,
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
    chipTemp: null,
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
      proxyMode: 0,
      slaveId: 1,
      wifiPort: 9502,
      masterTimeout: 1000,
      heartbeatInterval: 30,
    },
  });

  // 从站模拟器配置与寄存器表 (/api/simConfig & /api/registers)
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

  // OTA 检查与备用分区回滚状态
  const otaFound = ref(false);
  const otaVersion = ref('');
  const otaChangelog = ref('');
  const otaStatusHtml = ref('');
  const otaCanRollback = ref(false);
  const otaBackupVersion = ref('');
  const renderedOtaChangelog = computed(() => renderMarkdown(otaChangelog.value));

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

  // 智能 HTTP 请求引擎
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

  // 硬件 MQTT Broker 连接状态指示（优先读取固件 /api/sys/status 的 mqttConnected，同时兼容前端已发现网关列表心跳）
  const mqttBrokerStatus = computed<{
    state: 'online' | 'offline' | 'inactive' | 'standby';
    text: string;
    detail: string;
  }>(() => {
    if (!isOnline.value) {
      return {
        state: 'offline',
        text: '网关未连接',
        detail: '尚未连接到网关 HTTP 控制台',
      };
    }

    if (sysStatus.mode !== 0) {
      return {
        state: 'inactive',
        text: '当前未运行 MQTT 模式',
        detail: '请保存并重启切换至「0 - MQTT 网关模式」后生效',
      };
    }

    const hostLabel = form.mqtt.host
      ? `${form.mqtt.host}:${form.mqtt.port || 443}`
      : 'Broker';

    // 1. 固件直接上报了 mqttConnected 布尔值
    if (typeof sysStatus.mqttConnected === 'boolean') {
      if (sysStatus.mqttConnected) {
        return {
          state: 'online',
          text: '已连接 Broker',
          detail: `硬件已成功连接至 ${hostLabel}`,
        };
      }
      return {
        state: 'offline',
        text: '未连接 Broker',
        detail: `硬件尚未连上 ${hostLabel}，请检查 Broker 地址、端口(8883/1883)及账号密码`,
      };
    }

    // 2. 旧版固件未返回 mqttConnected 字段时，从 deviceStore 已发现网关列表中匹配当前网关的在线状态
    const matchedGw = (deviceStore.gateways || []).find((g) => {
      const idMatch =
        form.mqtt.siteId &&
        form.mqtt.gatewayId &&
        g.siteId === form.mqtt.siteId.trim() &&
        g.gatewayId === form.mqtt.gatewayId.trim();
      const ipMatch =
        (sysStatus.wifiIp &&
          sysStatus.wifiIp !== '0.0.0.0' &&
          g.config?.wifiIp === sysStatus.wifiIp) ||
        (sysStatus.ethIp &&
          sysStatus.ethIp !== '0.0.0.0' &&
          g.config?.ethIp === sysStatus.ethIp);
      return idMatch || ipMatch;
    });

    if (matchedGw) {
      return matchedGw.online
        ? {
            state: 'online',
            text: '已连接 Broker',
            detail: `已收到网关 ${matchedGw.siteId}/${matchedGw.gatewayId} 的 Broker 在线心跳`,
          }
        : {
            state: 'offline',
            text: '未连接 Broker (离线)',
            detail: `网关在 Broker 上的状态为离线`,
          };
    }

    return {
      state: 'standby',
      text: '升级固件至 v2.3+ 或在调试页连接 Broker 可直接检测状态',
      detail: '当前 v2.2 固件未直接上报 mqttConnected 字段',
    };
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
    sysStatus.mqttConnected =
      typeof s.mqttConnected === 'boolean' ? s.mqttConnected : null;
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

      form.dualMaster.proxyMode = c.dualMaster?.proxyMode === 1 ? 1 : 0;
      form.dualMaster.slaveId = c.dualMaster?.slaveId || 1;
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

      // 同步备用 OTA 分区版本与回滚可用性
      try {
        const otaSt = await apiGet('/api/ota/status');
        otaCanRollback.value = !!otaSt?.canRollback;
        otaBackupVersion.value = otaSt?.backupVersion ? String(otaSt.backupVersion) : '';
      } catch {
        otaCanRollback.value = false;
        otaBackupVersion.value = '';
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

  // 云端一键拉取 MQTT 参数（复用 cloudConfigService）
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
      const data = await fetchCloudMqttConfig(pwd);
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
          proxyMode: Number(form.dualMaster.proxyMode) === 1 ? 1 : 0,
          slaveId: Number(form.dualMaster.slaveId) || 1,
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
      showToast('配置已提交，网关正在重启并连接网络，请稍候...');
      await waitForRebootAndReportIp(payload.wifi.ssid, isDhcp, payload.wifi.ip);
    } catch (e: any) {
      showToast('保存失败: ' + e.message, false);
    }
  }

  // 重启后持续轮询网关状态，连上 WiFi 后自动回显并上报新分配的局域网 IP
  async function waitForRebootAndReportIp(targetSsid: string, isDhcp: boolean, staticIp: string) {
    isRebooting.value = true;
    isOnline.value = false;

    await new Promise((r) => setTimeout(r, 2500));

    const maxAttempts = 22;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const t0 = performance.now();
        const s = await apiGet('/api/sys/status');
        const lat = Math.max(1, Math.round(performance.now() - t0));
        applyStatusPayload(s, lat);

        await connectDevice();

        if (
          s.wifiConnected &&
          s.wifiIp &&
          s.wifiIp !== '0.0.0.0' &&
          s.wifiIp !== '192.168.4.1'
        ) {
          dhcpReportModal.ssid = targetSsid || form.wifi.ssid || 'WiFi';
          dhcpReportModal.wifiIp = s.wifiIp;
          dhcpReportModal.wifiMask = s.wifiMask || '255.255.255.0';
          dhcpReportModal.wifiGw = s.wifiGw || '--';
          dhcpReportModal.wifiDns = s.wifiDns || '--';
          dhcpReportModal.show = true;
        } else if (!isDhcp && staticIp) {
          showToast(`网关已重启，静态 IP 已设为 ${staticIp}`);
        } else if (targetSsid && !s.wifiConnected) {
          showToast('网关已重启，但未能连入指定 WiFi，已回退至 AP 热点模式', false);
        }
        isRebooting.value = false;
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    isRebooting.value = false;
    if (!isDhcp && staticIp) {
      gwProtocol.value = 'http://';
      gwHost.value = staticIp;
      localStorage.setItem(STORAGE_KEY_API_BASE, normalizedBase());
      showToast(`网关已重启，地址已自动切换为静态 IP ${staticIp}（若不可达可在 3 分钟内连 anyport 热点 192.168.4.1 排查）`);
    } else {
      showToast('原地址响应超时（若 DHCP 分配了新 IP，可在 3 分钟内连接 anyport 热点访问 192.168.4.1 查看最新 IP）', false);
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
    const verLabel = otaBackupVersion.value ? ` (v${otaBackupVersion.value})` : '';
    if (!confirm(`确认回滚至备用分区固件${verLabel}？`)) return;
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

  return {
    gwProtocol,
    gwHost,
    isHttpsPage,
    useBridgeProxy,
    isOnline,
    isConnecting,
    netLatencyMs,
    lastSyncTime,
    mainTab,
    netTab,
    showTelemetryModal,
    isRetestingTel,
    isRebooting,
    dhcpReportModal,
    toastState,
    sysStatus,
    form,
    simConfig,
    simRegisters,
    monitorStats,
    monitorFilter,
    monitorLogs,
    monitorAutoRefresh,
    monitorBoxRef,
    syncCode,
    syncLoading,
    syncMsg,
    syncOk,
    otaFound,
    otaVersion,
    otaChangelog,
    otaStatusHtml,
    otaCanRollback,
    otaBackupVersion,
    renderedOtaChangelog,
    discoveredGatewayIps,
    activeChannelLabel,
    mqttBrokerStatus,
    qualitySuccessRate,
    applyReportedWifiIp,
    onSelectDiscoveredGateway,
    formatUptime,
    connectDevice,
    openTelemetry,
    retestTelemetry,
    is32BitType,
    onRegTypeChange,
    addRegRow,
    removeRegRow,
    saveSimAll,
    fetchMonitor,
    applyMonitorFilter,
    clearMonitor,
    doCloudSync,
    saveConfig,
    checkOta,
    doOta,
    doRollback,
  };
}

export type GatewayConsoleContext = ReturnType<typeof useGatewayConsole>;
