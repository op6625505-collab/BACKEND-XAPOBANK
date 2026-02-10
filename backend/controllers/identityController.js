const fs = require('fs');
const path = require('path');
const User = require('../models/User');

exports.upload = async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Prefer multipart file upload (multer) when available: req.file
    let filename = null;
    if (req.file && req.file.buffer) {
      // Determine extension from mimetype or originalname
      const mime = String(req.file.mimetype || '').toLowerCase();
      let ext = 'jpg';
      if (mime && mime.indexOf('/') !== -1) ext = mime.split('/')[1];
      else if (req.file.originalname && req.file.originalname.indexOf('.') !== -1) ext = req.file.originalname.split('.').pop();
      const type = req.body.type || 'passport';
      filename = `${type}_${req.user.id}_${Date.now()}.${ext}`;
      const filepath = path.join(uploadsDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
    } else {
      // Fallback: expect base64 payload in JSON { type, data }
      const { type, data } = req.body;
      if (!type || !data) return res.status(400).json({ success: false, message: 'type and data are required' });
      // data may be a data URL like 'data:image/jpeg;base64,...' or raw base64
      let matches = String(data).match(/^data:(image\/\w+);base64,(.+)$/);
      let base64 = data;
      let ext = 'jpg';
      if (matches) {
        ext = matches[1].split('/')[1] || 'jpg';
        base64 = matches[2];
      } else {
        // try to guess from prefix
        const maybe = String(data).slice(0,20);
        if (maybe.indexOf('/9j/') === 0) ext = 'jpg';
      }
      filename = `${type}_${req.user.id}_${Date.now()}.${ext}`;
      const filepath = path.join(uploadsDir, filename);
      fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const publicPath = `/uploads/${filename}`;
    if (type === 'passport') user.passportPath = publicPath;
    else if (type === 'drivers_license') user.driversLicensePath = publicPath;
    else if (type === 'national_id') user.nationalIdPath = publicPath;
    else if (type === 'live') user.livePhotoPath = publicPath;
    user.idUploadedAt = new Date();
    await user.save();

    return res.json({ success: true, path: publicPath });
  } catch (err) {
    console.error('identity.upload error', err && err.message ? err.message : err);
    const msg = (err && err.message) ? err.message : 'Server error during identity upload';
    return res.status(500).json({ success: false, message: msg });
  }
};
