<template>
  <div class="status-panel" v-loading="loading">
    <!-- 动态问候与系统运行摘要 -->
    <section
      class="status-hero"
      :class="`is-${systemHealthState}`"
      :aria-label="$t('sysStatus.systemOverview')"
    >
      <div class="status-hero-copy">
        <div class="status-hero-kicker">
          <span class="system-health-badge" aria-live="polite">
            <span class="system-health-dot" aria-hidden="true"></span>
            {{ systemHealthLabel }}
          </span>
          <span class="status-hero-date">{{ currentDateLabel }}</span>
        </div>

        <h1 class="status-hero-title">{{ greetingTitle }}</h1>
        <p class="status-hero-summary" aria-live="polite">{{ systemStatusSummary }}</p>
      </div>

      <div class="status-hero-time-card">
        <span class="status-hero-time-caption">{{ $t('sysStatus.localTime') }}</span>
        <time class="status-hero-time" :datetime="currentTime.toISOString()">{{ currentTimeLabel }}</time>
        <span class="status-hero-timezone">{{ timeZoneLabel }}</span>
      </div>
    </section>

    <!-- 顶部概览卡片 -->
    <div class="overview-cards">
      <div class="overview-card total-files" @click="fetchIndexInfo">
        <div class="card-icon">
          <font-awesome-icon icon="database" />
        </div>
        <div class="card-content">
          <div class="card-title">{{ $t('sysStatus.totalFiles') }}</div>
          <div class="card-value">{{ indexInfo.totalFiles?.toLocaleString() || '0' }}</div>
          <div class="card-subtitle">{{ $t('sysStatus.clickToRefresh') }}</div>
        </div>
      </div>

      <div class="overview-card index-status">
        <div class="card-icon">
          <font-awesome-icon icon="clock" />
        </div>
        <div class="card-content">
          <div class="card-title">{{ $t('sysStatus.indexUpdateTime') }}</div>
          <div class="card-value">{{ formatTime(indexInfo.lastUpdated) }}</div>
          <div class="card-subtitle">{{ getTimeAgo(indexInfo.lastUpdated) }}</div>
        </div>
      </div>

      <div class="overview-card system-version" @click="openReleases">
        <div class="card-icon">
          <font-awesome-icon icon="code-branch" />
        </div>
        <div class="card-content">
          <div class="card-title">{{ $t('sysStatus.systemVersion') }}</div>
          <div class="card-value">v{{ version }}</div>
          <div class="card-subtitle">{{ $t('sysStatus.clickToViewChangelog') }}</div>
        </div>
      </div>
    </div>

    <!-- 统计徽章：今日/昨日/本周/本月/本年上传 + 累计占用 + 文件夹
         （放在「文件总数」下方、「上传趋势」上方，属于关键指标概览） -->
    <div class="stat-badge-row">
      <div
        v-for="badge in statBadges"
        :key="badge.key"
        class="stat-badge"
        :class="{ 'is-clickable': badge.clickable }"
        :title="badge.clickable ? badge.tip : ''"
        @click="onBadgeClick(badge)"
      >
        <font-awesome-icon :icon="badge.icon" class="stat-badge-icon" />
        <div class="stat-badge-body">
          <div class="stat-badge-value">{{ badge.value }}</div>
          <div class="stat-badge-label">{{ badge.label }}</div>
        </div>
      </div>
    </div>

    <!-- 统计图表区域 -->
    <div class="charts-section">
      <!-- 上传趋势 - 折线图 -->
      <div class="chart-card trend-chart-card">
        <div class="chart-header trend-chart-header">
          <div class="chart-title">
            <font-awesome-icon icon="chart-line" />
            <span>{{ $t('sysStatus.uploadTrend') }}</span>
            <el-button
              class="trend-calendar-btn"
              circle
              :aria-label="$t('sysStatus.selectDateRange')"
              @click="openTrendDateDialog"
            >
              <font-awesome-icon icon="calendar" />
            </el-button>
          </div>
          <div class="trend-controls">
            <el-radio-group
              v-model="trendGroupBy"
              size="small"
              class="trend-group-switch"
              :aria-label="$t('sysStatus.uploadTrendGroupBy')"
            >
              <el-radio-button label="channel">{{ $t('sysStatus.byChannelType') }}</el-radio-button>
              <el-radio-button label="channelName">{{ $t('sysStatus.byChannelName') }}</el-radio-button>
              <!-- 用户趋势：按上传用户分组 -->
              <el-radio-button label="user">{{ $t('sysStatus.byUser') }}</el-radio-button>
              <!-- v2.8.5：新增「上传接口」「类型」两个维度 -->
              <el-radio-button label="uploadSource">{{ $t('sysStatus.byUploadSource') }}</el-radio-button>
              <el-radio-button label="mime">{{ $t('sysStatus.byMime') }}</el-radio-button>
            </el-radio-group>
          </div>
        </div>
        <el-dialog
          v-model="trendDatePickerVisible"
          :title="$t('sysStatus.selectDateRange')"
          :width="trendDateDialogWidth"
          class="trend-date-dialog"
          align-center
          append-to-body
        >
          <div class="trend-date-panel">
            <DateRangeCalendar
              v-model="trendDateRange"
              @change="handleTrendDateRangeChange"
            />
          </div>
        </el-dialog>
        <div class="chart-content trend-chart-content">
          <div v-if="!hasTrendData" class="empty-state trend-empty-state">
            <font-awesome-icon icon="inbox" />
            <span>{{ $t('sysStatus.noData') }}</span>
          </div>
          <!-- 移动端可横向拖动图表查看（相当于缩放），桌面端保持铺满 -->
          <div v-else class="line-chart-scroll">
            <div class="line-chart-wrapper">
              <Line :data="uploadTrendChartData" :options="lineChartOptions" />
            </div>
          </div>
        </div>
      </div>

      <!-- 渠道统计 - 饼状图 -->
      <div class="chart-card">
        <div class="chart-header">
          <font-awesome-icon icon="share-alt" />
          <span>{{ $t('sysStatus.channelDistribution') }}</span>
        </div>
        <div class="chart-content">
          <div v-if="Object.keys(indexInfo.channelStats || {}).length === 0" class="empty-state">
            <font-awesome-icon icon="inbox" />
            <span>{{ $t('sysStatus.noData') }}</span>
          </div>
          <div v-else class="pie-chart-container">
            <div class="pie-chart-wrapper">
              <Doughnut :data="channelChartData" :options="chartOptions" />
              <div class="chart-center-text">
                <div class="center-value">{{ indexInfo.totalFiles?.toLocaleString() || '0' }}</div>
                <div class="center-label">{{ $t('sysStatus.totalFilesLabel') }}</div>
              </div>
            </div>
            <div class="chart-legend">
              <div 
                v-for="(count, channel, index) in indexInfo.channelStats" 
                :key="channel"
                class="legend-item"
              >
                <span class="legend-color" :style="{ background: getChartColor(index) }"></span>
                <span class="legend-label">{{ channel }}</span>
                <span class="legend-value">{{ count.toLocaleString() }}</span>
                <span class="legend-percent">{{ getPercentage(count, indexInfo.totalFiles) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 上传类型分布 - 饼状图（v2.8.5：图片 / 视频 / 音频 / 其他，按 mime 归类；v2.8.5 修：与「上传接口分布」互换位置） -->
      <div class="chart-card">
        <div class="chart-header">
          <font-awesome-icon icon="image" />
          <span>{{ $t('sysStatus.mimeDistribution') }}</span>
        </div>
        <div class="chart-content">
          <div v-if="Object.keys(indexInfo.mimeStats || {}).length === 0" class="empty-state">
            <font-awesome-icon icon="inbox" />
            <span>{{ $t('sysStatus.noData') }}</span>
          </div>
          <div v-else class="pie-chart-container">
            <div class="pie-chart-wrapper">
              <Doughnut :data="mimeChartData" :options="chartOptions" />
              <div class="chart-center-text">
                <div class="center-value">{{ Object.keys(indexInfo.mimeStats).length }}</div>
                <div class="center-label">{{ $t('sysStatus.mimeTypes') }}</div>
              </div>
            </div>
            <div class="chart-legend">
              <div
                v-for="(count, type, index) in indexInfo.mimeStats"
                :key="type"
                class="legend-item"
              >
                <span class="legend-color" :style="{ background: getTypeChartColor(index) }"></span>
                <span class="legend-label">{{ fileTypeLabel(type) }}</span>
                <span class="legend-value">{{ count.toLocaleString() }}</span>
                <span class="legend-percent">{{ getPercentage(count, indexInfo.totalFiles) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 上传用户分布 - 饼状图 -->
      <div class="chart-card">
        <div class="chart-header">
          <font-awesome-icon icon="users" />
          <span>{{ $t('sysStatus.userDistribution') }}</span>
        </div>
        <div class="chart-content">
          <div v-if="Object.keys(indexInfo.userStats || {}).length === 0" class="empty-state">
            <font-awesome-icon icon="inbox" />
            <span>{{ $t('sysStatus.noData') }}</span>
          </div>
          <div v-else class="pie-chart-container">
            <div class="pie-chart-wrapper">
              <Doughnut :data="userChartData" :options="chartOptions" />
              <div class="chart-center-text">
                <div class="center-value">{{ Object.keys(indexInfo.userStats).length }}</div>
                <div class="center-label">{{ $t('sysStatus.userCountLabel') }}</div>
              </div>
            </div>
            <div class="chart-legend">
              <div
                v-for="(count, user, index) in indexInfo.userStats"
                :key="user"
                class="legend-item"
              >
                <span class="legend-color" :style="{ background: getTypeChartColor(index) }"></span>
                <span class="legend-label">{{ user }}</span>
                <span class="legend-value">{{ count.toLocaleString() }}</span>
                <span class="legend-percent">{{ getPercentage(count, indexInfo.totalFiles) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 上传接口分布 - 饼状图（v2.8.5：网页上传 / WebDAV / API-Web / API-S3） -->
      <div class="chart-card">
        <div class="chart-header">
          <font-awesome-icon icon="plug" />
          <span>{{ $t('sysStatus.uploadSourceDistribution') }}</span>
        </div>
        <div class="chart-content">
          <div v-if="Object.keys(indexInfo.uploadSourceStats || {}).length === 0" class="empty-state">
            <font-awesome-icon icon="inbox" />
            <span>{{ $t('sysStatus.noData') }}</span>
          </div>
          <div v-else class="pie-chart-container">
            <div class="pie-chart-wrapper">
              <Doughnut :data="sourceChartData" :options="chartOptions" />
              <div class="chart-center-text">
                <div class="center-value">{{ Object.keys(indexInfo.uploadSourceStats).length }}</div>
                <div class="center-label">{{ $t('sysStatus.sourceTypes') }}</div>
              </div>
            </div>
            <div class="chart-legend">
              <div
                v-for="(count, source, index) in indexInfo.uploadSourceStats"
                :key="source"
                class="legend-item"
              >
                <span class="legend-color" :style="{ background: getChartColor(index) }"></span>
                <span class="legend-label">{{ uploadSourceLabel(source) }}</span>
                <span class="legend-value">{{ count.toLocaleString() }}</span>
                <span class="legend-percent">{{ getPercentage(count, indexInfo.totalFiles) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 文件类型统计 - 饼状图（独立一行，高度降低） -->
      <div class="chart-card chart-card-full chart-card-short">
        <div class="chart-header">
          <font-awesome-icon icon="file-alt" />
          <span>{{ $t('sysStatus.fileStatusDistribution') }}</span>
        </div>
        <div class="chart-content">
          <div v-if="Object.keys(indexInfo.typeStats || {}).length === 0" class="empty-state">
            <font-awesome-icon icon="inbox" />
            <span>{{ $t('sysStatus.noData') }}</span>
          </div>
          <div v-else class="pie-chart-container">
            <div class="pie-chart-wrapper">
              <Doughnut :data="typeChartData" :options="chartOptions" />
              <div class="chart-center-text">
                <div class="center-value">{{ Object.keys(indexInfo.typeStats).length }}</div>
                <div class="center-label">{{ $t('sysStatus.statusTypes') }}</div>
              </div>
            </div>
            <div class="chart-legend">
              <div 
                v-for="(count, status, index) in aggregatedTypeStats" 
                :key="status"
                class="legend-item"
              >
                <span class="legend-color" :style="{ background: getTypeChartColor(index) }"></span>
                <span class="legend-label">{{ status }}</span>
                <span class="legend-value">{{ count.toLocaleString() }}</span>
                <span class="legend-percent">{{ getPercentage(count, indexInfo.totalFiles) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作区域 -->
    <div class="actions-section">
      <div class="action-card">
        <div class="action-header">
          <font-awesome-icon icon="tools" />
          <span>{{ $t('sysStatus.systemMaintenance') }}</span>
        </div>
        <div class="action-content">
          <!-- 进度显示 UI -->
          <div v-if="isProcessing" class="progress-container">
            <div class="progress-header">
              <span class="progress-phase">{{ phaseDescription }}</span>
              <span class="progress-percentage">{{ Math.round(processingProgress.percentage) }}%</span>
            </div>
            <el-progress 
              :percentage="processingProgress.percentage" 
              :stroke-width="12"
              :show-text="false"
              class="progress-bar"
            />
            <div class="progress-details">
              <!-- 当前/总数显示 -->
              <span class="progress-count" v-if="processingProgress.current > 0">
                <font-awesome-icon icon="file-alt" />
                {{ processingProgress.current.toLocaleString() }}
                <template v-if="processingProgress.total > 0">
                  / {{ processingProgress.total.toLocaleString() }}
                </template>
                {{ $t('sysStatus.records') }}
              </span>
              <!-- 预计剩余时间 -->
              <span class="progress-time" v-if="estimatedTimeRemaining">
                <font-awesome-icon icon="clock" />
                {{ estimatedTimeRemaining }}
              </span>
            </div>
            <div class="progress-message" v-if="processingProgress.message">
              {{ processingProgress.message }}
            </div>
            <!-- 取消按钮 -->
            <el-button 
              type="danger" 
              plain
              size="small"
              @click="cancelOperation"
              class="cancel-btn"
            >
              <font-awesome-icon icon="times" />
              {{ $t('sysStatus.cancelOperation') }}
            </el-button>
          </div>
          
          <!-- 错误显示 -->
          <div v-else-if="processingError" class="error-container">
            <div class="error-icon">
              <font-awesome-icon icon="exclamation-triangle" />
            </div>
            <div class="error-content">
              <div class="error-message">{{ processingError.message }}</div>
              <div class="error-suggestion" v-if="processingError.suggestion">
                {{ processingError.suggestion }}
              </div>
            </div>
            <div class="error-actions">
              <el-button 
                v-if="processingError.recoverable"
                type="primary" 
                size="small"
                @click="retryOperation"
              >
                <font-awesome-icon icon="redo" />
                {{ $t('sysStatus.retry') }}
              </el-button>
              <el-button 
                type="default" 
                size="small"
                @click="dismissError"
              >
                {{ $t('sysStatus.close') }}
              </el-button>
            </div>
          </div>
          
          <!-- 操作按钮 -->
          <div v-else class="action-buttons">
            <el-tooltip :content="$t('sysStatus.rebuildTooltip')" placement="top">
              <el-button 
                type="primary" 
                :loading="rebuilding"
                :disabled="isProcessing"
                @click="rebuildIndex"
                class="action-btn rebuild-btn"
              >
                <font-awesome-icon icon="sync-alt" />
                {{ rebuilding ? $t('sysStatus.rebuilding') : $t('sysStatus.rebuildIndex') }}
              </el-button>
            </el-tooltip>

            <el-tooltip :content="$t('sysStatus.backupTooltip')" placement="top">
              <el-button 
                type="success" 
                :loading="backing"
                :disabled="isProcessing"
                @click="backupData"
                class="action-btn backup-btn"
              >
                <font-awesome-icon icon="download" />
                {{ backing ? $t('sysStatus.backingUp') : $t('sysStatus.backupData') }}
              </el-button>
            </el-tooltip>

            <el-tooltip :content="$t('sysStatus.restoreTooltip')" placement="top">
              <div class="restore-section">
                <input 
                  type="file" 
                  ref="fileInput" 
                  accept=".json"
                  @change="handleFileSelect"
                  style="display: none"
                />
                <el-button 
                  type="warning" 
                  :loading="restoring"
                  :disabled="isProcessing"
                  @click="selectRestoreFile"
                  class="action-btn restore-btn"
                >
                  <font-awesome-icon icon="upload" />
                  {{ restoring ? $t('sysStatus.restoring') : $t('sysStatus.restoreData') }}
                </el-button>
              </div>
            </el-tooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近上传：最近 20 条记录，列表形式 -->
    <div class="recent-upload-section">
      <div class="section-header-row">
        <h3 class="section-title">
          <font-awesome-icon icon="history" />
          <span>{{ $t('sysStatus.recentUploads') }}</span>
        </h3>
        <!-- v2.8.7：标题右侧补「查看全部」，新标签页打开最近记录（历史记录）页，样式与访问记录块一致 -->
        <div class="section-header-actions">
          <span class="section-hint">{{ $t('sysStatus.recentUploadsHint', { count: recentFiles.length }) }}</span>
          <el-button link type="primary" size="small" class="section-link" @click="openRecentUploads()">
            {{ $t('sysStatus.viewAccessLog') }}
            <font-awesome-icon icon="external-link-alt" />
          </el-button>
        </div>
      </div>

      <div class="recent-list" v-if="recentFiles.length > 0">
        <div
          v-for="file in recentFiles"
          :key="file.id"
          class="recent-item"
          @click="openFileInNewTab(file)"
        >
          <div
            class="recent-thumb"
            :title="$t('sysStatus.openDetailHint')"
            @click.stop="openRecentDetail(file)"
          >
            <img
              v-if="isImageFile(file) && !loadErrors['recent-' + file.id]"
              :src="thumbUrl('/file/' + file.id + '?from=admin', 320)"
              loading="lazy"
              @error="handleImageError('recent-' + file.id)"
            />
            <font-awesome-icon v-else icon="file-alt" />
          </div>
          <div class="recent-main">
            <!-- 文件名 / 链接 → 历史记录页 -->
            <div class="recent-name" :title="file.metadata?.FileName || file.id" @click.stop="goHistory()">
              {{ file.metadata?.FileName || file.id }}
            </div>
            <div class="recent-url" :title="fileUrl(file)" @click.stop="goHistory()">{{ fileUrl(file) }}</div>
          </div>
          <div class="recent-meta">
            <!-- 文件类型（扩展名）→ 打开文件链接 -->
            <el-tag v-if="file.metadata?.FileExt" size="small" type="info" effect="plain" class="recent-ext-tag" @click.stop="openFileInNewTab(file)">
              {{ file.metadata.FileExt }}
            </el-tag>
            <!-- 上传用户 -->
            <span class="recent-user" :title="$t('dashboard.uploadUser')">
              <font-awesome-icon icon="user" />
              {{ file.metadata?.UploadUser || $t('fileDetail.unknown') }}
            </span>
            <!-- 分类（文件的所属目录）→ 文件管理对应文件夹 -->
            <span class="recent-category" :title="$t('fileDetail.fileCategory')" @click.stop="goFileManage(file)">
              <font-awesome-icon icon="folder" />
              {{ file.metadata?.Directory || $t('fileDetail.noCategory') }}
            </span>
            <span class="recent-views" :title="$t('dashboard.views')">
              <font-awesome-icon icon="eye" />
              {{ file.metadata?.Views || 0 }}
            </span>
            <span class="recent-size">{{ file.metadata?.FileSize || '-' }}</span>
            <span class="recent-time">{{ formatTime(file.metadata?.TimeStamp) }}</span>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <font-awesome-icon icon="inbox" class="empty-icon" />
        <span>{{ $t('sysStatus.noData') }}</span>
      </div>
    </div>

    <!-- 访问记录：最近 20 条（v2.3.0），点击任意一条进入访问记录管理页 -->
    <div class="recent-upload-section access-record-section">
      <div class="section-header-row">
        <h3 class="section-title">
          <font-awesome-icon icon="globe" />
          <span>{{ $t('sysStatus.recentAccess') }}</span>
        </h3>
        <div class="section-header-actions">
          <span class="section-hint">{{ $t('sysStatus.recentAccessHint', { count: accessRecent.length }) }}</span>
          <el-button link type="primary" size="small" class="section-link" @click="openAccessLog()">
            {{ $t('sysStatus.viewAccessLog') }}
            <font-awesome-icon icon="external-link-alt" />
          </el-button>
        </div>
      </div>

      <div class="recent-list" v-if="accessRecent.length > 0">
        <div
          v-for="row in accessRecent"
          :key="row.id"
          class="recent-item access-item"
          :title="$t('sysStatus.openAccessLogHint')"
          @click="openAccessLog(row)"
        >
          <div class="recent-main">
            <div class="recent-name" :title="row.path">{{ row.path || '-' }}</div>
            <div class="recent-url" :title="row.title">{{ row.title || row.path || '-' }}</div>
          </div>
          <div class="recent-meta">
            <!-- IP + 归属地 -->
            <span class="recent-ip" :title="$t('accessLog.colIp')">
              <font-awesome-icon icon="globe" />
              {{ row.ip || '-' }}
            </span>
            <span v-if="row.ipLocation" class="recent-location" :title="$t('accessLog.colLocation')">
              {{ row.ipLocation }}
            </span>
            <!-- 登录用户（游客不显示） -->
            <span v-if="row.username" class="recent-user" :title="$t('accessLog.colUser')">
              <font-awesome-icon icon="users" />
              {{ row.username }}
            </span>
            <!-- 停留时长 -->
            <span class="recent-views" :title="$t('accessLog.colStay')">
              <font-awesome-icon icon="clock" />
              {{ formatStay(row.stayMs) }}
            </span>
            <span class="recent-time">{{ formatAccessTime(row.createdAt) }}</span>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <font-awesome-icon icon="inbox" class="empty-icon" />
        <span>{{ $t('sysStatus.noData') }}</span>
      </div>
    </div>

    <!-- 最近上传 → 文件详情：全站统一入口（FileDetailUnified），按钮/权限与其他页面完全一致 -->
    <FileDetailUnified
      v-model="showRecentDetail"
      :file="recentDetail"
      @deleted="handleRecentDeleted"
      @fileRenamed="handleRecentRenamed"
    />

  </div>
</template>

<script>
import { thumbUrl } from '../../utils/thumb';
import fetchWithAuth from '@/utils/fetchWithAuth'
import packageInfo from '../../../package.json'
import { Doughnut, Line } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler } from 'chart.js'
import IndexRebuilder from '@/utils/indexRebuilder'
import BackupGenerator from '@/utils/backupGenerator'
import RestoreProcessor from '@/utils/restoreProcessor'
import DateRangeCalendar from '@/components/DateRangeCalendar.vue'
import FileDetailUnified from '@/components/dashboard/FileDetailUnified.vue'
import { fileLink } from '@/utils/fileLink'
import { loadFileDetail } from '@/utils/fileDetailLoader'
import { bindDialogLayers } from '@/utils/layerStack'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler)

const DAY_MS = 24 * 60 * 60 * 1000

function padDatePart(value) {
  return String(value).padStart(2, '0')
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function getDefaultTrendDateRange() {
  const endDate = new Date()
  endDate.setHours(0, 0, 0, 0)
  const startDate = new Date(endDate.getTime() - 6 * DAY_MS)
  return [formatDateInput(startDate), formatDateInput(endDate)]
}

export default {
  name: 'SysCogStatus',
  components: {
    Doughnut,
    Line,
    DateRangeCalendar,
    FileDetailUnified
  },
  data() {
    return {
      loading: false,
      rebuilding: false,
      backing: false,
      restoring: false,
      indexInfo: {},
      indexInfoLoaded: false,
      indexInfoError: false,
      currentTime: new Date(),
      clockTimer: null,
      version: packageInfo.version, // 从package.json获取版本号
      // 最近上传 → 文件详情（FileDetailUnified 的入参：{ name, metadata }）
      showRecentDetail: false,
      recentDetail: null,
      // 访问记录（最近 20 条，v2.3.0）
      accessRecent: [],
      loadErrors: {
        newest: false,
        oldest: false
      },
      trendGroupBy: 'channel',
      trendDatePickerVisible: false,
      trendDateRange: getDefaultTrendDateRange(),
      // 渠道图表颜色
      channelColors: [
        '#8B5CF6', '#EC4899', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#2563EB', '#84CC16'
      ],
      // 状态图表颜色
      typeColors: [
        '#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
      ],
      // 上传趋势折线图颜色
      trendColors: [
        '#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16', '#64748B'
      ],
      // 批量操作进度状态
      isProcessing: false,
      processingPhase: '', // fetching, sorting, uploading, finalizing, building, downloading, completed
      processingProgress: {
        current: 0,
        total: 0,
        message: '',
        percentage: 0
      },
      processingError: null,
      processingStartTime: null,
      // 当前处理器实例（用于取消操作）
      currentRebuilder: null,
      currentBackupGenerator: null,
      currentRestoreProcessor: null
    }
  },
  computed: {
    currentLocale() {
      return String(this.$i18n.locale || 'zh-CN')
    },
    /** 最近上传（最近 20 条，由 indexInfo.recentFiles 提供） */
    recentFiles() {
      const list = this.indexInfo.recentFiles
      return Array.isArray(list) ? list : []
    },
    /** 统计徽章：上传数量统计（可点击跳历史记录）+ 累计占用 + 文件夹数量 + 访问次数 */
    statBadges() {
      const s = this.indexInfo.stats || {}
      const n = (v) => Number(v || 0).toLocaleString(this.currentLocale)
      const uploadBadges = [
        { key: 'today', label: this.$t('sysStatus.todayUpload'), value: n(s.today), icon: 'clock' },
        { key: 'yesterday', label: this.$t('sysStatus.yesterdayUpload'), value: n(s.yesterday), icon: 'history' },
        { key: 'week', label: this.$t('sysStatus.weekUpload'), value: n(s.week), icon: 'chart-line' },
        { key: 'month', label: this.$t('sysStatus.monthUpload'), value: n(s.month), icon: 'chart-bar' },
        { key: 'year', label: this.$t('sysStatus.yearUpload'), value: n(s.year), icon: 'chart-bar' }
      ].map((b) => ({ ...b, clickable: true, tip: this.$t('sysStatus.viewHistoryTip'), query: { range: b.key } }))
      return [
        ...uploadBadges,
        {
          key: 'totalSize',
          label: this.$t('sysStatus.totalSize'),
          value: this.formatBytes(s.totalSize),
          icon: 'database',
          clickable: false
        },
        {
          key: 'folderCount',
          label: this.$t('sysStatus.folderCount'),
          value: n(s.folderCount),
          icon: 'folder-open',
          clickable: false
        },
        {
          // 访问次数（v2.3.0）：新标签打开访问记录管理页
          key: 'totalViews',
          label: this.$t('sysStatus.totalViews'),
          value: n(s.totalViews),
          icon: 'eye',
          clickable: true,
          action: 'access',
          tip: this.$t('sysStatus.viewAccessLogTip')
        }
      ]
    },
    indexedFileCount() {
      return Number(this.indexInfo.totalFiles || 0)
    },
    uploadChannelCount() {
      return Object.keys(this.indexInfo.channelStats || {}).length
    },
    systemHealthState() {
      if (this.indexInfoError) return 'attention'
      if (!this.indexInfoLoaded) return 'checking'
      return 'healthy'
    },
    systemHealthLabel() {
      return this.$t(`sysStatus.health${this.systemHealthState.charAt(0).toUpperCase()}${this.systemHealthState.slice(1)}`)
    },
    greetingTitle() {
      const hour = this.currentTime.getHours()
      if (hour < 5) return this.$t('sysStatus.greetingLateNight')
      if (hour < 11) return this.$t('sysStatus.greetingMorning')
      if (hour < 14) return this.$t('sysStatus.greetingNoon')
      if (hour < 18) return this.$t('sysStatus.greetingAfternoon')
      if (hour < 23) return this.$t('sysStatus.greetingEvening')
      return this.$t('sysStatus.greetingLateNight')
    },
    systemStatusSummary() {
      if (this.indexInfoError) return this.$t('sysStatus.summaryUnavailable')
      if (!this.indexInfoLoaded) return this.$t('sysStatus.summaryChecking')
      if (this.indexedFileCount === 0) return this.$t('sysStatus.summaryEmpty')
      if (this.uploadChannelCount === 0) {
        return this.$t('sysStatus.summaryIndexed', {
          files: this.indexedFileCount.toLocaleString(this.currentLocale)
        })
      }
      return this.$t('sysStatus.summaryHealthy', {
        files: this.indexedFileCount.toLocaleString(this.currentLocale),
        channels: this.uploadChannelCount.toLocaleString(this.currentLocale)
      })
    },
    currentDateLabel() {
      return new Intl.DateTimeFormat(this.currentLocale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }).format(this.currentTime)
    },
    currentTimeLabel() {
      return new Intl.DateTimeFormat(this.currentLocale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(this.currentTime)
    },
    timeZoneLabel() {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || this.$t('sysStatus.localTimezone')
      const offsetMinutes = -this.currentTime.getTimezoneOffset()
      const sign = offsetMinutes >= 0 ? '+' : '-'
      const absoluteMinutes = Math.abs(offsetMinutes)
      const hours = Math.floor(absoluteMinutes / 60)
      const minutes = absoluteMinutes % 60
      const offset = minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`
      return `${timeZone} · ${offset}`
    },
    // 渠道分布图表数据
    channelChartData() {
      const stats = this.indexInfo.channelStats || {}
      return {
        labels: Object.keys(stats),
        datasets: [{
          data: Object.values(stats),
          backgroundColor: this.channelColors.slice(0, Object.keys(stats).length),
          borderWidth: 0
        }]
      }
    },
    // 上传接口分布图表数据（v2.8.5）
    sourceChartData() {
      const stats = this.indexInfo.uploadSourceStats || {}
      return {
        labels: Object.keys(stats),
        datasets: [{
          data: Object.values(stats),
          backgroundColor: this.channelColors.slice(0, Object.keys(stats).length),
          borderWidth: 0
        }]
      }
    },
    // 上传类型分布图表数据（v2.8.5）
    mimeChartData() {
      const stats = this.indexInfo.mimeStats || {}
      return {
        labels: Object.keys(stats),
        datasets: [{
          data: Object.values(stats),
          backgroundColor: this.typeColors.slice(0, Object.keys(stats).length),
          borderWidth: 0
        }]
      }
    },
    // 上传用户分布图表数据
    userChartData() {
      const stats = this.indexInfo.userStats || {}
      return {
        labels: Object.keys(stats),
        datasets: [{
          data: Object.values(stats),
          backgroundColor: this.typeColors.slice(0, Object.keys(stats).length),
          borderWidth: 0
        }]
      }
    },
    // 文件状态图表数据 - 将Block映射为"已屏蔽"，其余为"正常"
    typeChartData() {
      const aggregatedStats = this.aggregatedTypeStats
      return {
        labels: Object.keys(aggregatedStats),
        datasets: [{
          data: Object.values(aggregatedStats),
          backgroundColor: this.typeColors.slice(0, Object.keys(aggregatedStats).length),
          borderWidth: 0
        }]
      }
    },
    // 聚合后的状态统计：Block -> 已屏蔽，其余 -> 正常
    aggregatedTypeStats() {
      const stats = this.indexInfo.typeStats || {}
      const aggregatedStats = {}
      for (const [status, count] of Object.entries(stats)) {
        const mappedStatus = status === 'Block' ? this.$t('sysStatus.blocked') : this.$t('sysStatus.normalStatus')
        aggregatedStats[mappedStatus] = (aggregatedStats[mappedStatus] || 0) + count
      }
      return aggregatedStats
    },
    // 当前趋势维度数据
    currentTrendGroup() {
      const trend = this.indexInfo.uploadTrend || {}
      const groupBy = trend.groupBy || {}
      return groupBy[this.trendGroupBy] || { series: [] }
    },
    // 趋势图原始日期标签
    trendRawLabels() {
      const trend = this.indexInfo.uploadTrend || {}
      return trend.labels || []
    },
    // 当前范围是否跨年
    trendRangeCrossesYear() {
      const years = new Set()
      this.trendRawLabels.forEach(label => {
        this.extractTrendLabelDates(label).forEach(date => years.add(date.year))
      })
      return years.size > 1
    },
    // 用于横轴展示的短日期标签
    trendDisplayLabels() {
      return this.trendRawLabels.map(label => this.formatTrendAxisLabel(label))
    },
    // 是否存在趋势图数据
    hasTrendData() {
      const trend = this.indexInfo.uploadTrend || {}
      return (trend.labels || []).length > 0
    },
    // 日期选择弹窗宽度保持与项目内其他弹窗一致
    trendDateDialogWidth() {
      return window.innerWidth > 768 ? '420px' : '90%'
    },
    // 上传趋势折线图数据
    uploadTrendChartData() {
      const trend = this.indexInfo.uploadTrend || {}
      const series = this.currentTrendGroup.series || []
      const totalColor = '#F97316'
      return {
        labels: this.trendDisplayLabels,
        datasets: [
          {
            label: this.$t('sysStatus.totalUploads'),
            data: trend.total || [],
            borderColor: totalColor,
            backgroundColor: this.hexToRgba(totalColor, 0.1),
            pointBackgroundColor: totalColor,
            pointBorderColor: totalColor,
            borderWidth: 3,
            pointRadius: 2,
            pointHoverRadius: 5,
            tension: 0.28,
            fill: false
          },
          ...series.map((item, index) => {
            const color = this.getTrendColor(index)
            return {
              label: this.formatTrendSeriesName(item),
              data: item.data || [],
              borderColor: color,
              backgroundColor: this.hexToRgba(color, 0.12),
              pointBackgroundColor: color,
              pointBorderColor: color,
              borderWidth: 2,
              pointRadius: 2,
              pointHoverRadius: 5,
              tension: 0.32,
              fill: false
            }
          })
        ]
      }
    },
    // 折线图配置
    lineChartOptions() {
      const textColor = '#64748B'
      // 窄屏（移动端）：坐标轴刻度与图例文字等比缩小，避免密集标签糊成一团
      const narrow = typeof window !== 'undefined' && window.innerWidth <= 768
      const fontSize = narrow ? 10 : 12
      return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              boxHeight: 8,
              padding: narrow ? 10 : 16,
              font: { size: fontSize },
              color: textColor
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              title: (items) => {
                const index = items?.[0]?.dataIndex
                return this.trendRawLabels[index] || ''
              },
              label: (context) => {
                const parsed = context.parsed || {}
                const value = parsed.y !== undefined ? parsed.y : context.raw
                return ` ${context.dataset.label}: ${Number(value || 0).toLocaleString()} ${this.$t('sysStatus.uploadsUnit')}`
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: textColor,
              font: { size: fontSize },
              maxTicksLimit: narrow ? 5 : 8,
              autoSkip: true
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(148, 163, 184, 0.18)'
            },
            ticks: {
              color: textColor,
              font: { size: fontSize },
              precision: 0,
              callback: (value) => Number(value).toLocaleString()
            }
          }
        }
      }
    },
    // 图表配置
    chartOptions() {
      return {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '65%',
        hoverOffset: 8,
        layout: {
          padding: 10
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            z: 100,
            callbacks: {
              label: (context) => {
                const value = context.raw
                const total = context.dataset.data.reduce((a, b) => a + b, 0)
                const percentage = ((value / total) * 100).toFixed(1)
                return ` ${value.toLocaleString()} (${percentage}%)`
              }
            }
          }
        },
        animation: {
          animateRotate: true,
          animateScale: true
        }
      }
    },
    // 预计剩余时间
    estimatedTimeRemaining() {
      if (!this.isProcessing || !this.processingStartTime) return ''
      if (this.processingProgress.current === 0 || this.processingProgress.percentage === 0) return ''
      
      const elapsed = Date.now() - this.processingStartTime
      const progress = this.processingProgress.percentage / 100
      if (progress <= 0) return ''
      
      const totalEstimated = elapsed / progress
      const remaining = totalEstimated - elapsed
      
      if (remaining <= 0) return this.$t('sysStatus.aboutToComplete')
      
      const seconds = Math.ceil(remaining / 1000)
      if (seconds < 60) return this.$t('sysStatus.seconds', { count: seconds })
      const minutes = Math.ceil(seconds / 60)
      if (minutes < 60) return this.$t('sysStatus.minutes', { count: minutes })
      const hours = Math.floor(minutes / 60)
      const remainingMinutes = minutes % 60
      return this.$t('sysStatus.hoursMinutes', { hours, minutes: remainingMinutes })
    },
    // 处理阶段描述
    phaseDescription() {
      const phaseMap = {
        'fetching': this.$t('sysStatus.phaseFetching'),
        'sorting': this.$t('sysStatus.phaseSorting'),
        'uploading': this.$t('sysStatus.phaseUploading'),
        'finalizing': this.$t('sysStatus.phaseFinalizing'),
        'building': this.$t('sysStatus.phaseBuilding'),
        'downloading': this.$t('sysStatus.phaseDownloading'),
        'restoring_files': this.$t('sysStatus.phaseRestoringFiles'),
        'restoring_settings': this.$t('sysStatus.phaseRestoringSettings'),
        'completed': this.$t('sysStatus.phaseCompleted'),
        'retrying': this.$t('sysStatus.phaseRetrying')
      }
      return phaseMap[this.processingPhase] || this.processingPhase
    }
  },
  mounted() {
    this.fetchIndexInfo()
    this.fetchAccessRecent()
    this.clockTimer = window.setInterval(() => {
      this.currentTime = new Date()
    }, 1000)
    // v1.1.9.2：趋势预览的「选择日期」弹窗纳入层叠监测
    this._unbindLayerDialogs = bindDialogLayers(this, {
      trendDatePickerVisible: 'sys-status-trend-date'
    })
  },
  beforeUnmount() {
    if (this.clockTimer) {
      window.clearInterval(this.clockTimer)
      this.clockTimer = null
    }
    if (this._unbindLayerDialogs) {
      this._unbindLayerDialogs()
      this._unbindLayerDialogs = null
    }
  },
  methods: {
    /**
     * v3.0.0（R11）：模板里直接调用注入的 thumbUrl ——
     * Options API 模板只能访问组件实例上的成员，模块作用域里的函数必须挂到 methods，
     * 否则渲染时报 "thumbUrl is not a function"（图片全挂）。
     */
    thumbUrl,
    // 获取渠道图表颜色
    getChartColor(index) {
      return this.channelColors[index % this.channelColors.length]
    },
    // 获取状态图表颜色
    getTypeChartColor(index) {
      return this.typeColors[index % this.typeColors.length]
    },
    // 获取趋势图表颜色
    getTrendColor(index) {
      return this.trendColors[index % this.trendColors.length]
    },
    // 格式化趋势序列名称
    /** 上传接口展示名（Default / Upload / Fetch / StoreIn / StoreOut / WebDAV / API-Web / API-S3 → 文案） */
    uploadSourceLabel(raw) {
      const key = String(raw || '')
      const map = {
        Default: 'filter.uploadSourceDefault',
        Upload: 'filter.uploadSourceUpload',
        Fetch: 'filter.uploadSourceFetch',
        StoreIn: 'filter.uploadSourceStoreIn',
        StoreOut: 'filter.uploadSourceStoreOut',
        Record: 'filter.uploadSourceRecord',
        WebDAV: 'filter.uploadSourceWebdav',
        'API-Web': 'filter.uploadSourceApiWeb',
        'API-S3': 'filter.uploadSourceApiS3'
      }
      return map[key] ? this.$t(map[key]) : key || this.$t('sysStatus.unknown')
    },
    /** 上传类型展示名（image / video / audio / txt / pdf / other） */
    fileTypeLabel(raw) {
      const key = String(raw || '')
      const map = {
        image: 'filter.image',
        video: 'filter.video',
        audio: 'filter.audio',
        txt: 'filter.txt',
        pdf: 'filter.pdf',
        other: 'filter.other'
      }
      return map[key] ? this.$t(map[key]) : key || this.$t('sysStatus.unknown')
    },
    formatTrendSeriesName(series) {
      if (series?.isOther || series?.name === '__other__') {
        return this.$t('sysStatus.otherChannels')
      }
      const name = series?.name || this.$t('sysStatus.unknown')
      // 新增维度：上传接口 / 上传类型的原始值是英文枚举，展示前翻译一下
      if (this.trendGroupBy === 'uploadSource') return this.uploadSourceLabel(name)
      if (this.trendGroupBy === 'mime') return this.fileTypeLabel(name)
      return name
    },
    // 十六进制颜色转换为 rgba
    hexToRgba(hex, alpha) {
      const normalized = (hex || '').replace('#', '')
      if (normalized.length !== 6) {
        return `rgba(37, 99, 235, ${alpha})`
      }
      const r = parseInt(normalized.slice(0, 2), 16)
      const g = parseInt(normalized.slice(2, 4), 16)
      const b = parseInt(normalized.slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    },
    // 提取趋势标签中的日期
    extractTrendLabelDates(label) {
      const matches = String(label || '').match(/\d{4}-\d{2}-\d{2}/g) || []
      return matches.map(item => {
        const [year, month, day] = item.split('-').map(Number)
        return { year, month, day }
      })
    },
    // 横轴日期标签按范围简化，仅跨年时显示年份
    formatTrendAxisLabel(label) {
      const dates = this.extractTrendLabelDates(label)
      if (dates.length === 0) return label

      const formatSingleDate = (date, includeYear) => {
        const monthDay = `${date.month}/${date.day}`
        return includeYear ? `${date.year}/${monthDay}` : monthDay
      }

      if (dates.length === 1) {
        return formatSingleDate(dates[0], this.trendRangeCrossesYear)
      }

      const [startDate, endDate] = dates
      if (!this.trendRangeCrossesYear) {
        return `${formatSingleDate(startDate, false)}-${formatSingleDate(endDate, false)}`
      }

      const endLabel = startDate.year === endDate.year
        ? formatSingleDate(endDate, false)
        : formatSingleDate(endDate, true)
      return `${formatSingleDate(startDate, true)}-${endLabel}`
    },
    // 打开居中的日期范围选择弹窗
    openTrendDateDialog() {
      this.trendDatePickerVisible = true
    },
    // 日期范围变更后重新拉取趋势数据
    handleTrendDateRangeChange(value) {
      if (!Array.isArray(value) || value.length !== 2 || !value[0] || !value[1]) {
        return
      }

      this.trendDatePickerVisible = false
      this.fetchIndexInfo()
    },
    // 获取趋势查询参数
    getTrendDateRangeParams() {
      if (!Array.isArray(this.trendDateRange) || this.trendDateRange.length !== 2) {
        this.trendDateRange = getDefaultTrendDateRange()
      }
      return {
        startDate: this.trendDateRange[0],
        endDate: this.trendDateRange[1]
      }
    },
    // 获取索引信息
    async fetchIndexInfo() {
      this.loading = true
      this.indexInfoError = false
      try {
        const { startDate, endDate } = this.getTrendDateRangeParams()
        const params = new URLSearchParams({
          action: 'info',
          timezoneOffset: String(new Date().getTimezoneOffset()),
          trendMaxPoints: '90',
          trendSeriesLimit: '8',
          trendStartDate: startDate,
          trendEndDate: endDate
        })
        const response = await fetchWithAuth(`/api/manage/list?${params.toString()}`, {
          method: 'GET'
        })
        
        if (response.ok) {
          const data = await response.json()
          this.indexInfo = data
          this.indexInfoLoaded = true
        } else {
          throw new Error('API请求失败')
        }
      } catch (error) {
        console.error('获取索引信息失败:', error)
        this.indexInfoError = true
        this.$message.error(this.$t('sysStatus.fetchIndexFailed'))
      } finally {
        this.loading = false
      }
    },

    // 重建索引 - 使用前端辅助重建流程
    async rebuildIndex() {
      if (this.isProcessing) {
        this.$message.warning(this.$t('sysStatus.operationInProgress'))
        return
      }
      
      this.rebuilding = true
      this.isProcessing = true
      this.processingError = null
      this.processingStartTime = Date.now()
      this.processingProgress = { current: 0, total: 0, message: '', percentage: 0 }
      
      // 创建 IndexRebuilder 实例
      this.currentRebuilder = new IndexRebuilder({
        onProgress: (progress) => this.handleProgress(progress),
        onError: (error) => this.handleError(error)
      })
      
      try {
        const result = await this.currentRebuilder.rebuild()
        
        // 成功完成
        this.$message.success(this.$t('sysStatus.rebuildSuccess', { count: result.totalFiles.toLocaleString() }))
        
        // 刷新索引信息
        setTimeout(() => {
          this.fetchIndexInfo()
        }, 1000)
      } catch (error) {
        // 错误处理
        if (error.code !== 'ABORTED') {
          const errorMessage = error.suggestion 
            ? `${error.message}。${error.suggestion}`
            : error.message
          this.$message.error(errorMessage)
          this.processingError = {
            message: error.message,
            suggestion: error.suggestion,
            recoverable: error.recoverable
          }
        }
      } finally {
        this.rebuilding = false
        this.isProcessing = false
        this.currentRebuilder = null
        this.processingStartTime = null
      }
    },

    // 配置备份（v2.8.5：只导出配置项，不再遍历文件记录）
    async backupData() {
      if (this.isProcessing) {
        this.$message.warning(this.$t('sysStatus.operationInProgress'))
        return
      }
      
      this.backing = true
      this.isProcessing = true
      this.processingError = null
      this.processingStartTime = Date.now()
      this.processingProgress = { current: 0, total: 0, message: '', percentage: 0 }
      
      // 创建 BackupGenerator 实例
      this.currentBackupGenerator = new BackupGenerator({
        onProgress: (progress) => this.handleProgress(progress)
      })
      
      try {
        const result = await this.currentBackupGenerator.generateBackup()
        
        // 成功完成（配置备份：只报配置项数量）
        const settingsMsg = result.settingsCount > 0
          ? this.$t('sysStatus.backupSuccessWithSettings', { settingsCount: result.settingsCount })
          : this.$t('sysStatus.backupSuccess', { count: result.settingsCount })
        this.$message.success(settingsMsg)
      } catch (error) {
        // 错误处理
        if (error.code !== 'ABORTED') {
          const errorMessage = error.suggestion 
            ? `${error.message}。${error.suggestion}`
            : error.message
          this.$message.error(errorMessage)
          this.processingError = {
            message: error.message,
            suggestion: error.suggestion,
            recoverable: error.recoverable
          }
        }
      } finally {
        this.backing = false
        this.isProcessing = false
        this.currentBackupGenerator = null
        this.processingStartTime = null
      }
    },

    // 选择恢复文件
    selectRestoreFile() {
      if (this.restoring) return
      this.$refs.fileInput.click()
    },

    // 处理文件选择
    async handleFileSelect(event) {
      const file = event.target.files[0]
      if (!file) return

      if (!file.name.endsWith('.json')) {
        this.$message.error(this.$t('sysStatus.selectJsonFile'))
        return
      }

      // 确认恢复操作
      try {
        await this.$confirm(
          this.$t('sysStatus.restoreConfirmMessage'),
          this.$t('sysStatus.restoreConfirmTitle'),
          {
            confirmButtonText: this.$t('sysStatus.restoreConfirmOk'),
            cancelButtonText: this.$t('sysStatus.restoreConfirmCancel'),
            type: 'warning'
          }
        )
        
        await this.restoreData(file)
      } catch (error) {
        if (error !== 'cancel') {
          console.error('确认恢复失败:', error)
        }
      }
      
      // 清除文件选择
      event.target.value = ''
    },

    // 恢复数据 - 使用前端辅助分批恢复流程
    async restoreData(file) {
      if (this.isProcessing) {
        this.$message.warning(this.$t('sysStatus.operationInProgress'))
        return
      }

      this.restoring = true
      this.isProcessing = true
      this.processingError = null
      this.processingStartTime = Date.now()
      this.processingProgress = { current: 0, total: 0, message: '', percentage: 0 }

      try {
        // 解析备份文件
        const fileContent = await file.text()
        let backupData
        try {
          backupData = JSON.parse(fileContent)
        } catch (parseError) {
          throw new Error(this.$t('sysStatus.invalidBackupFile'))
        }

        // 创建 RestoreProcessor 实例
        this.currentRestoreProcessor = new RestoreProcessor({
          chunkSize: 100, // 每批恢复 100 条
          onProgress: (progress) => this.handleProgress(progress),
          onError: (error) => this.handleError(error)
        })

        const result = await this.currentRestoreProcessor.restore(backupData)

        // 恢复完成，重置恢复状态
        this.restoring = false
        this.isProcessing = false
        this.currentRestoreProcessor = null
        this.processingStartTime = null

        // 显示恢复成功消息
        this.$message.success(
          this.$t('sysStatus.restoreSuccess', { files: result.restoredFiles, settings: result.restoredSettings })
        )

        // 短暂延迟后自动开始重建索引
        await new Promise(resolve => setTimeout(resolve, 500))
        await this.rebuildIndex()
      } catch (error) {
        console.error('恢复配置失败:', error)
        
        // 出错时重置状态
        this.restoring = false
        this.isProcessing = false
        this.currentRestoreProcessor = null
        this.processingStartTime = null
        
        if (error.code !== 'ABORTED') {
          const errorMessage = error.suggestion
            ? `${error.message}。${error.suggestion}`
            : error.message
          this.$message.error(this.$t('sysStatus.restoreFailed') + ': ' + errorMessage)
          this.processingError = {
            message: error.message,
            suggestion: error.suggestion,
            recoverable: error.recoverable
          }
        }
      }
    },

    // 格式化时间
    formatTime(timestamp) {
      if (!timestamp) return this.$t('sysStatus.unknown')
      const date = new Date(timestamp)
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    },

    // 计算百分比
    getPercentage(value, total) {
      if (!total || total === 0) return 0
      return Math.round((value / total) * 100)
    },

    // 计算时间差
    getTimeAgo(timestamp) {
      if (!timestamp) return ''
      const now = Date.now()
      const diff = now - timestamp
      const minutes = Math.floor(diff / 60000)
      const hours = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)
      
      if (days > 0) return this.$t('sysStatus.daysAgo', { count: days })
      if (hours > 0) return this.$t('sysStatus.hoursAgo', { count: hours })
      if (minutes > 0) return this.$t('sysStatus.minutesAgo', { count: minutes })
      return this.$t('sysStatus.justNow')
    },
    
    // 图片加载失败处理
    handleImageError(type) {
      this.loadErrors[type] = true
    },
    
    // 检查是否应该显示预览图
    isValidPreview(type, file) {
      if (this.loadErrors[type]) return false
      if (!file?.metadata?.FileType) return false
      return file.metadata.FileType.includes('image') || file.metadata.FileType.includes('video')
    },
    
    // 打开发布页面（跳转 GitHub 仓库）
    openReleases() {
      // 「系统版本」→ GitHub Releases（新标签打开）
      const url = 'https://github.com/hqh519/go-hub/releases'
      window.open(url, '_blank', 'noopener')
    },
    
    // 判断是否为图片文件
    isImageFile(file) {
      if (!file) return false
      // 优先通过 FileType 判断
      if (file.metadata?.FileType?.includes('image')) return true
      // 通过文件名后缀判断
      const fileName = file.metadata?.FileName || file.id || ''
      const extension = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase()
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif', 'heic', 'heif']
      return imageExtensions.includes(extension)
    },
    
    // 判断是否为视频文件
    isVideoFile(file) {
      if (!file) return false
      // 优先通过 FileType 判断
      if (file.metadata?.FileType?.includes('video')) return true
      // 通过文件名后缀判断
      const fileName = file.metadata?.FileName || file.id || ''
      const extension = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase()
      const videoExtensions = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'flv', 'wmv', 'mkv', 'm4v', '3gp', 'mpeg', 'mpg']
      return videoExtensions.includes(extension)
    },
    
    // 在新窗口打开文件（使用带域名的完整链接）
    openFileInNewTab(file) {
      if (!file?.id) return
      window.open(this.fileUrl(file), '_blank')
    },

    /**
     * 点击「最近上传」缩略图 → 打开文件详情（统一入口 FileDetailUnified）。
     * 先用列表本地数据秒开，再走统一加载器补齐全量 metadata。
     */
    async openRecentDetail(file) {
      if (!file?.id) return
      const record = { name: file.id, metadata: file.metadata || {} }
      this.recentDetail = record
      this.showRecentDetail = true
      try {
        const detail = await loadFileDetail(file.id, { record, refresh: true })
        if (detail && this.showRecentDetail && this.recentDetail?.name === file.id) {
          this.recentDetail = { name: detail.file.name, metadata: detail.file.metadata || {} }
        }
      } catch (e) {
        console.warn('[status] 获取文件详情失败:', e)
      }
    },

    /** 统一详情组件里删除了文件：从「最近上传」列表同步移除 */
    handleRecentDeleted(fileId) {
      if (!fileId || !Array.isArray(this.indexInfo.recentFiles)) return
      this.indexInfo.recentFiles = this.indexInfo.recentFiles.filter((f) => f.id !== fileId)
    },

    /** 统一详情组件里重命名了 File_ID：同步「最近上传」列表项 */
    handleRecentRenamed(oldFileId, newFileId, metadata) {
      const list = this.indexInfo.recentFiles
      if (!Array.isArray(list)) return
      const it = list.find((f) => f.id === oldFileId)
      if (it) {
        it.id = newFileId
        it.name = newFileId
        if (metadata) it.metadata = { ...it.metadata, ...metadata }
      }
    },

    /** 文件外链：全站统一出口（自定义访问域名优先）+ 扩展名（不再附加 ?from=admin） */
    fileUrl(file) {
      if (!file?.id) return ''
      return fileLink(file.id, file.metadata?.FileExt ? `.${file.metadata.FileExt}` : '')
    },

    /** 跳转到「历史记录」页（新标签打开，可带查询参数定位） */
    goHistory(query = {}) {
      const url = this.$router.resolve({ name: 'history', query }).href
      window.open(url, '_blank', 'noopener')
    },

    /**
     * 统计徽章点击（v2.3.0）：上传类跳历史记录，「访问次数」跳访问记录管理页。
     * 两种跳转都用新标签打开，不打断当前状态页的浏览位置。
     */
    onBadgeClick(badge) {
      if (!badge?.clickable) return
      if (badge.action === 'access') return this.openAccessLog()
      return this.goHistory(badge.query || {})
    },

    /** 拉取最近 20 条访问记录（系统状态页的「访问记录」功能块） */
    async fetchAccessRecent() {
      try {
        const res = await fetchWithAuth('/api/manage/access/recent?take=20')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json().catch(() => ({}))
        const list = body?.data
        this.accessRecent = Array.isArray(list) ? list : []
      } catch {
        this.accessRecent = []
      }
    },

    /**
     * 打开「访问记录」管理页（新标签）。
     * 从某条记录点进来时带上该记录的 IP，管理页会自动按 IP 过滤，
     * 相当于「点这条记录 → 看这个访客的全部足迹」。
     */
    openAccessLog(row) {
      const query = {}
      if (row && typeof row === 'object' && row.ip) query.ip = row.ip
      const url = this.$router.resolve({ name: 'accessLog', query }).href
      window.open(url, '_blank', 'noopener')
    },

    /**
     * v2.8.7：打开「最近记录」（历史记录）页 —— 系统状态「最近上传」右侧的查看全部。
     * 新标签页打开，行为与上方访问记录的「查看全部」一致。
     */
    openRecentUploads() {
      const url = this.$router.resolve({ name: 'history' }).href
      window.open(url, '_blank', 'noopener')
    },

    /** 停留时长（访问记录用）：<1 分钟按秒显示 */
    formatStay(ms) {
      const n = Number(ms || 0)
      if (!n) return '-'
      if (n < 1000) return `${n} ms`
      const sec = Math.round(n / 1000)
      if (sec < 60) return `${sec}s`
      const min = Math.floor(sec / 60)
      const rest = sec % 60
      return rest ? `${min}m${rest}s` : `${min}m`
    },

    /** 访问记录时间：MM-DD HH:mm:ss（列表里空间紧张，不带年份） */
    formatAccessTime(ts) {
      const d = new Date(Number(ts) || 0)
      if (!Number.isFinite(d.getTime()) || !ts) return '-'
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    },

    /** 跳转到「文件管理」页并定位到文件所在目录（新标签打开） */
    goFileManage(file) {
      const dir = String(file?.metadata?.Directory || '').replace(/\/+$/, '')
      sessionStorage.setItem('dashboardInitialFolder', dir)
      const url = this.$router.resolve({ name: 'dashboard' }).href
      window.open(url, '_blank', 'noopener')
    },

    /** 字节 → 可读体积 */
    formatBytes(bytes) {
      const n = Number(bytes || 0)
      if (!Number.isFinite(n) || n <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
      let i = 0
      let v = n
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i += 1
      }
      return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(2)} ${units[i]}`
    },
    
    // 处理进度更新
    handleProgress(progress) {
      this.processingPhase = progress.phase
      this.processingProgress.message = progress.message || ''
      this.processingProgress.current = progress.current || 0
      
      // 根据不同阶段计算进度百分比
      if (progress.phase === 'fetching') {
        // 获取阶段：基于已获取的记录数估算（假设总数未知时显示已获取数量）
        this.processingProgress.total = progress.total || 0
        // 获取阶段占总进度的 60%
        if (progress.total && progress.total > 0) {
          this.processingProgress.percentage = Math.min(60, (progress.current / progress.total) * 60)
        } else {
          // 未知总数时，使用对数增长模拟进度
          this.processingProgress.percentage = Math.min(50, Math.log10(progress.current + 1) * 15)
        }
      } else if (progress.phase === 'sorting') {
        // 排序阶段：占 60-70%
        this.processingProgress.percentage = 65
        this.processingProgress.total = progress.total || this.processingProgress.total
      } else if (progress.phase === 'uploading') {
        // 上传阶段：占 70-95%
        this.processingProgress.total = progress.total || 0
        if (progress.total && progress.total > 0) {
          this.processingProgress.percentage = 70 + (progress.current / progress.total) * 25
        }
      } else if (progress.phase === 'finalizing') {
        // 完成阶段：95-100%
        this.processingProgress.percentage = 97
      } else if (progress.phase === 'building') {
        // 构建备份阶段：70-90%
        this.processingProgress.percentage = 80
      } else if (progress.phase === 'downloading') {
        // 下载阶段：90-100%
        this.processingProgress.percentage = 95
      } else if (progress.phase === 'restoring_files') {
        // 恢复文件阶段：0-80%
        this.processingProgress.total = progress.total || 0
        this.processingProgress.percentage = progress.percentage || 0
      } else if (progress.phase === 'restoring_settings') {
        // 恢复设置阶段：80-100%
        this.processingProgress.total = progress.total || 0
        this.processingProgress.percentage = progress.percentage || 80
      } else if (progress.phase === 'completed') {
        // 完成
        this.processingProgress.percentage = 100
      } else if (progress.phase === 'retrying') {
        // 重试阶段：保持当前进度
        this.processingProgress.message = progress.message
      }
    },
    
    // 处理错误
    handleError(error) {
      console.error('批量操作错误:', error)
      this.processingError = {
        message: error.message,
        suggestion: error.suggestion,
        recoverable: error.recoverable
      }
    },
    
    // 取消当前操作
    cancelOperation() {
      if (this.currentRebuilder) {
        this.currentRebuilder.abort()
        this.$message.info(this.$t('sysStatus.cancellingRebuild'))
      }
      if (this.currentBackupGenerator) {
        this.currentBackupGenerator.abort()
        this.$message.info(this.$t('sysStatus.cancellingRebuild'))
      }
      if (this.currentRestoreProcessor) {
        this.currentRestoreProcessor.abort()
        this.$message.info(this.$t('sysStatus.cancellingRebuild'))
      }
    },
    
    // 重试操作
    retryOperation() {
      this.processingError = null
      if (this.rebuilding) {
        this.rebuilding = false
        this.isProcessing = false
        this.$nextTick(() => {
          this.rebuildIndex()
        })
      } else if (this.backing) {
        this.backing = false
        this.isProcessing = false
        this.$nextTick(() => {
          this.backupData()
        })
      }
    },
    
    // 关闭错误提示
    dismissError() {
      this.processingError = null
    }
  }
}
</script>

<style scoped>
.status-panel {
  --status-section-gap: 30px;
  background: transparent;
  min-height: 100vh;
}

/* 动态问候与系统运行摘要 */
.status-hero {
  --hero-status-color: var(--el-color-success);
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 42px;
  margin-bottom: 8px;
  padding: 0 12px 34px;
  color: var(--admin-container-color);
}

.status-hero::before,
.status-hero::after {
  content: '';
  position: absolute;
  pointer-events: none;
  z-index: -1;
}

.status-hero::before {
  inset: 0;
  opacity: 0.34;
  background-image:
    radial-gradient(circle at 64% 52%, color-mix(in srgb, var(--primary-color) 9%, transparent), transparent 28%),
    linear-gradient(color-mix(in srgb, var(--primary-color) 16%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--primary-color) 16%, transparent) 1px, transparent 1px);
  background-size: auto, 34px 34px, 34px 34px;
  mask-image: linear-gradient(90deg, transparent 28%, #000 72%, transparent 100%);
  -webkit-mask-image: linear-gradient(90deg, transparent 28%, #000 72%, transparent 100%);
}

.status-hero::after {
  width: 150px;
  height: 150px;
  top: 50%;
  right: 31%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  filter: blur(20px);
  transform: translateY(-50%);
}

.status-hero.is-checking {
  --hero-status-color: var(--el-color-warning);
}

.status-hero.is-attention {
  --hero-status-color: var(--el-color-danger);
}

.status-hero-copy {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.status-hero-kicker {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-bottom: 15px;
}

.system-health-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  /* 运行状态统一使用蓝色字体（健康/警告/异常都保持蓝色，状态语义由文案表达） */
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, var(--glass-bg));
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 26%, var(--glass-border));
  border-radius: 999px;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
}

.system-health-dot {
  position: relative;
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  background: currentColor;
  border-radius: 50%;
  box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent);
}

.system-health-dot::after {
  content: '';
  position: absolute;
  inset: -4px;
  border: 1px solid currentColor;
  border-radius: inherit;
  animation: healthPulse 2s ease-out infinite;
}

.status-hero-date {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 550;
  line-height: 1.45;
}

.status-hero-title {
  margin: 0;
  color: var(--admin-container-color);
  font-size: clamp(28px, 3vw, 40px);
  font-weight: 750;
  line-height: 1.18;
  letter-spacing: -0.035em;
}

.status-hero-summary {
  max-width: 720px;
  margin: 12px auto 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1.7;
  text-align: center;
}

.status-hero-time-card {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 250px;
  min-width: 250px;
  padding: 12px 0 12px 32px;
  border-left: 1px solid color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
  box-sizing: border-box;
}

.status-hero-time-caption {
  color: var(--el-text-color-secondary);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.status-hero-time {
  margin-top: 7px;
  color: var(--admin-container-color);
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: -0.04em;
  white-space: nowrap;
}

.status-hero-timezone {
  margin-top: 10px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 10px;
  line-height: 1.4;
  opacity: 0.78;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes healthPulse {
  0% {
    opacity: 0.8;
    transform: scale(0.75);
  }
  75%, 100% {
    opacity: 0;
    transform: scale(1.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .system-health-dot::after {
    animation: none;
  }
}

/* 概览卡片 */
.overview-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: var(--status-section-gap);
}

.overview-card {
  background: var(--glass-bg);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  align-items: center;
  box-shadow: var(--glass-shadow);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
  will-change: transform;
}

.overview-card:hover,
.overview-card:focus-within {
  transform: translateY(-5px);
  box-shadow: 0 12px 28px color-mix(in srgb, var(--el-text-color-primary) 16%, transparent);
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--glass-border));
}

@media (prefers-reduced-motion: reduce) {
  .overview-card {
    transition: box-shadow 0.25s ease, border-color 0.25s ease;
  }

  .overview-card:hover,
  .overview-card:focus-within {
    transform: none;
  }
}

.card-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin-right: 20px;
  background: var(--primary-color);
  color: var(--el-color-white);
}

.card-content {
  flex: 1;
}

.card-title {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
  font-weight: 500;
}

.card-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--admin-container-color);
  line-height: 1;
}

.card-subtitle {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  opacity: 0.8;
}

/* 图表区域 */
.charts-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  row-gap: var(--status-section-gap);
  margin-bottom: var(--status-section-gap);
  overflow: visible;
}

.chart-card {
  background: var(--glass-bg);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--glass-shadow);
  border: 1px solid var(--glass-border);
}

.chart-card:hover {
  box-shadow: var(--glass-shadow);
}

.chart-card,
.chart-content,
.pie-chart-container,
.pie-chart-wrapper {
  overflow: visible;
}

.chart-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 20px;
  font-size: 16px;
  font-weight: 600;
  color: var(--admin-container-color);
}

.trend-chart-card {
  grid-column: 1 / -1;
}

/* 独立整行的卡片（如「文件状态分布」） */
.chart-card-full {
  grid-column: 1 / -1;
}

/* 高度降低的卡片：压缩图表与内边距，避免占据过多纵向空间 */
.chart-card-short {
  padding: 16px 24px 8px;
}
.chart-card-short .chart-header {
  margin-bottom: 10px;
}
.chart-card-short .chart-content {
  min-height: 0;
}
.chart-card-short .pie-chart-wrapper {
  max-height: 190px;
}

.trend-chart-header {
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.chart-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trend-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.trend-calendar-btn {
  width: 32px;
  min-width: 32px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--admin-container-color);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.trend-calendar-btn:hover {
  color: var(--el-color-primary);
  border-color: var(--glass-border);
  background: var(--glass-bg);
  box-shadow: none;
}

html.dark .trend-calendar-btn:hover {
  color: var(--primary-color-accent);
}

.trend-date-dialog {
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
}

.trend-date-dialog :deep(.el-dialog__body) {
  padding: 16px 24px 24px;
}

.trend-date-panel {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  overflow: hidden;
}

.trend-group-switch {
  flex-shrink: 0;
  height: 32px;
  display: flex;
}

.trend-group-switch :deep(.el-radio-button__inner) {
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 0 14px;
}

.chart-content.trend-chart-content {
  min-height: 320px;
  padding: 0;
  margin: 0;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.line-chart-scroll {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.line-chart-wrapper {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 320px;
  overflow: hidden;
}

.line-chart-wrapper :deep(canvas) {
  display: block;
  width: 100% !important;
  max-width: 100% !important;
}

.trend-empty-state {
  height: 320px;
}

.chart-content {
  min-height: 160px;
  padding: 15px;
  margin: -5px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 160px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.empty-state .fa-icon,
.empty-state .empty-icon {
  font-size: 32px;
  margin-bottom: 10px;
}

.stats-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stats-label {
  min-width: 80px;
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.stats-bar {
  flex: 1;
  height: 8px;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
}

.stats-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 4px;
  transition: width 0.6s ease;
}

.type-fill {
  background: #16A34A;
}

.stats-value {
  min-width: 50px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-container-color);
}

/* 饼状图样式 */
.pie-chart-container {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
}

.pie-chart-wrapper {
  position: relative;
  width: 180px;
  height: 180px;
  flex-shrink: 0;
  padding: 15px;
  box-sizing: content-box;
  overflow: visible;
  isolation: isolate;
}

.chart-center-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
  z-index: -1;
}

.center-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--admin-container-color);
  line-height: 1.2;
}

.center-label {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}

.chart-legend {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-width: 180px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--el-text-color-primary) 3%, transparent);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  will-change: transform;
}

