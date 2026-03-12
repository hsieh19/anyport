/**
 * 设备配置状态管理
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ProfileService } from '@/services/profileService';
import type { SavedProfile } from '@/types/profile';

export const useProfileStore = defineStore('profile', () => {
    const profiles = ref<SavedProfile[]>([]);
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
            await ProfileService.save(data, id);
            await loadProfiles();
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
            await loadProfiles();
        } catch (e: any) {
            error.value = e.message;
        }
    }

    // 内部：执行浏览器文件下载
    function downloadJson(data: unknown, filename: string) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 内部：根据 protocol_summary 生成文件名
    function buildFilename(summary: any, fallbackName: string): string {
        const parts = [summary?.manufacturer, summary?.series, summary?.model]
            .filter((k): k is string => !!k && String(k).trim() !== '');
        return parts.length > 0
            ? `${parts.join('_')}.json`
            : `${fallbackName.replace(/\s+/g, '_')}.json`;
    }

    // 导出已保存的 profile（入参为 SavedProfile 对象）
    function exportProfile(profile: SavedProfile) {
        downloadJson(profile.data, buildFilename(profile.data.protocol_summary, profile.name));
    }

    // 导出实时编辑数据（用于编辑器"导出"场景，data 可能和 DB 中不同）
    function exportProfileData(data: any, fallbackId?: string | null) {
        const fallback = fallbackId ? profiles.value.find(p => p.id === fallbackId) : null;
        downloadJson(data, buildFilename(data?.protocol_summary, fallback?.name ?? 'DeviceProfile'));
    }

    return {
        profiles,
        isLoading,
        error,
        loadProfiles,
        importProfile,
        saveEditorProfile,
        deleteProfile,
        exportProfile,
        exportProfileData
    };
});
