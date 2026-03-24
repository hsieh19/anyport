/**
 * 通用网络/串口通信协议错误翻译工具
 */

export function translateCommError(errStr: string): string {
    if (!errStr) return '';

    // 预处理：删除 ERROR: 前缀，转换为小写
    const rawMsg = errStr.replace(/^ERROR:\s*/i, '').trim();
    const lowerMsg = rawMsg.toLowerCase();

    // 1. 串口相关 (RTU)
    if (lowerMsg.includes('no port selected') || lowerMsg.includes('requestport')) return '未选择串口设备，连接已取消';
    if (lowerMsg.includes('access denied')) return '串口访问被拒绝，请检查端口是否被其他程序占用';
    if (lowerMsg.includes('failed to open')) return '串口开启失败，请确认设备已连入并驱动正常';
    if (lowerMsg.includes('file not found') || lowerMsg.includes('could not find')) return '未找到对应串口，请检查 COM 号是否正确';

    // 1.5 代码级异常 (兜底提示)
    if (lowerMsg.includes('is not a function')) return '程序指令异常，请刷新页面重试';

    // 2. 网络与连接 (Anyport Bridge / TCP)
    const netDict: Record<string, string> = {
        'websocket connection error': '本地桥接程序 (Anyport Bridge) 连接失败，请检查程序是否启动 (默认 8081)',
        'failed to fetch': '网络请求失败，请检查网络或桥接程序状态',
        'i/o timeout': '通信超时，网关或目标设备未在规定时间内响应',
        'context deadline exceeded': '请求超时，网关处理失败',
        'connection refused': '连接被拒绝 (对方可能未开放该端口或模拟器未启动)',
        'actively refused it': '目标服务器拒绝连接 (请检查 IP/端口是否正确)',
        'no such host': '无法识别的主机地址 (IP 不合法或 DNS 解析失败)',
        'network is unreachable': '网络不可达 (请确认网段路由是否正确)',
        'connection reset by peer': '连接被对端强制关闭',
        'eof': '连接意外中断 (EOF)',
        'timeout_unreachable': '目标地址不可达或连接超时 (W5500 硬件检测)',
        'connection_refused': '目标拒绝连接 (请检查端口是否正确)',
        'w5500 socket 异常': '网关硬件 Socket 资源耗尽，请尝试重启网关'
    };

    for (const [key, val] of Object.entries(netDict)) {
        if (lowerMsg.includes(key)) return val;
    }

    // 3. 业务与协议相关
    if (lowerMsg.includes('mqtt connection error')) return 'MQTT 服务连接失败，请检查服务器配置';
    if (lowerMsg.includes('connection lost')) return '连接已意外断开';
    if (lowerMsg.includes('device not connected')) return '设备尚未建立连接';
    if (lowerMsg.includes('invalid frame')) return '非法的协议数据帧，请确认波特率/校验位设置';
    if (lowerMsg.includes('not supported')) return '当前环境不支持此通信模式';

    // 4. 特殊格式提取：如果报错太长且包含冒号，尝试提取最后一部分 (常用于 Go 库报错)
    const segments = rawMsg.split(':');
    if (segments.length > 3) {
        const lastPart = segments[segments.length - 1].trim();
        if (lastPart.length > 2 && !lastPart.includes('dial tcp')) {
            return lastPart;
        }
    }

    return rawMsg;
}
