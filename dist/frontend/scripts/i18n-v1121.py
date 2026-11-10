# -*- coding: utf-8 -*-
"""v1.1.2.1 i18n 增量补词（幂等：只增 / 改，不删）—— 笔记设置"""
import json, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'locales')

ADD = {
    'notes': {
        'settings': ('笔记设置', 'Note settings'),
        'settingsTitle': ('笔记设置', 'Note settings'),
        'settingsMoment': ('瞬间设置', 'Moment settings'),
        'settingsTodo': ('待办设置', 'To-do settings'),
        'settingsNav': ('导航设置', 'Bookmark settings'),
        'settingsArticle': ('文章设置', 'Article settings'),
        'settingsCollection': ('收集设置', 'Collection settings'),
        'settingsSoon': ('即将开放', 'Coming soon'),
        'settingsScope': (
            '设置按实例隔离：只对当前实例生效，切换实例会切换成那一套设置。',
            'Settings are per instance: they apply to the current instance only, and switching instances switches the settings too.'
        ),
        'settingsReset': ('恢复默认', 'Reset to default'),
        'settingsSaved': ('设置已保存', 'Settings saved'),
        'settingsSaveFail': ('保存失败：{msg}', 'Save failed: {msg}'),
        'attachSize': ('附件加载区域大小', 'Attachment area size'),
        'attachSizeDefault': ('默认（保持现有布局）', 'Default (keep current layout)'),
        'attachSizeCustom': ('指定比例', 'Custom ratio'),
        'attachSizeTip': (
            '「默认」保持现在的九宫格布局；「指定比例」按下方比例限制附件区总高度，'
            '格子始终保持正方形，整块宽度随之收窄。',
            'Default keeps the current grid. Custom ratio caps the total height of the attachment '
            'area; cells stay square and the whole block narrows accordingly.'
        ),
        'attachRatio': ('附件占页面最高比例', 'Max share of page height'),
        'attachRatioTip': (
            '可填 {min}% ~ {max}%，默认 30%。这个比例是「附件显示三行时」的总高度；'
            '两行时按 80% 折算，一行时按 60% 折算。',
            'Between {min}% and {max}%, default 30%. The ratio is the total height when three rows '
            'are shown; two rows use 80% of it and one row uses 60%.'
        ),
        'attachPreview': (
            '当前窗口高度 {vh}px 下的实际高度：三行 {h3}px、两行 {h2}px、一行 {h1}px',
            'At a {vh}px viewport: three rows {h3}px, two rows {h2}px, one row {h1}px'
        ),
        'attachAlign': ('附件加载位置', 'Attachment alignment'),
        'attachAlignCenter': ('默认（居中）', 'Default (centered)'),
        'attachAlignLeft': ('左对齐', 'Left aligned'),
        'attachAlignTip': (
            '「默认」保持现在居中的布局；「左对齐」让附件区与正文一样靠左。',
            'Default keeps the current centered layout; Left aligned puts the attachment area '
            'flush with the text.'
        )
    },
    # v1.1.2.1：文件引用扩到全类型（笔记 + 分享）
    'fileRef': {
        'sourceNote': ('笔记', 'Note'),
        'sourceShare': ('分享', 'Share'),
        'shareCate': ('目录分享', 'Folder share'),
        'shareTag': ('标签分享', 'Tag share'),
        'breakdown': (
            '{note} 条笔记 · {share} 个分享',
            '{note} note(s) · {share} share(s)'
        )
    },
    'fileDetail': {
        'fileRefBreakdown': ('（笔记 {note} / 分享 {share}）', '(notes {note} / shares {share})')
    }
}


def merge(path, table):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    added = 0
    for section, entries in table.items():
        data.setdefault(section, {})
        for key, pair in entries.items():
            value = pair[0] if path.endswith('zh-CN.json') else pair[1]
            if data[section].get(key) != value:
                if key not in data[section]:
                    added += 1
                data[section][key] = value
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return added


for name in ('zh-CN.json', 'en.json'):
    p = os.path.join(BASE, name)
    n = merge(p, ADD)
    print(f'{name}: added {n}')
