/**
 * 设备配置状态管理
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ProfileService } from '@/services/profileService';
import type { SavedProfile } from '@/types/profile';

export const useProfileStore = defineStore('profile', () => {
    const profiles = ref<SavedProfile[]>([]);
    const currentProfileId = ref<string | null>(null);
    const isLoading = ref(false);
    const error = ref<string | null>(null);

    // 初始化加载
    async function loadProfiles() {
        isLoading.value = true;
        error.value = null;
        try {
            profiles.value = await ProfileService.getList();
        } catch (e: any) {
            error.value = e.message;
            console.error('Failed to load profiles:', e);
        } finally {
            isLoading.value = false;
        }
    }

    // 导入配置
    async function importProfile(file: File): Promise<boolean> {
        try {
            const text = await file.text();
            const data = ProfileService.parseAndValidate(text);
            await ProfileService.save(data);
            await loadProfiles(); // 刷新列表
            return true;
        } catch (e: any) {
            error.value = e.message;
            return false;
        }
    }

    // 保存编辑器中的配置
    async function saveEditorProfile(jsonContent: string, id?: string): Promise<boolean> {
        try {
            const data = ProfileService.parseAndValidate(jsonContent);
            const newId = await ProfileService.save(data, id);
            await loadProfiles();

            // 如果是新建，选中它
            if (!id) {
                currentProfileId.value = newId;
            }
            return true;
        } catch (e: any) {
            error.value = e.message;
            return false;
        }
    }

    // 删除
    async function deleteProfile(id: string) {
        if (!confirm('确定要删除这个设备配置吗？')) return;
        try {
            await ProfileService.delete(id);
            if (currentProfileId.value === id) {
                currentProfileId.value = null;
            }
            await loadProfiles();
        } catch (e: any) {
            error.value = e.message;
        }
    }

    // 导出
    function exportProfile(profile: SavedProfile) {
        const blob = new Blob([JSON.stringify(profile.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // 生成文件名：厂家_系列_型号.json
        const s = profile.data.protocol_summary;
        const filenameParts = [s.manufacturer, s.series, s.model].filter(Boolean);
        const filename = filenameParts.length > 0
            ? `${filenameParts.join('_')}.json`
            : `${profile.name.replace(/\s+/g, '_')}_profile.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return {
        profiles,
        currentProfileId,
        isLoading,
        error,
        loadProfiles,
        importProfile,
        saveEditorProfile,
        deleteProfile,
        exportProfile
    };
});