.legend-item:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--primary-color) 8%, var(--glass-bg));
  border-color: color-mix(in srgb, var(--primary-color) 30%, var(--glass-border));
  box-shadow: 0 6px 16px color-mix(in srgb, var(--el-text-color-primary) 12%, transparent);
}

html.dark .legend-item {
  background: color-mix(in srgb, var(--el-text-color-primary) 5%, transparent);
}

html.dark .legend-item:hover {
  background: color-mix(in srgb, var(--primary-color) 12%, var(--glass-bg));
}

@media (prefers-reduced-motion: reduce) {
  .legend-item {
    transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .legend-item:hover {
    transform: none;
  }
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.legend-label {
  flex: 1;
  font-size: 13px;
  color: var(--admin-container-color);
  font-weight: 500;
}

.legend-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-container-color);
  min-width: 50px;
  text-align: right;
}

.legend-percent {
  font-size: 12px;
  color: #888;
  min-width: 40px;
  text-align: right;
}

/* 操作区域 */
.action-card {
  background: var(--glass-bg);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--glass-shadow);
  border: 1px solid var(--glass-border);
}

.action-card:hover {
  box-shadow: var(--glass-shadow);
}

.overview-card,
.chart-card,
.action-card {
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

.action-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  font-size: 16px;
  font-weight: 600;
  color: var(--admin-container-color);
}

