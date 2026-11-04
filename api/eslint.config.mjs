import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'eslint.config.mjs'] },
  js.configs.recommended,
  // Règles qui utilisent les types : promesses non attendues, valeurs « any »…
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Domaine pur (CLAUDE.md, règle 1) : ni NestJS, ni la base, ni le reste de l'application.
  // Les fichiers du domaine n'importent que d'autres fichiers du domaine.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'Le domaine est pur : pas de NestJS (règle 1).' },
            { group: ['pg'], message: 'Le domaine est pur : pas d’accès à la base (règle 1).' },
            {
              group: ['../*'],
              message: 'Le domaine n’importe que des fichiers du domaine (règle 1).',
            },
          ],
        },
      ],
    },
  },
  // En dernier : désactive les règles de mise en forme, laissées à Prettier.
  prettier,
);
