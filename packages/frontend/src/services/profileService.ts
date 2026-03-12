/**
 * 配置管理服务层
 * 负责数据的导入、验证和存取
 * 目前基于本地 IndexedDB 实现，未来可切换为 Rest API
 */
import { profileDb } from '@/utils/db';
import type { DeviceProfile, SavedProfile } from '@/types/profile';

export const ProfileService = {
    /**
     * 获取所有配置列表
     */
    async getList(): Promise<SavedProfile[]> {
        return (await profileDb.getAll()).reverse(); // 按时间倒序
    },

    /**
     * 获取单个配置详情
     */
    async get(id: string): Promise<SavedProfile | undefined> {
        return await profileDb.get(id);
    },

    /**
     * 保存配置 (新增或更新)
     */
    async save(data: DeviceProfile, existingId?: string): Promise<string> {
        // 简单的格式校验
        if (!data.protocol_summary || !data.registers) {
            throw new Error('无效的配置文件格式：缺少 protocol_summary 或 registers');
        }

        const generateUUID = () => {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
            // Fallback for non-secure contexts (HTTP)
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        };

        const id = existingId || generateUUID();

        // 生成显示名称：优先使用 "厂家 - 型号"，兜底使用 series 或 description
        const displayName = (data.protocol_summary.manufacturer && data.protocol_summary.model)
            ? `${data.protocol_summary.manufacturer}-${data.protocol_summary.model}`
            : (data.protocol_summary.series || data.protocol_summary.description || '未命名设备');

        const profile: SavedProfile = {
            id,
            name: displayName,
            description: data.protocol_summary.description || data.protocol_summary.device_info,
            data,
            updatedAt: Date.now()
        };

        if (existingId) {
            await profileDb.update(profile);
        } else {
            await profileDb.add(profile);
        }

        return id;
    },

    /**
     * 删除配置
     */
    async delete(id: string): Promise<void> {
        await profileDb.delete(id);
    },

    /**
     * 解析并验证 JSON 字符串
     */
    parseAndValidate(jsonStr: string): DeviceProfile {
        try {
            const data = JSON.parse(jsonStr);
            // 这里可以添加更严格的 Schema 校验 (如 Zod)
            if (!data.protocol_summary) {
                throw new Error('缺少 protocol_summary 字段');
            }
            return data as DeviceProfile;
        } catch (e) {
            if (e instanceof Error) {
                throw new Error(`JSON 解析失败: ${e.message}`);
            }
            throw new Error('无效的 JSON 数据');
        }
    }
};
