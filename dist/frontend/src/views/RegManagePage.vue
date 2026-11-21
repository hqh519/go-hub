<template>
    <!--
        v1.3.5.8 登记管理（/reg）
        ----------------------------------------------------------------------------
        · 概览卡片：跟「总范围配置 + 默认项配置」，自定义图例不影响卡片；
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
                <!-- v1.3.5.10：刷新按钮紧跟「数据统计 / 登记设置」 -->
                <el-button size="small" :loading="loading" :title="$t('notes.refresh')" @click="reloadAll">
                    <font-awesome-icon icon="sync" />
                </el-button>
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
                </div>
            </div>
        </header>

        <section v-if="tab === 'stats'" class="reg-stats">
            <!--
                v1.3.5.10 总范围配置（全局）：登记类型 + 时间段 + 用户。
                默认项的附属条件（发生人 / 关联人 / 地点 / 标签）单独放在下一组，
                自定义图例项只受这一组影响，不再继承默认项的附属条件。
            -->
            <div class="reg-filters is-group">
                <div class="reg-group-head">
                    <span class="reg-group-title">{{ $t('reg.groupScope') }}</span>
                    <span class="reg-group-sub">{{ $t('reg.groupScopeSub') }}</span>
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.typeScope') }}</span>
                    <el-select v-model="typeFilter" size="small" class="reg-f-type" @change="onTypeChange">
                        <el-option v-for="t in valueTypes" :key="t.value" :label="$t(t.label)" :value="t.value" />
                    </el-select>
                </div>
                <!-- 桌面端用一个日期范围；移动端换成两个单日期框（范围面板在手机上放不下） -->
                <div v-if="!narrow" class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.rangeLabel') }}</span>
                    <el-date-picker
                        v-model="rangeDates"
                        type="daterange"
                        size="small"
                        unlink-panels
                        class="reg-f-dates"
                        :popper-class="'reg-range-popper--center'"
                        value-format="x"
                        :start-placeholder="$t('reg.axisStart')"
                        :end-placeholder="$t('reg.axisDue')"
                        @change="onTotalRangeChange"
                    />
                </div>
                <template v-else>
                    <div class="reg-f-item">
                        <span class="reg-f-label">{{ $t('reg.axisStart') }}</span>
                        <el-date-picker
                            v-model="rangeFrom"
                            type="date"
                            size="small"
                            class="reg-f-date"
                            value-format="x"
                            :placeholder="$t('reg.axisStart')"
                            @change="onMobileRangeChange"
                        />
                    </div>
                    <div class="reg-f-item">
                        <span class="reg-f-label">{{ $t('reg.axisDue') }}</span>
                        <el-date-picker
                            v-model="rangeTo"
                            type="date"
                            size="small"
                            class="reg-f-date"
                            value-format="x"
                            :placeholder="$t('reg.axisDue')"
                            @change="onMobileRangeChange"
                        />
                    </div>
                </template>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.scopeLabel') }}</span>
                    <el-select v-model="scope" size="small" class="reg-f-scope" @change="onTotalRangeChange">
                        <el-option :label="$t('reg.scopeMe')" value="me" />
                        <el-option :label="$t('reg.scopeAll')" value="all" />
                    </el-select>
                </div>
            </div>

            <!-- 第二组：默认项配置（条目 + 附属条件；只叠加在总范围配置之上） -->
            <div class="reg-filters is-group">
                <div class="reg-group-head">
                    <span class="reg-group-title">{{ $t('reg.groupDefault') }}</span>
                    <span class="reg-group-sub">{{ $t('reg.groupDefaultSub') }}</span>
                </div>
                <div class="reg-f-item is-grow">
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
                    <span class="reg-f-label">{{ $t('reg.fieldSubject') }}</span>
                    <el-select v-model="subjectFilter" size="small" clearable filterable class="reg-f-person" :placeholder="$t('reg.legendSubjectPh')" @change="onTotalRangeChange">
                        <el-option v-for="v in cand.subjects" :key="v" :label="v" :value="v" />
                    </el-select>
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.fieldRelated') }}</span>
                    <el-select v-model="relatedFilter" size="small" clearable filterable class="reg-f-person" :placeholder="$t('reg.legendRelatedPh')" @change="onTotalRangeChange">
                        <el-option v-for="v in cand.related" :key="v" :label="v" :value="v" />
                    </el-select>
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.fieldPlace') }}</span>
                    <el-select v-model="placeFilter" size="small" clearable filterable class="reg-f-place" :placeholder="$t('reg.legendPlacePh')" @change="onTotalRangeChange">
                        <el-option v-for="v in cand.places" :key="v" :label="v" :value="v" />
                    </el-select>
                </div>
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.fieldTags') }}</span>
                    <el-select v-model="tagFilters" size="small" multiple filterable collapse-tags collapse-tags-tooltip class="reg-f-tags" :placeholder="$t('reg.legendTagsPh')" @change="onTotalRangeChange">
                        <el-option v-for="v in cand.tags" :key="v" :label="v" :value="v" />
                    </el-select>
                </div>
            </div>

            <!-- 第三组：统计源配置（数据源 + 时间源 + 周期） -->
            <div class="reg-filters reg-filters-axes is-group">
                <div class="reg-group-head">
                    <span class="reg-group-title">{{ $t('reg.groupSource') }}</span>
                    <span class="reg-group-sub">{{ $t('reg.groupSourceSub') }}</span>
                </div>
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
                <!-- v1.3.5.10：周期挪到时间源后面 -->
                <div class="reg-f-item">
                    <span class="reg-f-label">{{ $t('reg.bucketLabel') }}</span>
                    <el-select v-model="bucket" size="small" class="reg-f-bucket" @change="loadStats">
                        <el-option :label="$t('reg.bucketDay')" value="day" />
                        <el-option :label="$t('reg.bucketWeek')" value="week" />
                        <el-option :label="$t('reg.bucketMonth')" value="month" />
                        <el-option :label="$t('reg.bucketQuarter')" value="quarter" />
                        <el-option :label="$t('reg.bucketYear')" value="year" />
                    </el-select>
                </div>
            </div>

            <!-- 第四组：数据卡片（只跟「总范围配置 + 默认项配置」走） -->
            <div class="reg-card-block">
                <div class="reg-group-head">
                    <span class="reg-group-title">{{ $t('reg.groupCards') }}</span>
                    <span class="reg-group-sub">{{ $t('reg.groupCardsSub') }}</span>
                </div>
                <div class="reg-cards">
                    <div class="reg-card">
                        <span class="reg-card-label">{{ $t('reg.statTotal') }}</span>
                        <span class="reg-card-value">{{ fmt(stats.total) }}<em v-if="cardUnit">{{ cardUnit }}</em></span>
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
                            <em v-if="stats.derive && stats.derive.unitPrice !== null">{{ unitPriceUnit }}</em>
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
                            <em v-if="stats.derive.speed.perDay !== null">{{ speedUnit }}</em>
                        </span>
                    </div>
                    <div class="reg-card">
                        <span class="reg-card-label">{{ $t('reg.deriveBalance') }}</span>
                        <span class="reg-card-value is-small">{{ fmt(balanceLast) }}<em v-if="cardUnit">{{ cardUnit }}</em></span>
                    </div>
                </div>
            </div>

            <!-- v1.3.5.10：同比常显，不再提供开关 -->
            <div v-if="stats.compare" class="reg-yoy">
                <font-awesome-icon icon="chart-line" class="reg-yoy-icon" />
                <span>{{ $t('reg.yoyTitle') }}：{{ fmt(stats.compare.total) }} {{ cardUnit }}</span>
                <em v-if="stats.compare.pct !== null" :class="{ 'is-up': stats.compare.pct >= 0 }">
                    {{ stats.compare.pct >= 0 ? '+' : '' }}{{ stats.compare.pct.toFixed(1) }}%
                </em>
                <span class="reg-yoy-sub">{{ $t('reg.yoySub', { n: stats.compare.count }) }}</span>
            </div>

            <div class="reg-chart-card">
                <div class="reg-chart-head">
                    <span class="reg-chart-title">{{ $t('reg.trendTitle') }}</span>
                </div>

                <!-- v1.3.5.10：图表切换挪到图例项设置的下方 -->
                <div class="reg-legend-box">
                    <div class="reg-legend-head">
                        <button type="button" class="reg-legend-toggle" @click="legendOpen = !legendOpen">
                            <font-awesome-icon icon="sliders-h" class="reg-legend-toggle-icon" />
                            <span>{{ $t('reg.legendTitle') }}</span>
                            <em>{{ legendSummary }}</em>
                        </button>
                        <span class="reg-legend-sub">{{ $t('reg.legendSub') }}</span>
                    </div>
                    <template v-if="legendOpen">
                    <!-- 默认项：就是总范围本身，不可删、不可改（改它请改上面的筛选） -->
                    <div class="reg-legend-row is-fixed">
                        <span class="reg-legend-idx is-first">{{ $t('reg.legendDefault') }}</span>
                        <span class="reg-legend-fixed-text">{{ defaultTraceText }}</span>
                        <span class="reg-legend-del is-locked" :title="$t('reg.legendFirstLocked')">
                            <font-awesome-icon icon="lock" />
                        </span>
                    </div>

                    <!-- 自定义图例项：最多 3 条（加默认项一共 4 条） -->
                    <div v-for="(lg, i) in legends" :key="'lg' + i" class="reg-legend-row">
                        <span class="reg-legend-idx">{{ $t('reg.seriesName', { n: i + 1 }) }}</span>
                        <div class="reg-legend-field is-item">
                            <el-select
                                v-model="lg.trackerId"
                                size="small"
                                filterable
                                clearable
                                :placeholder="$t('reg.legendItemPh')"
                                @change="onLegendTracker(i)"
                            >
                                <el-option v-for="t in legendTrackers(i)" :key="t.id" :label="t.name" :value="t.id" />
                            </el-select>
                        </div>
                        <div class="reg-legend-field is-subject">
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
                        <div class="reg-legend-field is-related">
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
                        <div class="reg-legend-field is-place">
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
                        <div class="reg-legend-field is-tags">
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
                        <button
                            type="button"
                            class="reg-legend-del"
                            :title="$t('common.delete')"
                            @click="removeLegend(i)"
                        >
                            <font-awesome-icon icon="trash" />
                        </button>
                    </div>
                    <div class="reg-legend-foot">
                        <button
                            type="button"
                            class="reg-legend-add"
                            :disabled="!canAddLegend"
                            @click="addLegend"
                        >
                            <font-awesome-icon icon="plus" />{{ $t('reg.legendAdd') }}
                        </button>
                        <span v-if="!trackerFilter" class="reg-legend-max">{{ $t('reg.legendNeedTotalItem') }}</span>
                        <span v-else-if="!canAddLegend" class="reg-legend-max">{{ $t('reg.legendMax') }}</span>
                    </div>
                    </template>
                </div>

                <!-- v1.3.5.10：图表类型切换（圆环 / 条形 / 雷达需要≥2个图例项） -->
                <div class="reg-chart-switch is-under-legend">
                    <button
                        v-for="c in availableChartTypes"
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

                <div v-if="!chartHasData" class="reg-chart-empty">{{ $t('reg.noData') }}</div>
                <div v-else class="reg-chart-scroll">
                    <div class="reg-chart-canvas" :style="chartCanvasStyle">
                        <component
                            :is="chartKind"
                            :data="chartPayload"
                            :options="chartOptions"
                            :plugins="chartPlugins"
                        />
                    </div>
                </div>

                <!-- 图例条件：tooltip 之外再给出完整条件，避免只看「项1」猜不到是什么 -->
                <!-- v1.3.5.10：圆环 / 条形 / 雷达的「颜色方块 + 名称」图例 -->
                <div v-if="chartHasData && !isSeriesChart && seriesLegend.length" class="reg-chart-legend is-color">
                    <span v-for="(s, si) in seriesLegend" :key="'sl' + si" class="reg-legend-item is-rich">
                        <i class="reg-cond-dot" :style="{ background: s.color }"></i>
                        <b class="reg-legend-name">{{ s.name }}</b>
                        <em>{{ fmt(s.total) }}{{ chartUnit ? ' ' + chartUnit : '' }}</em>
                        <span class="reg-legend-count">{{ $t('reg.entryCount', { n: s.count }) }}</span>
                    </span>
                </div>

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

