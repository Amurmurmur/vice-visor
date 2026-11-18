import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
    developmentIndicator: 'overlay',
  },
  manifest: {
    name: 'Vice Visor: GTA 6 Spoiler Shield',
    short_name: 'Vice Visor',
    description:
      'Hides GTA 6 spoilers on YouTube, Reddit, X, Facebook and the rest of the web. Be patient, dude.',
    permissions: ['storage'],
    action: {
      default_title: 'Vice Visor',
    },
  },
});
