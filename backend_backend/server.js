// server.js
require('dotenv').config();
const express = require('express');
const ordersRouter = require('./routes');
const { startCronJobs } = require('./cron');

const app = express();
app.use(express.json());
app.use(ordersRouter);

startCronJobs();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Order system listening on port ${PORT}`));
