/**
 * 笔记板块控制器（v1.2.0 起）
 * ----------------------------------------------------------------------------
 * 路由前缀：/api/notes
 *   GET    list            列表（kind / 媒体类型 / 搜索 / 标签 / 日期 / 排序 / 分页 / 回收站）
 *   GET    tags            标签候选（Tag.type='note'，与文件标签隔离）
 *   GET    files           图床选文件器（只读，供「从图床选择」用）
 *   GET    :id             详情
 *   POST   /               创建（本版只有 kind=moment）
 *   PUT    :id             编辑
 *   DELETE :id             软删（进回收站，可恢复）
 *   POST   :id/restore     从回收站恢复
 *   DELETE :id/purge       彻底删除（只删笔记，不动图床文件）
 *
 * 命名空间刻意避开 `api/manage`（文件管理已占满）与 `api` 根（compat 控制器兜底），
 * 避免与图床既有接口产生任何路由冲突。
 *
 * 权限（v1.1.4 收紧）：必须登录；一律按 instanceId + author 双层收窄 ——
 * 笔记只对作者本人可见，管理员在笔记管理里也看不到他人的笔记。
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
import { currentSession, isAdminRole } from '../auth/auth.guard';
import { NotesService } from './notes.service';

@Controller('api/notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  /**
   * 统一的会话解析。
   * 笔记是个人内容，匿名一律拒绝（与「上传页可匿名」不同）——
   * 这也是本模块不放 OptionalAuthGuard 的原因。
   */
  private ctx(req: Request): { viewer: string; isAdmin: boolean } {
    const session = currentSession(req);
    const viewer = String(session?.user || '');
    if (!viewer) {
      throw new HttpException({ success: false, message: '请先登录后再使用笔记' }, HttpStatus.UNAUTHORIZED);
    }
    return { viewer, isAdmin: isAdminRole(session?.role) };
  }

  /** 列表：kind 不传 = 全部（不要把「全部」写死成 moment，否则以后加类型要改所有调用点） */
  @Get('list')
  async list(
    @Req() req: Request,
    @Query('kind') kind?: string,
    @Query('mediaKind') mediaKind?: string,
    @Query('search') search?: string,
    @Query('searchType') searchType?: string,
    @Query('tagId') tagId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('instanceId') instanceId?: string,
  ) {
    const { viewer, isAdmin } = this.ctx(req);
    return this.notes.list({
      kind,
      mediaKind,
      search,
      searchType,
      tagId,
      status,
      from,
      to,
      sort,
      order,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      instanceId: instanceId || '',
      viewer,
      isAdmin,
    });
  }

  /** 标签候选（笔记标签） */
  @Get('tags')
  async tags(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    // v1.1.4：标签候选按用户隔离（笔记私有的直接推论）
    const { viewer } = this.ctx(req);
    return this.notes.tagCandidates(instanceId || '', viewer);
  }

  /**
   * 笔记设置（v1.1.2.1）
   * ------------------------------------------------------------------
   * 按**实例**保存：同一个实例里的所有人看到同一套附件区布局，
   * 换到另一个实例就是另一套 —— 与文件 / 标签 / 笔记的隔离口径一致。
   * 路由必须排在 `@Get(':id')` 之前，否则 'settings' 会被当成笔记 id。
   */
  @Get('settings')
  async getSettings(@Req() req: Request, @Query('instanceId') instanceId?: string) {
    this.ctx(req);
    return { success: true, data: await this.notes.getNoteSettings(instanceId || '') };
  }

  /** 保存笔记设置（合并式：只传变化的分类即可） */
  @Put('settings')
  async saveSettings(@Req() req: Request, @Body() body: Record<string, unknown>) {
    this.ctx(req);
    const { instanceId, ...patch } = body || {};
    const data = await this.notes.saveNoteSettings(String(instanceId || ''), patch);
    return { success: true, data };
  }

  /**
   * 图床选文件器：分页 + 搜索 + 类型过滤，只读不写
   * v1.1.3：额外接受与 /api/files/list 同名的筛选参数（fileType / accessStatus / filterTags /
   * dateFrom / sizeMin / channel / uploadSource / filterUsers …），
   * 求值实现与图床管理页共用 common/file-filter.ts，保证「筛选范围完全一致」。
   */
  @Get('files')
  async files(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer, isAdmin } = this.ctx(req);
    return this.notes.pickFiles({
      search: q.search,
      searchScope: q.searchType,
      type: q.type,
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 24,
      instanceId: q.instanceId || '',
      viewer,
      isAdmin,
      filterQuery: q,
      matchMode: q.matchMode,
    });
  }

  /**
   * 标签管理（v1.1.2）
   * GET /api/notes/tag-admin?instanceId=&kind=
   *   kind 不传 = 「全部」分类下的全部笔记标签；传具体 kind 只返回该分类用到的标签。
   *   返回带「每个分类的使用次数」，前端切换分类时不用重新请求。
   */
  @Get('tag-admin')
  async tagAdmin(
    @Req() req: Request,
    @Query('instanceId') instanceId?: string,
    @Query('kind') kind?: string,
  ) {
    // v1.1.4：标签管理的使用次数只算自己的笔记
    const { viewer } = this.ctx(req);
    return this.notes.tagAdmin(instanceId || '', kind || '', viewer);
  }

  /** 某条瞬间的留言列表 */
  @Get(':id/comments')
  async comments(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('instanceId') instanceId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { viewer, isAdmin } = this.ctx(req);
    const r = await this.notes.listComments({
      noteId: id,
      viewer,
      isAdmin,
      instanceId: instanceId || '',
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.NOT_FOUND);
    return r;
  }

  /** 新增留言（上限 500 字） */
  @Post(':id/comments')
  async addComment(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { viewer, isAdmin } = this.ctx(req);
    const r = await this.notes.addComment({
      noteId: id,
      content: String(body.content ?? ''),
      viewer,
      isAdmin,
      instanceId: String(body.instanceId ?? ''),
      ip: String(req.ip || ''),
    });
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    // comment 是给人看的（卡片内联追加，省一次整页重载）；id 保留给老调用方
    return { success: true, id: (r as { id: string }).id, comment: (r as { comment?: unknown }).comment || null };
  }

  /** 删除留言（本人或管理员） */
  @Delete('comments/:commentId')
  async deleteComment(@Req() req: Request, @Param('commentId') commentId: string) {
    const { viewer, isAdmin } = this.ctx(req);
    const r = await this.notes.deleteComment(commentId, viewer, isAdmin, String(req.ip || ''));
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    return { success: true };
  }

  /** 详情 */
  @Get(':id')
  async detail(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('instanceId') instanceId?: string,
  ) {
    const { viewer, isAdmin } = this.ctx(req);
    const hit = await this.notes.detail(id, viewer, isAdmin, instanceId || '');
    if (!hit) throw new HttpException({ success: false, message: '瞬间不存在或无权查看' }, HttpStatus.NOT_FOUND);
    return hit;
  }

  /** 创建瞬间 */
  @Post()
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.notes.createMoment(
      {
        title: body.title as string,
        content: body.content as string,
        mood: body.mood as string,
        weather: body.weather as string,
        moodName: body.moodName as string,
        weatherName: body.weatherName as string,
        location: body.location as string,
        visibility: body.visibility as string,
        assetIds: body.assetIds as string[],
        tagNames: body.tagNames as string[],
        instanceId: body.instanceId as string,
      },
      viewer,
      String(req.ip || ''),
    );
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    return { success: true, id: (r as { id: string }).id };
  }

  /** 编辑瞬间 */
  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer, isAdmin } = this.ctx(req);
    const r = await this.notes.updateMoment(
      id,
      {
        title: body.title as string,
        content: body.content as string,
        mood: body.mood as string,
        weather: body.weather as string,
        moodName: body.moodName as string,
        weatherName: body.weatherName as string,
        location: body.location as string,
        visibility: body.visibility as string,
        assetIds: body.assetIds as string[],
        tagNames: body.tagNames as string[],
        instanceId: body.instanceId as string,
      },
      viewer,
      isAdmin,
      String(req.ip || ''),
    );
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    return { success: true, id: (r as { id: string }).id };
  }

  /** 软删 → 回收站 */
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { viewer, isAdmin } = this.ctx(req);
    const r = await this.notes.softDelete(id, viewer, isAdmin, String(req.ip || ''));
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    return { success: true };
  }

  /** 从回收站恢复 */
  @Post(':id/restore')
  async restore(@Req() req: Request, @Param('id') id: string) {
    const { viewer, isAdmin } = this.ctx(req);
    const r = await this.notes.restore(id, viewer, isAdmin, String(req.ip || ''));
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    return { success: true };
  }

  /** 彻底删除（只删笔记记录，不删图床文件） */
  @Delete(':id/purge')
  async purge(@Req() req: Request, @Param('id') id: string) {
    const { viewer, isAdmin } = this.ctx(req);
    const r = await this.notes.purge(id, viewer, isAdmin, String(req.ip || ''));
    if ('error' in r && r.error) throw new HttpException({ success: false, message: r.error }, HttpStatus.BAD_REQUEST);
    return { success: true };
  }
}
