<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useFirmwareStore } from "@/stores/firmwareStore";
import {
  Cpu,
  Download,
  Zap,
  CheckCircle2,
  AlertCircle,
  RefreshCcw,
  Usb,
  Info,
  Wifi,
  Globe,
  MonitorSmartphone,
} from "lucide-vue-next";

// esptool-js v0.6.0 - 使用对象参数构造函数
// @ts-ignore
import { ESPLoader, Transport } from "esptool-js";

const firmwareStore = useFirmwareStore();
const status = ref<
  "idle" | "connecting" | "connected" | "flashing" | "success" | "error"
>("idle");
const errorMsg = ref("");
const flashProgress = ref(0);
const chipInfo = ref<{ model: string; mac: string } | null>(null);

let transport: any = null;
let esploader: any = null;

onMounted(async () => {
  try {
    await firmwareStore.fetchManifest();
  } catch (e) {
    errorMsg.value = "无法拉取云端固件清单";
  }
});

const connectDevice = async () => {
  if (!("serial" in navigator)) {
    errorMsg.value = "当前浏览器不支持 WebSerial API，请使用 Chrome 或 Edge";
    status.value = "error";
    return;
  }

  status.value = "connecting";
  errorMsg.value = "";
  chipInfo.value = null;

  try {
    // 1. 请求串口授权
    // @ts-ignore
    const port = await navigator.serial.requestPort();
    if (!port) return;

    // 2. Transport 构造: new Transport(device: SerialPort, tracing?: boolean)
    transport = new Transport(port);

    // 3. ESPLoader v0.6.0: 构造函数接受单个对象参数
    const terminal = {
      clean() {},
      writeLine: (data: string) => console.log("[ESP]", data),
      write: (data: string) => console.log("[ESP]", data),
    };

    esploader = new ESPLoader({
      transport,
      baudrate: 115200,
      terminal,
      debugLogging: false,
    });

    // 4. v0.6.0 使用 main()，不再是 main_fn()，返回芯片系列名
    const chipFamily = await esploader.main();

    // 5. Transport.getInfo() 返回 VID/PID 字符串（这才是正确的调用位置）
    const deviceInfo = transport.getInfo();

    chipInfo.value = {
      model: chipFamily,
      mac: deviceInfo || "Unknown",
    };

    status.value = "connected";
  } catch (e: any) {
    console.error("[Flasher] Connect Error:", e);
    if (e.name === "NotFoundError") {
      // 用户取消选择串口，静默恢复
      status.value = "idle";
      return;
    }
    errorMsg.value = e.message || "连接失败，请检查串口是否被占用";
    status.value = "error";
  }
};

const startFlash = async () => {
  if (!esploader || !firmwareStore.manifest) return;

  status.value = "flashing";
  flashProgress.value = 0;
  errorMsg.value = "";

  try {
    // 1. 获取固件（优先从 IndexedDB 缓存，命中则无网络请求）
    const buffer = await firmwareStore.getFirmwareData();

    // 2. v0.6.0 API: writeFlash()（不再是 write_flash）
    await esploader.writeFlash({
      fileArray: [{ data: new Uint8Array(buffer), address: 0x0 }],
      flashSize: "keep" as any,
      flashMode: "dio" as any,
      flashFreq: "40m" as any,
      eraseAll: false,
      compress: true,
      reportProgress: (_: number, written: number, total: number) => {
        flashProgress.value = Math.round((written / total) * 100);
      },
    });

    status.value = "success";

    // 取消自动复位，改由提示用户手动点击单片机 RST 按钮
  } catch (e: any) {
    console.error("[Flasher] Flash Error:", e);
    errorMsg.value = e.message || "烧录过程出错";
    status.value = "error";
  }
};

const reset = () => {
  // 断开传输层，释放串口锁，否则下次无法重新连接
  if (transport) {
    transport.disconnect().catch(() => {});
    transport = null;
    esploader = null;
  }
  status.value = "idle";
  chipInfo.value = null;
  errorMsg.value = "";
  flashProgress.value = 0;
};
</script>

