import { fileURLToPath } from 'node:url';

const local = (path) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
const node = JSON.stringify(process.execPath);
const prettier = `${node} ${local('./node_modules/prettier/bin/prettier.cjs')} --write`;
const eslint = `${node} ${local('./apps/api/node_modules/eslint/bin/eslint.js')} --config ${local('./apps/api/eslint.config.mjs')} --fix`;

export default {
  'apps/api/{src,test}/**/*.ts': [prettier, eslint],
  'apps/api/*.{json,mjs}': prettier,
  '{package.json,.prettierrc.json,lint-staged.config.mjs}': prettier,
  '{scripts,.husky}/*.mjs': prettier,
};
