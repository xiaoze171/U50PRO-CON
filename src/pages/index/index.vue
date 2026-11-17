<template>
  <view class="app-shell">
    <aside class="sidebar" :class="{ open: menuOpen }">
      <view class="brand-block">
        <view class="brand-mark"><RouterIcon :size="22" :stroke-width="1.8" /></view>
        <view>
          <text class="brand-title">U50 PRO</text>
          <text class="brand-subtitle">随时掌握网络状态</text>
        </view>
      </view>

      <view class="connection-card">
        <view class="connection-line">
          <view class="status-dot" :class="connected ? 'online' : 'offline'"></view>
          <text>{{ connected ? '路由器已连接' : connectionMessage }}</text>
        </view>
        <text class="connection-address">{{ connectionAddress }}</text>
      </view>

      <view class="nav-list">
        <button
          v-for="item in tabs"
          :key="item.id"
          class="nav-button"
          :class="{ active: activeTab === item.id }"
          @click="switchTab(item.id)"
        >
          <component :is="item.icon" :size="19" :stroke-width="1.9" />
          <text class="nav-label">{{ item.label }}</text>
          <text v-if="item.badge" class="nav-badge">{{ item.badge }}</text>
        </button>
      </view>

      <view class="sidebar-footer">
        <text>v{{ APP_VERSION }} · 开发者 晓泽</text>
        <text>{{ clock }}</text>
      </view>
    </aside>

    <view v-if="menuOpen" class="sidebar-mask" @click="menuOpen = false"></view>

    <main class="main-area">
      <header class="topbar">
        <button v-if="secondaryPage" class="icon-button back-button" aria-label="返回" @click="handleNavigationBack"><ChevronLeft :size="20" /></button>
        <view class="page-heading">
          <view v-if="activeTab === 'overview'" class="mobile-brand"><view class="brand-mark"><RouterIcon :size="18" /></view><text class="page-title">U50 Pro</text></view>
          <text v-else class="page-title">{{ pageTitle }}</text>
        </view>
        <view class="top-actions">
          <text class="last-update">{{ collectionSourceLabel(data.source) }} · 更新于 {{ lastUpdate }}</text>
          <button class="icon-button" :aria-label="manualRefreshing ? '正在刷新' : '立即刷新'" :aria-busy="manualRefreshing" :disabled="manualRefreshing || actionBusy" @click="refresh(true)">
            <RefreshCw :size="19" :class="{ spinning: manualRefreshing }" />
          </button>
        </view>
      </header>

      <view class="freshness-strip" :class="freshness.state" role="status">
        <view class="freshness-state"><view class="freshness-dot" :class="freshness.state"></view><text>{{ freshness.label }}</text></view>
        <text class="freshness-source">{{ collectionSourceLabel(data.telemetrySource) }} · {{ syncRoleText }}</text>
        <text class="freshness-time">{{ freshness.time }}</text>
      </view>
      <scroll-view :key="`${activeTab}-${managementTab}-${trendDetail}-${settingsSection}`" class="content-scroll" scroll-y>
        <view class="content-wrap" :class="{ 'home-content': activeTab === 'overview' }">
          <view v-if="errorMessage" class="error-banner">
            <CircleAlert :size="18" />
            <text>{{ errorMessage }}</text>
          </view>

          <template v-if="activeTab === 'overview'">
            <DashboardHome
              :network="networkType" :operator="operator"
              :download="freshness.state === 'live' ? bytesPerSecond(status.realtime_rx_thrpt) : '—'" :upload="freshness.state === 'live' ? bytesPerSecond(status.realtime_tx_thrpt) : '—'"
              :battery-percent="batteryPercentText"
              :signal-panels="homeSignalPanels" :signal-subtitle="homeSignalSubtitle"
              :temperature-metrics="homeTemperatureMetrics" :temperature-subtitle="homeTemperatureSubtitle"
              :battery-state="batteryStateText" :time-to-full="batteryTimeToFullText" :runtime="batteryRuntimeText"
              :time-to-full-reason="batteryTimeToFullReason" :runtime-reason="batteryRuntimeReason"
              :monthly-usage="formatBytes(monthlyUsedBytes)"
              :temperature-alert="homeTemperatureAlert" :client-count="clientSummaryText" :sms-count="smsSummaryText"
              @navigate="switchTab"
            />
          </template>

          <template v-else-if="activeTab === 'trends'">
            <view class="trend-controls">
              <view class="trend-metrics" role="tablist" aria-label="趋势指标">
                <button v-for="item in trendMetrics" :key="item.id" class="manage-tab-button" :class="{ active: trendMetric === item.id }" :aria-selected="trendMetric === item.id" @click="selectTrend(item.id)">{{ item.label }}</button>
              </view>
              <view class="trend-range" role="group" aria-label="时间范围">
                <button v-for="hours in [2, 24]" :key="hours" class="manage-tab-button" :class="{ active: trendHours === hours }" :aria-pressed="trendHours === hours" @click="trendHours = hours">{{ hours }} 小时</button>
              </view>
            </view>
            <section class="panel">
              <view class="panel-header">
                <view><text class="panel-title">{{ trendTitle }}</text></view>
                <view v-if="trendMetric === 'signal'" class="trend-range" role="group" aria-label="信号指标">
                  <button v-for="metric in ['rsrp', 'sinr', 'rsrq']" :key="metric" class="manage-tab-button" :class="{ active: signalMetric === metric }" @click="signalMetric = metric">{{ metric.toUpperCase() }}</button>
                </view>
              </view>
              <AppChart :option="trendChartOption" height="var(--trend-chart-height, 280px)" />
              <text class="source-hint">点按查看数值与来源 · 点击图例显示或隐藏曲线 · 缺口表示未采集</text>
            </section>
            <MetricGrid v-if="trendMetric === 'temperature'" :items="temperatureMetrics" />
            <template v-if="trendMetric === 'battery'">
              <MetricGrid :items="batteryMetrics" />
              <section class="panel">
                <view class="panel-header"><view><text class="panel-title">电池测量与估算依据</text><text class="panel-subtitle">剩余可用按放电到 0% 估算；软件可用容量与标称容量分开，USB 总输入包含整机用电。</text></view></view>
                <DataList :items="batteryDiagnostics" />
              </section>
              <section class="panel battery-history-panel">
                <view class="panel-header"><view><text class="panel-title">续航记录</text><text class="panel-subtitle">最近 {{ batterySamples.length }} 条 · 保留采集来源</text></view></view>
                <BatteryHistory :samples="batterySamples" />
              </section>
            </template>
            <view v-if="trendMetric === 'throughput'" class="action-row"><button class="secondary-button" @click="trendDetail = trendDetail === 'usage' ? '' : 'usage'">{{ trendDetail === 'usage' ? '收起流量管理' : '本月流量、套餐与校准' }}</button><text class="action-result">本月已用 {{ formatBytes(monthlyUsedBytes) }}</text></view>
            <view v-if="trendMetric === 'temperature'" class="action-row"><button class="secondary-button" @click="openDiagnostics">查看原始温度与采集详情</button></view>
          </template>

          <template v-if="activeTab === 'devices' && managementTab === 'radio'">
            <view class="radio-overview-grid">
              <section class="panel compact-panel radio-info-panel">
                <view class="panel-header compact"><text class="panel-title">当前网络信息</text><RadioTower :size="17" /></view>
                <DataList class="radio-data-list" :items="networkDetails" />
              </section>
              <section class="panel compact-panel radio-info-panel">
                <view class="panel-header compact"><text class="panel-title">服务小区</text><MapPin :size="17" /></view>
                <view class="signal-quality-list">
                  <view v-for="metric in signalQualityMetrics" :key="metric.label" class="quality-row">
                    <text class="quality-name">{{ metric.label }}</text>
                    <view class="quality-track">
                      <view class="quality-fill" :style="qualityFillStyle(metric)">
                        <text class="quality-inline-value">{{ metric.value }}</text>
                      </view>
                    </view>
                    <text class="quality-mobile-value">{{ metric.value }}</text>
                  </view>
                  <view v-if="!signalQualityMetrics.length" class="empty-state">暂无信号数据</view>
                </view>
              </section>
            </view>

            <section class="cell-params-strip">
              <view v-for="item in cellParamsDetails" :key="item.label" class="cell-param-item">
                <text class="cell-param-label">{{ item.label }}</text>
                <text class="cell-param-value">{{ item.value || '—' }}</text>
              </view>
              <view v-if="!cellParamsDetails.length" class="cell-param-empty">暂无小区参数</view>
            </section>

            <section class="panel compact-panel radio-info-panel">
              <view class="panel-header compact"><text class="panel-title">辅载波与 NR CA</text><Layers3 :size="17" /></view>
              <DataList class="radio-data-list" :items="secondaryCellDetails" empty-text="当前未检测到辅载波或 CA" />
            </section>

            <section class="panel signal-trend-panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">无线质量趋势</text>
                  <text class="panel-subtitle">当前指标 {{ signalMetric.toUpperCase() }} · 最近 2 小时</text>
                </view>
              </view>
              <AppChart :option="signalChartOption" height="260px" />
              <button class="secondary-button" @click="switchTab('signal')">查看其他信号指标与 24 小时趋势</button>
              <text class="source-hint">点按曲线查看来源：前台 / 后台 / 悬浮窗 / 息屏</text>
            </section>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">邻小区信息</text>
                  <text class="panel-subtitle">候选小区按 RSRP 从强到弱排序</text>
                </view>
                <view class="neighbor-tools">
                  <view class="search-box"><Search :size="15" /><input v-model="neighborQuery" placeholder="搜索 PCI、ARFCN、Band" /></view>
                  <button class="secondary-button" @click="scanNeighbors"><Radar :size="17" />重新扫描</button>
                </view>
              </view>
              <view class="candidate-list">
                <button
                  v-for="(candidate, index) in displayedCandidates"
                  :key="candidate.key"
                  class="candidate-card"
                  :class="{ selected: selectedCellKey === candidate.key }"
                  @click="selectCandidate(candidate)"
                >
                  <view class="candidate-rank">{{ index + 1 }}</view>
                  <view class="candidate-main">
                    <text>{{ candidate.serving ? '当前服务小区' : `${candidate.rat} 候选小区` }}</text>
                    <b>{{ candidate.rat === 'NR' ? 'n' : 'B' }}{{ candidate.band }} · PCI {{ candidate.pci }} · ARFCN {{ candidate.arfcn }}</b>
                  </view>
                  <view class="candidate-signal">
                    <b>{{ candidate.rsrp ?? '—' }} dBm</b>
                    <text>RSRQ {{ candidate.rsrq ?? '—' }} dB</text>
                  </view>
                </button>
                <view v-if="!displayedCandidates.length" class="empty-state">没有匹配的候选小区，请调整搜索或重新扫描。</view>
              </view>
            </section>

            <section class="panel compact-panel locked-status-panel">
              <view class="panel-header compact"><text class="panel-title">当前锁定状态</text><LockKeyhole :size="17" /></view>
              <view class="locked-status-values">
                <text v-for="tag in lockedStatusTags" :key="tag" class="locked-tag">{{ tag }}</text>
                <text v-if="!lockedStatusTags.length" class="locked-tag none">无锁定，路由器未限制频段与小区</text>
              </view>
            </section>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">锁小区联动</text>
                  <text class="panel-subtitle">初始选择信号最强候选，可手动改选；仅改变小区锁定</text>
                </view>
                <text class="panel-tag accent">{{ selectedCandidate ? `所选 ${selectedCandidate.rsrp ?? '—'} dBm` : '暂无候选' }}</text>
              </view>
              <view class="lock-form-grid">
                <label><text>制式</text><input :value="selectedCandidate?.rat || ''" disabled /></label>
                <label><text>PCI</text><input v-model="lockForm.pci" type="number" /></label>
                <label><text>ARFCN</text><input v-model="lockForm.arfcn" type="number" /></label>
                <label><text>Band</text><input v-model="lockForm.band" type="number" /></label>
                <label v-if="selectedCandidate?.rat === 'NR'"><text>SCS</text><input v-model="lockForm.scs" type="number" /></label>
              </view>
              <view class="action-row">
                <button class="primary-button" :disabled="!selectedCandidate || actionBusy" @click="lockSelectedCell"><LockKeyhole :size="17" />锁定所选小区</button>
                <button class="secondary-button" :disabled="actionBusy" @click="unlockAllCells"><LockOpen :size="17" />解除小区锁定</button>
                <text class="action-result">{{ radioActionResult }}</text>
              </view>
            </section>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">频段锁定</text>
                  <text class="panel-subtitle">保留原有 LTE、5G SA 与 5G NSA 独立设置</text>
                </view>
              </view>
              <view class="band-groups">
                <view class="band-group">
                  <view class="band-group-header">
                    <view><text class="band-title">LTE 频段</text><text class="band-count">已选择 {{ selectedLteBands.length }} 个</text></view>
                    <text class="band-network-tag">4G</text>
                  </view>
                  <view class="band-options">
                    <button v-for="band in lteBands" :key="band" class="band-chip" :class="{ checked: selectedLteBands.includes(band) }" :disabled="actionBusy" @click="toggleBand('lte', band)">
                      <Check v-if="selectedLteBands.includes(band)" :size="14" :stroke-width="2.5" /><text>B{{ band }}</text>
                    </button>
                    <button v-for="band in extraLteBands" :key="`x-${band}`" class="band-chip custom checked" :disabled="actionBusy" @click="toggleBand('lte', band)">
                      <Check :size="14" :stroke-width="2.5" /><text>B{{ band }}</text>
                    </button>
                  </view>
                  <view class="band-action-row">
                    <button class="band-save-button" :disabled="actionBusy" @click="saveBands('lte')"><Save :size="16" />保存 LTE 频段</button>
                    <button class="band-save-button band-clear-button" :disabled="actionBusy" @click="clearBands('lte')"><LockOpen :size="16" />解除限制</button>
                  </view>
                </view>
                <view class="band-group">
                  <view class="band-group-header">
                    <view><text class="band-title">5G SA 频段</text><text class="band-count">已选择 {{ selectedSaBands.length }} 个</text></view>
                    <text class="band-network-tag sa">SA</text>
                  </view>
                  <view class="band-options">
                    <button v-for="band in nrBands" :key="band" class="band-chip" :class="{ checked: selectedSaBands.includes(band) }" :disabled="actionBusy" @click="toggleBand('sa', band)">
                      <Check v-if="selectedSaBands.includes(band)" :size="14" :stroke-width="2.5" /><text>n{{ band }}</text>
                    </button>
                    <button v-for="band in extraSaBands" :key="`xs-${band}`" class="band-chip custom checked" :disabled="actionBusy" @click="toggleBand('sa', band)">
                      <Check :size="14" :stroke-width="2.5" /><text>n{{ band }}</text>
                    </button>
                  </view>
                  <view class="band-action-row">
                    <button class="band-save-button" :disabled="actionBusy" @click="saveBands('sa')"><Save :size="16" />保存 SA 频段</button>
                    <button class="band-save-button band-clear-button" :disabled="actionBusy" @click="clearBands('sa')"><LockOpen :size="16" />解除限制</button>
                  </view>
                </view>
                <view class="band-group">
                  <view class="band-group-header">
                    <view><text class="band-title">5G NSA 频段</text><text class="band-count">已选择 {{ selectedNsaBands.length }} 个</text></view>
                    <text class="band-network-tag nsa">NSA</text>
                  </view>
                  <view class="band-options">
                    <button v-for="band in nrBands" :key="band" class="band-chip" :class="{ checked: selectedNsaBands.includes(band) }" :disabled="actionBusy" @click="toggleBand('nsa', band)">
                      <Check v-if="selectedNsaBands.includes(band)" :size="14" :stroke-width="2.5" /><text>n{{ band }}</text>
                    </button>
                    <button v-for="band in extraNsaBands" :key="`xn-${band}`" class="band-chip custom checked" :disabled="actionBusy" @click="toggleBand('nsa', band)">
                      <Check :size="14" :stroke-width="2.5" /><text>n{{ band }}</text>
                    </button>
                  </view>
                  <view class="band-action-row">
                    <button class="band-save-button" :disabled="actionBusy" @click="saveBands('nsa')"><Save :size="16" />保存 NSA 频段</button>
                    <button class="band-save-button band-clear-button" :disabled="actionBusy" @click="clearBands('nsa')"><LockOpen :size="16" />解除限制</button>
                  </view>
                </view>
              </view>
            </section>
          </template>

          <template v-else-if="activeTab === 'trends' && trendDetail === 'usage'">
            <MetricGrid class="usage-summary-grid" :items="usageSummaryMetrics" centered />
            <section class="panel traffic-plan-panel">
              <view class="panel-header"><view><text class="panel-title">流量管理</text><text class="panel-subtitle">默认使用 GB，显示套餐、已用和剩余流量</text></view><Gauge :size="20" /></view>
              <MetricGrid :items="trafficPlanMetrics" />
              <view class="settings-form feature-form">
                <label><text>启用套餐</text><switch :checked="trafficPlanForm.enabled" color="#4267ed" @change="trafficPlanForm.enabled = Boolean($event.detail.value)" /></label>
                <label><text>每月套餐（GB）</text><input v-model="trafficPlanForm.sizeGb" type="number" min="0" step="0.1" placeholder="例如 100" @focus="beginFeatureEdit" @blur="endFeatureEdit" /></label>
                <label><text>提醒百分比</text><input v-model="trafficPlanForm.alertPercent" type="number" placeholder="例如 80" @focus="beginFeatureEdit" @blur="endFeatureEdit" /></label>
                <label><text>自动清零</text><switch :checked="trafficPlanForm.autoClear" color="#4267ed" @change="trafficPlanForm.autoClear = Boolean($event.detail.value)" /></label>
                <label><text>清零日期</text><input v-model="trafficPlanForm.clearDate" placeholder="例如 1" @focus="beginFeatureEdit" @blur="endFeatureEdit" /></label>
                <label><text>校准已用（GB）</text><input v-model="trafficPlanForm.usedGb" type="number" min="0" step="0.1" placeholder="可选" @focus="beginFeatureEdit" @blur="endFeatureEdit" /></label>
              </view>
              <view class="action-row"><button class="primary-button" :disabled="actionBusy" @click="saveTrafficPlan"><Save :size="17" />保存流量设置</button><button class="secondary-button" :disabled="actionBusy || trafficPlanForm.usedGb === ''" @click="calibrateTraffic"><Save :size="17" />校准已用 GB</button><text class="action-result">{{ featureResult }}</text></view>
            </section>
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">用量明细</text><text class="panel-subtitle">当前会话与 {{ formatMonth(status.date_month) }} 月统计</text></view></view>
              <DataList :items="usageDetails" />
            </section>
          </template>

          <template v-else-if="activeTab === 'devices' || activeTab === 'settings'">
            <template v-if="activeTab === 'devices' && managementTab === 'sms'">
            <section class="panel sms-inbox-panel">
              <view class="panel-header sms-list-header">
                <view><text class="panel-title">收件箱</text><text class="panel-subtitle">{{ smsCapacity }} · 验证码 {{ smsCodeCount }}</text></view>
                <view class="sms-header-actions">
                  <button class="icon-button sms-refresh-button" :disabled="smsRefreshing" aria-label="刷新收件箱" title="刷新收件箱" @click="loadSms"><RefreshCw :size="16" :class="{ spinning: smsRefreshing }" /></button>
                  <button class="primary-button" :aria-expanded="smsComposeOpen" @click="smsComposeOpen = !smsComposeOpen"><Send :size="14" />{{ smsComposeOpen ? '收起' : '写短信' }}</button>
                </view>
                <view v-if="messages.length" class="sms-bulk-actions">
                  <button class="sms-select-all" role="checkbox" :aria-checked="allSmsSelected" :disabled="!selectableSmsIds.length || actionBusy" @click="toggleAllSms">
                    <view class="sms-checkbox-mark" :class="{ checked: allSmsSelected }"><Check v-if="allSmsSelected" :size="13" /></view>
                    <text>{{ allSmsSelected ? '取消全选' : '全选' }}</text>
                  </button>
                  <text class="sms-selection-count">已选 {{ selectedSmsCount }} 条</text>
                  <button class="danger-button sms-delete-button" :disabled="!selectedSmsCount || actionBusy" @click="deleteSelectedSms"><Trash :size="14" />删除</button>
                </view>
              </view>
              <view v-if="smsComposeOpen" class="sms-compose-panel">
                <text class="sms-compose-hint">通过路由器 SIM 卡发送</text>
                <view class="sms-compose">
                  <label><text>收件人</text><input v-model="smsNumber" type="tel" aria-label="收件人手机号码" placeholder="手机号码" /></label>
                  <label class="sms-message-field"><text>短信内容</text><textarea v-model="smsMessage" maxlength="670" aria-label="短信内容" placeholder="短信内容"></textarea></label>
                  <view class="compose-footer"><text>{{ smsMessage.length }} / 670</text><button class="primary-button" :disabled="actionBusy" @click="sendSms"><Send :size="14" />发送</button></view>
                </view>
              </view>
              <view class="sms-list">
                <view v-for="message in messages" :key="message.id || `${message.number}-${message.date}`" class="sms-card" :class="{ unread: String(message.tag) === '1', selected: isSmsSelected(message) }">
                  <view class="sms-card-head">
                    <button class="sms-select-checkbox" role="checkbox" :aria-checked="isSmsSelected(message)" :disabled="!smsMessageId(message) || actionBusy" :title="smsMessageId(message) ? '选择短信' : '此短信缺少 ID，无法删除'" @click.stop="toggleSmsSelection(message)">
                      <view class="sms-checkbox-mark" :class="{ checked: isSmsSelected(message) }"><Check v-if="isSmsSelected(message)" :size="13" /></view>
                    </button>
                    <view class="sms-meta"><b>{{ message.number || '未知号码' }}</b><text>{{ formatSmsDate(message.date) }}</text></view>
                  </view>
                  <text class="sms-body">{{ message.content || '—' }}</text>
                  <view v-if="message.verificationCode" class="sms-code-row">
                    <view class="sms-code-value"><text>验证码</text><b>{{ message.verificationCode }}</b></view>
                    <button class="sms-copy-button" :aria-label="`复制验证码 ${message.verificationCode}`" :title="`复制验证码 ${message.verificationCode}`" @click.stop="copyVerificationCode(message.verificationCode)">
                      <Copy :size="14" /><text>复制</text>
                    </button>
                  </view>
                </view>
                <view v-if="!messages.length" class="empty-state">当前没有短信。</view>
              </view>
            </section>
            </template>

            <template v-else-if="activeTab === 'devices' && managementTab === 'clients'">
            <section class="panel device-summary"><view class="panel-header"><view><text class="panel-title">{{ networkType }} · {{ operator }}</text><text class="panel-subtitle">{{ clientSummaryText }}</text></view><button class="secondary-button" @click="switchManagementTab('radio')">网络调优</button></view><view class="locked-status-values"><text class="locked-tag" v-for="tag in lockedStatusTags" :key="tag">{{ tag }}</text><text v-if="!lockedStatusTags.length" class="source-hint">{{ connected ? '当前没有频段或小区锁定' : '锁定状态待连接后确认' }}</text></view></section>
            <view class="two-column">
              <section class="panel">
                <view class="panel-header"><view><text class="panel-title">无线设备</text><text class="panel-subtitle">{{ clientListCountText('stations') }}</text></view><Wifi :size="20" /></view>
                <view class="client-list"><view v-for="client in stations" :key="client.mac_addr || client.macAddress || client.ip_addr" class="client-card"><view><b>{{ client.hostname || client.hostName || '未知设备' }}</b><text>{{ client.ip_addr || client.ipAddress || '—' }}</text></view><code>{{ client.mac_addr || client.macAddress || '—' }}</code></view><view v-if="!stations.length" class="empty-state">{{ clientEmptyText('stations') }}</view></view>
              </section>
              <section class="panel">
                <view class="panel-header"><view><text class="panel-title">有线设备</text><text class="panel-subtitle">{{ clientListCountText('cableStations') }}</text></view><Cable :size="20" /></view>
                <view class="client-list"><view v-for="client in cableStations" :key="client.mac_addr || client.macAddress || client.ip_addr" class="client-card"><view><b>{{ client.hostname || client.hostName || '未知设备' }}</b><text>{{ client.ip_addr || client.ipAddress || '—' }}</text></view><code>{{ client.mac_addr || client.macAddress || '—' }}</code></view><view v-if="!cableStations.length" class="empty-state">{{ clientEmptyText('cableStations') }}</view></view>
              </section>
            </view>
            <text class="section-label">常用功能</text>
            <section class="panel entry-group">
              <button v-for="item in managementTabs.filter(item => item.id !== 'clients')" :key="item.id" class="entry-row" @click="switchManagementTab(item.id)">
                <component :is="item.icon" :size="18" /><view class="entry-copy"><b>{{ item.label }}</b><text>{{ item.description }}</text></view><ChevronRight :size="16" />
              </button>
            </section>
            </template>

            <template v-else-if="activeTab === 'devices' && managementTab === 'stock'">
            <section class="panel stock-panel">
              <view class="panel-header">
                <view><text class="panel-title">原厂后台</text><text class="panel-subtitle">{{ stockConsole.message }}</text></view>
                <view class="stock-header-actions">
                  <button class="secondary-button" :disabled="stockConsole.busy" @click="openStockConsole(true)"><RefreshCw :size="17" />{{ stockConsole.busy ? '登录中…' : '重新自动登录' }}</button>
                  <button v-if="stockOpenMode === 'external'" class="secondary-button" @click="openStockConsoleExternal"><ExternalLink :size="17" />新窗口打开</button>
                </view>
              </view>
              <view v-if="stockOpenMode === 'embed'" class="stock-zoom-row">
                <button class="secondary-button" :disabled="stockScale <= STOCK_SCALE_MIN" @click="adjustStockScale(-STOCK_SCALE_STEP)">−</button>
                <text class="stock-zoom-value">{{ Math.round(stockScale * 100) }}%</text>
                <button class="secondary-button" :disabled="stockScale >= STOCK_SCALE_MAX" @click="adjustStockScale(STOCK_SCALE_STEP)">＋</button>
                <button class="secondary-button" :disabled="stockScale === 1" @click="resetStockScale">重置</button>
              </view>
              <view v-if="stockOpenMode === 'embed'" class="stock-frame-wrap" :style="{ '--stock-scale': stockScale }">
                <iframe v-if="stockConsole.url" :key="stockConsole.url" :src="stockConsole.url" class="stock-frame" title="路由器原厂后台"></iframe>
                <view v-else class="stock-placeholder">{{ stockConsole.busy ? '正在自动登录并加载原厂后台…' : '正在准备原厂后台…' }}</view>
              </view>
              <template v-else>
                <view class="stock-native-hint">{{ stockOpenMode === 'navigate' ? '原厂后台将以全屏方式打开：已用保存的密码自动登录管理员与开发者权限，按系统返回键回到本应用。' : '原厂后台将在系统浏览器中打开，暂不支持免密自动登录，需手动输入一次密码。' }}</view>
                <button class="primary-button stock-native-open" :disabled="stockConsole.busy" @click="openStockConsoleNative">
                  <RouterIcon :size="17" />{{ stockConsole.busy ? '正在确认登录状态…' : '进入原厂后台' }}
                </button>
              </template>
            </section>
            </template>

            <template v-else-if="activeTab === 'devices' && managementTab === 'detail'">
              <section class="panel"><view class="panel-header"><view><text class="panel-title">设备详情</text><text class="panel-subtitle">标识、开机时间与当前网络</text></view><RouterIcon :size="20" /></view><DataList :items="deviceIdentityDetails" /></section>
              <section class="panel"><view class="panel-header"><text class="panel-title">网络概况</text></view><DataList :items="networkDetails" /></section>
              <view class="action-row"><button class="secondary-button" @click="switchTab('radio')">网络调优与锁定</button><button class="secondary-button" @click="switchTab('usage')">流量套餐与校准</button><button class="secondary-button" @click="switchTab('battery')">电池与续航</button></view>
            <section class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">设备控制</text><text class="panel-subtitle">Wi-Fi 关闭后当前连接会立即中断，需要手动重新连接设备</text></view><Power :size="20" /></view>
              <view class="device-control-grid">
                <button class="secondary-button" :disabled="actionBusy" @click="runDeviceAction('wifi-on')"><Wifi :size="17" />开启 Wi-Fi</button>
                <button class="secondary-button danger-outline" :disabled="actionBusy" @click="runDeviceAction('wifi-off')"><WifiOff :size="17" />关闭 Wi-Fi</button>
                <button class="secondary-button" :disabled="actionBusy" @click="runDeviceAction('reboot')"><RotateCw :size="17" />重启设备</button>
                <button class="danger-button" :disabled="actionBusy" @click="runDeviceAction('shutdown')"><PowerOff :size="17" />关闭设备</button>
              </view>
              <text class="action-result control-result">{{ deviceActionResult }}</text>
            </section>
            </template>

            <template v-else>
            <template v-if="!settingsSection">
              <text class="section-label">连接</text>
              <section class="panel entry-group">
                <button class="entry-row" @click="openSettingsSection('connection')"><Wifi :size="18" /><view class="entry-copy"><b>路由器连接</b></view><text class="entry-tail">{{ connectionAddress }}</text><ChevronRight :size="16" /></button>
              </section>
              <text class="section-label">监控</text>
              <section class="panel entry-group">
                <button class="entry-row" @click="openSettingsSection('battery')"><BatteryCharging :size="18" /><view class="entry-copy"><b>电量来源</b></view><text class="entry-tail">{{ batterySourceText }}</text><ChevronRight :size="16" /></button>
                <button class="entry-row" @click="openSettingsSection('background')"><BatteryCharging :size="18" /><view class="entry-copy"><b>后台采集与权限</b><text>{{ backgroundStateText }}</text></view><ChevronRight :size="16" /></button>
                <view class="entry-row"><Layers3 :size="18" /><view class="entry-copy"><b>悬浮监测</b><text>{{ overlayStateText }}</text></view><switch :checked="overlayState.enabled" :disabled="!overlayState.available" color="#4267ed" @change="toggleOverlay" /></view>
                <button class="entry-row" @click="openSettingsSection('sync')"><Smartphone :size="18" /><view class="entry-copy"><b>局域网互通</b><text>{{ syncStateText }}</text></view><text class="entry-tail">{{ syncState.enabled ? '已启用' : '已关闭' }}</text><ChevronRight :size="16" /></button>
              </section>
              <text class="section-label">应用</text>
              <section class="panel entry-group">
                <button class="entry-row" @click="openSettingsSection('update')"><RefreshCw :size="18" /><view class="entry-copy"><b>软件更新</b></view><text class="entry-tail">v{{ APP_VERSION }}</text><ChevronRight :size="16" /></button>
                <button class="entry-row" @click="openDiagnostics"><CircleAlert :size="18" /><view class="entry-copy"><b>采集诊断与原始读数</b></view><ChevronRight :size="16" /></button>
              </section>
              <text class="app-credit">U50 Pro 控制台 · 开发者 晓泽</text>
            </template>
            <section v-if="settingsSection === 'connection'" class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">路由器连接</text><text class="panel-subtitle">手机连接 U50 Pro Wi-Fi 后直接访问 192.168.0.1</text></view><Settings :size="20" /></view>
              <view class="settings-form">
                <label><text>路由器地址</text><input v-model="settingsForm.routerUrl" placeholder="http://192.168.0.1" /></label>
                <label><text>登录与开发者密码</text><input v-model="settingsForm.password" password /></label>
              </view>
              <view class="action-row">
                <button class="primary-button" @click="saveSettings"><Save :size="17" />保存并登录</button>
                <button class="secondary-button" @click="testDeveloper"><Code2 :size="17" />验证开发者权限</button>
                <text class="action-result">{{ settingsResult }}</text>
              </view>
            </section>
            <section v-if="settingsSection === 'battery'" class="panel settings-panel battery-settings-panel">
              <view class="panel-header"><text class="panel-title">电量来源</text></view>
              <text class="battery-source-hint">当前版本使用{{ batterySourceText }}。</text>
              <template v-if="config.batterySource === 'gauge'">
                <view class="settings-form battery-source-fields">
                  <label><text>IP 地址</text><input v-model="batterySettingsForm.batteryHost" :disabled="batterySettingsSaving" placeholder="留空跟随路由器" /></label>
                  <label><text>固定端口</text><input value="88" disabled type="number" /></label>
                </view>
                <text class="battery-endpoint-preview">{{ batteryEndpointPreview }}</text>
                <text class="battery-source-hint">电量来自设备实时读数，续航来自设备 CSV 日志；日志不可用时显示对应原因。</text>
              </template>
              <text v-else class="battery-source-hint">使用路由器原厂返回的电池百分比。</text>
              <text v-if="syncState.role === 'viewer'" class="battery-source-hint">当前跟随采集器显示；此设置用于本机采集。</text>
              <view class="action-row battery-source-actions">
                <button class="primary-button battery-source-save" :disabled="batterySettingsSaving" @click="saveBatterySettings"><Save :size="15" />{{ batterySettingsSaving ? '保存中…' : '保存' }}</button>
                <text class="action-result" :class="{ 'battery-source-error': batterySettingsError }" role="status">{{ batterySettingsResult }}</text>
              </view>
            </section>
            <section v-if="settingsSection === 'sync'" class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">局域网互通</text><text class="panel-subtitle">同一 Wi-Fi 下多设备共享历史，避免各自抢占路由器登录导致数据断层</text></view><Wifi :size="20" /></view>
              <view class="overlay-setting-row">
                <view class="overlay-setting-copy">
                  <b>启用局域网互通</b>
                  <text>{{ syncStateText }}</text>
                </view>
                <switch :checked="syncState.enabled" :disabled="!syncState.supported" color="#4267ed" @change="toggleSync" />
              </view>
              <template v-if="syncState.supported && syncState.enabled">
                <view class="sync-role-line">
                  <text class="sync-role-badge" :class="syncRoleClass">{{ syncRoleText }}</text>
                  <text class="sync-role-hint">{{ syncRoleHint }}</text>
                </view>
                <view v-if="syncState.peers.length" class="sync-peer-list">
                  <view v-for="peer in syncState.peers" :key="peer.id" class="sync-peer-row">
                    <view class="sync-peer-copy">
                      <b>{{ peer.name || peer.id }}</b>
                      <text>{{ peerPlatformText(peer.platform) }}<template v-if="peer.collecting"> · 采集中</template></text>
                    </view>
                    <button class="secondary-button sync-pin-button" :class="{ 'sync-pinned': syncState.preferredCollector === peer.id }" @click="pinCollector(peer.id)">{{ syncState.preferredCollector === peer.id ? '已钉住' : '设为采集器' }}</button>
                  </view>
                </view>
                <view v-else class="sync-empty">局域网内暂无其他节点，正在直连路由器</view>
              </template>
            </section>
            <section v-if="settingsSection === 'overlay'" class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">悬浮监测</text><text class="panel-subtitle">在其他应用上层显示实时速率、电量与电池温度</text></view><Layers3 :size="20" /></view>
              <view class="overlay-setting-row">
                <view class="overlay-setting-copy">
                  <b>显示悬浮窗</b>
                  <text>{{ overlayStateText }}</text>
                </view>
                <switch :checked="overlayState.enabled" :disabled="!overlayState.available" color="#4267ed" @change="toggleOverlay" />
              </view>
            </section>
            <section v-if="settingsSection === 'background'" class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">息屏后台采集</text><text class="panel-subtitle">息屏或切到后台时由原生服务继续采集全部数据并保存 24 小时，回到页面自动补齐曲线</text></view><BatteryCharging :size="20" /></view>
              <view class="overlay-setting-row">
                <view class="overlay-setting-copy">
                  <b>采集状态</b>
                  <text>{{ backgroundStateText }}</text>
                  <text v-if="backgroundBackfill">{{ backgroundBackfill }}</text>
                  <text v-if="backgroundState.source">当前：{{ collectionSourceLabel(backgroundState.source) }}采集</text>
                </view>
              </view>
              <view v-if="backgroundState.available" class="overlay-setting-row">
                <view class="overlay-setting-copy">
                  <b>电池优化豁免</b>
                  <text>{{ batteryOptimizationText }}</text>
                </view>
                <button v-if="!backgroundState.ignoring" class="secondary-button" @click="requestBatteryOptimization">去授权</button>
              </view>
              <text v-if="backgroundState.available" class="panel-subtitle">vivo 手机还需在「设置 › 应用 › U50 Pro 控制台」中允许自启动、后台高耗电，并在最近任务中锁定应用。</text>
            </section>
            <section v-if="settingsSection === 'update'" class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">软件更新</text><text class="panel-subtitle">当前版本 v{{ APP_VERSION }}</text></view><RefreshCw :size="20" /></view>
              <view class="action-row">
                <button class="primary-button" :disabled="softwareUpdate.busy" @click="checkSoftwareUpdate(true)">{{ softwareUpdate.busy ? '正在检查…' : '检查更新' }}</button>
                <button v-if="nativeUpdate && softwareUpdate.result?.isNewer" class="secondary-button" :disabled="apkDownload.state === 'downloading' || !softwareUpdate.result.apk" @click="downloadSoftwareUpdate">{{ apkDownload.state === 'downloading' ? '下载中…' : apkDownload.state === 'ready' ? '安装更新' : '下载并安装更新' }}</button>
                <button v-if="!nativeUpdate" class="secondary-button" @click="openSoftwareRelease">查看发布页</button>
                <text class="action-result">{{ softwareUpdate.message }}</text>
              </view>
              <view v-if="nativeUpdate && apkDownload.message" class="action-result">{{ apkDownload.message }}</view>
              <progress v-if="apkDownload.state === 'downloading'" :percent="Math.max(0, apkDownload.progress)" :show-info="apkDownload.progress >= 0" stroke-width="4" />
              <text v-if="softwareUpdate.result?.isNewer && softwareUpdate.result.body" class="update-notes">{{ softwareUpdate.result.body }}</text>
            </section>
            <section v-if="settingsSection === 'diagnostics'" class="panel diagnostic-details">
              <button class="details-toggle" :aria-expanded="diagnosticsOpen" @click="diagnosticsOpen = !diagnosticsOpen"><text>采集诊断与原始读数</text><text>{{ diagnosticsOpen ? '收起 −' : '展开 +' }}</text></button>
              <template v-if="diagnosticsOpen">
              <view class="collection-source-summary">
                <b>最近 24 小时归档来源</b>
                <view class="collection-source-counts">
                  <text v-for="(label, source) in collectionSourceLabels" :key="source" class="source-badge">{{ label }} {{ backgroundSourceCounts[source] || 0 }} 条</text>
                </view>
                <text class="source-hint">每分钟保留首条有效记录。悬浮窗指亮屏后台且悬浮窗显示；息屏优先。旧记录保留为未标记。</text>
              </view>
                <view class="panel-header compact"><text class="panel-title">温度原始返回</text></view>
                <DataList :items="temperatureDiagnostics" empty-text="尚未收到温度字段" />
                <text class="source-hint">疑似异常读数不进入温度曲线。原始字段保留，便于核对设备兼容性。</text>
                <view class="panel-header compact"><text class="panel-title">采集与运行方式</text></view>
                <DataList :items="runtimeDetails" />
              </template>
            </section>
            </template>
          </template>
        </view>
      </scroll-view>
    </main>

    <view class="mobile-bottom-nav">
      <button
        v-for="item in mobileTabs"
        :key="item.id"
        class="mobile-nav-button"
        :class="{ active: activeTab === item.id }"
        @click="switchTab(item.id)"
      >
        <component :is="item.icon" :size="18" :stroke-width="activeTab === item.id ? 2.2 : 1.8" />
        <text class="nav-label">{{ item.label }}</text>
      </button>
    </view>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue';
