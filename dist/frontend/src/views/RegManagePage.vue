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
                    <div class="reg-chart-switch">
                        <button
                            v-for="c in chartTypes"
                            :key="c.value"
                            type="button"
                            class="reg-chart-tab"
                            :class="{ 'is-active': chartType === c.value }"
                            :title="$t(c.label)"
                            @click="chartType = c.value"
                        >
                            <font-awesome-icon :icon="c.icon" />
                        </button>
                    </div>
                </div>
                <div class="reg-chart-sub">{{ chartSub }}</div>
                <div v-if="!chartHasData" class="reg-chart-empty">{{ $t('reg.noData') }}</div>
                <div v-else class="reg-chart-canvas">
                    <component :is="chartKind" :data="chartPayload" :options="chartOptions" />
                </div>
                <div v-if="chartHasData && (chartType === 'bar' || chartType === 'line')" class="reg-chart-legend">
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
            <!--
                v1.3.5.7：条目管理。
                「条目」是登记自己的身份表，这里改的是根源 —— 名称 / 类型 / 单位 / 分母
                一改，所有关联记录按 trackerId 自动跟着变；两条重复条目还能合并。
            -->
            <div class="reg-set-block">
                <div class="reg-set-block-head">
                    <h2 class="reg-set-block-title">{{ $t('reg.itemManage') }}</h2>
                    <span class="reg-set-block-sub">{{ $t('reg.itemManageSub') }}</span>
                </div>
                <div v-if="!trackers.length" class="reg-empty">{{ $t('reg.noItems') }}</div>
                <div v-else class="reg-tracker-list">
                    <div v-for="t in trackers" :key="t.id" class="reg-tracker-row">
                        <span class="reg-tracker-name">{{ t.name }}</span>
                        <span class="reg-tracker-type">{{ $t(typeLabel(t.valueType)) }}</span>
                        <span class="reg-tracker-unit">{{ unitText(t) }}</span>
                        <span class="reg-tracker-count">{{ $t('reg.itemCount', { n: t.count || 0 }) }}</span>
                        <span class="reg-tracker-actions">
                            <button type="button" class="reg-act" :title="$t('common.edit')" @click="openItemEdit(t)">
                                <font-awesome-icon icon="pen" />
                            </button>
                            <button
                                type="button"
                                class="reg-act"
                                :title="$t('reg.mergeItem')"
                                :disabled="trackers.length < 2"
                                @click="openItemMerge(t)"
                            >
                                <font-awesome-icon icon="code-branch" />
                            </button>
                        </span>
                    </div>
                </div>
            </div>

            <div class="reg-set-block">
                <div class="reg-set-block-head">
                    <h2 class="reg-set-block-title">{{ $t('reg.unitTitle') }}</h2>
                    <span class="reg-set-block-sub">{{ $t('reg.unitSub') }}</span>
                </div>
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
            </div>
        </section>

        <!-- 编辑条目 -->
        <el-dialog v-model="itemEditVisible" :title="$t('reg.editItem')" width="420px" append-to-body>
            <div class="reg-item-form">
                <div class="reg-item-field">
                    <span>{{ $t('reg.itemName') }}</span>
                    <el-input v-model="itemForm.name" size="small" maxlength="80" />
                </div>
                <div class="reg-item-field">
                    <span>{{ $t('reg.fieldType') }}</span>
                    <el-select v-model="itemForm.valueType" size="small" class="reg-full">
                        <el-option v-for="t in valueTypes" :key="t.value" :label="$t(t.label)" :value="t.value" />
                    </el-select>
                </div>
                <div class="reg-item-field">
                    <span>{{ $t('reg.fieldUnit') }}</span>
                    <el-input v-model="itemForm.unit" size="small" maxlength="24" />
                </div>
                <div class="reg-item-field">
                    <span>{{ $t('reg.fieldPortion') }}</span>
                    <el-input v-model="itemForm.portion" size="small" maxlength="32" :placeholder="$t('reg.fieldPortionPh')" />
                </div>
            </div>
            <p class="reg-item-tip">{{ $t('reg.itemEditTip') }}</p>
            <template #footer>
                <el-button size="small" @click="itemEditVisible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" :loading="itemSaving" @click="saveItem">{{ $t('common.save') }}</el-button>
            </template>
        </el-dialog>

        <!-- 合并条目 -->
        <el-dialog v-model="itemMergeVisible" :title="$t('reg.mergeItem')" width="440px" append-to-body>
            <p class="reg-item-tip">{{ $t('reg.mergeTip', { name: mergeTarget.name }) }}</p>
            <el-select v-model="mergeSources" multiple filterable class="reg-full" :placeholder="$t('reg.mergePick')">
                <el-option v-for="t in mergeCandidates" :key="t.id" :label="t.name" :value="t.id" />
            </el-select>
            <template #footer>
                <el-button size="small" @click="itemMergeVisible = false">{{ $t('common.cancel') }}</el-button>
                <el-button size="small" type="primary" :loading="itemMerging" @click="doMerge">{{ $t('reg.mergeItem') }}</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script>
