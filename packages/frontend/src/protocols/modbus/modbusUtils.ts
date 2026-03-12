/**
 * Modbus 协议通用工具函数
 */

/**
 * 辅助函数：将多种格式的 func_code 转换为数字数组
 */
export function normalizeFuncCodes(input: any): number[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr.map(item => {
    if (item === null || item === undefined) return NaN;
    if (typeof item === 'string') {
      // 处理 "0x03" 或 "3" 格式
      return item.startsWith('0x') ? parseInt(item, 16) : parseInt(item, 10);
    }
    return Number(item);
  }).filter(n => !isNaN(n));
}

/**
 * 辅助函数：Modbus 地址归一化
 * 将 PLC 地址 (如 40600) 转换为协议物理偏移量 (如 599)
 * @param addr 原始地址 (可以是 40001 这种 PLC 地址，也可以是 0 这种逻辑偏移)
 * @param _fc 功能码 (预留，用于某些复杂的地址归一化场景)
 * @param base1 是否为 1 开启基准（如果是 PLC 模式地址 1，协议层应发送 0）
 */
export function getModbusOffset(addr: number | string, _fc: number | string): number {
  const numAddr = typeof addr === 'string' ? parseInt(addr, 10) : addr;

  let offset = numAddr;
  // 仅剥离区间前缀，不进行任何硬编码的减法（如 -1）
  if (numAddr >= 40000 && numAddr <= 49999) {
    offset = numAddr - 40000;
  } else if (numAddr >= 30000 && numAddr <= 39999) {
    offset = numAddr - 30000;
  } else if (numAddr >= 10000 && numAddr <= 19999) {
    offset = numAddr - 10000;
  }
  
  // 40001 -> 1, 40025 -> 25
  return offset;
}

/**
 * 将输入值根据类型转换成 Modbus 寄存器数组 (16位)
 */
export function encodeValue(valStr: string, dataType: string, endian: string = 'ABCD'): number[] {
  const val = parseFloat(valStr);
  if (isNaN(val)) return [];

  // 判断是否是 32 位类型 (需占用 2 个寄存器)
  const is32Bit = ['float32', 'int32', 'uint32'].includes(dataType);
  
  if (!is32Bit) {
    // 对于布尔类型，Modbus 协议通常 0x0000 为 OFF，0xFF00 为 ON
    if (dataType === 'coil' || dataType === 'discrete_input') {
      return [val === 0 ? 0x0000 : 0xFF00];
    }
    return [Math.round(val) & 0xFFFF];
  }

  // 处理 32 位编码
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);

  if (dataType === 'float32') {
    view.setFloat32(0, val, false); // 原生大端
  } else if (dataType === 'int32') {
    view.setInt32(0, Math.round(val), false);
  } else { // uint32
    view.setUint32(0, Math.round(val), false);
  }

  const bytes = new Uint8Array(buffer);
  let reordered: number[] = [];
  
  // 字节序处理
  if (endian === 'CDAB') reordered = [bytes[2]!, bytes[3]!, bytes[0]!, bytes[1]!];
  else if (endian === 'BADC') reordered = [bytes[1]!, bytes[0]!, bytes[3]!, bytes[2]!];
  else if (endian === 'DCBA') reordered = [bytes[3]!, bytes[2]!, bytes[1]!, bytes[0]!];
  else reordered = [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!]; // ABCD

  return [
    ((reordered[0] ?? 0) << 8) | (reordered[1] ?? 0),
    ((reordered[2] ?? 0) << 8) | (reordered[3] ?? 0)
  ];
}

/**
 * 跨寄存器解析 (支持 16/32 位，及各种字节序)
 * byteOrder: 'ABCD' (默认大端), 'CDAB' (小端交换), 'BADC', 'DCBA'
 */
export function getExtendedValue(allValues: number[], offset: number, dataType: string, byteOrder: string = 'ABCD'): number | null {
  const val1 = allValues[offset]; // 原始第1个寄存器 (16bit)
  if (val1 === undefined) return null;

  // 32位数据解析 (需要读取两个寄存器)
  if (dataType === 'int32' || dataType === 'uint32' || dataType === 'float32') {
    const val2 = allValues[offset + 1]; // 原始第2个寄存器 (16bit)
    if (val2 === undefined) return null;

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    
    const h1 = (val1 >> 8) & 0xFF;
    const l1 = val1 & 0xFF;
    const h2 = (val2 >> 8) & 0xFF;
    const l2 = val2 & 0xFF;

    let bytes = [h1, l1, h2, l2]; // ABCD
    if (byteOrder === 'CDAB') bytes = [h2, l2, h1, l1];
    else if (byteOrder === 'BADC') bytes = [l1, h1, l2, h2];
    else if (byteOrder === 'DCBA') bytes = [l2, h2, l1, h1];

    bytes.forEach((b, i) => view.setUint8(i, b));

    if (dataType === 'float32') return view.getFloat32(0, false);
    if (dataType === 'int32') return view.getInt32(0, false);
    return view.getUint32(0, false);
  }

  // 16位数据解析
  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  
  if (byteOrder === 'BADC' || byteOrder === 'DCBA') {
    view.setUint8(0, val1 & 0xFF);
    view.setUint8(1, (val1 >> 8) & 0xFF);
  } else {
    view.setUint16(0, val1, false);
  }

  if (dataType === 'int16') return view.getInt16(0, false);
  return view.getUint16(0, false);
}