import { onLoad, onHide } from '@dcloudio/uni-app';
import {
  IconAlertCircle as CircleAlert, IconApps as Apps, IconAntennaBars5 as RadioTower, IconArrowDown as ArrowDown,
  IconArrowUp as ArrowUp, IconBatteryCharging as BatteryCharging, IconPlugConnected as Cable,
  IconChartLine as ChartNoAxesCombined, IconCheck as Check, IconCode as Code2, IconCopy as Copy,
  IconDeviceFloppy as Save, IconDevices as Smartphone, IconExternalLink as ExternalLink, IconGauge as Gauge,
  IconLayersIntersect as Layers3, IconLayoutDashboard as LayoutDashboard, IconLock as LockKeyhole,
  IconLockOpen as LockOpen, IconMapPin as MapPin, IconMessage as MessageSquareText,

  IconPower as Power, IconCircleOff as PowerOff, IconRadar as Radar, IconRefresh as RefreshCw,
  IconRotateClockwise as RotateCw, IconRouter as RouterIcon, IconSearch as Search, IconSend as Send,
  IconSettings as Settings, IconTemperature as Thermometer, IconTrash as Trash, IconWifi as Wifi,
  IconWifiOff as WifiOff, IconWorld as World, IconChevronLeft as ChevronLeft, IconChevronRight as ChevronRight
} from '@tabler/icons-vue';
import AppChart from '../../components/AppChart.vue';
import DashboardHome from '../../components/DashboardHome.vue';
import BatteryHistory from '../../components/BatteryHistory.vue';
import DataList from '../../components/DataList.vue';
import MetricGrid from '../../components/MetricGrid.vue';
import { routerApi } from '../../services/router-client.js';
import { batteryGaugeUrl } from '../../utils/battery-gauge.js';
import { buildHomeSignalPanels, buildHomeTemperatureMetrics } from '../../utils/home-telemetry.js';
import { formatBatteryTime, batteryTimeReason, batteryModeText, batteryCsvStatusText } from '../../utils/battery-presentation.js';
import { syncClient } from '../../services/sync.js';
import { buildCellCandidates } from '../../utils/cells.js';
import { mergeChartHistory, normalizePoints } from '../../utils/history.js';
import { TEMPERATURE_LABELS, isTemperatureField, temperatureReading, normalizeTemperaturePoints } from '../../utils/temperature.js';
import { collectionSourceLabels, collectionSourceLabel } from '../../utils/collection-source.js';
import { lineOption, temperatureSeries, throughputSeries, batterySeries } from '../../utils/chart-options.js';
import {
  bytesPerSecond, compactEntries, displayPci, extractVerificationCode, firstValue, formatBytes, formatGigabytes, formatDate, formatDuration,
  formatMonth, numeric, operatorName, withUnit
} from '../../utils/format.js';

