const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: { type: String, required: true }, // Room ID (kiske beech chat ho rahi hai)
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  fileUrl: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileType: {
      type: String,
      enum: ['text', 'image', 'document'],
      default: 'text',
    },
    fileSize: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);