.action-content {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}

.action-buttons {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.action-btn {
  border-radius: 10px;
  padding: 12px 24px;
  margin-left: 0;
  font-weight: 500;
  font-size: 14px;
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
  min-width: 150px;
  width: 150px;
  height: 48px;
  box-shadow: none;
}

@media (max-width: 768px) {
  .action-btn {
    flex: 1;
    width: auto;
    min-width: 0;
    height: auto;
  }
}

.action-btn .fa-icon {
  margin-right: 8px;
  font-size: 14px;
}

/* 重建索引：描边按钮(与备份统一) */
/* 重建索引：蓝色语义(主操作) */
.rebuild-btn {
  background: var(--el-fill-color-blank);
  border-color: var(--el-border-color-lighter);
  color: #2563EB;
}

.rebuild-btn:hover {
  background: #EFF6FF;
  border-color: #93C5FD;
  color: #1D4ED8;
}

/* 备份数据：绿色语义(安全保存) */
.backup-btn {
  background: var(--el-fill-color-blank);
  border-color: var(--el-border-color-lighter);
  color: #16A34A;
}

.backup-btn:hover {
  background: #F0FDF4;
  border-color: #86EFAC;
  color: #15803D;
}

/* 恢复数据：橙色语义(有风险) */
.restore-btn {
  background: var(--el-fill-color-blank);
  border-color: var(--el-border-color-lighter);
  color: #D97706;
}

.restore-btn:hover {
  background: #FFFBEB;
  border-color: #FCD34D;
  color: #B45309;
}

/* 深色模式 */
.dark .rebuild-btn {
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-lighter);
  color: #60A5FA;
}

