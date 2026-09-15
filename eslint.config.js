import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', 'lib/**', 'res/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // Debug logging should be deliberate, not left behind.
            'no-console': 'warn',
            eqeqeq: ['error', 'always'],
        },
    },
    {
        // Build tooling: plain JS run by Node, outside the TS program.
        files: ['scripts/**/*.mjs', 'eslint.config.js'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
            },
        },
        rules: {
            // A build script reporting progress on stdout is the point.
            'no-console': 'off',
        },
    },
);