<template>
  <div class="flasher-container">
    <!-- 头部清单状态 -->
    <div class="manifest-card">
      <div class="card-header">
        <Download :size="20" class="icon-primary" />
        <h3>云端固件状态</h3>
        <span v-if="firmwareStore.isFetchingManifest" class="loading-tag"
          >正在同步...</span
        >
      </div>

      <div v-if="firmwareStore.manifest" class="manifest-details">
        <div class="detail-item">
          <span class="label">量产版本</span>
          <span class="value accent"
            >v{{ firmwareStore.manifest.version }}</span
          >
        </div>
        <div class="detail-item">
          <span class="label">发布时间</span>
          <span class="value">{{
            new Date(firmwareStore.manifest.release_time).toLocaleString()
          }}</span>
        </div>
        <div class="detail-item">
          <span class="label">本地缓存</span>
          <span class="cache-badge" :class="firmwareStore.cacheStatus">
            {{
              firmwareStore.cacheStatus === "cached"
                ? "已缓存（离线可用）"
                : firmwareStore.cacheStatus === "outdated"
                  ? "有新版本"
                  : "未缓存"
            }}
          </span>
        </div>
      </div>
      <div v-else class="manifest-error">
        <AlertCircle :size="15" />
        <span>未能获取固件清单，请检查网络或 Worker 部署状态</span>
      </div>
    </div>

    <!-- 两步操作流程 -->
    <div class="main-workflow">
      <!-- 步骤 1：连接 -->
      <div
        class="step-card"
        :class="{
          active:
            status === 'idle' || status === 'connecting' || status === 'error',
        }"
      >
        <div class="step-num">01</div>
        <div class="step-content">
          <h4>连接 ESP32 设备</h4>
          <p>
            通过 USB 数据线连接全新的 ESP32-C3
            控制板，确保没有其它程序占用串口。
          </p>

          <button
            v-if="
              status === 'idle' || status === 'error' || status === 'connecting'
            "
            class="btn-connect"
            :disabled="status === 'connecting'"
            @click="connectDevice"
          >
            <Usb :size="18" />
            <span>{{
              status === "connecting" ? "握手中..." : "选择串口并连接"
            }}</span>
          </button>

          <div v-if="chipInfo" class="chip-card">
            <Cpu :size="28" class="icon-primary" />
            <div class="chip-info">
              <div class="chip-model">{{ chipInfo.model }}</div>
              <div class="chip-meta">{{ chipInfo.mac }}</div>
            </div>
            <CheckCircle2 class="icon-success" />
          </div>
        </div>
      </div>

      <!-- 步骤 2：烧录 -->
      <div
        class="step-card"
        :class="{
          active:
            status === 'connected' ||
            status === 'flashing' ||
            status === 'success',
        }"
      >
        <div class="step-num">02</div>
        <div class="step-content">
          <h4>全量固件烧录</h4>
          <p>将包含 Bootloader、分区表和应用程序的完整合包一次性写入 Flash。</p>

          <button
            v-if="status === 'connected'"
            class="btn-flash"
            @click="startFlash"
          >
            <Zap :size="19" />
            <span>开始烧录</span>
          </button>

          <!-- 断开连接操作 -->
          <div v-if="status === 'connected'" class="disconnect-wrap">
            <button class="btn-disconnect" @click="reset">
              <RefreshCcw :size="15" />
              <span>断开当前连接</span>
            </button>
          </div>

          <div v-if="status === 'flashing'" class="progress-wrap">
            <div class="progress-header">
              <span>写入 Flash...</span>
              <span class="pct">{{ flashProgress }}%</span>
            </div>
            <div class="progress-bg">
              <div
                class="progress-fill"
                :style="{ width: `${flashProgress}%` }"
              ></div>
            </div>
          </div>

          <div v-if="status === 'success'" class="success-wrap">
            <div class="pulse-ring">
              <CheckCircle2 :size="44" color="#10b981" />
            </div>
            <p class="success-msg">烧录成功，请手动复位</p>
            <p class="success-sub">请按下控制板上的 <b>RST</b> 按钮重启并退出下载模式</p>
            <button class="btn-next" @click="reset">
              <RefreshCcw :size="15" />
              <span>烧录下一个</span>
            </button>
          </div>

          <div
            v-if="errorMsg && (status === 'error' || status === 'flashing')"
            class="error-wrap"
          >
            <AlertCircle :size="17" />
            <span>{{ errorMsg }}</span>
            <button class="btn-retry" @click="reset">重试</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 烧录后配网指引 -->
    <div class="guide-card">
      <div class="card-header guide-header">
        <Info :size="20" class="icon-primary" />
        <h3>配置说明：设备如何接入网络</h3>
      </div>
      
      <div class="guide-steps">
        <div class="guide-step">
          <div class="guide-icon"><Wifi :size="18" /></div>
          <div class="guide-text">
            <h4>1. 连接设备热点</h4>
            <p>设备首次连接，用电脑或手机搜索名为 <code class="highlight">anyport</code> 的 Wi-Fi 热点，使用密码 <code class="highlight">123456</code> 连接。</p>
          </div>
        </div>
        
        <div class="guide-step">
          <div class="guide-icon"><Globe :size="18" /></div>
          <div class="guide-text">
            <h4>2. 访问配置页</h4>
            <p>连接成功后，打开浏览器访问 <code class="highlight">192.168.4.1</code> 进入无线配置后台，为控制板配置可用的工作 Wi-Fi 网络。</p>
          </div>
        </div>
        
        <div class="guide-step">
          <div class="guide-icon"><MonitorSmartphone :size="18" /></div>
          <div class="guide-text">
            <h4>3. 正式局域网登录</h4>
            <p>配网成功后设备将自动连接网络。在同一局域网下访问 <code class="highlight">http://anyport.local</code> 即可正式体验，也可在后台查看 DHCP 分配的具体 IP，使用 IP 登录。</p>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.flasher-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  animation: fadeUp 0.3s ease-out;
}

