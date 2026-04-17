import { historyDb } from './db';

/**
 * 导出 Modbus 采集历史数据为 CSV
 */
export const exportCollectionToCsv = async (slaveAddr: number = 1, startTime?: number, endTime?: number) => {
  try {
    const now = Date.now();
    // 如果没有传时间范围，默认导出最近 7 天
    const st = startTime || (now - 7 * 24 * 60 * 60 * 1000);
    const et = endTime || now;
    
    const data = await historyDb.getByTimeRange(st, et, slaveAddr);

    if (data.length === 0) {
      alert('暂无历史采集数据供导出');
      return;
    }

    // CSV 表头：极简模式
    const headers = ['采集日期', '从站/地址', '采集数值'];
    
    // 生成 CSV 内容
    let csvContent = '\uFEFF'; 
    csvContent += headers.join(',') + '\n';

    data.forEach(item => {
      // 采集日期精确到秒
      const date = new Date(item.timestamp);
      const Y = date.getFullYear();
      const M = String(date.getMonth() + 1).padStart(2, '0');
      const D = String(date.getDate()).padStart(2, '0');
      const h = String(date.getHours()).padStart(2, '0');
      const m = String(date.getMinutes()).padStart(2, '0');
      const s = String(date.getSeconds()).padStart(2, '0');
      const dateStr = `${Y}-${M}-${D} ${h}:${m}:${s}`;

      const row = [
        `\t${dateStr}`, // 日期强制文本，防止 Excel 缩写
        `\t${item.registerAddr}`, // 寄存器地址
        `"${item.parsedValue || ''}"` // 采集数值
      ];
      csvContent += row.join(',') + '\n';
    });

    // 触发下载
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    // 生成带时间戳的文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.setAttribute('href', url);
    link.setAttribute('download', `Anyport_Export_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('CSV 导出失败:', error);
    alert('数据导出过程中发生错误，请检查控制台日志');
  }
};
