# -*- coding: utf-8 -*-
"""v1.1.2 i18n 增量补词（幂等：只增 / 改，不删）"""
import json, io, sys, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'locales')

# key -> (zh, en)
ADD = {
    'notes': {
        'addFromBed': ('图床选择', 'Image bed'),
        'titlePlaceholder': ('标题（默认填当天日期）', "Title (today's date by default)"),
        'draftRestored': ('已恢复上次未发布的内容', 'Restored your unsaved draft'),
        'draftDiscard': ('丢弃', 'Discard'),
        'linkExtract': ('链接提取', 'Extract link'),
        'linkTip': ('粘贴文件直链，服务端会拉取并转存进图床，然后作为附件插入。',
                    'Paste a direct file link. The server fetches it into the image bed and attaches it here.'),
        'linkTransfer': ('转存', 'Transfer'),
        'linkEmpty': ('请填写链接地址', 'Please enter a link'),
        'linkInvalid': ('链接需以 http:// 或 https:// 开头', 'Link must start with http:// or https://'),
        'linkOk': ('已转存并加入附件', 'Transferred and attached'),
        'linkFail': ('转存失败：{msg}', 'Transfer failed: {msg}'),
        'linkUploading': ('正在转存链接…', 'Transferring link…'),
        'typeCollection': ('收集', 'Collection'),
        'publishArticle': ('发布文章', 'Publish article'),
        'addTodo': ('添加待办', 'Add to-do'),
        'addNav': ('添加导航', 'Add bookmark'),
        'addCollection': ('添加收集', 'Add collection'),
        'more': ('更多', 'More'),
        'detail': ('详情', 'Details'),
        'comment': ('留言', 'Comment'),
        'commentTitle': ('留言', 'Comments'),
        'commentPlaceholder': ('说点什么…（最多 500 字）', 'Say something… (max 500 characters)'),
        'commentEmpty': ('还没有留言', 'No comments yet'),
        'commentPost': ('发布留言', 'Post'),
        'commentOk': ('留言已发布', 'Comment posted'),
        'commentDeleted': ('留言已删除', 'Comment deleted'),
        'commentDelete': ('删除留言', 'Delete comment'),
        'commentDeleteConfirm': ('确定删除这条留言？', 'Delete this comment?'),
        'commentLimit': ('最多 {n} 字', 'Up to {n} characters'),
        'commentCount': ('{n} 条留言', '{n} comments'),
        'commentLoadFail': ('留言加载失败', 'Failed to load comments'),
        'tagAdmin': ('标签管理', 'Tag management'),
        'tagAdminTitle': ('笔记标签管理', 'Note tag management'),
        'tagKindAll': ('全部', 'All'),
        'tagSearch': ('搜索标签', 'Search tags'),
        'tagNoData': ('还没有标签', 'No tags yet'),
        'tagUsage': ('{n} 次引用', '{n} uses'),
        'tagSelectHint': ('在左侧选择一个标签查看详情', 'Select a tag on the left'),
        'tagRename': ('重命名', 'Rename'),
        'tagRemark': ('备注', 'Remark'),
        'tagRemarkPlaceholder': ('给这个标签写一句备注', 'Add a remark for this tag'),
        'tagMerge': ('合并', 'Merge'),
        'tagMergeTitle': ('合并标签', 'Merge tags'),
        'tagMergeTip': ('把多个标签合并成一个，引用关系会一起转移；合并后仅保留目标标签。',
                        'Merge several tags into one. All references move over and only the target tag remains.'),
        'tagMergeTarget': ('合并到', 'Merge into'),
        'tagMergeOk': ('已合并', 'Merged'),
        'tagSplit': ('拆分', 'Split'),
        'tagSplitTitle': ('拆分标签', 'Split tag'),
        'tagSplitTip': ('输入新标签名（多个用逗号分隔），把「{name}」上的笔记按选中项转移到新标签。',
                        'Enter new tag names (comma separated) and move the selected notes off "{name}".'),
        'tagSplitOk': ('已拆分', 'Split'),
        'tagSaveOk': ('已保存', 'Saved'),
        'tagDelete': ('删除标签', 'Delete tag'),
        'tagDeleteConfirm': ('确定删除标签「{name}」？引用它的笔记会失去这个标签。',
                             'Delete tag "{name}"? Notes using it will lose the tag.'),
        'tagDeletedOk': ('标签已删除', 'Tag deleted'),
        'tagMixedType': ('文件标签和笔记标签不能互相合并', 'File tags and note tags cannot be merged'),
        'tagCreate': ('新建标签', 'New tag'),
        'tagCreateOk': ('标签已创建', 'Tag created'),
        'tagNameRequired': ('请填写标签名', 'Tag name is required'),
        'tagMinTwo': ('至少选择两个标签', 'Pick at least two tags'),
        'tagLoadFail': ('标签加载失败', 'Failed to load tags'),
        'record': ('记录', 'Record'),
        'recordTip': ('选一个类型，直接开始写', 'Pick a type and start writing'),
        'viewRefs': ('查看引用', 'View references'),
        'deleteBlocked': ('该文件已被笔记引用，无法删除', 'This file is referenced by notes and cannot be deleted'),
        'refNotes': ('引用它的笔记', 'Referenced by'),
        'mediaOther': ('其他', 'Other'),
        'pickPreviewHold': ('按住预览', 'Hold to preview'),
    },
    'fileDetail': {
        'fileRealName': ('文件实名', 'Real name'),
        'fileRef': ('文件引用', 'References'),
        'fileRefView': ('查看', 'View'),
        'fileRefNone': ('暂无引用', 'No references'),
        'fileRefCount': ('{n} 处引用', '{n} references'),
    },
    'filter': {
        'uploadSourceAttachment': ('附件上传', 'Attachment'),
    },
    'common': {
        'back': ('返回', 'Back'),
    },
    'fileRef': {
        'title': ('文件引用明细', 'File references'),
        'refCount': ('{n} 处引用', '{n} references'),
        'empty': ('这个文件还没有被任何笔记引用', 'This file is not referenced by any note yet'),
        'untitled': ('（无标题）', '(Untitled)'),
        'inTrash': ('回收站', 'Trash'),
        'missingName': ('缺少文件名参数', 'Missing file name parameter'),
        'loadFail': ('加载失败', 'Failed to load'),
    },
}

def load(p):
    with io.open(p, encoding='utf-8') as f:
        return json.load(f)

def dump(p, obj):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write('\n')

zh = load(os.path.join(BASE, 'zh-CN.json'))
en = load(os.path.join(BASE, 'en.json'))

added, changed = 0, 0
for ns, items in ADD.items():
    for k, (zv, ev) in items.items():
        for obj, val, tag in ((zh, zv, 'zh'), (en, ev, 'en')):
            sec = obj.setdefault(ns, {})
            if k not in sec:
                sec[k] = val
                if tag == 'zh':
                    added += 1
            elif sec[k] != val:
                sec[k] = val
                if tag == 'zh':
                    changed += 1

dump(os.path.join(BASE, 'zh-CN.json'), zh)
dump(os.path.join(BASE, 'en.json'), en)
print('added', added, 'changed', changed)
