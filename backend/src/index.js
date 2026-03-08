require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import routes
const dealsRoutes = require('./routes/deals');
const surveyRoutes = require('./routes/survey');
const documentsRoutes = require('./routes/documents');
const checklistRoutes = require('./routes/checklist');
const usersRoutes = require('./routes/users');
const ndaRoutes = require('./routes/nda');
const modelsRoutes = require('./routes/models');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/deals', dealsRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/checklist', checklistRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/nda', ndaRoutes);
app.use('/api/models', modelsRoutes);

// Serve survey config (public)
app.get('/api/config/survey', (req, res) => {
  const surveyConfig = require('../../config/survey.json');
  res.json(surveyConfig);
});

// Serve checklist template (public)
app.get('/api/config/checklist-template', (req, res) => {
  const checklistTemplate = require('../../config/checklist-template.json');
  res.json(checklistTemplate);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Invalid or missing authentication token' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

app.listen(PORT, () => {
  console.log(`Aragon Deal Room API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
