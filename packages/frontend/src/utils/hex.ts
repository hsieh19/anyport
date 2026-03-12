/**
 * HEX 工具函数
 */

/**
 * 将字节数组转为带空格的大写十六进制字符串（用于日志显示）
 * @example bytesToHexSpaced(new Uint8Array([0x01, 0xA2])) → "01 A2"
 */
export function bytesToHexSpaced(data: Uint8Array): string {
    return Array.from(data)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
}

/**
 * 将字节数组转为紧凑的大写十六进制字符串（用于协议传输、JSON payload）
 * @example bytesToHexCompact(new Uint8Array([0x01, 0xA2])) → "01A2"
 */
export function bytesToHexCompact(data: Uint8Array): string {
    return Array.from(data)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join('');
}

/**
 * 将十六进制字符串解析为字节数组（兼容带空格、带前缀等格式）
 * @example hexToBytes("01 A2") → Uint8Array([0x01, 0xA2])
 */
export function hexToBytes(hex: string): Uint8Array {
    const normalized = hex.replace(/[^0-9a-fA-F]/g, '');
    const length = Math.floor(normalized.length / 2);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
