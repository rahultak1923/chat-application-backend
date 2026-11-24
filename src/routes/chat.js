const router = require('express').Router();
const { getMessages } = require('../controllers/chatController');

router.get('/:chatId', getMessages);


module.exports = router;