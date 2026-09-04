// server.js
require('dotenv').config();
const express = require('express');
const ordersRouter = require('./routes');
const { startCronJobs } = require('./cron');
const { applyHardening, authRateLimiter } = require('./auth-and-security');
const authRoutes = require('./auth-routes');
const leaderRoutes = require('./leader-routes');
const uploadRoutes = require('./upload-routes');
const orderRoutes = require('./order-routes');

const app = express();

// Security headers, CORS lockdown, and trust proxy — do this before anything else.
//applyHardening(app, { allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:5500' });
const allowedOrigins = [
  'https://bigchungusssss.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json());

// /auth/check-allowed (used by the sign-in page) and /admin/security-logs
app.use(authRoutes);
// /dev/check, /dev/leaders* — restricted to DEV_EMAILS only
app.use(leaderRoutes);
app.use(uploadRoutes); app.use(orderRoutes);
// /orders (POST) requires an authenticated class leader — enforced inside
// routes.js itself, since the GET /orders/:id/ready magic-link route in the
// same router must stay public.
app.use(ordersRouter);

app.get('/', (req, res) => res.send('Order system is running.'));

startCronJobs();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Order system listening on port ${PORT}`));