@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── 清单卡片 ── */
.manifest-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.card-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.loading-tag {
  margin-left: 0.5rem;
  font-size: 0.72rem;
  color: var(--color-primary);
  background: rgba(102, 126, 234, 0.12);
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
}

.manifest-details {
  display: flex;
  gap: 2.5rem;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.detail-item .label {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-item .value {
  font-weight: 600;
  color: var(--color-text);
}

.value.accent {
  color: var(--color-primary);
  font-family: "JetBrains Mono", monospace;
  font-size: 1.15rem;
}

.cache-badge {
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.15rem 0.6rem;
  border-radius: 10px;
}
.cache-badge.cached {
  background: #d1fae5;
  color: #065f46;
}
.cache-badge.outdated {
  background: #fef3c7;
  color: #92400e;
}
.cache-badge.none {
  background: #f3f4f6;
  color: #6b7280;
}

.manifest-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.84rem;
  color: #dc2626;
}

/* ── 步骤网格 ── */
.main-workflow {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 1.5rem;
}

.step-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 2rem;
  position: relative;
  opacity: 0.55;
  transition:
    opacity 0.25s,
    border-color 0.25s,
    box-shadow 0.25s;
}

.step-card.active {
  opacity: 1;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.step-num {
  position: absolute;
  top: -13px;
  left: 18px;
  background: var(--gradient-primary);
  color: #fff;
  font-weight: 800;
  font-size: 1rem;
  padding: 0.15rem 0.65rem;
  border-radius: 6px;
  box-shadow: 0 3px 8px rgba(102, 126, 234, 0.35);
}

.step-content h4 {
  margin: 0.4rem 0 0.6rem;
  font-size: 1.15rem;
}

.step-content > p {
  color: var(--color-text-secondary);
  font-size: 0.88rem;
  line-height: 1.6;
  margin-bottom: 1.75rem;
}

/* ── 按钮 ── */
.btn-connect,
.btn-flash {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 0.85rem;
  border-radius: var(--radius-md);
  border: none;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.95rem;
}

.btn-connect {
  background: var(--color-surface-hover);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-connect:hover:not(:disabled) {
  background: var(--color-border);
  transform: translateY(-1px);
}

.btn-flash {
  background: var(--gradient-primary);
  color: #fff;
  box-shadow: 0 4px 14px rgba(102, 126, 234, 0.3);
}

.btn-flash:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

/* ── 芯片卡 ── */
.chip-card {
  margin-top: 1.25rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.07) 0%,
    rgba(118, 75, 162, 0.07) 100%
  );
  border: 1px solid rgba(102, 126, 234, 0.25);
  border-radius: var(--radius-md);
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.chip-model {
  font-weight: 700;
  color: var(--color-primary);
}

.chip-meta {
  font-size: 0.78rem;
  font-family: "JetBrains Mono", monospace;
  opacity: 0.65;
}

/* ── 断开连接 ── */
.disconnect-wrap {
  margin-top: 1rem;
  text-align: center;
  animation: slideUp 0.3s ease;
}

.btn-disconnect {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: #fef2f2;
  border: 1px solid #fee2e2;
  color: #dc2626;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-disconnect:hover {
  background: #fee2e2;
  color: #b91c1c;
  border-color: #fecaca;
}

/* ── 进度条 ── */
.progress-wrap {
  margin-top: 1.75rem;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.83rem;
  margin-bottom: 0.5rem;
}

.pct {
  font-weight: 700;
  color: var(--color-primary);
}

.progress-bg {
  height: 10px;
  background: var(--color-surface-hover);
  border-radius: 5px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--gradient-primary);
  transition: width 0.15s linear;
}