import { version as APP_VERSION } from '../../../package.json';
import { createUpdateChecker, RELEASES_PAGE } from '../../services/update-check.js';

const softwareUpdate = reactive({ busy: false, result: null, message: '' });
const nativeUpdate = typeof window !== 'undefined' && !!window.AndroidUpdate;
const apkDownload = reactive({ state: 'idle', progress: 0, message: '' });
let updatePollTimer;
let autoInstallVersion = '';
function pollApkDownload() {
  if (!nativeUpdate) return;
  try {
    const state = JSON.parse(window.AndroidUpdate.status());
    if (state.version && state.version === APP_VERSION) return;
    Object.assign(apkDownload, state);
    if (state.state === 'ready') {
      apkDownload.message = '下载完成，点击安装更新；若系统要求授权，请允许后返回继续安装。';
      if (autoInstallVersion === state.version) {
        autoInstallVersion = '';
        window.AndroidUpdate.install();
      }
    }
  } catch { apkDownload.message = '无法读取下载状态，请重试'; }
}
function downloadSoftwareUpdate() {
  if (apkDownload.state === 'ready') { window.AndroidUpdate.install(); return; }
  const result = softwareUpdate.result;
  if (!result?.apk || !result.isNewer) return;
  autoInstallVersion = result.version;
  window.AndroidUpdate.download(result.apk.url, result.version);
  pollApkDownload();
}
const checkRelease = createUpdateChecker({ storage: {
  getItem: key => uni.getStorageSync(key),
  setItem: (key, value) => uni.setStorageSync(key, value)
} });
async function checkSoftwareUpdate(force = false) {
  if (softwareUpdate.busy) return;
  softwareUpdate.busy = true;
  softwareUpdate.message = '正在检查更新…';
  try {
    const result = await checkRelease(APP_VERSION, force);
    softwareUpdate.result = result;
    softwareUpdate.message = result.isNewer ? `发现新版本 v${result.version}` : '当前已是最新版本';
    if (nativeUpdate && result.isNewer && !result.apk) softwareUpdate.message += '，该版本尚未提供 Android 安装包';
  } catch (error) {
    softwareUpdate.message = error.message || '检查失败，请检查网络后重试';
  } finally { softwareUpdate.busy = false; }
}
function openSoftwareRelease() {
  if (typeof window === 'undefined') return;
  if (window.AndroidRouter) window.location.assign(RELEASES_PAGE);
  else window.open(RELEASES_PAGE, '_blank', 'noopener,noreferrer');
}
const CHART_HISTORY_KEY = 'mu5120-chart-history-v1';
const METRIC_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const BATTERY_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
// 温度/信号折线图只展示最近 2 小时（历史仍按 24 小时采集存储），固定窗口、不带缩放滑块。
const CHART_RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const CHART_HISTORY_SAMPLE_MS = 60 * 1000;
const CHART_HISTORY_MAX_POINTS = Math.ceil(METRIC_HISTORY_WINDOW_MS / CHART_HISTORY_SAMPLE_MS) + 5;
const CELL_DISPLAY_REFRESH_MS = 3000;
const SMS_REFRESH_MS = 5000;

const tabs = [
  { id: 'overview', label: '首页', icon: LayoutDashboard },
  { id: 'trends', label: '趋势', icon: ChartNoAxesCombined },
  { id: 'devices', label: '设备', icon: RouterIcon },
  { id: 'settings', label: '设置', icon: Settings }
];
const mobileTabs = tabs;
const managementTabs = [
  { id: 'clients', label: '连接设备', icon: Smartphone },
  { id: 'sms', label: '短信', description: '查看消息与复制验证码', icon: MessageSquareText },
  { id: 'radio', label: '网络调优', description: '信号、基站与频段锁定', icon: RadioTower },
  { id: 'stock', label: '原厂后台', description: '更多路由器设置', icon: World },
  { id: 'detail', label: '设备详情与控制', description: '固件、运行信息与重启', icon: RouterIcon }
];
const trendMetrics = [
  { id: 'throughput', label: '网速' }, { id: 'temperature', label: '温度' },
  { id: 'battery', label: '电池' }, { id: 'signal', label: '信号' }
];
const activeTab = ref('overview');
const managementTab = ref('clients');
const trendMetric = ref('throughput');
const trendHours = ref(2);
const signalMetric = ref('rsrp');
const trendDetail = ref('');
const diagnosticsOpen = ref(false);
const settingsSection = ref('');
const smsComposeOpen = ref(false);
const freshnessNow = ref(Date.now());
// 原厂后台内嵌状态：与 App 共享同一会话 Cookie，打开时自动登录管理员 + 开发者会话。
const stockConsole = reactive({ url: '', busy: false, loggedIn: false, message: '未打开' });
// 打开方式：浏览器/安卓壳内嵌 iframe（安卓经 127.0.0.1 本地反代，POST 完整），
// 安卓反代未启动时退回全屏直连；桌面壳暂以系统浏览器兜底。
const stockOpenMode = routerApi.stockUiOpenMode();
const stockUiCanFullscreen = typeof window !== 'undefined' && !!window.AndroidRouter;
// 浏览器内嵌是同源 iframe（可读 hash 做精准自愈）；安卓本地反代是跨源
// （127.0.0.1 vs appassets），只能改为轮询会话的自愈方式。
const stockUiSameOrigin = stockOpenMode === 'embed' && !stockUiCanFullscreen;

