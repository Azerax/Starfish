import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const STARFISH = ['@starfish/governance-core', '@starfish/governance-hooks', '@starfish/governance-overlay', '@starfish/desktop'];
const starfishAlias = {
  '@starfish/governance-core': resolve(__dirname, '../../governance-core/src/index.ts'),
  '@starfish/governance-hooks': resolve(__dirname, '../../governance-hooks/src/index.ts'),
  '@starfish/governance-overlay': resolve(__dirname, '../../governance-overlay/src/index.ts'),
  '@starfish/desktop': resolve(__dirname, '../src/index.ts'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: STARFISH })],
    resolve: { alias: starfishAlias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: STARFISH })],
    resolve: { alias: starfishAlias },
    build: { rollupOptions: { input: {
      index: resolve(__dirname, 'src/preload/index.ts'),
      splash: resolve(__dirname, 'src/preload/splash.ts'),
    } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: {
      index: resolve(__dirname, 'src/renderer/index.html'),
      splash: resolve(__dirname, 'src/renderer/splash.html'),
    } } },
    plugins: [react()],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  },
});
