/**
 * 云端 MQTT 配置一键提取服务
 */

export interface CloudMqttConfigPayload {
  brokerUrl?: string;
  username?: string;
  password?: string;
  topicPrefix?: string;
  siteId?: string;
  gatewayId?: string;
}

const CLOUD_CONFIG_ENDPOINT = 'https://update.anyport.one/anyport/mqtt-config';

/**
 * 根据提取码从云端拉取 MQTT 接入配置
 */
export async function fetchCloudMqttConfig(code: string): Promise<CloudMqttConfigPayload> {
  const pwd = code.trim();
  if (!pwd) {
    throw new Error('请输入提取密码');
  }

  const res = await fetch(CLOUD_CONFIG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pwd }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || `请求错误 (${res.status})`);
  }

  return (await res.json()) as CloudMqttConfigPayload;
}
