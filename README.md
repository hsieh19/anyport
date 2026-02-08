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

## 🏗️ 项目架构

Anyport 采用分层解耦的架构设计，确保了通讯协议与传输介质的灵活组合。

### 核心分层

1.  **Transport (传输层)**: 负责物理数据的收发（如 Web Serial API, WebSocket, MQTT）。
2.  **Protocol Adapter (协议层)**: 负责应用层协议的封装与解析（如 Modbus RTU, DL/T 645）。
3.  **Application Logic (应用层)**: 处理 UI 交互、数据存储 (IndexedDB) 和状态管理 (Pinia)。

### 技术栈

- **Frontend**: Vue 3 (Composition API) + Vite + TypeScript
- **State**: Pinia
- **Database**: IndexedDB (使用 Dexie.js)
- **Communications**: Web Serial API
- **Styling**: Vanilla CSS (CSS Variables)

### 模块结构

```
anyport/
├── packages/
│   ├── shared/                 # 跨项目共享的类型定义与工具
│   └── frontend/               # Vue 3 前端应用
│       └── src/
│           ├── transports/     # 物理传输层：负责底层字节流收发 (WebSerial, 预留 MQTT)
│           ├── protocols/      # 协议编解码层：实现不同工业协议的封装与解析 (Modbus, DL/T 645)
│           ├── services/       # 业务逻辑服务：处理配置存取、复杂数据过滤等逻辑
│           ├── stores/         # 状态管理 (Pinia)：维护全局设备连接状态、读取的数据快照
│           ├── views/          # 页面视图：轮廓库管理页面、移动端专用视图
│           ├── layouts/        # 分端布局：Desktop (分栏) 与 Mobile (标签页) 布局骨架
│           ├── components/     # UI 业务组件：协议配置面板、实时通讯日志盒
│           ├── utils/          # 工具函数：IndexedDB (Dexie) 初始化、CRC 校验等
│           ├── types/          # 前端 TypeScript 类型定义
│           └── assets/         # 静态资源 (图标、样式变量、主字体)
```

## 📦 项目结构

本项目采用 Monorepo 结构管理：

- `packages/frontend`: 前端应用 (Vue 3 + Vite)
- `packages/shared`: 共享类型定义和工具库

## 🚀 本地运行与开发

### 前置要求

- Node.js >= 18
- pnpm >= 8

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/hsieh19/anyport.git
cd anyport

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

### 构建

```bash
pnpm build
```

## 🐳 Docker 部署

您可以直接使用预构建的镜像，或在本地构建镜像。由于前端涉及到 Web Serial API，请确保通过 **HTTPS** 或 **localhost** 访问应用，否则浏览器会禁用该 API。

### 使用预构建镜像 (推荐)

```bash
# 从 GitHub Container Registry 拉取并运行
docker run -d --name anyport -p 8080:80 ghcr.io/hsieh19/anyport:latest
```

### 本地构建镜像

```bash
# 在项目根目录下执行
docker build -t anyport .

# 运行容器
docker run -d --name anyport -p 8080:80 anyport
```

运行后，访问 `http://localhost:8080` 即可使用。

---

## 📜 许可证

本项目采用 [MIT](LICENSE) 许可证。

