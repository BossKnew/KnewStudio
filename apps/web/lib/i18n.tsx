import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type Locale = 'zh' | 'en';
type TranslationParams = Record<string, string | number>;

const english: Record<string, string> = {
  '页面不存在': 'Page not found',
  '加载中…': 'Loading…',
  '工作区导航': 'Workspace navigation',
  '后台管理导航': 'Admin navigation',
  '语言': 'Language',
  '新创作': 'New creation',
  '资产库': 'Asset library',
  '最近会话': 'Recent conversations',
  '还没有会话': 'No conversations yet',
  '会话名称': 'Conversation name',
  '保存重命名': 'Save renamed conversation',
  '取消重命名': 'Cancel rename',
  '重命名': 'Rename',
  '删除': 'Delete',
  '加载更多会话': 'Load more conversations',
  '个人信息': 'Profile',
  '管理后台': 'Admin console',
  '设置': 'Settings',
  '退出登录': 'Log out',
  '想创作什么？': 'What do you want to create?',
  '输入图片描述或编辑要求': 'Describe an image or an edit',
  'Prompt 历史': 'Prompt history',
  'Prompt 类型': 'Prompt type',
  '历史': 'History',
  '收藏': 'Favorites',
  '取消收藏': 'Remove from favorites',
  '收藏 Prompt': 'Favorite prompt',
  '还没有收藏的 Prompt': 'No favorite prompts yet',
  '还没有 Prompt 历史': 'No prompt history yet',
  '加载更多': 'Load more',
  '已选参考图': 'Selected reference image',
  '已选历史参考图': 'Selected historical reference image',
  '已保存图片': 'Saved image',
  '本地图片': 'Local image',
  '参考图列表': 'Reference image list',
  '参考图数量': 'Reference images',
  '添加参考图': 'Add reference images',
  '可多选': 'multiple selection allowed',
  '当前参考图数量': 'Current reference image count',
  '已超过模型上限': 'exceeds the model limit',
  '已达到该模型的参考图上限': 'This model has reached its reference image limit',
  '仅添加了前': 'Only the first',
  '张参考图，已达到模型上限': 'reference images were added; the model limit was reached',
  '历史任务的编辑模式已不再受当前模型支持，请重新选择模型。': 'The historical edit mode is no longer supported by the current model. Select another model.',
  '历史任务使用的模型': 'The model used by the historical task',
  '已不可用，请重新选择模型。': 'is unavailable. Select another model.',
  '参考图已恢复；局部重绘需要重新绘制遮罩。': 'The reference images were restored; inpainting requires a new mask.',
  '请切换到整图编辑或局部重绘': 'Switch to image edit or inpainting',
  '将作为本次编辑的原图': 'Will be used as the source image',
  '移除参考图': 'Remove reference image',
  '更换原图（可选）': 'Replace source image (optional)',
  '原图': 'Source image',
  '选择模型': 'Select a model',
  '文生图': 'Text to image',
  '整图编辑': 'Image edit',
  '局部重绘': 'Inpainting',
  '正在提交/生成…': 'Submitting/generating…',
  '开始生成': 'Generate',
  '选择尺寸': 'Select size',
  '选择质量': 'Select quality',
  '生成数量': 'Number of images',
  '生成设置选项': 'Generation settings',
  '未选择': 'Not selected',
  '涂抹需要重绘的区域': 'Paint the area to redraw',
  '青色高亮区域将被替换，未涂抹区域会尽量保留。': 'The cyan area will be replaced; unpainted areas will be preserved where possible.',
  '遮罩已就绪': 'Mask ready',
  '局部重绘遮罩编辑器': 'Inpainting mask editor',
  '局部重绘原图': 'Inpainting source image',
  '原图加载失败，请重新选择参考图或上传本地图片。': 'The source image failed to load. Select a reference image or upload a local image again.',
  '画笔大小': 'Brush size',
  '清空': 'Clear',
  '重新使用此遮罩': 'Use this mask again',
  '使用此遮罩': 'Use this mask',
  '任务状态已更新，但摘要同步失败。请刷新页面。': 'The job status was updated, but the summary could not sync. Refresh the page.',
  '会话已删除，但资产列表同步失败。请刷新页面。': 'The conversation was deleted, but the asset list could not sync. Refresh the page.',
  '删除会话': 'Delete conversation',
  '加载更早记录': 'Load older records',
  '正在重试…': 'Retrying…',
  '重试': 'Retry',
  '再次生成': 'Generate again',
  '正在恢复…': 'Restoring…',
  '放大查看生成图片': 'View generated image larger',
  '放大查看图片': 'View image larger',
  '放大': 'Zoom',
  '设为参考图': 'Use as reference',
  '已设为参考图': 'Reference selected',
  '已选为参考图': 'Selected as reference',
  '已在资产库中删除': 'Deleted from asset library',
  '资产库还是空的': 'Your asset library is empty',
  '集中查看和管理你的上传图片与生成结果。': 'View and manage uploaded images and generated results in one place.',
  '上传图片或完成一次创作后，内容会显示在这里。': 'Upload an image or complete a creation and it will appear here.',
  '开始创作': 'Start creating',
  '输入资产备注': 'Enter an asset note',
  '编辑备注': 'Edit note',
  '添加备注': 'Add note',
  '删除资产': 'Delete asset',
  '生成资产': 'Generated asset',
  '上传资产': 'Uploaded asset',
  '生成': 'Generated',
  '上传': 'Uploaded',
  '类型': 'Type',
  '生成提示词': 'Generation prompt',
  '无生成提示词': 'No generation prompt',
  '备注': 'Note',
  '暂无备注': 'No note',
  '设为下一张参考图': 'Use as next reference image',
  '关闭图片查看器': 'Close image viewer',
  '关闭': 'Close',
  '名字不能为空': 'Name cannot be empty',
  '登录用户名：': 'Login username: ',
  '名字': 'Name',
  '保存中…': 'Saving…',
  '当前密码': 'Current password',
  '原密码': 'Current password',
  '新密码': 'New password',
  '再次输入新密码': 'Re-enter new password',
  '两次输入的新密码不一致': 'The new passwords do not match',
  '请先修改初始密码': 'Change your initial password',
  '修改并重新登录': 'Change password and log in again',
  '修改密码': 'Change password',
  '修改中…': 'Changing…',
  '安全': 'Security',
  '管理你的账号安全选项。': 'Manage your account security options.',
  '管理密码与双重验证。': 'Manage your password and two-factor authentication.',
  '双重验证': 'Two-factor authentication',
  '当前状态：': 'Current status: ',
  '已启用': 'Enabled',
  '必须启用': 'Required',
  '未启用': 'Not enabled',
  '使用 Authenticator 动态码，为账号增加一层保护。': 'Use Authenticator codes to add another layer of protection.',
  '管理双重验证': 'Manage two-factor authentication',
  '启用双重验证': 'Enable two-factor authentication',
  '更换 Authenticator 设备': 'Change Authenticator device',
  '启用 Authenticator': 'Enable Authenticator',
  '重新生成恢复码': 'Regenerate recovery codes',
  '关闭双重验证': 'Disable two-factor authentication',
  '更换设备前需要验证当前密码和现有验证因子。': 'Verify your current password and factor before changing devices.',
  '启用前请重新输入当前密码。': 'Re-enter your current password before enabling it.',
  '当前 6 位动态码': 'Current 6-digit code',
  '恢复码': 'Recovery code',
  '改用恢复码': 'Use a recovery code',
  '改用动态码': 'Use an authenticator code',
  '处理中…': 'Processing…',
  '继续': 'Continue',
  '返回': 'Back',
  '扫描二维码并输入新设备生成的动态码。': 'Scan the QR code and enter the code generated by the new device.',
  'Authenticator 绑定二维码': 'Authenticator setup QR code',
  '手工输入密钥': 'Enter key manually',
  '绑定中…': 'Setting up…',
  '确认新设备': 'Confirm new device',
  '原有恢复码将立即全部失效。': 'All existing recovery codes will become invalid immediately.',
  '生成新恢复码': 'Generate new recovery codes',
  '关闭后账号将只受密码保护，并会退出所有设备。': 'After disabling, the account will only be protected by its password and all devices will be signed out.',
  '确认关闭': 'Confirm disable',
  '保存新的恢复码': 'Save your new recovery codes',
  '每条只能使用一次，关闭后不会再次显示。': 'Each code can be used once and will not be shown again after closing.',
  '我已安全保存': 'I saved them securely',
  '注册后需要管理员激活': 'Registration requires admin activation',
  '登录 AI 媒体工作台': 'Log in to the AI media workspace',
  '注册': 'Register',
  '用户名': 'Username',
  '设置密码': 'Set a password',
  '密码': 'Password',
  '记住登录状态（不会保存密码）': 'Remember me (your password is not saved)',
  '提交注册': 'Register',
  '登录': 'Log in',
  '注册新账号': 'Create an account',
  '返回登录': 'Back to login',
  '输入一条尚未使用的恢复码。': 'Enter an unused recovery code.',
  '输入 Authenticator App 中当前的 6 位动态码。': 'Enter the current 6-digit code from your Authenticator app.',
  '验证中…': 'Verifying…',
  '验证并登录': 'Verify and log in',
  '使用动态码': 'Use an authenticator code',
  '使用恢复码': 'Use a recovery code',
  '返回账号登录': 'Back to account login',
  '使用 Authenticator App 扫描二维码，然后输入生成的 6 位代码。': 'Scan the QR code with your Authenticator app, then enter the generated 6-digit code.',
  '用于绑定': 'For setup with',
  '的二维码': ' QR code',
  '无法扫码时手工输入': 'Enter manually if you cannot scan',
  '确认绑定': 'Confirm setup',
  '保存恢复码': 'Save recovery codes',
  '手机不可用时可用其中一条登录。每条只能使用一次，关闭此页面后不会再次显示。': 'Use one to log in if your phone is unavailable. Each code works once and will not be shown again after closing this page.',
  '管理你的管理员账号安全选项。': 'Manage your administrator account security options.',
  '管理 KnewStudio 的访问权限与图片生成能力。': 'Manage KnewStudio access and image-generation capabilities.',
  '用户管理': 'User management',
  '用户组': 'User groups',
  '添加供应商': 'Add provider',
  '添加模型': 'Add model',
  '返回工作台': 'Back to workspace',
  '开放注册': 'Open registration',
  '允许新用户自行注册；新账号仍需管理员激活。': 'Allow new users to register; new accounts still require admin activation.',
  '普通用户记住登录有效期': 'Standard-user remember-me duration',
  '填写整数加单位：h 小时、d 天、w 星期、m 月（30 天）。范围 1h–12m；管理员固定为 1d。': 'Enter an integer and unit: h hours, d days, w weeks, m months (30 days). Range: 1h–12m; admins are fixed at 1d.',
  '例如 7d': 'e.g. 7d',
  '用户': 'Users',
  '统计': 'Stats',
  '操作': 'Actions',
  '全部模型': 'All models',
  '未分组': 'Unassigned',
  '任务': 'jobs',
  '文件': 'files',
  '激活': 'Activate',
  '禁用': 'Disable',
  '重置密码': 'Reset password',
  '重置 MFA': 'Reset MFA',
  '加载更多用户': 'Load more users',
  '编辑用户组': 'Edit user group',
  '新建用户组': 'New user group',
  '用户组名称': 'User group name',
  '说明（可选）': 'Description (optional)',
  '保存修改': 'Save changes',
  '创建用户组': 'Create user group',
  '已有用户组': 'Existing user groups',
  '还没有用户组。': 'No user groups yet.',
  '无说明': 'No description',
  '位用户': ' users',
  '个模型': ' models',
  '编辑': 'Edit',
  '分配用户': 'Assign users',
  '用户可以同时属于多个组。修改后立即生效；管理员默认拥有全部模型权限。': 'Users can belong to multiple groups. Changes take effect immediately; admins always have access to all models.',
  '管理员无需分组': 'Admins do not need a group',
  '请先创建用户组': 'Create a user group first',
  '编辑供应商': 'Edit provider',
  '名称': 'Name',
  'Base URL，例如 https://api.openai.com/v1': 'Base URL, e.g. https://api.openai.com/v1',
  'API Key（留空表示不修改）': 'API key (leave blank to keep unchanged)',
  'API Key': 'API key',
  '生成超时（秒）': 'Generation timeout (seconds)',
  '保存供应商': 'Save provider',
  '已有供应商': 'Existing providers',
  '还没有供应商。': 'No providers yet.',
  '测试中…': 'Testing…',
  '测试成功': 'Test succeeded',
  '测试失败': 'Test failed',
  '测试': 'Test',
  '编辑模型': 'Edit model',
  '选择供应商': 'Select a provider',
  '用户看到的名称': 'Name shown to users',
  '真实模型 ID': 'Upstream model ID',
  '尺寸，逗号分隔；留空默认 auto': 'Sizes, comma-separated; blank defaults to auto',
  '质量，逗号分隔': 'Qualities, comma-separated',
  '单次生成数量上限': 'Maximum images per generation',
  '单次最多参考图数量': 'Maximum reference images per generation',
  '可用用户组': 'Available user groups',
  '不勾选表示模型为私有，仅管理员可用；管理员始终拥有访问权限。': 'No selection makes the model private and admin-only; admins always have access.',
  '尚未创建用户组': 'No user groups created yet',
  '已有模型': 'Existing models',
  '还没有模型。': 'No models yet.',
  '仅管理员（私有）': 'Admins only (private)',
  '启用': 'Enabled',
  '停用': 'Disabled',
  '保存失败：': 'Save failed: ',
  '供应商测试失败': 'Provider test failed',
  '供应商连接测试成功': 'Provider connection test succeeded',
  '保存成功': 'Saved successfully',
  '供应商修改已保存': 'Provider changes saved',
  '供应商保存成功': 'Provider saved',
  '模型修改已保存': 'Model changes saved',
  '模型保存成功': 'Model saved',
  '用户组修改已保存': 'User group changes saved',
  '用户组创建成功': 'User group created',
  '密码已重置': 'Password reset',
  'MFA 已重置，该用户的会话已撤销': 'MFA reset; the user sessions were revoked',
  '保存': 'Save',
  '保存模型': 'Save model',
  '测试中': 'Testing',
  '待绑定': 'Setup pending',
  '该会话、其中生成的图片、本会话独占的上传原图以及失败任务保留的遮罩都会被永久删除，此操作无法撤销。仍被其他会话使用的上传原图会保留。': 'This conversation, its generated images, source uploads used only by it, and masks kept by failed jobs will be permanently deleted. This cannot be undone. Source uploads used by other conversations will be kept.',
  '及其全部模型？历史生成记录会保留。': 'and all of its models? Historical generation records will be kept.',
  '及其全部内容？': 'and all of its content?',
  '加载更多资产': 'Load more assets',
  '下载本会话图片': 'Download session images',
  '下载所选图片': 'Download selected images',
  '下载中…': 'Downloading…',
  '下载已开始': 'Downloads started',
  '已完成部分下载': 'Some downloads completed',
  '失败': 'failed',
  '当前会话没有可下载的生成图片': 'This session has no generated images to download',
  '全选当前页': 'Select current page',
  '取消全选': 'Clear selection',
  '已选择': 'Selected',
  '选择图片下载': 'Select image for download',
  '请先选择要下载的图片': 'Select images to download first',
  '历史生成记录会保留。': 'Historical generation records will be kept.',
  '请先绘制并使用遮罩': 'Draw and use a mask first',
  '请选择或上传一张原图': 'Select or upload a source image',
  '取消': 'Cancel',
  '权限': 'Access',
  '确定删除这项资产吗？此操作无法撤销。': 'Delete this asset? This cannot be undone.',
  '确认删除': 'Confirm delete',
  '删除用户组': 'Delete user group',
  '上传图片': 'Uploaded image',
  '生成图片': 'Generated image',
  '输入你自己的新 6 位动态码，以重置用户的 MFA': 'Enter your own new 6-digit code to reset the user MFA',
  '为用户设置新密码': 'Set a new password for',
  '项资产': 'assets',
  '移除': 'Remove',
  '永久删除供应商': 'Permanently delete provider',
  '永久删除模型': 'Permanently delete model',
  '永久删除用户': 'Permanently delete user',
  '正在删除…': 'Deleting…',
  '状态': 'Status',
  '管理员密码至少需要 15 位': 'Admin passwords must be at least 15 characters',
  '至少 8 位，并包含大写字母、小写字母、数字和特殊符号': 'At least 8 characters with uppercase, lowercase, a number, and a special character',
  '密码强度不够：密码不能超过 128 位': 'Password is too weak: it cannot exceed 128 characters',
  '密码强度不够：管理员密码至少需要 15 位': 'Password is too weak: admin passwords must be at least 15 characters',
  '密码强度不够：密码至少需要 8 位，并包含大写字母、小写字母、数字和特殊符号': 'Password is too weak: use at least 8 characters with uppercase, lowercase, a number, and a special character',
  '注册成功，等待管理员激活': 'Registration successful. Waiting for admin activation',
  '请求失败：': 'Request failed: ',
  '用户名或密码错误': 'Invalid username or password',
  '请先登录': 'Please log in first',
  '登录已失效': 'Your session has expired',
  '账号不可用': 'Account unavailable',
  'CSRF 校验失败': 'CSRF validation failed',
  '必须先修改初始密码': 'You must change your initial password first',
  '必须完成双重验证': 'You must complete two-factor authentication setup',
  '权限不足': 'Insufficient permissions',
  '用户名格式不正确': 'Invalid username format',
  '用户名仅支持 3-32 位小写字母、数字和下划线': 'Usernames must be 3–32 lowercase letters, numbers, or underscores',
  '用户名已存在': 'Username already exists',
  '管理员暂未开放注册': 'Registration is not currently open',
  '注册失败': 'Registration failed',
  '当前密码错误': 'Current password is incorrect',
  '动态码或恢复码无效': 'Invalid authenticator or recovery code',
  '动态码无效': 'Invalid authenticator code',
  '恢复码已使用': 'Recovery code already used',
  '验证请求已失效': 'Verification request expired',
  '动态码已使用': 'Authenticator code already used',
  '新密码不能与当前密码相同': 'The new password must differ from the current password',
  '请选择图片': 'Please select an image',
  '备注不能超过 1000 个字符': 'Notes cannot exceed 1,000 characters',
  '模型不可用': 'Model unavailable',
  '模型不支持文生图': 'This model does not support text-to-image generation',
  '模型不支持图片编辑': 'This model does not support image editing',
  '模型不支持局部重绘': 'This model does not support inpainting',
  '尺寸或质量不受该模型支持': 'The selected size or quality is not supported by this model',
  '引用图片不存在': 'Referenced image not found',
  '会话不存在': 'Conversation not found',
};

