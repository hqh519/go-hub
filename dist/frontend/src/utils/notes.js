/**
 * 笔记板块 · 前端公共工具（v1.2.0 起）
 * ----------------------------------------------------------------------------
 * 这里的计算规则**必须与后端 `backend/src/notes/notes.util.ts` 逐行等价**，
 * 否则会出现「前端说没超、后端说超了」这种最难解释的 bug：
 *   · countTextChars —— 瞬间 500 字上限的判定口径
 *   · mediaKindOf    —— 媒体类型聚合（列表筛选 / 卡片角标）
 * 后端是权威校验，前端这份只用于实时计数与预览。
 */

/** 瞬间正文字数上限（后端可在设置里改，这里只是前端默认值与提示用） */
export const MOMENT_MAX_CHARS = 500

/** 单篇附件上限（与后端 MAX_ASSETS_PER_NOTE 一致） */
export const MAX_ASSETS_PER_NOTE = 50

/** 九宫格一屏最多显示几个，超出部分进灯箱浏览 */
export const GRID_MAX = 9

/**
 * 正文字数统计：只数「汉字 + 字母 + 数字」。
 * 标点、空格、换行、emoji、特殊符号都不计入（对齐需求「不含标点和其他特殊符号」）。
 * 用 for...of 按码点遍历，避免 emoji / 生僻字被算成 2 个字符。
 */
export function countTextChars(input) {
  const s = String(input ?? '')
  if (!s) return 0
  let n = 0
  for (const ch of s) {
    if (/[\p{L}\p{N}]/u.test(ch)) n += 1
  }
  return n
}

/** 单个文件的媒体大类 */
export function mediaKindOfMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'file'
}

/** 由附件列表推导媒体类型（与后端 mediaKindOf 同规则） */
export function mediaKindOf(assets) {
  const list = (assets || []).filter(Boolean)
  if (!list.length) return 'text'
  const kinds = new Set(list.map((a) => a.mediaKind || mediaKindOfMime(a.mime)))
  if (kinds.size > 1) return 'mixed'
  const only = [...kinds][0]
  return ['image', 'video', 'audio'].includes(only) ? only : 'mixed'
}

/** 体积格式化（与后台其它页的显示口径一致） */
export function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** 取扩展名（小写、不带点） */
export function extOf(name) {
  const s = String(name || '')
  const i = s.lastIndexOf('.')
  return i > 0 ? s.slice(i + 1).toLowerCase() : ''
}

/**
 * 心情 / 天气选项。
 * 数据库只存**枚举值**（happy / sunny…），emoji 只是展示形态 ——
 * 这样以后换图标风格、加多语言文案都不用动历史数据。
 */
export const MOOD_OPTIONS = [
  { value: 'happy', emoji: '😄', label: 'notes.moodHappy' },
  { value: 'smile', emoji: '🙂', label: 'notes.moodSmile' },
  { value: 'calm', emoji: '😌', label: 'notes.moodCalm' },
  { value: 'tired', emoji: '😪', label: 'notes.moodTired' },
  { value: 'sad', emoji: '😔', label: 'notes.moodSad' },
  { value: 'angry', emoji: '😤', label: 'notes.moodAngry' },
  { value: 'love', emoji: '🥰', label: 'notes.moodLove' }
]

export const WEATHER_OPTIONS = [
  { value: 'sunny', emoji: '☀️', label: 'notes.weatherSunny' },
  { value: 'cloudy', emoji: '⛅', label: 'notes.weatherCloudy' },
  { value: 'overcast', emoji: '☁️', label: 'notes.weatherOvercast' },
  { value: 'rain', emoji: '🌧️', label: 'notes.weatherRain' },
  { value: 'snow', emoji: '❄️', label: 'notes.weatherSnow' },
  { value: 'wind', emoji: '🌬️', label: 'notes.weatherWind' },
  { value: 'fog', emoji: '🌫️', label: 'notes.weatherFog' }
]

/** 值 → emoji（找不到返回空串，不显示角标） */
export function emojiOfMood(value) {
  const hit = MOOD_OPTIONS.find((m) => m.value === value)
  return hit ? hit.emoji : ''
}

export function emojiOfWeather(value) {
  const hit = WEATHER_OPTIONS.find((m) => m.value === value)
  return hit ? hit.emoji : ''
}

/**
 * 时间显示：列表卡片用的相对友好格式。
 * 今天 → 「今天 14:32」；昨天 → 「昨天 09:10」；今年 → 「3月8日 14:32」；更早 → 「2025/12/01」
 *
 * @param {number} ts 毫秒时间戳
 * @param {Function} [t] i18n 的 $t（不传则用中文兜底，纯工具函数保持无框架依赖）
 */
export function formatMomentTime(ts, t) {
  const T = typeof t === 'function' ? t : (k, fallback) => fallback
  const txt = (key, fallback) => {
    try {
      const v = T(key)
      return v && v !== key ? v : fallback
    } catch (e) {
      return fallback
    }
  }
  const t2 = Number(ts) || 0
  if (!t2) return ''
  const d = new Date(t2)
  const now = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now)) return `${txt('notes.timeToday', '今天')} ${hm}`
  const yest = new Date(now.getTime() - 86400000)
  if (sameDay(d, yest)) return `${txt('notes.timeYesterday', '昨天')} ${hm}`
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}${txt('notes.timeMonthDay', '月')}${d.getDate()}日 ${hm}`
  }
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}
