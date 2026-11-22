/**
 * 笔记管理控制器（v1.3.0）
 * ----------------------------------------------------------------------------
 * 路由前缀：/api/memo
 *   GET    folders            目录树 + 每个目录的笔记数（含未归档数）
 *   POST   folders            新建目录 { name, parentId, instanceId }
 *   PUT    folders/:id        改名 / 移动 / 排序 { name, parentId, sort }
 *   DELETE folders/:id        删除目录（子目录与笔记上浮，不删内容）
 *   POST   folders/reorder    同级重排 { parentId, ids: [] }
 *
 *   GET    list               列表（**不含正文**）?folderId=&search=&status=&page=&pageSize=
 *   GET    :id                详情（含正文）
 *   POST   /                  新建 { title, content, folderId, instanceId }
 *   PUT    :id                保存 { title, content, folderId, version } —— 版本冲突返回 409
 *   POST   :id/move           移动到目录
 *   DELETE :id                进回收站
 *   POST   :id/restore        从回收站恢复
 *   DELETE :id/purge          彻底删除
 *
 * 路径刻意与 `/api/notes` 分开：瞬间那一套路由已经被前端大量引用，
 * 笔记自己一套前缀能避免 `:id` 通配把 `folders` 之类的静态段吃掉。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { currentSession } from '../auth/auth.guard';
import { MemoService } from './memo.service';

@Controller('api/memo')
export class MemoController {
  constructor(private readonly memo: MemoService) {}

  /** 与瞬间同一套权限口径：必须登录，实例隔离，只能碰自己的数据 */
  private ctx(req: Request): { viewer: string } {
    const session = currentSession(req);
    const viewer = String(session?.user || '');
    if (!viewer) {
      throw new HttpException({ success: false, message: '请先登录后再使用笔记' }, HttpStatus.UNAUTHORIZED);
    }
    return { viewer };
  }

  private fail(message: string, status = HttpStatus.BAD_REQUEST) {
    throw new HttpException({ success: false, message }, status);
  }

  // -------- 目录 --------

  @Get('folders')
  async folders(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.listFolders(viewer, instanceId || '');
    return { success: true, data };
  }

  @Post('folders')
  async createFolder(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.memo.createFolder(viewer, String(body.instanceId ?? ''), {
      name: body.name,
      parentId: body.parentId,
    });
    if ('error' in r && r.error) this.fail(r.error);
    return { success: true, data: (r as { folder: unknown }).folder };
  }

  @Put('folders/:id')
  async updateFolder(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.memo.updateFolder(viewer, String(body.instanceId ?? ''), id, {
      name: body.name,
      parentId: body.parentId,
      sort: body.sort,
    });
    if ('error' in r && r.error) this.fail(r.error);
    return { success: true, data: (r as { folder: unknown }).folder };
  }

  @Delete('folders/:id')
  async deleteFolder(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const r = await this.memo.deleteFolder(viewer, instanceId || '', id);
    if ('error' in r && r.error) this.fail(r.error);
    return { success: true, data: r };
  }

  @Post('folders/reorder')
  async reorderFolders(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.reorderFolders(
      viewer,
      String(body.instanceId ?? ''),
      String(body.parentId ?? ''),
      body.ids,
    );
    return { success: true, data };
  }

  // -------- 笔记 --------

  @Get('list')
  async list(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.listNotes({
      viewer,
      instanceId: q.instanceId || '',
      folderId: q.folderId,
      search: q.search,
      status: q.status,
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 50,
    });
    return { success: true, data };
  }

  /**
   * v1.3.9：文档节点树。
   *
   * 必须排在 `@Get(':id')` 之前 —— 否则 `tree` 会被当成「id 叫 tree 的笔记」。
   */
  @Get('tree')
  async tree(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.listTree(viewer, instanceId || '');
    return { success: true, data };
  }

  /* ── v1.3.9.1：文档树节点设置 / 模板列表（静态段，必须排在 @Get(':id') 之前） ── */

  @Get('node-settings')
  async getNodeSettings(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.getNodeSettings(viewer, instanceId || '');
    return { success: true, data };
  }

  @Put('node-settings')
  async saveNodeSettings(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.saveNodeSettings(viewer, String(body.instanceId ?? ''), body.settings ?? body);
    return { success: true, data };
  }

  @Get('templates')
  async templates(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.listTemplates(viewer, instanceId || '');
    return { success: true, data };
  }

  /*
   * ── 块索引与引用（v1.3.1 落地 · v1.5.0 计划） ──
   * 注意路由顺序：这些静态段必须排在 `@Get(':id')` **之前**，
   * 否则 `/api/memo/blocks/xxx` 会被当成「id 叫 blocks 的笔记」。
   */
  @Get('blocks/resolve')
  async resolveBlock(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    const bid = String(q.blockId || '');
    if (!bid) this.fail('缺少 blockId');
    const data = await this.memo.resolveBlock(bid, viewer, q.instanceId || '');
    if ('error' in data && data.error) this.fail(data.error, HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  @Get(':id/blocks')
  async blocks(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.listBlocks(id, viewer, instanceId || '');
    if ('error' in data && data.error) this.fail(data.error, HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  @Get(':id/backlinks')
  async backlinks(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.backlinks(id, viewer, instanceId || '');
    if ('error' in data && data.error) this.fail(data.error, HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  /** 重新解析本篇的块（索引损坏 / 手工改过 md 之后用） */
  @Post(':id/rebuild-index')
  async rebuildIndex(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const instanceId = String(body.instanceId ?? '');
    const note = await this.memo.getNote(viewer, instanceId, id);
    if (!note) this.fail('笔记不存在', HttpStatus.NOT_FOUND);
    const data = await this.memo.rebuildNoteIndex(id, String(note?.content || ''), viewer, instanceId);
    return { success: true, data };
  }

  /*
   * ── 笔记标签（v1.3.1.1） ──
   * 候选列表是静态段，必须排在 `:id/tags` 之前，否则 `candidates` 会被当成 id。
   */
  @Get('tags/candidates')
  async tagCandidates(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.noteTagCandidates(viewer, q.instanceId || '', q.keyword || '');
    return { success: true, data };
  }

  @Get(':id/tags')
  async listTags(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.listNoteTags(viewer, instanceId || '', id);
    if ('error' in data && data.error) this.fail(String(data.error), HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  /** 覆盖式保存标签（整行提交） */
  @Put(':id/tags')
  async setTags(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.setNoteTags(viewer, String(body.instanceId ?? ''), id, body.tagNames);
    if ('error' in data && data.error) this.fail(String(data.error), HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  /*
   * ── 历史快照（v1.3.1.1） ──
   * 同样排在 `@Get(':id')` 之前。`:id/history/:hid` 的静态段比 `:id` 更长，
   * Nest 会优先匹配更具体的路由，但为稳妥仍统一放在前面。
   */
  @Post(':id/history')
  async pushHistory(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const instanceId = String(body.instanceId ?? '');
    const data = await this.memo.pushHistory(viewer, instanceId, id, {
      title: body.title,
      content: body.content,
      version: body.version,
    });
    if ('error' in data && data.error) this.fail(String(data.error), HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  @Get(':id/history')
  async listHistory(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.listHistory(viewer, instanceId || '', id);
    if ('error' in data && data.error) this.fail(String(data.error), HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  @Get(':id/history/:hid')
  async getHistory(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('hid') hid: string,
    @Query('instanceId') instanceId?: string,
  ) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.getHistory(viewer, instanceId || '', id, hid);
    if ('error' in data && data.error) this.fail(String(data.error), HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  /** 用某一版历史覆盖当前内容（恢复前会把当前内容先存一条历史） */
  @Post(':id/history/:hid/restore')
  async restoreHistory(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('hid') hid: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.restoreHistory(viewer, String(body?.instanceId ?? ''), id, hid);
    if ('error' in data && data.error) this.fail(String(data.error), HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  /** 全量重建（运维用；正常保存会自动增量维护） */
  @Post('rebuild-index')
  async rebuildAll(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.rebuildAllIndex(viewer, String(body.instanceId ?? ''));
    return { success: true, data };
  }

  @Get(':id')
  async detail(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.getNote(viewer, instanceId || '', id);
    if (!data) this.fail('笔记不存在或无权查看', HttpStatus.NOT_FOUND);
    return { success: true, data };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    // v1.3.9：按类型创建（笔记 / 日记 / 札记 / 灵感），默认标题与落点由服务端算
    const r = await this.memo.createNode(viewer, String(body.instanceId ?? ''), {
      type: body.type,
      parentId: body.parentId,
      title: body.title,
      content: body.content,
    });
    if ('error' in r && r.error) this.fail(String(r.error));
    return { success: true, data: r };
  }

  /** v1.3.9：同级重排（拖拽落位后一次提交） */
  @Post('reorder')
  async reorder(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const data = await this.memo.reorderNodes(
      viewer,
      String(body.instanceId ?? ''),
      String(body.parentId ?? ''),
      body.ids,
    );
    return { success: true, data };
  }

  /** v1.3.9：改名（系统固定节点拒绝） */
  @Put(':id/rename')
  async rename(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.memo.renameNode(viewer, String(body.instanceId ?? ''), id, body.title);
    if ('error' in r && r.error) this.fail(String(r.error));
    return { success: true, data: r };
  }

  @Put(':id')
  async save(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.memo.saveNote(viewer, String(body.instanceId ?? ''), id, {
      title: body.title,
      content: body.content,
      folderId: body.folderId,
      version: body.version,
      mood: body.mood,
      moodName: body.moodName,
      weather: body.weather,
      weatherName: body.weatherName,
    });
    if ('error' in r && r.error) this.fail(r.error);
    // 版本冲突用 409：前端据此弹「已在别处修改」，不能当成普通错误提示
    if ('conflict' in r && r.conflict) {
      throw new HttpException(
        { success: false, conflict: true, message: (r as { message?: string }).message, version: (r as { version?: number }).version },
        HttpStatus.CONFLICT,
      );
    }
    return { success: true, data: r };
  }

  /** v1.3.9.1：更多菜单「升级」—— 层级上升一级并重算类型 */
  @Post(':id/promote')
  async promote(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.memo.promoteNode(viewer, String(body.instanceId ?? ''), id);
    if ('error' in r && r.error) this.fail(String(r.error));
    return { success: true, data: r };
  }

  @Post(':id/move')
  async move(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    // v1.3.9：新前端用 parentId 拖拽换父级 / 同级排序；folderId 保留给旧调用方
    const r =
      body.parentId !== undefined || body.sort !== undefined
        ? await this.memo.moveNode(viewer, String(body.instanceId ?? ''), id, {
            parentId: body.parentId,
            sort: body.sort,
          })
        : await this.memo.moveNote(viewer, String(body.instanceId ?? ''), id, body.folderId);
    if ('error' in r && r.error) this.fail(String(r.error));
    return { success: true, data: r };
  }

  @Delete(':id')
  async trash(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    // v1.3.9：删除节点 = 整棵子树进回收站
    const r = await this.memo.trashTree(viewer, instanceId || '', id);
    if ('error' in r && r.error) this.fail(String(r.error));
    return { success: true, data: r };
  }

  @Post(':id/restore')
  async restore(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    // v1.3.9：恢复节点 = 自身 + 子孙 + 已删除的祖先链
    const r = await this.memo.restoreTree(viewer, String(body.instanceId ?? ''), id);
    if ('error' in r && r.error) this.fail(String(r.error));
    return { success: true, data: r };
  }

  @Delete(':id/purge')
  async purge(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const r = await this.memo.purge(viewer, instanceId || '', id);
    if ('error' in r && r.error) this.fail(r.error);
    return { success: true };
  }
}
