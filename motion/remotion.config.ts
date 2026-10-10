import { Config } from '@remotion/cli/config';

// 클라우드 컨테이너에는 Playwright 크로미움이 있으니 그걸 쓴다. 로컬에서는 이 줄을 지워도 된다.
const PLAYWRIGHT_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require('fs').existsSync(PLAYWRIGHT_SHELL)) Config.setBrowserExecutable(PLAYWRIGHT_SHELL);
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setConcurrency(3);
