# Anyport

**Anyport** 是一个基于 Web 技术的现代多协议工业调试工具。它旨在提供一个跨平台、离线可用且美观的解决方案，用于调试 Modbus、DL/T645 等工业通信协议，并支持通过 ESP32 网关进行远程 Modbus 转发。

## ✨ 特性

- **多协议支持**：完整支持 Modbus RTU/TCP、BACnet IP/MSTP 以及通用串口透传 (Raw Serial) 协议。
- **现代化 UI**：基于 Vue 3 和全新设计语言，支持暗色模式。
- **响应式设计**：
    - **桌面端**：专业分栏布局，大屏操作更高效。
    - **移动端**：独立优化的移动视图，支持触摸操作。
- **离线可用**：支持 PWA，安装后可离线运行。
- **安全**：利用 Web Serial API 进行本地通讯，数据不上传云端。

## 🔌 Modbus 调试功能

- **连接方式**
  - 本地串口：基于 Web Serial API，支持选择串口并配置波特率、数据位、停止位和校验位。
  - MQTT 远程网关：通过 MQTT Broker 与 ESP32-C3 网关固件配合，支持将 Modbus RTU/TCP 请求通过 MQTT 转发到现场设备，并提供远程网络诊断。
  - 本地桥接 (Anyport Bridge)：通过配套的 Go 编写的本地桥接程序，实现浏览器直接访问本地局域网内的 Modbus TCP 设备或 BACnet 设备，无需硬件网关。
- **协议能力**
- **智能诊断及错误处理**
  - 多语言错误翻译：内置通讯错误解析引擎，将底层协议 / 网络 / 系统错误转换为直观的中文提示（如“网关硬件 Socket 资源耗尽”或“目标拒绝连接”）。
  - 连接自动恢复：具备智能连接意图识别，支持在页面刷新或网络波动后自动恢复 MQTT / 桥接连接。
  - Modbus RTU：完整支持 01/02/03/04/05/06/15/16 功能码，内置 CRC‑16 校验、请求帧编码与响应帧解析。
  - Modbus TCP：内置 `ModbusTcpAdapter`，可配合 ESP32 网关固件通过以太网访问 Modbus TCP 设备。
- **调试体验**
  - 命令构建器：在调试面板中可配置从站地址、功能码、起始地址、数量和写入值，并支持 Base‑0 / Base‑1 地址切换。
  - 报文预览：实时显示即将发送的 Modbus RTU/TCP 报文十六进制内容，便于对照现场抓包。
  - 通信日志：以时间倒序记录 TX/RX 数据，展示原始 Hex 以及解析后的寄存器 / 线圈数据和异常信息，可一键清空。
  - 结果视图：将最近一次读取结果以表格形式展示，支持十进制 / 十六进制 / 二进制多种显示格式。
  - 点表联动：支持加载设备点表（Profile），在“自动模式”下按点表自动生成读写命令并对寄存器值进行语义化展示。
  - 网关管理：自动发现并管理 MQTT 远程网关，支持状态监控与离线清理。
  - 移动端调试：提供专门的移动端 Modbus 调试视图，针对触摸操作和竖屏布局做了优化。

## 📅 未来规划 (第二期)

Anyport 的架构设计预留了完整的扩展能力，第二期开发将聚焦于**远程调试**与**云端协作**：

- [ ] **更多工业协议**
    - **DL/T 645**: 电力行业标准规约。
    - **M-Bus**: 远程抄表标准协议。
- [ ] **云端能力**
    - **云端日志**: 将本地 IndexDB 日志同步至云端存储。
    - **设备孪生**: 实时状态映射。
- [ ] **智能解析引擎**
    - **点表库**: 内置主流厂家Modbus 点表数据库。
    - **自动转换**: 根据设备型号自动将原始 Hex 数据解析为物理量（如电压、温度）。


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
- **Communications**: Web Serial API, MQTT
- **Styling**: Vanilla CSS (CSS Variables)

### 模块结构

```
anyport/
├── packages/
│   ├── shared/                 # 跨项目共享的类型定义与工具
│   └── frontend/               # Vue 3 前端应用
│       └── src/
│           ├── transports/     # 物理传输层：负责底层字节流收发 (WebSerial, MQTT)
│           ├── protocols/      # 协议编解码层：实现不同工业协议的封装与解析 (Modbus, BACnet, Raw)
│           ├── services/       # 业务逻辑服务：处理配置存取、复杂数据过滤等逻辑
│           ├── stores/         # 状态管理 (Pinia)：维护全局设备连接状态、读取的数据快照
│           ├── views/          # 页面视图：轮廓库管理页面、移动端专用视图
│           ├── layouts/        # 分端布局：Desktop (分栏) 与 Mobile (标签页) 布局骨架
│           ├── components/     # UI 业务组件：按协议划分子目录 (modbus, bacnet, raw, shared)
│           ├── utils/          # 工具函数：IndexedDB (Dexie) 初始化、CRC 校验等
│           ├── types/          # 前端 TypeScript 类型定义
│           └── assets/         # 静态资源 (图标、样式变量、主字体)
```

## 📦 项目结构

本项目采用 Monorepo 结构管理：

- `packages/frontend`: 前端应用 (Vue 3 + Vite)
- `packages/shared`: 跨项目共享的协议类型定义与工具库
- `esp32/AnyPortGateway`: ESP32-C3 核心网关固件，集成 W5500 以太网驱动与 MQTT 转发功能
- `tools/anyport-bridge`: 基于 Go 编写的跨平台本地桥接程序，实现 Modbus TCP & BACnet 穿透访问

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

