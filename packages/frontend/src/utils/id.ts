/**
 * ID 生成与日期时间格式化通用工具
 */

/**
 * 生成标准 UUID v4（兼容非安全 HTTP 上下文）
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 生成轻量级短唯一标识（用于日志条目、探针追踪 ID 等）
 */
export function generateShortId(prefix = ''): string {
  const core = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return prefix ? `${prefix}-${core}` : core;
}

/**
 * 格式化时间戳为 YYYY-MM-DD HH:mm:ss
 */
export function formatDateTime(val?: number | Date | null): string {
  if (!val) return '-';
  const date = typeof val === 'number' ? new Date(val) : val;
  const Y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const D = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

/**
 * 格式化时间戳为 HH:mm:ss.SSS（用于毫秒级通信日志）
 */
export function formatTimeWithMs(timestamp: number | Date): string {
  const d = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}
