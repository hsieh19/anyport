import {
    BacnetPropertyIdentifier,
    BacnetObjectType,
    BACNET_OBJECT_TYPE_NAMES,
    BACNET_OBJECT_TYPE_SHORT_NAMES,
    BacnetPduType,
    BacnetApplicationTag,
    BACNET_UNITS_NAMES
} from './constants';

export interface ParsedItemData {
    propId: string;
    value: any;
    isError?: boolean;
    isEndOfList?: boolean; // For Array Index out of bounds (Property 76)
    foundObjects?: any[]; // For discovering objects
    totalCount?: number; // Total objects reported
}

export class BacnetService {

    /**
     * 构建 Who-Is 广播请求
     */
    public static createWhoIsPayload(): Uint8Array {
        // NPDU: 01 00 (Version 1, Control 0)
        // APDU: 10 08 (UnconfirmedRequest, Service = 8 'Who-Is')
        return new Uint8Array([0x01, 0x00, 0x10, 0x08]);
    }

    /**
     * 构建 Register-Foreign-Device 请求 (BVLC)
     */
    public static createRegisterForeignDevicePayload(ttl: number): Uint8Array {
        const ttlBytes = new Uint8Array(2);
        ttlBytes[0] = (ttl >> 8) & 0xFF;
        ttlBytes[1] = ttl & 0xFF;
        return ttlBytes;
    }

    /**
     * 构建 ReadProperty 请求 APDU/NPDU
     */
    public static createReadPropertyPayload(
        type: number,
        instance: number,
        propertyId: number,
        invId: number = 1,
        index: number | null = null
    ): Uint8Array {
        // NPDU: 01 04 (Version 1, Expects Reply)
        const npdu = [0x01, 0x04];
        const objId = (type << 22) | instance;
        // APDU: ConfirmedRequest (0x00) | MaxSeg/Resp (0x05) | InvokeId | Service ReadProperty (0x0C)
        const apdu = [
            0x00, 0x05, invId, 0x0C,
            // Tag 0 (Object ID)
            0x0C, (objId >> 24) & 0xFF, (objId >> 16) & 0xFF, (objId >> 8) & 0xFF, objId & 0xFF,
            // Tag 1 (Property ID)
            0x19, propertyId & 0xFF
        ];

        // Property Array Index
        if (index !== null) {
            if (index < 256) {
                apdu.push(0x29, index); // Tag 5, Len 1
            } else if (index < 65536) {
                apdu.push(0x2A, (index >> 8) & 0xFF, index & 0xFF); // Tag 5, Len 2
            } else {
                apdu.push(0x2C, (index >> 24) & 0xFF, (index >> 16) & 0xFF, (index >> 8) & 0xFF, index & 0xFF); // Tag 5, Len 4
            }
        }

        const frame = new Uint8Array(npdu.length + apdu.length);
        frame.set(npdu);
        frame.set(new Uint8Array(apdu), npdu.length);
        return frame;
    }

    /**
     * 在十六进制日志中寻找 I-Am 响应并解析出设备 ID
     */
    public static parseIAmDeviceId(hex: string): number | null {
        // I-Am 探测特征：Unconfirmed-Req (0x10), Service 0 (0x00) -> 10 00
        // BACnet IP: 81 0B/0A ... 01 00 10 00
        // BACnet MS/TP: 55 FF 06 ... 01 00 10 00

        let apduIndex = -1;
        if (hex.startsWith('81')) {
            apduIndex = 12; // byte 6 * 2
        } else if (hex.startsWith('55FF')) {
            apduIndex = 20; // byte 10 * 2
        }

        if (apduIndex !== -1 && hex.substring(apduIndex, apduIndex + 4) === '1000') {
            // 解析 Device ID: Tag 12 (0xC4) 之后是对象 ID
            const tagIndex = hex.indexOf('C4', apduIndex);
            if (tagIndex !== -1) {
                const deviceIdHex = hex.substring(tagIndex + 2, tagIndex + 10);
                const deviceId = parseInt(deviceIdHex, 16) & 0x3FFFFF; // 提取低 22 位
                return deviceId;
            }
        }
        return null;
    }