.dark .rebuild-btn:hover {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(96, 165, 250, 0.4);
  color: #93C5FD;
}

.dark .backup-btn {
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-lighter);
  color: #4ADE80;
}

.dark .backup-btn:hover {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(74, 222, 128, 0.4);
  color: #86EFAC;
}

.dark .restore-btn {
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-lighter);
  color: #FBBF24;
}

.dark .restore-btn:hover {
  background: rgba(251, 191, 36, 0.12);
  border-color: rgba(251, 191, 36, 0.4);
  color: #FCD34D;
}

.restore-section {
  display: inline-block;
}

@media (max-width: 768px) {
  .action-buttons > .el-tooltip,
  .action-buttons > .restore-section,
  .restore-section {
    flex: 1;
    width: 100%;
  }
  
  .action-btn {
    width: 100% !important;
    padding: 10px 20px !important;
    box-sizing: border-box;
  }
}

/* ===== 最近上传（最近 20 条，列表形式） ===== */
.recent-upload-section {
  margin-top: var(--status-section-gap);
}

.section-header-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.section-hint {
  font-size: 12px;
  opacity: 0.6;
}

/* 区块标题右侧：提示文字 + 「查看全部」链接（v2.3.0 访问记录块） */
.section-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  flex-wrap: wrap;
}