// 原厂后台独立缩放：应用的双指缩放被刻意禁用，且跨源 iframe 内的手势父页面
// 接不到，所以用按钮对 iframe 做 transform 缩放（放大时内部视口变窄、文字
// 变大可读；缩小时得到桌面版全景），档位持久化，范围 25%~150%。
const STOCK_SCALE_MIN = 0.25;
const STOCK_SCALE_MAX = 1.5;
const STOCK_SCALE_STEP = 0.25;

function loadStockScale() {
  let stored = null;
  try { stored = uni.getStorageSync('mu5120-stock-scale'); } catch {}
  const value = Number(stored);
  // uni.getStorageSync 对缺失键返回空串（Number('') === 0），视为未设置。
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(STOCK_SCALE_MAX, Math.max(STOCK_SCALE_MIN, Math.round(value / STOCK_SCALE_STEP) * STOCK_SCALE_STEP));
}

const stockScale = ref(loadStockScale());

function saveStockScale(value) {
  stockScale.value = value;
  try { uni.setStorageSync('mu5120-stock-scale', value); } catch {}
}

function adjustStockScale(delta) {
  const raw = Number((stockScale.value + delta).toFixed(2));
  saveStockScale(Math.min(STOCK_SCALE_MAX, Math.max(STOCK_SCALE_MIN, Math.round(raw / STOCK_SCALE_STEP) * STOCK_SCALE_STEP)));
}

