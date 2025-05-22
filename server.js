require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');
const session = require('express-session');

const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: 'your-session-secret', // replace with strong secret or use env variable
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // true if using https
}));

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Atlas connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Mongoose schema and model
const fileSchema = new mongoose.Schema({
  filename: String,
  originalname: String,
  path: String
});
const File = mongoose.model('File', fileSchema);

// Multer storage setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Middleware to check admin auth
function checkAdminAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.redirect('/secret');
  }
}

// Routes
app.get('/', (req, res) => {
  res.render('index', { links: [] });
});

app.post('/upload', upload.array('files'), async (req, res) => {
  const uploadedFiles = [];

  for (let file of req.files) {
    const savedFile = await File.create({
      filename: file.filename,
      originalname: file.originalname,
      path: file.path
    });

    const downloadLink = `${req.protocol}://${req.get('host')}/download/${savedFile._id}`;
    const qrPath = `public/qr/${savedFile._id}.png`;

    // Generate QR code image for the public download link
    await QRCode.toFile(qrPath, downloadLink);

    uploadedFiles.push({
      originalname: savedFile.originalname,
      link: downloadLink,
      qr: `/qr/${savedFile._id}.png`
    });
  }

  res.render('index', { links: uploadedFiles });
});

app.get('/download/:id', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) return res.send('File not found');
    res.download(path.join(__dirname, file.path), file.originalname);
  } catch (err) {
    res.send('Error downloading file');
  }
});

// Admin login page
app.get('/secret', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/secret/dashboard');
  }
  res.send(`
    <center>
      <h2>Admin Login</h2>
      <form method="POST" action="/secret">
        <input type="password" name="code" placeholder="Enter secret code" required><br><br>
        <button type="submit">Enter</button>
      </form>
    </center>
  `);
});

// Admin login POST
app.post('/secret', (req, res) => {
  const code = req.body.code;
  if (code === process.env.ADMIN_SECRET) {
    req.session.isAdmin = true;
    res.redirect('/secret/dashboard');
  } else {
    res.send('<center><h3>Invalid code</h3><a href="/secret">Try Again</a></center>');
  }
});

// Admin dashboard (protected)
app.get('/secret/dashboard', checkAdminAuth, async (req, res) => {
  const files = await File.find({});

  let fileList = files.map(file => {
    const publicLink = `${req.protocol}://${req.get('host')}/download/${file._id}`;
    return `
    <p>
      <strong>${file.originalname}</strong><br>
      Public Link: <a href="${publicLink}" target="_blank">${publicLink}</a><br>
      <a href="${publicLink}">Download</a> |
      <a href="/delete/${file._id}">Delete</a>
    </p>
    `;
  }).join('');

  res.send(`
    <center>
      <h2>Admin Panel</h2>
      ${fileList || '<p>No files uploaded.</p>'}
      <br><a href="/">Back to Upload Page</a>
      <br><br>
      <form method="POST" action="/secret/logout">
        <button type="submit">Logout</button>
      </form>
    </center>
  `);
});

// Delete file (protected)
app.get('/delete/:id', checkAdminAuth, async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) return res.send('File not found');

    fs.unlinkSync(file.path);

    const qrPath = path.join(__dirname, 'public/qr', `${file._id}.png`);
    if (fs.existsSync(qrPath)) {
      fs.unlinkSync(qrPath);
    }

    await File.deleteOne({ _id: file._id });

    res.redirect('/secret/dashboard');
  } catch (err) {
    res.send('Error deleting file');
  }
});

// Admin logout
app.post('/secret/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/secret');
  });
});

// Serve QR codes folder statically
app.use('/qr', express.static(path.join(__dirname, 'public/qr')));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
