/**
 * Modbus 报文解析工具
 */

export interface FramePart {
  name: string;
  value: string;
}

export function interpretFrame(hexs: string[], isRead: boolean, isRx: boolean = false, mode: 'rtu' | 'tcp' = 'rtu'): FramePart[] {
  if (hexs.length < 2) return [];

  const parts: FramePart[] = [];

  if (mode === 'tcp') {
    // --- Modbus TCP 解析 (MBAP Header 7 bytes) ---
    if (hexs.length >= 2) parts.push({ name: '事务标识符', value: `${hexs[0]} ${hexs[1]}` });
    if (hexs.length >= 4) parts.push({ name: '协议标识符', value: `${hexs[2]} ${hexs[3]}` });
    if (hexs.length >= 6) parts.push({ name: '后续长度', value: `${hexs[4]} ${hexs[5]}` });
    if (hexs.length >= 7) parts.push({ name: '单元 ID (站号)', value: hexs[6]! });

    // PDU 部分从第 7 字节 (index 7) 开始
    const pdu = hexs.slice(7);
    if (pdu.length > 0) {
      interpretPdu(pdu, isRead, isRx, parts);
    }
  } else {
    // --- Modbus RTU 解析 ---
    if (hexs.length >= 1) parts.push({ name: '从站地址 (Slave)', value: hexs[0]! });
    if (hexs.length >= 3) {
      const pdu = hexs.slice(1, -2); // 掐头 (Slave) 去尾 (CRC)
      const crc = hexs.slice(-2);
      interpretPdu(pdu, isRead, isRx, parts);
      parts.push({ name: '校验码 (CRC16)', value: `${crc[0]} ${crc[1]}` });
    } else {
      // 报文长度不足 3，仅显示 Slave 和 FC
      const pdu = hexs.slice(1);
      interpretPdu(pdu, isRead, isRx, parts);
    }
  }

  return parts;
}

function interpretPdu(pdu: string[], isRead: boolean, isRx: boolean, parts: FramePart[]) {
  if (pdu.length === 0) return;

  const fcHex = pdu[0]!;
  const fc = parseInt(fcHex, 16);
  parts.push({ name: '功能码 (FC)', value: fcHex.toUpperCase() });

  const data = pdu.slice(1);
  if (data.length === 0) return;

  // 1. 异常报文 (FC > 0x80)
  if (fc >= 0x80) {
    parts.push({ name: '错误代码 (Exception)', value: data[0]! });
    return;
  }

  // 2. 正常报文解析
  if (!isRx) {
    // --- TX 请求报文 ---
    if ([1, 2, 3, 4, 5, 6].includes(fc)) {
      if (data.length >= 2) parts.push({ name: '起始地址 (Addr)', value: `${data[0]} ${data[1]}` });
      if (data.length >= 4) {
        const valName = [1, 2, 3, 4].includes(fc) ? '寄存器数量 (Qty)' : '写入值 (Value)';
        parts.push({ name: valName, value: `${data[2]} ${data[3]}` });
      }
    } else if ([15, 16].includes(fc)) {
      if (data.length >= 2) parts.push({ name: '起始地址 (Addr)', value: `${data[0]} ${data[1]}` });
      if (data.length >= 4) parts.push({ name: '寄存器数量 (Qty)', value: `${data[2]} ${data[3]}` });
      if (data.length >= 5) parts.push({ name: '后续字节数 (Bytes)', value: data[4]! });
      if (data.length > 5) parts.push({ name: '写入内容 (Data)', value: data.slice(5).join(' ') });
    }
  } else {
    // --- RX 响应报文 ---
    if ([1, 2, 3, 4].includes(fc)) {
      if (data.length >= 1) parts.push({ name: '字节计数 (Bytes)', value: data[0]! });
      if (data.length > 1) parts.push({ name: '响应数据 (Data)', value: data.slice(1).join(' ') });
    } else if ([5, 6, 15, 16].includes(fc)) {
      // 回送校验响应
      if (data.length >= 2) parts.push({ name: '起始地址 (Addr)', value: `${data[0]} ${data[1]}` });
      if (data.length >= 4) {
        const valName = [5, 6].includes(fc) ? '写入值 (Value)' : '写入数量 (Qty)';
        parts.push({ name: valName, value: `${data[2]} ${data[3]}` });
      }
    }
  }
}