function resetStockScale() {
  saveStockScale(1);
}
const menuOpen = ref(false);
const refreshing = ref(false);
const manualRefreshing = ref(false);
const actionBusy = ref(false);
const errorMessage = ref('');
const lastUpdate = computed(() => data.value.timestamp ? new Date(data.value.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
const clock = ref('');
const data = ref({ status: {}, signal: {}, temperature: {}, resources: {}, locks: {}, stations: [], cableStations: [], neighbors: {}, features: {}, battery: {}, login: {} });
const cellDisplay = ref({ signal: {}, neighbors: {} });
const histories = reactive(loadChartHistory());
const selectedCellKey = ref('');
const neighborQuery = ref('');
const lockForm = reactive({ pci: '', arfcn: '', band: '', scs: 30 });
const radioActionResult = ref('');
const lteBands = [1, 3, 5, 7, 8, 20, 28, 34, 38, 39, 40, 41];
const nrBands = [1, 3, 5, 8, 28, 41, 77, 78];
// 芯片列表之外的已锁频段（如固件返回的 229）：单独渲染成"自定义"chip，可见、可取消，
// 不再静默丢弃——否则界面上看不出当前锁定状态。
// 固件真实锁定状态（独立于 chip 选中意图）：直接渲染 locks 字段，
// 无论频段是否在 chip 列表里都能看到"当前锁了什么"。
const lockedStatusTags = computed(() => {
  const locks = data.value.locks || {};
  const tags = [];
  // 真机实验（2026-09-15）：nr5g_band_lock 是静态频段能力列表（恒 "1,78"），不是锁状态；
  // 仅当固件不返回 sa 字段（undefined，旧固件）时才回退它，空串表示无锁。
  const saRaw = locks.nr5g_sa_band_lock !== undefined && locks.nr5g_sa_band_lock !== null
    ? String(locks.nr5g_sa_band_lock)
    : String(locks.nr5g_band_lock ?? '');
  const sa = parseBandText(saRaw);
  if (sa.length) tags.push(`SA: ${sa.map(band => `n${band}`).join(' ')}`);
  const nsa = parseBandText(locks.nr5g_nsa_band_lock);
  if (nsa.length) tags.push(`NSA: ${nsa.map(band => `n${band}`).join(' ')}`);
  const lteMaskBands = lteBands.filter(band => isBandInMask(locks.lte_band_lock, band));
  const lteExtra = parseBandText(locks.lte_freq_lock).filter(band => !lteMaskBands.includes(band));
  const lte = [...lteMaskBands, ...lteExtra];
  if (lte.length) tags.push(`LTE: ${lte.map(band => `B${band}`).join(' ')}`);
  if (String(locks.nr5g_cell_lock || '').trim() && String(locks.nr5g_cell_lock).trim() !== '1,1,1,1') {
    const [pci, arfcn] = String(locks.nr5g_cell_lock).split(',');
    if (pci && pci !== '1') tags.push(`5G 小区: PCI ${pci} / ARFCN ${arfcn || '—'}`);
  }
  if (String(locks.lte_pci_lock || '').trim()) tags.push(`LTE 小区: PCI ${locks.lte_pci_lock} / ARFCN ${locks.lte_earfcn_lock || '—'}`);
  return tags;
});
const extraLteBands = computed(() => selectedLteBands.value.filter(band => !lteBands.includes(band)));
const extraSaBands = computed(() => selectedSaBands.value.filter(band => !nrBands.includes(band)));
const extraNsaBands = computed(() => selectedNsaBands.value.filter(band => !nrBands.includes(band)));
const selectedLteBands = ref([]);
const selectedSaBands = ref([]);
const selectedNsaBands = ref([]);
const bandSelectionsInitialized = reactive({ lte: false, sa: false, nsa: false });
const messages = ref([]);
const smsRefreshing = ref(false);
const smsCapacity = ref('尚未读取');
const smsCodeCount = computed(() => messages.value.filter(message => message.verificationCode).length);
const selectedSmsIds = ref([]);
const selectableSmsIds = computed(() => messages.value.map(smsMessageId).filter(Boolean));
const selectedSmsCount = computed(() => selectedSmsIds.value.length);
const allSmsSelected = computed(() => selectableSmsIds.value.length > 0 && selectableSmsIds.value.every(id => selectedSmsIds.value.includes(id)));
const smsNumber = ref('');
const smsMessage = ref('');
const settingsResult = ref('');
const deviceActionResult = ref('');
const config = reactive(routerApi.getConfig());
const settingsForm = reactive({ ...config });
const batterySettingsForm = reactive({ batterySource: config.batterySource, batteryHost: config.batteryHost, batteryPort: String(config.batteryPort) });
const batterySettingsSaving = ref(false);
const batterySettingsResult = ref('');
const batterySettingsError = ref(false);
const batterySourceText = computed(() => config.batterySource === 'factory' ? '原厂电量接口' : '88 端口电池接口');
const batteryEndpointPreview = computed(() => {
  try { return batteryGaugeUrl(config.routerUrl, batterySettingsForm.batteryHost, 88); }
  catch { return '请输入有效的 IP 地址'; }
});
const overlayState = reactive(routerApi.getOverlayState());
// 安卓后台采集状态与电池优化授权（仅 Android App 可用；息屏期间由原生服务持续采集落盘）。
const backgroundState = reactive({ ...routerApi.getBackgroundMonitorState(), ...routerApi.getBatteryOptimizationState() });
const backgroundSourceCounts = reactive({});
const backgroundBackfill = ref('');
const syncState = reactive(syncClient.getState());
let pollTimer = null;
let smsPollTimer = null;
let clockTimer = null;
let backgroundStateTimer = null;
let lastChartHistorySave = 0;
let lastCellDisplayUpdate = 0;
let lastCellDisplaySignature = '';
let lastSyncedCandidateKey = '';
let pendingRefresh = false;
let pendingManualRefresh = false;

const status = computed(() => data.value.status || {});
const signal = computed(() => data.value.signal || {});
const cellSignal = computed(() => cellDisplay.value.signal || {});
const connectionAddress = computed(() => config.routerUrl);
const temperature = computed(() => data.value.temperature || {});
const login = computed(() => data.value.login || {});
const stations = computed(() => data.value.stations || []);
const cableStations = computed(() => data.value.cableStations || []);
const battery = computed(() => data.value.battery || {});
const batterySamples = computed(() => battery.value.samples || []);
const features = computed(() => data.value.features || {});
const featureResult = ref('');
const featureFormEditing = ref(false);
const featureFormsInitialized = ref(false);
const trafficPlanForm = reactive({ enabled: false, sizeGb: '', alertPercent: '', autoClear: false, clearDate: '', usedGb: '' });
const activeTabInfo = computed(() => tabs.find(tab => tab.id === activeTab.value) || tabs[0]);
const secondaryPage = computed(() => (activeTab.value === 'devices' && managementTab.value !== 'clients') || (activeTab.value === 'settings' && Boolean(settingsSection.value)));
const settingsTitles = { connection: '路由器连接', battery: '电量来源', sync: '局域网互通', overlay: '悬浮监测', background: '后台采集与权限', update: '软件更新', diagnostics: '采集诊断' };
const pageTitle = computed(() => {
  if (activeTab.value === 'devices' && managementTab.value !== 'clients') return managementTabs.find(item => item.id === managementTab.value)?.label || '设备';
  if (activeTab.value === 'settings' && settingsSection.value) return settingsTitles[settingsSection.value] || '设置';
  return activeTabInfo.value.label;
});
const connected = computed(() => !data.value.stale && (login.value.loggedIn || status.value.loginfo === 'ok'));
const overlayStateText = computed(() => {
  if (!overlayState.available) return '仅 Android App 支持悬浮窗';
  if (!overlayState.enabled) return '已关闭';
  return overlayState.permitted ? '已开启，可拖动调整位置' : '已开启，等待系统悬浮窗权限';
});
const backgroundStateText = computed(() => {
  if (!backgroundState.available) return '仅 Android App 支持息屏采集';
  const saved = Number(backgroundState.lastSavedAt) || 0;
  const savedText = saved ? `最近落盘 ${formatDate(saved)}` : '尚未落盘';
  const error = backgroundState.lastError || backgroundState.collectionError;
  if (error && !backgroundState.background) return `${savedText}（前台由页面采集）`;
  if (error) return `${savedText}，后台采集异常：${error}`;
  return backgroundState.background ? `${savedText}，后台采集中` : `${savedText}，前台由页面采集`;
});
const batteryOptimizationText = computed(() => {
  if (!backgroundState.available) return '';
  return backgroundState.ignoring ? '已豁免 Android 电池优化，厂商后台权限需单独设置' : '未豁免电池优化，息屏后可能被系统暂停';
});
const syncStateText = computed(() => {
  if (!syncState.supported) return '当前环境不支持（仅 EXE 桌面端与 Android App 可作服务节点，浏览器预览始终直连）';
  if (!syncState.enabled) return '已关闭，各设备各自直连路由器';
  return '已开启，局域网内自动共享历史';
});
const syncRoleText = computed(() => ({ collector: '本机：采集器', viewer: '本机：查看端', direct: '本机：直连' }[syncState.role] || '本机：直连'));
const syncRoleClass = computed(() => `sync-role-${syncState.role}`);
const syncRoleHint = computed(() => {
  if (syncState.role === 'collector') return '本机独占登录路由器，并向其他设备共享实时与历史数据';
  if (syncState.role === 'viewer') return `正在读取采集器「${syncState.hub?.name || '未知'}」的数据，本机不占用路由器会话`;
  return '局域网内暂无其他采集器，本机直接连接路由器';
});
const connectionMessage = computed(() => data.value.stale ? '服务器缓存数据' : (login.value.message || '连接失败'));
const networkType = computed(() => firstValue(signal.value.network_type, status.value.network_type));
const operator = computed(() => operatorName(
  firstValue(signal.value.network_provider, signal.value.Operator, ''),
  firstValue(signal.value.rmcc, signal.value.mdm_mcc, ''),
  firstValue(signal.value.rmnc, signal.value.mdm_mnc, '')
));
function carrierAggregationText(fields = {}) {
  const nrPayload = String(fields.nr_multi_ca_scell_info ?? '').trim();
  if (nrPayload && !['0', '1', '—'].includes(nrPayload)) return 'NR CA';
  if (fields.wan_lte_ca === 'ca_activated') return 'LTE CA';
  if (fields.wan_lte_ca === 'ca_deactivated') return '未启用';
  return '待获取';
}
const homeSignalPanels = computed(() => buildHomeSignalPanels(signal.value, {
  network: networkType.value, live: freshness.value.state === 'live'
}));
const homeSignalSubtitle = computed(() => freshness.value.state === 'live' ? '当前驻留小区' : '等待最新信号');
const candidates = computed(() => buildCellCandidates(cellDisplay.value));
const displayedCandidates = computed(() => {
  const query = neighborQuery.value.trim().toLowerCase();
  if (!query) return candidates.value;
  return candidates.value.filter(item => `${item.rat} ${item.band} ${item.pci} ${item.arfcn} ${item.rsrp} ${item.rsrq}`.toLowerCase().includes(query));
});
const selectedCandidate = computed(() => candidates.value.find(item => item.key === selectedCellKey.value) || candidates.value[0]);

const temperatureNames = TEMPERATURE_LABELS;
const temperatureMetrics = computed(() => Object.entries(temperature.value)
  .filter(([key]) => isTemperatureField(key))
  .map(([key, raw]) => {
    const reading = temperatureReading(key, raw);
    return { key, label: temperatureNames[key] || key, value: withUnit(reading.value, '°C'), state: reading.state,
      note: reading.state === 'invalid' ? '读数异常' : reading.state === 'missing' ? '暂无读数' : '',
      className: reading.state === 'invalid' ? 'reading-invalid' : '' };
  }));
const homeTemperatureAlert = computed(() => {
  const count = homeTemperatureMetrics.value.filter(item => item.state === 'invalid').length;
  return count ? `${count} 项读数异常` : '';
});
const homeTemperatureMetrics = computed(() => buildHomeTemperatureMetrics(
  freshness.value.state === 'live' ? temperature.value : {},
  { batteryReading: batteryTemperatureReading.value }
));
const homeTemperatureSubtitle = computed(() => freshness.value.state === 'live'
  ? (homeTemperatureAlert.value || '设备实时读数')
  : (homeTemperatureMetrics.value.length ? '电池已更新 · 其他传感器待刷新' : '等待最新温度'));

const temperatureDiagnostics = computed(() => Object.entries(temperature.value).map(([key, raw]) => ({
  label: key, value: `${raw == null || raw === '' ? '（空）' : String(raw)}${isTemperatureField(key) && temperatureReading(key, raw).state === 'invalid' ? ' · 读数异常' : ''}`
})));
const monthlyUsedBytes = computed(() => totalBytes(status.value.monthly_rx_bytes, status.value.monthly_tx_bytes));
const batteryPercentText = computed(() => {
  const gauge = status.value.battery_gauge;
  const percent = Object.hasOwn(status.value, 'battery_gauge')
    ? (gauge?.state === 'valid' ? numeric(gauge.percent) : null)
    : numeric(firstValue(battery.value.percent, status.value.battery_vol_percent, status.value.battery_value));
  return percent != null && percent >= 0 && percent <= 100 ? `${percent.toFixed(2)}%` : '—';
});
const batteryStateText = computed(() => batteryModeText(battery.value.measurement));
function batteryTimeResult(key) {
  const now = freshnessNow.value;
  const expired = [data.value.timestamp, battery.value.calculatedAt].some(at =>
    typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || now - at > 5000);
  const validUntil = data.value.status?.battery_gauge?.validUntil;
  const gaugeExpired = typeof validUntil === 'number' && Number.isFinite(validUntil) && now > validUntil;
  return data.value.stale === true || expired || gaugeExpired || !battery.value[key]
    ? { state: 'unavailable', minutes: null, reason: '待刷新', targetPercent: key === 'timeToFull' ? 100 : 0 }
    : battery.value[key];
}
const batteryTimeToFullText = computed(() => formatBatteryTime(batteryTimeResult('timeToFull')));
const batteryRuntimeText = computed(() => formatBatteryTime(batteryTimeResult('runtime')));
const batteryTimeToFullReason = computed(() => batteryTimeReason(batteryTimeResult('timeToFull'), battery.value.csvAnalysis));
const batteryRuntimeReason = computed(() => batteryTimeReason(batteryTimeResult('runtime'), battery.value.csvAnalysis));
function clientListAvailability(group) {
  const available = data.value.clientAvailability?.[group];
  if (available === true || available === false) return available;
  return data.value.errors?.[group] ? false : null;
}
function clientListCountText(group) {
  const count = (group === 'stations' ? stations.value : cableStations.value).length;
  const cached = data.value.stale ? ' · 缓存' : '';
  if (clientListAvailability(group) === true) return `${count} 台${cached}`;
  return count ? `${count} 条记录${cached}` : '数量待获取';
}
function clientEmptyText(group) {
  const label = group === 'stations' ? '无线' : '有线';
  const available = clientListAvailability(group);
  if (available === false) return `${label}设备列表获取失败，请稍后重试。`;
  if (!data.value.timestamp || available !== true) return `${label}设备列表待获取。`;
  return data.value.stale ? `缓存中没有${label}设备记录。` : `当前没有${label}设备。`;
}
const clientSummaryText = computed(() => {
  if (!data.value.timestamp) return '待获取';
  const count = stations.value.length + cableStations.value.length;
  const cached = data.value.stale ? ' · 缓存' : '';
  const availability = ['stations', 'cableStations'].map(clientListAvailability);
  if (availability.every(value => value === true)) return `${count} 台${data.value.stale ? ' · 缓存' : '已连接'}`;
  if (count) return `${count} 条设备记录 · 连接数量未知${cached}`;
  return `${availability.includes(false) ? '列表获取失败 · 连接数量未知' : '连接数量待获取'}${cached}`;
});
const smsSummaryText = computed(() => {
  const unread = numeric(status.value.sms_unread_num);
  return unread == null ? '查看收件箱与验证码' : unread > 0 ? `${unread} 条未读` : '暂无未读短信';
});
const freshness = computed(() => describeFreshness({ connected: connected.value, stale: data.value.telemetryStale, timestamp: data.value.telemetryTimestamp, now: freshnessNow.value }));

function totalBytes(received, sent) {
  const rx = numeric(received);
  const tx = numeric(sent);
  return rx == null || tx == null || rx < 0 || tx < 0 ? null : rx + tx;
}

function describeFreshness({ connected, stale = false, timestamp, now = Date.now() }) {
  const acquired = Number(timestamp);
  if (!Number.isFinite(acquired) || acquired <= 0) return { state: 'offline', label: '尚未连接', time: '等待首次有效数据' };
  const ageSeconds = Math.max(0, Math.floor((now - acquired) / 1000));
  const old = stale || !connected || ageSeconds > 15;
  const time = new Date(acquired).toLocaleTimeString('zh-CN', { hour12: false });
  return { state: old ? 'stale' : 'live', label: old ? '数据未更新 · 显示缓存' : '已连接 · 实时', time: `${old ? '最后采集' : '更新于'} ${time}` };
}

const deviceIdentityDetails = computed(() => toItems({
  'IMEI': firstValue(status.value.imei),
  '当前手机号': firstValue(status.value.msisdn, status.value.sim_msisdn, status.value.phone_number),
  '固件版本': firstValue(status.value.wa_inner_version, login.value.firmware),
  'LAN IP': firstValue(status.value.lan_ipaddr),
  '开机时长': formatRunDuration(status.value.realtime_time),
  '开机时间': bootClockTime(),
  '累计使用': formatRunDuration(status.value.total_time)
}));

// 开机时长取固件字段 realtime_time：设备开机即拨号，联网建立时刻即开机时刻，
// 中途断网重连该值会被固件清零重计。开机时间 = 采样时间戳 - realtime_time。
function formatRunDuration(raw) {
  const total = numeric(raw);
  if (total == null) return '—';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  if (minutes) return `${minutes} 分`;
  return `${Math.floor(total)} 秒`;
}

function bootClockTime() {
  const seconds = numeric(status.value.realtime_time);
  const sampledAt = Number(data.value.timestamp);
  if (seconds == null || !Number.isFinite(sampledAt) || !sampledAt) return '—';
  const boot = new Date(sampledAt - seconds * 1000);
  const clock = boot.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const dayOf = value => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const today = dayOf(new Date());
  if (dayOf(boot) === today) return `今天 ${clock}`;
  if (dayOf(boot) === today - 86400000) return `昨天 ${clock}`;
  return `${boot.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${clock}`;
}

const networkDetails = computed(() => toItems({
  '网络制式': networkType.value,
  '运营商': operator.value,
  'MCC / MNC': `${firstValue(signal.value.rmcc, signal.value.mdm_mcc)} / ${firstValue(signal.value.rmnc, signal.value.mdm_mnc)}`,
  '联网状态': firstValue(status.value.ppp_status, status.value.wan_connect_status),
  '运行模式': firstValue(status.value.opms_wan_mode),
  'WAN IPv4': firstValue(status.value.wan_ipaddr),
  'WAN IPv6': firstValue(status.value.ipv6_wan_ipaddr)
}));

// 信号质量五档色阶：绿=优秀、黄=良好、橙=一般、浅红=较差、深红=极差。
// 阈值与进度条范围按 LTE/NR 工程分级约定，仅用于展示，不影响业务逻辑。
// bars: [优秀下限, 良好下限, 一般下限, 较差下限]（低于最后一档即极差）。
const SIGNAL_QUALITY_SLOTS = [
  { label: 'RSRP', key: 'rsrp', unit: ' dBm', min: -120, max: -70, bars: [-80, -90, -100, -110] },
  { label: 'RSRQ', key: 'rsrq', unit: ' dB', min: -24, max: -5, bars: [-10, -14, -18, -22] },
  { label: 'SINR', key: 'sinr', unit: ' dB', min: -10, max: 25, bars: [20, 13, 0, -5] },
  { label: 'RSSI', key: 'rssi', unit: ' dBm', min: -100, max: -60, bars: [-65, -75, -85, -95] }
];
const signalValues = computed(() => ({
  rsrp: numeric(firstValue(cellSignal.value.Z5g_rsrp, cellSignal.value.lte_rsrp)),
  rsrq: numeric(firstValue(cellSignal.value.Z5g_rsrq, cellSignal.value.lte_rsrq)),
  sinr: numeric(firstValue(cellSignal.value.Z5g_SINR, cellSignal.value.Z5g_snr, cellSignal.value.lte_snr)),
  rssi: numeric(firstValue(cellSignal.value.Z5g_rssi, cellSignal.value.lte_rssi, cellSignal.value.rssi))
}));
const signalQualityMetrics = computed(() => SIGNAL_QUALITY_SLOTS
  .filter(slot => signalValues.value[slot.key] != null)
  .map(slot => {
    const value = signalValues.value[slot.key];
    const percent = Math.round(Math.min(100, Math.max(0, ((value - slot.min) / (slot.max - slot.min)) * 100)));
    const level = ['excellent', 'good', 'fair', 'weak', 'bad'].find(
      (name, index) => value >= slot.bars[index]
    ) || 'bad';
    return { label: slot.label, value: `${value}${slot.unit}`, percent, level };
  }));
// 颜色条样式全部内联（宽度 + 语义色）：安卓 WebView 对模板动态 class +
// 百分比宽度的组合兼容性差，内联样式不依赖 CSS class 即可稳定渲染。
const SIGNAL_QUALITY_COLORS = { excellent: '#36c648', good: '#ffd033', fair: '#ff9f29', weak: '#ff5c42', bad: '#d82f2f' };
function qualityFillStyle(metric) {
  if (!metric) return '';
  return `width: ${metric.percent}%; background: ${SIGNAL_QUALITY_COLORS[metric.level] || '#ff9f29'};`;
}
const cellParamsDetails = computed(() => toItems({
  PCI: displayPci(cellSignal.value.nr5g_pci, cellSignal.value.lte_pci),
  '频段': firstValue(cellSignal.value.nr5g_action_band, cellSignal.value.lte_ca_pcell_band, cellSignal.value.wan_active_band),
  'ARFCN': firstValue(cellSignal.value.nr5g_action_channel, cellSignal.value.Z5g_dlEarfcn, cellSignal.value.lte_ca_pcell_arfcn, cellSignal.value.wan_active_channel),
  '带宽': firstValue(cellSignal.value.nr5g_nsa_bandwidth, cellSignal.value.lte_ca_pcell_bandwidth, cellSignal.value.bandwidth)
}));

const secondaryCellDetails = computed(() => {
  const caState = String(cellSignal.value.wan_lte_ca || '').trim();
  const multiLte = cellSignal.value.lte_multi_ca_scell_info;
  const multiNr = cellSignal.value.nr_multi_ca_scell_info;
  const hasCarrierPayload = caState === 'ca_activated'
    || [multiLte, multiNr, cellSignal.value.lte_multi_ca_scell_sig_info].some(value => value !== undefined && value !== null && String(value).trim() !== '' && !['0', '1'].includes(String(value).trim()));
  const valueForDisplay = value => {
    if (value === undefined || value === null || value === '') return '';
    // Some firmware returns the default flag "1" for an empty SCell field.
    // Do not present that flag as a real auxiliary carrier until CA data exists.
    if (!hasCarrierPayload && String(value).trim() === '1') return '';
    return value;
  };
  return compactEntries({
    'LTE SCell Band': valueForDisplay(cellSignal.value.lte_ca_scell_band),
    'LTE SCell BW': valueForDisplay(cellSignal.value.lte_ca_scell_bandwidth),
    'LTE SCell ARFCN': valueForDisplay(cellSignal.value.lte_ca_scell_arfcn),
    'LTE 多载波': valueForDisplay(multiLte),
    'LTE 辅载波信号': valueForDisplay(cellSignal.value.lte_multi_ca_scell_sig_info),
    'NR 多载波': valueForDisplay(multiNr),
    'NR CA DL': valueForDisplay(cellSignal.value.nr_ca_dl_state),
    'NR CA UL': valueForDisplay(cellSignal.value.nr_ca_ul_state)
  }).map(([label, value]) => ({ label, value }));
});

const usageSummaryMetrics = computed(() => [
  { label: '当前会话', value: formatBytes(totalBytes(status.value.realtime_rx_bytes, status.value.realtime_tx_bytes)) },
  { label: '本月合计', value: formatBytes(monthlyUsedBytes.value) }
]);
const trafficPlanMetrics = computed(() => {
  const enabled = features.value.data_volume_limit_switch === '1';
  const usedBytes = monthlyUsedBytes.value;
  const planGb = trafficPlanGb(features.value.data_volume_limit_size);
  const remainingGb = !enabled || planGb == null || planGb <= 0 || usedBytes == null ? null : Math.max(0, planGb - usedBytes / (1024 ** 3));
  return [
    { label: '状态', value: enabled ? '已启用' : '未启用' },
    { label: '套餐', value: planGb == null ? '未设置' : `${planGb} GB` },
    { label: '已用', value: formatGigabytes(usedBytes) },
    { label: '剩余', value: remainingGb == null ? '—' : `${remainingGb.toFixed(2)} GB` }
  ];
});
function trafficPlanGb(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const [amount, multiplier = '1024'] = String(raw).split('_');
  const value = Number(amount);
  const unit = Number(multiplier);
  return Number.isFinite(value) && value > 0 && Number.isFinite(unit) && unit > 0 ? value * unit / 1024 : null;
}
const usageDetails = computed(() => toItems({
  '会话下载': formatBytes(status.value.realtime_rx_bytes),
  '会话上传': formatBytes(status.value.realtime_tx_bytes),
  '会话时长': formatDuration(status.value.realtime_time),
  '本月下载': formatBytes(status.value.monthly_rx_bytes),
  '本月上传': formatBytes(status.value.monthly_tx_bytes),
  '累计联网': formatDuration(status.value.monthly_time)
}));
const batterySourceNote = computed(() => {
  const gauge = status.value.battery_gauge;
  if (!gauge && battery.value.percentSource !== 'gauge88') return '原厂电量接口';
  try { const endpoint = new URL(gauge?.url || battery.value.percentEndpoint); return `${endpoint.host} · 设备电量`; }
  catch { return '88 端口电池接口'; }
});
const batteryTemperatureReading = computed(() => {
  const now = freshnessNow.value;
  const at = data.value.timestamp;
  const fresh = data.value.stale !== true && typeof at === 'number' && Number.isFinite(at)
    && at > 0 && now - at <= 5000;
  const gauge = status.value.battery_gauge;
  const custom = Object.hasOwn(status.value, 'battery_gauge') || battery.value.percentSource === 'gauge88';
  const validGauge = gauge?.state === 'valid' && typeof gauge.validUntil === 'number'
    && Number.isFinite(gauge.validUntil) && now <= gauge.validUntil;
  return temperatureReading('battery_temp', fresh && (!custom || validGauge)
    ? (custom ? gauge.raw?.temp_c : temperature.value.battery_temp) : undefined);
});
const batteryMetrics = computed(() => [
  { label: '电池电量', value: batteryPercentText.value, note: batterySourceNote.value },
  { label: '电池状态', value: batteryStateText.value },
  { label: '电池温度', value: withUnit(batteryTemperatureReading.value.value, '°C'), note: batteryTemperatureReading.value.state === 'invalid' ? '读数异常' : '' },
  { label: '预计充满', value: batteryTimeToFullText.value, note: batteryTimeToFullReason.value },
  { label: '剩余可用', value: batteryRuntimeText.value, note: batteryRuntimeReason.value },
  { label: '估算口径', value: '放电到 0%', note: battery.value.percentSource === 'gauge88' ? '设备 CSV 日志分析' : '原厂电量历史分析' }
]);
const batteryDiagnostics = computed(() => buildBatteryDiagnostics(battery.value.measurement, status.value.battery_gauge?.raw, battery.value));

function buildBatteryDiagnostics(measurement = {}, raw = {}, summary = {}) {
  const measured = measurement || {}, gauge = raw || {};
  const format = (value, divisor = 1, digits = 2, unit = '') => typeof value === 'number' && Number.isFinite(value)
    ? `${(value / divisor).toFixed(digits)}${unit}` : '—';
  const flag = (value, yes, no) => value === true || value === 1 ? yes : value === false || value === 0 ? no : '—';
  const inputQuality = gauge.input_data_quality === 'disconnected' ? '已断开'
    : gauge.input_data_quality === 'ok' ? '有效' : '不可读';
  const basis = typeof measured.capacityBasis === 'string' && measured.capacityBasis ? measured.capacityBasis : '—';
  const observation = typeof measured.fullStableSeconds === 'number' && Number.isFinite(measured.fullStableSeconds)
    ? `${(Math.max(0, measured.fullStableSeconds) / 60).toFixed(1)} / 20 分钟` : '—';
  return [
    { label: '电池净电流', value: format(measured.netCurrentMa, 1, 2, ' mA') },
    { label: '电池净功率', value: format(measured.netPowerW, 1, 3, ' W') },
    { label: '电池电压', value: format(measured.voltageMv, 1000, 3, ' V') },
    { label: '软件可用容量', value: format(measured.usableCapacityMah, 1, 0, ' mAh') },
    { label: '容量依据', value: basis },
    { label: '标称容量', value: format(gauge.capacity_mah_nominal, 1, 0, ' mAh') },
    { label: 'USB 连接', value: flag(gauge.usb_online, '已连接', '已断开') },
    { label: 'USB 总输入电压', value: format(gauge.input_voltage_mv, 1000, 3, ' V') },
    { label: 'USB 总输入电流', value: format(gauge.input_current_ma, 1, 2, ' mA') },
    { label: 'USB 总输入功率', value: format(gauge.input_power_w, 1, 3, ' W') },
    { label: 'USB 输入质量', value: inputQuality },
    { label: '系统轨电压', value: format(gauge.system_voltage_mv, 1000, 3, ' V') },
    { label: '系统轨电流', value: format(gauge.system_current_ma, 1, 2, ' mA') },
    { label: '累计充入', value: format(gauge.charge_uah, 1000, 2, ' mAh') },
    { label: '累计放出', value: format(gauge.discharge_uah, 1000, 2, ' mAh') },
    { label: '本次满充确认', value: flag(measured.fullConfirmed, '已确认', '未确认') },
    { label: '历史满充基准', value: flag(measured.fullAnchorValid, '存在', '未建立') },
    { label: '满充观察', value: observation },
    { label: '满充观察剩余', value: typeof measured.fullStableSeconds === 'number' && Number.isFinite(measured.fullStableSeconds)
      ? `条件不变时约 ${Math.max(0, (1200 - measured.fullStableSeconds) / 60).toFixed(1)} 分钟` : '—' },
    { label: '容量校准', value: flag(gauge.capacity_calibrated, '已校准', '未校准') },
    { label: 'SOC 校准', value: flag(gauge.soc_calibrated, '已校准', '未校准') },
    { label: '采样质量', value: gauge.data_quality === 'ok' ? '有效' : '不可用' },
    { label: '采样缺失', value: format(gauge.missing_s, 1, 0, ' 秒') },
    { label: '缺口次数', value: format(gauge.gap_events, 1, 0) },
    { label: '最近缺口原因', value: typeof gauge.last_gap_reason === 'string' && gauge.last_gap_reason ? gauge.last_gap_reason : '—' },
    { label: '有效估算覆盖', value: format(summary.windowSeconds, 1, 0, ' 秒') },
    ...(summary.percentSource === 'gauge88' ? [
      { label: '设备日志', value: batteryCsvStatusText(summary.csvAnalysis) },
      { label: '日志有效点数', value: format(summary.csvAnalysis?.points, 1, 0) },
      { label: '日志无效记录', value: format(summary.csvAnalysis?.invalidRows, 1, 0) }
    ] : [])
  ];
}
const runtimeDetails = computed(() => toItems({
  '当前数据通道': syncState.role === 'viewer'
    ? `局域网互通 · 读取采集器「${syncState.hub?.name || '未知'}」`
    : (syncState.role === 'collector' ? '局域网互通 · 本机采集并共享' : '局域网直连'),
  'H5 浏览器': '开发预览通过本机代理访问路由器',
  'Android App': '原生 HTTP 直连路由器，原厂后台走本机反向代理',
  'Windows 桌面端': '主进程代理会话直连路由器',
  '登录': '使用保存密码与动态 LD 自动计算 SHA-256',
  '图表窗口': '可查看最近 2 小时 / 24 小时',
  '历史保存': '本机 24 小时，启用互通后随局域网共享',
  '软件版本': `v${APP_VERSION}`,
  '开发者': '晓泽',
  '开发者写接口': '自动刷新主会话、LD 与动态 AD',
}));

const trendWindowMs = computed(() => trendHours.value * 60 * 60 * 1000);
const trendTitle = computed(() => ({ throughput: '上传与下载', temperature: '设备温度 · °C', battery: '电池电量 · %', signal: `${signalMetric.value.toUpperCase()} · ${signalMetric.value === 'rsrp' ? 'dBm' : 'dB'}` }[trendMetric.value]));
function throughputOption(windowMs) {
  const cutoff = Math.ceil(Date.now() / CHART_HISTORY_SAMPLE_MS) * CHART_HISTORY_SAMPLE_MS - windowMs;
  return lineOption(throughputSeries(histories, cutoff), false, { min: 0 }, { windowMs, context: 'throughput' });
}
const signalChartOption = computed(() => lineOption([
  { id: signalMetric.value, name: signalMetric.value.toUpperCase(), unit: signalMetric.value === 'rsrp' ? 'dBm' : 'dB', data: histories[signalMetric.value], color: '#4267ed' }
], false, {}, { windowMs: activeTab.value === 'trends' ? trendWindowMs.value : CHART_RECENT_WINDOW_MS, context: `signal-${signalMetric.value}` }));
const temperatureChartOption = computed(() => lineOption(temperatureSeries(histories.temperatures), false, {},
  { windowMs: trendWindowMs.value, context: 'temperature', unit: '°C' }));
const batteryChartOption = computed(() => lineOption(batterySeries(batterySamples.value), false, { min: 0, max: 100 },
  { windowMs: trendWindowMs.value, context: 'battery' }));
const trendChartOption = computed(() => ({
  throughput: () => throughputOption(trendWindowMs.value), temperature: () => temperatureChartOption.value,
  battery: () => batteryChartOption.value, signal: () => signalChartOption.value
}[trendMetric.value]()));

function toItems(object) {
  return Object.entries(object).map(([label, value]) => ({ label, value: firstValue(value) }));
}

function normalizePointList(value, cutoff) {
  // 委托给共享工具，保持原有分钟桶归一行为（sync.js / desktop 主进程复用同一逻辑）。
  return normalizePoints(value, { cutoff, sampleMs: CHART_HISTORY_SAMPLE_MS, maxPoints: CHART_HISTORY_MAX_POINTS });
}

function loadChartHistory() {
  const cutoff = Date.now() - METRIC_HISTORY_WINDOW_MS;
  let stored = {};
  try {
    const value = uni.getStorageSync(CHART_HISTORY_KEY);
    if (value && typeof value === 'object' && !Array.isArray(value)) stored = value;
  } catch {}
  const temperatures = {};
  const storedTemperatures = stored.temperatures && typeof stored.temperatures === 'object' && !Array.isArray(stored.temperatures)
    ? stored.temperatures
    : {};
  Object.entries(storedTemperatures).forEach(([key, values]) => {
    const normalized = normalizePointList(normalizeTemperaturePoints(key, values), cutoff);
    if (normalized.length) temperatures[key] = normalized;
  });
  return {
    rsrp: normalizePointList(stored.rsrp, cutoff),
    sinr: normalizePointList(stored.sinr, cutoff),
    rsrq: normalizePointList(stored.rsrq, cutoff),
    down: normalizePointList(stored.down, cutoff),
    up: normalizePointList(stored.up, cutoff),
    temperatures
  };
}

function persistChartHistory(force = false) {
  const now = Date.now();
  if (!force && now - lastChartHistorySave < 5000) return;
  lastChartHistorySave = now;
  try {
    const raw = toRaw(histories);
    uni.setStorageSync(CHART_HISTORY_KEY, {
      rsrp: normalizePointList(raw.rsrp, now - METRIC_HISTORY_WINDOW_MS),
      sinr: normalizePointList(raw.sinr, now - METRIC_HISTORY_WINDOW_MS),
      rsrq: normalizePointList(raw.rsrq, now - METRIC_HISTORY_WINDOW_MS),
      down: normalizePointList(raw.down, now - METRIC_HISTORY_WINDOW_MS),
      up: normalizePointList(raw.up, now - METRIC_HISTORY_WINDOW_MS),
      temperatures: Object.fromEntries(Object.entries(raw.temperatures || {})
        .map(([key, values]) => [key, normalizePointList(normalizeTemperaturePoints(key, values), now - METRIC_HISTORY_WINDOW_MS)])
        .filter(([, values]) => values.length))
    });
  } catch {}
}

// —— 局域网互通：图表历史的快照 / 合并写回 —— //

// 把 histories 反应式对象拍平成普通结构，交给 syncClient 发布或作为合并输入。
function chartSnapshot() {
  const raw = toRaw(histories);
  return {
    rsrp: raw.rsrp.slice(),
    sinr: raw.sinr.slice(),
    rsrq: raw.rsrq.slice(),
    down: raw.down.slice(),
    up: raw.up.slice(),
    temperatures: Object.fromEntries(Object.entries(raw.temperatures || {}).map(([key, values]) => [key, normalizeTemperaturePoints(key, values)]))
  };
}

// syncClient 合并外部图表历史时的回调：updater(当前快照)->合并结果，写回反应式并持久化。
function applyChartUpdater(updater) {
  if (typeof updater !== 'function') return;
  const merged = updater(chartSnapshot());
  if (!merged || typeof merged !== 'object') return;
  ['rsrp', 'sinr', 'rsrq', 'down', 'up'].forEach(key => {
    if (Array.isArray(merged[key])) histories[key] = merged[key];
  });
  if (merged.temperatures && typeof merged.temperatures === 'object') histories.temperatures = Object.fromEntries(Object.entries(merged.temperatures).map(([key, values]) => [key, normalizeTemperaturePoints(key, values)]).filter(([, values]) => values.length));
  persistChartHistory(true);
}

// 从 syncClient 拉取最新角色/对端状态刷新到设置页展示。
function refreshSyncState() {
  Object.assign(syncState, syncClient.getState());
}

function peerPlatformText(platform) {
  return { desktop: '电脑端', android: '安卓端', h5: '浏览器' }[platform] || '其他';
}

// 设置页开关：启用/关闭局域网互通。
function toggleSync(event) {
  const enabled = event?.detail?.value ?? !syncState.enabled;
  syncClient.setEnabled(enabled);
  refreshSyncState();
}

// 设置页：钉住某台设备为首选采集器（再次点击当前项则取消钉住恢复自动）。
function pinCollector(id) {
  const next = syncState.preferredCollector === id ? '' : id;
  syncClient.setPreferredCollector(next);
  refreshSyncState();
}

function pushHistory(list, timestamp, value, source) {
  if (value == null) return;
  const bucketTime = Math.floor(timestamp / CHART_HISTORY_SAMPLE_MS) * CHART_HISTORY_SAMPLE_MS;
  const last = list.at(-1);
  if (last?.[0] === bucketTime) { last[1] = value; last[2] = source; }
  else list.push([bucketTime, value, source]);
  pruneHistory(list, timestamp);
}

function pruneHistory(list, timestamp) {
  const cutoff = timestamp - METRIC_HISTORY_WINDOW_MS;
  while (list.length && list[0][0] < cutoff) list.shift();
  if (list.length > CHART_HISTORY_MAX_POINTS) list.splice(0, list.length - CHART_HISTORY_MAX_POINTS);
}

function captureHistory(payload) {
  // Do not turn a disconnected/stale snapshot into fresh history points.
  if (!payload || payload.stale === true) return;
  const timestamp = Number(payload.timestamp) || Date.now();
  const nextSignal = payload.signal || {};
  const nextStatus = payload.status || {};
  const nextTemperature = payload.temperature || {};
  const source = payload.source || 'unknown';
  pushHistory(histories.rsrp, timestamp, numeric(firstValue(nextSignal.Z5g_rsrp, nextSignal.lte_rsrp, nextSignal.rssi)), source);
  pushHistory(histories.sinr, timestamp, numeric(firstValue(nextSignal.Z5g_SINR, nextSignal.Z5g_snr, nextSignal.lte_snr)), source);
  pushHistory(histories.rsrq, timestamp, numeric(firstValue(nextSignal.Z5g_rsrq, nextSignal.lte_rsrq)), source);
  pushHistory(histories.down, timestamp, numeric(nextStatus.realtime_rx_thrpt), source);
  pushHistory(histories.up, timestamp, numeric(nextStatus.realtime_tx_thrpt), source);
  Object.entries(nextTemperature).forEach(([key, value]) => {
    if (!isTemperatureField(key)) return;
    const number = temperatureReading(key, value).value;
    if (number == null) return;
    if (!Array.isArray(histories.temperatures[key])) histories.temperatures[key] = [];
    pushHistory(histories.temperatures[key], timestamp, number, source);
  });
  Object.values(histories.temperatures).forEach(values => pruneHistory(values, timestamp));
  persistChartHistory();
}

function applyInitialBands() {
  const locks = data.value.locks || {};
  const saRaw = locks.nr5g_sa_band_lock !== undefined && locks.nr5g_sa_band_lock !== null ? locks.nr5g_sa_band_lock : locks.nr5g_band_lock;
  if (!bandSelectionsInitialized.sa && saRaw !== undefined && saRaw !== null && saRaw !== '') {
    // 保留全部回显频段：锁定的频段可能不在 chip 列表里（如 229），
    // 丢弃会让界面上看不出"已锁定"状态（固件 Web UI 却能看到）。
    selectedSaBands.value = parseBandText(saRaw);
    bandSelectionsInitialized.sa = true;
  }
  const nsaRaw = locks.nr5g_nsa_band_lock;
  if (!bandSelectionsInitialized.nsa && nsaRaw !== undefined && nsaRaw !== null && nsaRaw !== '') {
    selectedNsaBands.value = parseBandText(nsaRaw);
    bandSelectionsInitialized.nsa = true;
  }
  const lteRaw = locks.lte_band_lock;
  if (!bandSelectionsInitialized.lte && lteRaw !== undefined && lteRaw !== null && lteRaw !== '') {
    const maskBands = lteBands.filter(band => isBandInMask(lteRaw, band));
    // mask 位图无法表达列表外频段，LTE 特殊频段从 lte_freq_lock 文本兜底解析。
    const extraBands = parseBandText(locks.lte_freq_lock).filter(band => !maskBands.includes(band));
    selectedLteBands.value = [...maskBands, ...extraBands];
    bandSelectionsInitialized.lte = true;
  }
}

function parseBandText(value) {
  return String(value || '').split(',')
    .map(item => String(item).replace(/\D/g, ''))
    .filter(Boolean)
    .map(Number)
    .filter(value => Number.isInteger(value) && value > 0);
}

function isBandInMask(raw, band) {
  const map = { 1: 0x1n, 3: 0x4n, 5: 0x10n, 7: 0x40n, 8: 0x80n, 20: 0x80000n, 28: 0x8000000n, 34: 0x200000000n, 38: 0x2000000000n, 39: 0x4000000000n, 40: 0x8000000000n, 41: 0x10000000000n };
  try { return (BigInt(raw) & map[band]) !== 0n; } catch { return false; }
}

function syncCandidate() {
  const candidate = selectedCandidate.value;
  if (!candidate) {
    lastSyncedCandidateKey = '';
    return;
  }
  if (!selectedCellKey.value || !candidates.value.some(item => item.key === selectedCellKey.value)) selectedCellKey.value = candidates.value[0].key;
  const current = candidates.value.find(item => item.key === selectedCellKey.value) || candidates.value[0];
  if (current.key === lastSyncedCandidateKey) return;
  lockForm.pci = current.pci;
  lockForm.arfcn = current.arfcn;
  lockForm.band = current.band;
  lockForm.scs = current.scs || 30;
  lastSyncedCandidateKey = current.key;
}

async function refresh(manual = false) {
  if (actionBusy.value) {
    pendingRefresh = true;
    if (manual) pendingManualRefresh = true;
    return;
  }
  if (refreshing.value) {
    pendingRefresh = true;
    if (manual) {
      pendingManualRefresh = true;
      manualRefreshing.value = true;
    }
    return;
  }
  refreshing.value = true;
  manual = manual || pendingManualRefresh;
  pendingManualRefresh = false;
  manualRefreshing.value = manual;
  try {
    // 数据来源被 syncClient 透明代理：查看端读采集器 /sync/live，其余（采集器/直连）走真正的路由器轮询。
    const payload = await syncClient.dashboard();
    const merged = mergeDashboard(data.value, payload);
    applyDashboardData(data.value, merged);
    updateCellDisplay(merged, manual);
    syncTrafficPlanForm();
    captureHistory(merged);
    applyInitialBands();
    syncCandidate();
    errorMessage.value = merged.stale ? `当前显示缓存数据：${merged.serverMessage || '路由器暂时离线'}` : '';
    freshnessNow.value = Date.now();
    // 本地历史更新完毕后按角色发布/回补/拉取；图表合并经 applyChartUpdater 写回本地并持久化。
    try {
      await syncClient.afterTick({
        live: merged,
        localStore: () => ({ chart: chartSnapshot(), battery: toRaw(data.value.battery?.samples) || [] }),
        onMergeChart: applyChartUpdater
      });
    } catch {}
    refreshSyncState();
  } catch (error) {
    data.value.stale = true;
    data.value.telemetryStale = true;
    errorMessage.value = error.message;
    if (manual) uni.showToast({ title: error.message, icon: 'none', duration: 2600 });
  } finally {
    refreshing.value = false;
    manualRefreshing.value = false;
    if (pendingRefresh && !actionBusy.value) {
      const nextManual = pendingManualRefresh;
      pendingManualRefresh = false;
      pendingRefresh = false;
      setTimeout(() => refresh(nextManual), 0);
    }
  }
}

function sameDashboardValue(current, next) {
  current = toRaw(current);
  next = toRaw(next);
  if (Object.is(current, next)) return true;
  if (!current || !next || typeof current !== 'object' || typeof next !== 'object') return false;
  try { return JSON.stringify(current) === JSON.stringify(next); } catch { return false; }
}

function applyDashboardData(target, incoming) {
  // Keep the root object and unchanged module references stable. Replacing the
  // whole dashboard every second makes uni-app repaint unrelated cards.
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (!sameDashboardValue(target[key], value)) target[key] = value;
  });
}

