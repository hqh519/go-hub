<template>
    <!--
        v1.3.5.3 登记管理（P1）—— /reg
        ----------------------------------------------------------------------------
        · 概览：总额 / 条数 / 均值 / 极值；
        · 趋势：按日 / 周 / 月 / 年分桶的柱状对比（纯 CSS，无额外图表库）；
        · 分布：联合统计时按账户拆分；
        · 设置：自定义单位维护。
    -->
    <div class="reg-page">
        <header class="reg-head">
            <div class="reg-head-left">
                <font-awesome-icon icon="clipboard-list" class="reg-head-icon" />
                <h1 class="reg-head-title">{{ $t('reg.manageTitle') }}</h1>
            </div>
            <div class="reg-head-right">
                <el-radio-group v-model="tab" size="small">
                    <el-radio-button label="stats">{{ $t('reg.tabStats') }}</el-radio-button>
                    <el-radio-button label="settings">{{ $t('reg.tabSettings') }}</el-radio-button>
                </el-radio-group>
                <el-select
                    v-if="tab === 'stats'"
                    v-model="activeReport"
                    size="small"
                    clearable
                    class="reg-report-select"
                    :placeholder="$t('reg.reports')"
                    @change="applyReport"
                >
                    <el-option v-for="r in reports" :key="r.id" :label="r.name" :value="r.id" />
                </el-select>
                <el-button v-if="tab === 'stats'" size="small" @click="saveCurrentReport">
                    <font-awesome-icon icon="save" />{{ $t('reg.saveReport') }}
                </el-button>
                <el-button size="small" :loading="loading" @click="loadStats">
                    <font-awesome-icon icon="sync" />
                </el-button>
            </div>
        </header>

        <section v-if="tab === 'stats'" class="reg-stats">
            <div class="reg-filters">
                <el-select
                    v-model="trackerName"
                    size="small"
                    clearable
                    filterable
                    class="reg-f-marker"
                    :placeholder="$t('reg.allMarkers')"
                    @change="loadStats"
                >
                    <el-option v-for="t in trackers" :key="t.id" :label="t.name" :value="t.name" />
                </el-select>
                <el-select v-model="range" size="small" class="reg-f-range" @change="loadStats">
                    <el-option :label="$t('reg.rangeAll')" value="all" />
                    <el-option :label="$t('reg.rangeMonth')" value="month" />
                    <el-option :label="$t('reg.rangeYear')" value="year" />
                </el-select>
                <el-select v-model="bucket" size="small" class="reg-f-bucket" @change="loadStats">
                    <el-option :label="$t('reg.bucketDay')" value="day" />
                    <el-option :label="$t('reg.bucketWeek')" value="week" />
                    <el-option :label="$t('reg.bucketMonth')" value="month" />
                    <el-option :label="$t('reg.bucketYear')" value="year" />
                </el-select>
                <el-select v-model="scope" size="small" class="reg-f-scope" @change="loadStats">
                    <el-option :label="$t('reg.scopeMe')" value="me" />
                    <el-option :label="$t('reg.scopeAll')" value="all" />
                </el-select>
                <el-checkbox v-model="compareYear" class="reg-f-compare" @change="loadStats">
                    {{ $t('reg.compareYear') }}
                </el-checkbox>
            </div>

            <div class="reg-cards">
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statTotal') }}</span>
                    <span class="reg-card-value">{{ fmt(stats.total) }}<em>{{ stats.unit }}</em></span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statCount') }}</span>
                    <span class="reg-card-value">{{ stats.count }}</span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statAvg') }}</span>
                    <span class="reg-card-value">{{ fmt(stats.avg) }}<em>{{ stats.unit }}</em></span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statMaxMin') }}</span>
                    <span class="reg-card-value is-small">{{ fmt(stats.max) }} / {{ fmt(stats.min) }}</span>
                </div>
            </div>

            <div v-if="stats.derive" class="reg-cards reg-cards-derive">
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.deriveUnitPrice') }}</span>
                    <span class="reg-card-value is-small">
                        {{ stats.derive.unitPrice === null ? '—' : fmt(stats.derive.unitPrice) }}
                        <em v-if="stats.derive.unitPrice !== null">{{ stats.unit }}</em>
                    </span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.deriveInterval') }}</span>
                    <span class="reg-card-value is-small">
                        {{ stats.derive.interval.avgDays === null ? '—' : fmt(stats.derive.interval.avgDays) }}
                        <em v-if="stats.derive.interval.avgDays !== null">{{ $t('reg.days') }}</em>
                    </span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.deriveSpeed') }}</span>
                    <span class="reg-card-value is-small">
                        {{ stats.derive.speed.perDay === null ? '—' : fmt(stats.derive.speed.perDay) }}
                        <em v-if="stats.derive.speed.perDay !== null">/{{ $t('reg.day') }}</em>
                    </span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.deriveBalance') }}</span>
                    <span class="reg-card-value is-small">{{ fmt(balanceLast) }}<em>{{ stats.unit }}</em></span>
                </div>
            </div>

            <div v-if="stats.compare" class="reg-yoy">
                <font-awesome-icon icon="chart-line" class="reg-yoy-icon" />
                <span>{{ $t('reg.yoyTitle') }}：{{ fmt(stats.compare.total) }} {{ stats.unit }}</span>
                <em v-if="stats.compare.pct !== null" :class="{ 'is-up': stats.compare.pct >= 0 }">
                    {{ stats.compare.pct >= 0 ? '+' : '' }}{{ stats.compare.pct.toFixed(1) }}%
                </em>
                <span class="reg-yoy-sub">{{ $t('reg.yoySub', { n: stats.compare.count }) }}</span>
            </div>

            <div class="reg-chart-card">
                <div class="reg-chart-head">
                    <span class="reg-chart-title">{{ $t('reg.trendTitle') }}</span>
                    <span class="reg-chart-sub">{{ $t('reg.trendSub', { n: stats.series.length }) }}</span>
                </div>
                <div v-if="!stats.series.length" class="reg-chart-empty">{{ $t('reg.noData') }}</div>
                <div v-else class="reg-chart">
                    <div
                        v-for="b in stats.series"
                        :key="b.key"
                        class="reg-bar-wrap"
                        :title="`${b.key}：${fmt(b.sum)} ${stats.unit}（${b.count} 条）`"
                    >
                        <span class="reg-bar-val">{{ fmt(b.sum) }}</span>
                        <div class="reg-bar" :style="{ height: barHeight(b.sum) }"></div>
                        <span class="reg-bar-key">{{ shortKey(b.key) }}</span>
                    </div>
                </div>
                <div v-if="stats.series.length" class="reg-chart-legend">
                    <span v-for="b in stats.series.slice(-3)" :key="'d' + b.key" class="reg-legend-item">
                        {{ shortKey(b.key) }}：{{ b.diff === undefined ? '—' : (b.diff >= 0 ? '+' : '') + fmt(b.diff) }}
                        <em v-if="b.pct !== null && b.pct !== undefined">({{ b.pct >= 0 ? '+' : '' }}{{ b.pct.toFixed(1) }}%)</em>
                    </span>
                </div>
            </div>

            <div v-if="scope === 'all' && stats.byOwner.length" class="reg-owner-card">
                <div class="reg-chart-head">
                    <span class="reg-chart-title">{{ $t('reg.byOwnerTitle') }}</span>
                </div>
                <div class="reg-owner-list">
                    <div v-for="o in stats.byOwner" :key="o.owner" class="reg-owner-row">
                        <span class="reg-owner-name">{{ o.owner }}</span>
                        <div class="reg-owner-bar"><i :style="{ width: ownerWidth(o.sum) }"></i></div>
                        <span class="reg-owner-val">{{ fmt(o.sum) }}{{ stats.unit }}</span>
                        <span class="reg-owner-count">{{ o.count }}</span>
                    </div>
                </div>
            </div>
        </section>

        <section v-else class="reg-settings">
            <div class="reg-set-add">
                <el-input v-model="unitForm.name" size="small" class="reg-set-name" :placeholder="$t('reg.unitName')" maxlength="24" />
                <el-select v-model="unitForm.kind" size="small" class="reg-set-kind">
                    <el-option v-for="k in unitKinds" :key="k.value" :label="$t(k.label)" :value="k.value" />
                </el-select>
                <el-input v-model="unitForm.baseUnit" size="small" class="reg-set-base" :placeholder="$t('reg.unitBase')" maxlength="24" />
                <el-button size="small" type="primary" :loading="unitSaving" @click="saveUnit">
                    <font-awesome-icon icon="plus" class="reg-set-icon" />{{ $t('reg.unitAdd') }}
                </el-button>
            </div>
            <div v-if="!units.length" class="reg-empty">{{ $t('reg.noUnits') }}</div>
            <div v-else class="reg-unit-list">
                <div v-for="u in units" :key="u.id" class="reg-unit-row">
                    <span class="reg-unit-name">{{ u.name }}</span>
                    <span class="reg-unit-kind">{{ unitKindLabel(u.kind) }}</span>
                    <span class="reg-unit-base">{{ u.baseUnit }}</span>
                    <button type="button" class="reg-unit-del" :title="$t('common.delete')" @click="removeUnit(u)">
                        <font-awesome-icon icon="trash" />
                    </button>
                </div>
            </div>
        </section>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';