.section-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 16px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  box-shadow: var(--glass-shadow);
  padding: 10px;
  max-height: 520px;
  overflow-y: auto;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.recent-item:hover {
  background: color-mix(in srgb, var(--el-text-color-primary) 7%, transparent);
}

.recent-thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
  opacity: 0.85;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

/* 缩略图可点击：直接打开文件详情 */
.recent-thumb:hover {
  opacity: 1;
  transform: scale(1.05);
}

.recent-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.recent-main {
  flex: 1;
  min-width: 0;
}

.recent-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.recent-name:hover,
.recent-url:hover {
  text-decoration: underline;
  opacity: 1;
}

.recent-url {
  font-size: 11px;
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: Consolas, Monaco, monospace;
}

.recent-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.8;
}

/* 上传用户 / 分类：图标 + 文本，过长省略 */
.recent-user,
.recent-category {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 170px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 可点击元素：文件名/链接 → 历史记录；分类 → 文件管理；扩展名 → 文件链接 */
.recent-url,
.recent-category,
.recent-ext-tag {
  cursor: pointer;
}

.recent-category:hover {
  color: var(--primary-color);
}

.recent-views {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.recent-size {
  min-width: 64px;
  text-align: right;
  white-space: nowrap;
}

.recent-time {
  min-width: 128px;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ===== 访问记录（v2.3.0，最近 20 条） ===== */
.access-record-section .recent-list {
  /* 访问条目高度更小，20 条一屏可见 */
  max-height: 560px;
}

.access-record-section .recent-name {
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
}

.recent-ip,
.recent-location {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.recent-ip {
  font-weight: 600;
}

.recent-location {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.75;
}

/* 访问条目没有缩略图，文件名行不再有 pointer 语义（整行都可点） */
.access-record-section .recent-name:hover,
.access-record-section .recent-url:hover {
  text-decoration: none;
}

/* ===== 统计徽章 ===== */
.stat-badge-row {
  /* 位于「文件总数」概览卡片下方、「上传趋势」上方 */
  margin: 0 0 var(--status-section-gap);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.stat-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  box-shadow: var(--glass-shadow);
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.stat-badge.is-clickable {
  cursor: pointer;
}

.stat-badge.is-clickable:hover {
  transform: translateY(-2px);
  border-color: var(--primary-color-accent);
}

.stat-badge-icon {
  font-size: 18px;
  opacity: 0.7;
}

.stat-badge-body {
  min-width: 0;
}

.stat-badge-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.stat-badge-label {
  font-size: 12px;
  opacity: 0.65;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .recent-meta .recent-size,
  .recent-meta .recent-time,
  .recent-meta .recent-category,
  .access-record-section .recent-location {
    display: none;
  }

  /* 访问记录块：标题右侧的「查看全部」独占一行，避免挤压标题 */
  .access-record-section .section-header-actions {
    margin-left: 0;
    width: 100%;
    justify-content: space-between;
  }
}

/* 文件信息区域 */
.file-info-section {
  margin-top: var(--status-section-gap);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  align-items: stretch;
}

.file-info-card {
  position: relative;
  background: var(--glass-bg);
  border-radius: 16px;
  box-shadow: var(--glass-shadow);
  border: 1px solid var(--glass-border);
  transition: all 0.3s ease;
  height: 300px;
  overflow: hidden;
  cursor: pointer;
}

/* 图片/视频占满整个卡片 */
.card-bg-media {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
  display: block;
}

/* 确保 el-image 内部图片撑满容器 */
.card-bg-media:deep(.el-image__inner) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-bg-media:deep(.el-image__wrapper) {
  width: 100%;
  height: 100%;
}

.card-bg-fallback {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--admin-dashborad-stats-bg-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.fallback-icon {
  font-size: 80px;
  color: var(--el-text-color-placeholder);
  opacity: 0.3;
}

/* 文件卡片标题 - 浮层在顶部 */
.file-card-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: white;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.2) 55%, transparent 100%);
  z-index: 2;
}

.file-card-header .fa-icon {
  color: #60A5FA;
}

.file-card-header.warning .fa-icon {
  color: #F59E0B;
}

/* 底部文件信息 - 浮层在底部 */
.info-card-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 16px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0.25) 50%, transparent 100%);
  text-align: center;
  z-index: 2;
}

