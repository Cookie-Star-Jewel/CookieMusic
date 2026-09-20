import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reverse-engineering artifacts: the live site's own HTML/CSS/JS plus the
    // extraction tooling. Not application code — linting them is pure noise.
    "docs/**",
    ".next2/**",
    // 打包/清理等 Node 脚本（CommonJS require 是刻意为之），非应用代码。
    "scripts/**",
    "electron/**",
    "dist_electron/**",
  ]),
]);

export default eslintConfig;
