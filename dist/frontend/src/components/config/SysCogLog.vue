<template>
  <div class="log-panel" v-loading="loading">
    <div class="log-header">
      <div class="log-title">
        <font-awesome-icon icon="list" />
        <span>{{ $t('sysLogs.title') }}</span>
      </div>
      <div class="log-actions">
        <el-switch
          v-model="autoRefresh"
          :active-text="$t('sysLogs.autoRefresh')"
          size="small"
        />
        <el-button size="small" @click="fetchLogs">
          <font-awesome-icon icon="sync" /> {{ $t('sysLogs.refresh') }}
        </el-button>
        <el-button size="small" @click="sendTestLog">
          <font-awesome-icon icon="paper-plane" /> {{ $t('sysLogs.testLog') }}
        </el-button>
        <el-button size="small" type="primary" plain @click="exportLogs">
          <font-awesome-icon icon="download" /> {{ $t('sysLogs.export') }}
        </el-button>
        <el-button size="small" type="danger" plain @click="clearLogs">
          <font-awesome-icon icon="trash-alt" /> {{ $t('sysLogs.clear') }}
        </el-button>
      </div>
    </div>

    <!-- 概览 -->
    <div class="log-stats">
      <div class="stat-item">
        <span class="stat-label">{{ $t('sysLogs.buffered') }}</span>
        <span class="stat-value">{{ stats.buffered ?? 0 }} / {{ stats.capacity ?? 0 }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('sysLogs.levelInfo') }}</span>
        <span class="stat-value is-info">{{ stats.byLevel?.info ?? 0 }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('sysLogs.levelWarn') }}</span>
        <span class="stat-value is-warn">{{ stats.byLevel?.warn ?? 0 }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('sysLogs.levelError') }}</span>
        <span class="stat-value is-error">{{ stats.byLevel?.error ?? 0 }}</span>
      </div>
      <div class="stat-item is-wide">
        <span class="stat-label">{{ $t('sysLogs.logFile') }}</span>
        <span class="stat-value is-path" :title="stats.file">{{ stats.file || '-' }}</span>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="log-filters">
      <el-select
        v-model="filter.date"
        size="small"
        style="width: 160px"
        @change="fetchLogs"
      >
        <el-option :label="$t('sysLogs.logVersionToday')" value="" />
        <el-option
          v-for="f in logFiles"
          :key="f.date"
          :label="`${f.date} (${formatFileSize(f.size)})`"
          :value="f.date"
        />
      </el-select>
      <el-select v-model="filter.level" size="small" style="width: 120px" @change="fetchLogs">
        <el-option :label="$t('sysLogs.allLevels')" value="" />
        <el-option label="info" value="info" />
        <el-option label="warn" value="warn" />
        <el-option label="error" value="error" />
      </el-select>
      <el-select v-model="filter.scope" size="small" style="width: 150px" @change="fetchLogs">
        <el-option :label="$t('sysLogs.allScopes')" value="" />
        <el-option v-for="s in scopes" :key="s" :label="s" :value="s" />
      </el-select>
      <el-input
        v-model="filter.keyword"
        size="small"
        style="width: 240px"
        clearable
        :placeholder="$t('sysLogs.keywordPlaceholder')"
        @keyup.enter="fetchLogs"
        @clear="fetchLogs"
      />
      <el-select v-model="filter.limit" size="small" style="width: 110px" @change="fetchLogs">
        <el-option :label="$t('sysLogs.limitN', { n: 100 })" :value="100" />
        <el-option :label="$t('sysLogs.limitN', { n: 200 })" :value="200" />
        <el-option :label="$t('sysLogs.limitN', { n: 500 })" :value="500" />
        <el-option :label="$t('sysLogs.limitN', { n: 1000 })" :value="1000" />
      </el-select>
      <span class="filter-count">{{ $t('sysLogs.matched', { n: total }) }}</span>
    </div>

    <!-- 日志列表 -->
    <div class="log-list">
      <div v-if="!entries.length" class="log-empty">{{ $t('sysLogs.empty') }}</div>
      <div
        v-for="e in entries"
        :key="e.id"
        class="log-row"
        :class="`is-${e.level}`"
        @click="toggleDetail(e.id)"
      >
        <span class="log-time">{{ formatTime(e.at) }}</span>
        <span class="log-level" :class="`is-${e.level}`">{{ e.level.toUpperCase() }}</span>
        <span class="log-scope">{{ e.scope }}</span>
        <span class="log-message">{{ e.message }}</span>
        <span v-if="e.ip" class="log-ip">{{ e.ip }}</span>
        <font-awesome-icon
          v-if="e.detail"
          class="log-expand"
          :icon="expanded.has(e.id) ? 'chevron-down' : 'chevron-right'"
        />
        <pre v-if="e.detail && expanded.has(e.id)" class="log-detail">{{ e.detail }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
  name: 'SysCogLog',
  data() {
    return {
      loading: false,
      autoRefresh: false,
      timer: null,
      entries: [],
      total: 0,
      scopes: [],
      stats: {},
      expanded: new Set(),
      logFiles: [],
      filter: { date: '', level: '', scope: '', keyword: '', limit: 200 },
    };
  },
  methods: {
    async fetchLogs() {
      this.loading = true;
      try {
        const params = new URLSearchParams();
        if (this.filter.date) params.set('date', this.filter.date);
        if (this.filter.level) params.set('level', this.filter.level);
        if (this.filter.scope) params.set('scope', this.filter.scope);
        if (this.filter.keyword) params.set('keyword', this.filter.keyword);
        params.set('limit', String(this.filter.limit));
        const res = await fetchWithAuth(`/manage/logs?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
          this.entries = data.entries || [];
          this.total = data.total || 0;
          this.scopes = data.scopes || [];
          this.stats = data.stats || {};
        } else {
          this.$message?.error(data.message || '加载日志失败');
        }
      } catch (err) {
        this.$message?.error(`加载日志失败：${err.message}`);
      } finally {
        this.loading = false;
      }
    },
    /** 磁盘日志文件清单（日志版本下拉数据源） */
    async fetchLogFiles() {
      try {
        const res = await fetchWithAuth('/manage/logs/files');
        const data = await res.json();
        if (data.success) this.logFiles = data.data || [];
      } catch {
        /* 拉取失败不影响当日日志查看 */
      }
    },
    formatFileSize(n) {
      const v = Number(n) || 0;
      if (v < 1024) return `${v} B`;
      if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
      return `${(v / 1024 / 1024).toFixed(2)} MB`;
    },
    async clearLogs() {
      try {
        const res = await fetchWithAuth('/manage/logs', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.$message?.success(this.$t('sysLogs.cleared', { n: data.cleared ?? 0 }));
          this.entries = [];
          this.total = 0;
          this.fetchLogs();
        }
      } catch (err) {
        this.$message?.error(`清空失败：${err.message}`);
      }
    },
    async sendTestLog() {
      try {
        await fetchWithAuth('/manage/logs/test', { method: 'POST' });
        this.fetchLogs();
      } catch (err) {
        this.$message?.error(`写入失败：${err.message}`);
      }
    },
    /** 导出当前筛选下的日志为 .log 文件 */
    async exportLogs() {
      try {
        const params = new URLSearchParams();
        if (this.filter.date) params.set('date', this.filter.date);
        if (this.filter.level) params.set('level', this.filter.level);
        if (this.filter.scope) params.set('scope', this.filter.scope);
        if (this.filter.keyword) params.set('keyword', this.filter.keyword);
        params.set('limit', '5000');
        const resp = await fetchWithAuth(`/manage/logs/export?${params.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const disposition = resp.headers?.get?.('content-disposition') || '';
        const m = disposition.match(/filename="?([^";]+)"?/);
        a.download = m ? m[1] : `GoHub-logs-${new Date().toISOString().slice(0, 10)}.log`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        this.$message?.error(`导出失败：${err.message}`);
      }
    },
    toggleDetail(id) {
      const next = new Set(this.expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.expanded = next;
    },
    formatTime(ts) {
      if (!ts) return '-';
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
    startTimer() {
      this.stopTimer();
      this.timer = setInterval(() => this.fetchLogs(), 3000);
    },
    stopTimer() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    },
  },
  watch: {
    autoRefresh(val) {
      if (val) this.startTimer();
      else this.stopTimer();
    },
  },
  mounted() {
    this.fetchLogFiles();
    this.fetchLogs();
  },
  beforeUnmount() {
    this.stopTimer();
  },
};
</script>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 标题 + 操作按钮行：保持固定在顶部，滚动窗口时始终可见 */
.log-header {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin: -10px -12px 0;
  border-radius: 10px;
  background: var(--admin-container-bg-color);
  border-bottom: 1px solid color-mix(in srgb, var(--el-text-color-primary) 8%, transparent);
}

.log-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
}

.log-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 统计信息行与筛选栏：不粘滞，随窗口一起滚动 */
.log-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  position: static;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  min-width: 96px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--el-text-color-primary) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--el-text-color-primary) 8%, transparent);
}