export default {
    name: 'RegManagePage',
    data() {
        return {
            tab: 'stats',
            loading: false,
            trackers: [],
            trackerName: '',
            range: 'all',
            bucket: 'month',
            scope: 'me',
            stats: {
                total: 0, count: 0, quantity: 0, avg: 0, max: 0, min: 0,
                series: [], byOwner: [], unit: '', currency: 'CNY',
                derive: null, compare: null,
            },
            compareYear: false,
            reports: [],
            activeReport: '',
            units: [],
            unitSaving: false,
            unitForm: { name: '', kind: 'count', baseUnit: '' },
            unitKinds: [
                { value: 'count', label: 'reg.kindCount' },
                { value: 'currency', label: 'reg.kindCurrency' },
                { value: 'weight', label: 'reg.kindWeight' },
                { value: 'length', label: 'reg.kindLength' },
                { value: 'volume', label: 'reg.kindVolume' },
                { value: 'time', label: 'reg.kindTime' },
                { value: 'ratio', label: 'reg.kindRatio' },
            ],
        };
    },
    computed: {
        /** 结存累计的最后一桶（派生指标卡片用） */
        balanceLast() {
            const arr = (this.stats.derive && this.stats.derive.balance) || [];
            return arr.length ? arr[arr.length - 1].value : 0;
        },
        instanceId() {
            try { return localStorage.getItem('gohub_instance_id') || ''; } catch (e) { return ''; }
        },
    },
    mounted() {
        this.loadTrackers();
        this.loadStats();
        this.loadUnits();
        this.loadReports();
    },
    methods: {
        async loadTrackers() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId });
                const res = await fetchWithAuth(`/api/reg/trackers?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.trackers = Array.isArray(data) ? data : [];
            } catch (e) {
                this.trackers = [];
            }
        },
        rangeQuery() {
            const now = new Date();
            if (this.range === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
            if (this.range === 'year') return { from: new Date(now.getFullYear(), 0, 1).getTime() };
            return {};
        },
        async loadStats() {
            this.loading = true;
            try {
                const qs = new URLSearchParams({
                    instanceId: this.instanceId,
                    scope: this.scope,
                    bucket: this.bucket,
                });
                if (this.trackerName) qs.set('trackerName', this.trackerName);
                if (this.compareYear) qs.set('compare', 'year');
                const rq = this.rangeQuery();
                if (rq.from) qs.set('from', String(rq.from));
                const res = await fetchWithAuth(`/api/reg/stats?${qs.toString()}`);
                const data = await res.json().catch(() => null);
                if (data) this.stats = { ...this.stats, ...data };
            } catch (e) {
                /* 失败保留上一次结果 */
            } finally {
                this.loading = false;
            }
        },
        async loadReports() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId });
                const res = await fetchWithAuth(`/api/reg/reports?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.reports = Array.isArray(data) ? data : [];
            } catch (e) {
                this.reports = [];
            }
        },
        currentQuery() {
            return {
                trackerName: this.trackerName,
                range: this.range,
                bucket: this.bucket,
                scope: this.scope,
                compare: this.compareYear ? 'year' : '',
            };
        },
        async saveCurrentReport() {
            let name = '';
            try {
                const r = await this.$prompt(this.$t('reg.reportNameTip'), this.$t('reg.saveReport'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    inputValue: this.trackerName || this.$t('reg.defaultReportName'),
                    inputValidator: (v) => (String(v || '').trim() ? true : this.$t('reg.reportNameRequired')),
                });
                name = String(r.value || '').trim();
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth('/api/reg/reports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, query: this.currentQuery(), instanceId: this.instanceId }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.reportSaved'));
                this.loadReports();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        applyReport(id) {
            if (!id) return;
            const r = this.reports.find((x) => x.id === id);
            if (!r) return;
            const q = r.query || {};
            this.trackerName = q.trackerName || '';
            this.range = q.range || 'all';
            this.bucket = q.bucket || 'month';
            this.scope = q.scope || 'me';
            this.compareYear = q.compare === 'year';
            this.loadStats();
        },
        async loadUnits() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId });
                const res = await fetchWithAuth(`/api/reg/units?${qs.toString()}`);
                const data = await res.json().catch(() => []);
                this.units = Array.isArray(data) ? data : [];
            } catch (e) {
                this.units = [];
            }
        },
        async saveUnit() {
            const name = String(this.unitForm.name || '').trim();
            if (!name) {
                this.$message.warning(this.$t('reg.unitNameRequired'));
                return;
            }
            this.unitSaving = true;
            try {
                const res = await fetchWithAuth('/api/reg/units', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...this.unitForm, name, instanceId: this.instanceId }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.unitSaved'));
                this.unitForm = { name: '', kind: 'count', baseUnit: '' };
                this.loadUnits();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.unitSaving = false;
            }
        },
        async removeUnit(u) {
            try {
                await this.$confirm(this.$t('reg.unitDeleteConfirm', { name: u.name }), this.$t('common.delete'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/reg/units/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.loadUnits();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            }
        },
        unitKindLabel(kind) {
            const hit = this.unitKinds.find((k) => k.value === kind);
            return hit ? this.$t(hit.label) : kind;
        },
        fmt(v) {
            const n = Number(v);
            if (!Number.isFinite(n)) return '0';
            return Math.abs(n) >= 1000 ? n.toFixed(0) : (Math.round(n * 100) / 100).toString();
        },
        shortKey(k) {
            const s = String(k || '');
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(5);
            if (/^\d{4}-\d{2}$/.test(s)) return s.slice(2);
            return s;
        },
        barHeight(v) {
            const values = this.stats.series.map((b) => Math.abs(Number(b.sum) || 0));
            const max = Math.max(1, ...values);
            const pct = Math.max(2, Math.min(100, (Math.abs(Number(v) || 0) / max) * 100));
            return `${pct}%`;
        },
        ownerWidth(v) {
            const max = Math.max(1, ...this.stats.byOwner.map((o) => Math.abs(Number(o.sum) || 0)));
            return `${Math.max(2, Math.min(100, (Math.abs(Number(v) || 0) / max) * 100))}%`;
        },
    },
};
</script>

