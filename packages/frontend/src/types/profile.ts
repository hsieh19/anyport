/**
 * 设备配置文件类型定义
 */

export interface DeviceProfile {
    protocol_summary: {
        manufacturer: string;      // 厂家
        series: string;            // 设备名称/系列
        model: string;             // 设备型号
        description?: string;      // (兼容旧版) 描述
        device_info?: string;      // (兼容旧版) 设备信息

        protocol_type?: 'MODBUS_RTU' | 'DLT645_2007' | 'DLT645_1997' | 'CJT188';
        default_baud?: number;
        default_id?: number;
        default_endian?: 'ABCD' | 'CDAB' | 'BADC' | 'DCBA';
    };
    registers: RegisterDefinition[];
}

export interface RegisterDefinition {
    name: string;
    addr?: number; // Modbus 地址
    data_id?: string; // DLT645 数据标识
    count?: number; // 寄存器数量
    access: 'R' | 'W' | 'RW';
    func_code?: string[]; // 支持的功能码 ["0x03", "0x06"]
    data_type: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'string' | 'bcd' | 'coil' | 'discrete_input' | 'hex_cmd' | 'bit';
    unit?: string;
    scale?: number; // 缩放系数
    bit_offset?: number; // 位偏移量 (从 1 开始)
    format?: string; // 格式化字符串，如 "XXXXXX.XX"
    mapping?: Record<string, string>; // 值映射，如 "1": "告警"
    endian?: 'ABCD' | 'CDAB' | 'BADC' | 'DCBA'; // 覆盖全局字节序
    description?: string;
    unlock_required?: {
        target: string; // 目标寄存器名称
        value: string; // 写入值 hex
        timeout?: string;
    };
}

export interface SavedProfile {
    id: string;
    name: string;
    description?: string;
    data: DeviceProfile;
    updatedAt: number;
}
