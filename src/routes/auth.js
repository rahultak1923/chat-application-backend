const router = require('express').Router();
const { signup, login } = require('../controllers/authController');

// Routes mapping to controllers
router.post('/signup', signup);
router.post('/login', login);
router.get('/users', getUsers);

module.exports = router;