<style scoped>
.reg-page {
    box-sizing: border-box;
    min-height: 100vh;
    padding: 16px 18px 40px;
    background: var(--admin-container-bg, var(--el-bg-color-page));
    color: var(--el-text-color-primary);
}

.reg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 14px;
}

.reg-head-left {
    display: flex;
    align-items: center;
    gap: 10px;
}

.reg-head-icon {
    font-size: 18px;
    color: var(--el-color-primary);
}

.reg-head-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
}

.reg-head-right {
    display: flex;
    align-items: center;
    gap: 8px;
}

.reg-stats,
.reg-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.reg-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: var(--glass-bg);
}

.reg-f-marker { width: 190px; }
.reg-f-range { width: 108px; }
.reg-f-bucket { width: 108px; }
.reg-f-scope { width: 128px; }
.reg-f-compare { margin-left: 2px; font-size: 12px; }
.reg-report-select { width: 150px; }

.reg-cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
}

.reg-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: var(--glass-bg);
}

.reg-card-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-card-value {
    font-size: 22px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--el-color-primary);
}

.reg-card-value.is-small {
    font-size: 16px;
}

.reg-card-value em {
    margin-left: 3px;
    font-size: 12px;
    font-style: normal;
    color: var(--el-text-color-secondary);
}

.reg-cards-derive {
    margin-top: 0;
}