.info-card-footer .file-name {
  font-size: 14px;
  color: white;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.info-card-footer .file-meta {
  font-size: 12px;
  color: #FAFAFA;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

/* 大屏幕上增大图片卡片高度 */
@media (min-width: 1200px) {
  .file-info-card {
    height: 400px;
  }
}

@media (min-width: 1600px) {
  .file-info-card {
    height: 450px;
  }
}

.file-info-card:hover {
  box-shadow: var(--glass-shadow);
}

.file-info-card:hover .card-bg-media {
  transform: scale(1);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .status-hero {
    grid-template-columns: 1fr;
    gap: 18px;
    padding: 0 8px 30px;
  }

  .status-hero-time-card {
    width: 100%;
    min-width: 0;
    padding: 18px 0 0;
    border-top: 1px solid color-mix(in srgb, var(--el-text-color-primary) 10%, transparent);
    border-left: 0;
  }

  .status-hero-time {
    font-size: 32px;
  }
  
  .overview-cards {
    grid-template-columns: 1fr;
    gap: 15px;
  }
  
  .charts-section {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  /* 图表卡片：缩小内边距与圆角，把宽度让给图表本身 */
  .chart-card {
    padding: 14px 12px;
    border-radius: 12px;
  }

  .chart-card-short {
    padding: 12px 12px 6px;
  }

  .chart-header {
    margin-bottom: 12px;
    font-size: 14px;
  }

  /* 饼图：固定 180px 的圆在窄屏太挤，等比缩小并收紧间距 */
  .pie-chart-container {
    gap: 14px;
  }

  .pie-chart-wrapper {
    width: 150px;
    height: 150px;
    padding: 10px;
  }

  .chart-card-short .pie-chart-wrapper {
    max-height: 160px;
  }

  .trend-chart-header {
    align-items: stretch;
  }

  .chart-title {
    width: 100%;
  }

  .trend-controls {
    width: 100%;
    justify-content: stretch;
    /* v2.8.6：5 个分组标签在窄屏装不下时改为横向滑动查看，
       不再让 flex:1 把每个标签压扁导致文字换行、按钮错位 */
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: 2px;
  }

  .trend-controls::-webkit-scrollbar {
    display: none;
  }

  .trend-date-dialog :deep(.el-dialog__body) {
    padding: 12px 14px 18px;
  }

  .trend-group-switch {
    width: auto;
    max-width: none;
    flex: 0 0 auto;
  }

  .trend-group-switch :deep(.el-radio-button) {
    flex: 0 0 auto;
  }

  .trend-group-switch :deep(.el-radio-button__inner) {
    width: auto;
    padding: 0 12px;
    white-space: nowrap;
  }

  .line-chart-wrapper,
  .trend-empty-state {
    height: 280px;
  }
  
  .file-info-section {
    grid-template-columns: 1fr;
    gap: 15px;
  }
  
  .card-icon {
    width: 50px;
    height: 50px;
    font-size: 20px;
    margin-right: 15px;
  }
  
  .card-value {
    font-size: 24px;
  }

  .action-buttons {
    flex-direction: column;
    gap: 12px;
  }

  .action-btn {
    width: 100%;
    min-width: unset;
  }
}

@media (max-width: 480px) {
  .status-hero {
    padding: 0 4px 28px;
  }

  .status-hero-title {
    font-size: 27px;
  }

}

/* 加载动画 */
.stats-fill {
  animation: fillAnimation 1s ease-out;
}

@keyframes fillAnimation {
  from {
    width: 0;
  }
}

/* 进度显示样式 */
.progress-container {
  width: 100%;
  padding: 20px;
  text-align: center;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-phase {
  font-size: 16px;
  font-weight: 600;
  color: var(--admin-container-color);
}

.progress-percentage {
  font-size: 18px;
  font-weight: 700;
  color: var(--primary-color-accent);
}

.progress-bar {
  margin-bottom: 16px;
}

.progress-bar :deep(.el-progress-bar__outer) {
  background-color: rgba(139, 92, 246, 0.1);
  border-radius: 6px;
}

.progress-bar :deep(.el-progress-bar__inner) {
  background: var(--primary-color);
  border-radius: 6px;
  transition: width 0.3s ease;
}

.progress-details {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.progress-count,
.progress-time {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #666;
}

.progress-count .fa-icon,
.progress-time .fa-icon {
  color: var(--primary-color-accent);
  font-size: 12px;
}

.progress-message {
  font-size: 13px;
  color: #888;
  margin-bottom: 16px;
  min-height: 20px;
}

.cancel-btn {
  margin-top: 12px;
  border-radius: 10px;
  padding: 10px 24px;
  font-weight: 600;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #EF4444;
}

.cancel-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  box-shadow: none;
}

.cancel-btn .fa-icon {
  margin-right: 8px;
}

/* 错误显示样式 */
.error-container {
  width: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  background: rgba(239, 68, 68, 0.05);
  border-radius: 12px;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.error-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #EF4444;
  font-size: 24px;
}

.error-content {
  text-align: center;
}

.error-message {
  font-size: 15px;
  font-weight: 600;
  color: #EF4444;
  margin-bottom: 8px;
}

.error-suggestion {
  font-size: 13px;
  color: #666;
}

.error-actions {
  display: flex;
  gap: 12px;
}

.error-actions .el-button {
  border-radius: 10px;
  padding: 10px 24px;
  font-weight: 600;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  min-width: 100px;
}

.error-actions .el-button--primary {
  background: var(--primary-color);
  border: none;
  color: #fff;
}

.error-actions .el-button--primary:hover {
  background: var(--el-color-primary-dark-2);
  box-shadow: none;
}

.error-actions .el-button--default {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--el-text-color-regular);
}

.error-actions .el-button--default:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--glass-border-hover);
  box-shadow: none;
}

.error-actions .fa-icon {
  margin-right: 8px;
}

/* 暗色模式适配 */
html.dark .progress-count,
html.dark .progress-time {
  color: #aaa;
}

html.dark .progress-message {
  color: #999;
}

html.dark .error-container {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

html.dark .error-suggestion {
  color: #aaa;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .progress-container,
  .error-container {
    padding: 16px;
  }
  
  .progress-header {
    flex-direction: column;
    gap: 8px;
    text-align: center;
  }
  
  .progress-details {
    flex-direction: column;
    gap: 8px;
  }
  
  .error-actions {
    flex-direction: column;
    width: 100%;
  }
  
  .error-actions .el-button {
    width: 100%;
    margin: 0;
  }
}

/* ---------------------------------------------------------------------------
   移动端图表自适应：四个图表块（上传趋势 / 渠道分布 / 上传用户分布 / 文件状态分布）
   一律「按容器宽度等比缩放」，不再横向撑出滚动条，也不再把图例挤到卡片外面。
   --------------------------------------------------------------------------- */
@media (max-width: 768px) {
  .charts-section {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .chart-card {
    padding: 12px 10px;
    border-radius: 12px;
    min-width: 0;
  }

  .chart-card-short {
    padding: 10px 10px 4px;
  }

  .chart-header {
    font-size: 14px;
    margin-bottom: 10px;
  }

  /* 折线图：去掉固定 min-width，改为铺满卡片宽度 + 压低高度，坐标轴随之等比缩放 */
  .chart-content.trend-chart-content {
    min-height: 0;
  }

  .line-chart-scroll {
    overflow: hidden;
    padding-bottom: 0;
  }

  .line-chart-scroll .line-chart-wrapper {
    min-width: 0;
    width: 100%;
    height: 220px;
  }

  .trend-empty-state {
    height: 200px;
  }

  /* 饼图 + 图例：整体等比缩小，图例换行到饼图下方并占满整行宽度 */
  .pie-chart-container {
    gap: 10px;
  }

  .pie-chart-wrapper {
    width: 132px;
    height: 132px;
    padding: 8px;
    max-height: none;
  }

  .chart-card-short .pie-chart-wrapper {
    max-height: none;
  }

  .center-value {
    font-size: 18px;
  }

  .center-label {
    font-size: 10px;
  }

  .chart-legend {
    flex: 1 1 100%;
    min-width: 0;
    gap: 6px;
  }

  .legend-item {
    padding: 6px 8px;
    gap: 6px;
    border-radius: 6px;
    font-size: 12px;
  }

  /* 渠道名可能很长：允许收缩并省略号截断，避免把数值/百分比挤出卡片 */
  .legend-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .legend-value,
  .legend-percent {
    flex: 0 0 auto;
    font-size: 12px;
  }
}
</style>
