const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');
const { Readable } = require('stream');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();

// CORS configuration for production (Firebase Hosting) and local dev
const allowedOrigins = [
  'https://online-submission-app-2f610.web.app',
  'https://online-submission-app-2f610.firebaseapp.com',
  'https://online-assignment-86mg.onrender.com',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
  console.error("MONGO_URI not found in .env file. Please add it.");
  process.exit(1);
}

// Create MongoDB connection
const conn = mongoose.createConnection(mongoURI);

let gridfsBucket;

conn.once('open', () => {
  gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'uploads'
  });
  console.log("Connected to MongoDB GridFS");
});

conn.on('error', (err) => {
  console.error("MongoDB connection error:", err.message);
});

// Use multer memory storage — files are buffered in RAM, then piped to GridFS manually
const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper: upload buffer to GridFS and return file info
function uploadToGridFS(buffer, filename, contentType) {
  return new Promise((resolve, reject) => {
    const readableStream = new Readable();
    readableStream.push(buffer);
    readableStream.push(null);

    const uploadStream = gridfsBucket.openUploadStream(filename, {
      contentType: contentType
    });

    readableStream.pipe(uploadStream);

    uploadStream.on('finish', () => {
      resolve({
        _id: uploadStream.id,
        filename: uploadStream.filename,
        contentType: contentType,
        length: buffer.length
      });
    });

    uploadStream.on('error', (err) => {
      reject(err);
    });
  });
}

// @route POST /api/upload
// @desc  Uploads file to MongoDB GridFS
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Generate a unique filename
    const randomHex = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(req.file.originalname);
    const gridFilename = randomHex + ext;

    const fileInfo = await uploadToGridFS(req.file.buffer, gridFilename, req.file.mimetype);

    const fileUrl = `${req.protocol}://${req.get('host')}/api/files/${gridFilename}`;
    res.json({
      file: {
        filename: gridFilename,
        originalname: req.file.originalname,
        contentType: fileInfo.contentType,
        size: fileInfo.length,
        id: fileInfo._id
      },
      url: fileUrl
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: 'File upload failed', details: err.message });
  }
});

// @route GET /api/files/:filename
// @desc  Stream file from GridFS
app.get('/api/files/:filename', async (req, res) => {
  try {
    const cursor = gridfsBucket.find({ filename: req.params.filename });
    const files = await cursor.toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({ err: 'No file exists' });
    }

    res.set('Content-Type', files[0].contentType || 'application/octet-stream');

    const readStream = gridfsBucket.openDownloadStreamByName(req.params.filename);
    readStream.pipe(res);
  } catch (error) {
    res.status(500).json({ err: error.message });
  }
});

// @route DELETE /api/files/:filename
// @desc  Delete file from GridFS
app.delete('/api/files/:filename', async (req, res) => {
  try {
    const cursor = gridfsBucket.find({ filename: req.params.filename });
    const files = await cursor.toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({ err: 'No file exists' });
    }

    await gridfsBucket.delete(files[0]._id);
    res.status(200).json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ err: error.message });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Backend server started on port ${port}`));
