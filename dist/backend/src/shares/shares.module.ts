import { Module } from '@nestjs/common';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

/**
 * 对外分享模块（v3.0.0）。
 *
 * 目录 / 标签的对外分享地址（/browse/<用户名>/<实例序号>/cate|tag/<目标>）与公开浏览接口。
 * 分享行由 SharesService 直接读写 prisma，不依赖其它可注入服务 ——
 * 这样注册进 AppModule 时不需要改动任何已有 provider。
 */
@Module({
  controllers: [SharesController],
  providers: [SharesService],
})
export class SharesModule {}
