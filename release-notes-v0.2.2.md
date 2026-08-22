## KnewStudio v0.2.2

v0.2.2 为提示词润色带来图片编辑支持，并将润色配置扩展为多供应商。

### ✨ Highlights

* 提示词润色支持整图编辑：参考图随提示词一并发送给润色模型，使用专用内置系统提示词，管理员可按供应商启用
* 提示词润色可配置多个供应商，同时仅启用一个，整站润色使用启用中的配置；后台新增配置列表，支持编辑、测试、启用/停用与删除

有数据库变更（新增 `supportsImageEdit`、`name` 字段），`docker compose up -d --build` 启动时会自动应用迁移，部署方式不变。

**Full Changelog:** https://github.com/BossKnew/KnewStudio/compare/v0.2.1...v0.2.2