/* ── 成功 ── */
.success-wrap {
  text-align: center;
  padding: 0.75rem 0;
  animation: popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes popIn {
  from {
    transform: scale(0.8);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.pulse-ring {
  display: inline-flex;
  padding: 1.25rem;
  background: #ecfdf5;
  border-radius: 50%;
  margin-bottom: 1rem;
  animation: ringPulse 2s infinite;
}

@keyframes ringPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }
  70% {
    box-shadow: 0 0 0 14px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

.success-msg {
  font-weight: 600;
  margin-bottom: 0.4rem;
  color: #059669;
}

.success-sub {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 1.25rem;
}

.btn-next {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: 1px solid var(--color-border);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.88rem;
  transition: background 0.2s;
}

.btn-next:hover {
  background: var(--color-surface-hover);
}

/* ── 错误 ── */
.error-wrap {
  margin-top: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  background: #fff5f5;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  font-size: 0.84rem;
}

.btn-retry {
  margin-left: auto;
  background: #dc2626;
  color: #fff;
  border: none;
  padding: 0.25rem 0.7rem;
  border-radius: 4px;
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
}

/* ── 通用图标色 ── */
.icon-primary {
  color: var(--color-primary);
}
.icon-success {
  margin-left: auto;
  color: #10b981;
}

/* ── 配网指引卡片 ── */
.guide-card {
  background: var(--color-surface);
  border: 1px dashed rgba(102, 126, 234, 0.4);
  border-radius: var(--radius-lg);
  padding: 1.75rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.guide-header {
  margin-bottom: 0.2rem;
}

.guide-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

.guide-step {
  display: flex;
  gap: 1rem;
  background: var(--color-surface);
  padding: 1.25rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
}

.guide-icon {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  color: var(--color-primary);
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}

.guide-text h4 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text);
}

.guide-text p {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.highlight {
  background: var(--color-surface-hover);
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
  color: var(--color-primary);
}
</style>
