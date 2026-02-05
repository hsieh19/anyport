# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-05

### Added
- **本地轮廓管理 (Profile Manager)**:
    - 实现设备配置（轮廓）的本地持久化存储（基于 IndexedDB）。
    - 新增“轮廓库”页面，支持配置的保存、编辑、导入/导出。
    - 轮廓包含：通讯参数、点表定义、寄存器映射等。
- **Modbus 功能增强**:
    - **日志解析**: RX 报文 hover 自动解析功能，实时显示 Slave ID、功能码、数据内容及 CRC 校验结果。
    - **操作反馈**: 集成全局 Toast 通知，实时反馈读写指令的执行状态。
    - **交互优化**: 优化了 Modbus 面板的响应式布局，调整了控制按钮的视觉优先级。

### Changed
- **UI/UX 改进**:
    - 移动端侧边栏头部视觉优化，增强层级感。
    - 登录/配置页面的布局调整，适配更多屏幕尺寸。
- **README 更新**: 补充了详细的项目技术架构说明。

## [1.0.0] - 2026-02-04

### Added
- **多协议架构**: 初始化项目，支持 Modbus RTU 协议，预留 DL/T645、MQTT 扩展接口。
- **响应式设计**: 实现桌面端与移动端的独立布局与交互优化。
    - **桌面端**: 采用专业侧边栏 + 左右分栏操作区设计。
    - **移动端**: 采用底部导航栏 + 标签页式操作面板，适配触摸交互。
- **Web Serial API**: 集成浏览器原生串口通信能力，无需后端代理。
- **PWA 支持**: 配置 Vite PWA 插件，支持应用离线安装与使用。
- **工程化配置**:
    - 采用 Monorepo 结构 (`frontend` + `shared`)。
    - 配置 TypeScript, Vite, Pinia。
    - 添加 GitHub 标准化文件 (`README`, `LICENSE`, `.gitignore`)。

### Fixed
- **Vite 构建**: 修复 Monorepo 结构下 `shared` 包 TypeScript 文件无法被前端项目直接引用的问题。
- **安全上下文**: 增加对非安全上下文 (HTTP IP) 的检测，并提供明确的错误提示引导用户使用 Localhost 或 HTTPS。
