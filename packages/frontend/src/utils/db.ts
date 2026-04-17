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
    history_data: {
        key: number;
        value: {
            id?: number;
            timestamp: number;
            deviceLabel: string;
            slaveAddr: number; // 显式存储从站号，用于导出过滤
            registerAddr: number;
            rawValue: any; // 允许多个寄存器值的数组或字符串，避免 number 类型不匹配报错
            parsedValue: string | null;
            profileId: string | null;
        };
        indexes: { 'by-timestamp': number; 'by-device': string; 'by-slave': number };
    };
}

const DB_NAME = 'anyport-profiles';
const DB_VERSION = 3;

const dbPromise = openDB<AnyPortDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('profiles')) {
            const store = db.createObjectStore('profiles', { keyPath: 'id' });
            store.createIndex('by-date', 'updatedAt');
        }
        if (oldVersion < 2) {
            if (!db.objectStoreNames.contains('history_data')) {
                const store = db.createObjectStore('history_data', { keyPath: 'id', autoIncrement: true });
                store.createIndex('by-timestamp', 'timestamp');
                store.createIndex('by-device', 'deviceLabel');
                store.createIndex('by-slave', 'slaveAddr');
            }
        }
        if (oldVersion < 3) {
            const store = transaction.objectStore('history_data');
            if (!store.indexNames.contains('by-slave')) {
                store.createIndex('by-slave', 'slaveAddr');
            }
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

export const historyDb = {
    async add(entry: AnyPortDB['history_data']['value']) {
        return (await dbPromise).add('history_data', entry);
    },
    async addBulk(entries: AnyPortDB['history_data']['value'][]) {
        const db = await dbPromise;
        const tx = db.transaction('history_data', 'readwrite');
        const promises = entries.map(entry => tx.store.add(entry));
        await Promise.all([...promises, tx.done]);
    },
    async getByTimeRange(start: number, end: number, slaveAddr?: number) {
        const db = await dbPromise;
        let data = await db.getAllFromIndex('history_data', 'by-timestamp', IDBKeyRange.bound(start, end));
        if (slaveAddr !== undefined) {
            data = data.filter(item => item.slaveAddr === slaveAddr);
        }
        return data;
    },
    async clearOldData(beforeTimestamp: number) {
        const db = await dbPromise;
        const tx = db.transaction('history_data', 'readwrite');
        const index = tx.store.index('by-timestamp');
        let cursor = await index.openCursor(IDBKeyRange.upperBound(beforeTimestamp));
        while (cursor) {
            await cursor.delete();
            cursor = await cursor.continue();
        }
        await tx.done;
    },
    async limitRecords(maxCount: number) {
        const db = await dbPromise;
        const count = await db.count('history_data');
        if (count > maxCount) {
            const deleteCount = count - maxCount;
            const tx = db.transaction('history_data', 'readwrite');
            let cursor = await tx.store.openCursor();
            for (let i = 0; i < deleteCount && cursor; i++) {
                await cursor.delete();
                cursor = await cursor.continue();
            }
            await tx.done;
        }
    }
};
