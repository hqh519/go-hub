# -*- coding: utf-8 -*-
"""v1.1.2.2 i18n 增量补词（幂等：只增 / 改，不删）—— 排版样式 + 附件行数 + 单附件预览"""
import json, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'locales')

ADD = {
    'notes': {
        # 已有的两条提示补上「单个附件按 70% 折算」
        'attachRatioTip': (
            '可填 {min}% ~ {max}%，默认 30%。这个比例是「附件显示三行时」的总高度；'
            '两行时按 80% 折算，一行时按 60% 折算；只有一个附件时按 70% 折算，'
            '并且按原图宽高比决定宽度。',
            'Between {min}% and {max}%, default 30%. The ratio is the total height when three rows '
            'are shown; two rows use 80% of it, one row uses 60%, and a single attachment uses 70% '
            'with its width following the original aspect ratio.'
        ),
        'attachSizeTip': (
            '「默认」保持现在的布局；「指定比例」按下方比例限制附件区总高度，'
            '两个及以上附件保持正方形，只有一个附件时按原图宽高比显示。',
            'Default keeps the current layout. Custom ratio caps the total height of the attachment '
            'area: two or more attachments stay square, a single one follows its original aspect ratio.'
        ),
        'attachPreviewSingle': (
            '单个附件：高度约 {h}px（宽度按原图比例，视口 {vh}px）',
            'Single attachment: about {h}px tall (width follows the image, at a {vh}px viewport)'
        ),
        # v1.1.2.2 新增
        'layoutStyle': ('内容排版样式', 'Content layout'),
        'layoutDefault': ('默认样式', 'Default'),
        'layoutDivider': ('分割线样式', 'Divider'),
        'layoutStyleTip': (
            '「默认样式」保留每条内容的外边框；「分割线样式」隐藏外边框，'
            '改为在每条内容下方用一条分割线与下一条隔开（分割线颜色与边框一致）。',
            'Default keeps the bordered card around each note. Divider hides the border and separates '
            'notes with a single line underneath, in the same colour as the border.'
        ),
        'attachRows': ('附件数量加载', 'Attachments loaded'),
        'attachRows3': ('加载三行（最多 9 个）', 'Three rows (up to 9)'),
        'attachRows2': ('加载两行（最多 6 个）', 'Two rows (up to 6)'),
        'attachRows1': ('加载一行（最多 3 个）', 'One row (up to 3)'),
        'attachRowsTip': (
            '只影响「显示几个」，尺寸仍按上面的「附件加载区域大小」执行；'
            '超出的部分在最后一格显示 +N，点开灯箱可以看全部。',
            'Only changes how many are shown; sizes still follow the attachment area size above. '
            'The rest are collapsed into a +N badge that opens the full set in the lightbox.'
        )
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