    /**
     * 解析 BACnet 响应帧
     * 提取 Invoke ID, PDU Type，以及具体的属性值
     */
    public static parseResponse(
        hex: string,
        pendingRequest?: { propId: string, index?: number }
    ): { invokeId?: number, pduType?: number, data?: ParsedItemData } | null {
        let apduIndex = -1;
        if (hex.startsWith('81')) {
            apduIndex = 12;
        } else if (hex.startsWith('55FF')) {
            apduIndex = 20;
        }

        if (apduIndex === -1 || hex.length <= apduIndex + 6) return null;

        const pduFirstByte = hex.substring(apduIndex, apduIndex + 2);
        const pduType = parseInt(pduFirstByte.substring(0, 1), 16);

        // Complex-ACK, Error, Reject, Abort
        if (pduType === BacnetPduType.ComplexAck ||
            pduType === BacnetPduType.Error ||
            pduType === BacnetPduType.Reject ||
            pduType === BacnetPduType.Abort) {
            const invokeId = parseInt(hex.substring(apduIndex + 2, apduIndex + 4), 16);

            const result: { invokeId: number, pduType: number, data?: ParsedItemData } = {
                invokeId,
                pduType
            };

            // 错误处理
            if (pduType === BacnetPduType.Error || pduType === BacnetPduType.Reject || pduType === BacnetPduType.Abort) {
                if (pendingRequest) {
                    // 判断是否为扫点越界 Error Class 2, Error Code 42 -> 91 02 91 2A
                    const isEndOfList = pendingRequest.propId === BacnetPropertyIdentifier.ObjectList.toString()
                        && pendingRequest.index !== undefined
                        && hex.includes('9102912A');

                    result.data = {
                        propId: pendingRequest.propId,
                        value: "(不支持)",
                        isError: true,
                        isEndOfList
                    };
                }
                return result;
            }

            // Complex ACK 成功解析
            if (pduType === BacnetPduType.ComplexAck) {
                const parsedData: ParsedItemData = { propId: '', value: null };

                // 特殊处理：发现对象列表 (Property 76: ObjectList)，即使没有 pendingRequest 也尝试解析（全列表返回的情况）
                if (hex.includes('194C') || (pendingRequest && pendingRequest.propId === BacnetPropertyIdentifier.ObjectList.toString())) {
                    const foundObjects: any[] = [];
                    const matches = hex.matchAll(/C4([0-9A-F]{8})/g);
                    for (const match of matches) {
                        const fullId = parseInt(match[1], 16);
                        const type = (fullId >> 22) & 0x3FF;
                        const instance = fullId & 0x3FFFFF;
                        if (type !== BacnetObjectType.Device) {
                            const typeName = BACNET_OBJECT_TYPE_NAMES[type] || `Type:${type}`;
                            const simpleType = BACNET_OBJECT_TYPE_SHORT_NAMES[type] || 'obj';
                            foundObjects.push({
                                id: `obj-${type}-${instance}`,
                                name: `(${typeName}, ${instance})`,
                                type: simpleType,
                                // protocol 和 details 留给外部填充
                            });
                        }
                    }
                    if (foundObjects.length > 0) {
                        parsedData.propId = BacnetPropertyIdentifier.ObjectList.toString();
                        parsedData.foundObjects = foundObjects;
                        result.data = parsedData;
                        // 如果找到了 Object, 但不是具体的请求值匹配，可以先返回
                    }
                }

                // 精确匹配某条待处理请求的数据结构
                if (pendingRequest && pendingRequest.propId) {
                    parsedData.propId = pendingRequest.propId;

                    const propTag = '19' + parseInt(pendingRequest.propId).toString(16).padStart(2, '0').toUpperCase();
                    const propIdx = hex.indexOf(propTag, apduIndex);

                    if (propIdx !== -1) {
                        // Opening Tag 3E, Closing Tag 3F
                        const valStart = hex.indexOf('3E', propIdx + 4);
                        const valEnd = hex.indexOf('3F', valStart);

                        if (valStart !== -1 && valEnd !== -1) {
                            const rawVal = hex.substring(valStart + 2, valEnd);
                            const tagByte = parseInt(rawVal.substring(0, 2), 16);
                            const tag = (tagByte >> 4) as BacnetApplicationTag;
                            let value: string = "";

                            if (pendingRequest.propId === BacnetPropertyIdentifier.ObjectList.toString() && pendingRequest.index === 0 && (tag === BacnetApplicationTag.UnsignedInteger || tag === BacnetApplicationTag.Enumerated)) {
                                const len = (tagByte & 0x07);
                                const content = rawVal.substring(2, 2 + len * 2);
                                let totalCount = 0;
                                for (let i = 0; i < content.length; i += 2) {
                                    totalCount = (totalCount << 8) | parseInt(content.substring(i, i + 2), 16);
                                }
                                parsedData.totalCount = totalCount;
                            }

                            // 数据类型解析
                            if (tag === BacnetApplicationTag.CharacterString) {
                                try {
                                    const offset = (tagByte === 0x7E) ? 6 : 4;
                                    const content = rawVal.substring(offset);
                                    const matches = content.match(/.{1,2}/g);
                                    if (matches) {
                                        const bytes = matches.map(x => parseInt(x, 16));
                                        value = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
                                    } else {
                                        value = "";
                                    }
                                } catch {
                                    value = "Decode Error";
                                }
                            } else if (tag === BacnetApplicationTag.Real) {
                                const bufMatch = rawVal.substring(2, 10).match(/.{1,2}/g);
                                if (bufMatch) {
                                    const buf = new Uint8Array(bufMatch.map(x => parseInt(x, 16)));
                                    value = new DataView(buf.buffer).getFloat32(0).toFixed(4);
                                }
                            } else if (tag === BacnetApplicationTag.Boolean) {
                                value = (tagByte & 0x01) ? "1" : "0";
                            } else if (tag === BacnetApplicationTag.UnsignedInteger || tag === BacnetApplicationTag.Enumerated) {
                                const len = (tagByte & 0x07);
                                const content = rawVal.substring(2, 2 + len * 2);
                                let valNum = 0;
                                for (let i = 0; i < content.length; i += 2) {
                                    valNum = (valNum << 8) | parseInt(content.substring(i, i + 2), 16);
                                }
                                value = valNum.toString();

                                if (pendingRequest.propId === BacnetPropertyIdentifier.Units.toString()) {
                                    value = BACNET_UNITS_NAMES[valNum] || value;
                                } else if (pendingRequest.propId === BacnetPropertyIdentifier.EventState.toString()) {
                                    value = valNum === 0 ? 'normal' : `state-${valNum}`;
                                } else if (pendingRequest.propId === BacnetPropertyIdentifier.ObjectType.toString()) {
                                    value = BACNET_OBJECT_TYPE_NAMES[valNum] || value;
                                }
                            } else if (tag === BacnetApplicationTag.BitString) {
                                value = "{false,false,false,false}";
                            } else if (tag === BacnetApplicationTag.ObjectIdentifier) {
                                const fullId = parseInt(rawVal.substring(2, 10), 16);
                                const tId = (fullId >> 22) & 0x3FF;
                                const iId = fullId & 0x3FFFFF;
                                const tName = BACNET_OBJECT_TYPE_NAMES[tId] || tId;
                                value = `(${tName}, ${iId})`;
                            }

                            parsedData.value = value;
                            result.data = { ...result.data, ...parsedData };
                        }
                    }
                }

                return result;
            }
        }

        return null;
    }
}
