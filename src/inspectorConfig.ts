/**
 * Configuration owned by the inspector tool itself — its own panel chrome, device preview
 * presets, and accessibility thresholds. Unlike src/types.ts (the host project's design
 * system), none of this should come from the consuming project.
 */

export type ResponsiveBreakpointId = 'desktop' | 'tablet' | 'mobile';

export const inspectorVisualTokens = {
  canvas: '#F6F8FF',
  panel: 'rgba(252, 253, 255, 0.94)',
  surface: 'rgba(255, 255, 255, 0.82)',
  surfaceStrong: '#FFFFFF',
  border: 'rgba(157, 170, 207, 0.26)',
  borderStrong: 'rgba(124, 60, 255, 0.42)',
  text: '#172033',
  muted: '#71809C',
  faint: '#9AA6BC',
  accent: '#7C3CFF',
  accentSoft: '#F1E9FF',
  selected: '#2F74EE',
  selectedSoft: '#ECF5FF',
  success: '#10B981',
} as const;

export const inspectorResponsiveBreakpoints = [
  { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
] as const;

export type DeviceKind = ResponsiveBreakpointId;

/** Real device sizes used by the full-screen preview overlay. */
export const inspectorDevicePresets = [
  { id: 'iphone-se', kind: 'mobile', label: 'iPhone SE', width: 375, height: 667, radius: 34, chrome: 'phone' },
  { id: 'iphone-15', kind: 'mobile', label: 'iPhone 15', width: 390, height: 844, radius: 46, chrome: 'phone' },
  { id: 'pixel-8-pro', kind: 'mobile', label: 'Pixel 8 Pro', width: 412, height: 892, radius: 42, chrome: 'phone' },
  { id: 'ipad-mini', kind: 'tablet', label: 'iPad mini', width: 768, height: 1024, radius: 28, chrome: 'tablet' },
  { id: 'ipad-pro', kind: 'tablet', label: 'iPad Pro 11"', width: 834, height: 1194, radius: 28, chrome: 'tablet' },
  { id: 'surface', kind: 'tablet', label: 'Surface Pro', width: 912, height: 1368, radius: 16, chrome: 'tablet' },
  { id: 'laptop', kind: 'desktop', label: 'Laptop', width: 1280, height: 800, radius: 10, chrome: 'browser' },
  { id: 'desktop', kind: 'desktop', label: 'Desktop', width: 1440, height: 900, radius: 10, chrome: 'browser' },
] as const;

export type DevicePresetId = (typeof inspectorDevicePresets)[number]['id'];

export const defaultDeviceForKind: Record<DeviceKind, DevicePresetId> = {
  mobile: 'iphone-15',
  tablet: 'ipad-mini',
  desktop: 'laptop',
};

export const inspectorAccessibilityThresholds = {
  minimumContrast: 4.5,
  minimumLargeTextContrast: 3,
  largeTextSize: 18,
  minimumReadableText: 14,
  minimumTouchTarget: 44,
} as const;

export type CustomDesignToken = {
  id: string;
  name: string;
  category: 'color' | 'spacing' | 'radius' | 'typography';
  property: string;
  value: string;
  createdAt: string;
};

export const CUSTOM_DESIGN_TOKENS_STORAGE_KEY = 'design-inspector-custom-tokens';
