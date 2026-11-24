const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Signup Logic
const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists!" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      password: hashedPassword
    });

    const savedUser = await newUser.save();
    res.status(201).json({ message: "User registered successfully!", userId: savedUser._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Login Logic
const login = async (req, res) => {
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
      user: { id: user._id, name: user.name, email: user.email } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


const getUsers = async (req, res) => {
  try {
    const { currentUserId } = req.query;
    const filter = currentUserId ? { _id: { $ne: currentUserId } } : {};
    const users = await User.find(filter).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
};

module.exports = { signup, login,getUsers, };