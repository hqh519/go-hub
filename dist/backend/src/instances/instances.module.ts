import { Module } from '@nestjs/common';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';

/**
 * 实例模块（多实例方案 v3.0.0）。
 * 实例的创建 / 邀请 / 成员管理；文件与标签的实例隔离在上传与文件列表侧落地。
 */
@Module({
  controllers: [InstancesController],
  providers: [InstancesService],
})
export class InstancesModule {}
