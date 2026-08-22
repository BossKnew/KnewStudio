## KnewStudio v0.2.2

v0.2.2 adds image-edit support to prompt polishing and extends the polishing setup to multiple providers.

### ✨ Highlights

* Prompt polishing now supports image editing: the reference image is sent to the polishing model together with the prompt, using a dedicated built-in system prompt; admins can enable it per provider
* Multiple prompt polishing providers can be configured, with only one enabled at a time; the enabled one serves all polishing requests. The admin panel gains a provider list with edit, test, enable/disable, and delete

This release includes database changes (new `supportsImageEdit` and `name` columns); they are applied automatically when the stack starts with `docker compose up -d --build`. Deployment otherwise unchanged.

**Full Changelog:** https://github.com/BossKnew/KnewStudio/compare/v0.2.1...v0.2.2
