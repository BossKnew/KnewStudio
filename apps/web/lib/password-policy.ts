export type UserRole = 'USER' | 'ADMIN';

export function passwordRequirement(role: UserRole) {
  return role === 'ADMIN'
    ? '管理员密码至少需要 15 位'
    : '至少 8 位，并包含大写字母、小写字母、数字和特殊符号';
}

export function passwordError(password: string, role: UserRole) {
  if (password.length > 128) return '密码强度不够：密码不能超过 128 位';
  if (role === 'ADMIN') return password.length < 15 ? '密码强度不够：管理员密码至少需要 15 位' : '';
  return password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)
    ? '密码强度不够：密码至少需要 8 位，并包含大写字母、小写字母、数字和特殊符号'
    : '';
}
