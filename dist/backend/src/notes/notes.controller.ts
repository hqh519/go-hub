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
 * 权限：必须登录；一律按 instanceId 收窄；普通用户只看自己的，管理员在实例内看全部。
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
    this.ctx(req);
    return this.notes.tagCandidates(instanceId || '');
  }

  /** 图床选文件器：分页 + 搜索 + 类型过滤，只读不写 */
  @Get('files')
  async files(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('instanceId') instanceId?: string,
  ) {
    const { viewer, isAdmin } = this.ctx(req);
    return this.notes.pickFiles({
      search,
      type,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 24,
      instanceId: instanceId || '',
      viewer,
      isAdmin,
    });
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
