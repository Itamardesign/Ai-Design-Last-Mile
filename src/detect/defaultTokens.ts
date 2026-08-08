import type { DesignTokens } from '../types.js';

/** Last-resort tokens used only when nothing was provided, statically detected, or found live in the page's CSS. */
export const fallbackDesignTokens: DesignTokens = {
  collections: [
    {
      id: 'default',
      name: 'Default',
      colors: [
        { label: 'Ink', value: '#1A1A1A', usage: 'Primary text' },
        { label: 'Muted', value: '#6B7280', usage: 'Secondary text' },
        { label: 'Accent', value: '#3B82F6', usage: 'Primary actions and links' },
        { label: 'Surface', value: '#FFFFFF', usage: 'Cards and panels' },
        { label: 'Canvas', value: '#F9FAFB', usage: 'Page background' },
        { label: 'Border', value: '#E5E7EB', usage: 'Dividers and outlines' },
      ],
      typography: [
        { label: 'Heading', sample: 'A clear heading', css: 'font-size: 32px; font-weight: 700; line-height: 1.2;' },
        { label: 'Body', sample: 'Readable body copy for everyday content.', css: 'font-size: 16px; font-weight: 400; line-height: 1.5;' },
        { label: 'Label', sample: 'SECTION LABEL', css: 'font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;' },
      ],
    },
  ],
  spacing: [
    { name: 'space.0', value: '0px' },
    { name: 'space.1', value: '4px' },
    { name: 'space.2', value: '8px' },
    { name: 'space.3', value: '12px' },
    { name: 'space.4', value: '16px' },
    { name: 'space.5', value: '24px' },
    { name: 'space.6', value: '32px' },
    { name: 'space.7', value: '40px' },
    { name: 'space.8', value: '48px' },
    { name: 'space.9', value: '64px' },
  ],
  radius: [
    { name: 'radius.none', value: '0px' },
    { name: 'radius.sm', value: '4px' },
    { name: 'radius.md', value: '8px' },
    { name: 'radius.lg', value: '12px' },
    { name: 'radius.xl', value: '16px' },
    { name: 'radius.round', value: '999px' },
  ],
};
