<template>
    <!--
        v1.3.5.8 登记管理（/reg）
        ----------------------------------------------------------------------------
        · 概览卡片：只跟「总范围」（类型 + 条目 + 时间 + 用户口径），图例不影响卡片；
        · 统计图表：横轴 = 时间范围，纵轴 = 数据口径，图例 1~5 = 筛选条件；
        · 设置：条目管理（改名 / 改类型 / 改单位 / 改分母 / 改性质 / 合并 / 删除）与自定义单位。
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
                <div class="reg-head-actions">
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
                    <el-button size="small" :loading="loading" @click="reloadAll">
                        <font-awesome-icon icon="sync" />
                    </el-button>
                </div>
            </div>
        </header>

        <section v-if="tab === 'stats'" class="reg-stats">
            <!--
                v1.3.5.9 总范围：登记类型 + 条目 + 时间段 + 用户。
                类型不再有「全部」（默认第一项「流水」）；条目为空表示全部条目。
            -->
            <div class="reg-filters">
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.typeScope') }}</span>
                    <el-select v-model="typeFilter" size="small" class="reg-f-type" @change="onTypeChange">
                        <el-option v-for="t in valueTypes" :key="t.value" :label="$t(t.label)" :value="t.value" />
                    </el-select>
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.fieldItem') }}</span>
                    <el-select
                        v-model="trackerFilter"
                        size="small"
                        clearable
                        filterable
                        class="reg-f-tracker"
                        :placeholder="$t('reg.allItems')"
                        @change="onTotalRangeChange"
                    >
                        <el-option v-for="t in trackerOptions" :key="t.id" :label="t.name" :value="t.id" />
                    </el-select>
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.rangeLabel') }}</span>
                    <el-date-picker
                        v-model="rangeDates"
                        type="daterange"
                        size="small"
                        unlink-panels
                        class="reg-f-dates"
                        :popper-class="narrow ? 'reg-range-popper--center' : ''"
                        value-format="x"
                        :start-placeholder="$t('reg.axisStart')"
                        :end-placeholder="$t('reg.axisDue')"
                        @change="onTotalRangeChange"
                    />
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.bucketLabel') }}</span>
                    <el-select v-model="bucket" size="small" class="reg-f-bucket" @change="loadStats">
                        <el-option :label="$t('reg.bucketDay')" value="day" />
                        <el-option :label="$t('reg.bucketMonth')" value="month" />
                        <el-option :label="$t('reg.bucketYear')" value="year" />
                    </el-select>
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.scopeLabel') }}</span>
                    <el-select v-model="scope" size="small" class="reg-f-scope" @change="onTotalRangeChange">
                        <el-option :label="$t('reg.scopeMe')" value="me" />
                        <el-option :label="$t('reg.scopeAll')" value="all" />
                    </el-select>
                </div>
                <el-checkbox v-model="compareYear" class="reg-f-compare" @change="loadStats">
                    {{ $t('reg.compareYear') }}
                </el-checkbox>
            </div>

            <!-- v1.3.5.9：纵轴 / 横轴单独一栏（横轴不再挂在图表右上角） -->
            <div class="reg-filters reg-filters-axes">
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.axisYTitle') }}</span>
                    <el-radio-group v-model="axisY" size="small" @change="loadStats">
                        <el-radio-button label="value">{{ $t('reg.axisYValue') }}</el-radio-button>
                        <el-radio-button label="quantity">{{ $t('reg.axisYQuantity') }}</el-radio-button>
                    </el-radio-group>
                </div>
                <div class="reg-f-item is-grow">
                    <span class="reg-f-label">{{ $t('reg.axisTitle') }}</span>
                    <div class="reg-axis-tabs">
                        <button
                            v-for="a in axisOptions"
                            :key="a.value"
                            type="button"
                            class="reg-axis-tab"
                            :class="{ 'is-active': axisX === a.value }"
                            @click="setAxisX(a.value)"
                        >
                            {{ $t(a.label) }}
                        </button>
                    </div>
                </div>
            </div>

            <div class="reg-cards">
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statTotal') }}</span>
                    <span class="reg-card-value">{{ fmt(stats.total) }}<em>{{ metricUnit }}</em></span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statCountQty') }}</span>
                    <span class="reg-card-value"><em class="is-lead">{{ stats.count }}</em> / {{ fmt(stats.quantity) }}</span>
                </div>
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statAvg') }}</span>
                    <span class="reg-card-value">{{ fmt(stats.avg) }}<em>{{ metricUnit }}</em></span>
                </div>
                <!-- v1.3.5.9：单价卡片挪到「平均」后面 -->
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.deriveUnitPrice') }}</span>
                    <span class="reg-card-value is-small">
                        {{ !stats.derive || stats.derive.unitPrice === null ? '—' : fmt(stats.derive.unitPrice) }}
                        <em v-if="stats.derive && stats.derive.unitPrice !== null">{{ metricUnit }}</em>
                    </span>
                </div>
            </div>

            <div v-if="stats.derive" class="reg-cards reg-cards-derive">
                <div class="reg-card">
                    <span class="reg-card-label">{{ $t('reg.statMaxMin') }}</span>
                    <span class="reg-card-value is-small">{{ fmt(stats.max) }} / {{ fmt(stats.min) }}</span>
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
                    <span class="reg-card-value is-small">{{ fmt(balanceLast) }}<em>{{ metricUnit }}</em></span>
                </div>
            </div>

            <div v-if="stats.compare" class="reg-yoy">
                <font-awesome-icon icon="chart-line" class="reg-yoy-icon" />
                <span>{{ $t('reg.yoyTitle') }}：{{ fmt(stats.compare.total) }} {{ metricUnit }}</span>
                <em v-if="stats.compare.pct !== null" :class="{ 'is-up': stats.compare.pct >= 0 }">
                    {{ stats.compare.pct >= 0 ? '+' : '' }}{{ stats.compare.pct.toFixed(1) }}%
                </em>
                <span class="reg-yoy-sub">{{ $t('reg.yoySub', { n: stats.compare.count }) }}</span>
            </div>

            <div class="reg-chart-card">
                <div class="reg-chart-head">
                    <span class="reg-chart-title">{{ $t('reg.trendTitle') }}</span>
                </div>

                <div class="reg-chart-tools">
                    <span class="reg-chart-sub">{{ chartSub }}</span>
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

                <!-- 图例项设置：每条图例 = 一组筛选条件 -->
                <div class="reg-legend-box">
                    <div class="reg-legend-head">
                        <button type="button" class="reg-legend-toggle" @click="legendOpen = !legendOpen">
                            <font-awesome-icon icon="sliders-h" class="reg-legend-toggle-icon" />
                            <span>{{ $t('reg.legendTitle') }}</span>
                            <em v-if="legends.length">{{ legendSummary }}</em>
                        </button>
                        <span class="reg-legend-sub">{{ $t('reg.legendSub') }}；{{ $t('reg.legend1Rule') }}</span>
                    </div>
                    <template v-if="legendOpen">
                    <div v-for="(lg, i) in legends" :key="'lg' + i" class="reg-legend-row">
                        <span class="reg-legend-idx" :class="{ 'is-first': i === 0 }">
                            {{ $t('reg.seriesName', { n: i + 1 }) }}
                        </span>
                        <div class="reg-legend-field is-wide">
                            <span class="reg-legend-label">{{ $t('reg.fieldItem') }}</span>
                            <el-select
                                v-model="lg.trackerId"
                                size="small"
                                filterable
                                clearable
                                :disabled="i > 0 && !firstLegendTrackerId"
                                :placeholder="i > 0 && !firstLegendTrackerId ? $t('reg.legendNeedItem') : $t('reg.legendItemPh')"
                                @change="onLegendTracker(i)"
                            >
                                <el-option v-for="t in legendTrackers(i)" :key="t.id" :label="t.name" :value="t.id" />
                            </el-select>
                        </div>
                        <div class="reg-legend-field">
                            <span class="reg-legend-label">{{ $t('reg.fieldSubject') }}</span>
                            <el-select
                                v-model="lg.subjectName"
                                size="small"
                                filterable
                                clearable
                                :disabled="!lg.trackerId"
                                :placeholder="$t('reg.legendSubjectPh')"
                                @change="loadStats"
                            >
                                <el-option v-for="v in legendOpts(i).subjects" :key="v" :label="v" :value="v" />
                            </el-select>
                        </div>
                        <div class="reg-legend-field">
                            <span class="reg-legend-label">{{ $t('reg.fieldRelated') }}</span>
                            <el-select
                                v-model="lg.relatedName"
                                size="small"
                                filterable
                                clearable
                                :disabled="!lg.trackerId"
                                :placeholder="$t('reg.legendRelatedPh')"
                                @change="loadStats"
                            >
                                <el-option v-for="v in legendOpts(i).related" :key="v" :label="v" :value="v" />
                            </el-select>
                        </div>
                        <!-- v1.3.5.9：地点挪到关联人后面 -->
                        <div class="reg-legend-field">
                            <span class="reg-legend-label">{{ $t('reg.fieldPlace') }}</span>
                            <el-select
                                v-model="lg.placeName"
                                size="small"
                                filterable
                                clearable
                                :disabled="!lg.trackerId"
                                :placeholder="$t('reg.legendPlacePh')"
                                @change="loadStats"
                            >
                                <el-option v-for="v in legendOpts(i).places" :key="v" :label="v" :value="v" />
                            </el-select>
                        </div>
                        <div class="reg-legend-field is-wide">
                            <span class="reg-legend-label">{{ $t('reg.fieldTags') }}</span>
                            <el-select
                                v-model="lg.tags"
                                size="small"
                                multiple
                                filterable
                                collapse-tags
                                collapse-tags-tooltip
                                :disabled="!lg.trackerId"
                                :placeholder="$t('reg.legendTagsPh')"
                                @change="loadStats"
                            >
                                <el-option v-for="v in legendOpts(i).tags" :key="v" :label="v" :value="v" />
                            </el-select>
                        </div>
                        <!-- v1.3.5.9：图例 1 是默认加载项，不可删除 -->
                        <button
                            v-if="i > 0"
                            type="button"
                            class="reg-legend-del"
                            :title="$t('common.delete')"
                            @click="removeLegend(i)"
                        >
                            <font-awesome-icon icon="trash" />
                        </button>
                        <span v-else class="reg-legend-del is-locked" :title="$t('reg.legendFirstLocked')">
                            <font-awesome-icon icon="lock" />
                        </span>
                    </div>
                    <div class="reg-legend-foot">
                        <button
                            type="button"
                            class="reg-legend-add"
                            :disabled="legends.length >= 5"
                            @click="addLegend"
                        >
                            <font-awesome-icon icon="plus" />{{ $t('reg.legendAdd') }}
                        </button>
                        <span v-if="legends.length >= 5" class="reg-legend-max">{{ $t('reg.legendMax') }}</span>
                        <span v-else-if="!firstLegendTrackerId" class="reg-legend-max">{{ $t('reg.noLegendHint') }}</span>
                    </div>
                    </template>
                </div>

                <div v-if="!chartHasData" class="reg-chart-empty">{{ $t('reg.noData') }}</div>
                <div v-else class="reg-chart-scroll">
                    <div class="reg-chart-canvas" :style="chartCanvasStyle">
                        <component :is="chartKind" :data="chartPayload" :options="chartOptions" />
                    </div>
                </div>

                <!-- 图例条件：tooltip 之外再给出完整条件，避免只看「项1」猜不到是什么 -->
                <div v-if="chartHasData && chartConditions.length" class="reg-legend-conds">
                    <span v-for="(c, i) in chartConditions" :key="'c' + i" class="reg-legend-cond">
                        <i class="reg-cond-dot" :style="{ background: chartColor(i) }"></i>{{ c }}
                    </span>
                </div>

                <div v-if="chartHasData && (chartType === 'bar' || chartType === 'line')" class="reg-chart-legend">
                    <span v-for="b in chartDiffRows" :key="'d' + b.key" class="reg-legend-item">
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
                        <span class="reg-owner-val">{{ fmt(o.sum) }}{{ metricUnit }}</span>
                        <span class="reg-owner-count">{{ o.count }}</span>
                    </div>
                </div>
            </div>
        </section>

        <section v-else class="reg-settings">
            <!--
                v1.3.5.7：条目管理。
                「条目」是登记自己的身份表，这里改的是根源 —— 名称 / 类型 / 单位 / 分母
                一改，所有关联记录按 trackerId 自动跟着变；两条口径相同的条目还能合并。
                v1.3.5.9：「性质」已改为每条登记自己的字段，不再在条目里维护。
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
                                <font-awesome-icon icon="pen-to-square" />
                            </button>
                            <button
                                type="button"
                                class="reg-act"
                                :title="$t('reg.mergeItem')"
                                :disabled="!mergeCandidatesFor(t).length"
                                @click="openItemMerge(t)"
                            >
                                <font-awesome-icon icon="code-branch" />
                            </button>
                            <button
                                type="button"
                                class="reg-act is-danger"
                                :title="$t('reg.itemDelete')"
                                :disabled="Number(t.count) > 0"
                                @click="removeItem(t)"
                            >
                                <font-awesome-icon icon="trash" />
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
            <p class="reg-item-tip is-muted">{{ $t('reg.mergeOnlySame') }} · {{ $t('reg.mergeMismatch') }}</p>
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

