/**
 * BACnet 常量与枚举定义
 * 基于 ANSI/ASHRAE Standard 135
 */

export enum BacnetObjectType {
    AnalogInput = 0,
    AnalogOutput = 1,
    AnalogValue = 2,
    BinaryInput = 3,
    BinaryOutput = 4,
    BinaryValue = 5,
    Calendar = 6,
    Command = 7,
    Device = 8,
    EventEnrollment = 9,
    File = 10,
    Group = 11,
    Loop = 12,
    MultiStateInput = 13,
    MultiStateOutput = 14,
    NotificationClass = 15,
    Program = 16,
    Schedule = 17,
    Averaging = 18,
    MultiStateValue = 19,
    TrendLog = 20,
    LifeSafetyPoint = 21,
    LifeSafetyZone = 22,
    Accumulator = 23,
    PulseConverter = 24,
    EventLog = 25,
    GlobalGroup = 26,
    TrendLogMultiple = 27,
    LoadControl = 28,
    StructuredView = 29,
    AccessDoor = 30,
    Timer = 31,
    AccessCredential = 32,
    AccessPoint = 33,
    AccessRights = 34,
    AccessUser = 35,
    AccessZone = 36,
    CredentialDataInput = 37,
    NetworkSecurity = 38,
    BitStringValue = 39,
    CharacterStringValue = 40,
    DatePatternValue = 41,
    DateValue = 42,
    DatetimePatternValue = 43,
    DatetimeValue = 44,
    IntegerValue = 45,
    LargeAnalogValue = 46,
    OctetStringValue = 47,
    PositiveIntegerValue = 48,
    TimePatternValue = 49,
    TimeValue = 50,
    NotificationForwarder = 51,
    AlertEnrollment = 52,
    Channel = 53,
    LightingOutput = 54,
    BinaryLightingOutput = 55,
    NetworkPort = 56,
    ElevatorGroup = 57,
    Escalator = 58,
    Lift = 59,
}

export enum BacnetPropertyIdentifier {
    Description = 28,
    EventState = 36,
    MaxApduLengthAccepted = 62,
    ModelName = 70,
    ObjectIdentifier = 75,
    ObjectList = 76,
    ObjectName = 77,
    ObjectType = 79,
    OutOfService = 81,
    PresentValue = 85,
    StatusFlags = 111,
    Units = 117,
    VendorIdentifier = 120,
    VendorName = 121,
    // Range & Calibration (Common/Standard or JCI Proprietary)
    MaxPresValue = 65,
    MinPresValue = 69,
}

// 供 UI 显示及解析补充使用的辅助映射
export const BACNET_PROPERTY_NAMES: Record<number, string> = {
    [BacnetPropertyIdentifier.Description]: '描述(description)',
    [BacnetPropertyIdentifier.EventState]: '事件状态(event-state)',
    [BacnetPropertyIdentifier.ModelName]: '型号(model-name)',
    [BacnetPropertyIdentifier.ObjectIdentifier]: '对象标识符(object-identifier)',
    [BacnetPropertyIdentifier.ObjectName]: '对象名称(object-name)',
    [BacnetPropertyIdentifier.ObjectType]: '对象类型(object-type)',
    [BacnetPropertyIdentifier.OutOfService]: '脱机服务(out-of-service)',
    [BacnetPropertyIdentifier.PresentValue]: '当前值(present-value)',
    [BacnetPropertyIdentifier.StatusFlags]: '状态标志(status-flags)',
    [BacnetPropertyIdentifier.Units]: '单位(units)',
    [BacnetPropertyIdentifier.VendorIdentifier]: '厂商标识符(vendor-identifier)',
    [BacnetPropertyIdentifier.VendorName]: '厂商名称(vendor-name)',
    [BacnetPropertyIdentifier.MaxApduLengthAccepted]: '最大APDU长度(max-apdu-length-accepted)',
    [BacnetPropertyIdentifier.ObjectList]: '对象列表(object-list)',
    [BacnetPropertyIdentifier.MinPresValue]: '最小值(min-pres-value)',
    [BacnetPropertyIdentifier.MaxPresValue]: '最大值(max-pres-value)',
};

export const BACNET_OBJECT_TYPE_NAMES: Record<number, string> = {
    [BacnetObjectType.AnalogInput]: 'Analog Input',
    [BacnetObjectType.AnalogOutput]: 'Analog Output',
    [BacnetObjectType.AnalogValue]: 'Analog Value',
    [BacnetObjectType.BinaryInput]: 'Binary Input',
    [BacnetObjectType.BinaryOutput]: 'Binary Output',
    [BacnetObjectType.BinaryValue]: 'Binary Value',
    [BacnetObjectType.Device]: 'Device',
    [BacnetObjectType.MultiStateInput]: 'Multi-state Input',
    [BacnetObjectType.MultiStateOutput]: 'Multi-state Output',
    [BacnetObjectType.Program]: 'Program',
    [BacnetObjectType.MultiStateValue]: 'Multi-state Value',
};

export const BACNET_OBJECT_TYPE_SHORT_NAMES: Record<number, string> = {
    [BacnetObjectType.AnalogInput]: 'ai',
    [BacnetObjectType.AnalogOutput]: 'ao',
    [BacnetObjectType.AnalogValue]: 'av',
    [BacnetObjectType.BinaryInput]: 'bi',
    [BacnetObjectType.BinaryOutput]: 'bo',
    [BacnetObjectType.BinaryValue]: 'bv',
    [BacnetObjectType.Device]: 'dev',
    [BacnetObjectType.MultiStateInput]: 'mi',
    [BacnetObjectType.MultiStateOutput]: 'mo',
    [BacnetObjectType.Program]: 'prog',
    [BacnetObjectType.MultiStateValue]: 'mv',
};

// 预定义标签类型 (Application Tags)
export enum BacnetApplicationTag {
    Null = 0,
    Boolean = 1,
    UnsignedInteger = 2,
    SignedInteger = 3,
    Real = 4,
    Double = 5,
    OctetString = 6,
    CharacterString = 7,
    BitString = 8,
    Enumerated = 9,
    Date = 10,
    Time = 11,
    ObjectIdentifier = 12,
}

// 错误类别
export enum BacnetErrorClass {
    Device = 0,
    Object = 1,
    Property = 2,
    Resources = 3,
    Security = 4,
    Services = 5,
    Vt = 6,
    Communication = 7,
}

// 错误码
export enum BacnetErrorCode {
    InvalidArrayIndex = 42,
}

export enum BacnetPduType {
    ConfirmedRequest = 0,
    UnconfirmedRequest = 1,
    SimpleAck = 2,
    ComplexAck = 3,
    SegmentAck = 4,
    Error = 5,
    Reject = 6,
    Abort = 7,
}

export const BACNET_UNITS_NAMES: Record<number, string> = {
    // Pressure
    50: 'Pa',
    54: 'kPa',
    55: 'psi',
    56: 'MPa',
    // Temperature
    62: '°C',
    63: 'K',
    64: '°F',
    // Electrical
    3: 'A',
    5: 'V',
    19: 'kWh',
    27: 'Hz',
    124: 'kW',
    160: 'mA',
    // Others
    95: 'No Units',
    98: '%',
};
