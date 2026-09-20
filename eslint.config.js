// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // The three patterns that silently turn the React Compiler off for a
    // component (app.json experiments.reactCompiler is on). Each one is a
    // real, measured cost on device, so they fail lint instead of hiding.
    // A deliberate bailout is marked with 'use no memo' in the component.
    // `npm run compiler:scan` is the matching end-to-end check.
    rules: {
      'react-hooks/todo': 'error', // try/finally and other syntax the compiler skips
      'react-hooks/unsupported-syntax': 'error',
      'react-hooks/rule-suppression': 'error', // any eslint-disable react-hooks/* skips the component
    },
  },
]);
