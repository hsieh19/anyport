import { defineStore } from 'pinia';
import { ref } from 'vue';
import { firmwareDb } from '@/utils/db';

export interface FirmwareManifest {
    version: string;
    filename: string;
    md5: string;
    release_time: string;
}

export const useFirmwareStore = defineStore('firmware', () => {
    const API_BASE = 'https://update.anyport.one'; // 这里的域名应与 worker 部署一致
    
    const manifest = ref<FirmwareManifest | null>(null);
    const isFetchingManifest = ref(false);
    const downloadProgress = ref(0);
    const isDownloading = ref(false);
    const cacheStatus = ref<'none' | 'cached' | 'outdated'>('none');

    const fetchManifest = async () => {
        isFetchingManifest.value = true;
        try {
            const resp = await fetch(`${API_BASE}/anyport/manifest`);
            if (!resp.ok) throw new Error('拉取清单失败');
            manifest.value = await resp.json();
            await checkCacheStatus();
        } catch (err) {
            console.error('[FirmwareStore] Fetch manifest error:', err);
            throw err;
        } finally {
            isFetchingManifest.value = false;
        }
    };

    const checkCacheStatus = async () => {
        if (!manifest.value) return;
        const local = await firmwareDb.get(manifest.value.version);
        if (local) {
            if (local.hash === manifest.value.md5) {
                cacheStatus.value = 'cached';
            } else {
                cacheStatus.value = 'outdated';
            }
        } else {
            cacheStatus.value = 'none';
        }
    };

    const getFirmwareData = async (forceDownload = false): Promise<ArrayBuffer> => {
        if (!manifest.value) throw new Error('未获取到固件清单');

        // 1. 尝试从本地获取
        if (!forceDownload) {
            const local = await firmwareDb.get(manifest.value.version);
            if (local && local.hash === manifest.value.md5) {
                console.log('[FirmwareStore] Using cached firmware:', local.version);
                return local.data;
            }
        }

        // 2. 否则从云端拉取
        isDownloading.value = true;
        downloadProgress.value = 0;
        try {
            // 获取签名链接
            const linkResp = await fetch(`${API_BASE}/anyport/get-link?ver=${manifest.value.version}&type=full`);
            if (!linkResp.ok) throw new Error('获取下载链接失败');
            const { url: signedUrl } = await linkResp.json();

            // 执行实际下载
            const resp = await fetch(signedUrl);
            if (!resp.ok) throw new Error('下载固件包失败');
            
            const reader = resp.body!.getReader();
            const contentLength = +resp.headers.get('Content-Length')!;
            
            let receivedLength = 0;
            const chunks = [];
            while(true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;
                downloadProgress.value = Math.round((receivedLength / contentLength) * 100);
            }

            const blob = new Blob(chunks);
            const buffer = await blob.arrayBuffer();

            // 存入本地缓存
            await firmwareDb.save({
                version: manifest.value.version,
                data: buffer,
                fileName: manifest.value.filename,
                hash: manifest.value.md5,
                updatedAt: Date.now()
            });

            cacheStatus.value = 'cached';
            return buffer;
        } catch (err) {
            console.error('[FirmwareStore] Download error:', err);
            throw err;
        } finally {
            isDownloading.value = false;
        }
    };

    return {
        manifest,
        isFetchingManifest,
        downloadProgress,
        isDownloading,
        cacheStatus,
        fetchManifest,
        getFirmwareData
    };
});