.reg-yoy {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    padding: 10px 14px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: var(--glass-bg);
    font-size: 13px;
}

.reg-yoy-icon {
    color: var(--el-color-primary);
}

.reg-yoy em {
    font-style: normal;
    font-weight: 700;
    color: var(--el-color-success);
}

.reg-yoy em.is-up {
    color: var(--el-color-danger);
}

.reg-yoy-sub {
    margin-left: auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-chart-card,
.reg-owner-card {
    padding: 14px 16px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: var(--glass-bg);
}

.reg-chart-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 14px;
}

.reg-chart-title {
    font-size: 14px;
    font-weight: 600;
}

.reg-chart-sub {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-chart {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    height: 190px;
    overflow-x: auto;
    padding-bottom: 4px;
}

.reg-bar-wrap {
    flex: 1 0 42px;
    min-width: 42px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
}

.reg-bar-val {
    font-size: 10px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
}

.reg-bar {
    width: 70%;
    min-height: 3px;
    border-radius: 6px 6px 2px 2px;
    background: linear-gradient(180deg, var(--el-color-primary-light-3), var(--el-color-primary));
    transition: height 0.3s ease;
}

.reg-bar-key {
    font-size: 10.5px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
}

.reg-chart-empty,
.reg-empty {
    padding: 48px 0;
    text-align: center;
    font-size: 13px;
    color: var(--el-text-color-secondary);
}

.reg-chart-legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 12px;
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}