html.dark .stat-item {
  background: color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
}

.stat-item.is-wide {
  flex: 1;
  min-width: 240px;
}

.stat-label {
  font-size: 12px;
  opacity: 0.7;
}

.stat-value {
  font-size: 15px;
  font-weight: 600;
}

.stat-value.is-info { color: #409eff; }
.stat-value.is-warn { color: #e6a23c; }
.stat-value.is-error { color: #f56c6c; }
.stat-value.is-path {
  font-size: 12px;
  font-weight: 400;
  word-break: break-all;
  opacity: 0.85;
}

/* 筛选栏：不粘滞，随窗口一起滚动 */
.log-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  position: static;
}

.filter-count {
  font-size: 12px;
  opacity: 0.7;
}

/* 日志列表：不使用内部滚动条，整页随窗口滚动（统计行 / 筛选栏一并滚走） */
.log-list {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
}

.log-empty {
  padding: 40px;
  text-align: center;
  opacity: 0.6;
  font-size: 14px;
}

.log-row {
  display: grid;
  grid-template-columns: 118px 62px 92px 1fr auto 18px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
  cursor: default;
}

.log-row:last-child {
  border-bottom: none;
}

.log-row:hover {
  background: color-mix(in srgb, var(--primary-color) 8%, transparent);
}

html.dark .log-row:hover {
  background: color-mix(in srgb, var(--primary-color) 14%, transparent);
}

.log-row.is-error {
  background: color-mix(in srgb, #f56c6c 7%, transparent);
}

.log-row.is-warn {
  background: color-mix(in srgb, #e6a23c 7%, transparent);
}

.log-time {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  opacity: 0.75;
}

.log-level {
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  border-radius: 4px;
  padding: 1px 0;
}

.log-level.is-info { color: #409eff; background: color-mix(in srgb, #409eff 14%, transparent); }
.log-level.is-warn { color: #e6a23c; background: color-mix(in srgb, #e6a23c 16%, transparent); }
.log-level.is-error { color: #f56c6c; background: color-mix(in srgb, #f56c6c 16%, transparent); }

.log-scope {
  font-size: 12px;
  opacity: 0.85;
  font-weight: 500;
}

.log-message {
  word-break: break-all;
}

.log-ip {
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  opacity: 0.55;
}

.log-expand {
  font-size: 11px;
  opacity: 0.6;
}

.log-detail {
  grid-column: 1 / -1;
  margin: 6px 0 0;
  padding: 8px 10px;
  font-size: 12px;
  font-family: Consolas, Monaco, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
}

@media (max-width: 768px) {
  /* v2.4.0：移动端顶部栏取消粘滞，跟随页面滚动 */
  .log-header {
    position: static;
  }
  .log-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .log-ip { display: none; }
  .log-expand { display: none; }
}
</style>
