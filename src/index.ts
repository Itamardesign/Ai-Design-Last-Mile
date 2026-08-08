export { default as HandoffInspector, DESIGN_MODE_PARAM, type HandoffInspectorProps } from './HandoffInspector.js';
export { DesignTokensProvider, useDesignTokens } from './DesignTokensProvider.js';
export { detectTokensFromLiveCss } from './detect/detectFromLiveCss.js';
export { auditPageForTokenSuggestions } from './detect/auditForSuggestions.js';
export { fallbackDesignTokens } from './detect/defaultTokens.js';
export type { ColorToken, SpacingToken, RadiusToken, TypographyToken, DesignSystemCollection, DesignTokens, DesignTokensSource } from './types.js';

// Node-only helper for build-time detection of tailwind.config.* / tokens.json in a host
// project. Not exported from the root entry point (it imports `node:fs`) — import it
// directly from a setup script: `import { loadStaticDesignTokens } from '@merakimind/design-inspector/detect/loadStaticConfig.node'`.
