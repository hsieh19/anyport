/**
 * BACnet CRC 校验
 * 参考 BACnet 标准 ANSI/ASHRAE Standard 135
 */

/**
 * 计算 BACnet MS/TP Header CRC (CRC-8)
 * 多项式: X^8 + X^7 + X^4 + X^3 + X^1 + 1 (0xBA)
 * 初始值: 0xFF
 * 结果取反
 */
export function calculateBacnetCrc8(data: Uint8Array): number {
    let crc = 0xFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i]!;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x80) {
                crc = ((crc << 1) ^ 0x06) & 0xFF; // 0x06 is 0x106 & 0xFF? No, wait.
            } else {
                crc = (crc << 1) & 0xFF;
            }
        }
    }
    return (~crc) & 0xFF;
}

/**
 * 基于查找表的 BACnet CRC-8 实现 (更高效)
 */
const CRC8_TABLE = new Uint8Array(256);
(function initCrc8Table() {
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x80) ? ((crc << 1) ^ 0x06) : (crc << 1);
        }
        CRC8_TABLE[i] = crc & 0xFF;
    }
})();

export function getBacnetCrc8(data: Uint8Array): number {
    let crc = 0xFF;
    for (const b of data) {
        crc = CRC8_TABLE[crc ^ b]!;
    }
    return (~crc) & 0xFF;
}

/**
 * 计算 BACnet MS/TP Data CRC (CRC-16)
 * 多项式: X^16 + X^12 + X^5 + 1 (0x1021)
 * 初始值: 0xFFFF
 * 结果条取反
 */
export function getBacnetCrc16(data: Uint8Array): number {
    let crc = 0xFFFF;
    for (const b of data) {
        crc = (crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ b) & 0xFF]!;
    }
    return (~crc) & 0xFFFF;
}

const CRC16_TABLE = new Uint16Array(256);
(function initCrc16Table() {
    for (let i = 0; i < 256; i++) {
        let crc = i << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        }
        CRC16_TABLE[i] = crc & 0xFFFF;
    }
})();
