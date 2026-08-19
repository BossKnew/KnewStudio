# Changelog

All notable changes to KnewStudio are documented here.

## [0.1.1] - 2026-08-19

### Added

- 支持整图编辑和局部重绘的多参考图工作流，允许按顺序混合选择本地图片、历史任务图片和资产库图片。
- 新增服务端持久化的 Prompt 历史与收藏，支持历史/收藏分页浏览、收藏切换和用户隔离。
- 历史任务新增“再次生成”，可恢复 Prompt、模型、尺寸、质量、数量和参考图；局部重绘会提示重新绘制遮罩，且不会自动提交任务。
- 支持下载当前会话的全部生成图片，以及资产库当前可见页的多选逐张下载、进度反馈和失败提示。
- 管理后台支持配置模型单次最大参考图数量。

### Backend

- 新增 `PromptEntry` Prisma 模型及迁移，自动合并相同 Prompt 并记录使用次数、收藏状态和最近使用时间。
- 新增 Prompt 查询/收藏、生成参数复用和会话输出资产接口。
- 增加参考图去重、数量、模式和模型能力校验，并兼容缺少旧版参考图参数的 Worker 任务。
- 会话输出资产接口仅返回当前用户未删除的生成结果，并生成安全下载文件名。

### Validation

- API 33 个测试套件、170 个测试通过。
- Web 12 个测试通过。
- TypeScript lint、API/Web build 和 Prisma Client 生成通过。

### Migration

部署 `v0.1.1` 前请执行：

```bash
npm run db:migrate
```
