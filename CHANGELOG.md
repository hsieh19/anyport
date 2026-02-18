# Changelog

## [1.0.4] - 2026-02-18

### Added
- **点表选择器 (Profile Picker)**: 新增独立的点表选择弹窗，支持从本地数据库快速选择并应用设备点表，提升配置效率。
- **网关管理器 (Gateway Manager)**: 新增网关管理对话框，支持查看已发现网关的详细信息（版本、IP等），并可清除离线网关记录。
- **状态指示优化**: 重构顶部状态栏，在显眼位置展示 MQTT Broker 和网关的实时连接状态。

### Changed
- **默认配置调整**: 将默认的 Site ID 和 Gateway ID 修改为空，避免新用户误连接到公共测试设备接收干扰数据。
- **网关筛选**: 网关下拉列表现在会根据输入的 Site ID 自动过滤，方便在多设备场景下快速定位。
- **UI 细节优化**: 
    - 调整连接配置面板布局，减少留白，提升空间利用率。
    - 优化 MQTT 配置弹窗的交互体验。

### Fixed
- **幽灵网关问题**: 修复了由于默认值和 MQTT Retained 消息导致页面刷新后出现不存在网关的问题。
- **组件缺失修复**: 补充了缺失的 `ModbusProfilePicker` 和 `GatewayManagerDialog` 组件，修复了构建错误。

## [1.0.3] - 2026-02-11

### Added
- 完整实现 Modbus 调试主流程，包括 Modbus RTU、本地串口和调试面板。
- 新增 Modbus TCP 适配器与 WebSocket 网关传输层，支持通过网关远程调试。
- 新增 ESP32-C3 网关固件工程（`esp32/AnyPortGateway`），用于现场部署 AnyPort Gateway。

### Changed
- 更新 README 文档，完善 Modbus 调试功能说明与架构描述。
- 在桌面端侧边栏中显示当前版本号，便于快速确认部署版本。

### Fixed
- 优化 Modbus 调试数据解析逻辑，确保结果视图与通信日志显示一致。

## [1.0.2] - 2026-02-08

### Added
- **移动端 UI 体验优化**:
    - 重构移动端布局，引入侧边抽屉导航（Drawer）替代底部 Tab 栏。
    - 新增顶部 AppBar，包含实时连接状态指示与页面标题。
    - 为“点表库”页面添加完整的响应式布局适配，提升手机端编辑体验。
    - 引入页面切换平滑动画（Page Transitions）。

### Fixed
- **Modbus 悬浮窗修复**: 修复了报文结构解析和通信日志悬浮窗在部分布局下被截断的问题，并优化了动画流畅度，确保在 Windows 桌面端也能完美显示。

## [1.0.1] - 2026-02-08

### Added
- **Docker 支持**: 添加 Dockerfile，支持基于 Nginx 的容器化部署。
- **CI/CD**: 添加 GitHub Actions 工作流，实现 Tag 推送时自动构建并发布镜像到 GHCR。

### Fixed
- **类型定义**: 修复 `WebSerialTransport.ts` 和 `device.types.ts` 中的 TypeScript 错误，确保项目顺利构建。

## [1.0.0] - 2026-02-05

### Added
- **多协议架构**: 初始化项目，支持 Modbus RTU 协议，预留 DL/T645、MQTT 扩展接口。
- **本地轮廓管理 (Profile Manager)**:
    - 实现设备配置（轮廓）的本地持久化存储（基于 IndexedDB）。
    - 新增“轮廓库”页面，支持配置的保存、编辑、导入/导出。
    - 轮廓包含：通讯参数、点表定义、寄存器映射等。
- **Modbus 功能增强**:
    - **日志解析**: RX 报文 hover 自动解析功能，实时显示 Slave ID、功能码、数据内容及 CRC 校验结果。
    - **操作反馈**: 集成全局 Toast 通知，实时反馈读写指令的执行状态。
    - **交互优化**: 优化了 Modbus 面板的响应式布局，调整了控制按钮的视觉优先级。
- **Web Serial API**: 集成浏览器原生串口通信能力，无需后端代理。
- **PWA 支持**: 配置 Vite PWA 插件，支持应用离线安装与使用。
- **工程化配置**:
    - 采用 Monorepo 结构 (`frontend` + `shared`)。
    - 配置 TypeScript, Vite, Pinia。
    - 添加 GitHub 标准化文件 (`README`, `LICENSE`, `.gitignore`)。

### Changed
- **UI/UX 改进**:
    - 移动端侧边栏头部视觉优化，增强层级感。
    - 登录/配置页面的布局调整，适配更多屏幕尺寸。
    - 响应式设计：实现桌面端与移动端的独立布局与交互优化。
- **README 更新**: 补充了详细的项目技术架构说明。

### Fixed
- **Vite 构建**: 修复 Monorepo 结构下 `shared` 包 TypeScript 文件无法被前端项目直接引用的问题。
- **安全上下文**: 增加对非安全上下文 (HTTP IP) 的检测，并提供明确的错误提示引导用户使用 Localhost 或 HTTPS。