function updateCellDisplay(snapshot, force = false) {
  if (!snapshot || snapshot.stale === true) return;
  const now = Date.now();
  const nextSignal = snapshot.signal || {};
  const nextNeighbors = snapshot.neighbors || {};
  const signature = `${JSON.stringify(nextSignal)}|${JSON.stringify(nextNeighbors)}`;
  const current = cellDisplay.value.signal || {};
  const servingChanged = [
    'network_type', 'nr5g_action_band', 'nr5g_action_channel', 'nr5g_pci',
    'lte_ca_pcell_band', 'lte_ca_pcell_arfcn', 'lte_pci', 'wan_active_band', 'wan_active_channel'
  ].some(key => String(current[key] ?? '') !== String(nextSignal[key] ?? ''));
  if (signature === lastCellDisplaySignature) return;
  if (!force && !servingChanged && now - lastCellDisplayUpdate < CELL_DISPLAY_REFRESH_MS) return;
  cellDisplay.value = { signal: { ...nextSignal }, neighbors: { ...nextNeighbors } };
  lastCellDisplayUpdate = now;
  lastCellDisplaySignature = signature;
}

function mergeDashboard(previous, incoming) {
  const stale = incoming?.stale === true;
  // A successful router response is authoritative, including empty fields.
  // Keeping non-empty values from the previous poll makes cleared fields (for
  // example bandwidth or CA state) look permanently active. Only an explicit
  // stale snapshot is allowed to reuse the last live response.
  const record = (key, fallback = {}) => {
    if (stale) return previous?.[key] || fallback;
    const value = incoming?.[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  };
  const list = (key) => {
    if (stale) return Array.isArray(previous?.[key]) ? previous[key] : [];
    return Array.isArray(incoming?.[key]) ? incoming[key] : [];
  };
  return {
    ...previous,
    ...incoming,
    stale,
    clientAvailability: record('clientAvailability'),
    errors: record('errors'),
    source: (stale ? previous?.source : incoming?.source) || 'unknown',
    timestamp: stale ? previous?.timestamp : incoming?.timestamp,
    // Only a complete dashboard capture advances radio / non-battery temperature
    // freshness. Native battery recovery can update the general timestamp alone.
    telemetryTimestamp: stale ? previous?.telemetryTimestamp : incoming?.timestamp,
    telemetrySource: (stale ? previous?.telemetrySource : incoming?.source) || 'unknown',
    telemetryStale: stale,
    login: record('login'),
    status: record('status'),
    signal: record('signal'),
    temperature: record('temperature'),
    resources: record('resources'),
    locks: record('locks'),
    neighbors: record('neighbors'),
    features: record('features'),
    battery: record('battery'),
    stations: list('stations'),
    cableStations: list('cableStations')
  };
}

function resolveNavigation(id, section = '') {
  const route = { tab: 'overview', device: 'clients', metric: 'throughput', detail: '' };
  const devices = ['clients', 'radio', 'sms', 'stock', 'detail'];
  if (id === 'settings' || (id === 'manage' && section === 'settings')) route.tab = 'settings';
  else if (devices.includes(id)) { route.tab = 'devices'; route.device = id; }
  else if (id === 'devices' || id === 'manage') { route.tab = 'devices'; if (devices.includes(section)) route.device = section; }
  else if (id === 'usage') { route.tab = 'trends'; route.detail = 'usage'; }
  else if (['battery', 'temperature', 'signal'].includes(id)) { route.tab = 'trends'; route.metric = id; }
  else if (id === 'trends') { route.tab = 'trends'; if (['throughput', 'temperature', 'battery', 'signal'].includes(section)) route.metric = section; }
  return route;
}

function switchTab(id, section = '') {
  const route = resolveNavigation(id, section);
  activeTab.value = route.tab;
  managementTab.value = route.device;
  trendMetric.value = route.metric;
  trendDetail.value = route.detail;
  settingsSection.value = '';
  diagnosticsOpen.value = false;
  menuOpen.value = false;
  if (route.tab === 'devices' && route.device === 'sms') loadSms();
  if (route.tab === 'devices' && route.device === 'stock') openStockConsole();
}

function selectTrend(id) {
  trendMetric.value = id;
  trendDetail.value = '';
}

function openDiagnostics() {
  switchTab('settings');
  openSettingsSection('diagnostics');
}

function openSettingsSection(id) {
  if (!['connection', 'battery', 'sync', 'overlay', 'background', 'update', 'diagnostics'].includes(id)) return;
  if (id === 'battery') resetBatterySettings();
  settingsSection.value = id;
  diagnosticsOpen.value = id === 'diagnostics';
}

function handleNavigationBack() {
  if (menuOpen.value) { menuOpen.value = false; return true; }
  if (activeTab.value === 'devices') {
    if (managementTab.value === 'sms' && smsComposeOpen.value) { smsComposeOpen.value = false; return true; }
    if (managementTab.value !== 'clients') { switchTab('devices'); return true; }
  }
  if (activeTab.value === 'trends') {
    if (trendDetail.value) { trendDetail.value = ''; return true; }
    if (trendMetric.value !== 'throughput') { trendMetric.value = 'throughput'; return true; }
  }
  if (activeTab.value === 'settings' && settingsSection.value) { settingsSection.value = ''; diagnosticsOpen.value = false; return true; }
  if (activeTab.value !== 'overview') { switchTab('overview'); return true; }
  return false;
}

function switchManagementTab(id) {
  if (!managementTabs.some(tab => tab.id === id)) return;
  switchTab(id);
}

async function openStockConsole(force = false) {
  if (stockConsole.busy) return;
  if (!force && stockConsole.url) return;
  stockConsole.busy = true;
  stockConsole.message = '正在用保存的密码自动登录…';
  try {
    let landed = false;
    let loginFailedMessage = '';
    // 原厂后台只在加载瞬间判断一次登录态：若恰好撞上会话被其他设备抢占的
    // 窗口，它会停在原厂登录页且不会自行恢复，因此检测后重登重载，最多 3 次。
    for (let attempt = 0; attempt < 3 && !landed; attempt++) {
      const main = await routerApi.login(true);
      stockConsole.loggedIn = Boolean(main.loggedIn);
      if (!main.loggedIn) {
        loginFailedMessage = `自动登录失败：${main.message}`;
        stockConsole.message = `${loginFailedMessage}。可进入原厂后台中手动登录。`;
        stockConsole.url = `${routerApi.stockUiUrl()}?_t=${Date.now()}`;
        break;
      }
      let developerState = '开发者权限未建立';
      try {
        const developer = await routerApi.developerLogin();
        if (developer?.ok) developerState = '开发者权限已就绪';
      } catch (error) {
        developerState = `开发者权限：${error.message}`;
      }
      stockConsole.url = `${routerApi.stockUiUrl()}?_t=${Date.now()}`;
      stockConsole.message = `管理员会话已就绪 · ${developerState}`;
      // 跨源 iframe（安卓本地反代）读不到 hash，全屏直连模式没有 iframe：
      // 两种情况都不存在"停在登录页"的检测，直接视为就绪（否则空转 3×3 秒，
      // 按钮长时间禁用，看起来像打不开）。
      landed = stockUiSameOrigin ? await waitForStockConsoleHome() : true;
      if (!landed) stockConsole.message = '原厂后台加载时撞上会话被抢占，正在重试…';
    }
    if (stockConsole.loggedIn && !landed) {
      stockConsole.message += ' · 仍停在原厂登录页：路由器登录正被其他设备抢占，稍后可点"重新自动登录"重试';
    }
  } finally {
    stockConsole.busy = false;
    // 看守接管后续会话抢占的自愈（也覆盖 3 次重试后仍停在登录页的情况）；
    // 仅内嵌模式有意义——全屏直连模式下原厂页面是另一个文档，读不到 hash。
    if (stockConsole.url && stockOpenMode === 'embed' && activeTab.value === 'devices' && managementTab.value === 'stock') {
      startStockConsoleWatcher();
    }
  }
}

// 轮询 iframe 的 hash：原厂后台离开 #login 即视为已进入主界面（同源 iframe 可读）。
function waitForStockConsoleHome(timeoutChecks = 12, intervalMs = 250) {
  return new Promise(resolve => {
    let checks = 0;
    const timer = setInterval(() => {
      checks += 1;
      const frame = document.querySelector('.stock-frame');
      const hash = frame && frame.contentWindow ? frame.contentWindow.location.hash : '';
      if (hash && hash !== '#login') {
        clearInterval(timer);
        resolve(true);
      } else if (checks >= timeoutChecks) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs);
  });
}

// —— 原厂后台自愈看守 ——
// 会话被其他设备抢占后：主会话丢失 → 原厂界面退回 #login 且不会自恢复；
// 开发者标志丢失 → 进"开发者选项"被原厂 router.js 跳到 #developer_login 要求二次输密码。
// 看守检测到这两种状态时用已保存的密码自动恢复会话，并把界面跳回原处。
let stockConsoleWatcherTimer = null;
let stockConsoleFixBusy = false;

function stockConsoleHash() {
  try {
    const frame = document.querySelector('.stock-frame');
    return frame && frame.contentWindow ? frame.contentWindow.location.hash : '';
  } catch {
    // 跨域 iframe（安卓/桌面壳直连模式）读 hash 会抛异常，看守自然退化为不动作。
    return '';
  }
}

function stockConsoleNavigate(hash) {
  try {
    const frame = document.querySelector('.stock-frame');
    if (frame && frame.contentWindow) frame.contentWindow.location.hash = hash;
  } catch {}
}

async function checkStockConsoleState() {
  if (stockConsoleFixBusy || stockConsole.busy || !stockConsole.url) return;
  // 跨源 iframe（安卓本地反代）：读不到原厂页面状态，改为轮询会话；会话被
  // 抢占丢失时重登（主 + 开发者）并重载 iframe，让原厂界面回到已登录视图。
  if (!stockUiSameOrigin) {
    stockConsoleFixBusy = true;
    try {
      const session = await routerApi.stockUiSession().catch(() => ({ loggedIn: false, developer: false }));
      if (session.loggedIn && session.developer) return;
      const main = await routerApi.login(true);
      if (!main.loggedIn) return;
      try { await routerApi.developerLogin(); } catch {}
      stockConsole.message = '会话曾被其他设备抢占，已自动恢复';
      stockConsole.url = `${routerApi.stockUiUrl()}?_t=${Date.now()}`;
    } catch {} finally {
      stockConsoleFixBusy = false;
    }
    return;
  }
  const hash = stockConsoleHash();
  if (hash === '#login') {
    stockConsoleFixBusy = true;
    try {
      const session = await routerApi.stockUiSession().catch(() => ({ loggedIn: false }));
      if (!session.loggedIn) await routerApi.login(true);
      const after = await routerApi.stockUiSession().catch(() => ({ loggedIn: false }));
      if (after.loggedIn) {
        stockConsoleNavigate('#home');
        stockConsole.message = '会话曾被其他设备抢占，已自动恢复';
      }
    } catch {} finally {
      stockConsoleFixBusy = false;
    }
    return;
  }
  if (hash === '#developer_login') {
    stockConsoleFixBusy = true;
    try {
      await routerApi.developerLogin();
      stockConsoleNavigate('#developer_options');
      stockConsole.message = '开发者会话已自动恢复，无需输入密码';
    } catch (error) {
      stockConsole.message = `开发者会话自动恢复失败：${error.message}。可在原厂页面手动输入。`;
    } finally {
      stockConsoleFixBusy = false;
    }
  }
}

function startStockConsoleWatcher() {
  if (stockConsoleWatcherTimer) return;
  // 同源模式查 DOM hash（800ms）；跨源模式发网络请求轮询会话（2s，避免叠加请求量）。
  stockConsoleWatcherTimer = setInterval(checkStockConsoleState, stockUiSameOrigin ? 800 : 2000);
}

function stopStockConsoleWatcher() {
  if (stockConsoleWatcherTimer) {
    clearInterval(stockConsoleWatcherTimer);
    stockConsoleWatcherTimer = null;
  }
}

watch([activeTab, managementTab], () => {
  if (activeTab.value === 'devices' && managementTab.value === 'stock' && stockConsole.url && stockOpenMode === 'embed') {
    startStockConsoleWatcher();
  } else {
    stopStockConsoleWatcher();
  }
});

onBeforeUnmount(stopStockConsoleWatcher);

function openStockConsoleExternal() {
  const config = routerApi.getConfig();
  window.open(`${config.routerUrl.replace(/\/$/, '')}/index.html`, '_blank');
}

// 安卓"全屏打开"（内嵌视图的备选入口，或反代未启动时的主入口）：先确认会话
// 仍有效（可能又被其他设备抢占），再经原生 loadUrl 全屏直连路由器——与内嵌
// iframe 同一出口 IP，天然共享会话；按系统返回键回到本应用。
async function openStockConsoleNative() {
  if (stockOpenMode === 'external') { openStockConsoleExternal(); return; }
  if (stockConsole.busy) return;
  stockConsole.busy = true;
  stockConsole.message = '正在确认自动登录状态…';
  try {
    const session = await routerApi.stockUiSession().catch(() => ({ loggedIn: false, developer: false }));
    let ready = session.loggedIn && session.developer;
    if (!ready) {
      const main = await routerApi.login(true);
      if (main.loggedIn) {
        try { await routerApi.developerLogin(); } catch {}
        ready = true;
      }
      stockConsole.loggedIn = Boolean(main.loggedIn);
    } else {
      stockConsole.loggedIn = true;
    }
    stockConsole.message = ready
      ? '管理员会话已就绪 · 开发者权限已就绪，正在打开…'
      : '自动登录失败：可在原厂后台中手动输入密码';
  } finally {
    stockConsole.busy = false;
  }
  const config = routerApi.getConfig();
  const directUrl = `${config.routerUrl.replace(/\/$/, '')}/index.html`;
  const bridge = typeof window !== 'undefined' ? window.AndroidRouter : null;
  if (bridge && typeof bridge.openStockUi === 'function') bridge.openStockUi(directUrl);
  else window.location.href = directUrl;
}

function managementTabSummary(id) {
  if (id === 'sms') return messages.value.length ? `${messages.value.length} 条 · 验证码 ${smsCodeCount.value}` : '收发与验证码';
  if (id === 'clients') return `${stations.value.length + cableStations.value.length} 台在线`;
  if (id === 'stock') return stockConsole.loggedIn ? '已自动登录' : '内嵌原厂 Web 界面';
  return connected.value ? '连接正常' : '连接与设备控制';
}

function beginFeatureEdit() {
  featureFormEditing.value = true;
}

function endFeatureEdit() {
  featureFormEditing.value = false;
}

async function saveTrafficPlan() {
  actionBusy.value = true;
  try {
    await routerApi.setTrafficPlan(trafficPlanForm);
    featureResult.value = '流量设置已保存';
    await refresh(true);
  } catch (error) { featureResult.value = error.message; }
  finally { actionBusy.value = false; }
}

async function calibrateTraffic() {
  actionBusy.value = true;
  try {
    await routerApi.calibrateTraffic({ gigabytes: Number(trafficPlanForm.usedGb) });
    featureResult.value = '已用流量已校准';
    trafficPlanForm.usedGb = '';
    await refresh(true);
  } catch (error) { featureResult.value = error.message; }
  finally { actionBusy.value = false; }
}

function syncTrafficPlanForm() {
  const item = features.value;
  if (!Object.keys(item).length || featureFormEditing.value || featureFormsInitialized.value) return;
  trafficPlanForm.enabled = item.data_volume_limit_switch === '1';
  trafficPlanForm.sizeGb = trafficPlanGb(item.data_volume_limit_size) ?? '';
  trafficPlanForm.alertPercent = item.data_volume_alert_percent || '';
  trafficPlanForm.autoClear = item.wan_auto_clear_flow_data_switch === 'on';
  trafficPlanForm.clearDate = item.traffic_clear_date || '';
  featureFormsInitialized.value = true;
}

function selectCandidate(candidate) {
  selectedCellKey.value = candidate.key;
  lockForm.pci = candidate.pci;
  lockForm.arfcn = candidate.arfcn;
  lockForm.band = candidate.band;
  lockForm.scs = candidate.scs || 30;
  lastSyncedCandidateKey = candidate.key;
}

async function scanNeighbors() {
  actionBusy.value = true;
  radioActionResult.value = '正在扫描邻区…';
  try {
    await routerApi.scanNeighbors();
    radioActionResult.value = '扫描命令已发送，正在等待结果';
    setTimeout(() => refresh(true), 2500);
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

async function lockSelectedCell() {
  const selected = selectedCandidate.value;
  if (!selected) return;
  actionBusy.value = true;
  radioActionResult.value = '正在锁定小区…';
  try {
    await routerApi.linkedCellLock({ ...selected, ...lockForm });
    radioActionResult.value = '小区锁定成功，当前频段保持不变';
    await refresh();
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

// 解除小区锁定：独立操作，不依赖当前候选列表（锁频后可能搜不到任何小区）。
// NR 发固件解锁标志 "1,1,1,1"、LTE 清空锁定字段，两制式一起发。
async function unlockAllCells() {
  actionBusy.value = true;
  radioActionResult.value = '正在解除小区锁定…';
  try {
    await routerApi.unlockAllCellLocks();
    radioActionResult.value = '已解除小区锁定（5G 与 LTE）';
    await refresh();
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

function toggleBand(group, band) {
  const target = group === 'lte' ? selectedLteBands : group === 'sa' ? selectedSaBands : selectedNsaBands;
  bandSelectionsInitialized[group] = true;
  if (target.value.includes(band)) {
    target.value = target.value.filter(item => item !== band);
  } else {
    target.value = [...target.value, band].sort((a, b) => a - b);
  }
  radioActionResult.value = '';
}

// 一键解除频段限制：清空该组选择并保存（固件空 mask/0 = 不限制频段），
// 不需要手动逐个取消 chip。
async function clearBands(group) {
  if (group === 'lte') selectedLteBands.value = [];
  else if (group === 'sa') selectedSaBands.value = [];
  else selectedNsaBands.value = [];
  bandSelectionsInitialized[group] = true;
  await saveBands(group);
}

async function saveBands(group) {
  const selected = group === 'lte' ? selectedLteBands.value : group === 'sa' ? selectedSaBands.value : selectedNsaBands.value;
  while (refreshing.value) await new Promise(resolve => setTimeout(resolve, 80));
  actionBusy.value = true;
  radioActionResult.value = selected.length ? '正在保存频段…' : '正在解除该组频段限制…';
  try {
    if (group === 'lte') await routerApi.setLteBands(selectedLteBands.value);
    else await routerApi.setNrBands(group, group === 'sa' ? selectedSaBands.value : selectedNsaBands.value);
    radioActionResult.value = selected.length ? `${group.toUpperCase()} 频段保存成功` : `${group.toUpperCase()} 已解除频段限制`;
    await refresh();
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
    if (pendingRefresh) {
      const nextManual = pendingManualRefresh;
      pendingManualRefresh = false;
      pendingRefresh = false;
      setTimeout(() => refresh(nextManual), 0);
    }
  }
}

async function loadSms() {
  if (smsRefreshing.value) return;
  smsRefreshing.value = true;
  try {
    applySmsSnapshot(await routerApi.listSms());
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    smsRefreshing.value = false;
  }
}

// 短信列表既来自实时轮询，也可能来自后台落盘的快照（路由器离线时兜底显示）。
function applySmsSnapshot(result) {
  messages.value = (result.messages || []).map(message => ({
    ...message,
    verificationCode: extractVerificationCode(message.content)
  }));
  const currentIds = new Set(messages.value.map(smsMessageId).filter(Boolean));
  selectedSmsIds.value = selectedSmsIds.value.filter(id => currentIds.has(id));
  const capacity = result.capacity || {};
  const used = (numeric(capacity.sms_nv_rev_total) || 0) + (numeric(capacity.sms_nv_send_total) || 0) + (numeric(capacity.sms_nv_draftbox_total) || 0);
  smsCapacity.value = capacity.sms_nv_total ? `${used}/${capacity.sms_nv_total}` : `状态 ${result.ready?.sms_cmd_status_result || '—'}`;
}

function smsMessageId(message) {
  const id = message?.id;
  return id === undefined || id === null || id === '' ? '' : String(id);
}

function isSmsSelected(message) {
  const id = smsMessageId(message);
  return Boolean(id && selectedSmsIds.value.includes(id));
}

function toggleSmsSelection(message) {
  const id = smsMessageId(message);
  if (!id) return;
  selectedSmsIds.value = selectedSmsIds.value.includes(id)
    ? selectedSmsIds.value.filter(item => item !== id)
    : [...selectedSmsIds.value, id];
}

function toggleAllSms() {
  selectedSmsIds.value = allSmsSelected.value ? [] : [...selectableSmsIds.value];
}

async function deleteSelectedSms() {
  const ids = [...selectedSmsIds.value];
  if (!ids.length) return;
  const confirmed = await confirmAction('批量删除短信', `确定删除选中的 ${ids.length} 条短信吗？删除后无法恢复。`, '删除');
  if (!confirmed) return;
  actionBusy.value = true;
  try {
    await routerApi.deleteSms(ids);
    selectedSmsIds.value = [];
    await loadSms();
    uni.showToast({ title: `已删除 ${ids.length} 条短信`, icon: 'success' });
  } catch (error) {
    uni.showToast({ title: error.message, icon: 'none', duration: 3000 });
  } finally {
    actionBusy.value = false;
  }
}

function copyVerificationCode(code) {
  if (!code) return;
  uni.setClipboardData({
    data: String(code),
    success: () => uni.showToast({ title: `已复制验证码 ${code}`, icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败，请长按验证码复制', icon: 'none', duration: 2600 })
  });
}

async function sendSms() {
  actionBusy.value = true;
  try {
    const result = await routerApi.sendSms(smsNumber.value, smsMessage.value);
    uni.showToast({ title: result.result === 'success' ? '发送成功' : `发送状态：${result.result}`, icon: result.result === 'success' ? 'success' : 'none' });
    if (result.result === 'success') {
      smsMessage.value = '';
      await loadSms();
    }
  } catch (error) {
    uni.showToast({ title: error.message, icon: 'none', duration: 2600 });
  } finally {
    actionBusy.value = false;
  }
}

function formatSmsDate(raw) {
  if (!raw) return '—';
  const parts = String(raw).split(',');
  return parts.length < 6 ? raw : `20${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`;
}

async function saveSettings() {
  Object.assign(config, routerApi.updateConfig({ routerUrl: settingsForm.routerUrl, password: settingsForm.password, pollIntervalMs: 1000 }));
  Object.assign(settingsForm, config);
  settingsResult.value = '正在保存并重新登录…';
  try {
    const result = await routerApi.login(true);
    settingsResult.value = result.loggedIn ? `${result.message}，密码已生效` : result.message;
    await refresh(true);
  } catch (error) {
    settingsResult.value = error.message;
  }
}

function resetBatterySettings() {
  Object.assign(batterySettingsForm, { batterySource: config.batterySource, batteryHost: config.batteryHost, batteryPort: String(config.batteryPort) });
  batterySettingsResult.value = '';
  batterySettingsError.value = false;
}

async function saveBatterySettings() {
  if (batterySettingsSaving.value) return;
  batterySettingsSaving.value = true;
  batterySettingsError.value = false;
  try {
    const custom = config.batterySource === 'gauge';
    Object.assign(config, routerApi.updateConfig({
      batterySource: config.batterySource,
      batteryHost: custom ? batterySettingsForm.batteryHost : config.batteryHost,
      batteryPort: custom ? 88 : config.batteryPort
    }));
    resetBatterySettings();
    batterySettingsResult.value = '已保存';
    await refresh();
  } catch (error) {
    batterySettingsError.value = true;
    batterySettingsResult.value = error.message;
  } finally {
    batterySettingsSaving.value = false;
  }
}

function syncOverlayState() {
  Object.assign(overlayState, routerApi.getOverlayState());
}

function syncBackgroundState() {
  const next = routerApi.getBackgroundMonitorState();
  if (Boolean(next.background) !== Boolean(backgroundState.background) && syncState.role !== 'viewer') routerApi.resetBatteryCollection();
  Object.assign(backgroundState, next, routerApi.getBatteryOptimizationState());
}

function requestBatteryOptimization() {
  settingsResult.value = '请在系统弹窗中允许 U50 Pro 控制台忽略电池优化';
  routerApi.requestIgnoreBatteryOptimizations();
}

// 回到页面时把原生服务在息屏期间落盘的历史合并进图表与电池曲线。
// 分钟桶并集幂等，重复回补安全；短信快照仅在短信列表为空时兜底显示。
let backfillingBackground = false;
async function backfillBackgroundHistory() {
  if (backfillingBackground || !backgroundState.available) return;
  backfillingBackground = true;
  try {
    // Detect the ownership boundary before importing its completed current blocks.
    syncBackgroundState();
    const history = await routerApi.getBackgroundHistory();
    if (!history || typeof history !== 'object') return;
    if (history.chart) applyChartUpdater(current => mergeChartHistory(current, history.chart, { cutoff: Date.now() - METRIC_HISTORY_WINDOW_MS, sampleMs: CHART_HISTORY_SAMPLE_MS, maxPoints: CHART_HISTORY_MAX_POINTS }));
    const merged = Array.isArray(history.battery) && history.battery.length
      ? routerApi.mergeExternalBattery(history.battery) : null;
    if (syncState.role === 'viewer') {
      if (merged && data.value.battery) data.value.battery = { ...data.value.battery, samples: merged };
    } else {
      const native = history.live;
      const currentAt = typeof data.value.timestamp === 'number' && Number.isFinite(data.value.timestamp) ? data.value.timestamp : 0;
      const nativeAt = typeof native?.timestamp === 'number' && Number.isFinite(native.timestamp) ? native.timestamp : 0;
      const snapshot = nativeAt > currentAt ? native : data.value;
      const stats = Array.isArray(native?.battery?.currentStats) ? native.battery.currentStats : [];
      const restored = routerApi.restoreBatterySummary(snapshot, stats);
      data.value.battery = restored;
      if (snapshot === native && restored.measurement) {
        // Restore only battery-source fields after the collector validates the
        // newer capture; unrelated foreground modules keep their own values.
        const sourceStatus = { ...data.value.status };
        for (const key of ['battery_gauge', 'battery_vol_percent', 'battery_value', 'battery_charging', 'external_charging_flag', 'battery_charg_type', 'battery_health', 'percentEndpoint']) {
          if (Object.hasOwn(snapshot.status || {}, key)) sourceStatus[key] = snapshot.status[key];
          else delete sourceStatus[key];
        }
        data.value.status = sourceStatus;
        data.value.timestamp = snapshot.timestamp;
        data.value.stale = false;
        data.value.source = snapshot.source || 'unknown';
        if (restored.measurement.percentageSource === 'router') {
          data.value.temperature = { ...data.value.temperature, battery_temp: snapshot.temperature?.battery_temp };
        }
      }
    }
    if (history.sms?.messages?.length && !messages.value.length) applySmsSnapshot(history.sms);
    const count = Number(history.snapshotCount) || 0;
    Object.keys(collectionSourceLabels).forEach(source => { backgroundSourceCounts[source] = Number(history.sourceCounts?.[source]) || 0; });
    backgroundBackfill.value = count ? `已回补 ${count} 条分钟记录（含前台与后台）` : '';
  } catch (error) {
    backgroundBackfill.value = `后台历史回补失败：${error.message}`;
  } finally {
    backfillingBackground = false;
    syncBackgroundState();
  }
}

function toggleOverlay(event) {
  const enabled = Boolean(event?.detail?.value);
  Object.assign(overlayState, routerApi.setOverlayEnabled(enabled));
  if (enabled && !overlayState.permitted) {
    settingsResult.value = '请允许 U50 Pro 控制台显示在其他应用上层';
    routerApi.requestOverlayPermission();
  } else {
    settingsResult.value = enabled ? '悬浮窗已开启' : '悬浮窗已关闭';
  }
}

function handlePageShow() {
  if (syncState.role !== 'viewer') routerApi.resetBatteryCollection();
  setTimeout(syncOverlayState, 250);
  // 从后台/息屏回到页面：先回补原生落盘的历史，再由轮询接续。
  setTimeout(backfillBackgroundHistory, 300);
}

function handlePageHide() {
  if (syncState.role !== 'viewer') routerApi.resetBatteryCollection();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') handlePageHide();
  else handlePageShow();
}

function confirmAction(title, content, confirmText = '继续') {
  return new Promise(resolve => {
    uni.showModal({ title, content, confirmText, cancelText: '取消', success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false) });
  });
}

async function runDeviceAction(action) {
  const labels = { 'wifi-on': '开启 Wi-Fi', 'wifi-off': '关闭 Wi-Fi', reboot: '重启设备', shutdown: '关闭设备' };
  const prompts = {
    'wifi-off': '关闭后当前 Wi-Fi 连接会断开，需要通过设备按键或重新连接恢复。',
    reboot: '设备会暂时离线，通常需要约一分钟恢复。',
    shutdown: '设备关机后无法远程重新开机，需要按实体电源键。'
  };
  if (prompts[action] && !(await confirmAction(labels[action], prompts[action]))) return;
  actionBusy.value = true;
  deviceActionResult.value = `正在${labels[action]}…`;
  try {
    const result = await routerApi.controlDevice(action);
    const accepted = ['success', '0', '4', 0, 4].includes(result?.result);
    deviceActionResult.value = accepted ? `${labels[action]}命令已执行` : `${labels[action]}返回：${result?.result ?? '未知'}`;
    if (action === 'wifi-on') setTimeout(() => refresh(true), 1800);
  } catch (error) {
    if (action === 'wifi-off' && /超时|timeout|网络/i.test(error.message)) deviceActionResult.value = '连接已中断，关闭 Wi-Fi 命令可能已经生效';
    else deviceActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

async function testDeveloper() {
  settingsResult.value = '正在验证开发者权限…';
  try {
    const result = await routerApi.developerLogin();
    settingsResult.value = result.message;
  } catch (error) {
    settingsResult.value = error.message;
  }
}

async function initialize() {
  await backfillBackgroundHistory();
  await refresh();
}

onMounted(() => {
  if (typeof window !== 'undefined') window.u50HandleBack = handleNavigationBack;
  void checkSoftwareUpdate();
  if (nativeUpdate) {
    pollApkDownload();
    updatePollTimer = setInterval(pollApkDownload, 1000);
  }
  // 用页面自身的图表/电池窗口参数初始化同步编排，确保跨设备合并与本地保留窗口一致。
  syncClient.init({
    chartWindowMs: METRIC_HISTORY_WINDOW_MS,
    chartSampleMs: CHART_HISTORY_SAMPLE_MS,
    chartMaxPoints: CHART_HISTORY_MAX_POINTS,
    batteryWindowMs: BATTERY_HISTORY_WINDOW_MS
  });
  refreshSyncState();
  initialize();
  syncOverlayState();
  syncBackgroundState();
  if (typeof window !== 'undefined') window.addEventListener('pageshow', handlePageShow);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange);
  pollTimer = setInterval(refresh, 1000);
  backgroundStateTimer = setInterval(syncBackgroundState, 5000);
  smsPollTimer = setInterval(() => {
    if (activeTab.value === 'devices' && managementTab.value === 'sms' && !actionBusy.value) loadSms();
  }, SMS_REFRESH_MS);
  const updateClock = () => { freshnessNow.value = Date.now(); clock.value = new Date().toLocaleString('zh-CN', { hour12: false }); };
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
});

onLoad(options => {
  switchTab(options?.tab || 'overview', options?.section || '');
});

onHide(handlePageHide);

onBeforeUnmount(() => {
  if (typeof window !== 'undefined' && window.u50HandleBack === handleNavigationBack) delete window.u50HandleBack;
  clearInterval(updatePollTimer);
  persistChartHistory(true);
  clearInterval(pollTimer);
  clearInterval(smsPollTimer);
  clearInterval(clockTimer);
  clearInterval(backgroundStateTimer);
  if (typeof window !== 'undefined') window.removeEventListener('pageshow', handlePageShow);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<style scoped src="./index.css"></style>