function interpolate(value: string, params?: TranslationParams) {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

const LOCALE_COOKIE = 'knewstudio.locale';

export function getCookieLocale(): Locale | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie.split('; ').find((item) => item.startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie?.slice(`${LOCALE_COOKIE}=`.length);
  return value === 'zh' || value === 'en' ? value : null;
}

export function translateMessage(message: string, locale: Locale) {
  return locale === 'en' ? english[message] ?? message : message;
}

export function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  return getCookieLocale() ?? (window.navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
}

type I18nContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: string, params?: TranslationParams) => string };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Max-Age=31536000; Path=/; SameSite=Lax`;
  }, []);
  const t = useCallback((key: string, params?: TranslationParams) => interpolate(locale === 'en' ? english[key] ?? key : key, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function choose(next: Locale) {
    setLocale(next);
    setOpen(false);
  }

  return <div className="language-switcher" ref={rootRef}>
    <button className="language-switcher-trigger" type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="menu" aria-expanded={open} aria-label={t('语言')} title={t('语言')}>
      <svg className="language-switcher-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
      </svg>
      <span>{locale === 'zh' ? '中文' : 'English'}</span><span className={`language-switcher-chevron ${open ? 'open' : ''}`} aria-hidden="true">⌄</span>
    </button>
    {open && <div className="language-switcher-menu" role="menu" aria-label={t('语言')}>
      <button className={`language-option ${locale === 'zh' ? 'active' : ''}`} type="button" role="menuitemradio" aria-checked={locale === 'zh'} onClick={() => choose('zh')}><span>中文</span>{locale === 'zh' && <span aria-hidden="true">✓</span>}</button>
      <button className={`language-option ${locale === 'en' ? 'active' : ''}`} type="button" role="menuitemradio" aria-checked={locale === 'en'} onClick={() => choose('en')}><span>English</span>{locale === 'en' && <span aria-hidden="true">✓</span>}</button>
    </div>}
  </div>;
}
