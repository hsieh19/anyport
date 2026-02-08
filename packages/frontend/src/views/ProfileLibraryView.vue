<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useProfileStore } from '@/stores/profileStore';
import type { SavedProfile } from '@/types/profile';

const profileStore = useProfileStore();

const searchKw = ref('');
const selectedId = ref<string | null>(null);
const jsonContent = ref('');
const isEditing = ref(false);

// 编辑器相关
const lineCount = ref(1);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const lineNumbersRef = ref<HTMLDivElement | null>(null);

function updateLineCount() {
  const lines = jsonContent.value.split('\n').length;
  lineCount.value = lines || 1;
}

function handleScroll() {
  if (textareaRef.value && lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = textareaRef.value.scrollTop;
  }
}

// 初始化加载
onMounted(() => {
  profileStore.loadProfiles();
});

// 三级树结构：厂家 -> 系列 -> 配置列表(型号)
type TreeStructure = Record<string, Record<string, SavedProfile[]>>;

// 折叠状态管理 (存储展开的节点的 Key)
const expandedKeys = ref<Set<string>>(new Set());

// 切换折叠状态
function toggleExpand(key: string) {
  console.log('Toggle:', key, expandedKeys.value.has(key));
  if (expandedKeys.value.has(key)) {
    expandedKeys.value.delete(key);
  } else {
    expandedKeys.value.add(key);
  }
}

// ...

// 计算属性：构建三级树
const profileTree = computed(() => {
  const tree: TreeStructure = {};
  
  profileStore.profiles.forEach(p => {
    // 读取字段，并提供兜底默认值
    const m = p.data.protocol_summary.manufacturer || '其他厂家';
    const s = p.data.protocol_summary.series || '其他系列';
    
    // 初始化层级
    if (!tree[m]) tree[m] = {};
    if (!tree[m][s]) tree[m][s] = [];
    
    tree[m][s].push(p);
  });
  
  return tree;
});

// 监听数据变化，仅在初始化或数据加载时设置默认展开
import { watch } from 'vue';
watch(() => profileStore.profiles.length, (newLen, oldLen) => {
  // 只有当之前没数据，现在有数据时（即首次加载），才执行默认展开
  if (oldLen === 0 && newLen > 0 && expandedKeys.value.size === 0) {
     Object.keys(profileTree.value).forEach(m => expandedKeys.value.add(m));
  }
}, { immediate: true });

// 选中某个文件
function selectProfile(profile: SavedProfile) {
  selectedId.value = profile.id;
  jsonContent.value = JSON.stringify(profile.data, null, 2);
  updateLineCount();
  isEditing.value = false;
}

// 保存修改
async function saveChanges() {
  if (!selectedId.value) return;
  
  const success = await profileStore.saveEditorProfile(jsonContent.value, selectedId.value);
  if (success) {
    alert('保存成功！');
    isEditing.value = false;
  } else {
    alert(`保存失败: ${profileStore.error}`);
  }
}

// 新建空文件
function createNew() {
  const template = {
    protocol_summary: {
      manufacturer: "NewFactory",
      series: "Series A",
      model: "Model-X",
      protocol_type: "MODBUS_RTU",
      default_baud: 9600, 
      default_id: 1,
      default_endian: "ABCD"
    },
    registers: []
  };
  jsonContent.value = JSON.stringify(template, null, 2);
  updateLineCount();
  selectedId.value = null; // null 表示这是一个新文件
  isEditing.value = true;
}

// 导入文件处理
async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    await profileStore.importProfile(file);
    input.value = ''; // 重置文件框
  }
}

// 导出处理
function handleExport() {
  if (!selectedId.value) return;
  
  try {
    // 1. 获取最新数据
    const data = JSON.parse(jsonContent.value);
    
    // 2. 生成文件名
    const s = data.protocol_summary || {};
    // 过滤掉 undefined/null/空字符串
    const parts = [s.manufacturer, s.series, s.model].filter(k => k && String(k).trim() !== '');
    
    let filename = 'profile.json';
    if (parts.length > 0) {
        filename = `${parts.join('_')}.json`;
    } else {
        // 兜底：尝试使用旧版字段或 store 中的名称
        const p = profileStore.profiles.find(p => p.id === selectedId.value);
        const name = p?.name || 'DeviceProfile';
        filename = `${name.replace(/\s+/g, '_')}.json`;
    }

    // 3. 执行下载
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
  } catch (e) {
    alert('导出失败：当前的 JSON 格式不正确，无法解析。');
    console.error(e);
  }
}
</script>

