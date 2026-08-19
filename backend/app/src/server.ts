import 'dotenv/config';
import { env } from './config/env.config'; // Importing env ensures validation at startup
import { app } from './app';

const PORT = Number(env.PORT) || 4000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running in ${env.NODE_ENV} mode on port ${PORT} (IPv4/IPv6)`);
});
