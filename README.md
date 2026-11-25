# Anyport

**Anyport** 是一个基于 Web 技术的现代多协议工业调试平台。提供跨平台、离线可用且直观的解决方案，用于调试 Modbus RTU/TCP、BACnet IP/MS-TP、串口透传等工业通信协议，并配套 ESP32 工业网关控制台与 Go 本地穿透网桥。

## ✨ 核心特性

- **多协议调试**：完整支持 **Modbus RTU/TCP**、**BACnet IP/MS-TP** 以及 **RS232/RS485 原始串口透传 (Raw Serial)**。
- **多元传输链路**：
  - **Web Serial API**：浏览器直接驱动本地物理串口，无需安装插件。
  - **MQTT 远程网关**：配合 ESP32 硬件网关实现跨地域远程 Modbus RTU/TCP 采集与网络 Ping 诊断。
  - **Local Bridge (Go)**：通过轻量本地桥接程序，使浏览器可直接访问局域网 Modbus TCP / BACnet UDP 设备及穿透访问网关 HTTP API。
- **网关控制台**：内置 AnyPort 网关全量配置中心，支持 WiFi/W5500 以太网/双路 RS485 配置、7 大业务工作模式（MQTT 网关、Modbus 从站模拟器、USB 透传、TCP/RTU 互转、RS485 总线监听与质量诊断、以太网-WiFi 桥接、双主站防碰撞中继）及双分区 OTA 升级。
- **点表生态与实时采集**：支持三级设备点表库（厂家/系列/型号）管理、自动语义化数值解析、多通道定时轮询、ECharts 实时趋势图绘制与 CSV 历史数据导出。

## 🏗️ 项目架构

Anyport 采用 Monorepo 与分层解耦的整洁架构设计，确保通讯协议与物理传输介质可自由组合：

```text
anyport/
├── packages/
│   ├── shared/                 # 跨端共享的协议与传输层接口契约
│   └── frontend/               # Vue 3 + TypeScript + Vite 前端应用
│       └── src/
│           ├── protocols/      # 协议编解码层：Modbus (RTU/TCP), BACnet (IP/MSTP), Raw
│           ├── transports/     # 物理传输层：WebSerial, MQTT, LocalBridge
│           ├── services/       # 应用服务层：点表存取校验、云端配置提取
│           ├── stores/         # 状态管理层 (Pinia)：设备连接、轮询采集、点表状态
│           ├── views/          # 页面视图：网关控制台 (gateway/)、点表库管理
│           ├── components/     # 业务组件：按协议领域划分 (modbus, bacnet, raw, shared)
│           ├── layouts/        # 桌面端主布局骨架
│           ├── utils/          # 通用工具：HEX 编解码、IndexedDB (idb)、CSV 导出、错误翻译
│           └── types/          # 业务类型定义
└── tools/
    ├── anyport/                # Go 绿色单文件客户端 (内嵌 WebUI 与本地网桥服务)
    ├── anyport-bridge/         # Go 独立无头网桥服务 (WebSocket TCP/UDP 转发与 HTTP 代理)
    └── build-dist.bat          # Windows 单文件打包发布脚本
```

## 🚀 本地运行与开发

### 前置要求

- Node.js >= 18
- pnpm >= 8
- Go >= 1.22（仅构建本地网桥或 `.exe` 单文件客户端时需要）

### 常用命令

```bash
# 安装依赖
pnpm install

# 启动前端开发服务器
pnpm dev

# 类型检查
pnpm typecheck

# 构建前端生产包
pnpm build

# 一键编译 Windows 绿色可执行程序 (anyport.exe & anyport-bridge.exe)
pnpm build:exe
```

## 📜 许可证

本项目采用 [MIT](LICENSE) 许可证。
