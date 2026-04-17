# Anyport 项目架构与功能概览

Anyport 是一个基于 Web 技术的现代多协议工业调试工具，旨在为工业现场调试提供跨平台、高性能且美观的解决方案。

## 1. 核心定位
- **定位**：面向工业自动化工程师的多协议调试助手。
- **核心能力**：通过浏览器直接访问工业设备（串口/网路），支持本地调试与远程转发。
- **协议支持**：目前以 Modbus RTU/TCP 为核心，扩展支持 BACnet，未来计划接入 DL/T645 等更多规约。

## 2. 技术栈
- **前端框架**：Vue 3 (Composition API) + Vite + TypeScript
- **状态管理**：Pinia
- **存储**：IndexedDB (结合 Dexie.js)，实现离线日志与配置存储
- **通讯接口**：
    - **Web Serial API**：直接在浏览器中驱动本地串口。
    - **MQTT**：配合远程网关实现跨地域调试。
    - **Local Bridge (Go)**：实现浏览器对局域网 Modbus TCP / BACnet 设备的通透访问。
- **UI 设计**：Vanilla CSS 变量控制的主题系统，支持响应式与暗色模式。

## 3. 项目结构 (Monorepo)

```text
anyport/
├── packages/
│   ├── frontend/               # Vue 3 前端核心应用
│   │   └── src/
│   │       ├── transports/     # 传输层：WebSerial, MQTT, LocalBridge (负责字节流收发)
│   │       ├── protocols/      # 协议层：Modbus (RTU/TCP), BACnet (负责编解码)
│   │       ├── stores/         # 状态层：维护设备连接、实时数据快照、网关列表
│   │       ├── components/     # UI 组件：协议配置面板、报文监控、点表库
│   │       ├── layouts/        # 布局层：适配桌面端 (DesktopLayout) 
│   │       └── utils/          # 工具类：CRC16 校验、数据转换、IndexedDB 初始化
│   └── shared/                 # 共享包：类型定义、常量
├── tools/
│   └── anyport-bridge/         # 基于 Go 的本地桥接程序
└── tmp/                        # 临时文件与设备点表配置
```

## 4. 核心功能模块分析

### 4.1 协议适配器 (Protocol Adapters)
- **ModbusRtuAdapter**：实现了标准的 Modbus RTU 帧格式，包含从站地址、功能码、寄存器操作及 CRC-16 校验逻辑。
- **ModbusTcpAdapter**：用于处理 Modbus TCP 封装，支持通过桥接或网关访问 PLC 等网络设备。
- **错误处理**：内置了详细的工业协议错误转换引擎，提供直观的中文诊断信息。

### 4.2 传输链路 (Transports)
- **本地串口**：利用 Web Serial 直接控制串口硬件，无须安装繁琐的插件。
- **MQTT 转发**：通过订阅特定的网关 Topic，实现与 ESP32 硬件网关的远程联动，极大地降低了现场调试的物理门槛。
- **网络桥接**：由于浏览器无法直接发起原始 TCP 连接，通过 `anyport-bridge` 作为中转，实现了对局域网内 Modbus TCP 设备的透明访问。

### 4.3 调试与日志 (Monitoring)
- **实时报文流**：以十六进制和解析后的语义化格式展示 TX/RX 数据，方便排障。
- **点表 (Profile) 支持**：用户可以加载 JSON 格式的点表模板（如 `tmp/` 下的文件），将原始数值自动转换成物理量（如 40001 -> 温度 25.5℃）。

## 5. 后续开发重点
1. **协议完善**：深度完善 BACnet 与 DL/T645 的解析逻辑。
2. **云端协同**：实现本地 IndexedDB 日志与云端的备份/共享。
3. **点表生态**：建立并维护常用工控设备的点表库，减少重复配置工作。

---
*本文档由 Antigravity 整理，旨在为项目后续的开发与维护提供参考指南。*
