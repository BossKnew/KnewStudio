export function formatStorageBytes(value: string | number | bigint): string {
  let bytes: bigint;
  try {
    bytes = BigInt(value);
  } catch {
    bytes = 0n;
  }
  if (bytes < 0n) bytes = 0n;
  if (bytes < 1024n) return `${bytes} B`;

  const kilobyte = 1024n;
  const megabyte = kilobyte * 1024n;
  const gigabyte = megabyte * 1024n;
  const [divisor, unit] = bytes >= gigabyte
    ? [gigabyte, 'GB'] as const
    : bytes >= megabyte
      ? [megabyte, 'MB'] as const
      : [kilobyte, 'KB'] as const;
  const hundredths = (bytes * 100n + divisor / 2n) / divisor;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')} ${unit}`;
}
