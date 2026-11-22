/**
 * 文章板块控制器（v1.4.0）
 * ----------------------------------------------------------------------------
 * 路由前缀：/api/article
 *   GET    folders            分类树（扁平 + 计数）  ?instanceId=&type=
 *   POST   folders            新建分类 { name, parentId, type, instanceId }
 *   PUT    folders/:id        改名 / 移动 / 排序 { name, parentId, sort, type }
 *   DELETE folders/:id        删除分类（子分类上浮，文章转未分类）
 *   POST   folders/reorder    同级重排 { parentId, type, ids: [] }
 *
 *   GET    list               列表（不含正文）?type=&folderId=&status=&search=&page=&pageSize=
 *   GET    tags               候选标签 ?type=
 *   GET    :id                详情（含页签与标签）
 *   POST   /                  新建 { type, folderId, title }
 *   PUT    :id                保存元信息（含乐观锁 version）
 *   PUT    :id/tabs           批量保存页签 { tabs: [], version }
 *   POST   :id/tags           设置标签 { names: [] }
 *   DELETE :id                进回收站
 *   POST   :id/restore        恢复
 *   DELETE :id/purge          彻底删除
 *
 * 静态段（folders / list / tags）必须排在 `:id` 之前，否则会被 `:id` 通配吃掉。
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
import { ArticleService } from './article.service';

@Controller('api/article')
export class ArticleController {
  constructor(private readonly article: ArticleService) {}

  /** 与记事 / 瞬间同一套权限口径：必须登录，实例隔离，只能碰自己的数据 */
  private ctx(req: Request): { viewer: string } {
    const session = currentSession(req);
    const viewer = String(session?.user || '');
    if (!viewer) {
      throw new HttpException({ success: false, message: '请先登录后再使用文章功能' }, HttpStatus.UNAUTHORIZED);
    }
    return { viewer };
  }

  private fail(message: string, status = HttpStatus.BAD_REQUEST) {
    throw new HttpException({ success: false, message }, status);
  }

  /** 统一的错误收口：{ error } 转 400，{ conflict } 转 409 */
  private unwrap<T extends { error?: string; conflict?: boolean; version?: number }>(r: T): T {
    if (r && r.conflict) {
      throw new HttpException(
        { success: false, conflict: true, version: r.version, message: '内容已在别处更新，请重新加载后再改' },
        HttpStatus.CONFLICT,
      );
    }
    if (r && r.error) this.fail(r.error);
    return r;
  }

  // -------- 分类 --------

  @Get('folders')
  async folders(@Req() req: Request, @Query('instanceId') instanceId?: string, @Query('type') type?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.article.listFolders(viewer, instanceId || '', type);
    return { success: true, data };
  }

  @Post('folders')
  async createFolder(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.article.createFolder(viewer, String(body.instanceId ?? ''), {
      type: body.type,
      name: body.name,
      parentId: body.parentId,
    });
    const ok = this.unwrap(r as { error?: string });
    return { success: true, data: (ok as { folder: unknown }).folder };
  }

  @Put('folders/:id')
  async updateFolder(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.article.updateFolder(viewer, String(body.instanceId ?? ''), id, {
      name: body.name,
      parentId: body.parentId,
      sort: body.sort,
      type: body.type,
    });
    const ok = this.unwrap(r as { error?: string });
    return { success: true, data: (ok as { folder: unknown }).folder };
  }

  @Delete('folders/:id')
  async deleteFolder(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('instanceId') instanceId?: string,
    @Query('type') type?: string,
  ) {
    const { viewer } = this.ctx(req);
    const r = await this.article.deleteFolder(viewer, instanceId || '', id, type);
    this.unwrap(r as { error?: string });
    return { success: true, data: r };
  }

  @Post('folders/reorder')
  async reorderFolders(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const data = await this.article.reorderFolders(
      viewer,
      String(body.instanceId ?? ''),
      body.type,
      String(body.parentId ?? ''),
      body.ids,
    );
    return { success: true, data };
  }

  // -------- 文章 --------

  @Get('list')
  async list(@Req() req: Request, @Query() q: Record<string, string>) {
    const { viewer } = this.ctx(req);
    const data = await this.article.listArticles({
      viewer,
      instanceId: q.instanceId || '',
      type: q.type,
      folderId: q.folderId,
      deep: q.deep === '1' || q.deep === 'true',
      status: q.status,
      search: q.search,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 30),
      sort: q.sort,
    });
    return { success: true, data };
  }

  @Get('tags')
  async tags(@Req() req: Request, @Query('instanceId') instanceId?: string, @Query('type') type?: string) {
    const { viewer } = this.ctx(req);
    const data = await this.article.tagCandidates(viewer, instanceId || '', type);
    return { success: true, data };
  }

  @Get(':id')
  async detail(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const r = await this.article.getArticle(viewer, instanceId || '', id);
    this.unwrap(r as { error?: string });
    return { success: true, data: (r as { article: unknown }).article };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.article.createArticle(viewer, String(body.instanceId ?? ''), {
      type: body.type,
      folderId: body.folderId,
      title: body.title,
      content: body.content,
    });
    this.unwrap(r as { error?: string });
    return { success: true, data: r };
  }

  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.article.updateArticle(viewer, String(body.instanceId ?? ''), id, {
      title: body.title,
      excerpt: body.excerpt,
      note: body.note,
      coverFileId: body.coverFileId,
      folderId: body.folderId,
      status: body.status,
      done: body.done,
      version: body.version,
    });
    this.unwrap(r as { error?: string; conflict?: boolean; version?: number });
    return { success: true, data: r };
  }

  @Put(':id/tabs')
  async saveTabs(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.article.saveTabs(viewer, String(body.instanceId ?? ''), id, {
      tabs: body.tabs,
      version: body.version,
    });
    this.unwrap(r as { error?: string; conflict?: boolean; version?: number });
    return { success: true, data: r };
  }

  @Post(':id/tags')
  async setTags(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.article.setTags(viewer, String(body.instanceId ?? ''), id, body.names);
    this.unwrap(r as { error?: string });
    return { success: true, data: r };
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const r = await this.article.deleteArticle(viewer, instanceId || '', id);
    this.unwrap(r as { error?: string });
    return { success: true, data: r };
  }

  @Post(':id/restore')
  async restore(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { viewer } = this.ctx(req);
    const r = await this.article.restoreArticle(viewer, String(body?.instanceId ?? ''), id);
    this.unwrap(r as { error?: string });
    return { success: true, data: r };
  }

  @Delete(':id/purge')
  async purge(@Req() req: Request, @Param('id') id: string, @Query('instanceId') instanceId?: string) {
    const { viewer } = this.ctx(req);
    const r = await this.article.purgeArticle(viewer, instanceId || '', id);
    this.unwrap(r as { error?: string });
    return { success: true, data: r };
  }
}
