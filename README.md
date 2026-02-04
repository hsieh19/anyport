# Anyport

**Anyport** 是一个基于 Web 技术的现代多协议工业调试工具。它旨在提供一个跨平台、离线可用且美观的解决方案，用于调试 Modbus、DL/T645 等工业通信协议。

## ✨ 特性

- **多协议支持**：目前支持 Modbus RTU，计划支持 DL/T645, MQTT 等。
- **现代化 UI**：基于 Vue 3 和全新设计语言，支持暗色模式。
- **响应式设计**：
    - **桌面端**：专业分栏布局，大屏操作更高效。
    - **移动端**：独立优化的移动视图，支持触摸操作。
- **离线可用**：支持 PWA，安装后可离线运行。
- **安全**：利用 Web Serial API 进行本地通讯，数据不上传云端。

## 📅 未来规划 (第二期)

Anyport 的架构设计预留了完整的扩展能力，第二期开发将聚焦于**远程调试**与**云端协作**：

- [ ] **后端中转服务**
    - 引入 NestJS 后端，提供 WebSocket 代理服务。
    - 实现用户管理与设备权限控制。
- [ ] **ESP32 远程采集**
    - **MqttTransport**: 实现通过 MQTT 协议与 ESP32 节点通信。
    - **远程透传**: 浏览器 -> MQTT -> ESP32 -> RS485 -> 现场设备。
- [ ] **更多工业协议**
    - **Modbus TCP**: 工业网络通信 (需服务器/代理代理透传)。
    - **DL/T 645**: 电力行业标准规约。
    - **BACnet MS/TP**: 楼宇自控协议。
    - **RS232/RS485 Hex**: 通用透传调试模式。
- [ ] **云端能力**
    - **云端日志**: 将本地 IndexDB 日志同步至云端存储。
    - **设备孪生**: 实时状态映射。
- [ ] **智能解析引擎**
    - **点表库**: 内置主流厂家Modbus 点表数据库。
    - **自动转换**: 根据设备型号自动将原始 Hex 数据解析为物理量（如电压、温度）。

### ESP32 远程方案预览
```mermaid
graph LR
    Browser[浏览器] --MQTT--> Broker[MQTT Broker]
    Broker --MQTT--> ESP32[ESP32节点]
    ESP32 --RS485--> Device[现场设备]
```

## 📦 项目结构

本项目采用 Monorepo 结构管理：

- `packages/frontend`: 前端应用 (Vue 3 + Vite)
- `packages/shared`: 共享类型定义和工具库

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- pnpm (推荐) 或 npm

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/anyport.git
cd anyport

# 安装依赖
pnpm install
```

### 开发

```bash
# 启动前端开发服务器
pnpm -F @anyport/frontend dev
# 或者在根目录（如果配置了脚本）
npm run dev
```

### 构建

```bash
pnpm -r build
```

