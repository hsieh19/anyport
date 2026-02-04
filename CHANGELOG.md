# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
