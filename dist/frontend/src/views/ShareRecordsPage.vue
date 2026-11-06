<template>
  <!--
    分享记录（v3.0.0）
      · 独立整页：系统设置「访客图库 → 查看分享记录」与用户编辑页「对外分享 → 查看分享记录」
        都以新标签打开本页（可带 ?username=<账户名>）；
      · 数据源：GET /api/shares（普通用户只看自己；管理员可按 username 代查）；
      · 行内与批量操作都走 PATCH /api/shares/:id 与 POST /api/shares/batch。
  -->
  <div class="share-page">
    <header class="share-topbar">
      <div class="topbar-left">
        <el-button class="back-btn" circle @click="goBack">
          <font-awesome-icon icon="arrow-left" />
        </el-button>
        <h1 class="page-title">{{ $t('shareRecords.title') }}</h1>
        <span class="record-count">{{ $t('shareRecords.totalCount', { count: total }) }}</span>
      </div>

      <div class="topbar-right">
        <!-- 用户搜索：仅管理员可见（普通用户固定只看自己，后端同样强制） -->
        <el-select
          v-if="isAdminRole"
          v-model="filter.username"
          class="filter-user"
          size="small"
          clearable
          filterable
          :loading="userLoading"
          :placeholder="$t('shareRecords.userFilterPlaceholder')"
          @change="onUserChange"
        >
          <el-option v-for="u in users" :key="u.username" :label="u.username" :value="u.username" />
        </el-select>

        <!-- 二级联动：实例下拉（全部实例 / 默认 / 该用户的实例） -->
        <el-select v-model="filter.instance" class="filter-instance" size="small" :loading="instanceLoading" @change="applyFilter">
          <el-option :label="$t('shareRecords.allInstances')" value="__all__" />
          <el-option :label="$t('shareRecords.defaultInstance')" value="__default__" />
          <el-option
            v-for="inst in instances"
            :key="inst.id"
            :label="`${inst.index} · ${inst.name}`"
            :value="inst.id"
          />
        </el-select>

        <el-select v-model="filter.type" class="filter-type" size="small" @change="applyFilter">
          <el-option :label="$t('shareRecords.allTypes')" value="" />
          <el-option :label="$t('shareRecords.typeCate')" value="cate" />
          <el-option :label="$t('shareRecords.typeTag')" value="tag" />
        </el-select>

        <el-input
          v-model="filter.keyword"
          class="filter-search"
          size="small"
          clearable
          :placeholder="$t('shareRecords.keywordPlaceholder')"
          @keyup.enter="applyFilter"
          @clear="applyFilter"
        >
          <template #prefix><font-awesome-icon icon="search" /></template>
        </el-input>

        <el-tooltip :content="$t('shareRecords.refresh')" placement="bottom" :show-after="800">
          <el-button class="icon-btn" circle size="small" @click="reload">
            <font-awesome-icon icon="sync" />
          </el-button>
        </el-tooltip>
      </div>
    </header>

    <div class="share-body">
      <el-table
        ref="table"
        :data="rows"
        row-key="id"
        class="main-table"
        table-layout="fixed"
        v-loading="loading"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column :label="$t('shareRecords.colUrl')" min-width="240">
          <template #default="{ row }">
            <span class="share-url" :title="row.url" @click="openUrl(row)">{{ row.url }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('shareRecords.colType')" width="88" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'tag' ? 'warning' : 'primary'" effect="plain">
              {{ row.type === 'tag' ? $t('shareRecords.typeTag') : $t('shareRecords.typeCate') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('shareRecords.colTarget')" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ targetText(row) }}</template>
        </el-table-column>
        <el-table-column v-if="isAdminRole" :label="$t('shareRecords.colOwner')" width="120" prop="owner" show-overflow-tooltip />
        <el-table-column :label="$t('shareRecords.colInstance')" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ instanceText(row) }}</template>
        </el-table-column>
        <el-table-column :label="$t('shareRecords.colStatus')" width="92" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusOf(row).type">{{ statusOf(row).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('shareRecords.colEncrypted')" width="80" align="center">
          <template #default="{ row }">
            {{ row.encrypted ? $t('shareRecords.encryptedYes') : $t('shareRecords.encryptedNo') }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('shareRecords.colExpireAt')" width="160">
          <template #default="{ row }">{{ row.expireAt ? formatTime(row.expireAt) : $t('shareRecords.neverExpire') }}</template>
        </el-table-column>
        <el-table-column :label="$t('shareRecords.colCreatedAt')" width="160">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="$t('shareRecords.colActions')" width="220">
          <template #default="{ row }">
            <el-button
              link
              size="small"
              :type="row.enabled ? 'warning' : 'primary'"
              @click="toggleEnabled(row)"
            >{{ row.enabled ? $t('shareRecords.actionDisable') : $t('shareRecords.actionEnable') }}</el-button>
            <el-button link size="small" type="primary" @click="openPasswordDialog(row)">
              {{ $t('shareRecords.actionPassword') }}
            </el-button>
            <el-button link size="small" type="danger" @click="removeRow(row)">
              {{ $t('shareRecords.actionDelete') }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-state">
            <font-awesome-icon icon="inbox" class="empty-icon" />
            <p>{{ $t('shareRecords.empty') }}</p>
          </div>
        </template>
      </el-table>

      <!-- 底部批量栏：多选后批量启用 / 停用 / 加密 / 删除 -->
      <div class="batch-bar">
        <el-checkbox
          :model-value="allChecked"
          :indeterminate="someChecked"
          :disabled="rows.length === 0"
          @change="toggleAll"
        >{{ $t('shareRecords.selectAll') }}</el-checkbox>
        <span v-if="selected.length" class="selected-hint">
          {{ $t('shareRecords.selectedCount', { count: selected.length }) }}
        </span>
        <div class="batch-actions">
          <el-button size="small" :disabled="!selected.length || busy" @click="batch('enable')">
            {{ $t('shareRecords.batchEnable') }}
          </el-button>
          <el-button size="small" :disabled="!selected.length || busy" @click="batch('disable')">
            {{ $t('shareRecords.batchDisable') }}
          </el-button>
          <el-button size="small" type="primary" plain :disabled="!selected.length || busy" @click="openPasswordDialog(null)">
            {{ $t('shareRecords.batchPassword') }}
          </el-button>
          <el-button size="small" type="danger" plain :disabled="!selected.length || busy" @click="batch('delete')">
            {{ $t('shareRecords.batchDelete') }}
          </el-button>
        </div>
      </div>

      <div v-if="total > pageSize" class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          :layout="pagerLayout"
          :pager-count="5"
          background
          @current-change="fetchList"
        />
      </div>
    </div>

    <!-- 加密：单条（row）或批量（选中项）共用同一个弹窗；留空 = 清除密码 -->
    <el-dialog v-model="pwDialog.visible" :title="pwDialog.title" :width="dialogWidth" append-to-body>
      <p class="hint block">{{ $t('shareRecords.passwordHint') }}</p>
      <el-input
        v-model="pwDialog.value"
        type="password"
        show-password
        maxlength="64"
        :placeholder="$t('shareRecords.passwordPlaceholder')"
        @keyup.enter="submitPassword"
      />
      <template #footer>
        <el-button @click="pwDialog.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="pwDialog.busy" @click="submitPassword">{{ $t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

/**
 * 分享记录页（v3.0.0）。
 *
 * 权限：
 *   · 管理员：可搜索任意用户（?username= 也可预置），看全部账户的分享；
 *   · 普通用户：只看自己（后端按会话强制过滤），实例下拉也只有自己的实例。
 *
 * 实例筛选约定（与 /api/shares 契约一致）：
 *   · 「全部实例」→ 不传 instanceId；
 *   · 「默认」→ instanceId 传空串；
 *   · 具体实例 → instanceId 传实例 id。
 */
export default {
  name: 'ShareRecordsPage',
  data() {
    return {
      loading: false,
      busy: false,
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      selected: [],
      filter: { username: '', instance: '__all__', type: '', keyword: '' },
      // 用户搜索（仅管理员；列表接口无 search 参数 → 一次拉全量，下拉里本地过滤）
      users: [],
      userLoading: false,
      usersLoaded: false,
      // 二级联动：该用户的实例（默认实例不在接口返回里，选项里单独补一项）
      instances: [],
      instanceLoading: false,
      pwDialog: { visible: false, ids: [], value: '', busy: false, title: '' },
    };
  },
  computed: {
    isAdminRole() {
      return this.$store?.getters?.isAdminRole === true;
    },
    currentUser() {
      return this.$store?.state?.sessionUser || '';
    },
    /** 当前生效的账户名（管理员未选择时为空 = 后端返回全部） */
    activeUsername() {
      if (!this.isAdminRole) return this.currentUser;
      return String(this.filter.username || '').trim();
    },
    allChecked() {
      return this.rows.length > 0 && this.selected.length === this.rows.length;
    },
    someChecked() {
      return this.selected.length > 0 && this.selected.length < this.rows.length;
    },
    pagerLayout() {
      return window.innerWidth <= 768 ? 'prev, pager, next' : 'total, prev, pager, next';
    },
    dialogWidth() {
      return window.innerWidth <= 768 ? '92%' : '460px';
    },
  },
  mounted() {
    const q = this.$route.query || {};
    if (this.isAdminRole && q.username) this.filter.username = String(q.username);
    if (q.instanceId) this.filter.instance = String(q.instanceId);
    if (q.type === 'cate' || q.type === 'tag') this.filter.type = q.type;
    if (this.isAdminRole) this.loadUsers();
    this.loadInstances();
    this.fetchList();
  },
  methods: {
    goBack() {
      if (window.history.length > 1) this.$router.back();
      else this.$router.push({ name: 'systemConfig' });
    },
    /** 管理员：用户下拉（一次拉全量） */
    async loadUsers() {
      if (this.usersLoaded || this.userLoading) return;
      this.userLoading = true;
      try {
        const res = await fetchWithAuth('/api/manage/users');
        const list = res.ok ? await res.json() : [];
        this.users = (Array.isArray(list) ? list : [])
          .filter((u) => u && u.username)
          .map((u) => ({ username: u.username, nickname: u.nickname || '' }));
        this.usersLoaded = true;
      } catch {
        this.users = [];
      } finally {
        this.userLoading = false;
      }
    },
    /** 用户切换 → 实例下拉重新联动（普通用户只会有自己的实例） */
    async onUserChange() {
      this.filter.instance = '__all__';
      await this.loadInstances();
      this.applyFilter();
    },
    /** 实例列表：管理员按所选用户代查；普通用户不传 username（后端按会话） */
    async loadInstances() {
      this.instanceLoading = true;
      try {
        let url = '/api/instances';
        const u = this.activeUsername;
        if (this.isAdminRole && u && u !== this.currentUser) {
          url += `?username=${encodeURIComponent(u)}`;
        }
        const res = await fetchWithAuth(url);
        const list = res.ok ? await res.json() : [];
        this.instances = Array.isArray(list) ? list : [];
      } catch {
        this.instances = [];
      } finally {
        this.instanceLoading = false;
      }
    },
    applyFilter() {
      this.page = 1;
      this.selected = [];
      this.fetchList();
    },
    reload() {
      this.selected = [];
      this.fetchList();
    },
    /** instanceId：'__all__' → 不传；'__default__' → 空串；其它 → 实例 id */
    instanceParam() {
      if (this.filter.instance === '__all__') return undefined;
      if (this.filter.instance === '__default__') return '';
      return this.filter.instance;
    },
    async fetchList() {
      this.loading = true;
      try {
        const params = new URLSearchParams();
        const u = this.activeUsername;
        if (this.isAdminRole && u) params.set('username', u);
        const inst = this.instanceParam();
        if (inst !== undefined) params.set('instanceId', inst);
        if (this.filter.type) params.set('type', this.filter.type);
        if (this.filter.keyword) params.set('keyword', this.filter.keyword.trim());
        params.set('page', String(this.page));
        params.set('pageSize', String(this.pageSize));

        const res = await fetchWithAuth(`/api/shares?${params.toString()}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
        this.rows = Array.isArray(body.data) ? body.data : [];
        this.total = Number(body.total || 0);
        // 换页 / 刷新后清空多选，避免对已不在当前页的记录做批量操作
        this.selected = [];
        this.$refs.table?.clearSelection?.();
      } catch (err) {
        this.rows = [];
        this.total = 0;
        this.$message.error(this.$t('shareRecords.loadFailed'));
        console.error('[shareRecords] 加载失败：', err?.message || err);
      } finally {
        this.loading = false;
      }
    },
    /** 单条启停：PATCH /api/shares/:id { enabled } */
    async toggleEnabled(row) {
      const next = !row.enabled;
      try {
        const res = await fetchWithAuth(`/api/shares/${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
        row.enabled = next;
        this.$message.success(next ? this.$t('shareRecords.enabledOk') : this.$t('shareRecords.disabledOk'));
      } catch (err) {
        this.$message.error(err?.message || this.$t('shareRecords.operateFailed'));
      }
    },
    /** 打开加密弹窗：row 为空时对「选中项」批量设置 */
    openPasswordDialog(row) {
      const ids = row ? [row.id] : this.selected.map((r) => r.id);
      if (!ids.length) return;
      this.pwDialog = {
        visible: true,
        ids,
        value: '',
        busy: false,
        title: row
          ? `${this.$t('shareRecords.passwordTitle')} · ${this.targetText(row)}`
          : this.$t('shareRecords.batchPassword'),
      };
    },
    async submitPassword() {
      const ids = this.pwDialog.ids || [];
      if (!ids.length) return;
      const password = String(this.pwDialog.value || '');
      this.pwDialog.busy = true;
      try {
        if (ids.length === 1) {
          const res = await fetchWithAuth(`/api/shares/${encodeURIComponent(ids[0])}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
        } else {
          await this.postBatch(ids, 'password', password);
        }
        this.$message.success(this.$t('shareRecords.passwordSaved'));
        this.pwDialog.visible = false;
        this.selected = [];
        await this.fetchList();
      } catch (err) {
        this.$message.error(err?.message || this.$t('shareRecords.operateFailed'));
      } finally {
        this.pwDialog.busy = false;
      }
    },
    /** POST /api/shares/batch 的统一调用 */
    async postBatch(ids, action, password) {
      const payload = { ids, action };
      if (password !== undefined) payload.password = password;
      const res = await fetchWithAuth('/api/shares/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
      return body;
    },
    async removeRow(row) {
      try {
        await this.$confirm(
          this.$t('shareRecords.deleteConfirm'),
          this.$t('common.warning'),
          {
            confirmButtonText: this.$t('common.confirm'),
            cancelButtonText: this.$t('common.cancel'),
            type: 'warning',
          },
        );
      } catch {
        return;
      }
      this.busy = true;
      try {
        const res = await fetchWithAuth(`/api/shares/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
        this.$message.success(this.$t('shareRecords.deleted'));
        this.selected = [];
        await this.fetchList();
      } catch (err) {
        this.$message.error(err?.message || this.$t('shareRecords.operateFailed'));
      } finally {
        this.busy = false;
      }
    },
    /** 批量：enable | disable | password | delete */
    async batch(action) {
      const ids = this.selected.map((r) => r.id);
      if (!ids.length) return;
      if (action === 'password') {
        this.openPasswordDialog(null);
        return;
      }
      if (action === 'delete') {
        try {
          await this.$confirm(
            this.$t('shareRecords.batchDeleteConfirm', { count: ids.length }),
            this.$t('common.warning'),
            {
              confirmButtonText: this.$t('common.confirm'),
              cancelButtonText: this.$t('common.cancel'),
              type: 'warning',
            },
          );
        } catch {
          return;
        }
      }
      this.busy = true;
      try {
        await this.postBatch(ids, action);
        this.$message.success(
          action === 'delete'
            ? this.$t('shareRecords.deleted')
            : action === 'enable'
              ? this.$t('shareRecords.enabledOk')
              : this.$t('shareRecords.disabledOk'),
        );
        this.selected = [];
        await this.fetchList();
      } catch (err) {
        this.$message.error(err?.message || this.$t('shareRecords.operateFailed'));
      } finally {
        this.busy = false;
      }
    },
    toggleAll(checked) {
      const table = this.$refs.table;
      if (!table) {
        this.selected = checked ? [...this.rows] : [];
        return;
      }
      if (checked) this.rows.forEach((r) => table.toggleRowSelection(r, true));
      else table.clearSelection();
      this.selected = checked ? [...this.rows] : [];
    },
    onSelectionChange(v) {
      this.selected = Array.isArray(v) ? v : [];
    },
    statusOf(row) {
      if (row.expired) return { text: this.$t('shareRecords.statusExpired'), type: 'info' };
      if (!row.enabled) return { text: this.$t('shareRecords.statusDisabled'), type: 'warning' };
      return { text: this.$t('shareRecords.statusEnabled'), type: 'success' };
    },
    targetText(row) {
      if (row.type === 'tag') return `#${row.target}`;
      return row.target || '/';
    },
    instanceText(row) {
      if (!row.instanceId) return this.$t('shareRecords.defaultInstance');
      return `${row.instanceIndex || '-'} · ${row.instanceName || '-'}`;
    },
    openUrl(row) {
      if (!row.url) return;
      window.open(row.url, '_blank', 'noopener');
    },
    formatTime(v) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return '-';
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
  },
};
</script>

<style scoped>
.share-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--admin-container-bg-color);
  color: var(--upload-text-color);
}

.share-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--admin-container-bg-color);
  position: static;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  background: var(--upload-main-title-color);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.record-count {
  font-size: 13px;
  opacity: 0.75;
}

.filter-user { width: 170px; }
.filter-instance { width: 170px; }
.filter-type { width: 120px; }
.filter-search { width: 220px; }

.icon-btn,
.back-btn {
  background-color: var(--toolbar-button-bg-color);
  box-shadow: var(--toolbar-button-shadow);
  border: none;
  color: var(--theme-toggle-color);
}

.back-btn:hover {
  color: var(--el-color-primary);
}

.share-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 24px 40px;
}

/* 表格：与「用户管理」列表同一套玻璃卡片视觉 */
.main-table {
  width: 100%;
  box-sizing: border-box;
  border-radius: 16px;
  box-shadow: var(--glass-shadow);
  min-height: 320px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg) !important;
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.main-table :deep(.el-table__inner-wrapper),
.main-table :deep(.el-table__header-wrapper),
.main-table :deep(.el-table__body-wrapper),
.main-table :deep(.el-table__row),
.main-table :deep(.el-table__row td) {
  background: transparent !important;
}

.main-table :deep(.el-table__header th) {
  background: transparent !important;
}

.main-table :deep(.el-table__row:hover td) {
  background: var(--glass-header-bg) !important;
}

.share-url {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  vertical-align: middle;
  font-size: 13px;
  color: var(--el-color-primary);
  cursor: pointer;
}

.share-url:hover {
  text-decoration: underline;
}

/* 底部批量栏 */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px 0;
  flex-wrap: wrap;
}

.selected-hint {
  font-size: 12px;
  opacity: 0.7;
}

.batch-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  opacity: 0.6;
}

.empty-icon {
  font-size: 48px;
  color: var(--theme-toggle-color);
}

.pager {
  display: flex;
  justify-content: center;
  padding: 22px 0 6px;
}

.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.share-body::-webkit-scrollbar {
  width: 8px;
}

.share-body::-webkit-scrollbar-thumb {
  background: var(--el-border-color);
  border-radius: 4px;
}

/* 移动端：自然文档流滚动 + 筛选控件整行 */
@media (max-width: 768px) {
  .share-page {
    height: auto;
    min-height: 100vh;
    min-height: 100dvh;
  }

  .share-topbar {
    padding: 10px 12px;
  }

  .share-body {
    flex: 0 0 auto;
    overflow-y: visible;
    padding: 12px 12px 40px;
  }

  .topbar-left,
  .topbar-right {
    max-width: 100%;
    min-width: 0;
  }

  .topbar-right {
    flex: 1 1 100%;
  }

  .filter-user,
  .filter-instance,
  .filter-type,
  .filter-search {
    width: 100%;
  }

  .batch-actions {
    margin-left: 0;
    width: 100%;
  }
}
</style>