<template>
  <div class="profile-library">
    <div class="library-header">
      <h2>📚 点表库管理</h2>
      <div class="actions">
        <label class="btn-import">
          导入 JSON
          <input type="file" accept=".json" @change="handleFileUpload" hidden>
        </label>
        <button class="btn-new" @click="createNew">新建点表</button>
      </div>
    </div>

    <div class="library-body">
      <!-- 左侧：三级目录树 -->
      <!-- 左侧：三级目录树 -->
      <div class="sidebar-tree">
        <div class="search-box">
          <input v-model="searchKw" placeholder="搜索点表..." />
        </div>
        
        <div class="tree-content">
          <!-- Level 1: 厂家 -->
          <div v-for="(seriesMap, manufacturer) in profileTree" :key="manufacturer" class="tree-level-1">
            <div class="tree-node-header root-node" @click.stop="toggleExpand(manufacturer)">
              <span class="arrow-icon">{{ expandedKeys.has(manufacturer) ? '▼' : '▶' }}</span>
              <span class="icon">🏭</span>
              <span class="label">{{ manufacturer }}</span>
            </div>
            
            <div v-if="expandedKeys.has(manufacturer)" class="tree-children level-1-children">
              <!-- Level 2: 系列 -->
              <div v-for="(list, series) in seriesMap" :key="manufacturer + '__' + series" class="tree-level-2">
                <div class="tree-node-header series-node" @click.stop="toggleExpand(manufacturer + '__' + series)">
                  <span class="arrow-icon">{{ expandedKeys.has(manufacturer + '__' + series) ? '▼' : '▶' }}</span>
                  <span class="icon">📁</span>
                  <span class="label">{{ series }}</span>
                </div>

                <div v-if="expandedKeys.has(manufacturer + '__' + series)" class="tree-children level-2-children">
                  <!-- Level 3: 型号 (文件) -->
                  <div 
                    v-for="item in list" 
                    :key="item.id"
                    class="tree-item"
                    :class="{ active: selectedId === item.id }"
                    @click.stop="selectProfile(item)"
                  >
                    <span class="file-icon">📄</span>
                    <span class="file-name">{{ item.data.protocol_summary.model || item.name }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div v-if="Object.keys(profileTree).length === 0" class="empty-tree">
              暂无数据
          </div>
        </div>
      </div>

      <!-- 右侧：JSON 编辑器 -->
      <div class="editor-panel">
        <div class="editor-toolbar">
          <span v-if="selectedId" class="status-text">
            正在编辑: 
            {{ 
              (() => {
                const p = profileStore.profiles.find(p => p.id === selectedId);
                if (!p) return '未知';
                const s = p.data.protocol_summary;
                // 过滤空值并用下划线连接，保持与导出文件名一致
                return [s.manufacturer, s.series, s.model || p.name]
                  .filter(k => k && String(k).trim() !== '')
                  .join('_');
              })()
            }}
          </span>
          <span v-else class="status-text">新建文件</span>
          
          <div class="editor-actions">
            <button v-if="selectedId" class="btn-delete" @click="profileStore.deleteProfile(selectedId)">删除</button>
            <button v-if="selectedId" class="btn-export" @click="handleExport">导出</button>
            <button class="btn-save" @click="saveChanges">保存更改</button>
          </div>
        </div>
        
        <div class="code-editor-wrapper">
          <div class="line-numbers" ref="lineNumbersRef">
            <div v-for="n in lineCount" :key="n" class="line-num">{{ n }}</div>
          </div>
          <textarea 
            class="json-textarea" 
            ref="textareaRef"
            v-model="jsonContent"
            spellcheck="false"
            placeholder="在此处输入或粘贴 JSON 配置..."
            @scroll="handleScroll"
            @input="updateLineCount"
          ></textarea>
        </div>
        
        <div v-if="profileStore.error" class="error-msg">
          <span class="icon">❌</span>
          {{ profileStore.error }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-library {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 80px); /* 默认桌面端减去顶部导航 */
  max-width: 1600px;
  margin: 0 auto;
  padding: 1rem;
  gap: 1rem;
}

/* 适配桌面端布局 */
@media (min-width: 769px) {
  .profile-library {
    height: calc(100vh - 80px);
  }
}

/* 适配移动端布局 */
@media (max-width: 768px) {
  .profile-library {
    height: auto;
    min-height: 100%;
    padding: 0.75rem;
    gap: 0.75rem;
  }
  
  .library-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    padding: 1rem;
  }
  
  .actions {
    justify-content: space-between;
  }
  
  .btn-import, .btn-new {
    flex: 1;
    text-align: center;
  }

  .library-body {
    flex-direction: column;
    height: auto;
  }

  .sidebar-tree {
    width: 100%;
    height: 300px; /* 固定高度或根据内容变化 */
    flex-shrink: 0;
  }

  .editor-panel {
    min-height: 400px;
  }

  .editor-toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .editor-actions {
    width: 100%;
    justify-content: space-between;
  }

  .editor-actions button {
    flex: 1;
  }
}

