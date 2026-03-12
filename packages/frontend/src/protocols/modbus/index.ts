/**
 * Modbus 协议模块导出
 */

export { ModbusRtuAdapter, ModbusFunctionCode } from './ModbusRtuAdapter';
export { ModbusTcpAdapter } from './ModbusTcpAdapter';
export type { ModbusRtuCommand, ModbusRtuResponse } from './ModbusRtuAdapter';
export { calculateCRC16, verifyCRC16, appendCRC16 } from './crc16';
export { getExceptionMessage } from './modbusErrors';
export * from './modbusUtils';
