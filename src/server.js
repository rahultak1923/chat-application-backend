const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const Message = require('./models/Message');

const app = express();
app.use(cors());
app.use(express.json());

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadBufferToCloudinary = (fileBuffer, originalName = 'file', mimetype = '') => {
  return new Promise((resolve, reject) => {
    const isImage = mimetype.startsWith('image/');
    const extMatch = originalName.match(/(\.[^./\\]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const cleanBaseName = originalName
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);

    const resourceType = isImage ? 'image' : 'raw';
    const publicId = isImage
      ? `${Date.now()}_${cleanBaseName}`
      : `${Date.now()}_${cleanBaseName}${ext}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'whatsapp-clone',
        resource_type: resourceType,
        type: 'upload',
        access_mode: 'public',
        public_id: publicId,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(fileBuffer);
  });
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
  },
});

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
})
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch((err) => console.log('Database Connection Error: ', err));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  socketId: { type: String, default: "" },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists!" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ name, email, password: hashedPassword });
    const savedUser = await newUser.save();

    io.emit('new_user_registered', {
      _id: savedUser._id,
      name: savedUser.name,
      email: savedUser.email,
      lastMessage: '',
      lastMessageTime: null,
      unreadCount: 0,
    });

    res.status(201).json({ message: "User registered successfully!", userId: savedUser._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found!" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid credentials!" });
    }

    res.status(200).json({
      message: "Login successful!",
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/auth/users', async (req, res) => {
  try {
    const { currentUserId } = req.query;
    const filter = currentUserId ? { _id: { $ne: currentUserId } } : {};
    const users = await User.find(filter).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const formatSidebarPreview = (msg) => {
  if (!msg) return '';
  if (msg.fileType === 'image') {
    return msg.text ? `📷 ${msg.text}` : '📷 Photo';
  }
  if (msg.fileType === 'document') {
    const label = msg.fileName || 'Document';
    return msg.text ? `📄 ${label} — ${msg.text}` : `📄 ${label}`;
  }
  return msg.text || '';
};

app.get('/api/auth/users-with-last-message', async (req, res) => {
  try {
    const { currentUserId } = req.query;
    if (!currentUserId) {
      return res.status(400).json({ message: 'currentUserId is required' });
    }

    const users = await User.find({ _id: { $ne: currentUserId } }).select('-password');

    const enrichedUsers = await Promise.all(
      users.map(async (u) => {
        const roomId = [String(currentUserId), String(u._id)].sort().join('_');
        const lastMsg = await Message.findOne({ chatId: roomId }).sort({ createdAt: -1 });
        const unreadCount = await Message.countDocuments({
          chatId: roomId,
          sender: String(u._id),
          isRead: { $ne: true },
        });

        return {
          ...u.toObject(),
          lastMessage: formatSidebarPreview(lastMsg),
          lastMessageTime: lastMsg ? lastMsg.createdAt : null,
          lastSenderId: lastMsg ? lastMsg.sender : null,
          unreadCount,
        };
      })
    );

    enrichedUsers.sort((a, b) => {
      const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return timeB - timeA;
    });

    res.json(enrichedUsers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const isImage = req.file.mimetype.startsWith('image/');
    const result = await uploadBufferToCloudinary(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    res.status(200).json({
      fileUrl: result.secure_url,
      fileName: req.file.originalname,
      fileType: isImage ? 'image' : 'document',
      fileSize: req.file.size,
    });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ message: 'File upload failed', error: err.message });
  }
});

// Secure proxy route for opening/downloading documents when Cloudinary ACL blocks direct browser access
app.get('/api/chat/download', async (req, res) => {
  try {
    const { url, name = 'document' } = req.query;
    if (!url || !/^https:\/\/res\.cloudinary\.com\//.test(String(url))) {
      return res.status(400).json({ message: 'Invalid Cloudinary URL' });
    }

    const safeName = String(name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'document';
    const response = await fetch(String(url));

    if (!response.ok) {
      return res.status(response.status).json({
        message: 'Cloudinary blocked direct fetch; check Cloudinary Security/ACL settings.',
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Download proxy error:', err);
    res.status(500).json({ message: 'Failed to load document' });
  }
});

const chatRoute = require('./routes/chat');
app.use('/api/chat', chatRoute);

const onlineUsers = new Map();

const emitOnlineUsers = () => {
  const uniqueUserIds = [...new Set(onlineUsers.values())];
  io.emit('online_users', uniqueUserIds);
};

io.on('connection', (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on('user_online', (userId) => {
    if (!userId) return;
    onlineUsers.set(socket.id, String(userId));
    emitOnlineUsers();
  });

  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  socket.on('mark_as_read', async ({ room, readerId, senderId }) => {
    try {
      if (!room || !readerId) return;

      const query = {
        chatId: room,
        isRead: { $ne: true },
      };

      if (senderId) {
        query.sender = String(senderId);
      } else {
        query.sender = { $ne: String(readerId) };
      }

      const result = await Message.updateMany(query, { $set: { isRead: true } });

      if (result.modifiedCount > 0) {
        io.to(room).emit('messages_read', { room, readerId });
      }
    } catch (err) {
      console.log('Error marking messages as read:', err);
    }
  });

  socket.on('typing', ({ room, senderId }) => {
    if (!room) return;
    socket.to(room).emit('typing', { room, senderId });
  });

  socket.on('stop_typing', ({ room, senderId }) => {
    if (!room) return;
    socket.to(room).emit('stop_typing', { room, senderId });
  });

  socket.on('send_message', async (data) => {
    try {
      const fileType = data.fileUrl ? (data.fileType === 'image' ? 'image' : 'document') : 'text';

      const newMessage = new Message({
        chatId: data.room,
        sender: data.senderId,
        text: data.text || '',
        fileUrl: data.fileUrl || '',
        fileName: data.fileName || '',
        fileType,
        fileSize: data.fileSize || 0,
        isRead: false,
      });
      const saved = await newMessage.save();

      const payload = {
        ...data,
        _id: saved._id,
        text: saved.text,
        fileUrl: saved.fileUrl,
        fileName: saved.fileName,
        fileType: saved.fileType,
        fileSize: saved.fileSize,
        previewText: formatSidebarPreview(saved),
        isRead: Boolean(saved.isRead),
        createdAt: saved.createdAt,
      };

      io.to(data.room).emit('receive_message', payload);
      io.emit('sidebar_message', payload);
    } catch (err) {
      console.log('Error saving message: ', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User Disconnected: ${socket.id}`);
    onlineUsers.delete(socket.id);
    emitOnlineUsers();
  });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.get('/', (req, res) => {
  res.send('WhatsApp Clone Backend API is running...');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});