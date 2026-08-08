export { default as HandoffInspector } from './HandoffInspector';
export { DesignTokensProvider, useDesignTokens } from './DesignTokensProvider';
export { detectTokensFromLiveCss } from './detect/detectFromLiveCss';
export { auditPageForTokenSuggestions } from './detect/auditForSuggestions';
export { fallbackDesignTokens } from './detect/defaultTokens';
export type { ColorToken, SpacingToken, RadiusToken, TypographyToken, DesignSystemCollection, DesignTokens, DesignTokensSource } from './types';

// Node-only helper for build-time detection of tailwind.config.* / tokens.json in a host
// project. Not exported from the root entry point (it imports `node:fs`) — import it
// directly from a setup script: `import { loadStaticDesignTokens } from '@merakimind/design-inspector/detect/loadStaticConfig.node'`.