.reg-legend-item em {
    font-style: normal;
    color: var(--el-color-primary);
}

.reg-owner-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.reg-owner-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
}

.reg-owner-name {
    width: 96px;
    flex: 0 0 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.reg-owner-bar {
    flex: 1 1 auto;
    height: 8px;
    border-radius: 999px;
    background: var(--el-fill-color-light);
    overflow: hidden;
}

.reg-owner-bar i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--el-color-primary);
}

.reg-owner-val {
    width: 96px;
    flex: 0 0 auto;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.reg-owner-count {
    width: 42px;
    flex: 0 0 auto;
    text-align: right;
    color: var(--el-text-color-secondary);
}

.reg-tracker-card {
    padding: 14px 16px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: var(--glass-bg);
}

.reg-tracker-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.reg-tracker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 4px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    font-size: 13px;
}

.reg-tracker-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}

.reg-tracker-type,
.reg-tracker-count {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-tracker-count {
    width: 44px;
    text-align: right;
}

.reg-set-add {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 10px;
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    background: var(--glass-bg);
}

.reg-set-name { width: 160px; }
.reg-set-kind { width: 120px; }
.reg-set-base { width: 140px; }
.reg-set-icon { margin-right: 5px; }

.reg-unit-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.reg-unit-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    font-size: 13px;
}

.reg-unit-name {
    flex: 1 1 auto;
    font-weight: 500;
}

.reg-unit-kind,
.reg-unit-base {
    flex: 0 0 auto;
    width: 110px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-unit-del {
    border: 0;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
}

.reg-unit-del:hover {
    color: var(--el-color-danger);
}

@media (max-width: 900px) {
    .reg-cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .reg-f-marker { width: 100%; }

    .reg-unit-kind,
    .reg-unit-base {
        width: 76px;
    }
}
</style>