/**
 * 核心解析函数 (根据点表定义解析数值)
 */
export function parseAutoValue(regObj: any, allValues: any[], offset: number, defaultEndian: string = 'ABCD'): string | null {
  if (!regObj) return null;

  let val: any;
  const isCoil = regObj.data_type === 'coil' || regObj.data_type === 'discrete_input';
  const isString = regObj.data_type === 'string';
  
  if (isCoil) {
    const rawVal = allValues[offset];
    val = (typeof rawVal === 'boolean') ? (rawVal ? 1 : 0) : rawVal;
  } else if (isString) {
    const count = regObj.count || 1;
    let bytes: number[] = [];
    for (let i = 0; i < count; i++) {
       const regVal = allValues[offset + i];
       if (regVal === undefined) break;
       bytes.push((regVal >> 8) & 0xFF);
       bytes.push(regVal & 0xFF);
    }
    val = String.fromCharCode(...bytes).replace(/\u0000/g, '').trim();
  } else if (regObj.data_type === 'bits' && regObj.bit_fields) {
    const rawVal = allValues[offset];
    if (rawVal === undefined) return null;
    
    // bits 类型聚合解析逻辑 (按每 2 个 bit 一行进行逻辑处理)
    const results: string[] = [];
    regObj.bit_fields.forEach((field: any) => {
      const bit = field.bit || 1;
      const bitVal = (rawVal >> (bit - 1)) & 0x01;
      let mapped = String(bitVal);
      
      if (field.mapping) {
        const strKey = String(bitVal);
        mapped = field.mapping[strKey] ?? mapped;
      }
      
      const itemText = `[${field.name}: ${mapped}]`;
      results.push(itemText);
    });

    // 每 2 个元素拼接成一组，组间换行
    const groupedResults: string[] = [];
    for (let i = 0; i < results.length; i += 2) {
      groupedResults.push(results.slice(i, i + 2).join(' '));
    }
    
    return groupedResults.join('\n');
  } else if (regObj.data_type === 'block' && regObj.block_fields) {
    // block 类型聚合解析逻辑 (按区块内部定义的子字段进行解析)
    const results: string[] = [];
    regObj.block_fields.forEach((field: any) => {
      // 构造虚拟子寄存器定义
      const subOffset = field.offset || 0;
      const subRes = parseAutoValue(field, allValues, offset + subOffset, defaultEndian);
      if (subRes !== null) {
        results.push(`[${field.name}: ${subRes}]`);
      }
    });

    // 同样按每 2 个字段一组进行分行显示，优化 UI 展示空间
    const groupedResults: string[] = [];
    for (let i = 0; i < results.length; i += 2) {
      groupedResults.push(results.slice(i, i + 2).join(' '));
    }
    return groupedResults.join('\n');
  } else {
    const endian = regObj.endian || defaultEndian || 'ABCD';
    const rawVal = getExtendedValue(allValues as number[], offset, regObj.data_type === 'bit' ? 'uint16' : (regObj.data_type || 'uint16'), endian);
    
    if (regObj.data_type === 'bit' && regObj.bit_offset !== undefined && rawVal !== null) {
      val = (rawVal >> (regObj.bit_offset - 1)) & 0x01;
    } else {
      val = rawVal;
    }
  }

  if (val === null || val === undefined) return null;

  if (regObj.mapping) {
    const strKey = val.toString();
    if (regObj.mapping[strKey] !== undefined) return regObj.mapping[strKey];
    
    const hexKey = '0x' + Number(val).toString(16).toUpperCase();
    const hexKeyLower = '0x' + Number(val).toString(16).toLowerCase();
    if (regObj.mapping[hexKey] !== undefined) return regObj.mapping[hexKey];
    if (regObj.mapping[hexKeyLower] !== undefined) return regObj.mapping[hexKeyLower];
  }

  if (!isCoil && !isString && regObj.scale !== undefined) {
    val = (Number(val) * regObj.scale).toFixed(3);
    val = parseFloat(val);
  }

  const unitStr = regObj.unit ? ` ${regObj.unit}` : '';
  return `${val}${unitStr}`;
}

/**
 * Modbus 功能码常用选项列表 (用于 UI Select)
 */
export const MODBUS_FUNCTION_CODE_OPTIONS = [
  { value: 1, label: '01 - 读线圈 (Coils)' },
  { value: 2, label: '02 - 读离散输入 (Discrete Inputs)' },
  { value: 3, label: '03 - 读保持寄存器 (Holding Registers)' },
  { value: 4, label: '04 - 读输入寄存器 (Input Registers)' },
  { value: 5, label: '05 - 写单个线圈 (Single Coil)' },
  { value: 6, label: '06 - 写单个寄存器 (Single Register)' },
  { value: 15, label: '0F - 写多个线圈 (Multiple Coils)' },
  { value: 16, label: '10 - 写多个寄存器 (Multiple Registers)' },
];
