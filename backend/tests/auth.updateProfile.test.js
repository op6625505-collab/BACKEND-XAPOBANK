const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const bodyParser = require('express').json;

const authRoutes = require('../routes/auth');
const User = require('../models/User');
const { hashPassword } = require('../services/hashService');
const { signToken } = require('../services/tokenService');

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  // create express app with auth routes mounted
  app = express();
  app.use(bodyParser());
  // mount route with a mock auth middleware that uses the tokenService verification
  const authMiddleware = require('../middleware/authMiddleware');
  app.use('/api/auth', authRoutes);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await User.deleteMany({});
});

test('PATCH /api/auth/me updates profile when authenticated', async () => {
  const passwordHash = await hashPassword('password123');
  const user = await User.create({ name: 'Test User', email: 'test@example.com', passwordHash, phone: '', country: '' });
  const token = signToken({ id: user._id, email: user.email, name: user.name });

  const res = await request(app)
    .patch('/api/auth/me')
    .set('Authorization', 'Bearer ' + token)
    .send({ name: 'Updated Name', phone: '+1234567890', country: 'Atlantis' });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data).toBeDefined();
  expect(res.body.data.name).toBe('Updated Name');
  expect(res.body.data.phone).toBe('+1234567890');
  expect(res.body.data.country).toBe('Atlantis');

  const updated = await User.findById(user._id);
  expect(updated.name).toBe('Updated Name');
});

test('PATCH /api/auth/me rejects invalid email', async () => {
  const passwordHash = await hashPassword('password123');
  const user = await User.create({ name: 'Test User', email: 'test2@example.com', passwordHash, phone: '', country: '' });
  const token = signToken({ id: user._id, email: user.email, name: user.name });

  const res = await request(app)
    .patch('/api/auth/me')
    .set('Authorization', 'Bearer ' + token)
    .send({ email: 'not-an-email' });

  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  expect(Array.isArray(res.body.errors)).toBe(true);
});