.library-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-surface);
  padding: 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
}

.library-header h2 {
  margin: 0;
  font-size: 1.1rem;
  color: var(--color-text);
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 1rem;
}

.btn-import, .btn-new {
  padding: 0.6rem 1.2rem;
  border-radius: var(--radius-md);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-surface-hover);
  color: var(--color-text);
  transition: all 0.2s;
}

.btn-new {
  background: var(--color-primary);
  color: white;
  border: none;
}

/* 主体分栏 */
.library-body {
  display: flex;
  flex: 1;
  gap: 1rem;
  min-height: 0; /* 防止溢出 */
}

/* 左侧树 */
.sidebar-tree {
  width: 300px;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-box {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.search-box input {
  width: 100%;
  padding: 0.6rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.tree-node-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.5rem;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.9rem;
  user-select: none;
  font-weight: 500;
  border-radius: var(--radius-md);
  position: relative;
  z-index: 1;
}

.tree-node-header:hover {
  background: var(--color-surface-hover);
}

.root-node {
  font-weight: 600;
}

.series-node {
  color: var(--color-text-secondary);
}

.arrow-icon {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  width: 1rem;
  text-align: center;
  transition: transform 0.2s;
}

.tree-level-1 {
  margin-bottom: 0.5rem;
}

.level-1-children {
  margin-left: 0.7rem;
  padding-left: 0.5rem;
  border-left: 1px dashed var(--color-border);
}

.tree-level-2 {
  margin-top: 0.2rem;
}

.level-2-children {
  margin-left: 0.7rem;
  padding-left: 0.5rem;
  border-left: 1px dashed var(--color-border);
}

.tree-item {
  margin-left: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  cursor: pointer;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.tree-item:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.tree-item.active {
  background: rgba(102, 126, 234, 0.1);
  color: var(--color-primary);
  font-weight: 600;
}

.empty-tree {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

/* 右侧编辑器 */
.editor-panel {
  flex: 1;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-hover);
}

.status-text {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  word-break: break-all;
}

.editor-actions {
  display: flex;
  gap: 0.8rem;
}

.editor-actions button {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-md);
  border: none;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete {
  background: rgba(245, 87, 108, 0.1);
  color: var(--color-error);
}

.btn-export {
  background: var(--color-bg);
  border: 1px solid var(--color-border) !important;
  color: var(--color-text);
}

.btn-save {
  background: var(--color-primary);
  color: white;
}

.code-editor-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  background: #1e1e1e;
}

.line-numbers {
  width: 40px;
  background: #252526;
  color: #858585;
  text-align: right;
  padding: 1rem 0;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  user-select: none;
  overflow: hidden;
  border-right: 1px solid #333;
}

.line-num {
  padding-right: 8px;
}

.json-textarea {
  flex: 1;
  width: 100%;
  padding: 1rem;
  background: transparent;
  color: #d4d4d4;
  border: none;
  resize: none;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  white-space: pre;
  overflow: auto;
}

.error-msg {
  padding: 0.8rem;
  background: rgba(245, 87, 108, 0.1);
  color: var(--color-error);
  font-size: 0.85rem;
  border-top: 1px solid rgba(245, 87, 108, 0.2);
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-family: 'Consolas', monospace;
  max-height: 100px;
  overflow-y: auto;
}
</style>
