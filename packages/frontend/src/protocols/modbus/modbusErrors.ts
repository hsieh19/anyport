/**
 * Modbus 异常码映射表（RTU / TCP 共用）
 */
const EXCEPTION_MESSAGES: Record<number, string> = {
    0x01: '非法功能码',
    0x02: '非法数据地址',
    0x03: '非法数据值',
    0x04: '从站设备故障',
    0x05: '确认',
    0x06: '从站设备忙',
    0x08: '存储奇偶性差错',
    0x0A: '不可用网关路径',
    0x0B: '网关目标设备响应失败'
};

/**
 * 根据异常码获取中文描述
 */
export function getExceptionMessage(code: number): string {
    return EXCEPTION_MESSAGES[code] ?? `未知异常 (0x${code.toString(16).toUpperCase()})`;
}
