# Changelog

All notable changes to KnewStudio are documented here.

## [Unreleased]

- Prompt polishing supports image editing: admins can enable it per model, and image-edit reference images are sent to the polishing model as part of the request.
- Admin can configure multiple prompt polishing providers; only one can be enabled at a time, and the enabled one serves all polishing requests.

## [0.2.0] - 2026-08-21

- Video generation: text-to-video and image-to-video with aspect ratio, duration, and optional resolution.
- Provider adapters for OpenAI Videos, Seedance (Volcengine Ark), and Wan (DashScope). Gateways that speak the OpenAI Videos protocol can reuse that adapter.
- Studio switch between image and video; playback, download, regenerate, and retry.
- Admin can choose an adapter, set model parameters, and configure a per-group sliding-window video quota in seconds.
- Image quotas stay counted in images. Video jobs consume seconds, not image counts.
- Prompt polishing supports text-to-video. Video outputs are stored as MP4 with first-frame thumbnails.
- Video jobs honor configured generation and poll timeouts instead of the previous 60s/120s HTTP caps.
- Connection failures (TCP/TLS) are reported separately from generation timeouts.
- Wan should use `https://dashscope.aliyuncs.com/api/v1`. Workspace hostnames (`*.maas.aliyuncs.com`) can fail TLS on some networks.

## [0.1.3] - 2026-08-20

- Share assets with user groups; members can preview, download, and use them as edit or inpaint references.
- Shared files stay with the owner. Recipients do not get a copy or extra storage quota. Prompts and notes stay private.
- Per-group sliding-window generation quotas (for example 5 images / 5h). Retries count. Empty settings mean no limit.
- Sidebar usage for storage and remaining group allowances; admin usage query by UTC date range.
- Conversation titles: first 10 characters for Chinese prompts, first 4 words for English prompts.
- Prompt polishing asks for confirmation before calling the model and before replacing the prompt.
- Admin-configurable Chinese and English labels for size and quality values.

## [0.1.2] - 2026-08-20

- AI prompt polishing for text-to-image, with preview and confirmation before apply.
- Admin settings for the polishing LLM (provider, model, endpoint, encrypted API key, timeout, system prompt, connection test).
- Polishing requests are rate-limited, timed out, and fail without replacing the original prompt.

## [0.1.1] - 2026-08-19

- Multi-reference editing and inpainting, mixing local files with history and asset-library images.
- Persistent prompt history and favorites.
- Regenerate restores prompt, model, size, quality, count, and references; inpainting requires a new mask.
- Download all images from a conversation, or selected images from the current asset-library page.

## [0.1.0] - 2026-08-18

- First release: self-hosted image generation with OpenAI Images-compatible providers.
- Text-to-image, reference-image editing, masked inpainting, conversations, and an asset library.
- User approval, groups, model access control, administrator MFA, and encrypted provider keys.
- Chinese and English UI. Video generation is reserved in the codebase but not exposed.
