/**
 * 本地数据库工具
 * 基于 IndexedDB 存储设备配置文件
 */
import { openDB, type DBSchema } from 'idb';

interface AnyPortDB extends DBSchema {
    profiles: {
        key: string;
        value: {
            id: string;
            name: string;
            description?: string;
            data: any; // 完整的 JSON 配置
            updatedAt: number;
        };
        indexes: { 'by-date': number };
    };
}

const DB_NAME = 'anyport-profiles';
const DB_VERSION = 1;

const dbPromise = openDB<AnyPortDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
        if (!db.objectStoreNames.contains('profiles')) {
            const store = db.createObjectStore('profiles', { keyPath: 'id' });
            store.createIndex('by-date', 'updatedAt');
        }
    },
});

export const profileDb = {
    async getAll() {
        return (await dbPromise).getAllFromIndex('profiles', 'by-date');
    },
    async get(id: string) {
        return (await dbPromise).get('profiles', id);
    },
    async add(profile: any) {
        return (await dbPromise).add('profiles', profile);
    },
    async update(profile: any) {
        return (await dbPromise).put('profiles', profile);
    },
    async delete(id: string) {
        return (await dbPromise).delete('profiles', id);
    },
};