import fetchWithAuth from '@/utils/fetchWithAuth';
import { Bar, Doughnut, Line, Radar } from 'vue-chartjs';
import {
    Chart as ChartJS,
    ArcElement,
    BarElement,
    CategoryScale,
    Filler,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    RadialLinearScale,
    Tooltip,
} from 'chart.js';

ChartJS.register(
    ArcElement, BarElement, CategoryScale, Filler, Legend,
    LineElement, LinearScale, PointElement, RadialLinearScale, Tooltip,
);

/** 六种图表共用的配色（与系统状态页同一套色感） */
const REG_CHART_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399', '#14b8a6', '#8b5cf6', '#f97316'];

export default {
    name: 'RegManagePage',
    components: { Bar, Doughnut, Line, Radar },
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
            /* v1.3.5.6：趋势图可切换形态 */
            chartType: 'bar',
            chartTypes: [
                { value: 'bar', label: 'reg.chartBar', icon: 'chart-bar' },
                { value: 'line', label: 'reg.chartLine', icon: 'chart-line' },
                { value: 'doughnut', label: 'reg.chartDonut', icon: 'chart-pie' },
                { value: 'hbar', label: 'reg.chartHBar', icon: 'align-left' },
                { value: 'radar', label: 'reg.chartRadar', icon: 'spider' },
                { value: 'hist', label: 'reg.chartHist', icon: 'chart-area' },
            ],
            compareYear: false,
            reports: [],
            activeReport: '',
            units: [],
            unitSaving: false,
            unitForm: { name: '', kind: 'count', baseUnit: '' },
            /* v1.3.5.7：条目管理 */
            itemEditVisible: false,
            itemSaving: false,
            itemForm: { id: '', name: '', valueType: 'flow', unit: '', portion: '' },
            itemMergeVisible: false,
            itemMerging: false,
            mergeTarget: { id: '', name: '' },
            mergeSources: [],
            valueTypes: [
                { value: 'flow', label: 'reg.typeFlow' },
                { value: 'stock', label: 'reg.typeStock' },
                { value: 'count', label: 'reg.typeCount' },
                { value: 'duration', label: 'reg.typeDuration' },
                { value: 'ratio', label: 'reg.typeRatio' },
                { value: 'price', label: 'reg.typePrice' },
            ],
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
        /** 可合并到当前条目的其它条目 */
        mergeCandidates() {
            const id = this.mergeTarget && this.mergeTarget.id;
            return (this.trackers || []).filter((t) => t.id !== id);
        },
        /** 图表组件映射（hbar / hist 复用 Bar，靠 indexAxis 与数据区分） */
        chartKind() {
            const map = { bar: 'Bar', line: 'Line', doughnut: 'Doughnut', hbar: 'Bar', radar: 'Radar', hist: 'Bar' };
            return map[this.chartType] || 'Bar';
        },
        chartHasData() {
            const st = this.stats || {};
            if (this.chartType === 'doughnut' || this.chartType === 'hbar') return (st.byTracker || []).length > 0;
            if (this.chartType === 'radar') return (st.byWeekday || []).some((d) => Number(d.sum));
            if (this.chartType === 'hist') return (st.histogram || []).length > 0;
            return (st.series || []).length > 0;
        },
        chartSub() {
            const st = this.stats || {};
            if (this.chartType === 'doughnut' || this.chartType === 'hbar') {
                return this.$t('reg.chartSubTracker', { n: (st.byTracker || []).length });
            }
            if (this.chartType === 'radar') return this.$t('reg.chartSubWeekday');
            if (this.chartType === 'hist') return this.$t('reg.chartSubHist', { n: (st.histogram || []).length });
            return this.$t('reg.trendSub', { n: (st.series || []).length });
        },
        chartPayload() {
            const unit = (this.stats && this.stats.unit) || '';
            const label = unit ? this.$t('reg.chartValueUnit', { unit }) : this.$t('reg.chartValue');
            const type = this.chartType;
            const colors = REG_CHART_COLORS;
            if (type === 'doughnut' || type === 'hbar') {
                const rows = (this.stats.byTracker || []).slice(0, 8);
                return {
                    labels: rows.map((r) => r.name),
                    datasets: [{
                        label,
                        data: rows.map((r) => Math.abs(Number(r.sum) || 0)),
                        backgroundColor: type === 'doughnut'
                            ? rows.map((_, i) => colors[i % colors.length])
                            : colors[0],
                        borderWidth: type === 'doughnut' ? 2 : 0,
                        borderColor: 'transparent',
                        borderRadius: type === 'hbar' ? 6 : 0,
                        hoverOffset: type === 'doughnut' ? 6 : 0,
                    }],
                };
            }
            if (type === 'radar') {
                const rows = this.stats.byWeekday || [];
                return {
                    labels: rows.map((r) => this.$t('reg.weekdayShort', { d: r.label })),
                    datasets: [{
                        label,
                        data: rows.map((r) => Number(r.sum) || 0),
                        borderColor: colors[0],
                        backgroundColor: 'rgba(64, 158, 255, 0.18)',
                        pointBackgroundColor: colors[0],
                        borderWidth: 2,
                    }],
                };
            }
            if (type === 'hist') {
                const rows = this.stats.histogram || [];
                return {
                    labels: rows.map((r) => `${this.fmt(r.from)}~${this.fmt(r.to)}`),
                    datasets: [{
                        label: this.$t('reg.chartCount'),
                        data: rows.map((r) => r.count),
                        backgroundColor: colors[5],
                        borderRadius: 4,
                    }],
                };
            }
            const rows = this.stats.series || [];
            return {
                labels: rows.map((r) => this.shortKey(r.key)),
                datasets: [{
                    label,
                    data: rows.map((r) => Number(r.sum) || 0),
                    backgroundColor: type === 'line' ? 'rgba(64, 158, 255, 0.16)' : colors[0],
                    borderColor: colors[0],
                    borderWidth: type === 'line' ? 2 : 0,
                    borderRadius: type === 'line' ? 0 : 4,
                    fill: type === 'line',
                    tension: 0.35,
                    pointRadius: type === 'line' ? 3 : 0,
                    pointBackgroundColor: colors[0],
                }],
            };
        },
        chartOptions() {
            const narrow = typeof window !== 'undefined' && window.innerWidth <= 768;
            const textColor = '#64748B';
            const fontSize = narrow ? 10 : 12;
            const base = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: this.chartType === 'doughnut' || this.chartType === 'line' || this.chartType === 'radar',
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: narrow ? 10 : 14,
                            font: { size: fontSize },
                            color: textColor,
                        },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 10,
                        cornerRadius: 8,
                    },
                },
            };
            if (this.chartType === 'doughnut') {
                return { ...base, cutout: '64%', layout: { padding: 6 } };
            }
            if (this.chartType === 'radar') {
                return {
                    ...base,
                    scales: {
                        r: {
                            beginAtZero: true,
                            grid: { color: 'rgba(148, 163, 184, 0.22)' },
                            angleLines: { color: 'rgba(148, 163, 184, 0.22)' },
                            pointLabels: { color: textColor, font: { size: fontSize } },
                            ticks: { display: false },
                        },
                    },
                };
            }
            const horizontal = this.chartType === 'hbar';
            const categoryAxis = {
                grid: { display: false },
                ticks: { color: textColor, font: { size: fontSize }, autoSkip: true, maxTicksLimit: narrow ? 5 : 8 },
            };
            const valueAxis = {
                beginAtZero: true,
                grid: { color: 'rgba(148, 163, 184, 0.18)' },
                ticks: {
                    color: textColor,
                    font: { size: fontSize },
                    precision: this.chartType === 'hist' ? 0 : undefined,
                },
            };
            return {
                ...base,
                indexAxis: horizontal ? 'y' : 'x',
                interaction: { mode: 'index', intersect: false },
                scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
            };
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
        /** 形态的 i18n key（valueType 存的是枚举，展示要过一层） */
        typeLabel(v) {
            const hit = this.valueTypes.find((t) => t.value === v);
            return hit ? hit.label : 'reg.typeFlow';
        },
        /** 复合单位的展示：单位/分母（分母为空时只显示单位） */
        unitText(t) {
            const unit = String((t && t.unit) || '');
            const portion = String((t && t.portion) || '');
            if (unit && portion) return `${unit}/${portion}`;
            return unit || portion || '—';
        },
        openItemEdit(t) {
            this.itemForm = {
                id: t.id,
                name: t.name || '',
                valueType: t.valueType || 'flow',
                unit: t.unit || '',
                portion: t.portion || '',
            };
            this.itemEditVisible = true;
        },
        async saveItem() {
            const name = String(this.itemForm.name || '').trim();
            if (!name) {
                this.$message.warning(this.$t('reg.itemNameRequired'));
                return;
            }
            this.itemSaving = true;
            try {
                const res = await fetchWithAuth(`/api/reg/trackers/${encodeURIComponent(this.itemForm.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        valueType: this.itemForm.valueType,
                        unit: String(this.itemForm.unit || '').trim(),
                        portion: String(this.itemForm.portion || '').trim(),
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.itemSaved'));
                this.itemEditVisible = false;
                await this.loadTrackers();
                this.loadStats();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.itemSaving = false;
            }
        },
        openItemMerge(t) {
            this.mergeTarget = { id: t.id, name: t.name || '' };
            this.mergeSources = [];
            this.itemMergeVisible = true;
        },
        async doMerge() {
            if (!this.mergeSources.length) {
                this.$message.warning(this.$t('reg.mergePick'));
                return;
            }
            this.itemMerging = true;
            try {
                const res = await fetchWithAuth('/api/reg/trackers/merge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetId: this.mergeTarget.id, sourceIds: this.mergeSources }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.mergeOk', { n: Number(data.moved) || 0 }));
                this.itemMergeVisible = false;
                await this.loadTrackers();
                this.loadStats();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
            } finally {
                this.itemMerging = false;
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

/* v1.3.5.7：设置页分区块 */
.reg-full {
    width: 100%;
}

.reg-full {
    width: 100%;
}

.reg-set-block {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    background: var(--glass-bg);
}

.reg-set-block-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
}

.reg-set-block-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
}

.reg-set-block-sub {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-tracker-list {
    display: flex;
    flex-direction: column;
}

.reg-tracker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 2px;
    border-bottom: 1px dashed var(--el-border-color-lighter);
    font-size: 13px;
}

.reg-tracker-row:last-child {
    border-bottom: 0;
}

.reg-tracker-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}

.reg-tracker-type {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-color-primary);
}

.reg-tracker-unit {
    flex: 0 0 auto;
    min-width: 72px;
    font-size: 12px;
    color: var(--el-text-color-regular);
    font-variant-numeric: tabular-nums;
}

.reg-tracker-count {
    flex: 0 0 auto;
    min-width: 64px;
    text-align: right;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-tracker-actions {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 6px;
}

/* 与流水账页同一套小方块按钮 */
.reg-act {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
}

.reg-act:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
}

.reg-tracker-actions .reg-act:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.reg-item-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.reg-item-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-item-tip {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
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
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
}

/* v1.3.5.6：趋势图形态切换 */
.reg-chart-switch {
    display: flex;
    gap: 4px;
    flex: 0 0 auto;
}

.reg-chart-tab {
    width: 28px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--glass-border);
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.reg-chart-tab:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
}

.reg-chart-tab.is-active {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}

.reg-chart-canvas {
    height: 260px;
    position: relative;
}

@media (max-width: 768px) {
    .reg-chart-canvas {
        height: 220px;
    }
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