/** 多系列配色（与系统状态页同一套色感） */
const REG_CHART_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#8b5cf6', '#14b8a6', '#f97316', '#909399'];

const emptyLegend = () => ({
    trackerId: '',
    placeName: '',
    subjectName: '',
    relatedName: '',
    tags: [],
});

const emptyLegendOpts = () => ({ places: [], subjects: [], related: [], tags: [] });

export default {
    name: 'RegManagePage',
    components: { Bar, Doughnut, Line, Radar },
    data() {
        return {
            tab: 'stats',
            loading: false,
            trackers: [],
            /* 总范围：类型（默认流水，不再有「全部」）+ 条目（空 = 全部条目） */
            typeFilter: 'flow',
            trackerFilter: '',
            rangeDates: null,
            scope: 'me',
            bucket: 'day',
            /* 轴与图例 */
            axisX: 'occurredAt',
            axisY: 'value',
            axisOptions: [
                { value: 'occurredAt', label: 'reg.axisOccurred' },
                { value: 'startAt', label: 'reg.axisStart' },
                { value: 'dueAt', label: 'reg.axisDue' },
                { value: 'createdAt', label: 'reg.axisCreated' },
            ],
            legends: [emptyLegend()],
            legendOptions: [emptyLegendOpts()],
            stats: {
                total: 0, count: 0, quantity: 0, avg: 0, max: 0, min: 0,
                series: [], byOwner: [], byTracker: [], byWeekday: [], histogram: [],
                unit: '', portion: '', currency: 'CNY',
                axisX: 'occurredAt', axisY: 'value',
                derive: null, compare: null,
                chart: { labels: [], datasets: [] },
            },
            /* 趋势图可切换形态 */
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
            /* 条目管理 */
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
            /* 图例设置面板：移动端默认收起，避免图表被挤到首屏之外 */
            legendOpen: true,
            /* 图表容器实际宽度（用于移动端横向滚动时算画布宽度） */
            chartBoxWidth: 0,
            narrow: false,
        };
    },
    computed: {
        /** 结存累计的最后一桶（派生指标卡片用） */
        balanceLast() {
            const arr = (this.stats.derive && this.stats.derive.balance) || [];
            return arr.length ? arr[arr.length - 1].value : 0;
        },
        /** 总范围里的条目候选（按当前类型收窄） */
        trackerOptions() {
            return (this.trackers || []).filter(
                (t) => !this.typeFilter || this.typeFilter === 'all' || t.valueType === this.typeFilter,
            );
        },
        /** 总范围选中的条目（决定图例 1 的候选口径） */
        totalTracker() {
            return (this.trackers || []).find((t) => t.id === this.trackerFilter) || null;
        },
        /** 图例 1 选中的条目（图例 2~5 的候选靠它收窄） */
        firstLegendTrackerId() {
            return String((this.legends[0] && this.legends[0].trackerId) || '');
        },
        firstLegendTracker() {
            return this.trackers.find((t) => t.id === this.firstLegendTrackerId) || null;
        },
        /** 纵轴单位：数值带「单位/分母」，份量本身没有单位 */
        metricUnit() {
            if (this.axisY === 'quantity') return '';
            const unit = String(this.stats.unit || '');
            const portion = String(this.stats.portion || '');
            if (unit && portion) return `${unit}/${portion}`;
            return unit;
        },
        mergeCandidates() {
            const t = this.mergeTarget && this.trackers.find((x) => x.id === this.mergeTarget.id);
            return t ? this.mergeCandidatesFor(t) : [];
        },
        chartKind() {
            const map = { bar: 'Bar', line: 'Line', doughnut: 'Doughnut', hbar: 'Bar', radar: 'Radar', hist: 'Bar' };
            return map[this.chartType] || 'Bar';
        },
        isSeriesChart() {
            return this.chartType === 'bar' || this.chartType === 'line';
        },
        /** 图表口径的单位（来自第 1 条图例的条目，卡片单位另算） */
        chartUnit() {
            const ch = this.stats.chart || {};
            const unit = String(ch.unit || '');
            const portion = String(ch.portion || '');
            if (unit && portion) return `${unit}/${portion}`;
            return unit;
        },
        /** 折叠状态下的一行摘要：项1 / 项2 … */
        legendSummary() {
            const n = this.legends.length;
            return this.legends.some((lg) => lg.trackerId)
                ? this.$t('reg.legendSummaryOn', { n })
                : this.$t('reg.legendSummaryOff');
        },
        /**
         * 图表下方那条「与上一桶的差值」。
         * 以前读 stats.series（按发生时间 + 全部记录），现在必须跟图表同一份数据，
         * 否则设了图例后两边对不上（图表只有 1 个桶、下面却列 3 个桶）。
         */
        chartDiffRows() {
            const ch = this.stats.chart || { labels: [], datasets: [] };
            const labels = ch.labels || [];
            const sets = ch.datasets || [];
            const sums = labels.map((_, i) => sets.reduce((s, d) => s + (Number(d.data[i]) || 0), 0));
            return labels
                .map((k, i) => {
                    const prev = i > 0 ? sums[i - 1] : null;
                    return {
                        key: k,
                        sum: sums[i],
                        diff: prev === null ? undefined : sums[i] - prev,
                        pct: prev ? ((sums[i] - prev) / Math.abs(prev)) * 100 : null,
                    };
                })
                .slice(-3);
        },
        /** 图例条件（悬停 tooltip 之外再列一遍，避免只看「项1」猜不到） */
        chartConditions() {
            if (!this.isSeriesChart) return [];
            const ds = (this.stats.chart && this.stats.chart.datasets) || [];
            return ds.map((d) => `${d.name}：${d.condition}`);
        },
        chartHasData() {
            const st = this.stats || {};
            if (this.isSeriesChart) {
                const ch = st.chart || {};
                const sets = ch.datasets || [];
                /* 有标签但一条数据都没有时也算空（例如横轴切到「起始时间」而记录都没填） */
                return sets.length > 0 && sets.some((d) => Number(d.count) > 0);
            }
            if (this.chartType === 'doughnut' || this.chartType === 'hbar') return (st.byTracker || []).length > 0;
            if (this.chartType === 'radar') return (st.byWeekday || []).some((d) => Number(d.sum));
            if (this.chartType === 'hist') return (st.histogram || []).length > 0;
            return (st.series || []).length > 0;
        },
        chartSub() {
            const st = this.stats || {};
            const axisLabel = this.$t((this.axisOptions.find((a) => a.value === this.axisX) || this.axisOptions[0]).label);
            const hint = this.$t('reg.axisXHint', { field: axisLabel });
            if (!this.isSeriesChart) return hint;
            const n = ((st.chart && st.chart.labels) || []).length;
            return `${hint} · ${this.$t('reg.trendSub', { n })}`;
        },
        chartCanvasStyle() {
            if (!this.isSeriesChart) return {};
            const labels = (this.stats.chart && this.stats.chart.labels) || [];
            const series = ((this.stats.chart && this.stats.chart.datasets) || []).length || 1;
            const per = this.narrow
                ? Math.max(52, series * 14 + 20)
                : Math.max(34, series * 12 + 16);
            const need = Math.max(1, labels.length) * per;
            const base = this.chartBoxWidth || (this.narrow ? 300 : 720);
            const width = Math.max(base, Math.min(8000, need));
            return { width: `${width}px` };
        },
        chartPayload() {
            const unit = this.chartUnit;
            const tag = unit ? `（${unit}）` : '';
            const valueLabel = this.$t(this.axisY === 'quantity' ? 'reg.axisYQuantity' : 'reg.axisYValue') + tag;
            const type = this.chartType;
            const colors = REG_CHART_COLORS;
            if (type === 'doughnut' || type === 'hbar') {
                const rows = (this.stats.byTracker || []).slice(0, 8);
                return {
                    labels: rows.map((r) => r.name),
                    datasets: [{
                        label: valueLabel,
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
                        label: valueLabel,
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
            /* 柱形 / 折线：多图例多系列 */
            const chart = this.stats.chart || { labels: [], datasets: [] };
            const datasets = (chart.datasets || []).map((d, i) => {
                const color = colors[i % colors.length];
                const base = {
                    label: d.name,
                    /* 自定义字段：tooltip 里拼完整条件用 */
                    condition: d.condition,
                    data: d.data,
                };
                if (type === 'line') {
                    return {
                        ...base,
                        borderColor: color,
                        backgroundColor: color,
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 2,
                        pointHoverRadius: 4,
                        pointBackgroundColor: color,
                    };
                }
                return {
                    ...base,
                    backgroundColor: color,
                    hoverBackgroundColor: color,
                    borderRadius: 3,
                    borderWidth: 0,
                    /* 多系列时柱子细一点，避免挤成一团 */
                    barPercentage: 0.72,
                    categoryPercentage: 0.7,
                    maxBarThickness: (this.stats.chart.datasets || []).length > 1 ? 16 : 30,
                };
            });
            return {
                labels: (chart.labels || []).map((k) => this.shortKey(k)),
                datasets,
            };
        },
        chartOptions() {
            const textColor = '#64748B';
            const fontSize = this.narrow ? 10 : 12;
            const unit = this.metricUnit;
            const base = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: this.chartType === 'doughnut' || this.isSeriesChart || this.chartType === 'radar',
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: this.narrow ? 10 : 14,
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
                        displayColors: true,
                        callbacks: this.isSeriesChart
                            ? {
                                /* v1.3.5.8：tooltip 里给出完整筛选条件（语文考试成绩 · 发生人=小红） */
                                label: (ctx) => {
                                    const raw = ctx.parsed && ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.raw;
                                    const v = Number(raw) || 0;
                                    const cond = ctx.dataset && ctx.dataset.condition ? ` · ${ctx.dataset.condition}` : '';
                                    return ` ${ctx.dataset.label}${cond}：${this.fmt(v)}${unit ? ` ${unit}` : ''}`;
                                },
                            }
                            : {},
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
                /* 折线图默认把点贴在绘图区边缘，只有一个时间桶时会挤在最左侧；
                   加 offset 让每个桶都占一条"带"，柱形与折线的位置也一致 */
                offset: true,
                grid: { display: false },
                ticks: {
                    color: textColor,
                    font: { size: fontSize },
                    autoSkip: this.isSeriesChart ? false : true,
                    maxTicksLimit: this.isSeriesChart ? undefined : (this.narrow ? 5 : 8),
                },
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
        this.syncNarrow();
        this.legendOpen = !this.narrow;
        window.addEventListener('resize', this.onResize);
        this.loadTrackers();
        this.loadStats();
        this.loadUnits();
        this.loadReports();
        this.$nextTick(this.measureChartBox);
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.onResize);
    },
    methods: {
        syncNarrow() {
            this.narrow = typeof window !== 'undefined' && window.innerWidth <= 768;
        },
        onResize() {
            this.syncNarrow();
            this.measureChartBox();
        },
        measureChartBox() {
            const el = this.$el && this.$el.querySelector ? this.$el.querySelector('.reg-chart-scroll') : null;
            if (el) this.chartBoxWidth = el.clientWidth || 0;
        },
        reloadAll() {
            this.loadTrackers();
            this.loadStats();
        },
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
        /* ── 条目管理 ─────────────────────────────────────────── */
        typeLabel(v) {
            const hit = this.valueTypes.find((t) => t.value === v);
            return hit ? hit.label : 'reg.typeFlow';
        },
        unitText(t) {
            const unit = String((t && t.unit) || '');
            const portion = String((t && t.portion) || '');
            if (unit && portion) return `${unit}/${portion}`;
            return unit || portion || '—';
        },
        /** 可合并到 t 的条目：类型 / 单位 / 分母完全一致（性质不参与） */
        mergeCandidatesFor(t) {
            if (!t) return [];
            return (this.trackers || []).filter((x) => x.id !== t.id
                && String(x.valueType || '') === String(t.valueType || '')
                && String(x.unit || '') === String(t.unit || '')
                && String(x.portion || '') === String(t.portion || ''));
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
        async removeItem(t) {
            if (Number(t.count) > 0) {
                this.$message.warning(this.$t('reg.itemDeleteBlocked'));
                return;
            }
            try {
                await this.$confirm(this.$t('reg.itemDeleteConfirm', { name: t.name }), this.$t('reg.itemDelete'), {
                    type: 'warning',
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                });
            } catch (e) {
                return;
            }
            try {
                const res = await fetchWithAuth(`/api/reg/trackers/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.message || this.$t('common.failed'));
                this.$message.success(this.$t('reg.deleteOk'));
                await this.loadTrackers();
                this.loadStats();
            } catch (e) {
                this.$message.error(e.message || this.$t('common.failed'));
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
        /* ── 横轴 / 图例 ──────────────────────────────────────── */
        /** 类型变了：总范围里的条目、以及不兼容的图例 1 都要清掉 */
        onTypeChange() {
            const still = this.trackerOptions.some((t) => t.id === this.trackerFilter);
            if (!still) this.trackerFilter = '';
            const lg1 = this.legends[0];
            if (lg1 && lg1.trackerId) {
                const ok = this.legendTrackers(0).some((t) => t.id === lg1.trackerId);
                if (!ok) this.clearLegend(0);
            }
            this.onTotalRangeChange();
        },
        setAxisX(v) {
            if (this.axisX === v) return;
            this.axisX = v;
            /* 横轴变了，图例的候选值也要按新字段的时间范围重取 */
            this.refreshAllLegendOptions();
            this.loadStats();
        },
        /**
         * 图例 i 的条目候选（v1.3.5.9）：
         *   图例 1 —— 跟着「总范围」的条目走：选了条目就只列「单位 + 分母」一致的，
         *             没选就是该类型下的全部条目；
         *   图例 2~5 —— 只列与图例 1「单位 + 分母」一致的条目。
         */
        legendTrackers(i) {
            const list = (this.trackers || []).filter(
                (t) => !this.typeFilter || this.typeFilter === 'all' || t.valueType === this.typeFilter,
            );
            const sameUnit = (base) => list.filter((t) => String(t.unit || '') === String(base.unit || '')
                && String(t.portion || '') === String(base.portion || ''));
            if (i === 0) {
                const base = this.totalTracker;
                return base ? sameUnit(base) : list;
            }
            const first = this.firstLegendTracker;
            if (!first) return [];
            return sameUnit(first);
        },
        legendOpts(i) {
            return this.legendOptions[i] || emptyLegendOpts();
        },
        addLegend() {
            if (this.legends.length >= 5) {
                this.$message.warning(this.$t('reg.legendMax'));
                return;
            }
            this.legends.push(emptyLegend());
            this.legendOptions.push(emptyLegendOpts());
        },
        /** 清空某条图例的筛选条件（不动其它行） */
        clearLegend(i) {
            const lg = this.legends[i];
            if (!lg) return;
            lg.trackerId = '';
            lg.placeName = '';
            lg.subjectName = '';
            lg.relatedName = '';
            lg.tags = [];
            this.legendOptions[i] = emptyLegendOpts();
        },
        removeLegend(i) {
            /* v1.3.5.9：图例 1 是默认加载项，不允许删 */
            if (i === 0 || this.legends.length <= 1) return;
            this.legends.splice(i, 1);
            this.legendOptions.splice(i, 1);
            this.loadStats();
        },
        onLegendTracker(i) {
            const lg = this.legends[i];
            lg.placeName = '';
            lg.subjectName = '';
            lg.relatedName = '';
            lg.tags = [];
            this.legendOptions[i] = emptyLegendOpts();
            if (i === 0) {
                /* 第 1 条换了口径，2~5 里不兼容的条目要清掉 */
                const first = this.firstLegendTracker;
                for (let k = 1; k < this.legends.length; k += 1) {
                    const id = this.legends[k].trackerId;
                    if (!id) continue;
                    const hit = this.trackers.find((t) => t.id === id);
                    const ok = first && hit
                        && String(hit.unit || '') === String(first.unit || '')
                        && String(hit.portion || '') === String(first.portion || '');
                    if (!ok) this.clearLegend(k);
                }
            }
            if (lg.trackerId) this.loadLegendOptions(i);
            this.loadStats();
        },
        async loadLegendOptions(i) {
            const lg = this.legends[i];
            if (!lg || !lg.trackerId) {
                this.legendOptions[i] = emptyLegendOpts();
                return;
            }
            try {
                const qs = new URLSearchParams({
                    instanceId: this.instanceId,
                    scope: this.scope,
                    trackerId: lg.trackerId,
                    axisX: this.axisX,
                });
                const rq = this.rangeQuery();
                if (rq.from) qs.set('from', String(rq.from));
                if (rq.to) qs.set('to', String(rq.to));
                const res = await fetchWithAuth(`/api/reg/legend-options?${qs.toString()}`);
                const data = await res.json().catch(() => null);
                if (data) {
                    this.legendOptions[i] = {
                        places: Array.isArray(data.places) ? data.places : [],
                        subjects: Array.isArray(data.subjects) ? data.subjects : [],
                        related: Array.isArray(data.related) ? data.related : [],
                        tags: Array.isArray(data.tags) ? data.tags : [],
                    };
                }
            } catch (e) {
                /* 候选失败不阻断图表 */
            }
        },
        refreshAllLegendOptions() {
            this.legends.forEach((lg, i) => {
                if (lg.trackerId) this.loadLegendOptions(i);
            });
        },
        /* ── 查询 ─────────────────────────────────────────────── */
        rangeQuery() {
            const arr = this.rangeDates;
            if (!Array.isArray(arr) || !arr.length) return {};
            const from = Number(arr[0]);
            const toRaw = Number(arr[1]);
            if (!Number.isFinite(from) || !Number.isFinite(toRaw)) return {};
            const to = new Date(toRaw);
            to.setHours(23, 59, 59, 999);
            return { from, to: to.getTime() };
        },
        onTotalRangeChange() {
            this.refreshAllLegendOptions();
            this.loadStats();
        },
        legendQuery() {
            return this.legends
                .filter((lg) => lg.trackerId)
                .map((lg) => ({
                    trackerId: lg.trackerId,
                    placeName: String(lg.placeName || ''),
                    subjectName: String(lg.subjectName || ''),
                    relatedName: String(lg.relatedName || ''),
                    tags: Array.isArray(lg.tags) ? lg.tags.filter(Boolean) : [],
                }));
        },
        async loadStats() {
            this.loading = true;
            try {
                const qs = new URLSearchParams({
                    instanceId: this.instanceId,
                    scope: this.scope,
                    bucket: this.bucket,
                    axisX: this.axisX,
                    axisY: this.axisY,
                });
                if (this.typeFilter && this.typeFilter !== 'all') qs.set('type', this.typeFilter);
                if (this.trackerFilter) qs.set('trackerId', this.trackerFilter);
                if (this.compareYear) qs.set('compare', 'year');
                const lg = this.legendQuery();
                if (lg.length) qs.set('legends', JSON.stringify(lg));
                const rq = this.rangeQuery();
                if (rq.from) qs.set('from', String(rq.from));
                if (rq.to) qs.set('to', String(rq.to));
                const res = await fetchWithAuth(`/api/reg/stats?${qs.toString()}`);
                const data = await res.json().catch(() => null);
                if (data) {
                    this.stats = {
                        ...this.stats,
                        ...data,
                        chart: data.chart || { labels: [], datasets: [] },
                        byTracker: data.byTracker || [],
                        byWeekday: data.byWeekday || [],
                        histogram: data.histogram || [],
                        byOwner: data.byOwner || [],
                        series: data.series || [],
                    };
                }
            } catch (e) {
                /* 失败保留上一次结果 */
            } finally {
                this.loading = false;
                this.$nextTick(this.measureChartBox);
            }
        },
        /* ── 报表 ─────────────────────────────────────────────── */
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
            const rq = this.rangeQuery();
            return {
                type: this.typeFilter === 'all' ? '' : this.typeFilter,
                trackerId: this.trackerFilter || '',
                from: rq.from || null,
                to: rq.to || null,
                bucket: this.bucket,
                scope: this.scope,
                axisX: this.axisX,
                axisY: this.axisY,
                legends: this.legendQuery(),
                compare: this.compareYear ? 'year' : '',
                /* 兼容 v1.3.5.7 及更早保存的报表 */
                trackerName: '',
                range: 'all',
            };
        },
        async saveCurrentReport() {
            let name = '';
            try {
                const r = await this.$prompt(this.$t('reg.reportNameTip'), this.$t('reg.saveReport'), {
                    confirmButtonText: this.$t('common.confirm'),
                    cancelButtonText: this.$t('common.cancel'),
                    inputValue: this.stats.unit || this.$t('reg.defaultReportName'),
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
            this.typeFilter = q.type || 'flow';
            this.trackerFilter = String(q.trackerId || '');
            this.bucket = ['day', 'month', 'year'].includes(q.bucket) ? q.bucket : 'day';
            this.scope = q.scope === 'all' ? 'all' : 'me';
            this.axisX = ['occurredAt', 'startAt', 'dueAt', 'createdAt'].includes(q.axisX) ? q.axisX : 'occurredAt';
            this.axisY = q.axisY === 'quantity' ? 'quantity' : 'value';
            this.compareYear = q.compare === 'year';
            if (q.from && q.to) this.rangeDates = [Number(q.from), Number(q.to)];
            else this.rangeDates = null;
            const lgs = Array.isArray(q.legends) ? q.legends : [];
            this.legends = lgs.length
                ? lgs.slice(0, 5).map((x) => ({
                    trackerId: String(x.trackerId || ''),
                    placeName: String(x.placeName || ''),
                    subjectName: String(x.subjectName || ''),
                    relatedName: String(x.relatedName || ''),
                    tags: Array.isArray(x.tags) ? x.tags.slice() : [],
                }))
                : [emptyLegend()];
            this.legendOptions = this.legends.map(() => emptyLegendOpts());
            this.refreshAllLegendOptions();
            this.loadStats();
        },
        /* ── 单位 ─────────────────────────────────────────────── */
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
        /* ── 小工具 ───────────────────────────────────────────── */
        chartColor(i) {
            return REG_CHART_COLORS[i % REG_CHART_COLORS.length];
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
    /* 外层容器（后台布局）是居中对齐的，列表行必须显式回到左对齐 */
    text-align: left;
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
    min-width: 0;
}

.reg-head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
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

.reg-f-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
}

/* v1.3.5.9：每组「名称 + 控件」，换行时整组一起走 */
.reg-f-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 0;
}

.reg-f-item.is-grow {
    flex: 1 1 240px;
    min-width: 0;
}

.reg-f-type { width: 128px; }
.reg-f-tracker { width: 168px; }
.reg-f-dates { width: 262px; }
.reg-f-bucket { width: 92px; }
.reg-f-scope { width: 110px; }
.reg-f-compare { margin-left: 2px; font-size: 12px; }
.reg-report-select { width: 150px; }

/* 坐标设置栏：与总范围栏同款卡片，略矮一点 */
.reg-filters-axes {
    padding-top: 10px;
    padding-bottom: 10px;
}

/* v1.3.5.7：设置页分区块 */
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
    padding: 8px 4px;
    border-bottom: 1px solid var(--el-border-color-lighter);
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

.reg-tracker-actions .reg-act.is-danger:hover {
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
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

.reg-item-tip.is-muted {
    margin-top: 4px;
    color: var(--el-text-color-placeholder);
}

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

/* 「条数 / 份量」里的条数是主值，别被 em 的小字号压下去 */
.reg-card-value em.is-lead {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    color: var(--el-color-primary);
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
    margin-bottom: 8px;
}

.reg-chart-title {
    font-size: 14px;
    font-weight: 600;
    flex: 0 0 auto;
}

/* v1.3.5.9：横轴四项放在「坐标设置」栏里（移动端仍可横向滑动） */
.reg-axis-tabs {
    display: flex;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
}

.reg-axis-tabs::-webkit-scrollbar {
    display: none;
}

.reg-axis-tab {
    flex: 0 0 auto;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--glass-border);
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.reg-axis-tab:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
}

.reg-axis-tab.is-active {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}

.reg-chart-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
}

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

/* ── 图例项设置 ── */
.reg-legend-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    margin-bottom: 12px;
    border: 1px dashed var(--el-border-color);
    border-radius: 10px;
    background: var(--el-fill-color-lighter);
}

.reg-legend-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
}

.reg-legend-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--el-text-color-primary);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
}

.reg-legend-toggle-icon {
    font-size: 12px;
    color: var(--el-color-primary);
}

.reg-legend-toggle em {
    font-style: normal;
    font-weight: 400;
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}

.reg-legend-sub {
    flex: 1 1 240px;
    min-width: 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}

.reg-legend-row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr) 26px;
    align-items: center;
    gap: 6px;
}

.reg-legend-idx {
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-align: center;
}

.reg-legend-idx.is-first {
    color: var(--el-color-primary);
}

.reg-legend-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

/*
 * v1.3.5.9：桌面端在选择框上方显示字段名；
 * 移动端去掉这行名称（名称改由选择框自己的占位文案承担）。
 */
.reg-legend-label {
    display: block;
    font-size: 11px;
    color: var(--el-text-color-secondary);
}

.reg-legend-del {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--glass-border);
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-secondary);
    cursor: pointer;
}

.reg-legend-del.is-locked {
    opacity: 0.45;
    cursor: default;
    border-style: dashed;
}

.reg-legend-del:hover {
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
}

.reg-legend-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.reg-legend-add {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border: 1px dashed var(--el-border-color);
    border-radius: 7px;
    background: transparent;
    color: var(--el-text-color-regular);
    font-size: 12px;
    cursor: pointer;
}

.reg-legend-add:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
}

.reg-legend-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.reg-legend-max {
    font-size: 11.5px;
    color: var(--el-text-color-placeholder);
}

/* 移动端：图表横向滚动查看 */
.reg-chart-scroll {
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
}

.reg-chart-canvas {
    height: 260px;
    position: relative;
}

.reg-chart-scroll .reg-chart-canvas {
    min-width: 100%;
}

.reg-chart-sub {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}

.reg-legend-conds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--el-text-color-secondary);
}

.reg-legend-cond {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.reg-cond-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: 0 0 auto;
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

@media (max-width: 768px) {
    /* v1.3.5.9：设置页的条目列表横向滑动，窄屏不把操作按钮挤掉 */
    .reg-tracker-list {
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
    }

    .reg-tracker-row {
        min-width: 560px;
    }

    .reg-tracker-name {
        flex: 0 0 150px;
    }
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

    .reg-unit-kind,
    .reg-unit-base {
        width: 76px;
    }
}

@media (max-width: 768px) {
    /* v1.3.5.8：登记设置后面的下拉框 / 保存报表 / 刷新换到下一行 */
    .reg-head-right {
        width: 100%;
        flex-wrap: wrap;
    }

    .reg-head-actions {
        flex: 1 1 100%;
        order: 2;
    }

    .reg-report-select {
        flex: 1 1 120px;
        width: auto;
        min-width: 0;
    }

    .reg-f-type,
    .reg-f-dates {
        width: 100%;
    }

    .reg-f-bucket {
        width: 92px;
    }

    .reg-f-scope {
        width: 110px;
    }

    .reg-chart-canvas {
        height: 220px;
    }

    /* 图例行在窄屏改成两列卡片，字段名显式显示 */
    .reg-legend-row {
        grid-template-columns: 1fr 1fr;
        padding: 8px;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 8px;
        background: var(--el-bg-color);
    }

    .reg-legend-idx {
        grid-column: 1 / -1;
        text-align: left;
    }

    .reg-legend-field.is-wide {
        grid-column: 1 / -1;
    }

    /* v1.3.5.9：移动端不再显示字段名，名称由选择框的占位文案承担 */
    .reg-legend-label {
        display: none;
    }

    .reg-legend-del {
        grid-column: 1 / -1;
        justify-self: end;
    }

    .reg-tracker-type {
        max-width: 86px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .reg-chart-head {
        align-items: flex-start;
        flex-direction: column;
        gap: 8px;
    }

    .reg-axis-tabs {
        width: 100%;
        justify-content: flex-start;
    }
}
</style>

<style>
/* v1.3.5.9：移动端「起始 / 截止时间」的日期面板居中显示（原来会跑到屏幕外） */
.reg-range-popper--center.el-popper {
    position: fixed !important;
    left: 50% !important;
    top: 50% !important;
    right: auto !important;
    bottom: auto !important;
    transform: translate(-50%, -50%) !important;
    margin: 0 !important;
    max-width: 96vw;
}

.reg-range-popper--center .el-picker-panel {
    max-width: 96vw;
}
</style>
