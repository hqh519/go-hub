/**
 * 统一剪贴板写入工具。
 *
 * 为什么要单独抽一层：
 *   1. `navigator.clipboard` 只在「安全上下文（HTTPS / localhost）」可用，
 *      自部署图床经常是 http + 内网 IP，直接调用会抛 TypeError；
 *   2. 老旧浏览器 / 部分国产内核移动端浏览器没有 `navigator.clipboard`；
 *   3. iOS Safari 要求 `execCommand('copy')` 必须发生在用户手势的同步调用链里，
 *      因此降级路径不能放在 Promise.then 之后（异步后再调会失败）。
 *
 * 策略：优先 Clipboard API（异步、体验好）；一旦不可用或失败，
 * 立刻同步走 textarea + execCommand 兜底；再失败则返回 false，
 * 由调用方决定如何提示（一般是把文本直接弹出来让用户手动复制）。
 */

/** textarea + execCommand 兜底（同步执行，兼容老 Safari / 老安卓 WebView） */
export function copyByExecCommand(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // 防止移动端键盘弹出 / 页面跳动
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.boxShadow = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0';
    document.body.appendChild(ta);

    // iOS 需要把 range 显式选中才认
    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    ta.focus();
    ta.select();
    if (typeof ta.setSelectionRange === 'function') {
      ta.setSelectionRange(0, text.length);
    }
    const ok = document.execCommand('copy');

    ta.remove();
    if (previous) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok;
  } catch (err) {
    return false;
  }
}

/** 当前环境是否可用 Clipboard API */
export function canUseClipboardApi() {
  try {
    return typeof navigator !== 'undefined' && !!navigator.clipboard && !!window.isSecureContext;
  } catch (err) {
    return false;
  }
}

/**
 * 复制文本。
 * @param {string} text
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  if (canUseClipboardApi()) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (err) {
      /* 权限被拒 / 非用户手势 → 落到同步兜底 */
    }
  }
  return copyByExecCommand(value);
}

export default copyText;
