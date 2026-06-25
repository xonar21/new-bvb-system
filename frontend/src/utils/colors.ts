export const USER_COLORS = [
  '#4a90d9', '#e67e22', '#2ecc71', '#9b59b6',
  '#e74c3c', '#1abc9c', '#f39c12', '#3498db',
  '#8e44ad', '#16a085', '#d35400', '#27ae60',
]

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null
}

export function rgbToString(r: number, g: number, b: number, alpha: number = 1): string {
  return `rgba(${r},${g},${b},${alpha})`
}

export function lightenColor(hex: string, alpha: number = 0.08): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return `rgba(74,144,217,${alpha})`
  return rgbToString(rgb.r, rgb.g, rgb.b, alpha)
}
