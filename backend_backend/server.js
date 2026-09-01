// server.js
require('dotenv').config();
const express = require('express');
const ordersRouter = require('./routes');
const { startCronJobs } = require('./cron');
const { applyHardening, authRateLimiter } = require('./auth-and-security');
const authRoutes = require('./auth-routes');
const leaderRoutes = require('./leader-routes');

const app = express();

// Security headers, CORS lockdown, and trust proxy — do this before anything else.
applyHardening(app, { allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:5500' });

app.use(express.json());

// /auth/check-allowed (used by the sign-in page) and /admin/security-logs
app.use(authRoutes);

// /dev/check, /dev/leaders* — restricted to DEV_EMAILS only
app.use(leaderRoutes);

// /orders (POST) requires an authenticated class leader — enforced inside
// routes.js itself, since the GET /orders/:id/ready magic-link route in the
// same router must stay public.
app.use(ordersRouter);

app.get('/', (req, res) => res.send('Order system is running.'));

startCronJobs();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Order system listening on port ${PORT}`));