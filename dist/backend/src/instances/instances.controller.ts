import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard, currentSession } from '../auth/auth.guard';
import { InstancesService } from './instances.service';

/**
 * 实例管理（多实例方案 v3.0.0）—— 挂载路径 /api/instances，需登录。
 *
 * 权限模型：
 *   · 创建者（owner）：改名 / 改备注 / 删除 / 邀请码 / 成员管理；
 *   · 成员：仅可上传文件到该实例（归属校验在 UploadService）；
 *   · 加入：任意登录用户持有效邀请码即可（invite join）。
 */
@Controller('api/instances')
@UseGuards(AuthGuard)
export class InstancesController {
  constructor(private svc: InstancesService) {}

  /** 当前登录账户名 */
  private me(req: Request): string {
    const self = currentSession(req)?.user || '';
    /*
     * v3.0.0：管理员可在「用户管理 → 编辑」页代指定用户操作实例（?username=）。
     * 仅管理员生效；普通用户带该参数一律按自身处理（防止越权）。
     */
    const as = String((req.query as { username?: string })?.username || '').trim();
    if (as && currentSession(req)?.role === 'admin' && as !== self) return as;
    return self;
  }

  /** 统一把 service 返回的 {error} 落成 HTTP 响应 */
  private fail(res: Response, error?: string, status = 400): Response {
    return res.status(status).json({ error: error || '请求失败' });
  }

  /**
   * 实例列表：自己创建的 + 被拉入的，按创建时间升序。
   * v3.0.0：每项补 index（1-based 对外序号）—— 对外分享地址 /browse/<用户名>/<序号>/… 用它；
   * 默认实例不在本列表里，序号固定为 0。
   */
  @Get()
  async list(@Req() req: Request, @Res() res: Response) {
    const items = await this.svc.list(this.me(req));
    return res.json(items.map((it, i) => ({ ...it, index: i + 1 })));
  }

  /** 创建实例：{name, note?}；同名（同一创建者下）返回友好错误 */
  @Post()
  @HttpCode(200)
  async create(
    @Body() body: { name?: string; note?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const r = await this.svc.create(this.me(req), String(body?.name || ''), String(body?.note || ''));
    if (r.error) return this.fail(res, r.error);
    return res.json(r.item);
  }

  /** 修改实例（名称 / 备注）—— 仅创建者 */
  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: { name?: string; note?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const r = await this.svc.update(id, this.me(req), {
      name: body?.name === undefined ? undefined : String(body.name),
      note: body?.note === undefined ? undefined : String(body.note),
    });
    if (r.error) return this.fail(res, r.error);
    return res.json(r.item);
  }

  /** 删除实例 —— 仅创建者；实例下仍有文件（含回收站）时 400 拒绝 */
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const r = await this.svc.remove(id, this.me(req));
    if (r.error) return this.fail(res, r.error);
    return res.json({ success: true });
  }

  /**
   * 读取当前邀请码（不生成）—— 仅创建者。
   * v3.0.0（第三轮）：邀请弹窗打开时先 GET 回显，只有点「生成邀请码」才 POST 新建，
   * 避免「打开页面就默默生成一枚码」的副作用。
   */
  @Get(':id/invite')
  async getInvite(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const r = await this.svc.getInvite(id, this.me(req));
    if (r.error) return this.fail(res, r.error);
    return res.json({ inviteCode: r.inviteCode || '' });
  }

  /** 生成（或更新）8 位邀请码 —— 仅创建者 */
  @Post(':id/invite')
  @HttpCode(200)
  async createInvite(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const r = await this.svc.createInvite(id, this.me(req));
    if (r.error) return this.fail(res, r.error);
    return res.json({ inviteCode: r.inviteCode });
  }

  /** 关闭邀请（邀请码置空）—— 仅创建者 */
  @Delete(':id/invite')
  async closeInvite(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const r = await this.svc.closeInvite(id, this.me(req));
    if (r.error) return this.fail(res, r.error);
    return res.json({ success: true });
  }

  /**
   * 加入实例（v3.0.0 双验证）：{ username, code }
   * 用户名必须存在、启用且与当前登录账户一致；邀请码必须有效。
   */
  @Post('join')
  @HttpCode(200)
  async join(@Body() body: { username?: string; code?: string }, @Req() req: Request, @Res() res: Response) {
    const r = await this.svc.join(this.me(req), String(body?.username || ''), String(body?.code || ''));
    if (r.error) return this.fail(res, r.error);
    return res.json(r.item);
  }

  /** 成员列表 —— 仅创建者 */
  @Get(':id/members')
  async members(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const r = await this.svc.members(id, this.me(req));
    if (r.error) return this.fail(res, r.error);
    return res.json(r.list);
  }

  /** 移除成员（创建者自己不可移除）—— 仅创建者 */
  @Delete(':id/members/:username')
  async removeMember(
    @Param('id') id: string,
    @Param('username') username: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const r = await this.svc.removeMember(id, this.me(req), username);
    if (r.error) return this.fail(res, r.error);
    return res.json({ success: true });
  }
}
