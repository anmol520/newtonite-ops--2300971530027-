import { createApp } from './app';
import { config } from './config';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Backend server listening on port ${config.port}`);
});

export default server;