/**
 * 多系列配色（与系统状态页同一套色感）
 * v1.3.8（需求）：默认项 / 项1 / 项2 保持不变，项3~项5 改为指定的三个深色，
 * 让后三条自定义图例在浅色背景上也有明确的区分度。
 */
const REG_CHART_COLORS = ['#409eff', '#67c23a', '#FF33CC', '#CC0066', '#006666', '#191919', '#f97316', '#909399'];

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
            /* v1.3.5.10：「默认项」的可选条件（也属于总范围） */
            subjectFilter: '',
            relatedFilter: '',
            placeFilter: '',
            tagFilters: [],
            /* 候选值（发生人 / 关联人 / 地点 / 标签） */
            cand: { places: [], subjects: [], related: [], tags: [] },
            rangeDates: null,
            /* 移动端：范围面板放不下，拆成两个单日期 */
            rangeFrom: '',
            rangeTo: '',
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
            /* v1.3.5.10：默认只有「默认项」，自定义图例为空（最多再加 3 条） */
            legends: [],
            legendOptions: [],
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
            ],
            reports: [],
            activeReport: '',
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
        /** 已选条目的自定义图例条数（决定图表能画哪些形态） */
        customLegendCount() {
            return this.legends.filter((lg) => !!lg.trackerId).length;
        },
        /** 系列数 = 默认项 + 自定义项（圆环 / 条形 / 雷达至少要 2 个才有意义） */
        seriesCount() {
            return 1 + this.customLegendCount;
        },
        /** 图例最多 3 条自定义；总范围没选条目时一条都不给加 */
        canAddLegend() {
            return !!this.trackerFilter && this.legends.length < 5;
        },
        availableChartTypes() {
            return this.chartTypes.filter((c) => c.value === 'bar' || c.value === 'line' || this.seriesCount >= 2);
        },
        /** 默认项 = 总范围本身（类型 + 条目 + 时间 + 人物 / 地点 / 标签） */
        defaultTraceText() {
            const bits = [];
            const typeHit = this.valueTypes.find((v) => v.value === this.typeFilter);
            bits.push(typeHit ? this.$t(typeHit.label) : this.$t('reg.allTypes'));
            const t = this.totalTracker;
            bits.push(t ? t.name : this.$t('reg.allItems'));
            const rq = this.rangeQuery();
            if (rq.from || rq.to) {
                const fmt = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString() : '…');
                bits.push(`${fmt(rq.from)} ~ ${fmt(rq.to)}`);
            } else {
                bits.push(this.$t('reg.rangeAllShort'));
            }
            if (this.subjectFilter) bits.push(`${this.$t('reg.fieldSubject')}=${this.subjectFilter}`);
            if (this.relatedFilter) bits.push(`${this.$t('reg.fieldRelated')}=${this.relatedFilter}`);
            if (this.placeFilter) bits.push(`${this.$t('reg.fieldPlace')}=${this.placeFilter}`);
            if (this.tagFilters.length) bits.push(`${this.$t('reg.fieldTags')}=${this.tagFilters.join('+')}`);
            if (!this.subjectFilter && !this.relatedFilter && !this.placeFilter && !this.tagFilters.length) {
                bits.push(this.$t('reg.noExtraFilter'));
            }
            return bits.join(' · ');
        },
        /** 纵轴单位：数值带「单位/分母」，份量本身没有单位 */
        metricUnit() {
            if (this.axisY === 'quantity') return '';
            const unit = String(this.stats.unit || '');
            const portion = String(this.stats.portion || '');
            if (unit && portion) return `${unit}/${portion}`;
            return unit;
        },
        /**
         * 合计 / 结存卡片的单位：只保留单位、不再带分母。
         * 份量口径下用「分母」当计量单位（如 元/份 取「份」）。
         */
        cardUnit() {
            if (this.axisY === 'quantity') return String(this.stats.portion || '');
            return String(this.stats.unit || '');
        },
        /** 单价 = 数值 / 份量，是两个口径的比值，不随「数据源」变化 */
        unitPriceUnit() {
            const unit = String(this.stats.unit || '');
            const portion = String(this.stats.portion || '');
            if (unit && portion) return `${unit}/${portion}`;
            return unit;
        },
        /** 日均速度 = 所选数据源 / 天（之前只写了「/天」，漏了前面的计量单位） */
        speedUnit() {
            const base = this.cardUnit || this.$t('reg.chartValue');
            return `${base}/${this.$t('reg.day')}`;
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
        /** 折叠状态下的一行摘要：默认项 + n 条 */
        legendSummary() {
            return this.customLegendCount
                ? this.$t('reg.legendSummaryOn', { n: this.customLegendCount })
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
            const sets = (st.chart && st.chart.datasets) || [];
            if (this.isSeriesChart) {
                /* 有标签但一条数据都没有时也算空（例如横轴切到「起始时间」而记录都没填） */
                return sets.length > 0 && sets.some((d) => Number(d.count) > 0);
            }
            /* 圆环 / 条形 / 雷达：统计的是「图例项 × 数据源」，至少要两个系列 */
            return this.seriesCount >= 2 && sets.some((d) => Math.abs(Number(d.total) || 0) > 0);
        },
        chartSub() {
            const st = this.stats || {};
            const axisLabel = this.$t((this.axisOptions.find((a) => a.value === this.axisX) || this.axisOptions[0]).label);
            const hint = this.$t('reg.axisXHint', { field: axisLabel });
            if (!this.isSeriesChart) return hint;
            const n = ((st.chart && st.chart.labels) || []).length;
            return `${hint} · ${this.$t('reg.trendSub', { n })}`;
        },
        /** 图例项名称（含默认项）—— 圆环 / 条形 / 雷达的类别 */
        seriesNames() {
            return ((this.stats.chart && this.stats.chart.datasets) || []).map((d) => String(d.name || ''));
        },
        /** 图表下方那片颜色方块图例（圆环 / 条形 / 雷达用）：名称 + 合计 + 条数 */
        seriesLegend() {
            if (this.isSeriesChart) return [];
            return ((this.stats.chart && this.stats.chart.datasets) || []).map((d, i) => ({
                name: String(d.name || ''),
                total: Number(d.total) || 0,
                count: Number(d.count) || 0,
                color: this.chartColor(i),
            }));
        },
        /**
         * v1.3.6：在数值 0 处画一条深色虚线（网格层之上、数据之下）。
         * 柱形 / 折线画水平线，条形图画垂直线；圆环 / 雷达不涉及坐标轴。
         */
        chartPlugins() {
            if (!['bar', 'line', 'hbar'].includes(this.chartType)) return [];
            const horizontal = this.chartType === 'hbar';
            /* 暗色主题下深灰线会融进背景，改为浅灰；亮色主题仍用深灰 */
            const dark = !!(this.$store && this.$store.getters && this.$store.getters.useDarkMode);
            const color = dark ? 'rgba(226, 232, 240, 0.8)' : 'rgba(51, 65, 85, 0.9)';
            return [{
                id: 'regZeroLine',
                beforeDatasetsDraw(chart) {
                    const area = chart.chartArea;
                    const scale = horizontal ? chart.scales.x : chart.scales.y;
                    if (!area || !scale) return;
                    const px = scale.getPixelForValue(0);
                    if (!Number.isFinite(px)) return;
                    const ctx = chart.ctx;
                    ctx.save();
                    /* v1.3.7：再细一点（0.8px），虚线间隔略缩短 */
                    ctx.setLineDash([4, 4]);
                    ctx.lineWidth = 0.8;
                    ctx.strokeStyle = color;
                    ctx.beginPath();
                    if (horizontal) {
                        if (px < area.left || px > area.right) { ctx.restore(); return; }
                        ctx.moveTo(px, area.top);
                        ctx.lineTo(px, area.bottom);
                    } else {
                        if (px < area.top || px > area.bottom) { ctx.restore(); return; }
                        ctx.moveTo(area.left, px);
                        ctx.lineTo(area.right, px);
                    }
                    ctx.stroke();
                    ctx.restore();
                },
            }];
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
            const sets = (this.stats.chart && this.stats.chart.datasets) || [];
            const names = sets.map((d) => String(d.name || ''));
            const totals = sets.map((d) => Number(d.total) || 0);

            if (type === 'doughnut') {
                return {
                    labels: names,
                    datasets: [{
                        label: valueLabel,
                        data: totals.map((v) => Math.abs(v)),
                        backgroundColor: names.map((_, i) => colors[i % colors.length]),
                        borderWidth: 2,
                        borderColor: 'transparent',
                        hoverOffset: 6,
                    }],
                };
            }
            if (type === 'hbar') {
                /* 纵轴名称改成颜色方块（见 chartOptions 的 ticks），真实名称在图表下方 */
                return {
                    labels: names,
                    datasets: [{
                        label: valueLabel,
                        data: totals,
                        backgroundColor: names.map((_, i) => colors[i % colors.length]),
                        borderRadius: 6,
                        borderWidth: 0,
                    }],
                };
            }
            if (type === 'radar') {
                /* 雷达图统计「图例项 × 数据源」：每个轴是一个图例项，值是该系列的合计 */
                return {
                    labels: names,
                    datasets: [{
                        label: valueLabel,
                        data: totals,
                        borderColor: colors[0],
                        backgroundColor: 'rgba(64, 158, 255, 0.18)',
                        borderWidth: 2,
                        pointBackgroundColor: names.map((_, i) => colors[i % colors.length]),
                        pointBorderColor: names.map((_, i) => colors[i % colors.length]),
                        pointRadius: 4,
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
                    /* 原始时间桶（tooltip 算「距离上条间隔」） */
                    rawKeys: chart.labels || [],
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
                    maxBarThickness: (sets || []).length > 1 ? 16 : 30,
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
            const colors = REG_CHART_COLORS;
            const series = this.seriesNames;
            const colorAt = (i) => colors[i % colors.length];
            /* v1.3.6：三类「系列图」统一在 tooltip 里给出完整项名与合计 */
            const seriesLabel = (ctx) => {
                const raw = Number(ctx.raw) || 0;
                return ` ${this.$t('reg.statTotal')}：${this.fmt(raw)}${unit ? ` ${unit}` : ''}`;
            };
            const tooltipBase = {
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
                            const line = ` ${ctx.dataset.label}${cond}：${this.fmt(v)}${unit ? ` ${unit}` : ''}`;
                            /* v1.3.5.10：再给一行「距离上条间隔 N 天，相差 X」 */
                            const gap = this.gapText(ctx.dataset, ctx.dataIndex);
                            return gap ? [line, ` ${gap}`] : line;
                        },
                    }
                    : {
                        label: (ctx) => ` ${ctx.label}：${this.fmt(Number(ctx.raw) || 0)}${unit ? ` ${unit}` : ''}`,
                    },
            };
            const base = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    /* v1.3.5.10：图例统一写在图表下方（颜色方块 + 名称），原生图例关掉 */
                    legend: { display: false },
                    tooltip: tooltipBase,
                },
            };
            if (this.chartType === 'doughnut') {
                return {
                    ...base,
                    cutout: '64%',
                    layout: { padding: 6 },
                    plugins: {
                        ...base.plugins,
                        tooltip: {
                            ...tooltipBase,
                            callbacks: {
                                /* v1.3.6：圆环 —— 完整项名 + 该块占比 */
                                title: (items) => String((items[0] && items[0].label) || ''),
                                label: (ctx) => {
                                    const arr = (ctx.dataset.data || []).map((v) => Math.abs(Number(v) || 0));
                                    const sum = arr.reduce((a, b) => a + b, 0);
                                    const val = Math.abs(Number(ctx.raw) || 0);
                                    const pct = sum ? (val / sum) * 100 : 0;
                                    return `${seriesLabel(ctx)} · ${pct.toFixed(1)}%`;
                                },
                            },
                        },
                    },
                };
            }
            if (this.chartType === 'radar') {
                return {
                    ...base,
                    plugins: {
                        ...base.plugins,
                        tooltip: {
                            ...tooltipBase,
                            callbacks: {
                                /* v1.3.6：雷达外围是「■」色块，tooltip 标题换回真实项名 */
                                title: (items) => String(this.seriesNames[(items[0] && items[0].dataIndex) || 0] || ''),
                                label: seriesLabel,
                            },
                        },
                    },
                    scales: {
                        r: {
                            beginAtZero: true,
                            grid: { color: 'rgba(148, 163, 184, 0.22)' },
                            angleLines: { color: 'rgba(148, 163, 184, 0.22)' },
                            /*
                             * v1.3.5.10：外围标签改成颜色方块（替代原来的周一~周日）；
                             * 名称写在图表下方的色块图例里。
                             */
                            pointLabels: {
                                color: series.map((_, i) => colorAt(i)),
                                font: { size: this.narrow ? 15 : 17, weight: '700' },
                                padding: 8,
                                callback: () => '■',
                            },
                            ticks: { display: false },
                            /* 顶点贴在最外圈会被网格线盖住，留 20% 余量 */
                            suggestedMax: (() => {
                                const max = Math.max(0, ...((this.stats.chart.datasets || []).map((d) => Number(d.total) || 0)));
                                return max > 0 ? max * 1.2 : 1;
                            })(),
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
                ticks: horizontal
                    ? {
                        /* v1.3.5.10：条形图纵轴名称换成颜色方块 */
                        color: (ctx) => colorAt(ctx.index),
                        font: { size: this.narrow ? 12 : 14, weight: '700' },
                        callback: () => '■',
                    }
                    : {
                        color: textColor,
                        font: { size: fontSize },
                        autoSkip: this.isSeriesChart ? false : true,
                        maxTicksLimit: this.isSeriesChart ? undefined : (this.narrow ? 5 : 8),
                    },
            };
            const valueAxis = {
                beginAtZero: true,
                /* v1.3.6：0 值分界线改由 chartPlugins 画虚线（网格保持原样） */
                grid: { color: 'rgba(148, 163, 184, 0.18)' },
                ticks: {
                    color: textColor,
                    font: { size: fontSize },
                },
            };
            const finalBase = horizontal
                ? {
                    ...base,
                    plugins: {
                        ...base.plugins,
                        tooltip: {
                            ...tooltipBase,
                            callbacks: {
                                /* v1.3.6：条形图 —— 完整项名 + 合计 */
                                title: (items) => String((items[0] && items[0].label) || ''),
                                label: seriesLabel,
                            },
                        },
                    },
                }
                : base;
            return {
                ...finalBase,
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
        /* v1.3.6：图例项设置默认展开（不再因为窄屏收起） */
        this.legendOpen = true;
        window.addEventListener('resize', this.onResize);
        /* v1.3.6：移动端点图表外任意位置，收起已弹出的数据提示 */
        document.addEventListener('pointerdown', this.hideChartTooltip, true);
        this.loadCandidates();
        /* v1.3.6：支持 /reg?tracker=条目名（发布页点条目跳转过来） */
        this.initTrackers();
        this.loadReports();
        this.$nextTick(this.measureChartBox);
    },
    watch: {
        /* 窄屏 / 宽屏切换：日期值互搬，避免筛选看起来被清空 */
        narrow() {
            this.syncRangeBetweenModes();
        },
        /* 自定义图例被删到只剩默认项时，圆环 / 条形 / 雷达要退回柱形 */
        seriesCount(n) {
            if (n < 2 && ['doughnut', 'hbar', 'radar'].includes(this.chartType)) this.chartType = 'bar';
        },
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.onResize);
        document.removeEventListener('pointerdown', this.hideChartTooltip, true);
    },
    methods: {
        /** 时间桶的起点（tooltip 算间隔用） */
        bucketStart(key) {
            const k = String(key || '');
            if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return new Date(`${k}T00:00:00`);
            if (/^\d{4}-\d{2}$/.test(k)) return new Date(`${k}-01T00:00:00`);
            if (/^\d{4}$/.test(k)) return new Date(`${k}-01-01T00:00:00`);
            /* v1.3.6：ISO 周（该周周一）/ 季度（首月 1 日） */
            const w = /^(\d{4})-W(\d{2})$/.exec(k);
            if (w) {
                const y = Number(w[1]);
                const jan4 = new Date(y, 0, 4);
                const day = jan4.getDay() || 7;
                return new Date(y, 0, 4 - (day - 1) + (Number(w[2]) - 1) * 7);
            }
            const q = /^(\d{4})-Q([1-4])$/.exec(k);
            if (q) return new Date(Number(q[1]), (Number(q[2]) - 1) * 3, 1);
            return null;
        },
        /**
         * v1.3.5.10：tooltip 里的「距离上条间隔 N 天，相差 X」。
         * 取同一系列的上一个时间桶：天数按桶起点算，差值是两桶数值之差。
         */
        gapText(dataset, index) {
            const i = Number(index);
            if (!dataset || !Number.isFinite(i) || i <= 0) return '';
            const keys = (dataset.rawKeys || []);
            const prev = this.bucketStart(keys[i - 1]);
            const cur = this.bucketStart(keys[i]);
            const prevVal = Number((dataset.data || [])[i - 1]);
            const curVal = Number((dataset.data || [])[i]);
            if (!prev || !cur) return '';
            const days = Math.max(0, Math.round((cur.getTime() - prev.getTime()) / 86400000));
            const diff = (Number.isFinite(curVal) ? curVal : 0) - (Number.isFinite(prevVal) ? prevVal : 0);
            const unit = this.metricUnit;
            return this.$t('reg.tooltipGap', {
                days,
                diff: `${diff >= 0 ? '+' : ''}${this.fmt(diff)}${unit ? ` ${unit}` : ''}`,
            });
        },
        /** v1.3.6：点图表画布以外的地方 → 收起 tooltip（移动端点完不会一直挂着） */
        hideChartTooltip(e) {
            const canvas = this.$el && this.$el.querySelector
                ? this.$el.querySelector('.reg-chart-canvas canvas')
                : null;
            if (canvas && e && e.target && canvas.contains(e.target)) return;
            if (!canvas) return;
            const chart = ChartJS.getChart(canvas);
            if (!chart || !chart.tooltip) return;
            try {
                chart.tooltip.setActiveElements([], { x: 0, y: 0 });
                chart.tooltip.setOpacity(0);
                chart.update('none');
            } catch (err) {
                /* 图表正在重建时忽略 */
            }
        },
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
            this.loadCandidates();
            this.loadStats();
        },
        /** v1.3.5.10：总范围的人物 / 地点 / 标签候选（与登记表单同一份） */
        async loadCandidates() {
            try {
                const qs = new URLSearchParams({ instanceId: this.instanceId });
                const res = await fetchWithAuth(`/api/reg/candidates?${qs.toString()}`);
                const data = await res.json().catch(() => null);
                if (data) {
                    this.cand = {
                        places: Array.isArray(data.places) ? data.places : [],
                        subjects: Array.isArray(data.subjects) ? data.subjects : [],
                        related: Array.isArray(data.related) ? data.related : [],
                        tags: Array.isArray(data.tags) ? data.tags : [],
                    };
                }
            } catch (e) {
                /* 候选拿不到不影响统计 */
            }
        },
        /**
         * 先取条目，再按 URL 的 tracker 参数预填「默认项」。
         * 参数是名称（便于人工拼链接），找不到就保持默认的全部条目。
         */
        async initTrackers() {
            await this.loadTrackers();
            const raw = this.$route && this.$route.query ? this.$route.query.tracker : '';
            const name = String(Array.isArray(raw) ? raw[0] : (raw || '')).trim();
            if (name) {
                const hit = this.trackers.find((t) => String(t.name) === name)
                    || this.trackers.find((t) => String(t.name).includes(name));
                if (hit) {
                    if (hit.valueType) this.typeFilter = hit.valueType;
                    this.trackerFilter = hit.id;
                }
            }
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
            /* 总范围条目变了 → 不再兼容「单位 + 分母」的自定义图例直接清掉 */
            const allowed = new Set(this.legendTrackers().map((t) => t.id));
            if (!this.trackerFilter) {
                this.legends = [];
                this.legendOptions = [];
            } else {
                for (let k = this.legends.length - 1; k >= 0; k -= 1) {
                    if (this.legends[k].trackerId && !allowed.has(this.legends[k].trackerId)) {
                        this.legends.splice(k, 1);
                        this.legendOptions.splice(k, 1);
                    }
                }
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
         * 图例项的条目候选（v1.3.5.10）：
         *   自定义项 1~3 统一按「总范围」的条目来校验「单位 + 分母」，
         *   不再以「项1」为基准；总范围没选条目时一条都不给选（也就加不了自定义项）。
         */
        legendTrackers() {
            const base = this.totalTracker;
            if (!base) return [];
            const list = (this.trackers || []).filter(
                (t) => !this.typeFilter || this.typeFilter === 'all' || t.valueType === this.typeFilter,
            );
            return list.filter((t) => String(t.unit || '') === String(base.unit || '')
                && String(t.portion || '') === String(base.portion || ''));
        },
        legendOpts(i) {
            return this.legendOptions[i] || emptyLegendOpts();
        },
        addLegend() {
            if (!this.trackerFilter) {
                this.$message.warning(this.$t('reg.legendNeedTotalItem'));
                return;
            }
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
            if (i < 0 || i >= this.legends.length) return;
            this.legends.splice(i, 1);
            this.legendOptions.splice(i, 1);
            this.loadStats();
        },
        onLegendTracker(i) {
            const lg = this.legends[i];
            if (!lg) return;
            lg.placeName = '';
            lg.subjectName = '';
            lg.relatedName = '';
            lg.tags = [];
            this.legendOptions[i] = emptyLegendOpts();
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
            /* 移动端用两个单日期框（范围面板在 390px 屏上放不下） */
            if (this.narrow) {
                const out = {};
                const f = Number(this.rangeFrom);
                const t = Number(this.rangeTo);
                if (Number.isFinite(f) && this.rangeFrom !== '' && this.rangeFrom !== null) out.from = f;
                if (Number.isFinite(t) && this.rangeTo !== '' && this.rangeTo !== null) {
                    const d = new Date(t);
                    d.setHours(23, 59, 59, 999);
                    out.to = d.getTime();
                }
                return out;
            }
            const arr = this.rangeDates;
            if (!Array.isArray(arr) || !arr.length) return {};
            const from = Number(arr[0]);
            const toRaw = Number(arr[1]);
            if (!Number.isFinite(from) || !Number.isFinite(toRaw)) return {};
            const to = new Date(toRaw);
            to.setHours(23, 59, 59, 999);
            return { from, to: to.getTime() };
        },
        onMobileRangeChange() {
            this.onTotalRangeChange();
        },
        /** 窄屏 / 宽屏切换时把日期值搬过去，别让筛选凭空消失 */
        syncRangeBetweenModes() {
            if (this.narrow) {
                if (Array.isArray(this.rangeDates) && this.rangeDates.length === 2) {
                    if (!this.rangeFrom) this.rangeFrom = Number(this.rangeDates[0]);
                    if (!this.rangeTo) this.rangeTo = Number(this.rangeDates[1]);
                }
            } else if (this.rangeFrom || this.rangeTo) {
                const f = Number(this.rangeFrom);
                const t = Number(this.rangeTo);
                this.rangeDates = Number.isFinite(f) && Number.isFinite(t) ? [f, t] : null;
            }
        },
        onTotalRangeChange() {
            this.refreshAllLegendOptions();
            this.loadStats();
        },
        legendQuery() {
            /* 默认项永远排第一：总范围配置 + 默认项自己的附属条件 */
            const list = [{
                name: this.$t('reg.legendDefault'),
                isDefault: true,
                trackerId: '',
                trackerName: '',
                placeName: String(this.placeFilter || ''),
                subjectName: String(this.subjectFilter || ''),
                relatedName: String(this.relatedFilter || ''),
                tags: (this.tagFilters || []).filter(Boolean),
            }];
            for (const lg of this.legends) {
                if (!lg.trackerId) continue;
                list.push({
                    name: this.$t('reg.seriesName', { n: list.length }),
                    isDefault: false,
                    trackerId: lg.trackerId,
                    placeName: String(lg.placeName || ''),
                    subjectName: String(lg.subjectName || ''),
                    relatedName: String(lg.relatedName || ''),
                    tags: Array.isArray(lg.tags) ? lg.tags.filter(Boolean) : [],
                });
            }
            return list;
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
                /* v1.3.5.10：总范围的发生人 / 关联人 / 地点 / 标签 */
                if (this.subjectFilter) qs.set('subjectName', this.subjectFilter);
                if (this.relatedFilter) qs.set('relatedName', this.relatedFilter);
                if (this.placeFilter) qs.set('placeName', this.placeFilter);
                if (this.tagFilters.length) qs.set('tags', this.tagFilters.join(','));
                /* v1.3.5.10：同比常显，不再由开关控制 */
                qs.set('compare', 'year');
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
                subjectName: this.subjectFilter || '',
                relatedName: this.relatedFilter || '',
                placeName: this.placeFilter || '',
                tags: this.tagFilters || [],
                from: rq.from || null,
                to: rq.to || null,
                bucket: this.bucket,
                scope: this.scope,
                axisX: this.axisX,
                axisY: this.axisY,
                legends: this.legendQuery(),
                /* 同比常显（v1.3.5.10 起不再由开关控制） */
                compare: 'year',
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
            this.subjectFilter = String(q.subjectName || '');
            this.relatedFilter = String(q.relatedName || '');
            this.placeFilter = String(q.placeName || '');
            this.tagFilters = Array.isArray(q.tags) ? q.tags.slice() : [];
            this.bucket = ['day', 'week', 'month', 'quarter', 'year'].includes(q.bucket) ? q.bucket : 'day';
            this.scope = q.scope === 'all' ? 'all' : 'me';
            this.axisX = ['occurredAt', 'startAt', 'dueAt', 'createdAt'].includes(q.axisX) ? q.axisX : 'occurredAt';
            this.axisY = q.axisY === 'quantity' ? 'quantity' : 'value';
            if (q.from && q.to) {
                this.rangeDates = [Number(q.from), Number(q.to)];
                this.rangeFrom = Number(q.from);
                this.rangeTo = Number(q.to);
            } else {
                this.rangeDates = null;
                this.rangeFrom = '';
                this.rangeTo = '';
            }
            /* 报表里的默认项是算出来的，不落库（见 legendQuery），这里只还原自定义项 */
            const lgs = (Array.isArray(q.legends) ? q.legends : []).filter((x) => !x.isDefault);
            this.legends = lgs.length
                ? lgs.slice(0, 5).map((x) => ({
                    trackerId: String(x.trackerId || ''),
                    placeName: String(x.placeName || ''),
                    subjectName: String(x.subjectName || ''),
                    relatedName: String(x.relatedName || ''),
                    tags: Array.isArray(x.tags) ? x.tags.slice() : [],
                }))
                : [];
            this.legendOptions = this.legends.map(() => emptyLegendOpts());
            this.refreshAllLegendOptions();
            this.loadStats();
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
            /* 周 / 季保留完整键，截断会分不清年份 */
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

/* v1.3.5.10：每组配置的组名（总范围配置 / 默认项配置 / 统计源配置 / 数据卡片） */
.reg-group-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    margin-bottom: 2px;
}

/* 筛选组是 flex-wrap，组名必须独占一行 */
.reg-filters > .reg-group-head {
    flex: 0 0 100%;
}

.reg-group-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    white-space: nowrap;
}

.reg-group-title::before {
    content: '';
    width: 3px;
    height: 12px;
    border-radius: 2px;
    background: var(--el-color-primary);
}

.reg-group-sub {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--el-text-color-placeholder);
}

.reg-card-block {
    display: flex;
    flex-direction: column;
    gap: 10px;
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

.reg-f-type { width: 178px; }
.reg-f-tracker { width: 220px; }
.reg-f-dates { width: 262px; }
.reg-f-bucket { width: 92px; }
.reg-f-scope { width: 110px; }
.reg-f-date { width: 168px; }
.reg-f-person { width: 118px; }
.reg-f-place { width: 148px; }
.reg-f-tags { width: 180px; }
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
    /* v1.3.5.10：所有卡片的数值统一 20px，不再有大有小 */
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--el-color-primary);
    line-height: 1.25;
}

/* 旧版给「最大/最小」「间隔」等卡片加过 is-small，现在统一字号，保留类名只为兼容 */
.reg-card-value.is-small {
    font-size: 20px;
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
    font-size: 20px;
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

/* v1.3.5.10：图表形态切换靠右对齐 */
.reg-chart-switch.is-under-legend {
    justify-content: flex-end;
    margin-left: auto;
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

/*
 * v1.3.5.10：图例行 = 「项n + 五个选择框 + 删除」，不再显示字段名（名称由占位文案承担）。
 * 发生人 / 关联人窄一些，地点 / 标签宽一些。
 */
.reg-legend-row {
    display: grid;
    grid-template-areas: 'idx item subject related place tags del';
    grid-template-columns: 34px minmax(0, 1.7fr) minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 1.3fr) minmax(0, 1.3fr) 26px;
    align-items: center;
    gap: 6px;
}

/* 默认项：没有选择框，一行说明文字 + 锁 */
.reg-legend-row.is-fixed {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--el-fill-color-lighter, rgba(127, 127, 127, 0.06));
}

.reg-legend-fixed-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
    word-break: break-word;
}

.reg-legend-idx {
    grid-area: idx;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-align: center;
    white-space: nowrap;
}

.reg-legend-idx.is-first {
    color: var(--el-color-primary);
    text-align: left;
}

.reg-legend-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.reg-legend-field.is-item { grid-area: item; }
.reg-legend-field.is-subject { grid-area: subject; }
.reg-legend-field.is-related { grid-area: related; }
.reg-legend-field.is-place { grid-area: place; }
.reg-legend-field.is-tags { grid-area: tags; }

.reg-legend-del {
    grid-area: del;
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

.reg-chart-legend.is-color .reg-cond-dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-right: 5px;
}

/* v1.3.6：圆环 / 条形 / 雷达下方的图例带项目信息（名称 + 合计 + 条数） */
.reg-legend-item.is-rich {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
}

.reg-legend-name {
    font-weight: 600;
    color: var(--el-text-color-regular);
}

.reg-legend-count {
    font-size: 11px;
    color: var(--el-text-color-placeholder);
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

@media (max-width: 900px) {
    .reg-cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
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

    /*
     * v1.3.5.10：筛选改成「一行一项」—— 名称固定 62px，控件吃满剩余宽度。
     * 原来给 select 写 width:100% 会把自动宽度的 flex 项压成只剩一个箭头。
     */
    .reg-filters {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
    }

    /* 列方向下 flex-basis 是高度，组名不能再用 100% */
    .reg-filters > .reg-group-head {
        flex: 0 0 auto;
        width: 100%;
    }

    .reg-group-head {
        flex-wrap: wrap;
        gap: 4px 8px;
    }

    .reg-f-item,
    .reg-f-item.is-grow {
        width: 100%;
        flex: 1 1 auto;
    }

    .reg-f-label {
        flex: 0 0 62px;
    }

    .reg-f-type,
    .reg-f-tracker,
    .reg-f-dates,
    .reg-f-date,
    .reg-f-person,
    .reg-f-place,
    .reg-f-tags,
    .reg-f-bucket,
    .reg-f-scope {
        width: auto;
        flex: 1 1 auto;
        min-width: 0;
    }

    /* 时间源四个页签在窄屏铺满一行可横滑 */
    .reg-filters-axes .reg-axis-tabs {
        width: 100%;
        justify-content: flex-start;
    }

    .reg-chart-canvas {
        height: 220px;
    }

    /*
     * 图例项：项名与删除按钮同一行（删除在行末），
     * 条目 / 地点 / 标签各占整行，发生人 / 关联人并排。
     */
    .reg-legend-row {
        grid-template-areas:
            'idx del'
            'item item'
            'subject related'
            'place place'
            'tags tags';
        grid-template-columns: minmax(0, 1fr) 26px;
        row-gap: 6px;
        padding: 8px;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 8px;
        background: var(--el-bg-color);
    }

    .reg-legend-idx {
        text-align: left;
    }

    .reg-legend-del {
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
